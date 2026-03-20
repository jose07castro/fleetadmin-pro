// Service Worker para FleetAdmin Pro - Soporte offline
const CACHE_NAME = 'fleetadmin-v60';
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

// =============================================
// 🚨 SOS: Listener de mensajes desde el main thread
// Permite disparar notificaciones incluso cuando
// el OS está suspendiendo la pestaña (background)
// =============================================
self.addEventListener('message', event => {
    const msg = event.data;
    if (!msg || msg.type !== 'SOS_ALERT') return;

    console.log('🚨 SW: Mensaje SOS_ALERT recibido del main thread');

    const alertData = msg.alertData || {};
    const typeLabel = alertData.emergencyTypeLabel || alertData.emergencyType || 'Emergencia';
    const title = '🚨 ¡ALERTA SOS!';
    const body = `${alertData.driverName || 'Un conductor'} necesita ayuda\n${typeLabel}\n🚗 ${alertData.vehicleName || 'Vehículo'}`;

    event.waitUntil(
        self.registration.showNotification(title, {
            body: body,
            icon: './assets/icon-192.png',
            badge: './assets/icon-192.png',
            tag: 'sos-bg-' + (alertData.id || Date.now()),
            requireInteraction: true,
            vibrate: [500, 250, 500, 250, 500, 250, 500],
            data: {
                url: self.location.origin || '/',
                alertId: alertData.id,
                mapsUrl: alertData.mapsUrl || null
            },
            actions: alertData.mapsUrl ? [
                { action: 'open-map', title: '📍 Ver Mapa' },
                { action: 'open-app', title: '🚨 Abrir App' }
            ] : [
                { action: 'open-app', title: '🚨 Abrir App' }
            ]
        }).then(() => {
            console.log('🚨 SW: ✅ Notificación SOS de background mostrada');
        }).catch(err => {
            console.error('🚨 SW: ❌ Error mostrando notificación:', err);
        })
    );
});

// =============================================
// 🔔 Push Event (preparado para FCM futuro)
// Si se integra Firebase Cloud Messaging, este
// handler disparará la notificación push real
// =============================================
self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: '🚨 ¡ALERTA SOS!', body: 'Un conductor necesita ayuda' };
    }

    const title = data.title || '🚨 ¡ALERTA SOS!';
    const options = {
        body: data.body || 'Un conductor necesita ayuda',
        icon: './assets/icon-192.png',
        badge: './assets/icon-192.png',
        tag: 'sos-push-' + Date.now(),
        requireInteraction: true,
        vibrate: [500, 250, 500, 250, 500, 250, 500],
        data: {
            url: data.url || self.location.origin || '/',
            alertId: data.alertId || null,
            mapsUrl: data.mapsUrl || null
        }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});
