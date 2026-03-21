// Firebase Messaging Service Worker
// Chrome requires this file at /firebase-messaging-sw.js for background push handling.
// This coexists with the main sw.js — Chrome's FCM SDK specifically looks for this file.

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

// Handle background messages (when app is NOT in foreground)
messaging.onBackgroundMessage((payload) => {
    console.log('🔔 firebase-messaging-sw.js: Background message recibido:', payload);

    const data = payload.data || {};
    const notification = payload.notification || {};

    const title = notification.title || data.title || '🚨 ¡ALERTA SOS!';
    const body = notification.body || data.body || 'Un conductor necesita ayuda inmediata.';

    const options = {
        body: body,
        icon: './assets/icon-192.png',
        badge: './assets/icon-192.png',
        tag: 'sos-fcm-bg-' + (data.alertId || Date.now()),
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

// Handle notification clicks
self.addEventListener('notificationclick', event => {
    event.notification.close();

    const data = event.notification.data || {};
    const action = event.action;

    if (action === 'open-map' && data.mapsUrl) {
        event.waitUntil(clients.openWindow(data.mapsUrl));
        return;
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (let client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(data.url || '/');
            }
        })
    );
});

console.log('🔔 firebase-messaging-sw.js: ✅ Inicializado correctamente');
