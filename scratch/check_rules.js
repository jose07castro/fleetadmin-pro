const admin = require('firebase-admin');
const serviceAccount = require('../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
    try {
        console.log("🔍 OBTENIENDO REGLAS DE FIREBASE REALTIME DATABASE EN VIVO...");
        const rules = await db.getRules();
        console.log("=========================================");
        console.log(rules);
        console.log("=========================================");
        process.exit(0);
    } catch(e) {
        console.error("❌ Error obteniendo reglas:", e.message);
        process.exit(1);
    }
}

main();
