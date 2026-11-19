import { APPS } from './shared/apps.js';

const VERSION = '2026-11-19.1';
const CACHE = `mine-${VERSION}`;

const SHELL = [
  './', './index.html', './app.js', './style.css', './manifest.json', './icon.svg',
  './shared/apps.js', './shared/store.js', './shared/github.js', './shared/md.js',
  './shared/vendor/js-yaml.mjs',
  ...APPS.flatMap(a => [`./${a.slug}/`, `./${a.slug}/icon.svg`])
];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => undefined)
));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never cache API traffic: a stale ETag would silently break sync.
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    const network = fetch(e.request).then(r => {
      if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
      return r;
    }).catch(() => cached);
    return cached || network;
  })());
});
