import { getConfig, getKV, setKV, getFile, putFile, delFile, allFiles,
         enqueue, queued, clearQueue } from './store.js';
import { parse, serialize } from './md.js';

const API = 'https://api.github.com';

class SyncError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function auth() {
  const c = await getConfig();
  if (!c) throw new SyncError('Not set up yet');
  return c;
}

function rest(path, { method = 'GET', body, headers = {}, config } = {}) {
  return fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function ok(r, what) {
  if (r.ok) return r.status === 204 ? null : r.json();
  const { message = '' } = await r.json().catch(() => ({}));
  throw new SyncError(
    r.status === 401 ? 'Token rejected (401) - expired or mistyped.'
    : r.status === 403 ? `Forbidden (403) - the token likely lacks "Contents: read and write" here. ${message}`
    : r.status === 404 ? 'Not found (404) - check owner, repo and that the token can see it.'
    : `${what} failed: ${r.status} ${message}`, r.status);
}

const encode = s => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const decode = b64 =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

export async function testConnection(config) {
  const repo = await ok(await rest(`/repos/${config.owner}/${config.repo}`, { config }), 'repo read');
  return { name: repo.full_name, private: repo.private, empty: repo.size === 0 };
}

// ---- pull: 304-guarded, fetches only what changed ----
// Also the first mirror: with no stored ETag it fetches the tree and every blob in it.

export async function pull(prefix = '') {
  const c = await auth();
  const etag = await getKV('commitEtag');
  const r = await rest(`/repos/${c.owner}/${c.repo}/commits/${c.branch}`,
    { config: c, headers: etag ? { 'If-None-Match': etag } : {} });
  if (r.status === 304) return { changed: 0, unchanged: true };
  if (r.status === 409) return { changed: 0, empty: true };
  await ok(r, 'commit check');
  await setKV('commitEtag', r.headers.get('ETag'));

  const tree = await ok(await rest(
    `/repos/${c.owner}/${c.repo}/git/trees/${c.branch}?recursive=1`, { config: c }), 'tree read');
  if (tree.truncated) throw new SyncError('Tree listing truncated - repo too large for a flat pull.');

  const remote = new Map(tree.tree
    .filter(t => t.type === 'blob' && t.path.endsWith('.md') && t.path.startsWith(prefix))
    .map(t => [t.path, t.sha]));
  const local = new Map((await allFiles(prefix)).map(f => [f.path, f.oid]));

  let changed = 0;
  for (const [path, sha] of remote) {
    if (local.get(path) === sha) continue;
    const blob = await ok(await rest(`/repos/${c.owner}/${c.repo}/git/blobs/${sha}`, { config: c }), 'blob read');
    await putFile({ path, text: decode(blob.content), oid: sha });
    changed++;
  }
  for (const path of local.keys()) if (!remote.has(path)) { await delFile(path); changed++; }
  return { changed };
}

// ---- writes: queue locally, drain as one atomic commit ----

export async function write(path, text) {
  const existing = await getFile(path);
  await putFile({ path, text, oid: existing?.oid });
  await enqueue({ op: 'put', path, text, baseOid: existing?.oid ?? null });
}

export async function remove(path) {
  const existing = await getFile(path);
  await delFile(path);
  await enqueue({ op: 'del', path, baseOid: existing?.oid ?? null });
}

export async function drain(message, retry = true) {
  const items = await queued();
  if (!items.length) return { committed: 0, conflicts: [] };
  const c = await auth();

  let parent = null, baseTree = null;
  const refRes = await rest(`/repos/${c.owner}/${c.repo}/git/ref/heads/${c.branch}`, { config: c });
  const fresh = refRes.status === 409 || refRes.status === 404;   // empty repo: no ref yet
  if (fresh) return initialise(c, items, message, retry);

  parent = (await ok(refRes, 'ref read')).object.sha;
  baseTree = (await ok(await rest(
    `/repos/${c.owner}/${c.repo}/git/commits/${parent}`, { config: c }), 'commit read')).tree.sha;

  // A queued change whose base SHA no longer matches the remote blob is a real conflict:
  // remote keeps the path, ours is committed beside it. Nothing is discarded.
  const conflicts = [];
  {
    const tree = await ok(await rest(
      `/repos/${c.owner}/${c.repo}/git/trees/${c.branch}?recursive=1`, { config: c }), 'tree read');
    const remote = new Map(tree.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]));
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (const it of items) {
      const live = remote.get(it.path);
      if (!it.baseOid || !live || live === it.baseOid) continue;
      const blob = await ok(await rest(`/repos/${c.owner}/${c.repo}/git/blobs/${live}`, { config: c }), 'blob read');
      await putFile({ path: it.path, text: decode(blob.content), oid: live });  // theirs wins the path
      const original = it.path;
      it.path = original.replace(/\.md$/, `.conflict-${stamp}.md`);
      if (it.op === 'put') {
        const { data, body } = parse(it.text);
        it.text = serialize({ ...data, conflictOf: original }, body);
      }
      conflicts.push({ path: original, keptAs: it.path });
    }
  }

  const entries = [];
  for (const it of items) {
    if (it.op === 'del') { entries.push({ path: it.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const blob = await ok(await rest(`/repos/${c.owner}/${c.repo}/git/blobs`,
      { config: c, method: 'POST', body: { content: encode(it.text), encoding: 'base64' } }), 'blob create');
    entries.push({ path: it.path, mode: '100644', type: 'blob', sha: blob.sha, _text: it.text });
  }

  const tree = await ok(await rest(`/repos/${c.owner}/${c.repo}/git/trees`, {
    config: c, method: 'POST',
    body: { base_tree: baseTree, tree: entries.map(strip) }
  }), 'tree create');

  const commit = await ok(await rest(`/repos/${c.owner}/${c.repo}/git/commits`, {
    config: c, method: 'POST',
    body: { message: message || `${items.length} change(s) from Mine`, tree: tree.sha, parents: [parent] }
  }), 'commit create');

  {
    const r = await rest(`/repos/${c.owner}/${c.repo}/git/refs/heads/${c.branch}`, {
      config: c, method: 'PATCH', body: { sha: commit.sha, force: false }
    });
    if (!r.ok) {
      // Rejected: someone pushed elsewhere. Rebase onto the new base and retry once -
      // this succeeds because nearly every write is a create at a fresh path.
      if (retry && (r.status === 422 || r.status === 409)) { await pull(); return drain(message, false); }
      await ok(r, 'ref update');
    }
  }

  for (const e of entries) {
    if (e.sha === null) await delFile(e.path);
    else await putFile({ path: e.path, text: e._text, oid: e.sha });
  }
  await clearQueue();
  await setKV('commitEtag', null);   // our own commit changed the ref
  return { committed: items.length, commit: commit.sha, conflicts };
}

const strip = ({ _text, ...e }) => e;

// A repo with no commits rejects the Git Data API outright: POST /git/blobs answers
// 409 "Git Repository is empty". Only the Contents API can create the first commit, so the
// first queued file goes that way and the rest drain normally once a history exists.
async function initialise(c, items, message, retry) {
  const first = items.find(i => i.op === 'put');
  if (!first) { await clearQueue(); return { committed: 0, conflicts: [] }; }

  const res = await ok(await rest(`/repos/${c.owner}/${c.repo}/contents/${encodeURI(first.path)}`, {
    config: c, method: 'PUT',
    body: {
      message: message || 'Initial commit from Mine',
      content: encode(first.text),
      branch: c.branch
    }
  }), 'initial commit');

  await putFile({ path: first.path, text: first.text, oid: res.content.sha });

  const rest_ = items.filter(i => i !== first);
  await clearQueue();
  await setKV('commitEtag', null);
  if (!rest_.length) return { committed: 1, commit: res.commit.sha, conflicts: [] };

  for (const it of rest_) await enqueue(it);
  const more = await drain(message, retry);
  return { ...more, committed: more.committed + 1, commit: more.commit || res.commit.sha };
}
