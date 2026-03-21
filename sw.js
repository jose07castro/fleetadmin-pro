// Service Worker para FleetAdmin Pro - Soporte offline
const CACHE_NAME = 'fleetadmin-v62';
const ASSETS = [
    './',
    './index.html?v=60',
    './css/index.css?v=60',
    './css/components.css?v=60',
    './css/modules.css?v=60',
    './js/i18n.js?v=60',
    './js/firebase-config.js?v=60',
    './js/db.js?v=60',
    './js/units.js?v=60',
    './js/auth.js?v=60',
    './js/alerts.js?v=60',
    './js/components.js?v=60',
    './js/router.js?v=60',
    './js/modules/login.js?v=60',
    './js/modules/dashboard.js?v=60',
    './js/modules/shifts.js?v=60',
    './js/modules/maintenance.js?v=60',
    './js/modules/vehicles.js?v=60',
    './js/modules/settings.js?v=60',
    './js/modules/community.js?v=60',
    './js/modules/sos.js?v=60',
    './js/whatsapp.js?v=60',
    './js/storage.js?v=60',
    './js/modules/gps.js?v=60',
    './js/fcm.js?v=60',
    './js/notifications.js?v=60',
    './js/pwa-install.js?v=61',
    './js/app.js?v=60',
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
                return caches.match('./index.html?v=60')
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
// 🔔 Firebase Cloud Messaging (FCM) — Service Worker
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

    // Handler para mensajes en background (cuando la app NO está en foreground)
    // FCM invoca esto automáticamente para data-only messages
    messaging.onBackgroundMessage((payload) => {
        console.log('🔔 FCM SW: 📩 Background message recibido:', payload);

        const data = payload.data || {};
        const notification = payload.notification || {};

        const title = notification.title || data.title || '🚨 ¡ALERTA SOS!';
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
                { action: 'open-map', title: '📍 Ver Mapa' },
                { action: 'open-app', title: '🚨 Abrir App' }
            ] : [
                { action: 'open-app', title: '🚨 Abrir App' }
            ]
        };

        return self.registration.showNotification(title, options);
    });

    console.log('🔔 FCM SW: ✅ Firebase Messaging inicializado en Service Worker');

} catch (e) {
    console.warn('🔔 FCM SW: ⚠️ Error inicializando Firebase en SW (push manual sigue funcionando):', e.message);
}

// =============================================
// 🔔 Push Event FALLBACK (para push genéricos sin FCM SDK)
// Si Firebase Messaging SDK maneja el push, este handler
// NO se ejecuta (FCM lo intercepta primero).
// =============================================
self.addEventListener('push', event => {
    // Si Firebase messaging ya manejó el evento, no hacer nada
    if (event.__handled) return;

    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: '🚨 ¡ALERTA SOS!', body: 'Un conductor necesita ayuda' };
    }

    console.log('🔔 PUSH FALLBACK: Evento push recibido:', data);

    const title = data.title || data.notification?.title || '🚨 ¡ALERTA SOS!';
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
            { action: 'open-map', title: '📍 Ver Mapa' },
            { action: 'open-app', title: '🚨 Abrir App' }
        ] : [
            { action: 'open-app', title: '🚨 Abrir App' }
        ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

