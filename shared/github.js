import { APPS } from './apps.js';
import { getConfig, getKV, setKV, getFile, putFile, delFile, allFiles,
         enqueue, queued, dequeue } from './store.js';
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

// `no-store`: GitHub answers `cache-control: max-age=60`, and the browser would otherwise serve
// the commit and tree from before our own push for a minute after it. A pull over that stale
// tree deletes the files just pushed from the mirror, and they come back a minute later.
function rest(path, { method = 'GET', body, headers = {}, config } = {}) {
  return fetch(API + path, {
    method,
    cache: 'no-store',
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

// ---- the sync record ----------------------------------------------------------------------
// One row, not a history: what the last attempt did, and how many times in a row it has done
// it. Written in here rather than in app code so that every caller is covered without having to
// remember to - the calendar's push, both refreshes, and the home screen, which drains the same
// queue - and so the reason survives the reload that used to wipe it off the status line.
//
// A repeat of the same outcome bumps the count rather than appending, because a wedged queue is
// retried on every window focus and twenty copies of one 403 would bury the pull that explains
// it. A 304 pull is not an attempt at anything and is not recorded at all.

// Which screen made the attempt, read when it is written rather than when this module loads:
// an app's data module imports this file and the node unit checks import that, where there is
// no `location` at all.
//
// The last path segment that is not a file is the app's folder, which is its slug - so an app
// added tomorrow names itself here without this line being touched. The root app has no such
// segment and is `mine`.
const appName = () => {
  const parts = (globalThis.location?.pathname ?? '').split('/').filter(p => p && !p.includes('.'));
  return APPS.some(a => a.slug === parts.at(-1)) ? parts.at(-1) : 'mine';
};

async function record(op, outcome, status, detail) {
  const app = appName();
  const prev = await getKV('sync.last');
  const now = Date.now();
  const same = prev && prev.op === op && prev.outcome === outcome && prev.status === status;
  await setKV('sync.last', same
    ? { ...prev, lastAt: now, count: prev.count + 1, app, detail }
    : { at: now, lastAt: now, count: 1, app, op, outcome, status: status ?? null, detail });
}

export const lastSync = () => getKV('sync.last');

export async function testConnection(config) {
  const repo = await ok(await rest(`/repos/${config.owner}/${config.repo}`, { config }), 'repo read');
  return { name: repo.full_name, private: repo.private, empty: repo.size === 0 };
}

// ---- pull: 304-guarded, fetches only what changed ----
// Also the first mirror: with no stored ETag it fetches the tree and every blob in it.
//
// The whole repo, always, and deliberately no way to ask for one app's folder. There is a
// single `commitEtag` for the whole mirror, so a pull that fetched only `diary/` would store
// the ETag of a commit it had not mirrored, and the calendar's next pull would 304 against it
// and never see its own files again. A per-folder pull would need a per-folder ETag, and the
// request it saves is one conditional GET.

export async function pull() {
  try {
    const r = await pullNow();
    if (!r.unchanged)
      await record('pull', 'ok', null, r.empty ? 'repo is empty' : `${r.changed} file(s) updated`);
    return r;
  } catch (err) {
    await record('pull', 'failed', err.status ?? null, err.message);
    throw err;
  }
}

async function pullNow() {
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
    .filter(t => t.type === 'blob' && t.path.endsWith('.md'))
    .map(t => [t.path, t.sha]));
  const local = new Map((await allFiles()).map(f => [f.path, f.oid]));

  let changed = 0;
  for (const [path, sha] of remote) {
    if (local.get(path) === sha) continue;
    const blob = await ok(await rest(`/repos/${c.owner}/${c.repo}/git/blobs/${sha}`, { config: c }), 'blob read');
    await putFile({ path, text: decode(blob.content), oid: sha });
    changed++;
  }
  // A save made while this pull ran is in the mirror and the queue but not yet in the remote.
  const pending = new Set((await queued()).map(i => i.path));
  for (const path of local.keys())
    if (!remote.has(path) && !pending.has(path)) { await delFile(path); changed++; }
  return { changed };
}

// ---- writes: queue locally, drain as one atomic commit ----

export async function write(path, text) {
  const existing = await getFile(path);
  await putFile({ path, text, oid: existing?.oid });
  await enqueue({ op: 'put', path, text, baseOid: existing?.oid ?? null, at: Date.now() });
}

export async function remove(path) {
  const existing = await getFile(path);
  await delFile(path);
  await enqueue({ op: 'del', path, baseOid: existing?.oid ?? null, at: Date.now() });
}

export async function drain(message, retry = true) {
  try {
    const r = await drainNow(message, retry);
    if (r.committed || r.conflicts.length)
      await record('drain', r.conflicts.length ? 'conflict' : 'ok', null,
        r.conflicts.length
          ? `${r.conflicts.length} change(s) kept beside the remote version as .conflict files`
          : `${r.committed} change(s) committed as ${r.commit?.slice(0, 7)}`);
    return r;
  } catch (err) {
    await record('drain', 'failed', err.status ?? null, err.message);
    throw err;
  }
}

async function drainNow(message, retry) {
  let items = await queued();
  if (!items.length) return { committed: 0, conflicts: [] };
  // What this drain is responsible for, and nothing else. A save made while it is running is a
  // new key that must still be queued when it finishes - clearing the store would drop that
  // item while its text stayed in the mirror, and the next pull would then delete the file for
  // not being in the remote. One commit covers these keys; the next drain covers the rest.
  const keys = items.map(i => i.key);
  const c = await auth();

  let parent = null, baseTree = null;
  const refRes = await rest(`/repos/${c.owner}/${c.repo}/git/ref/heads/${c.branch}`, { config: c });
  const fresh = refRes.status === 409 || refRes.status === 404;   // empty repo: no ref yet
  if (fresh) return initialise(c, items, message, retry);

  parent = (await ok(refRes, 'ref read')).object.sha;
  baseTree = (await ok(await rest(
    `/repos/${c.owner}/${c.repo}/git/commits/${parent}`, { config: c }), 'commit read')).tree.sha;

  // A queued change whose base SHA no longer matches the remote blob, and whose text differs
  // from it, is a real conflict: remote keeps the path, ours is committed beside it. Nothing is
  // discarded.
  //
  // A matching text is a receipt instead. A drain that died between the ref update and the queue
  // being cleared leaves items behind whose base SHA no longer matches - because the remote now
  // holds our own commit - and forking those into .conflict files is the app fighting its own
  // work. The blob is fetched here either way, so comparing it costs no request.
  const listing = await ok(await rest(
    `/repos/${c.owner}/${c.repo}/git/trees/${c.branch}?recursive=1`, { config: c }), 'tree read');
  const remote = new Map(listing.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha]));

  const conflicts = [], done = [];
  {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (const it of items) {
      const live = remote.get(it.path);
      if (!it.baseOid || !live || live === it.baseOid) continue;
      const blob = await ok(await rest(`/repos/${c.owner}/${c.repo}/git/blobs/${live}`, { config: c }), 'blob read');
      const theirs = decode(blob.content);
      await putFile({ path: it.path, text: theirs, oid: live });  // theirs wins the path
      if (it.op === 'put' && theirs === it.text) { done.push(it); continue; }
      const original = it.path;
      it.path = original.replace(/\.md$/, `.conflict-${stamp}.md`);
      if (it.op === 'put') {
        const { data, body } = parse(it.text);
        it.text = serialize({ ...data, conflictOf: original }, body);
      }
      conflicts.push({ path: original, keptAs: it.path });
    }
    items = items.filter(it => !done.includes(it));
    if (!items.length) { await dequeue(keys); return { committed: 0, conflicts }; }
  }

  // One tree entry per path, the last queued op winning. A drain is one commit, so a path
  // written twice in it is one write and a path written and then deleted is a delete; sending
  // the same path twice in one tree request is not something the API has to make sense of.
  const last = new Map();
  for (const it of items) last.set(it.path, it);

  const entries = [];
  for (const it of last.values()) {
    if (it.op === 'del') {
      // Deleting a path the remote does not have is not a change - and it is not harmless
      // either: `sha: null` on a path that is not in `base_tree` answers 422
      // `GitRPC::BadObjectState` and refuses the whole commit, every time it is retried. A file
      // moved or deleted before the queue ever drained is exactly that, because a move is a
      // delete of a path GitHub never saw. Dropping it is also what the user asked for: the
      // file is already gone locally and GitHub has nothing to remove.
      if (remote.has(it.path)) entries.push({ path: it.path, mode: '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await ok(await rest(`/repos/${c.owner}/${c.repo}/git/blobs`,
      { config: c, method: 'POST', body: { content: encode(it.text), encoding: 'base64' } }), 'blob create');
    entries.push({ path: it.path, mode: '100644', type: 'blob', sha: blob.sha, _text: it.text });
  }
  // Everything queued turned out to be a no-op against this remote. There is nothing to commit
  // and nothing to keep: the mirror already reads the way the user left it.
  if (!entries.length) { await dequeue(keys); return { committed: 0, conflicts }; }

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
      if (retry && (r.status === 422 || r.status === 409)) { await pullNow(); return drainNow(message, false); }
      await ok(r, 'ref update');
    }
  }

  for (const e of entries) {
    if (e.sha === null) await delFile(e.path);
    else await putFile({ path: e.path, text: e._text, oid: e.sha });
  }
  await dequeue(keys);
  await setKV('commitEtag', null);   // our own commit changed the ref
  return { committed: items.length, commit: commit.sha, conflicts };
}

