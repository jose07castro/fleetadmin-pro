/* ============================================
   FleetAdmin Pro — WhatsApp Bot Worker (v201 - Baileys Fix)
   Escucha grupos de Rosario, detecta operativos y sincroniza con Firebase.
   Usa Baileys (ultra-liviano, sin navegador).
   ============================================ */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
// Logger completamente silencioso para Baileys (evita spam de llaves criptográficas)
const P = () => ({
    level: 'silent',
    trace: () => {}, debug: () => {}, info: () => {},
    warn: () => {}, error: () => {}, fatal: () => {},
    child: () => P()
});
const axios = require('axios');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Gemini via HTTP directo (sin SDK, evita problemas de versiones)
const GEMINI_KEY = process.env.GEMINI_API_KEY || null;
// Modelos estables actuales y validados de Google AI Studio para esta Key (Confirmados por diagnóstico)
const GEMINI_MODELS = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
];
let GEMINI_URL = null; // Se inicializa al primer uso exitoso

async function callGemini(prompt) {
    if (!GEMINI_KEY) return null;
    const urls = GEMINI_URL ? [GEMINI_URL] : GEMINI_MODELS;
    for (const url of urls) {
        try {
            const res = await axios.post(`${url}?key=${GEMINI_KEY}`, {
                contents: [{ parts: [{ text: prompt }] }]
            }, { timeout: 8000 });
            const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (text) {
                if (!GEMINI_URL) { GEMINI_URL = url; console.log(`✅ Gemini activo: ${url.split('/models/')[1].split(':')[0]}`); }
                return text;
            }
        } catch (e) {
            console.warn(`⚠️ [GEMINI] ${url.split('/models/')[1]?.split(':')[0]} falló: ${e.response?.data?.error?.message || e.message}`);
        }
    }
    return null;
}

/**
 * Analiza el CONTENIDO de un audio con Gemini multimodal.
 * Transcribe el audio y determina si es una alerta de tránsito real.
 * @returns {Promise<{isTrafficAlert: boolean, transcription: string, type: string, address: string|null, reason: string}|null>}
 */
async function callGeminiAudio(audioBuffer, mimeType) {
    if (!GEMINI_KEY || !audioBuffer) return null;

    const audioB64 = audioBuffer.toString('base64');
    // Limite seguro: ~10MB en base64. Las notas de voz de WhatsApp son << 1MB normalmente.
    if (audioB64.length > 12 * 1024 * 1024) {
        console.warn('⚠️ [GEMINI-AUDIO] Audio demasiado grande para análisis inline, saltando.');
        return null;
    }

    const prompt = `Sos un asistente de seguridad vial para taxistas de Rosario, Argentina.
Escuchá este audio de un grupo de WhatsApp y respondé SOLO con JSON válido (sin markdown).

Determiná:
1. Si el audio reporta alguna situación de tránsito: operativo policial, control de tránsito, radar/fotomulta, accidente, corte de calle, embotellamiento, camión volcado, etc.
2. La transcripción exacta de lo que dice el audio
3. El tipo de alerta: police / checkpoint / radar / accident / traffic / warning
4. La dirección o intersección mencionada (null si no hay ninguna)

Si el audio es: conversación personal, música, tutorial, broma, saludos, venta de productos, noticias generales, o cualquier cosa NO relacionada con el tránsito en las calles → isTrafficAlert: false.

Respuesta EXACTAMENTE en este formato:
{"isTrafficAlert":true,"transcription":"texto del audio","type":"checkpoint","address":"Bv Oroño y Corrientes","reason":"menciona control policial en intersección"}`;

    // Los modelos Flash soportan audio inline
    const audioModels = [
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    ];

    for (const url of audioModels) {
        try {
            const res = await axios.post(`${url}?key=${GEMINI_KEY}`, {
                contents: [{
                    parts: [
                        { inlineData: { mimeType: mimeType || 'audio/ogg', data: audioB64 } },
                        { text: prompt }
                    ]
                }]
            }, { timeout: 25000 });

            const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (rawText) {
                try {
                    const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                    const parsed = JSON.parse(clean);
                    console.log(`🤖 [GEMINI-AUDIO] isAlert=${parsed.isTrafficAlert} | Tipo=${parsed.type} | Razón="${parsed.reason}" | Transcripción="${(parsed.transcription||'').substring(0,60)}"`);
                    return parsed;
                } catch (parseErr) {
                    console.warn('⚠️ [GEMINI-AUDIO] No se pudo parsear JSON de respuesta:', rawText.substring(0, 150));
                    // Intentar extraer isTrafficAlert por texto plano como último recurso
                    const isAlert = /isTrafficAlert.*true/i.test(rawText);
                    return { isTrafficAlert: isAlert, transcription: rawText.substring(0, 200), type: 'checkpoint', address: null, reason: 'parse_fallback' };
                }
            }
        } catch (e) {
            console.warn(`⚠️ [GEMINI-AUDIO] ${url.split('/models/')[1]?.split(':')[0]} falló: ${e.response?.data?.error?.message || e.message}`);
        }
    }
    return null;
}


// 1. Inicialización de Firebase Admin

let db = null;

if (!admin.apps.length) {
    try {
        let credential = null;

        // MÉTODO 0 (LOCAL FALLBACK): Archivo físico en el servidor (JSON o Base64)
        let possiblePaths = [
            path.join(__dirname, '../../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json'),
            path.join(__dirname, '../../../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json'),
            path.join(__dirname, './fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json')
        ];

        let jsonPath = null;
        let base64Path = null;

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                jsonPath = p;
                break;
            }
            if (fs.existsSync(p + '.base64')) {
                base64Path = p + '.base64';
                break;
            }
        }

        if (jsonPath) {
            console.log('🔑 Usando archivo físico de credenciales Firebase JSON...');
            try {
                const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                credential = admin.credential.cert(json);
                console.log(`📡 Config (local): project=${json.project_id}, email=${json.client_email?.substring(0,20)}...`);
            } catch (jsonErr) {
                console.warn('⚠️ Error parsing local JSON credentials:', jsonErr.message);
            }
        } else if (base64Path) {
            console.log('🔑 Usando archivo físico de credenciales Firebase Base64...');
            try {
                const base64Str = fs.readFileSync(base64Path, 'utf8').trim();
                const json = JSON.parse(Buffer.from(base64Str, 'base64').toString('utf8'));
                credential = admin.credential.cert(json);
                console.log(`📡 Config (local base64): project=${json.project_id}, email=${json.client_email?.substring(0,20)}...`);
            } catch (jsonErr) {
                console.warn('⚠️ Error parsing local Base64 credentials:', jsonErr.message);
            }
        }

        if (!credential) {
            // MÉTODO 1 (RECOMENDADO): JSON completo en base64
            if (process.env.FIREBASE_SERVICE_ACCOUNT) {
                console.log('🔑 Usando FIREBASE_SERVICE_ACCOUNT (JSON base64)...');
                const json = JSON.parse(
                    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8')
                );
                credential = admin.credential.cert(json);
                console.log(`📡 Config: project=${json.project_id}, email=${json.client_email?.substring(0,20)}...`);
            } 
            // MÉTODO 2 (FALLBACK): Variables individuales
            else {
                console.log('🔑 Usando variables individuales (PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY)...');
                const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim().replace(/^"|"$/g, '');
                const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim().replace(/^"|"$/g, '');
                let privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim().replace(/^"|"$/g, '');
                
                if (privateKey) {
                    // Render guarda \n como texto literal
                    privateKey = privateKey.replace(/\\n/g, '\n');
                }

                console.log(`📡 Config: ID=${projectId?.substring(0, 5)}..., KeyLength=${privateKey.length}`);

                if (!projectId || !clientEmail || privateKey.length < 100) {
                    throw new Error('Variables de Firebase incompletas o inválidas.');
                }

                credential = admin.credential.cert({ projectId, clientEmail, privateKey });
            }
        }

        admin.initializeApp({
            credential,
            databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${process.env.FIREBASE_PROJECT_ID || 'fleetadmin-pro'}-default-rtdb.firebaseio.com`,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID || 'fleetadmin-pro'}.firebasestorage.app`
        });
        
        db = admin.database();
        console.log('✅ Firebase Admin: ¡Inicializado con éxito!');
    } catch (e) {
        console.error('❌ Firebase Admin:', e.message);
    }
}

/**
 * Módulo de Lógica del Bot (Baileys v201 - Conexión Robusta)
 */
