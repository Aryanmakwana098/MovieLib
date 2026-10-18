/* sw.js */
const CACHE_NAME = 'library-app-cache-v1';
const IMAGE_CACHE = 'library-image-cache-v1';

const STATIC_ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== IMAGE_CACHE) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // TMDB API requests: Network First (fail gracefully if offline)
    if (url.hostname === 'api.themoviedb.org') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return new Response(JSON.stringify({ error: "Offline mode", results: [] }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // TMDB Images: Cache First, then Network
    if (url.hostname === 'image.tmdb.org') {
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                if (cachedResponse) return cachedResponse;
                
                return fetch(event.request).then((networkResponse) => {
                    if (!networkResponse || networkResponse.status !== 200 || (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
                        return networkResponse;
                    }
                    
                    const responseToCache = networkResponse.clone();
                    caches.open(IMAGE_CACHE).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                    
                    return networkResponse;
                }).catch(() => {
                    // Return a blank transparent SVG if image fetch fails offline
                    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" background="#333"></svg>', {
                        headers: { 'Content-Type': 'image/svg+xml' }
                    });
                });
            })
        );
        return;
    }

    // Default static assets: Cache First, then Network
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request);
        })
    );
});