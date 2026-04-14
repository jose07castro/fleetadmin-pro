/* ============================================
   FleetAdmin Pro — Firebase Configuration
   Realtime Database for cross-device sync
   Auth with LOCAL persistence for PWA resilience
   ============================================ */

const firebaseConfig = {
    apiKey: "AIzaSyCc9FJIqwDUglnOvd9VXZndDBRsxJGDfuI",
    authDomain: "fleetadmin-pro.firebaseapp.com",
    databaseURL: "https://fleetadmin-pro-default-rtdb.firebaseio.com",
    projectId: "fleetadmin-pro",
    storageBucket: "fleetadmin-pro.firebasestorage.app",
    messagingSenderId: "289124272326",
    appId: "1:289124272326:web:b3d31d7d72c929e54e2fc7"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const firebaseDB = firebase.database();
const firebaseStorage = firebase.storage();

// Forzar persistencia LOCAL en Firebase Auth (sobrevive background kill en PWA/Android)
// Esto asegura que firebase.auth().currentUser se restaure desde IndexedDB del navegador
try {
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .then(() => console.log('🔐 Firebase Auth: persistencia LOCAL activada'))
        .catch(e => console.warn('🔐 Firebase Auth: error seteando persistencia:', e));
} catch (e) {
    console.warn('🔐 Firebase Auth: setPersistence no disponible:', e);
}

console.log('🔥 Firebase inicializado correctamente (DB + Storage + Auth)');

