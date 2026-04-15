importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyCc9FJiqwDUglN0vd9VXZndDBRsxJGDfuI",
  projectId: "fleetadmin-pro",
  messagingSenderId: "289124272326",
  appId: "1:289124272326:web:b3d31d7d72c929e54e2fc7"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico'
  };
  return self.registration.showNotification(notificationTitle, notificationOptions);
});