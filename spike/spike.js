// Shared by /spike/ and /spike/sub/ - also proves cross-path module imports work.
const DB = 'mine-spike', STORE = 'kv';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), q = fn(t.objectStore(STORE));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  }));
}
export const get = k => tx('readonly', s => s.get(k));
export const put = (k, v) => tx('readwrite', s => s.put(v, k));

const mode = () => matchMedia('(display-mode: standalone)').matches
  ? 'STANDALONE (installed)'
  : (navigator.standalone ? 'STANDALONE (ios legacy)' : 'browser tab');

async function checks(where) {
  const out = [];
  const add = (name, pass, detail) => out.push({ name, pass, detail });

  add('page', null, location.pathname);
  add('launched as', mode() !== 'browser tab', mode());
  add('secure context', isSecureContext, String(isSecureContext));

  // THE question: does a value written at /spike/ exist at /spike/sub/ ?
  try {
    const marker = await get('marker');
    add('IndexedDB marker visible here', !!marker,
      marker ? `written at ${marker.path} (${marker.mode}) ${marker.at}` : 'EMPTY - nothing readable');
  } catch (e) { add('IndexedDB marker visible here', false, 'threw: ' + e.name); }

  // iOS evicts script-writable storage after ~7 days without engagement unless installed.
  try {
    const already = await navigator.storage.persisted();
    const granted = already || await navigator.storage.persist();
    add('storage persisted (not evictable)', granted, already ? 'already granted' : 'persist() -> ' + granted);
  } catch (e) { add('storage persisted (not evictable)', false, 'unsupported: ' + e.name); }

  try {
    const est = await navigator.storage.estimate();
    add('quota', true, `${(est.quota / 1048576).toFixed(0)} MB available`);
  } catch (e) { add('quota', false, e.name); }

  // Module service worker (Safari 16.4+). Only the root spike page registers.
  if (where === 'root') {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { type: 'module', scope: './' });
      add('service worker {type:module}', true, 'registered, scope ' + reg.scope);
    } catch (e) {
      add('service worker {type:module}', false, e.name + ': ' + e.message);
      try {
        const reg = await navigator.serviceWorker.register('./sw-classic.js', { scope: './' });
        add('fallback classic service worker', true, 'registered, scope ' + reg.scope);
      } catch (e2) { add('fallback classic service worker', false, e2.message); }
    }
  }

  // CORS reality check, no token: a readable 401/403 means CORS passed.
  try {
    const r = await fetch('https://api.github.com/graphql',
      { method: 'POST', body: '{"query":"{viewer{login}}"}' });
    add('GraphQL reachable from browser', true, `HTTP ${r.status} readable (CORS ok)`);
  } catch (e) { add('GraphQL reachable from browser', false, 'blocked: ' + e.message); }

  try {
    const r = await fetch('https://api.github.com/repos/octocat/Hello-World/tarball/master');
    add('tarball blocked (expected FAIL=good)', false, `HTTP ${r.status} - unexpectedly allowed!`);
  } catch (e) { add('tarball blocked (expected FAIL=good)', true, 'blocked as predicted: ' + e.message); }

  return out;
}

export async function render(where) {
  const rows = await checks(where);
  const icon = p => p === null ? '·' : (p ? '✓' : '✗');
  document.querySelector('#out').innerHTML = rows.map(r =>
    `<tr class="${r.pass === null ? '' : (r.pass ? 'ok' : 'bad')}">
       <td>${icon(r.pass)}</td><td>${r.name}</td><td>${r.detail}</td></tr>`).join('');
  document.querySelector('#summary').textContent =
    `${mode()} | ${location.pathname}\n` + rows.map(r => `${icon(r.pass)} ${r.name}: ${r.detail}`).join('\n');
}

export async function writeMarker() {
  await put('marker', { path: location.pathname, mode: mode(), at: new Date().toISOString() });
  location.reload();
}
