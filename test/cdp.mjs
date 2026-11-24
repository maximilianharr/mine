// The browser harness every suite shares: the CDP connection, the reporting, the viewport, and
// the store readers. One suite per app imports it - test/check-<app>.mjs - and run.sh runs them
// in turn against one Chromium.
//
// Chromium is driven over CDP rather than with --window-size and --screenshot, because that flag
// pair lays the page out at a fixed 500px and only scales the capture: a 320px screenshot of a
// 500px layout passes a fit check that a real phone fails. Emulation.setDeviceMetricsOverride is
// the width the page actually sees.
//
// Node 20 has no WebSocket global, hence --experimental-websocket in run.sh.
export const PORT = 8787, CDP = 9222;
export const ORIGIN = `http://127.0.0.1:${PORT}`;
export const SHOT = process.argv.includes('--shot')
  ? process.argv[process.argv.indexOf('--shot') + 1] : null;

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- reporting ------------------------------------------------------------------------------

let failures = 0;
export const ok = (name, pass, detail = '') => {
  failures += pass ? 0 : 1;
  console.log(`${pass ? 'pass' : 'FAIL'}  ${name}${pass || !detail ? '' : '  — ' + detail}`);
};
export const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want),
  `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// The last line of a suite. run.sh adds up the exit codes, so one failing suite fails the run.
export function report(what) {
  console.log(failures ? `\n${failures} ${what} check(s) failed` : `\nall ${what} checks passed`);
  ws.close();
  process.exit(failures ? 1 : 0);
}

// ---- the connection -------------------------------------------------------------------------

async function pageTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chromium is still coming up */ }
    await sleep(200);
  }
  throw new Error('no CDP page target — is Chromium running with --remote-debugging-port?');
}

const ws = new WebSocket(await pageTarget());
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
export const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  waiting.set(n, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result));
  ws.send(JSON.stringify({ id: n, method, params }));
});
export const ev = async expression => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');

export const viewport = (w, scheme = 'light') => Promise.all([
  send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: true }),
  send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
]);

export const goto = async (path, settle = 1500) => {
  await send('Page.navigate', { url: ORIGIN + path });
  await sleep(settle);
};

export const shoot = async name => {
  if (!SHOT) return;
  const s = await send('Page.captureScreenshot', { format: 'png' });
  (await import('fs')).writeFileSync(`${SHOT}/${name}.png`, Buffer.from(s.data, 'base64'));
};

// ---- the store ------------------------------------------------------------------------------
// Opened at version 1 with every store created if missing, so a suite can seed before the app
// has ever run on this profile.

const OPEN = `new Promise((res, rej) => {
  const r = indexedDB.open('mine', 1);
  r.onupgradeneeded = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'path' });
    if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { autoIncrement: true });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
})`;

// An app's fixture into the local mirror, with a config so the app opens past its setup gate.
// A fake token is enough: the mirror is local, and the failed push only writes the sync line.
// `kv` is whatever else that app reads on boot.
//
// **Every store is cleared first.** The suites share one Chromium and one profile, so a seed
// that added to what was there would make each suite's result depend on which ran before it -
// a theme chosen by one would be the theme another's colour checks read, and the order is a
// glob of the directory. Seeding is the start of a suite, so starting from nothing is what it
// has to mean.
export const seed = (app, kv = {}) => ev(`(async () => {
  const files = await (await fetch('${ORIGIN}/__fixture/${app}.json')).json();
  const db = await ${OPEN};
  await new Promise((res, rej) => {
    const t = db.transaction(['kv', 'files', 'queue'], 'readwrite');
    for (const s of ['kv', 'files', 'queue']) t.objectStore(s).clear();
    t.objectStore('kv').put({ owner: 'demo', repo: 'mine-data', branch: 'main',
      token: 'not-a-real-token', expires: '2099-01-01' }, 'config');
    for (const [k, v] of Object.entries(${JSON.stringify(kv)})) t.objectStore('kv').put(v, k);
    for (const f of files) t.objectStore('files').put(f);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  return files.length;
})()`);

export const kv = key => ev(`(async () => {
  const db = await ${OPEN};
  return new Promise(res => {
    const q = db.transaction('kv', 'readonly').objectStore('kv').get('${key}');
    q.onsuccess = () => res(q.result === undefined ? null : q.result);
  });
})()`);

export const queueSize = () => ev(`(async () => {
  const db = await ${OPEN};
  return new Promise(res => {
    const q = db.transaction('queue', 'readonly').objectStore('queue').count();
    q.onsuccess = () => res(q.result);
  });
})()`);

// `n` pending changes under `prefix`, the first a delete, each an hour older than the last, so
// the logs panel has a backlog with real ages in it to report.
export const seedQueue = (n, prefix) => ev(`(async () => {
  const db = await ${OPEN};
  await new Promise((res, rej) => {
    const t = db.transaction(['queue', 'kv'], 'readwrite');
    t.objectStore('queue').clear();
    t.objectStore('kv').delete('sync.last');
    // An ETag to be dropped: without one seeded, the check that discarding drops it reads null
    // either way and cannot fail.
    t.objectStore('kv').put('W/\\"seeded-for-the-check\\"', 'commitEtag');
    for (let i = 0; i < ${n}; i++)
      t.objectStore('queue').add({
        op: i ? 'put' : 'del',
        path: ${JSON.stringify(prefix)} + 'q' + i + '.md',
        text: '---\\ntitle: queued ' + i + '\\n---\\n',
        baseOid: null,
        at: Date.now() - i * 3600000
      });
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  return true;
})()`);

// Everything this device holds, for a suite that needs the app to open on its setup gate.
export const wipe = () => ev(`(async () => {
  const db = await ${OPEN};
  await new Promise((res, rej) => {
    const t = db.transaction(['kv', 'files', 'queue'], 'readwrite');
    for (const s of ['kv', 'files', 'queue']) t.objectStore(s).clear();
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
  db.close();
  return true;
})()`);