const WhatsappBot = (() => {
    let sock = null;
    let retryCount = 0;
    let isConnecting = false; // Cerrojo (LOCK) anti-clones paralelos
    let _isConnectedState = false; // Rastreador de estado para API
    let _stableTimer = null; // Validador de salud de conexión
    const MAX_RETRIES = 10;
    const AUTH_DIR = './auth_info';

    // Diccionario de Slang Rosarino (Sincronizado con el cliente)
    const ALERT_KEYWORDS = ['gorra', 'operativo', 'control', 'zorros', 'chanchos', 'palo', 'parando', 'evitar', 'ratis'];

    // Lista de palabras/insultos prohibidos para censura o rechazo de alertas (Modo Moderación)
    const FORBIDDEN_WORDS = [
        'boludo', 'boluda', 'puto', 'puta', 'conchudo', 'conchuda', 'concha', 'tarado', 'tarada',
        'hijo de puta', 'hija de puta', 'hdp', 'forro', 'forra', 'pelotudo', 'pelotuda', 'orto',
        'pajero', 'pajera', 'cagon', 'cagona', 'culiao', 'culiada', 'pija', 'chota', 'mierda',
        'trola', 'trolo'
    ];

    function _containsForbiddenWords(text) {
        if (!text) return false;
        const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return FORBIDDEN_WORDS.some(word => {
            // Check for substring match to be extra safe and catch variations like "boludoo"
            return normalized.includes(word);
        });
    }

    function _isObviousChatter(text) {
        if (!text) return true;
        const t = text.toLowerCase().trim().replace(/[^a-z0-9áéíóúñ\s]/g, '');
        
        // Saludos y agradecimientos ultra-comunes
        const patterns = [
            /^(gracias|muchas gracias|gracias viejo|buenisimo gracias|joya gracias|excelente gracias|de 10 gracias|de diez gracias|gracias crack)$/,
            /^(hola|buen dia|buenos dias|buenas tardes|buenas noches|hola gente|hola grupo|buen dia gente|buen dia grupo)$/,
            /^(ok|okey|dale|listo|joya|espectacular|buenisimo|excelente|entendido|recibido)$/,
            /^(gracias por la info|gracias x la info|gracias por reportar|buenisimo el dato|buen dato)$/
        ];
        
        return patterns.some(p => p.test(t));
    }

    function _isOperativoGroup(groupName) {
        if (!groupName) return false;
        const gn = groupName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const keywords = [
            'operativo', 'control', 'zorros', 'policia', 'municipal', 'transito', 
            'chanchos', 'gorra', 'ratis', 'radar', 'movil', 'seguridad', 'camara', 
            'fotomulta', 'evitar', 'cana', 'alertas', 'reporte',
            'trabajo' // Grupo de pruebas del admin — Gemini filtra el contenido igual
        ];
        return keywords.some(kw => gn.includes(kw));
    }
    // Números de admin/dueño que pueden enviar alertas por chat privado
    // Formato: código de país + código de área + número (sin +)
    const TRUSTED_ADMIN_NUMBERS = [
        '5493415707731', // Número principal del bot/dueño (341-5707731)
        '5493417327248', // Segundo número de prueba/reenvío del admin (341-7327248)
    ];

    function _isTrustedAdmin(jid) {
        if (!jid) return false;
        if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) return false;
        const num = jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^0-9]/g, '');
        if (!num) return false;
        return TRUSTED_ADMIN_NUMBERS.some(t => num.endsWith(t) || t.endsWith(num));
    }

    // Fleet ID real (se auto-detecta al iniciar)
    let _resolvedFleetId = null;

    async function _resolveFleetId() {
        if (_resolvedFleetId) return _resolvedFleetId;
        
        // Si hay variable de entorno explícita, usarla
        if (process.env.DEFAULT_FLEET_ID) {
            _resolvedFleetId = process.env.DEFAULT_FLEET_ID;
            console.log(`🏢 [FLEET] Usando DEFAULT_FLEET_ID del env: ${_resolvedFleetId}`);
            return _resolvedFleetId;
        }

        // Auto-detectar: buscar la primera flota en Firebase
        if (db) {
            try {
                const snap = await db.ref('fleets').limitToFirst(1).once('value');
                const val = snap.val();
                if (val) {
                    const keys = Object.keys(val);
                    if (keys.length > 0) {
                        _resolvedFleetId = keys[0];
                        console.log(`🏢 [FLEET] ✅ Auto-detectada flota: ${_resolvedFleetId}`);
                        return _resolvedFleetId;
                    }
                }
            } catch (e) {
                console.error('🏢 [FLEET] Error buscando flota:', e.message);
            }
        }

        // Último fallback
        _resolvedFleetId = 'jose07';
        console.log(`🏢 [FLEET] ⚠️ Usando fallback: ${_resolvedFleetId}`);
        return _resolvedFleetId;
    }

    // ============ GLOBAL ERROR HANDLER ============
    // Los errores MAC ocurren en las internals de Baileys/libsignal
    // y a veces escapan como "unhandledRejection". Los silenciamos aquí.
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', (reason) => {
        const msg = reason?.message || String(reason);
        // Silenciar errores MAC / Decryption tanto en inglés como sus traducciones literales al español de Baileys
        if (msg.includes('MAC') || msg.includes('decrypt') || msg.includes('Bad MAC') || msg.includes('autenticar datos') || msg.includes('Estado no admitido')) {
            console.log('⚠️ [MAC] Mensaje no descifrable o conflicto de sesión (normal después de reinicio/soft-reset), ignorado.');
            return;
        }
        console.error('⚠️ [UNHANDLED]', msg);
    });

    /**
     * Rastreador de ancho de banda (Admin solo)
     */
    async function _trackBandwidth(payload, type) {
        if (!db || !payload) return;
        try {
            let str = typeof payload === 'string' ? payload : '';
            if (!str) {
                try { str = JSON.stringify(payload); } catch(e) { str = String(payload); }
            }
            const bytes = Buffer.byteLength(str, 'utf8');
            const ref = db.ref('stats/consumo_bandwidth');
            
            await ref.child('total_bytes').transaction(current => (current || 0) + bytes);
            await ref.child(`${type}_bytes`).transaction(current => (current || 0) + bytes);
        } catch (e) {
            console.warn('⚠️ [BANDWIDTH] Error guardando consumo:', e.message);
        }
    }

    async function init() {
        console.log('🚀 INICIANDO BOT v236 (BAILEYS + GEMINI HTTP + AUTO-PING)...');
        console.log('📡 Sin navegador - conexión directa a WhatsApp');
        console.log(`🔥 Firebase DB: ${db ? '✅ CONECTADO' : '❌ NULL - LAS ALERTAS NO SE GUARDARÁN'}`);
        console.log(`🧠 Gemini IA: ${GEMINI_KEY ? '✅ ACTIVO' : '❌ NO CONFIGURADO'}`);
        
        // Esperar 50s al inicio para que el proceso anterior de Render muera
        console.log('⏳ Esperando 50s para que el proceso anterior libere la sesión...');
        await new Promise(r => setTimeout(r, 50000));
        console.log('✅ Espera terminada. Conectando a WhatsApp...');
        
        // Auto-ping cada 10 minutos para evitar que Render (free tier) duerma el servicio
        const selfUrl = process.env.RENDER_EXTERNAL_URL || 'https://fleetadmin-web-nueva.onrender.com';
        setInterval(async () => {
            try {
                await axios.get(`${selfUrl}/api/bot/status`, { timeout: 10000 });
                console.log('🏓 [PING] Auto-ping OK — servicio despierto');
            } catch(e) {
                console.warn('⚠️ [PING] Auto-ping falló:', e.message);
            }
        }, 10 * 60 * 1000); // cada 10 minutos
        console.log(`🏓 [PING] Auto-ping activado cada 10min → ${selfUrl}`);
        
        // Auto-detectar fleet ID ANTES de conectar WhatsApp
        await _resolveFleetId();
        
        // Iniciar rutina de limpieza de base de datos en segundo plano
        _startDatabaseCleanup();
        
        await startSocket();
    }

    let _backupInterval = null;

    /**
     * Carga el estado de sesión de Firebase o del sistema de archivos local
     * para que sobrevivan los reinicios de Render (evita el Error MAC Malo)
     */
    async function _firebaseAuthState() {
        let isFreshStart = true;
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        } else if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
            // Si ya existe la carpeta local con credenciales, usamos esas y NO sobrescribimos con Firebase
            // porque las locales siempre son más nuevas que el backup y sobrescribirlas causa MAC Bad / Error 440
            isFreshStart = false;
            console.log('🔑 [AUTH] Sesión local existente detectada. Omitiendo descarga desde Firebase.');
        }

        // 1. Restaurar TODAS las llaves desde Firebase SOLO si es un inicio limpio (contenedor nuevo)
        if (db && isFreshStart) {
            try {
                const snap = await db.ref('bot_auth_backup').once('value');
                const backup = snap.val();
                if (backup) {
                    for (const safeKey in backup) {
                        try {
                            // Decodificar Base64 a nombre real (o fallback si era viejo)
                            const fileName = safeKey.includes('json') ? safeKey : Buffer.from(safeKey, 'base64').toString('utf8');
                            fs.writeFileSync(path.join(AUTH_DIR, fileName), backup[safeKey]);
                        } catch(e) {}
                    }
                    console.log(`🔑 [AUTH] Sesión completa restaurada desde Firebase (${Object.keys(backup).length} archivos) ✅`);
                } else {
                    console.log('🔑 [AUTH] No hay sesión guardada, se necesita QR nuevo');
                }
            } catch (e) {
                console.error('🔑 [AUTH] Error restaurando credenciales:', e.message);
            }
        }

        // 2. Usar el sistema de archivos local (ya restaurado)
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        // Función auxiliar para crear el objeto de backup usando Base64 keys
        const _createBackupObject = () => {
            const files = fs.readdirSync(AUTH_DIR);
            const backup = {};
            for (const file of files) {
                if (file.endsWith('.json')) {
                    // Firebase prohíbe '.', '#', '$', '/', '[', ']'. 
                    // Baileys usa '.us' y '.net' en sus archivos, lo que rompe Firebase.
                    // Solución: codificar el nombre del archivo en Base64
                    const safeKey = Buffer.from(file).toString('base64');
                    backup[safeKey] = fs.readFileSync(path.join(AUTH_DIR, file), 'utf8');
                }
            }
            return backup;
        };

        // 3. Hacer backup a Firebase cada vez que cambien los credenciales, pero con debounce
        let saveTimeout = null;
        const saveCredsToFirebase = async () => {
            await saveCreds(); // Guardar local
            
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                if (db) {
                    try {
                        const backup = _createBackupObject();
                        await db.ref('bot_auth_backup').set(backup);
                        console.log(`🔑 [AUTH] Backup en la nube actualizado (${Object.keys(backup).length} archivos) ✅`);
                    } catch (e) {
                        console.error('🔑 [AUTH] Error guardando backup en Firebase:', e.message);
                    }
                }
            }, 5000); // Esperar 5s para agrupar escrituras
        };

        // 4. Sync activo de llaves (Baileys no llama saveCreds para las session keys)
        if (_backupInterval) clearInterval(_backupInterval);
        _backupInterval = setInterval(async () => {
            if (db && fs.existsSync(AUTH_DIR)) {
                try {
                    const backup = _createBackupObject();
                    await db.ref('bot_auth_backup').set(backup);
                } catch(e) {}
            }
        }, 60000); // Sincronizar cada 60s
        
        return { state, saveCreds: saveCredsToFirebase };
    }

    /**
     * Limpia la carpeta de autenticación para forzar un nuevo pairing
     */
    async function clearAuthInfo() {
        try {
            if (fs.existsSync(AUTH_DIR)) {
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                console.log('🗑️ Credenciales locales eliminadas.');
            }
            if (db) {
                await db.ref('bot_auth_backup').remove();
                await db.ref('bot_auth').remove(); // limpiar el viejo también
                console.log('🗑️ Credenciales de Firebase eliminadas.');
            }
        } catch (e) {
            console.error('⚠️ Error limpiando credenciales:', e.message);
        }
    }

    /**
     * Cuidado de emergencia (SOFT RESET): Borra llaves corruptas pero MANTIENE creds.json
     * Esto soluciona el error de "MAC Malo" y "Conflicto 440" sin pedir escanear el QR de vuelta!
     */
    async function softResetAuthInfo() {
        console.log('🔧 [SOFT-RESET] Intentando curación rápida de MAC corrupto (Conservando QR)...');
        try {
            if (fs.existsSync(AUTH_DIR)) {
                const files = fs.readdirSync(AUTH_DIR);
                let removedCount = 0;
                for (const file of files) {
                    // Conservar estrictamente creds.json que contiene el emparejamiento
                    if (file !== 'creds.json') {
                        try {
                            fs.unlinkSync(path.join(AUTH_DIR, file));
                            removedCount++;
                        } catch(e) {}
                    }
                }
                console.log(`🧹 [SOFT-RESET] ${removedCount} archivos efímeros eliminados. creds.json a salvo.`);
            }
            
            if (db) {
                // En Firebase: Bajar backup, dejar solo creds.json y volver a subir
                const snap = await db.ref('bot_auth_backup').once('value');
                const backup = snap.val();
                if (backup) {
                    const cleanBackup = {};
                    const targetKey = Buffer.from('creds.json').toString('base64');
                    
                    if (backup[targetKey]) {
                        cleanBackup[targetKey] = backup[targetKey];
                        await db.ref('bot_auth_backup').set(cleanBackup);
                        console.log('🧹 [SOFT-RESET] Backup en la nube curado, solo conservado creds.json.');
                    } else if (backup['creds.json']) {
                        cleanBackup['creds.json'] = backup['creds.json'];
                        await db.ref('bot_auth_backup').set(cleanBackup);
                        console.log('🧹 [SOFT-RESET] Backup nube curado (legacy mapping).');
                    }
                }
            }
        } catch (e) {
            console.error('⚠️ [SOFT-RESET] Falló autocuración:', e.message);
        }
    }

    async function startSocket() {
        if (isConnecting) {
            console.log('🛡️ [LOCK] Bloqueando intento de conexión duplicado en paralelo.');
            return;
        }
        isConnecting = true;
        
        // WATCHDOG SANITARIO DE CERROJO: Si tras 90 segundos no hay éxito ni fallo definitivo, 
        // forzamos liberación para evitar congelamiento absoluto en la RAM de Render.
        const lockWatchdog = setTimeout(() => {
            if (isConnecting && !_isConnectedState) {
                console.warn('🚨 [WATCHDOG] Desbloqueando cerrojo por tiempo excedido (90s) para autorrecuperación.');
                isConnecting = false;
            }
        }, 90000);

        // Limpieza estricta de memoria: cerrar socket y limpiar listeners viejos si existen
        if (sock) {
            console.log('🧹 [LOCK] Destruyendo socket fantasma anterior para liberar listeners.');
            try { 
                sock.ev.removeAllListeners(); 
                sock.end(); 
            } catch(e) {}
            sock = null;
        }

        try {
            const { state, saveCreds } = await _firebaseAuthState();
            const { version } = await fetchLatestBaileysVersion();
            
            sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: true,
                logger: P({ level: 'silent' }),
                browser: ['FleetAdmin Pro', 'MacOS', '20.0.04'],
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 0,
                keepAliveIntervalMs: 25000,
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                syncFullHistory: false,
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log(`📱 QR generado: https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=400x400`);
                }

                if (connection === 'close') {
                    clearTimeout(lockWatchdog); // Detener watchdog al finalizar el intento
                    isConnecting = false; // Liberar cerrojo
                    _isConnectedState = false;
                    
                    // Cancelar validador de salud inmediatamente al desconectar
                    if (_stableTimer) { clearTimeout(_stableTimer); _stableTimer = null; }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = DisconnectReason;
                    
                    console.log(`⚠️ Conexión cerrada. Código: ${statusCode}`);
                    
                    // Muy Importante: Borrar listeners del socket muerto para evitar bucles fantasma
                    try { sock?.ev?.removeAllListeners(); } catch(e) {}

                    if (statusCode === reason.loggedOut) {
                        console.log('🔴 Sesión cerrada por el usuario. Limpiando credenciales...');
                        await clearAuthInfo();
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await startSocket();
                    } else if (statusCode === 428) {
                        console.log('⚠️ [428] Precondición fallida. Intentando reset de conexión suave...');
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        await startSocket();
                    } else if (statusCode === 440 || statusCode === 503) {
                        retryCount++;
                        
                        // PROTOCOLO DE SUICIDIO CONTROLADO: Si el conflicto 440 persiste 3 veces, 
                        // matamos el proceso para que Render recicle limpio y elimine clones fantasmas de RAM.
                        // Omitido durante los primeros 5 minutos de arranque (warmup) para evitar fallos de despliegue.
                        if (retryCount >= 3) {
                            if (process.uptime() > 300) {
                                console.error('💥 [LOCK-FATAL] Conflicto 440 persistente. Matando proceso para autocuración completa en Render...');
                                process.exit(1);
                            } else {
                                console.warn('⚠️ [LOCK-WARMUP] Conflicto 440 durante el arranque. Ignorando suicidio por calentamiento (uptime < 5min)...');
                                retryCount = 0; // Resetear para seguir intentando
                            }
                        }

                        // Retardo racional con desincronización aleatoria (Jitter)
                        // Evita que dos clones conecten exactamente al mismo milisegundo
                        const delay440 = 15000 + Math.floor(Math.random() * 15000); 
                        console.log(`⚠️ [${statusCode}] Conflicto de sesión. Intento ${retryCount}. Esperando ${delay440/1000}s (Jitter)...`);
                        
                        if (retryCount >= 2) {
                            await softResetAuthInfo();
                        }

                        await new Promise(resolve => setTimeout(resolve, delay440));
                        await startSocket();
                    } else if (statusCode === reason.restartRequired || statusCode === reason.connectionTimedOut) {
                        console.log('🔄 Reconectando inmediatamente...');
                        await startSocket();
                    } else if (statusCode === 401) {
                        retryCount++;
                        if (retryCount > MAX_RETRIES) {
                            console.log('🔴 Sesión expirada (401). Limpiando sesión...');
                            await clearAuthInfo();
                            retryCount = 0;
                        }
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await startSocket();
                    } else {
                        retryCount++;
                        const delay = Math.min(5000 * retryCount, 30000);
                        console.log(`🔄 Reconectando en ${delay / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        await startSocket();
                    }
                } else if (connection === 'open') {
                    clearTimeout(lockWatchdog); // Éxito total, matar watchdog de cerrojo
                    isConnecting = false; // Liberar cerrojo al conectar con éxito
                    _isConnectedState = true;
                    console.log('✅ ¡Bot de WhatsApp CONECTADO!');
                    
                    // BLINDAJE SANITARIO: Solo reseteamos el contador si el bot se mantiene VIVO
                    // y estable por lo menos 60 segundos consecutivos. Si muere antes, acumulamos
                    // el reintento para forzar el autokill del proceso fantasma.
                    if (_stableTimer) clearTimeout(_stableTimer);
                    _stableTimer = setTimeout(() => {
                        retryCount = 0;
                        console.log('💚 [HEALTH] Conexión estable por 60s. Contador de reintentos limpiado.');
                        _stableTimer = null;
                    }, 60000);
                }
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                console.log(`📨 [UPSERT] type=${type}, count=${messages.length}`);
                if (type !== 'notify' && type !== 'append') return; // Sincronizar tanto live como pendientes

                for (const msg of messages) {
                    try {
                    // VALIDACIÓN DE FRESCURA: Ignorar mensajes más viejos de 20 minutos 
                    // para evitar procesar toneladas de alertas fantasma viejas tras una caída.
                    const msgSec = Number(msg.messageTimestamp) || 0;
                    const nowSec = Math.floor(Date.now() / 1000);
                    const ageSec = nowSec - msgSec;
                    
                    if (msgSec > 0 && ageSec > 1200) { // 20 minutos (1200 seg)
                        console.log(`⏭️ [SKIP] Mensaje antiguo de buffer saltado (${ageSec}s de antigüedad).`);
                        continue;
                    }

                    const jid = msg.key.remoteJid;
                    if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast')) continue;

                    const isGroup = jid.endsWith('@g.us');
                    const senderJid = msg.key.participant || msg.key.remoteJid || '';
                    const isFromTrustedAdmin = msg.key.fromMe || _isTrustedAdmin(senderJid) || _isTrustedAdmin(jid);
                    
                    // Procesar todos los grupos y chats privados para analizar alertas.
                    if (!isGroup && isFromTrustedAdmin) {
                        console.log(`✅ [ADMIN-PRIVADO] Mensaje privado de admin de confianza aceptado: ${senderJid?.substring(0,25)}`);
                    }
                    
                    if (isFromTrustedAdmin) {
                        console.log(`🐛 [ADMIN-RAW-MSG] ID=${msg.key.id} | HasMessage=${!!msg.message} | Keys=${Object.keys(msg.message || {})}`);
                        console.log(`🐛 [ADMIN-RAW-JSON] ${JSON.stringify(msg)}`);
                    }
                    
                    // En grupos: procesar TODOS los mensajes (incluso fromMe)
                    // El dueño puede enviar alertas desde su celular/WhatsApp Web
                    // Solo saltar mensajes de estado del sistema (sin remoteJid válido)
                    if (!jid) continue;

                    // --- EXTRAER CONTEXTO DEL GRUPO (con fallback inteligente) ---
                    let groupName = isGroup ? 'Grupo Desconocido' : (isFromTrustedAdmin ? 'Admin Privado' : 'Chat Privado');
                    if (isGroup) {
                        try {
                            const groupInfo = await sock.groupMetadata(jid);
                            groupName = groupInfo?.subject || 'Grupo Desconocido';
                        } catch(ge) {
                            // Fallback: intentar obtener nombre desde el JID del grupo
                            console.warn(`⚠️ [GROUP] No se pudo obtener metadatos del grupo ${jid?.substring(0,20)}. Usando Gemini como filtro.`);
                            groupName = 'Grupo Desconocido';
                        }
                    }
                    const isKnownOperativoGroup = _isOperativoGroup(groupName);
                    console.log(`📱 [MSG] JID=${jid?.substring(0,20)}... | Grupo=${isGroup} | Admin=${isFromTrustedAdmin} | Nombre="${groupName}" | Operativo=${isKnownOperativoGroup}`);

                    // Extraer texto: cubrimos TODOS los formatos de mensaje de WhatsApp
                    let text = '';
                    const m = msg.message;
                    
                    if (m) {
                        text = m.conversation ||
                               m.extendedTextMessage?.text ||
                               m.imageMessage?.caption ||
                               m.videoMessage?.caption ||
                               m.documentMessage?.caption ||
                               m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
                               m.buttonsResponseMessage?.selectedDisplayText ||
                               m.templateButtonReplyMessage?.selectedId ||
                               m.listResponseMessage?.title ||
                               m.ephemeralMessage?.message?.conversation ||
                               m.ephemeralMessage?.message?.extendedTextMessage?.text ||
                               m.viewOnceMessage?.message?.imageMessage?.caption ||
                               m.viewOnceMessageV2?.message?.imageMessage?.caption ||
                               m.editedMessage?.message?.protocolMessage?.editedMessage?.conversation ||
                               m.editedMessage?.message?.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
                               m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
                               '';
                        
                        // Búsqueda profunda si aún vacío: revisar primer nivel del objeto
                        if (!text) {
                            for (const key of Object.keys(m)) {
                                const val = m[key];
                                if (val && typeof val === 'object') {
                                    const t = val.text || val.caption || val.conversation;
                                    if (t && typeof t === 'string') { text = t; break; }
                                    if (val.message) {
                                        const deep = val.message.text || val.message.caption ||
                                                     val.message.conversation || val.message.extendedTextMessage?.text;
                                        if (deep && typeof deep === 'string') { text = deep; break; }
                                    }
                                }
                            }
                        }
                    }

                    // Debug: si el mensaje del grupo no tiene texto, loguear las claves para diagnosticar
                    if (!text && isGroup && m) {
                        const keys = Object.keys(m).filter(k => k !== 'messageContextInfo');
                        console.log(`🐛 [DEBUG] Mensaje sin texto. Claves: [${keys.join(', ')}]`);
                    }
                    
                    // RESCATE ABSOLUTO DE AUDIO: Buscar recursivamente audioMessage en cualquier nivel (ephemeral, viewOnce, etc.)
                    let resolvedAudioMsg = null;
                    function _recursiveFindAudio(obj) {
                        if (!obj || typeof obj !== 'object') return null;
                        if (obj.audioMessage) return obj.audioMessage;
                        for (const k of Object.keys(obj)) {
                            const val = obj[k];
                            if (val && typeof val === 'object') {
                                if (val.audioMessage) return val.audioMessage;
                                if (val.message) {
                                    const res = _recursiveFindAudio(val.message);
                                    if (res) return res;
                                }
                            }
                        }
                        return null;
                    }
                    
                    if (m) {
                        resolvedAudioMsg = _recursiveFindAudio(m);
                    }
                    const isAudio = !!resolvedAudioMsg;
                    const isPTT = !!(resolvedAudioMsg && resolvedAudioMsg.ptt);

                    console.log(`📩 [MSG] From=${jid?.substring(0,15)}... | Group=${isGroup} | Audio=${isAudio} | PTT=${isPTT} | Text="${text.substring(0,80)}"`);


                    // 1. PROCESAR AUDIO
                    let audioBuffer = null;
                    let audioUrl = null;
                    let isAudioOnlyAlert = false; // Flag: el mensaje es un audio sin texto

                    if (isAudio) {
                        // Comando especial .test_audio: bypass del filtro de grupo para pruebas del admin
                        const isTestCommand = text.trim().toLowerCase().startsWith('.test_audio');
                        
                        // Filtro de grupos: 
                        // - Si el grupo es conocido como operativo → procesar siempre
                        // - Si el nombre no coincide (ej: 'Grupo Desconocido' por error de metadatos) → dejar que Gemini decida
                        // - Si viene de admin por privado → procesar siempre
                        // - Si viene de grupo desconocido SIN Gemini → skip (no tenemos forma de saber)
                        const shouldProcessAudio = isTestCommand || isFromTrustedAdmin || isKnownOperativoGroup || GEMINI_KEY !== null;
                        if (!shouldProcessAudio) {
                            console.log(`⏭️ [SKIP-AUDIO] Omitiendo audio: grupo "${groupName}" no es operativo y Gemini no está configurado.`);
                            continue;
                        }
                        if (!isKnownOperativoGroup && GEMINI_KEY) {
                            console.log(`🤖 [GEMINI-FALLBACK] Grupo "${groupName}" no confirmado como operativo. Gemini decidirá si el audio es alerta de tránsito.`);
                        }

                        try {
                            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                            const cleanMsg = {
                                key: msg.key,
                                message: { audioMessage: resolvedAudioMsg }
                            };
                            audioBuffer = await downloadMediaMessage(cleanMsg, 'buffer', {}, {
                                logger: P({ level: 'silent' }),
                                reuploadRequest: sock.updateMediaMessage
                            });
                            console.log(`🎙️ [AUDIO] Descargado ${audioBuffer.length} bytes.`);

                            // Determinar la extensión del archivo de audio
                            let extension = 'ogg';
                            const mimeType = (resolvedAudioMsg && resolvedAudioMsg.mimetype) || '';
                            if (mimeType.includes('audio/mpeg') || mimeType.includes('audio/mp3')) {
                                extension = 'mp3';
                            } else if (mimeType.includes('audio/mp4') || mimeType.includes('audio/aac') || mimeType.includes('audio/m4a')) {
                                extension = 'm4a';
                            } else if (mimeType.includes('audio/wav') || mimeType.includes('audio/x-wav')) {
                                extension = 'wav';
                            }

                            const safeMsgIdAudio = msg.key.id.replace(/[^a-zA-Z0-9_-]/g, '_');
                            const audioFileName = `wsp_${safeMsgIdAudio}.${extension}`;

                            // ======================================================
                            // PRIORIDAD 1: Firebase Storage (URL permanente, no depende
                            // del disco efímero de Render que se borra en cada reinicio)
                            // ======================================================
                            let storageUploadOk = false;
                            try {
                                const { getStorage, getDownloadURL } = require('firebase-admin/storage');
                                const bucket = getStorage().bucket();
                                const storageFile = bucket.file(`audio/${audioFileName}`);
                                await storageFile.save(audioBuffer, {
                                    metadata: {
                                        contentType: mimeType || 'audio/ogg',
                                        cacheControl: 'public, max-age=86400'
                                    }
                                });
                                audioUrl = await getDownloadURL(storageFile);
                                storageUploadOk = true;
                                console.log(`☁️ [AUDIO] Subido a Firebase Storage → URL pública: ${audioUrl}`);
                            } catch (storageErr) {
                                console.warn(`⚠️ [AUDIO] Firebase Storage falló (${storageErr.message}), usando disco local como fallback...`);
                            }

                            // ======================================================
                            // FALLBACK: Disco local (solo funciona si el proceso NO
                            // se reinició - el archivo puede no existir luego de restart)
                            // ======================================================
                            if (!storageUploadOk) {
                                const audioDestDir = path.join(__dirname, '../../audio');
                                if (!fs.existsSync(audioDestDir)) {
                                    fs.mkdirSync(audioDestDir, { recursive: true });
                                }
                                const audioPath = path.join(audioDestDir, audioFileName);
                                fs.writeFileSync(audioPath, audioBuffer);
                                audioUrl = `/audio/${audioFileName}`;
                                console.log(`💾 [AUDIO] Guardado en disco local: ${audioPath} → URL relativa: ${audioUrl}`);
                            }

                            // Intentar transcribir usando Whisper si la API Key de OpenAI está configurada
                            if (process.env.OPENAI_API_KEY) {
                                try {
                                    console.log('🎙️ [WHISPER] Intentando transcribir audio en segundo plano...');
                                    const tmpPath = path.join(__dirname, `tmp_${Date.now()}.${extension}`);
                                    fs.writeFileSync(tmpPath, audioBuffer);

                                    const FormData = require('form-data');
                                    const form = new FormData();
                                    form.append('file', fs.createReadStream(tmpPath), { filename: `audio.${extension}`, contentType: mimeType || 'audio/ogg' });
                                    form.append('model', 'whisper-1');
                                    form.append('language', 'es');

                                    const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
                                        headers: { ...form.getHeaders(), 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                                    });

                                    fs.unlinkSync(tmpPath);
                                    if (whisperRes.data?.text) {
                                        text = whisperRes.data.text;
                                        console.log(`🎙️ [WHISPER] Audio transcrito: "${text}"`);
                                    }
                                } catch (whisperErr) {
                                    console.error('❌ [WHISPER] Error transcribiendo audio:', whisperErr.message);
                                }
                            }

                            // ============================================================
                            // FILTRO DE CONTENIDO: Gemini analiza el audio antes de publicar.
                            // Solo se crea alerta si el contenido es realmente de tránsito.
                            // ============================================================
                            if (!text) {
                                console.log('🎙️ [AUDIO-FILTER] Sin transcripción previa. Analizando contenido con Gemini...');
                                const audioAnalysis = await callGeminiAudio(audioBuffer, mimeType);
                                
                                if (audioAnalysis) {
                                    if (!audioAnalysis.isTrafficAlert) {
                                        // Audio irrelevante: música, tutorial, charla personal, etc.
                                        console.log(`🚫 [AUDIO-FILTER] Audio DESCARTADO — no es tránsito. Razón: "${audioAnalysis.reason}"`);
                                        continue; // Saltar este mensaje completamente
                                    }
                                    // Es alerta de tránsito: usar la transcripción como texto
                                    text = audioAnalysis.transcription || '';
                                    console.log(`✅ [AUDIO-FILTER] Audio APROBADO como alerta de tránsito (${audioAnalysis.type}).`);
                                    // Si Gemini detectó dirección y tipo, crear alerta directamente
                                    isAudioOnlyAlert = false;
                                    await _processAlert(
                                        audioAnalysis.address || null,
                                        text || '[REPORTE_DE_VOZ]',
                                        groupName,
                                        audioAnalysis.type || 'checkpoint',
                                        msg.key.id,
                                        audioUrl,
                                        audioAnalysis.transcription ? audioAnalysis.transcription.substring(0, 100) : 'Reporte por audio de voz'
                                    );
                                    continue;
                                } else {
                                    // Gemini no disponible o falló: publicar como checkpoint genérico (comportamiento anterior)
                                    console.log('⚠️ [AUDIO-FILTER] Gemini no disponible, publicando como alerta genérica.');
                                    isAudioOnlyAlert = true;
                                }
                            }
                        } catch (err) {
                            console.error('❌ Error descargando audio:', err.message);
                        }
                    }

                    // --- RASTREO DE ANCHO DE BANDA (ENTRANTE) ---
                    _trackBandwidth(msg, 'in');

                    // --- COMANDO ADMIN: .consumo ---
                    if (text.trim().toLowerCase() === '.consumo') {
                        // El usuario indico 549341xxxxxxx, validamos que el emisor real arranque con ese prefijo o sea el mismo celular
                        const sender = msg.key.participant || msg.key.remoteJid;
                        const adminPrefix = process.env.ADMIN_NUMBER || '549341';
                        if (msg.key.fromMe || sender.includes(adminPrefix)) {
                            if (db) {
                                const snap = await db.ref('stats/consumo_bandwidth').once('value');
                                const stats = snap.val() || { total_bytes: 0, in_bytes: 0, out_bytes: 0 };
                                const mbTotal = (stats.total_bytes / (1024 * 1024)).toFixed(3);
                                const mbIn = ((stats.in_bytes || 0) / (1024 * 1024)).toFixed(3);
                                const mbOut = ((stats.out_bytes || 0) / (1024 * 1024)).toFixed(3);
                                
                                const totalGB = 100;
                                const usedGB = stats.total_bytes / (1024 * 1024 * 1024);
                                const percent = ((usedGB / totalGB) * 100).toFixed(6);
                                
                                const resText = `📊 *Consumo de Ancho de Banda (Render)*\n\n` +
                                                `📥 *Entrante:* ${mbIn} MB\n` +
                                                `📤 *Saliente:* ${mbOut} MB\n` +
                                                `🧮 *Total Consumido:* ${mbTotal} MB\n\n` +
                                                `📦 *Plan Total (Hobby):* ${totalGB} GB\n` +
                                                `📈 *Porcentaje de uso:* ${percent}%`;
                                
                                await sock.sendMessage(jid, { text: resText }, { quoted: msg });
                                _trackBandwidth(resText, 'out');
                            }
                            continue;
                        }
                    }

                    // --- COMANDO ADMIN: .test_audio ---
                    // Fuerza el procesamiento del audio adjunto como alerta de prueba desde CUALQUIER grupo
                    if (text.trim().toLowerCase().startsWith('.test_audio') && audioUrl) {
                        const sender = msg.key.participant || msg.key.remoteJid;
                        const adminPrefix = process.env.ADMIN_NUMBER || '549341';
                        if (msg.key.fromMe || sender.includes(adminPrefix)) {
                            console.log(`🧪 [TEST-AUDIO] Procesando audio de prueba del admin desde grupo: "${groupName}"`);
                            await _processAlert(null, '[PRUEBA_DE_VOZ]', `TEST - ${groupName}`, 'checkpoint', msg.key.id, audioUrl, 'Prueba de audio del administrador');
                            if (sock) {
                                await sock.sendMessage(jid, { text: '✅ *Audio de prueba procesado correctamente.*\n\nLa alerta fue publicada en el mapa con el audio adjunto. Verificá en la app.' }, { quoted: msg });
                            }
                            continue;
                        } else {
                            console.log(`⚠️ [TEST-AUDIO] Comando ignorado: el remitente no es admin.`);
                        }
                    }

                    // --- FILTRO DE PALABRAS PROHIBIDAS / INSULTOS ---
                    if (_containsForbiddenWords(text)) {
                        console.log(`🚫 [CENSOR] Mensaje descartado por contener insultos/palabras prohibidas: "${text}"`);
                        continue;
                    }

                    // Para audios sin texto: crear alerta directamente (ya validado que el grupo es operativo al descargar)
                    if (isAudioOnlyAlert && audioUrl) {
                        console.log(`🎤 [AUDIO-ALERTA] Audio de voz recibido del grupo operativo: "${groupName}". Creando alerta checkpoint.`);
                        await _processAlert(null, '[REPORTE_DE_VOZ]', groupName, 'checkpoint', msg.key.id, audioUrl, 'Reporte por audio de voz');
                        continue; // Saltar análisis de IA — no hay texto
                    }

                    // Si no es audio y no hay texto, saltar
                    if (!text) { console.log('⏭️ [SKIP] Sin texto'); continue; }

                    if (_isObviousChatter(text)) {
                        console.log(`⏭️ [SKIP-CHATTER] Omitiendo charla general/saludo obvio: "${text}"`);
                        continue;
                    }

                    console.log(`🧠 [GEMINI] Analizando: "${text.substring(0,60)}..." [Grupo: ${groupName}]`);
                    
                    try {
                        // Pasamos el nombre del grupo como CONTEXTO GEOGRÁFICO a Gemini
                        let analysis = await _analyzeMessageWithAI(text, groupName);
                        
                        // Si Gemini falla, usar detector de palabras clave
                        if (!analysis) {
                            const kw = _keywordDetect(text);
                            if (kw) {
                                // Si no hay dirección de keywords, intentar extraerla del texto
                                const extractedAddr = kw.address || _extractIntersection(text);
                                console.log(`🔑 [KEYWORD] Detectado: ${kw.type} | Dir: ${extractedAddr || 'sin dirección'}`);
                                analysis = { isAlert: true, type: kw.type, address: extractedAddr, description: text.substring(0, 100), confidence: 0.7 };
                            }
                        }
                        
                        if (analysis && analysis.isAlert) {
                            console.log(`🚨 [ALERT] Detectada por IA: type=${analysis.type}, address=${analysis.address}`);

                            // Guardar en Firebase (diagnóstico)
                            if (db) {
                                await db.ref('bot_alerts').push({
                                    group: groupName,
                                    text: text,
                                    analysis: analysis,
                                    timestamp: Date.now()
                                });
                            }

                            // Procesar la alerta pasando el message ID único, audioUrl y description
                            await _processAlert(analysis.address, text, groupName, analysis.type, msg.key.id, audioUrl, analysis.description);
                            
                        } else {
                            // Si no es alerta, ver si es una pregunta directa al bot
                            const botNumber = sock.user?.id?.split(':')[0] || '';
                            const isMentioned = text.toLowerCase().includes(botNumber) || text.toLowerCase().includes('bot');
                            // Responder charlas genéricas o preguntas por privado solo si viene de un admin de confianza y no es un mensaje saliente
                            const isPrivate = !isGroup && isFromTrustedAdmin && !msg.key.fromMe;

                            if ((isPrivate || isMentioned) && !msg.key.fromMe) {
                                console.log(`🧠 [CHAT] Respondiendo consulta...`);
                                const aiResponse = await callGemini(text);
                                if (aiResponse) {
                                    await sock.sendMessage(jid, { text: aiResponse }, { quoted: msg });
                                    _trackBandwidth(aiResponse, 'out');
                                }
                            }
                        }
                    } catch (err) {
                        console.error('❌ Error en el flujo de IA:', err.message);
                    }
                    } catch (outerErr) {
                        // Si es error de MAC, es un mensaje que no se puede descifrar (normal en WhatsApp)
                        // Solo logueamos y continuamos — no reseteamos la sesión
                        if (outerErr.message && (outerErr.message.includes('MAC') || outerErr.message.includes('decrypt'))) {
                            console.log('⚠️ [MAC] Mensaje no descifrable (llave desincronizada), saltando...');
                            continue; // Saltar este mensaje y procesar el siguiente
                        }
                        console.error('💥 [CRASH] Error procesando mensaje:', outerErr.message);
                    }
                }
            });

        } catch (err) {
            clearTimeout(lockWatchdog); // Matar watchdog en caso de error síncrono del constructor
            isConnecting = false; // 🔓 [DESBLOQUEO CRÍTICO] Liberar cerrojo para evitar deadlock permanente en reintentos
            console.error('❌ Error fatal en startSocket:', err.message);
            retryCount++;
            const delay = Math.min(10000 * retryCount, 60000);
            console.log(`🔄 Reintentando en ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            await startSocket();
        }
    }

    /**
     * Detección rápida por palabras clave (FALLBACK si Gemini falla)
     */
    function _keywordDetect(text) {
        const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Si es una pregunta o consulta (contiene ? o palabras de duda/pregunta), ignorar
        if (t.includes('?') || /\b(?:alguien\s+sabe|saben\s+si|info\b|reporta\s+si|saben\s+algo|hay\s+algo|alguien\s+vio|que\s+onda|pasa\s+algo|alguien\s+que\s+sepa)\b/i.test(t)) {
            return null;
        }
        if (/helicoptero|codigo rojo/.test(t)) return { type: 'helicopter', address: 'Pellegrini y Vera Mujica' };
        if (/accidente|choque/.test(t)) return { type: 'accident', address: null };
        if (/ambulancia|samu/.test(t)) return { type: 'ambulance', address: null };
        if (/bomberos|incendio|fuego/.test(t)) return { type: 'firetruck', address: null };
        if (/municipal|zorros|inspectores|carreton|grua|motos|fiscalizacion|fiscalisacion|fizca|fisca|fizcalizacion|fizcalisacion|servicio publico|servicios publicos|control de transito|operativo de transito|operativo transito/.test(t)) return { type: 'municipal', address: null };
        if (/gorra|ratis|chanchos|cana|policia|patrulla/.test(t)) return { type: 'police', address: null };
        if (/operativo|operatico|control/.test(t)) return { type: 'checkpoint', address: null };
        if (/radar|camara|foto multa|multa foto/.test(t)) return { type: 'radar', address: null };
        if (/corte|cortada|trafico|tráfico|transito|bache|inundacion/.test(t)) return { type: 'traffic', address: null };
        return null;
    }

    /**
     * Analiza el mensaje con Gemini (HTTP directo) para detectar alertas.
     */
    async function _analyzeMessageWithAI(text, groupName = '') {
        if (!GEMINI_KEY) return null;
        
        const prompt = `Analiza este mensaje de un grupo de WhatsApp de conductores de flota para detectar incidentes de tránsito y operativos en tiempo real.

REGLA DE EXCLUSIÓN DE PREGUNTAS (CRÍTICA):
- Si el mensaje es una pregunta, consulta o pedido de información (ej: "¿Hay operativo en la ruta?", "alguien sabe si hay zorros?", "en kenedy y la ruta hay operativo?", "cómo está tal calle?", "¿está libre Arijón?"), responde ESTRICTAMENTE con {"isAlert":false}. Solo debes reportar como alertas los avisos y reportes afirmativos de controles o incidentes activos.

REGLAS DE EXCLUSIÓN DE CHARLA GENERAL / AGRADECIMIENTOS (CRÍTICA):
- Si el mensaje es un saludo (ej: "buen día", "hola"), un agradecimiento o respuesta de cortesía (ej: "gracias viejo", "muchas gracias", "buenísimo gracias", "ok gracias", "muchas gracias de verdad"), o una conversación personal/comentario general que no reporta activamente un nuevo incidente (ej: "yo estoy saliendo de arroyo", "está complicado", "qué mala suerte", "quería saber gracias"), responde ESTRICTAMENTE con {"isAlert":false}.
- Solo debes reportar como alertas los reportes AFIRMATIVOS y CONCRETOS de controles, operativos, radares o incidentes viales activos.
        
CONTEXTO GEOGRÁFICO DE ORIGEN:
- Nombre del Grupo de WhatsApp: "${groupName}"
- Mensaje escrito por el conductor: "${text}"

REGLA DE DEDUCCIÓN ESPACIAL (CRÍTICA):
Los conductores raramente escriben la ciudad completa. Debes DEDUCIR e INFERIR la ubicación basándote fuertemente en el NOMBRE DEL GRUPO o en palabras clave del texto.
- Ciudades comunes en la región: "Rosario", "Arroyo Seco", "Pueblo Esther", "Funes", "Roldán", "San Lorenzo", "Granadero Baigorria", "Capitán Bermúdez", "Villa Constitución", "Pérez", "Ibarlucea", "Alvear", "Villa Gobernador Gálvez" (VGG).
- Si el nombre del grupo menciona una ciudad (ej: "Operativos Arroyo Seco", "Accidentes Pueblo Esther") o el mensaje menciona una de estas ciudades, asume ese contexto geográfico y agrégalo explícitamente a la dirección que devuelvas.

NORMALIZACIÓN DE ABREVIATURAS GLOBALES (IMPORTANTE):
- "av" / "av." = Avenida
- "bv" / "bvard" / "blvd" = Boulevard
- "pte" = Presidente
- "cba" = Córdoba
- "pcia" = Provincia
- "muni" = Municipal
- "cruce" = Intersección o Rotonda
- Corrige errores fonéticos obvios en nombres de calles locales pero JAMÁS alucines con direcciones en otros idiomas o países distantes si no corresponde.

REGLAS DE CLASIFICACIÓN (MUY IMPORTANTE - PRIORIDADES):
1. "CODIGO ROJO" / "HELICOPTERO" → tipo: "helicopter"
2. "ACCIDENTE", "CHOQUE", colisión vial → tipo: "accident"
3. "AMBULANCIA", "SAMU", urgencias médicas → tipo: "ambulance"
4. "BOMBEROS", "INCENDIO", "FUEGO" → tipo: "firetruck"
5. Si el mensaje menciona control "municipal", "grúa", "fiscalización", "fiscalisacion", "fizca", "fisca", "fizcalización", "fizcalisacion", "servicio público", "inspectores", "zorros", "motos" o acarreo de vehículos/motos (ej: "carretón", "llevando motos"), clasifícalo estrictamente como "municipal", incluso si también menciona presencia o apoyo policial. Ten en cuenta que los conductores suelen escribir rápido y con muchos errores de ortografía: "fizca", "fisca", "fizcalizacion", "fizcalisacion", "fiscalisacion" significan todas "fiscalización".
6. Mensajes que mencionen "policía", "patrulla", "operativo policial", "cuerpo policial", "comando" → tipo: "police" (solo si no califica como municipal).
7. Si menciona "OPERATIVO" (a veces escrito con errores como "operatico") o "CONTROL" genérico sin especificar fuerza → tipo: "checkpoint"
8. "RADAR", "CAMARA", "FOTOMULTA", "MULTA FOTO", "RADAR MOVIL" → tipo: "radar"
9. Cortes de calle, baches, inundaciones, protestas, tráfico pesado, tránsito demorado → tipo: "traffic"

Responde ÚNICAMENTE con un objeto JSON válido sin explicaciones ni formato markdown adicional:
{"isAlert":boolean,"type":"police"|"checkpoint"|"radar"|"helicopter"|"ambulance"|"firetruck"|"municipal"|"accident"|"traffic","address":"dirección completa con ciudad/región inferida o null","description":"un resumen extremadamente breve (máximo 8 palabras o 60 caracteres), limpio y directo en español, optimizado para ser leído por un conductor en pantalla mientras maneja (ejemplos: 'Control policial y de motos', 'Accidente vehicular - demora leve', 'Cruce cortado por bache', 'Inspectores con grúa'). Sin emojis, saludos ni rodeos.","confidence":0.0}
Si NO es una alerta de tránsito u operativo: {"isAlert":false}`;

        try {
            const jsonText = await callGemini(prompt);
            if (!jsonText) return null;
            const clean = jsonText.trim().replace(/```json|```/g, '').trim();
            const analysis = JSON.parse(clean);
            if (analysis.isAlert) {
                return analysis;
            }
        } catch (e) {
            console.error('❌ [GEMINI] Error parseando respuesta:', e.message);
        }
        return null;
    }

    /**
     * Extrae calles de un texto usando Regex.
     */
    function _extractIntersection(text) {
        // Normalizar texto reemplazando delimitadores de intersección comunes por " y "
        let normalized = text
            .replace(/\b(?:a\s+la\s+altura\s+de|esquina|esq\.?|entre|e\/)\b/gi, ' y ')
            .replace(/\s+/g, ' ');

        // Regex para "Calle A y Calle B"
        const regex = /([a-z0-9\sáéíóúñ.]+)\sy\s([a-z0-9\sáéíóúñ.]+)/i;
        const match = normalized.match(regex);
        if (match) {
            let street1 = match[1].trim();
            let street2 = match[2].trim();

            // 1. Limpiar street1: tomar la última parte que no tenga puntuación especial o emojis
            let cleanStreet1 = street1;
            let streetParts1 = street1.split(/[^a-zA-Z0-9\sáéíóúñÁÉÍÓÚÑ]/);
            if (streetParts1.length > 0) {
                for (let i = streetParts1.length - 1; i >= 0; i--) {
                    const segment = streetParts1[i].trim();
                    if (segment.length > 0) {
                        cleanStreet1 = segment;
                        break;
                    }
                }
            }

            // Limpiar palabras comunes al inicio de la primera calle
            const noise = ['hay', 'en', 'visto', 'un', 'el', 'una', 'operativo', 'control', 'la', 'los', 'las', 'del', 'de'];
            let words1 = cleanStreet1.split(' ');
            while (words1.length > 0 && noise.includes(words1[0].toLowerCase())) {
                words1.shift();
            }
            if (words1.length > 3) {
                words1 = words1.slice(-3);
            }
            cleanStreet1 = words1.join(' ');

            // 2. Limpiar street2: tomar la primera parte antes de la puntuación especial
            let cleanStreet2 = street2;
            let streetParts2 = street2.split(/[^a-zA-Z0-9\sáéíóúñÁÉÍÓÚÑ]/);
            if (streetParts2.length > 0) {
                for (let i = 0; i < streetParts2.length; i++) {
                    const segment = streetParts2[i].trim();
                    if (segment.length > 0) {
                        cleanStreet2 = segment;
                        break;
                    }
                }
            }

            // Cortar street2 en palabras clave que indican información colateral
            let words2 = cleanStreet2.split(' ');
            let cleanWords2 = [];
            for (let i = 0; i < words2.length; i++) {
                const w = words2[i].trim();
                if (['frente', 'cerca', 'atencion', 'eviten', 'zona', 'llega', 'operativo', 'control', 'en'].includes(w.toLowerCase())) {
                    break;
                }
                cleanWords2.push(w);
            }
            cleanStreet2 = cleanWords2.slice(0, 3).join(' ');

            if (cleanStreet1 && cleanStreet2) {
                return `${cleanStreet1} y ${cleanStreet2}`;
            }
        }
        return null;
    }
    /**
     * Diccionario de calles rosarinas: nombre popular → nombre completo
     * Para que Nominatim pueda encontrar "Roca y Corrientes" como "Presidente Roca y Corrientes"
     */
    const ROSARIO_STREET_ALIASES = {
        // Calles principales abreviadas
        'roca': 'Presidente Roca',
        'pellegrini': 'Carlos Pellegrini',
        'lagos': 'Ovidio Lagos',
        'oroño': 'Boulevard Oroño',
        'orono': 'Boulevard Oroño',
        'mitre': 'Bartolomé Mitre',
        'sarmiento': 'Domingo Sarmiento',
        'moreno': 'Mariano Moreno',
        'urquiza': 'Justo José de Urquiza',
        'brown': 'Almirante Brown',
        'belgrano': 'Manuel Belgrano',
        'rivadavia': 'Bernardino Rivadavia',
        'alvear': 'Marcelo T de Alvear',
        'alem': 'Leandro N Alem',
        'illia': 'Arturo Illia',
        'circunvalacion': 'Avenida de Circunvalación',
        'circunbalacion': 'Avenida de Circunvalación',
        'circunva': 'Avenida de Circunvalación',
        'circunbala': 'Avenida de Circunvalación',
        // Avenidas
        'francia': 'Avenida Francia',
        'españa': 'España',
        'alberdi': 'Juan Bautista Alberdi',
        'godoy': 'Avenida Presidente Perón',
        'arijon': 'Arijón',
        'avellaneda': 'Avenida Avellaneda',
        'eva peron': 'Avenida Eva Perón',
        'uriburu': 'Uriburu',
        'necochea': 'Necochea',
        'battle y ordoñez': 'Battle y Ordóñez',
        // Calles del centro
        'cafferata': 'Cafferata',
        'caferata': 'Cafferata',
        'corrientes': 'Corrientes',
        'cordoba': 'Córdoba',
        'cordova': 'Córdoba',
        'mendoza': 'Mendoza',
        'santa fe': 'Santa Fe',
        'san juan': 'San Juan',
        'san luis': 'San Luis',
        'san lorenzo': 'San Lorenzo',
        'san martin': 'San Martín',
        'san nicolas': 'San Nicolás',
        'rioja': 'La Rioja',
        'la rioja': 'La Rioja',
        'entre rios': 'Entre Ríos',
        'tucuman': 'Tucumán',
        'catamarca': 'Catamarca',
        'santiago': 'Santiago',
        'jujuy': 'Jujuy',
        'maipu': 'Maipú',
        'laprida': 'Laprida',
        'balcarce': 'Balcarce',
        'zeballos': 'Zeballos',
        'wheelwright': 'Wheelwright',
        'cochabamba': 'Cochabamba',
        'pasco': 'Pasco',
        'callao': 'Callao',
        'suipacha': 'Suipacha',
        'dorrego': 'Dorrego',
        'virasoro': 'Virasoro',
        'vera mujica': 'Vera Mujica',
        'ayacucho': 'Ayacucho',
        'montevideo': 'Montevideo',
        'ituzaingo': 'Ituzaingó',
        '27': '27 de Febrero',
        '27 de febrero': '27 de Febrero',
        'bv oroño': 'Boulevard Oroño',
        'bv. oroño': 'Boulevard Oroño',
        'bvar oroño': 'Boulevard Oroño',
        'juan jose paso': 'Juan José Paso',
        'jj paso': 'Juan José Paso',
        'peron': 'Avenida Presidente Perón',
        'newbery': 'Jorge Newbery',
        'warnes': 'Warnes',
    };

    /**
     * Expande nombres abreviados de calles rosarinas a sus nombres completos
     */
    function _expandStreetNames(address) {
        if (!address) return address;
        
        // Separar por " y " (intersección) o por " al " (altura)
        let parts;
        let separator;
        
        if (address.toLowerCase().includes(' y ')) {
            parts = address.split(/\s+y\s+/i);
            separator = ' y ';
        } else if (address.toLowerCase().includes(' al ')) {
            parts = address.split(/\s+al\s+/i);
            separator = ' al ';
        } else {
            parts = [address];
            separator = '';
        }

        const expanded = parts.map(part => {
            const trimmed = part.trim().toLowerCase();
            // Buscar coincidencia exacta primero
            if (ROSARIO_STREET_ALIASES[trimmed]) {
                return ROSARIO_STREET_ALIASES[trimmed];
            }
            // Buscar coincidencia parcial (si la calle tiene un número al final, ej: "roca 2000")
            const words = trimmed.split(' ');
            const lastWord = words[words.length - 1];
            const streetPart = words.slice(0, -1).join(' ');
            if (/^\d+$/.test(lastWord) && ROSARIO_STREET_ALIASES[streetPart]) {
                return `${ROSARIO_STREET_ALIASES[streetPart]} ${lastWord}`;
            }
            return part.trim(); // Devolver original si no hay alias
        });

        const result = expanded.join(separator);
        
        // CORRECCIÓN MATEMÁTICA ULTRA-ROBUSTA (HARDENING):
        // Evitamos de raíz que fallos de la IA o typos dejen "Avenida Oroño" o "Arizona"
        let hardened = result;
        
        if (/oroño|orono/i.test(hardened)) {
            // Reemplazar "Avenida Oroño" o "Av. Oroño" por "Boulevard Oroño"
            hardened = hardened.replace(/avenida\s+oro[ñn]o/gi, 'Boulevard Oroño')
                               .replace(/\bav\.?\s+oro[ñn]o/gi, 'Boulevard Oroño');
            
            // Si dice "Oroño" a secas, anteponer "Boulevard " si no tiene prefijo
            if (!/boulevard|bvar|bv\.?/i.test(hardened)) {
                hardened = hardened.replace(/\boro[ñn]o\b/gi, 'Boulevard Oroño');
            }
        }

        // Evitar la alucinación "Arizona" -> "Arijón"
        if (/arizona/i.test(hardened)) {
            hardened = hardened.replace(/\barizona\b/gi, 'Arijón');
        }

        if (hardened.toLowerCase() !== address.toLowerCase()) {
            console.log(`🏷️ [ALIAS] "${address}" -> "${hardened}"`);
        }
        return hardened;
    }

    /**
     * Geocodifica y guarda en Firebase.
     */
    const CITY_COORDINATES = {
        'Rosario': { lat: -32.9468, lng: -60.6393 },
        'Arroyo Seco': { lat: -33.1531, lng: -60.5239 },
        'Pueblo Esther': { lat: -33.0744, lng: -60.5750 },
        'Funes': { lat: -32.9168, lng: -60.8118 },
        'Roldán': { lat: -32.8986, lng: -60.9069 },
        'San Lorenzo': { lat: -32.7456, lng: -60.7335 },
        'Granadero Baigorria': { lat: -32.8533, lng: -60.6974 },
        'Capitán Bermúdez': { lat: -32.8184, lng: -60.7143 },
        'Villa Constitución': { lat: -33.2274, lng: -60.3294 },
        'Carcarañá': { lat: -32.8601, lng: -61.1448 },
        'Pérez': { lat: -32.9986, lng: -60.7709 },
        'Ibarlucea': { lat: -32.8624, lng: -60.7937 },
        'Alvear': { lat: -33.0401, lng: -60.6366 },
        'Villa Gobernador Gálvez': { lat: -32.9922, lng: -60.6300 }
    };

    function _detectCity(text, groupName = '') {
        const fullContent = `${groupName} ${text}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        if (/\barroyo\s+seco\b/.test(fullContent)) return 'Arroyo Seco';
        if (/\bpueblo\s+esther\b/.test(fullContent)) return 'Pueblo Esther';
        if (/\bfunes\b/.test(fullContent)) return 'Funes';
        if (/\broldan\b/.test(fullContent)) return 'Roldán';
        if (/\bsan\s+lorenzo\b/.test(fullContent)) return 'San Lorenzo';
        if (/\bbaigorria\b|\bgranadero\s+baigorria\b/.test(fullContent)) return 'Granadero Baigorria';
        if (/\bbermudez\b|\bcapitan\s+bermudez\b/.test(fullContent)) return 'Capitán Bermúdez';
        if (/\bvilla\s+constitucion\b/.test(fullContent)) return 'Villa Constitución';
        if (/\bcarcara[nñ]a\b/.test(fullContent)) return 'Carcarañá';
        if (/\bperez\b/.test(fullContent)) return 'Pérez';
        if (/\bibarlucea\b/.test(fullContent)) return 'Ibarlucea';
        if (/\balvear\b/.test(fullContent)) return 'Alvear';
        if (/\bshangri\b/.test(fullContent)) return 'Pueblo Esther';
        if (/\bvgg\b|\bvilla\s+gobernador\s+galvez\b/.test(fullContent)) return 'Villa Gobernador Gálvez';

        return 'Rosario';
    }

     async function _processAlert(address, originalText, sourceGroup, aiType = null, messageId = null, audioUrl = null, description = null) {
        const fleetId = await _resolveFleetId();
        // Generar una clave determinista basada en el ID de WhatsApp si existe.
        // Esto asegura que si se procesa el mismo mensaje 2 veces, se pise el registro en lugar de duplicarse en el mapa.
        const safeMsgId = messageId ? `wsp_${messageId.replace(/[^a-zA-Z0-9_]/g, '_')}` : `bot_${Date.now()}`;
        const alertId = safeMsgId;
        
        // Determinar tipo
        let type = aiType || (/gorra|control|operativo|zorros|chanchos|ratis/i.test(originalText) ? 'police' : 'warning');
        
        // Detectar ciudad
        const city = _detectCity(originalText, sourceGroup);
        const cityCoords = CITY_COORDINATES[city] || CITY_COORDINATES['Rosario'];
        
        let lat = cityCoords.lat;
        let lng = cityCoords.lng;
        let approximate = true;
        let expandedAddress = address;
        
        try {
            // Caso especial: Helicóptero en Pellegrini y Vera Mujica (HECA)
            if (type === 'helicopter' || /codigo rojo|helicoptero/i.test(originalText)) {
                lat = -32.9515;
                lng = -60.6625;
                approximate = false;
                expandedAddress = "Pellegrini y Vera Mujica";
                console.log('🚁 [HECA] Ubicación forzada para Helicóptero Sanitario');
            } else if (!address || address === 'null') {
                // Sin dirección: usar ubicación neutra
                console.log(`⚠️ [GEO] Sin dirección exacta. Usando centro de ${city}`);
            } else {
                expandedAddress = _expandStreetNames(address);
                let isResolved = false;
                
                // --- NIVEL 1: GOOGLE MAPS GEOCODING API (Gold Standard) ---
                // Dado que el usuario ya cuenta con facturación vinculada y clave oficial, habilitamos este canal ultrapreciso.
                const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyATwi1CCdw5q-8nYXTsTn8VCKoP13jbHBE';
                if (googleApiKey) {
                    try {
                        console.log(`🔍 [GEO-GOOGLE] Intentando geocodificación prémium para: "${expandedAddress}" en ciudad: "${city}"`);
                        // Buscamos forzando la región y el idioma en Argentina
                        const queryAddress = `${expandedAddress}, ${city}, Santa Fe, Argentina`;
                        const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(queryAddress)}&language=es&region=AR&key=${googleApiKey}`;
                        const gResponse = await axios.get(gUrl, { timeout: 6000 });
                        
                        if (gResponse.data?.status === 'OK' && gResponse.data.results?.length > 0) {
                            const loc = gResponse.data.results[0].geometry.location;
                            lat = parseFloat(loc.lat);
                            lng = parseFloat(loc.lng);
                            approximate = false;
                            isResolved = true;
                            console.log(`📍 [GEO-GOOGLE] ✅ ¡Ubicación perfecta detectada! Lat=${lat}, Lng=${lng}`);
                        } else {
                            console.warn(`⚠️ [GEO-GOOGLE] Fallo en respuesta (status=${gResponse.data?.status || 'UNKNOWN'}). Procediendo al fallback gratuito...`);
                        }
                    } catch (errG) {
                        console.warn(`⚠️ [GEO-GOOGLE] Error de conexión o autorización: ${errG.message}. Procediendo al fallback gratuito...`);
                    }
                }

                // --- NIVEL 2: PHOTON FALLBACK (En caso de que la API de Google no esté activada en la consola) ---
                if (!isResolved) {
                    // Respetar delay básico para evitar rate limits
                    await new Promise(r => setTimeout(r, 1200));
                    
                    console.log(`🔍 [GEO-PHOTON] Ejecutando consulta gratuita de emergencia para: "${expandedAddress}" en ciudad: "${city}"`);
                    
                    // REPARACIÓN CRÍTICA: Reemplazar " y " por ", " para Photon/OpenStreetMap
                    const cleanAddressForGeo = expandedAddress.replace(/\s+[yY]\s+/gi, ', ');
                    const fullAddress = `${cleanAddressForGeo}, ${city}, Argentina`;
                    
                    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(fullAddress)}&limit=1&lat=${cityCoords.lat}&lon=${cityCoords.lng}`;
                    const response = await axios.get(url, { timeout: 8000 });
                    const features = response.data?.features || [];

                    if (features.length > 0 && features[0].geometry?.coordinates) {
                        const tempLng = parseFloat(features[0].geometry.coordinates[0]);
                        const tempLat = parseFloat(features[0].geometry.coordinates[1]);
                        
                        // Sin validación de cercanía geocodificada obligatoria (Modo Internacional)
                        lng = tempLng;
                        lat = tempLat;
                        approximate = false;
                        console.log(`📍 [GEO-PHOTON] ✅ Ubicación detectada: ${lat}, ${lng}`);
                    } else {
                        console.log(`⚠️ [GEO-PHOTON] Sin resultados.`);
                    }
                }
            }
        } catch (err) {
            console.error(`⚠️ [GEO] Error (${err.message}), guardando con ubicación aproximada`);
        }

        const alertData = {
            id: alertId,
            type: type,
            location: expandedAddress || "Ubicación desconocida",
            lat: lat,
            lng: lng,
            timestamp: Date.now(),
            expiresAt: Date.now() + (60 * 60 * 1000),
            authorName: sourceGroup,
            originalText: originalText,
            description: description || (originalText ? originalText.substring(0, 60) : ''),
            confirmations: approximate ? 0 : 1,
            status: 'active',
            source: 'whatsapp_bot',
            approximate: approximate
        };
        if (audioUrl) {
            alertData.audioUrl = audioUrl;
        }

        console.log(`💾 [DB] Guardando alerta en TODAS las flotas...`);

        if (db) {
            try {
                // Broadcast a TODAS las flotas para evitar problemas de mismatch
                const snap = await db.ref('fleets').once('value');
                const fleets = snap.val() || {};
                
                const updatePromises = Object.keys(fleets).map(fId => {
                    return db.ref(`fleets/${fId}/traffic_alerts/${alertId}`).set(alertData);
                });
                
                await Promise.all(updatePromises);
                console.log(`✅ [DB] ¡¡¡ALERTA PUBLICADA EN ${updatePromises.length} FLOTAS!!! type=${alertData.type}, lat=${lat}, lng=${lng}, exact=${!approximate}`);

                // Send push notification to admins
                const alertTypeNames = {
                    police: 'Control de Policía 👮',
                    checkpoint: 'Operativo / Control 🚧',
                    radar: 'Radar / Fotomulta 📷',
                    helicopter: 'Helicóptero HECA 🚁',
                    traffic: 'Alerta de Tráfico 🚦',
                    warning: 'Alerta de Tránsito ⚠️'
                };
                const typeName = alertTypeNames[alertData.type] || 'Alerta de Tránsito ⚠️';
                sendPushToAdmins(
                    `🚨 ${typeName}`,
                    `Ubicación: ${alertData.location}. Reportado en el grupo: ${sourceGroup}`,
                    { alertId: alertId, type: alertData.type }
                );
            } catch (e) {
                console.error('❌ [FIREBASE] Error guardando alerta en flotas:', e.message);
            }
        } else {
            console.error('❌ [DB] Firebase db es NULL - NO SE PUEDE GUARDAR');
        }
    }

    async function sendPushToAdmins(title, body, additionalData = {}) {
        if (!db) {
            console.log('🔔 [PUSH] DB not ready, cannot send push.');
            return;
        }
        try {
            const tokensSnap = await db.ref('fcm_tokens').once('value');
            const tokensVal = tokensSnap.val();
            if (!tokensVal) {
                console.log('🔔 [PUSH] No FCM tokens found in DB.');
                return;
            }

            const adminTokens = [];
            for (const [userId, tData] of Object.entries(tokensVal)) {
                if (tData.token && tData.role === 'admin') {
                    adminTokens.push(tData.token);
                }
            }

            if (adminTokens.length === 0) {
                console.log('🔔 [PUSH] No admin FCM tokens found.');
                return;
            }

            console.log(`🔔 [PUSH] Sending notification to ${adminTokens.length} admin(s): "${title} - ${body}"`);

            const payload = {
                notification: {
                    title: title,
                    body: body
                },
                data: {
                    title: title,
                    body: body,
                    url: '/',
                    ...additionalData
                }
            };

            const response = await admin.messaging().sendEachForMulticast({
                tokens: adminTokens,
                notification: payload.notification,
                data: payload.data
            });

            console.log(`🔔 [PUSH] Multicast sent. Success: ${response.successCount}, Failure: ${response.failureCount}`);

            // Cleanup inactive tokens
            if (response.responses) {
                response.responses.forEach(async (resp, idx) => {
                    if (!resp.success) {
                        const errCode = resp.error?.code;
                        if (errCode === 'messaging/registration-token-not-registered' || errCode === 'messaging/invalid-registration-token') {
                            const tokenToRemove = adminTokens[idx];
                            for (const [uId, tData] of Object.entries(tokensVal)) {
                                if (tData.token === tokenToRemove) {
                                    console.log(`🧹 [PUSH] Removing inactive token for user: ${uId}`);
                                    await db.ref(`fcm_tokens/${uId}`).remove();
                                    break;
                                }
                            }
                        }
                    }
                });
            }
        } catch (e) {
            console.error('❌ [PUSH] Error sending push notification:', e.message);
        }
    }

    async function checkFCMTokensAndDetectUninstalls() {
        if (!db) {
            console.log('📊 [UNINSTALL-SCANNER] DB not ready, skipping check.');
            return;
        }
        try {
            console.log('📊 [UNINSTALL-SCANNER] Starting FCM token verification scan...');
            const tokensSnap = await db.ref('fcm_tokens').once('value');
            const tokensVal = tokensSnap.val();
            if (!tokensVal) {
                console.log('📊 [UNINSTALL-SCANNER] No tokens to verify.');
                return;
            }

            let uninstalledCount = 0;
            let checkedCount = 0;

            for (const [userId, tData] of Object.entries(tokensVal)) {
                if (!tData.token) continue;
                checkedCount++;
                try {
                    // Validate token via dry-run send (it doesn't actually deliver a notification)
                    await admin.messaging().send({
                        token: tData.token,
                        data: { dryRun: 'true' }
                    }, true);
                } catch (error) {
                    const errCode = error.code;
                    if (errCode === 'messaging/registration-token-not-registered' || 
                        errCode === 'messaging/invalid-registration-token') {
                        
                        console.log(`📊 [UNINSTALL-SCANNER] Uninstall detected for user: ${userId} (${tData.userName || 'Unknown'})`);
                        
                        // Mark as uninstalled in app_installations
                        const now = Date.now();
                        await db.ref(`app_installations/${userId}`).update({
                            status: 'uninstalled',
                            uninstalledAt: now,
                            lastActive: now
                        });

                        // Remove the obsolete token from fcm_tokens to stop testing it
                        await db.ref(`fcm_tokens/${userId}`).remove();
                        uninstalledCount++;
                    } else {
                        console.warn(`📊 [UNINSTALL-SCANNER] Other validation error for user ${userId}:`, error.message);
                    }
                }
            }
            console.log(`📊 [UNINSTALL-SCANNER] Scan complete. Checked: ${checkedCount}, Uninstalls detected: ${uninstalledCount}`);
        } catch (err) {
            console.error('❌ [UNINSTALL-SCANNER] Error during FCM scan:', err.message);
        }
    }


    async function resetSession() {
        console.log('🔄 [RESET] Forzando limpieza de sesión COMPLETA (Requiere QR)...');
        if (sock) {
            try { await sock.logout(); } catch(e) { /* ignorar */ }
            sock = null;
        }
        await clearAuthInfo();
        await new Promise(r => setTimeout(r, 3000));
        await startSocket();
        console.log('✅ [RESET] Sesión limpiada, bot reiniciado. Buscá el QR en los logs.');
    }

    async function softResetSession() {
        console.log('🔧 [SOFT-RESET] Aplicando curación manual sin pérdida de emparejamiento...');
        if (sock) {
            try { sock.end(); } catch(e) {}
            sock = null;
        }
        await softResetAuthInfo();
        await new Promise(r => setTimeout(r, 3000));
        retryCount = 0;
        await startSocket();
        console.log('✅ [SOFT-RESET] Autocuración ejecutada, intentando reconexión instantánea.');
    }

    /**
     * Limpieza automática de Base de Datos: elimina alertas expiradas y posiciones viejas.
     * Se ejecuta al iniciar y luego cada 12 horas.
     */
    function _startDatabaseCleanup() {
        if (!db) return;
        console.log('🧹 [CRON] Sistema de auto-limpieza de DB programado (cada 12hs).');
        
        async function runCleanup() {
            try {
                const now = Date.now();
                console.log('🧹 [CRON] Iniciando limpieza automática de DB...');

                // 1. Purgar Traffic Alerts viejas (más de 24hs)
                const cutOffAlerts = now - (24 * 60 * 60 * 1000);
                const fleetsSnap = await db.ref('fleets').once('value');
                const fleets = fleetsSnap.val();
                
                let countAlerts = 0;
                const audioFilesToDelete = new Set();
                if (fleets) {
                    for (const fid in fleets) {
                        const alerts = fleets[fid].traffic_alerts;
                        if (alerts) {
                            for (const aid in alerts) {
                                const a = alerts[aid];
                                // Si tiene timestamp y es más viejo que 24hs, O si expiró explícitamente
                                if ((a.timestamp && a.timestamp < cutOffAlerts) || (a.expiresAt && a.expiresAt < now)) {
                                    if (a.audioUrl) {
                                        audioFilesToDelete.add(a.audioUrl);
                                    }
                                    await db.ref(`fleets/${fid}/traffic_alerts/${aid}`).remove();
                                    countAlerts++;
                                }
                            }
                        }
                    }
                }

                // Borrar archivos de audio físicos si expiraron
                if (audioFilesToDelete.size > 0) {
                    const audioDestDir = path.join(__dirname, '../../audio');
                    for (const url of audioFilesToDelete) {
                        try {
                            const filename = path.basename(url);
                            const filepath = path.join(audioDestDir, filename);
                            if (fs.existsSync(filepath)) {
                                fs.unlinkSync(filepath);
                                console.log(`🧹 [CRON] Audio eliminado físicamente: ${filepath}`);
                            }
                        } catch (err) {
                            console.error(`❌ [CRON] Error eliminando audio: ${url}`, err.message);
                        }
                    }
                }

                // 2. Purgar Posiciones GPS fantasma (inactivas más de 12 horas)
                const cutOffGps = now - (12 * 60 * 60 * 1000);
                const positionsSnap = await db.ref('driver_positions').once('value');
                const positions = positionsSnap.val();
                
                let countPositions = 0;
                if (positions) {
                    for (const uid in positions) {
                        const p = positions[uid];
                        // Usar el timestamp o _lastUpdate
                        const ts = p.timestamp || p._lastUpdate || p.lastUpdate;
                        if (ts && ts < cutOffGps) {
                            await db.ref(`driver_positions/${uid}`).remove();
                            countPositions++;
                        }
                    }
                }

                // 3. Verificar desinstalaciones vía tokens de FCM
                await checkFCMTokensAndDetectUninstalls();

                console.log(`✨ [CRON] Limpieza finalizada. Removidas ${countAlerts} alertas viejas y ${countPositions} posiciones fantasma.`);

            } catch (e) {
                console.error('❌ [CRON] Error en rutina de limpieza DB:', e.message);
            }
        }

        // Ejecutar la primera vez después de 2 minutos (para no saturar el arranque del bot)
        setTimeout(runCleanup, 120000);
        // Programar cada 12 horas
        setInterval(runCleanup, 12 * 60 * 60 * 1000);
    }

    // Escuchar señales de terminación del SO (evita colisiones 440 Zombies durante redeploys)
    process.on('SIGTERM', () => {
        console.log('🛑 [SIGTERM] Solicitud de apagado recibida. Cerrando socket WhatsApp y liberando sesión...');
        if (sock) { try { sock.end(); } catch(e) {} }
        setTimeout(() => process.exit(0), 500);
    });
    process.on('SIGINT', () => {
        console.log('🛑 [SIGINT] Cerrando socket y saliendo...');
        if (sock) { try { sock.end(); } catch(e) {} }
        setTimeout(() => process.exit(0), 500);
    });

    return { 
        init, 
        resetSession,
        softResetSession,
        getFleetId: _resolveFleetId,
        getDb: () => db,
        isConnected: () => _isConnectedState,
        sendPushToAdmins
    };
})();

module.exports = WhatsappBot;
