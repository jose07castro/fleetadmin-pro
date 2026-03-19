// Service Worker para FleetAdmin Pro - Soporte offline
const CACHE_NAME = 'fleetadmin-v59';
const ASSETS = [
    './',
    './index.html?v=59',
    './css/index.css?v=59',
    './css/components.css?v=59',
    './css/modules.css?v=59',
    './js/i18n.js?v=59',
    './js/firebase-config.js?v=59',
    './js/db.js?v=59',
    './js/units.js?v=59',
    './js/auth.js?v=59',
    './js/alerts.js?v=59',
    './js/components.js?v=59',
    './js/router.js?v=59',
    './js/modules/login.js?v=59',
    './js/modules/dashboard.js?v=59',
    './js/modules/shifts.js?v=59',
    './js/modules/maintenance.js?v=59',
    './js/modules/vehicles.js?v=59',
    './js/modules/settings.js?v=59',
    './js/modules/community.js?v=59',
    './js/modules/sos.js?v=59',
    './js/whatsapp.js?v=59',
    './js/storage.js?v=59',
    './js/modules/gps.js?v=59',
    './js/notifications.js?v=59',
    './js/app.js?v=59',
    './manifest.json?v=59',
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
                return caches.match('./index.html?v=57')
                    .then(res => res || caches.match('./index.html'))
                    .then(res => res || caches.match('./'));
            }
            return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        })
    );
});

// Manejo de clicks en notificaciones SOS
self.addEventListener('notificationclick', event => {
    event.notification.close();

    const data = event.notification.data || {};
    const action = event.action;

    // Si el usuario tocó "Ver Mapa" y tenemos URL de Google Maps
    if (action === 'open-map' && data.mapsUrl) {
        event.waitUntil(clients.openWindow(data.mapsUrl));
        return;
    }

    // Para cualquier otro click/acción: abrir/focus la app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Buscar si la app ya está abierta
            for (let client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Si no está abierta, abrir
            if (clients.openWindow) {
                return clients.openWindow(data.url || '/');
            }
        })
    );
});
