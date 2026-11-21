/* PEPE Smart Trader v9.1 — Service Worker
   Strategy:
     - Cache same-origin app shell (index.html, sw.js).
     - Do NOT cache MEXC API (always live fetch).
     - Navigation fallback → cached index.html.

   Cache bumped to v7 for v9.1 release
   (Convert Limit Calculator is inline; version bump forces old
    cache eviction so offline users get the new shell).
*/
const CACHE = 'pepe-shell-v7';
const SHELL = ['./', './index.html', './sw.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // MEXC API — always network, never cache
  if (url.hostname.endsWith('mexc.com') || url.hostname.endsWith('cors.dev')) {
    e.respondWith(fetch(req).catch(() => new Response('', {status:503})));
    return;
  }

  // Navigation → network-first, fallback to cached index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const cp = res.clone();
        caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Same-origin GET → cache-first, fallback network
  if (req.method === 'GET' && url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const cp = res.clone();
        caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }
});
