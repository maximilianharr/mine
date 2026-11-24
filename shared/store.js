// One IndexedDB for all apps. Same origin across /mine/ and /mine/<app>/, so the settings
// written by the main app are readable from every subfolder. Verified on iOS and Android.
const NAME = 'mine', VERSION = 1;
let opening;

function db() {
  return opening ||= new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');                             // config, sync metadata
      d.createObjectStore('files', { keyPath: 'path' });     // { path, text, oid }
      d.createObjectStore('queue', { autoIncrement: true }); // pending writes
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), q = fn(t.objectStore(store));
    t.onerror = () => rej(t.error);
    if (q) { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }
    else t.oncomplete = () => res();
  });
}

export const getKV = k => run('kv', 'readonly', s => s.get(k));
export const setKV = (k, v) => run('kv', 'readwrite', s => s.put(v, k));

export const getConfig = () => getKV('config');
export const setConfig = c => setKV('config', c);

export const getFile = path => run('files', 'readonly', s => s.get(path));
export const putFile = f => run('files', 'readwrite', s => s.put(f));
export const delFile = path => run('files', 'readwrite', s => s.delete(path));
export const allFiles = async prefix =>
  (await run('files', 'readonly', s => s.getAll()))
    .filter(f => !prefix || f.path.startsWith(prefix));

export const enqueue = item => run('queue', 'readwrite', s => s.add(item));
export const queuedCount = () => run('queue', 'readonly', s => s.count());

// Each item with the key it is stored under, both read in one transaction: a drain removes the
// items it actually read, by key, and a write that landed while it was running must still be
// there afterwards. Two separate reads could not be trusted to line up - an `add` between them
// would lengthen one list and not the other. Within the one transaction they do line up by
// index, because both are defined to walk the records in ascending key order.
export async function queued() {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('queue', 'readonly'), s = t.objectStore('queue');
    const keys = s.getAllKeys(), items = s.getAll();
    t.onerror = () => rej(t.error);
    t.oncomplete = () => res(items.result.map((item, i) => ({ ...item, key: keys.result[i] })));
  });
}

export const dequeue = keys =>
  run('queue', 'readwrite', s => { for (const k of keys) s.delete(k); });

// Request persistent storage. Granted without a prompt in an installed app on both
// iOS and Android; without it, iOS evicts storage after ~7 days idle.
export async function persist() {
  try { return await navigator.storage.persisted() || await navigator.storage.persist(); }
  catch { return false; }
}
