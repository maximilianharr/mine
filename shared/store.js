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
export const queued = () => run('queue', 'readonly', s => s.getAll());
export const queuedCount = () => run('queue', 'readonly', s => s.count());
export const clearQueue = () => run('queue', 'readwrite', s => s.clear());

// Request persistent storage. Granted without a prompt in an installed app on both
// iOS and Android; without it, iOS evicts storage after ~7 days idle.
export async function persist() {
  try { return await navigator.storage.persisted() || await navigator.storage.persist(); }
  catch { return false; }
}
