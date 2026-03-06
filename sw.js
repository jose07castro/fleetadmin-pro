// Service Worker para FleetAdmin Pro - Soporte offline
const CACHE_NAME = 'fleetadmin-v11';
const ASSETS = [
    './',
    './index.html?v=11',
    './css/index.css?v=11',
    './css/components.css?v=11',
    './css/modules.css?v=11',
    './js/i18n.js?v=11',
    './js/firebase-config.js?v=11',
    './js/db.js?v=11',
    './js/units.js?v=11',
    './js/auth.js?v=11',
    './js/alerts.js?v=11',
    './js/components.js?v=11',
    './js/router.js?v=11',
    './js/modules/login.js?v=11',
    './js/modules/dashboard.js?v=11',
    './js/modules/shifts.js?v=11',
    './js/modules/maintenance.js?v=11',
    './js/modules/vehicles.js?v=11',
    './js/modules/settings.js?v=11',
    './js/app.js?v=11',
    './manifest.json?v=11',
    './assets/icon.svg',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/screenshot-login.png',
    './assets/screenshot-dashboard.png'
];

// Instalar: cachear todos los archivos estáticos
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Activar: limpiar cachés viejas
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: Firebase y API van a red, estáticos cache-first
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Firebase Realtime Database - SIEMPRE va a la red
    if (url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('firebasedatabase.app') ||
        url.hostname.includes('gstatic.com')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Las llamadas a /api/ SIEMPRE van a la red (legacy)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Archivos estáticos: cache-first con fallback a red
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                if (event.request.method !== 'GET') return response;
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            });
        }).catch(() => {
            if (event.request.destination === 'document') {
                return caches.match('./index.html?v=11').then(res => res || caches.match('./index.html'));
            }
        })
    );
});
