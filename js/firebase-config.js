/* ============================================
   FleetAdmin Pro — Firebase Configuration
   Realtime Database for cross-device sync
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

console.log('🔥 Firebase inicializado correctamente');
