/* sw.js — PEPE Smart Trader Service Worker
 * Cache strategy:
 *   - Shell (HTML/JSON/PNG): Network-First with cache fallback (for index.html + manifest)
 *   - Static icons: Cache-First
 *   - MEXC API: NEVER cache (network only, bypass SW)
 * Cache version comment must match CACHE_NAME below.
 */

const CACHE_VERSION = 'v14';
const CACHE_NAME = `pepe-shell-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* Install: precache the shell */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll fails if ANY request fails — use per-item add for resilience
      return Promise.all(
        SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] precache miss:', url, err && err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

/* Activate: cleanup old caches + claim clients */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('pepe-shell-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* Fetch */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Never cache MEXC API or any cross-origin api.* call
  if (url.hostname.endsWith('api.mexc.com') ||
      url.hostname.endsWith('cors.dev') ||
      url.pathname.includes('/api/v3/')) {
    event.respondWith(fetch(req).catch(() => new Response('', { status: 503 })));
    return;
  }

  // 2) Same-origin navigation / index.html → Network-First
  const isShellDoc =
    req.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html');

  if (isShellDoc) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 3) Same-origin static (manifest, icons) → Stale-While-Revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 4) Everything else → pass through
  // (no respondWith)
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // last-resort fallback to cached index.html
    const shell = await cache.match('./index.html');
    if (shell) return shell;
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}
