/* PEPE Smart Trader PWA — Service Worker v10 */
const CACHE = 'pepe-shell-v10';
const SHELL = ['./', './index.html', './manifest.json', './sw.js', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Live market endpoints must never be served from cache.
  if (url.hostname.endsWith('mexc.com') || url.hostname.endsWith('cors.dev')) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Navigation: network first, then app-shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(async () => {
          return (await caches.match(request))
            || (await caches.match('./index.html'))
            || (await caches.match('./'))
            || new Response('<h1>Offline</h1><p>Please reconnect and reload.</p>', {
              status: 503,
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            });
        })
    );
    return;
  }

  // Same-origin static assets: cache first, network fallback.
  if (request.method === 'GET' && url.origin === location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request)
          .then(response => {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
            return response;
          })
          .catch(() => new Response('', { status: 503 }));
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
  }
});
