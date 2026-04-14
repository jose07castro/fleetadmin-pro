importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCc9FJiqwDUglN0vd9VXZndDBRsxJGDfuI",
  projectId: "fleetadmin-pro",
  messagingSenderId: "289124272326",
  appId: "1:289124272326:web:b3d31d7d72c929e54e2fc7"
});

const messaging = firebase.messaging();

// Este es el vigía que despierta al celular cuando llega una alerta
messaging.onBackgroundMessage((payload) => {
  console.log('Alerta recibida en segundo plano:', payload);
  
  const notificationTitle = payload.notification.title || "Alerta de Flota";
  const notificationOptions = {
    body: payload.notification.body || "Revisá la aplicación para más detalles.",
    icon: '/favicon.ico' // O la ruta de tu logo
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});