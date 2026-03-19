// Service Worker para FleetAdmin Pro - Soporte offline
const CACHE_NAME = 'fleetadmin-v49';
const ASSETS = [
    './',
    './index.html?v=49',
    './css/index.css?v=49',
    './css/components.css?v=49',
    './css/modules.css?v=49',
    './js/i18n.js?v=49',
    './js/firebase-config.js?v=49',
    './js/db.js?v=49',
    './js/units.js?v=49',
    './js/auth.js?v=49',
    './js/alerts.js?v=49',
    './js/components.js?v=49',
    './js/router.js?v=49',
    './js/modules/login.js?v=49',
    './js/modules/dashboard.js?v=49',
    './js/modules/shifts.js?v=49',
    './js/modules/maintenance.js?v=49',
    './js/modules/vehicles.js?v=49',
    './js/modules/settings.js?v=49',
    './js/modules/community.js?v=49',
    './js/modules/sos.js?v=49',
    './js/whatsapp.js?v=49',
    './js/storage.js?v=49',
    './js/modules/gps.js?v=49',
    './js/notifications.js?v=49',
    './js/app.js?v=49',
    './manifest.json?v=49',
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

            // Promise race manual para timeout de fetch (10 segundos)
            const fetchPromise = fetch(event.request).then(response => {
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                if (event.request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });

            // Evitar esperas infinitas en Android
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => reject(new Error('Timeout')), 10000);
                fetchPromise.then(res => {
                    clearTimeout(timeoutId);
                    resolve(res);
                }).catch(err => {
                    clearTimeout(timeoutId);
                    reject(err);
                });
            });

        }).catch(() => {
            // Fallback para navegación
            if (event.request.destination === 'document' || event.request.mode === 'navigate') {
                return caches.match('./index.html?v=49')
                    .then(res => res || caches.match('./index.html'))
                    .then(res => res || caches.match('./'));
            }
            return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        })
    );
});

// Manejo de clicks en notificaciones
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (let client of windowClients) {
                // Si la app ya está abierta, hacer foco
                if (client.url === event.notification.data.url && 'focus' in client) {
                    return client.focus();
                }
            }
            // Si la app está cerrada, abrirla
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url || '/');
            }
        })
    );
});
