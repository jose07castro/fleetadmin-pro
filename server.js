/* ============================================
   FleetAdmin Pro — Servidor Backend
   Node.js + Firebase Admin SDK para FCM Push
   Almacenamiento en JSON compartido
   ============================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const SERVICE_ACCOUNT_FILE = path.join(DATA_DIR, 'firebase-service-account.json');

// --- Firebase Admin SDK para FCM Push Notifications ---
let firebaseAdmin = null;
let fcmEnabled = false;
try {
    const admin = require('firebase-admin');
    if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
        const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf8'));
        // Verificar que sea una clave real (no el placeholder)
        if (serviceAccount.private_key && serviceAccount.client_email) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
            });
            firebaseAdmin = admin;
            fcmEnabled = true;
            console.log('🔔 Firebase Admin SDK inicializado — FCM Push habilitado');
        } else {
            console.warn('🔔 firebase-service-account.json es placeholder — FCM Push DESHABILITADO');
            console.warn('   Descargá la clave real de: https://console.firebase.google.com/project/fleetadmin-pro/settings/serviceaccounts/adminsdk');
        }
    } else {
        console.warn('🔔 No existe data/firebase-service-account.json — FCM Push DESHABILITADO');
    }
} catch (e) {
    console.warn('🔔 Error inicializando Firebase Admin SDK:', e.message);
    console.warn('   FCM Push DESHABILITADO — la app funciona normal sin push en background.');
}

// --- Tipos MIME para archivos estáticos ---
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

// --- Stores válidos ---
const VALID_STORES = ['users', 'vehicles', 'shifts', 'oilLogs', 'repairs', 'beltChanges', 'gpsEvents'];

// --- Base de datos en memoria (se persiste a disco) ---
let database = null;

function getDefaultDB() {
    return {
        users: [],
        vehicles: [],
        shifts: [],
        oilLogs: [],
        repairs: [],
        beltChanges: [],
        gpsEvents: [],
        settings: {},
        _counters: {}
    };
}

// --- Persistencia ---
function loadDB() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, 'utf8');
            database = JSON.parse(raw);
            // Asegurar que todas las propiedades existan
            const defaults = getDefaultDB();
            for (const key of Object.keys(defaults)) {
                if (!(key in database)) {
                    database[key] = defaults[key];
                }
            }
        } else {
            database = getDefaultDB();
            saveDB();
        }
    } catch (e) {
        console.error('Error al cargar la base de datos:', e);
        database = getDefaultDB();
        saveDB();
    }
    console.log('Base de datos cargada correctamente.');
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(database, null, 2), 'utf8');
    } catch (e) {
        console.error('Error al guardar la base de datos:', e);
    }
}

// --- Obtener siguiente ID auto-increment ---
function getNextId(storeName) {
    if (!database._counters[storeName]) {
        // Calcular desde los datos existentes
        const items = database[storeName] || [];
        const maxId = items.reduce((max, item) => Math.max(max, item.id || 0), 0);
        database._counters[storeName] = maxId;
    }
    database._counters[storeName]++;
    return database._counters[storeName];
}

// --- Seed: datos iniciales ---
function seedData() {
    if (!database.users || database.users.length === 0) {
        database.users = [];
        database._counters.users = 0;

        // Dueño por defecto
        database.users.push({
            id: getNextId('users'),
            name: 'Admin',
            role: 'owner',
            pin: '123456789012345',
            createdAt: new Date().toISOString()
        });
        // Conductor de ejemplo
        database.users.push({
            id: getNextId('users'),
            name: 'Carlos',
            role: 'driver',
            pin: '111111111111111',
            createdAt: new Date().toISOString()
        });
        // Mecánico de ejemplo
        database.users.push({
            id: getNextId('users'),
            name: 'Miguel',
            role: 'mechanic',
            pin: '222222222222222',
            createdAt: new Date().toISOString()
        });
        saveDB();
        console.log('Datos iniciales creados (seed).');
        return true;
    }
    return false;
}

// --- Helpers HTTP ---
function sendJSON(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
}

function sendError(res, message, status = 400) {
    sendJSON(res, { error: message }, status);
}

function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('JSON inválido'));
            }
        });
        req.on('error', reject);
    });
}

// --- Router de API ---
async function handleAPI(req, res, urlPath) {
    const parts = urlPath.replace(/^\/api\//, '').split('/').filter(Boolean);
    const method = req.method;

    // --- POST /api/seed ---
    if (parts[0] === 'seed' && method === 'POST') {
        const created = seedData();
        return sendJSON(res, { seeded: created });
    }

    // --- GET /api/export ---
    if (parts[0] === 'export' && method === 'GET') {
        const exportData = {};
        for (const store of VALID_STORES) {
            exportData[store] = database[store] || [];
        }
        exportData.settings = Object.entries(database.settings || {}).map(([key, value]) => ({ key, value }));
        return sendJSON(res, exportData);
    }

    // --- POST /api/import ---
    if (parts[0] === 'import' && method === 'POST') {
        const data = await parseBody(req);
        for (const store of VALID_STORES) {
            if (data[store]) {
                database[store] = data[store];
                // Recalcular counter
                const maxId = data[store].reduce((max, item) => Math.max(max, item.id || 0), 0);
                database._counters[store] = maxId;
            }
        }
        if (data.settings) {
            if (Array.isArray(data.settings)) {
                database.settings = {};
                data.settings.forEach(s => { database.settings[s.key] = s.value; });
            } else {
                database.settings = data.settings;
            }
        }
        saveDB();
        return sendJSON(res, { success: true });
    }

    // --- POST /api/reset ---
    if (parts[0] === 'reset' && method === 'POST') {
        database = getDefaultDB();
        seedData();
        saveDB();
        return sendJSON(res, { success: true });
    }

    // --- Settings API ---
    if (parts[0] === 'settings') {
        const key = parts[1];

        if (method === 'GET') {
            if (!key) {
                // GET /api/settings → devolver todos
                const all = Object.entries(database.settings || {}).map(([k, v]) => ({ key: k, value: v }));
                return sendJSON(res, all);
            }
            // GET /api/settings/:key
            const value = database.settings?.[key];
            return sendJSON(res, { value: value !== undefined ? value : null });
        }

        if (method === 'PUT' && key) {
            const body = await parseBody(req);
            if (!database.settings) database.settings = {};
            database.settings[key] = body.value;
            saveDB();
            return sendJSON(res, { success: true });
        }

        return sendError(res, 'Operación de settings no soportada', 405);
    }

    // --- SOS Push Notification (FCM) ---
    if (parts[0] === 'sos' && parts[1] === 'notify' && method === 'POST') {
        const data = await parseBody(req);
        console.log('🔔 SOS NOTIFY: Solicitud recibida para alerta:', data.alertId || 'N/A');

        if (!fcmEnabled || !firebaseAdmin) {
            console.warn('🔔 SOS NOTIFY: FCM no configurado — omitiendo push');
            return sendJSON(res, {
                success: false,
                reason: 'FCM not configured',
                message: 'Push deshabilitado: falta firebase-service-account.json'
            });
        }

        try {
            // Leer todos los FCM tokens desde Firebase RTDB
            const tokensSnapshot = await firebaseAdmin.database().ref('fcm_tokens').once('value');
            const tokensData = tokensSnapshot.val();

            if (!tokensData) {
                console.log('🔔 SOS NOTIFY: No hay tokens FCM registrados');
                return sendJSON(res, { success: true, sent: 0, reason: 'no_tokens' });
            }

            // Filtrar tokens: misma flota, excluir al que envió el SOS
            const targetTokens = [];
            const tokenEntries = Object.entries(tokensData);

            for (const [userId, entry] of tokenEntries) {
                // Excluir al conductor que envió el SOS
                if (userId === data.driverId) continue;
                // Filtrar por flota (si ambos tienen fleetId)
                if (data.fleetId && entry.fleetId && 
                    entry.fleetId !== data.fleetId && 
                    entry.fleetId !== 'unknown' && 
                    data.fleetId !== 'unknown') continue;
                // Token válido
                if (entry.token) {
                    targetTokens.push(entry.token);
                }
            }

            console.log(`🔔 SOS NOTIFY: ${targetTokens.length} tokens destino (de ${tokenEntries.length} total)`);

            if (targetTokens.length === 0) {
                return sendJSON(res, { success: true, sent: 0, reason: 'no_matching_tokens' });
            }

            // Construir payload del push
            const typeLabel = data.emergencyTypeLabel || data.emergencyType || 'Emergencia';
            const message = {
                notification: {
                    title: '🚨 ¡ALERTA SOS!',
                    body: `${data.driverName || 'Un conductor'} necesita ayuda inmediata. ${typeLabel}`
                },
                data: {
                    alertId: String(data.alertId || ''),
                    driverName: String(data.driverName || ''),
                    vehicleName: String(data.vehicleName || ''),
                    emergencyType: String(data.emergencyType || ''),
                    emergencyTypeLabel: String(typeLabel),
                    mapsUrl: String(data.mapsUrl || ''),
                    lat: String(data.lat || ''),
                    lng: String(data.lng || ''),
                    created_at: String(data.created_at || ''),
                    title: '🚨 ¡ALERTA SOS!',
                    body: `${data.driverName || 'Un conductor'} necesita ayuda inmediata.`
                },
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        priority: 'max',
                        channelId: 'sos_alerts'
                    }
                },
                webpush: {
                    headers: {
                        Urgency: 'high',
                        TTL: '86400'
                    },
                    notification: {
                        title: '🚨 ¡ALERTA SOS!',
                        body: `${data.driverName || 'Un conductor'} necesita ayuda inmediata. ${typeLabel}`,
                        icon: '/assets/icon-192.png',
                        badge: '/assets/icon-192.png',
                        requireInteraction: true,
                        vibrate: [500, 250, 500, 250, 500, 250, 500]
                    }
                },
                tokens: targetTokens
            };

            // Enviar multicast
            const response = await firebaseAdmin.messaging().sendEachForMulticast(message);
            console.log(`🔔 SOS NOTIFY: ✅ Enviadas: ${response.successCount} exitosas, ${response.failureCount} fallidas`);

            // Limpiar tokens inválidos
            if (response.failureCount > 0) {
                const invalidTokens = [];
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        const errorCode = resp.error?.code || '';
                        if (errorCode === 'messaging/invalid-registration-token' ||
                            errorCode === 'messaging/registration-token-not-registered') {
                            invalidTokens.push(targetTokens[idx]);
                        }
                    }
                });

                // Eliminar tokens inválidos de RTDB
                if (invalidTokens.length > 0) {
                    console.log(`🔔 SOS NOTIFY: 🗑️ Limpiando ${invalidTokens.length} tokens inválidos`);
                    for (const [userId, entry] of tokenEntries) {
                        if (invalidTokens.includes(entry.token)) {
                            await firebaseAdmin.database().ref(`fcm_tokens/${userId}`).remove();
                        }
                    }
                }
            }

            return sendJSON(res, {
                success: true,
                sent: response.successCount,
                failed: response.failureCount,
                total: targetTokens.length
            });

        } catch (e) {
            console.error('🔔 SOS NOTIFY: ❌ Error enviando push:', e.message);
            return sendJSON(res, { success: false, error: e.message }, 500);
        }
    }

    // --- GPS Webhook ---
    if (parts[0] === 'gps' && parts[1] === 'webhook' && method === 'POST') {
        const data = await parseBody(req);

        // Validar token de seguridad
        const configToken = database.settings?.gps_webhook_token;
        const requestToken = req.headers['x-gps-token'];
        if (configToken && configToken !== requestToken) {
            return sendError(res, 'Token GPS inválido', 403);
        }

        const { vehiclePlate, lat, lng, speed, timestamp, event, zone } = data;
        if (!vehiclePlate) {
            return sendError(res, 'vehiclePlate es requerido', 400);
        }

        // Buscar vehículo por patente
        const vehicle = (database.vehicles || []).find(
            v => v.plate && v.plate.toUpperCase().replace(/[^A-Z0-9]/g, '') === vehiclePlate.toUpperCase().replace(/[^A-Z0-9]/g, '')
        );

        let result = { action: 'logged', vehicleFound: !!vehicle };

        // Registrar evento GPS
        const gpsEvent = {
            id: getNextId('gpsEvents'),
            vehiclePlate: vehiclePlate.toUpperCase(),
            vehicleId: vehicle?.id || null,
            lat: lat || null,
            lng: lng || null,
            speed: speed || 0,
            timestamp: timestamp || new Date().toISOString(),
            event: event || 'POSITION',
            zone: zone || null,
            autoCheckout: false,
            createdAt: new Date().toISOString()
        };

        // Lógica de Geofencing: Auto-checkout
        if (event === 'ZONE_ENTER' && zone === 'DOMICILIO_CHOFER' && vehicle) {
            const activeShift = (database.shifts || []).find(
                s => s.status === 'active' && String(s.vehicleId) === String(vehicle.id)
            );

            if (activeShift) {
                const shiftStart = new Date(activeShift.startTime).getTime();
                const hoursActive = (Date.now() - shiftStart) / 3600000;

                if (hoursActive >= 8) {
                    // AUTO-CHECKOUT: cerrar turno automáticamente
                    activeShift.status = 'completed';
                    activeShift.endTime = new Date().toISOString();
                    activeShift.endOdometer = activeShift.startOdometer; // mantener mismo KM
                    activeShift.autoCheckout = true;
                    activeShift.autoCheckoutReason = `Geofencing: DOMICILIO_CHOFER después de ${Math.round(hoursActive)}h`;
                    activeShift.updatedAt = new Date().toISOString();

                    gpsEvent.autoCheckout = true;
                    gpsEvent.shiftId = activeShift.id;

                    result.action = 'auto_checkout';
                    result.shiftId = activeShift.id;
                    result.hoursActive = Math.round(hoursActive);

                    // Registrar notificación pendiente para WhatsApp
                    const notification = {
                        id: getNextId('gpsEvents'),
                        type: 'SHIFT_AUTO_CLOSE',
                        vehiclePlate: vehiclePlate.toUpperCase(),
                        vehicleName: vehicle.name || '',
                        driverName: activeShift.driverName || '',
                        hoursActive: Math.round(hoursActive),
                        timestamp: new Date().toISOString(),
                        processed: false,
                        createdAt: new Date().toISOString()
                    };
                    database.gpsEvents.push(notification);

                    // Intentar enviar WhatsApp si está configurado
                    const waPhone = database.settings?.whatsapp_phone;
                    const waApiKey = database.settings?.whatsapp_apikey;
                    if (waPhone && waApiKey) {
                        const msg = encodeURIComponent(
                            `🚨 *AUTO-CIERRE DE TURNO*\n\n` +
                            `🚗 Vehículo: ${vehicle.name} (${vehicle.plate})\n` +
                            `👤 Conductor: ${activeShift.driverName || 'N/A'}\n` +
                            `⏱️ Horas activo: ${Math.round(hoursActive)}h\n` +
                            `📍 Motivo: Zona DOMICILIO_CHOFER\n` +
                            `📅 ${new Date().toLocaleString()}`
                        );
                        // Fire-and-forget WhatsApp (no bloquear respuesta)
                        const waUrl = `https://api.callmebot.com/whatsapp.php?phone=${waPhone}&text=${msg}&apikey=${waApiKey}`;
                        try {
                            const https = require('https');
                            https.get(waUrl, () => {}).on('error', () => {});
                        } catch(e) { /* ignore */ }
                    }

                    saveDB();
                } else {
                    result.action = 'shift_active_less_than_8h';
                    result.hoursActive = Math.round(hoursActive * 10) / 10;
                }
            } else {
                result.action = 'no_active_shift';
            }
        }

        database.gpsEvents.push(gpsEvent);

        // Limitar gpsEvents a los últimos 500
        if (database.gpsEvents.length > 500) {
            database.gpsEvents = database.gpsEvents.slice(-500);
        }

        saveDB();
        return sendJSON(res, result);
    }

    // --- GPS Events (lectura) ---
    if (parts[0] === 'gps' && parts[1] === 'events' && method === 'GET') {
        const events = (database.gpsEvents || []).slice(-50).reverse();
        return sendJSON(res, events);
    }

    // --- WhatsApp proxy (evitar CORS) ---
    if (parts[0] === 'whatsapp' && parts[1] === 'send' && method === 'POST') {
        const data = await parseBody(req);
        const { phone, apiKey, message } = data;

        if (!phone || !apiKey || !message) {
            return sendError(res, 'Faltan parámetros: phone, apiKey, message', 400);
        }

        const encodedMsg = encodeURIComponent(message);
        const waUrl = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMsg}&apikey=${apiKey}`;

        try {
            const https = require('https');
            const waResponse = await new Promise((resolve, reject) => {
                https.get(waUrl, (resp) => {
                    let body = '';
                    resp.on('data', chunk => body += chunk);
                    resp.on('end', () => resolve({ status: resp.statusCode, body }));
                }).on('error', reject);
            });

            if (waResponse.status >= 200 && waResponse.status < 300) {
                return sendJSON(res, { success: true, status: waResponse.status });
            } else {
                return sendJSON(res, { success: false, error: `CallMeBot respondió ${waResponse.status}`, body: waResponse.body }, 502);
            }
        } catch (e) {
            return sendError(res, 'Error conectando con CallMeBot: ' + e.message, 502);
        }
    }

    // --- CRUD genérico para stores ---
    const storeName = parts[0];

    if (!VALID_STORES.includes(storeName)) {
        return sendError(res, `Store "${storeName}" no existe`, 404);
    }

    if (!database[storeName]) {
        database[storeName] = [];
    }

    // GET /api/:store/index/:indexName/:value
    if (parts[1] === 'index' && parts[2] && parts[3] !== undefined && method === 'GET') {
        const indexName = parts[2];
        const value = decodeURIComponent(parts[3]);
        const results = database[storeName].filter(item => {
            const itemVal = item[indexName];
            // Comparar como string para ser flexible
            return String(itemVal) === String(value);
        });
        return sendJSON(res, results);
    }

    // GET /api/:store → getAll
    if (method === 'GET' && !parts[1]) {
        return sendJSON(res, database[storeName]);
    }

    // GET /api/:store/:id → get by id
    if (method === 'GET' && parts[1]) {
        const id = parseInt(parts[1], 10);
        const item = database[storeName].find(i => i.id === id);
        if (!item) return sendError(res, 'No encontrado', 404);
        return sendJSON(res, item);
    }

    // POST /api/:store → add
    if (method === 'POST') {
        const data = await parseBody(req);
        const newItem = {
            ...data,
            id: getNextId(storeName),
            createdAt: new Date().toISOString()
        };
        database[storeName].push(newItem);
        saveDB();
        return sendJSON(res, newItem, 201);
    }

    // PUT /api/:store/:id → update
    if (method === 'PUT' && parts[1]) {
        const id = parseInt(parts[1], 10);
        const data = await parseBody(req);
        const index = database[storeName].findIndex(i => i.id === id);
        if (index === -1) {
            // Si no existe, crear con ese ID
            const newItem = { ...data, id, updatedAt: new Date().toISOString() };
            database[storeName].push(newItem);
            saveDB();
            return sendJSON(res, newItem);
        }
        database[storeName][index] = {
            ...database[storeName][index],
            ...data,
            id, // mantener el ID original
            updatedAt: new Date().toISOString()
        };
        saveDB();
        return sendJSON(res, database[storeName][index]);
    }

    // DELETE /api/:store/:id → remove
    if (method === 'DELETE' && parts[1]) {
        const id = parseInt(parts[1], 10);
        const before = database[storeName].length;
        database[storeName] = database[storeName].filter(i => i.id !== id);
        saveDB();
        return sendJSON(res, { deleted: database[storeName].length < before });
    }

    // DELETE /api/:store → clear store
    if (method === 'DELETE' && !parts[1]) {
        database[storeName] = [];
        database._counters[storeName] = 0;
        saveDB();
        return sendJSON(res, { success: true });
    }

    sendError(res, 'Método no soportado', 405);
}

// --- Servidor HTTP ---
const server = http.createServer(async (req, res) => {
    const urlPath = req.url.split('?')[0];

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    // --- API requests ---
    if (urlPath.startsWith('/api/')) {
        try {
            await handleAPI(req, res, urlPath);
        } catch (e) {
            console.error('Error en API:', e);
            sendError(res, 'Error interno del servidor', 500);
        }
        return;
    }

    // --- TWA Digital Asset Links (para Google Play Store) ---
    if (urlPath === '/.well-known/assetlinks.json') {
        const assetlinks = [{
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": "com.fleetadminpro.app",
                "sha256_cert_fingerprints": [
                    "72:B4:6F:DC:F1:C9:3B:A0:02:0E:4E:EF:6E:E7:3D:F6:A3:0D:7E:E1:6A:D7:DB:88:B3:A4:A3:69:E4:AF:0B:19"
                ]
            }
        }];
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        });
        return res.end(JSON.stringify(assetlinks));
    }

    // --- Archivos estáticos ---
    let filePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
    filePath = decodeURIComponent(filePath);
    const fullPath = path.resolve(__dirname, filePath);
    const rootDir = path.resolve(__dirname);

    // Seguridad: no permitir salir del directorio
    if (!fullPath.startsWith(rootDir)) {
        res.writeHead(403);
        return res.end('Acceso denegado');
    }

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            console.log(`[404] ${filePath} (${fullPath})`);
            res.writeHead(404);
            res.end('Archivo no encontrado');
            return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(data);
    });
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log(`ERROR: El puerto ${PORT} esta ocupado. Cierra otras instancias primero.`);
        process.exit(1);
    }
});

// --- Iniciar ---
loadDB();
server.listen(PORT, '0.0.0.0', () => {
    console.log(`============================================`);
    console.log(`  FleetAdmin Pro — Servidor Backend`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  Base de datos: ${DB_FILE}`);
    console.log(`============================================`);
});
