const CACHE_NAME = 'pepe-trader-v1';
const SHELL_ASSETS = [
  '/pst/',
  '/pst/index.html',
  '/pst/manifest.json',
  '/pst/test.html'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Caching shell assets');
      return cache.addAll(SHELL_ASSETS);
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('mexc.com') || url.pathname.includes('cors.dev')) {
      // Always fetch live API requests from network
      event.respondWith(fetch(event.request));
      return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request);
    })
  );
});
