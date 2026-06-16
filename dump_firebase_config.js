const admin = require('firebase-admin');
const serviceAccount = require('./fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
    try {
        console.log("🔍 DUMPING KEY NODES...");
        
        // Check global_settings
        const gsSnap = await db.ref('global_settings').once('value');
        console.log("global_settings:", JSON.stringify(gsSnap.val(), null, 2));

        // Check stats or configuration under fleets
        const fleetsSnap = await db.ref('fleets').limitToFirst(1).once('value');
        const fleets = fleetsSnap.val() || {};
        Object.entries(fleets).forEach(([id, f]) => {
            console.log(`Fleet: ${id}`);
            console.log(`Settings keys:`, Object.keys(f.settings || {}));
            if (f.settings) {
                console.log(`Settings sample:`, JSON.stringify(f.settings, null, 2));
            }
        });
        
        process.exit(0);
    } catch(e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
}

main();