const strip = ({ _text, ...e }) => e;

// Giving up on the queue is not just forgetting it. The mirror still holds the text that could
// not be pushed, filed under the blob SHA it was based on, and a pull compares SHAs - so the
// path would match the remote forever and the divergent text would never be reconciled. Forget
// those files too and drop the ETag: the next pull restores exactly what GitHub holds.
export async function discardQueue() {
  const items = await queued();
  await dequeue(items.map(i => i.key));
  for (const path of new Set(items.map(i => i.path))) await delFile(path);
  await setKV('commitEtag', null);
  await record('drain', 'discarded', null, `${items.length} change(s) discarded unsent`);
  return items.length;
}

// A repo with no commits rejects the Git Data API outright: POST /git/blobs answers
// 409 "Git Repository is empty". Only the Contents API can create the first commit, so the
// first queued file goes that way and the rest drain normally once a history exists.
async function initialise(c, items, message, retry) {
  const first = items.find(i => i.op === 'put');
  // Nothing to write, and an empty repo has nothing to delete from either.
  if (!first) { await dequeue(items.map(i => i.key)); return { committed: 0, conflicts: [] }; }

  const res = await ok(await rest(`/repos/${c.owner}/${c.repo}/contents/${encodeURI(first.path)}`, {
    config: c, method: 'PUT',
    body: {
      message: message || 'Initial commit from Mine',
      content: encode(first.text),
      branch: c.branch
    }
  }), 'initial commit');

  await putFile({ path: first.path, text: first.text, oid: res.content.sha });

  // Only the one that was just committed leaves the queue. The rest stay where they are, with
  // the keys and the queued-at times they already had, and the recursive drain reads them back
  // out - there is no need to take them out and put them in again.
  await dequeue([first.key]);
  await setKV('commitEtag', null);
  if (items.length === 1) return { committed: 1, commit: res.commit.sha, conflicts: [] };

  const more = await drainNow(message, retry);
  return { ...more, committed: more.committed + 1, commit: more.commit || res.commit.sha };
}
