// Service Worker para FleetAdmin Pro - Soporte offline
const CACHE_NAME = 'fleetadmin-pro-v110';
const ASSETS = [
    './',
    './index.html?v=110',
    './css/index.css?v=110',
    './css/components.css?v=110',
    './css/modules.css?v=110',
    './js/i18n.js?v=110',
    './js/firebase-config.js?v=110',
    './js/db.js?v=110',
    './js/units.js?v=110',
    './js/auth.js?v=110',
    './js/alerts.js?v=110',
    './js/components.js?v=110',
    './js/router.js?v=110',
    './js/storage.js?v=110',
    './js/modules/login.js?v=110',
    './js/modules/dashboard.js?v=110',
    './js/modules/shifts.js?v=110',
    './js/modules/maintenance.js?v=110',
    './js/modules/vehicles.js?v=110',
    './js/modules/settings.js?v=110',
    './js/modules/community.js?v=110',
    './js/modules/sos.js?v=110',
    './js/modules/announcements.js?v=110',
    './js/whatsapp.js?v=110',
    './js/modules/gps.js?v=110',
    './js/fcm.js?v=110',
    './js/notifications.js?v=110',
    './js/pwa-install.js?v=110',
    './js/ui-settings.js?v=110',
    './js/app.js?v=110',
    './manifest.json?v=110',
    './assets/icon.svg',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/screenshot-login.png',
    './assets/screenshot-dashboard.png'
];

// Instalar: cachear todos los archivos estÃ¡ticos + FORZAR activaciÃ³n inmediata
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    // v110: FORZAR skipWaiting â€” el SW nuevo toma control AL INSTANTE
    self.skipWaiting();
});

// Activar: limpiar cachÃ©s viejas
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: Firebase y API van a red, estÃ¡ticos cache-first
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

    // Archivos estÃ¡ticos: cache-first con fallback a red
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
            // Fallback para navegaciÃ³n
            if (event.request.destination === 'document' || event.request.mode === 'navigate') {
                return caches.match('./index.html?v=110')
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

    // Si el usuario tocÃ³ "Ver Mapa" y tenemos URL de Google Maps
    if (action === 'open-map' && data.mapsUrl) {
        event.waitUntil(clients.openWindow(data.mapsUrl));
        return;
    }

    // Para cualquier otro click/acciÃ³n: abrir/focus la app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Buscar si la app ya estÃ¡ abierta
            for (let client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Si no estÃ¡ abierta, abrir
            if (clients.openWindow) {
                return clients.openWindow(data.url || '/');
            }
        })
    );
});

// =============================================
// ðŸš¨ SOS: Listener de mensajes desde el main thread
// Permite disparar notificaciones incluso cuando
// el OS estÃ¡ suspendiendo la pestaÃ±a (background)
// =============================================
self.addEventListener('message', event => {
    const msg = event.data;
    if (!msg) return;

    // Mensaje del frontend para forzar activaciÃ³n del SW nuevo
    if (msg.type === 'SKIP_WAITING') {
        console.log('ðŸ”„ SW: SKIP_WAITING recibido â€” activando nueva versiÃ³n');
        self.skipWaiting();
        return;
    }

    if (msg.type !== 'SOS_ALERT') return;

    console.log('ðŸš¨ SW: Mensaje SOS_ALERT recibido del main thread');

    const alertData = msg.alertData || {};
    const typeLabel = alertData.emergencyTypeLabel || alertData.emergencyType || 'Emergencia';
    const title = 'ðŸš¨ Â¡ALERTA SOS!';
    const body = `${alertData.driverName || 'Un conductor'} necesita ayuda\n${typeLabel}\nðŸš— ${alertData.vehicleName || 'VehÃ­culo'}`;

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
                { action: 'open-map', title: 'ðŸ“ Ver Mapa' },
                { action: 'open-app', title: 'ðŸš¨ Abrir App' }
            ] : [
                { action: 'open-app', title: 'ðŸš¨ Abrir App' }
            ]
        }).then(() => {
            console.log('ðŸš¨ SW: âœ… NotificaciÃ³n SOS de background mostrada');
        }).catch(err => {
            console.error('ðŸš¨ SW: âŒ Error mostrando notificaciÃ³n:', err);
        })
    );
});

// =============================================
// ðŸ”” Firebase Cloud Messaging (FCM) â€” Service Worker
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

    // Handler para mensajes en background (cuando la app NO estÃ¡ en foreground)
    // FCM invoca esto automÃ¡ticamente para data-only messages
    messaging.onBackgroundMessage((payload) => {
        console.log('ðŸ”” FCM SW: ðŸ“© Background message recibido:', payload);

        const data = payload.data || {};
        const notification = payload.notification || {};

        const title = notification.title || data.title || 'ðŸš¨ Â¡ALERTA SOS!';
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
                { action: 'open-map', title: 'ðŸ“ Ver Mapa' },
                { action: 'open-app', title: 'ðŸš¨ Abrir App' }
            ] : [
                { action: 'open-app', title: 'ðŸš¨ Abrir App' }
            ]
        };

        return self.registration.showNotification(title, options);
    });

    console.log('ðŸ”” FCM SW: âœ… Firebase Messaging inicializado en Service Worker');

} catch (e) {
    console.warn('ðŸ”” FCM SW: âš ï¸ Error inicializando Firebase en SW (push manual sigue funcionando):', e.message);
}

// =============================================
// ðŸ”” Push Event FALLBACK (para push genÃ©ricos sin FCM SDK)
// Si Firebase Messaging SDK maneja el push, este handler
// NO se ejecuta (FCM lo intercepta primero).
// =============================================
self.addEventListener('push', event => {
    // Si Firebase messaging ya manejÃ³ el evento, no hacer nada
    if (event.__handled) return;

    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'ðŸš¨ Â¡ALERTA SOS!', body: 'Un conductor necesita ayuda' };
    }

    console.log('ðŸ”” PUSH FALLBACK: Evento push recibido:', data);

    const title = data.title || data.notification?.title || 'ðŸš¨ Â¡ALERTA SOS!';
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
            { action: 'open-map', title: 'ðŸ“ Ver Mapa' },
            { action: 'open-app', title: 'ðŸš¨ Abrir App' }
        ] : [
            { action: 'open-app', title: 'ðŸš¨ Abrir App' }
        ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});


