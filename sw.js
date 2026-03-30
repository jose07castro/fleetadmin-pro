// Service Worker para FleetAdmin Pro - Soporte offline
const CACHE_NAME = 'fleetadmin-pro-v112';
const ASSETS = [
    './',
    './index.html?v=112',
    './css/index.css?v=112',
    './css/components.css?v=112',
    './css/modules.css?v=112',
    './js/i18n.js?v=112',
    './js/firebase-config.js?v=112',
    './js/db.js?v=112',
    './js/units.js?v=112',
    './js/auth.js?v=112',
    './js/alerts.js?v=112',
    './js/components.js?v=112',
    './js/router.js?v=112',
    './js/storage.js?v=112',
    './js/modules/login.js?v=112',
    './js/modules/dashboard.js?v=112',
    './js/modules/shifts.js?v=112',
    './js/modules/maintenance.js?v=112',
    './js/modules/vehicles.js?v=112',
    './js/modules/settings.js?v=112',
    './js/modules/community.js?v=112',
    './js/modules/sos.js?v=112',
    './js/modules/announcements.js?v=112',
    './js/whatsapp.js?v=112',
    './js/modules/gps.js?v=112',
    './js/fcm.js?v=112',
    './js/notifications.js?v=112',
    './js/pwa-install.js?v=112',
    './js/ui-settings.js?v=112',
    './js/modules/radar.js?v=112',
    './js/gps-permissions.js?v=112',
    './js/app.js?v=112',
    './manifest.json?v=112',
    './assets/icon.svg',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/screenshot-login.png',
    './assets/screenshot-dashboard.png'
];

// Instalar: cachear todos los archivos estÃƒÂ¡ticos + FORZAR activaciÃƒÂ³n inmediata
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    // v111: FORZAR skipWaiting Ã¢â‚¬â€ el SW nuevo toma control AL INSTANTE
    self.skipWaiting();
});

// Activar: limpiar cachÃƒÂ©s viejas
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch: Firebase y API van a red, estÃƒÂ¡ticos cache-first
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

    // Archivos estÃƒÂ¡ticos: cache-first con fallback a red
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
            // Fallback para navegaciÃƒÂ³n
            if (event.request.destination === 'document' || event.request.mode === 'navigate') {
                return caches.match('./index.html?v=112')
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

    // Si el usuario tocÃƒÂ³ "Ver Mapa" y tenemos URL de Google Maps
    if (action === 'open-map' && data.mapsUrl) {
        event.waitUntil(clients.openWindow(data.mapsUrl));
        return;
    }

    // Para cualquier otro click/acciÃƒÂ³n: abrir/focus la app
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Buscar si la app ya estÃƒÂ¡ abierta
            for (let client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            // Si no estÃƒÂ¡ abierta, abrir
            if (clients.openWindow) {
                return clients.openWindow(data.url || '/');
            }
        })
    );
});

// =============================================
// Ã°Å¸Å¡Â¨ SOS: Listener de mensajes desde el main thread
// Permite disparar notificaciones incluso cuando
// el OS estÃƒÂ¡ suspendiendo la pestaÃƒÂ±a (background)
// =============================================
self.addEventListener('message', event => {
    const msg = event.data;
    if (!msg) return;

    // Mensaje del frontend para forzar activaciÃƒÂ³n del SW nuevo
    if (msg.type === 'SKIP_WAITING') {
        console.log('Ã°Å¸â€â€ž SW: SKIP_WAITING recibido Ã¢â‚¬â€ activando nueva versiÃƒÂ³n');
        self.skipWaiting();
        return;
    }

    if (msg.type !== 'SOS_ALERT') return;

    console.log('Ã°Å¸Å¡Â¨ SW: Mensaje SOS_ALERT recibido del main thread');

    const alertData = msg.alertData || {};
    const typeLabel = alertData.emergencyTypeLabel || alertData.emergencyType || 'Emergencia';
    const title = 'Ã°Å¸Å¡Â¨ Ã‚Â¡ALERTA SOS!';
    const body = `${alertData.driverName || 'Un conductor'} necesita ayuda\n${typeLabel}\nÃ°Å¸Å¡â€” ${alertData.vehicleName || 'VehÃƒÂ­culo'}`;

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
                { action: 'open-map', title: 'Ã°Å¸â€œÂ Ver Mapa' },
                { action: 'open-app', title: 'Ã°Å¸Å¡Â¨ Abrir App' }
            ] : [
                { action: 'open-app', title: 'Ã°Å¸Å¡Â¨ Abrir App' }
            ]
        }).then(() => {
            console.log('Ã°Å¸Å¡Â¨ SW: Ã¢Å“â€¦ NotificaciÃƒÂ³n SOS de background mostrada');
        }).catch(err => {
            console.error('Ã°Å¸Å¡Â¨ SW: Ã¢ÂÅ’ Error mostrando notificaciÃƒÂ³n:', err);
        })
    );
});

// =============================================
// Ã°Å¸â€â€ Firebase Cloud Messaging (FCM) Ã¢â‚¬â€ Service Worker
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

    // Handler para mensajes en background (cuando la app NO estÃƒÂ¡ en foreground)
    // FCM invoca esto automÃƒÂ¡ticamente para data-only messages
    messaging.onBackgroundMessage((payload) => {
        console.log('Ã°Å¸â€â€ FCM SW: Ã°Å¸â€œÂ© Background message recibido:', payload);

        const data = payload.data || {};
        const notification = payload.notification || {};

        const title = notification.title || data.title || 'Ã°Å¸Å¡Â¨ Ã‚Â¡ALERTA SOS!';
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
                { action: 'open-map', title: 'Ã°Å¸â€œÂ Ver Mapa' },
                { action: 'open-app', title: 'Ã°Å¸Å¡Â¨ Abrir App' }
            ] : [
                { action: 'open-app', title: 'Ã°Å¸Å¡Â¨ Abrir App' }
            ]
        };

        return self.registration.showNotification(title, options);
    });

    console.log('Ã°Å¸â€â€ FCM SW: Ã¢Å“â€¦ Firebase Messaging inicializado en Service Worker');

} catch (e) {
    console.warn('Ã°Å¸â€â€ FCM SW: Ã¢Å¡Â Ã¯Â¸Â Error inicializando Firebase en SW (push manual sigue funcionando):', e.message);
}

// =============================================
// Ã°Å¸â€â€ Push Event FALLBACK (para push genÃƒÂ©ricos sin FCM SDK)
// Si Firebase Messaging SDK maneja el push, este handler
// NO se ejecuta (FCM lo intercepta primero).
// =============================================
self.addEventListener('push', event => {
    // Si Firebase messaging ya manejÃƒÂ³ el evento, no hacer nada
    if (event.__handled) return;

    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'Ã°Å¸Å¡Â¨ Ã‚Â¡ALERTA SOS!', body: 'Un conductor necesita ayuda' };
    }

    console.log('Ã°Å¸â€â€ PUSH FALLBACK: Evento push recibido:', data);

    const title = data.title || data.notification?.title || 'Ã°Å¸Å¡Â¨ Ã‚Â¡ALERTA SOS!';
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
            { action: 'open-map', title: 'Ã°Å¸â€œÂ Ver Mapa' },
            { action: 'open-app', title: 'Ã°Å¸Å¡Â¨ Abrir App' }
        ] : [
            { action: 'open-app', title: 'Ã°Å¸Å¡Â¨ Abrir App' }
        ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});




