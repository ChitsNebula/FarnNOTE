// FarmNotes Service Worker — Network-First with Offline Cache Fallback
const CACHE_NAME = 'farmnotes-cache-v2.13.14';
const STATIC_ASSETS = [
  './',
  './index.html',
  'css/reset.css?v=2.13.14',
  'css/theme.css?v=2.13.14',
  'css/library.css?v=2.13.14',
  'css/editor.css?v=2.13.14',
  'js/tools.js?v=2.13.14',
  'js/storage.js?v=2.13.14',
  'js/canvas.js?v=2.13.14',
  'js/pdf.js?v=2.13.14',
  'js/classroom.js?v=2.13.14',
  'js/library.js?v=2.13.14',
  'js/editor.js?v=2.13.14',
  'js/app.js?v=2.13.14',
  'icon-192.png',
  'icon-512.png',
  'manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Some assets could not be precached:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only intercept GET requests on http/https
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  // Network-first for application files so updates reflect immediately
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Fallback to cache when offline
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
      })
  );
});
