const admin = require('firebase-admin');
const serviceAccount = require('../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
    try {
        console.log("🔍 SEARCHING FOR ANY ALERTS WITH AUDIOS IN DATABASE...");
        
        // 1. global_traffic_alerts
        const globalSnap = await db.ref('global_traffic_alerts').once('value');
        const globals = globalSnap.val() || {};
        console.log("Total global alerts:", Object.keys(globals).length);
        Object.entries(globals).forEach(([id, a]) => {
            if (a.audioUrl) {
                console.log(`[GLOBAL] ID: ${id} | Time: ${new Date(a.timestamp).toLocaleString()} | Group: "${a.authorName}" | AudioUrl: "${a.audioUrl}" | OriginalText: "${a.originalText}"`);
            }
        });

        // 2. bot_alerts (Gemini logs)
        const botSnap = await db.ref('bot_alerts').once('value');
        const bots = botSnap.val() || {};
        console.log("Total bot alerts:", Object.keys(bots).length);
        Object.entries(bots).forEach(([id, a]) => {
            if (a.text && (a.text.includes('[REPORTE') || a.text.includes('audio') || a.text.includes('Voz') || a.text.includes('VOZ'))) {
                console.log(`[BOT_ALERT] ID: ${id} | Group: "${a.group}" | Text: "${a.text}" | Analysis: ${JSON.stringify(a.analysis)}`);
            }
        });
        
        process.exit(0);
    } catch(e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
}

main();
