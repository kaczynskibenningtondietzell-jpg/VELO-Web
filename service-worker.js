/* ============================================================
   VELO — service-worker.js
   Cache-first offline support para cuando VELO se instala como
   PWA. La aplicación funciona igualmente abriendo index.html
   directamente, sin este archivo.
   ============================================================ */

const CACHE_NAME = 'velo-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/chess.js',
  './js/pgn.js',
  './js/engine.js',
  './js/instructor.js',
  './js/storage.js',
  './js/analysis.js',
  './js/app.js',
  './js/worker.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return resp;
      }).catch(() => cached);
    })
  );
});
