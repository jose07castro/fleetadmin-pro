// Service Worker para FleetAdmin Pro - Soporte offline
const CACHE_NAME = 'fleetadmin-pro-v118';
const ASSETS = [
    './',
    './index.html?v=118',
    './css/index.css?v=118',
    './css/components.css?v=118',
    './css/modules.css?v=118',
    './js/i18n.js?v=118',
    './js/firebase-config.js?v=118',
    './js/db.js?v=118',
    './js/units.js?v=118',
    './js/auth.js?v=118',
    './js/alerts.js?v=118',
    './js/components.js?v=118',
    './js/router.js?v=118',
    './js/storage.js?v=118',
    './js/modules/login.js?v=118',
    './js/modules/dashboard.js?v=118',
    './js/modules/shifts.js?v=118',
    './js/modules/maintenance.js?v=118',
    './js/modules/vehicles.js?v=118',
    './js/modules/settings.js?v=118',
    './js/modules/community.js?v=118',
    './js/modules/sos.js?v=118',
    './js/modules/announcements.js?v=118',
    './js/whatsapp.js?v=118',
    './js/modules/gps.js?v=118',
    './js/fcm.js?v=118',
    './js/notifications.js?v=118',
    './js/pwa-install.js?v=118',
    './js/ui-settings.js?v=118',
    './js/modules/radar.js?v=118',
    './js/gps-permissions.js?v=118',
    './js/app.js?v=118',
    './manifest.json?v=118',
    './assets/icon.svg',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/screenshot-login.png',
    './assets/screenshot-dashboard.png'
];

// Instalar: cachear todos los archivos estÃƒÆ’Ã‚Â¡ticos + FORZAR activaciÃƒÆ’Ã‚Â³n inmediata
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    // v111: FORZAR skipWaiting ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â el SW nuevo toma control AL INSTANTE
    self.skipWaiting();
});

// Activar: limpiar cachÃƒÆ’Ã‚Â©s viejas
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: Firebase y API van a red, estÃƒÆ’Ã‚Â¡ticos cache-first
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

    // Archivos estÃƒÆ’Ã‚Â¡ticos: cache-first con fallback a red
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
            // Fallback para navegaciÃƒÆ’Ã‚Â³n
            if (event.request.destination === 'document' || event.request.mode === 'navigate') {
                return caches.match('./index.html?v=118')
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

    // Si el usuario tocÃƒÆ’Ã‚Â³ "Ver Mapa" y tenemos URL de Google Maps
    if (action === 'open-map' && data.mapsUrl) {
        event.waitUntil(clients.openWindow(data.mapsUrl));
        return;
    }

    // Para cualquier otro click/acciÃƒÆ’Ã‚Â³n: abrir/focus la app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Buscar si la app ya estÃƒÆ’Ã‚Â¡ abierta
            for (let client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Si no estÃƒÆ’Ã‚Â¡ abierta, abrir
            if (clients.openWindow) {
                return clients.openWindow(data.url || '/');
            }
        })
    );
});

// =============================================
// ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ SOS: Listener de mensajes desde el main thread
// Permite disparar notificaciones incluso cuando
// el OS estÃƒÆ’Ã‚Â¡ suspendiendo la pestaÃƒÆ’Ã‚Â±a (background)
// =============================================
self.addEventListener('message', event => {
    const msg = event.data;
    if (!msg) return;

    // Mensaje del frontend para forzar activaciÃƒÆ’Ã‚Â³n del SW nuevo
    if (msg.type === 'SKIP_WAITING') {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾ SW: SKIP_WAITING recibido ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â activando nueva versiÃƒÆ’Ã‚Â³n');
        self.skipWaiting();
        return;
    }

    if (msg.type !== 'SOS_ALERT') return;

    console.log('ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ SW: Mensaje SOS_ALERT recibido del main thread');

    const alertData = msg.alertData || {};
    const typeLabel = alertData.emergencyTypeLabel || alertData.emergencyType || 'Emergencia';
    const title = 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Ãƒâ€šÃ‚Â¡ALERTA SOS!';
    const body = `${alertData.driverName || 'Un conductor'} necesita ayuda\n${typeLabel}\nÃƒÂ°Ã…Â¸Ã…Â¡Ã¢â‚¬â€ ${alertData.vehicleName || 'VehÃƒÆ’Ã‚Â­culo'}`;

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
                { action: 'open-map', title: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Ver Mapa' },
                { action: 'open-app', title: 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Abrir App' }
            ] : [
                { action: 'open-app', title: 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Abrir App' }
            ]
        }).then(() => {
            console.log('ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ SW: ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ NotificaciÃƒÆ’Ã‚Â³n SOS de background mostrada');
        }).catch(err => {
            console.error('ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ SW: ÃƒÂ¢Ã‚ÂÃ…â€™ Error mostrando notificaciÃƒÆ’Ã‚Â³n:', err);
        })
    );
});

