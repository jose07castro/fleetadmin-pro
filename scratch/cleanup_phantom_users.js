const admin = require('firebase-admin');
const serviceAccount = require('../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
  });
}

const db = admin.database();

async function main() {
    try {
        const fleetId = "-OnPd8HaV1VZWBnYQQX7";
        const snap = await db.ref(`fleets/${fleetId}/users`).once('value');
        const users = snap.val() || {};
        
        console.log(`=== STARTING CLEANUP FOR FLEET ${fleetId} ===`);
        let deletedCount = 0;
        
        for (const [id, u] of Object.entries(users)) {
            if (!u.name && !u.role && u.appVersion) {
                console.log(`🗑️ Deleting phantom user node: ${id} (${JSON.stringify(u)})`);
                await db.ref(`fleets/${fleetId}/users/${id}`).remove();
                deletedCount++;
            }
        }
        
        console.log(`=== CLEANUP FINISHED: Deleted ${deletedCount} phantom nodes ===`);
        process.exit(0);
    } catch (e) {
        console.error("Error during cleanup:", e);
        process.exit(1);
    }
}

main();
