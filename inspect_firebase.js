const admin = require('firebase-admin');
const serviceAccount = require('./fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
    try {
        console.log("🔍 BUSCANDO DATOS DE VALERIA...");
        
        const globalSnap = await db.ref('globalUsers').once('value');
        const globals = globalSnap.val() || {};
        
        const valeriaGlobal = Object.entries(globals).find(([id, u]) => u.name && u.name.toLowerCase().includes('valeria'));
        
        if (valeriaGlobal) {
            console.log("\n✅ VALERIA ENCONTRADA EN GLOBAL USERS:");
            console.log(JSON.stringify(valeriaGlobal[1], null, 2));
            console.log("ID Global:", valeriaGlobal[0]);
        } else {
            console.log("\n❌ VALERIA NO ENCONTRADA EN GLOBAL USERS");
        }

        const fleetId = "-OnPd8HaV1VZWBnYQQX7";
        console.log(`\n🔍 BUSCANDO EN FLOTA PRINCIPAL: ${fleetId}...`);
        
        const fleetUsersSnap = await db.ref(`fleets/${fleetId}/users`).once('value');
        const fleetUsers = fleetUsersSnap.val() || {};
        
        const valeriaLocals = Object.entries(fleetUsers).filter(([id, u]) => u.name && u.name.toLowerCase().includes('valeria'));
        
        if (valeriaLocals.length > 0) {
            console.log(`\n✅ ENCONTRADA(S) ${valeriaLocals.length} VALERIA(S) LOCALES:`);
            valeriaLocals.forEach(([id, u]) => {
                console.log(`\n📌 ID LOCAL: ${id}`);
                console.log(JSON.stringify(u, null, 2));
            });
        } else {
            console.log("\n❌ VALERIA NO ENCONTRADA EN LA FLOTA LOCAL");
            console.log("\nLista de todos los usuarios de la flota para depuración:");
            Object.entries(fleetUsers).forEach(([id, u]) => {
                console.log(`- ${id}: ${u.name} (${u.role})`);
            });
        }
        
        process.exit(0);
    } catch(e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
}

main();
