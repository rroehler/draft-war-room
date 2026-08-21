const CACHE_NAME = 'draft-war-room-v0.18.5';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles.css',
  './layout.css',
  './quick-select.css',
  './app.js',
  './layout.js',
  './turn-awareness.js',
  './players-sort.js',
  './draft-intelligence.js',
  './config.js',
  './ai-engine.js',
  './draft-simulator.js',
  './draft-recap.js',
  './toolbar-menu.js',
  './decision-tree.js',
  './pwa.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('draft-war-room-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Do not intercept Chat/API calls or any other cross-origin traffic.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            // Store without volatile cache-busting query strings.
            const cleanUrl = new URL(request.url);
            cleanUrl.search = '';
            cache.put(new Request(cleanUrl.toString()), copy);
          });
        }

        return response;
      })
      .catch(async () => {
        const cleanUrl = new URL(request.url);
        cleanUrl.search = '';

        const cached =
          await caches.match(new Request(cleanUrl.toString())) ||
          await caches.match(request, { ignoreSearch: true });

        if (cached) return cached;

        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }

        throw new Error('Offline and resource not cached.');
      })
  );
});
