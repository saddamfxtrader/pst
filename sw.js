/* PEPE Smart Trader v9.1 — Service Worker
   ────────────────────────────────────────────────
   Strategy:
     • Cache same-origin app shell (index.html, sw.js)
     • MEXC API + CORS proxy → always live, never cached
     • Navigation → network-first, robust cache fallback
     • Same-origin GET → cache-first, network fallback
   
   Cache bumped v7 → v8 (2026-11-21):
     Includes PWA fixes in index.html (chat close button,
     back-button handler, manifest+icons). Version bump forces
     old v7 cache eviction so offline users get the new shell.
   ──────────────────────────────────────────────── */
const CACHE = 'pepe-shell-v9';
const SHELL = ['./', './index.html', './sw.js'];

/* ── Install: pre-cache shell (robust — one failure doesn't abort) ── */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(
        SHELL.map(url => c.add(url).catch(err => {
          console.warn('[SW] skip cache:', url, err);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: delete every old cache, take control ── */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch ── */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  /* 1) MEXC API + CORS proxy → always live */
  if (url.hostname.endsWith('mexc.com') || url.hostname.endsWith('cors.dev')) {
    e.respondWith(
      fetch(req).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  /* 2) Navigation → network-first, then robust cache fallback */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const cp = res.clone();
          caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const hit =
            (await caches.match(req)) ||
            (await caches.match('./index.html')) ||
            (await caches.match('./'));
          return hit || new Response(
            '<h1>Offline</h1><p>Please reconnect and reload.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  /* 3) Same-origin GET → cache-first, network fallback */
  if (req.method === 'GET' && url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(hit => {
        if (hit) return hit;
        return fetch(req)
          .then(res => {
            const cp = res.clone();
            caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
            return res;
          })
          .catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  /* 4) Everything else → let browser handle it */
});

/* ── Message channel: page can trigger update / clear cache ── */
self.addEventListener('message', (e) => {
  if (!e.data || !e.data.type) return;
  if (e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (e.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
