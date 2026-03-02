/* ============================================
   FleetAdmin Pro — Servidor Backend
   Node.js puro (sin dependencias externas)
   Almacenamiento en JSON compartido
   ============================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

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
const VALID_STORES = ['users', 'vehicles', 'shifts', 'oilLogs', 'repairs', 'beltChanges'];

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
                "package_name": "com.onrender.fleetadmin_pro.twa",
                "sha256_cert_fingerprints": [
                    // PWABuilder signing key fingerprint (se actualiza al generar el paquete)
                    "XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX"
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
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
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