// =============================================
// ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Â Firebase Cloud Messaging (FCM) ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Service Worker
// Importar Firebase SDKs para manejar push en background
// =============================================
try {
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

    firebase.initializeApp({
        apiKey: "AIzaSyCc9FJIqwDUglnOvd9VXZndDBRsxJGDfuI",
        authDomain: "fleetadmin-pro.firebaseapp.com",
        databaseURL: "https://fleetadmin-pro-default-rtdb.firebaseio.com",
        projectId: "fleetadmin-pro",
        storageBucket: "fleetadmin-pro.firebasestorage.app",
        messagingSenderId: "289124272326",
        appId: "1:289124272326:web:b3d31d7d72c929e54e2fc7"
    });

    const messaging = firebase.messaging();

    // Handler para mensajes en background (cuando la app NO estÃƒÆ’Ã‚Â¡ en foreground)
    // FCM invoca esto automÃƒÆ’Ã‚Â¡ticamente para data-only messages
    messaging.onBackgroundMessage((payload) => {
        console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Â FCM SW: ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â© Background message recibido:', payload);

        const data = payload.data || {};
        const notification = payload.notification || {};

        const title = notification.title || data.title || 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Ãƒâ€šÃ‚Â¡ALERTA SOS!';
        const body = notification.body || data.body || 'Un conductor necesita ayuda inmediata.';

        const options = {
            body: body,
            icon: './assets/icon-192.png',
            badge: './assets/icon-192.png',
            tag: 'sos-fcm-' + (data.alertId || Date.now()),
            requireInteraction: true,
            vibrate: [500, 250, 500, 250, 500, 250, 500],
            data: {
                url: data.url || self.location.origin || '/',
                alertId: data.alertId || null,
                mapsUrl: data.mapsUrl || null
            },
            actions: data.mapsUrl ? [
                { action: 'open-map', title: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Ver Mapa' },
                { action: 'open-app', title: 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Abrir App' }
            ] : [
                { action: 'open-app', title: 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Abrir App' }
            ]
        };

        return self.registration.showNotification(title, options);
    });

    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Â FCM SW: ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ Firebase Messaging inicializado en Service Worker');

} catch (e) {
    console.warn('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Â FCM SW: ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Error inicializando Firebase en SW (push manual sigue funcionando):', e.message);
}

// =============================================
// ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Â Push Event FALLBACK (para push genÃƒÆ’Ã‚Â©ricos sin FCM SDK)
// Si Firebase Messaging SDK maneja el push, este handler
// NO se ejecuta (FCM lo intercepta primero).
// =============================================
self.addEventListener('push', event => {
    // Si Firebase messaging ya manejÃƒÆ’Ã‚Â³ el evento, no hacer nada
    if (event.__handled) return;

    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Ãƒâ€šÃ‚Â¡ALERTA SOS!', body: 'Un conductor necesita ayuda' };
    }

    console.log('ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Â PUSH FALLBACK: Evento push recibido:', data);

    const title = data.title || data.notification?.title || 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Ãƒâ€šÃ‚Â¡ALERTA SOS!';
    const body = data.body || data.notification?.body || 'Un conductor necesita ayuda inmediata.';
    const pushData = data.data || data;

    const options = {
        body: body,
        icon: './assets/icon-192.png',
        badge: './assets/icon-192.png',
        tag: 'sos-push-' + (pushData.alertId || Date.now()),
        requireInteraction: true,
        vibrate: [500, 250, 500, 250, 500, 250, 500],
        data: {
            url: pushData.url || self.location.origin || '/',
            alertId: pushData.alertId || null,
            mapsUrl: pushData.mapsUrl || null
        },
        actions: pushData.mapsUrl ? [
            { action: 'open-map', title: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â Ver Mapa' },
            { action: 'open-app', title: 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Abrir App' }
        ] : [
            { action: 'open-app', title: 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã‚Â¨ Abrir App' }
        ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});










