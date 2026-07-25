const admin = require('firebase-admin');
const serviceAccount = require('../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
    try {
        const query = 'AC7C262A1E46D66B0A8BE208FEAF85C4';
        console.log("🔍 SEARCHING DATABASE FOR ID:", query);
        
        // Let's search all keys under fleets
        const fleetsSnap = await db.ref('fleets').once('value');
        const fleets = fleetsSnap.val() || {};
        
        Object.entries(fleets).forEach(([fid, f]) => {
            const alerts = f.traffic_alerts || {};
            Object.entries(alerts).forEach(([aid, a]) => {
                if (aid.includes(query) || (a.originalText && a.originalText.includes(query)) || (a.audioUrl && a.audioUrl.includes(query))) {
                    console.log(`[FLEET ${fid}] Alert ID: ${aid} | Group: "${a.authorName}" | Text: "${a.originalText}" | Loc: "${a.location}" | AudioUrl: "${a.audioUrl}"`);
                }
            });
        });

        // Let's also check global_traffic_alerts
        const globalSnap = await db.ref('global_traffic_alerts').once('value');
        const globals = globalSnap.val() || {};
        Object.entries(globals).forEach(([aid, a]) => {
            if (aid.includes(query) || (a.originalText && a.originalText.includes(query)) || (a.audioUrl && a.audioUrl.includes(query))) {
                console.log(`[GLOBAL] Alert ID: ${aid} | Group: "${a.authorName}" | Text: "${a.originalText}" | Loc: "${a.location}" | AudioUrl: "${a.audioUrl}"`);
            }
        });

        process.exit(0);
    } catch(e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
}

main();
