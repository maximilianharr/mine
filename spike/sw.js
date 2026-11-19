// Module service worker: the registration succeeding is the whole test.
import { APPS } from './apps.js';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.hostname.endsWith('github.com')) return; // never cache API traffic
});
console.log('module SW alive, imported APPS =', APPS);
