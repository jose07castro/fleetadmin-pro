const admin = require('firebase-admin');
const serviceAccount = require('../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
    try {
        console.log("🔍 COUNTING ALERTS BY GROUP...");
        const snap = await db.ref('bot_alerts').once('value');
        const alerts = snap.val() || {};
        
        const counts = {};
        Object.values(alerts).forEach(a => {
            const grp = a.group || 'Unknown';
            counts[grp] = (counts[grp] || 0) + 1;
        });
        
        console.log("Group Counts:", counts);
        process.exit(0);
    } catch(e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
}

main();
