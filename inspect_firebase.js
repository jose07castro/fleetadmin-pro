const admin = require('firebase-admin');
const serviceAccount = require('./fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
    try {
        console.log("🔍 LISTANDO CLAVES DEL REPOSITORIO DE FIREBASE (ROOT)...");
        const rootSnap = await db.ref().once('value');
        const rootVal = rootSnap.val() || {};
        
        console.log("Claves raíz:");
        Object.keys(rootVal).forEach(key => {
            console.log(`- ${key}`);
        });
        
        // Si hay una clave de status del bot o similar, imprimirla
        if (rootVal.bot_status) {
            console.log("\n🤖 BOT STATUS:", JSON.stringify(rootVal.bot_status, null, 2));
        }
        if (rootVal.bot_alerts) {
            const count = Object.keys(rootVal.bot_alerts).length;
            console.log(`\n🤖 BOT ALERTS (Diagnóstico): ${count} alertas en historial.`);
            // Mostrar las últimas 3 alertas de diagnóstico del bot
            const alerts = Object.entries(rootVal.bot_alerts).slice(-3);
            alerts.forEach(([id, a]) => {
                console.log(`  - [${new Date(a.timestamp).toLocaleString()}] Group: ${a.group} | Text: "${a.text}"`);
            });
        }
        
        process.exit(0);
    } catch(e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
}

main();
