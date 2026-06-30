const CACHE_NAME = 'directional-explorer-v7';
const ASSETS = [
    './manifest.json',
    './icon.svg',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon-180.png',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js'
];

self.addEventListener('install', event => {
    self.skipWaiting(); // Force the new service worker to activate immediately
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;

    // Navigations (the HTML shell): always fetch fresh, never from any cache,
    // so a redeploy is picked up on the next load. Fall back to cache offline.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req, { cache: 'no-store' }).catch(() => caches.match(req))
        );
        return;
    }

    // Everything else: network-first so updates apply immediately.
    event.respondWith(
        fetch(req).catch(() => caches.match(req))
    );
});
