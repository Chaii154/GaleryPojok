// ╔══════════════════════════════════════════════════════╗
// ║     DIPOJOK Gallery — Service Worker (Offline v2)    ║
// ╚══════════════════════════════════════════════════════╝

const CACHE_STATIC  = 'dipojok-static-v2';
const CACHE_PHOTOS  = 'dipojok-photos-v2';
const CACHE_FONTS   = 'dipojok-fonts-v2';

// Aset statis yang wajib di-cache saat install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/config.js',
];

// ── INSTALL: cache aset statis ────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_STATIC)
      .then(c => c.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: bersihkan cache lama ───────────────────
self.addEventListener('activate', e => {
  const valid = [CACHE_STATIC, CACHE_PHOTOS, CACHE_FONTS];
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !valid.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: strategi berbeda per jenis request ─────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;

  // 1) Firebase Realtime DB & Auth → SKIP (selalu network)
  if (url.includes('firebaseio.com') ||
      url.includes('firestore.googleapis.com') ||
      url.includes('identitytoolkit.googleapis.com') ||
      url.includes('securetoken.googleapis.com')) {
    return; // biarkan browser handle langsung
  }

  // 2) Firebase SDK JS (gstatic) → Cache First
  if (url.includes('gstatic.com/firebasejs')) {
    e.respondWith(cacheFirst(e.request, CACHE_STATIC));
    return;
  }

  // 3) Google Fonts CSS → Cache First
  if (url.includes('fonts.googleapis.com')) {
    e.respondWith(cacheFirst(e.request, CACHE_FONTS));
    return;
  }

  // 4) Google Fonts woff/woff2 → Cache First
  if (url.includes('fonts.gstatic.com')) {
    e.respondWith(cacheFirst(e.request, CACHE_FONTS));
    return;
  }

  // 5) Gambar Cloudinary → Stale While Revalidate (cache dulu, update background)
  if (url.includes('cloudinary.com') || url.includes('res.cloudinary.com')) {
    e.respondWith(staleWhileRevalidate(e.request, CACHE_PHOTOS));
    return;
  }

  // 6) Cloudinary Upload API → SKIP (selalu network)
  if (url.includes('api.cloudinary.com')) {
    return;
  }

  // 7) Aset lokal (index.html, manifest, config, sw) → Network First + fallback cache
  e.respondWith(networkFirstWithCache(e.request, CACHE_STATIC));
});

// ── HELPER: Cache First ───────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// ── HELPER: Stale While Revalidate ───────────────────
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || fetchPromise || new Response('', { status: 503 });
}

// ── HELPER: Network First + Cache Fallback ────────────
async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match('/index.html') || new Response('Offline', { status: 503 });
  }
}

// ── MESSAGE: Paksa update cache foto baru ─────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'CACHE_PHOTO' && e.data.url) {
    caches.open(CACHE_PHOTOS).then(cache => {
      fetch(e.data.url).then(r => { if (r.ok) cache.put(e.data.url, r); }).catch(() => {});
    });
  }
  if (e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
