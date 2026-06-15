const admin = require('firebase-admin');
const serviceAccount = require('../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
    const alertId = `alert_test_${Date.now()}`;
    const alertData = {
        id: alertId,
        type: 'police',
        location: 'Av. Pellegrini y Corrientes (Prueba Live)',
        lat: -32.9525,
        lng: -60.6558,
        timestamp: Date.now(),
        expiresAt: Date.now() + (10 * 60 * 1000), // 10 minutos
        authorName: 'Test Script',
        originalText: 'Hay operativo de transito en pellegrini y corrientes',
        status: 'active',
        source: 'test_script'
    };

    try {
        console.log(`📡 Publicando alerta de prueba en global_traffic_alerts/${alertId}...`);
        await db.ref(`global_traffic_alerts/${alertId}`).set(alertData);
        console.log('✅ ¡Alerta publicada con éxito!');
        process.exit(0);
    } catch(e) {
        console.error('❌ Error publicando alerta:', e.message);
        process.exit(1);
    }
}

main();
