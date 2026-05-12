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
// Probar modelos en orden — v1beta es lo que soportan las keys de Google AI Studio
const GEMINI_MODELS = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.0-pro:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',
];
let GEMINI_URL = null; // Se inicializa al primer uso exitoso

async function callGemini(prompt) {
    if (!GEMINI_KEY) return null;
    const urls = GEMINI_URL ? [GEMINI_URL] : GEMINI_MODELS;
    for (const url of urls) {
        try {
            const res = await axios.post(`${url}?key=${GEMINI_KEY}`, {
                contents: [{ parts: [{ text: prompt }] }]
            }, { timeout: 15000 });
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


// 1. Inicialización de Firebase Admin
let db = null;

if (!admin.apps.length) {
    try {
        let credential = null;

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

        admin.initializeApp({
            credential,
            databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${process.env.FIREBASE_PROJECT_ID || 'fleetadmin-pro'}-default-rtdb.firebaseio.com`
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
    const MAX_RETRIES = 10;
    const AUTH_DIR = './auth_info';

    // Diccionario de Slang Rosarino (Sincronizado con el cliente)
    const ALERT_KEYWORDS = ['gorra', 'operativo', 'control', 'zorros', 'chanchos', 'palo', 'parando', 'evitar', 'ratis'];

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
        if (msg.includes('MAC') || msg.includes('decrypt') || msg.includes('Bad MAC')) {
            console.log('⚠️ [MAC] Mensaje no descifrable (normal después de reinicio), ignorado.');
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
        
        // Esperar 30s al inicio para que el proceso anterior de Render muera
        console.log('⏳ Esperando 30s para que el proceso anterior libere la sesión...');
        await new Promise(r => setTimeout(r, 30000));
        console.log('✅ Espera terminada. Conectando a WhatsApp...');
        
        // Auto-ping cada 10 minutos para evitar que Render (free tier) duerma el servicio
        const selfUrl = process.env.RENDER_EXTERNAL_URL || 'https://fleetadmin-pro-1.onrender.com';
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

    async function startSocket() {
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
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = DisconnectReason;
                    
                    console.log(`⚠️ Conexión cerrada. Código: ${statusCode}`);

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
                        // 440 = conflicto de sesión: esperar más tiempo en cada reintento
                        // 1º: 90s, 2º: 3min, 3º: 5min (para dejar que el proceso viejo muera)
                        const delay440 = Math.min(90000 * retryCount, 300000);
                        console.log(`⚠️ [${statusCode}] Conflicto de sesión. Intento ${retryCount}. Esperando ${delay440/1000}s...`);
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
                    retryCount = 0;
                    console.log('✅ ¡Bot de WhatsApp CONECTADO!');
                }
            });

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                console.log(`📨 [UPSERT] type=${type}, count=${messages.length}`);
                if (type !== 'notify') return;

                for (const msg of messages) {
                    try {
                    const jid = msg.key.remoteJid;
                    const isGroup = jid?.endsWith('@g.us');
                    
                    // Solo analizar mensajes de GRUPOS — privados siempre ignorados
                    if (!isGroup) { console.log('⏭️ [SKIP] Privado, ignorado'); continue; }
                    
                    // En grupos: procesar TODOS los mensajes (incluso fromMe)
                    // El dueño puede enviar alertas desde su celular/WhatsApp Web
                    // Solo saltar mensajes de estado del sistema (sin remoteJid válido)
                    if (!jid) continue;

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
                    
                    // PTT = nota de voz (mantener micrófono), audioMessage = archivo de audio adjunto
                    const isAudio = msg.message?.audioMessage || msg.message?.pttMessage;

                    console.log(`📩 [MSG] From=${jid?.substring(0,15)}... | Group=${isGroup} | Audio=${!!isAudio} | PTT=${!!msg.message?.pttMessage} | Text="${text.substring(0,80)}"`);


                    // 1. PROCESAR AUDIO (Speech-to-Text con OpenAI Whisper)
                    if (isAudio && process.env.OPENAI_API_KEY) {
                        try {
                            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { 
                                logger: P({ level: 'silent' }),
                                reuploadRequest: sock.updateMediaMessage 
                            });

                            const tmpPath = path.join(__dirname, `tmp_${Date.now()}.ogg`);
                            fs.writeFileSync(tmpPath, buffer);

                            const FormData = require('form-data');
                            const form = new FormData();
                            form.append('file', fs.createReadStream(tmpPath), { filename: 'audio.ogg', contentType: 'audio/ogg' });
                            form.append('model', 'whisper-1');
                            form.append('language', 'es');

                            const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
                                headers: { ...form.getHeaders(), 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                            });

                            fs.unlinkSync(tmpPath);
                            if (whisperRes.data?.text) {
                                text = whisperRes.data.text;
                                console.log(`🎙️ Audio transcrito: "${text}"`);
                            }
                        } catch (err) { console.error('❌ Error audio:', err.message); }
                    }

                    if (!text) { console.log('⏭️ [SKIP] Sin texto'); continue; }

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

                    // --- ANÁLISIS: GEMINI + FALLBACK POR PALABRAS CLAVE ---
                    console.log(`🧠 [GEMINI] Analizando: "${text.substring(0,60)}..."`);
                    
                    try {
                        let analysis = await _analyzeMessageWithAI(text);
                        
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
                            
                            let groupName = 'Privado';
                            if (isGroup) {
                                try {
                                    const groupInfo = await sock.groupMetadata(jid);
                                    groupName = groupInfo.subject;
                                } catch(ge) { groupName = 'Grupo Desconocido'; }
                            }

                            // Guardar en Firebase (diagnóstico)
                            if (db) {
                                await db.ref('bot_alerts').push({
                                    group: groupName,
                                    text: text,
                                    analysis: analysis,
                                    timestamp: Date.now()
                                });
                            }

                            // Procesar la alerta
                            await _processAlert(analysis.address, text, groupName, analysis.type);
                            
                        } else {
                            // Si no es alerta, ver si es una pregunta directa al bot
                            const botNumber = sock.user?.id?.split(':')[0] || '';
                            const isMentioned = text.toLowerCase().includes(botNumber) || text.toLowerCase().includes('bot');
                            const isPrivate = !isGroup;

                            if (isPrivate || isMentioned) {
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
        if (/helicoptero|codigo rojo/.test(t)) return { type: 'helicopter', address: 'Pellegrini y Vera Mujica' };
        if (/gorra|ratis|chanchos|cana|policia|patrulla/.test(t)) return { type: 'police', address: null };
        if (/operativo|operatico|control/.test(t)) return { type: 'checkpoint', address: null };
        if (/radar|camara|foto multa|multa foto/.test(t)) return { type: 'radar', address: null };
        if (/ambulancia|samu/.test(t)) return { type: 'ambulance', address: null };
        if (/bomberos|incendio|fuego/.test(t)) return { type: 'firetruck', address: null };
        if (/municipal|transito|zorros|inspectores/.test(t)) return { type: 'municipal', address: null };
        if (/accidente|choque/.test(t)) return { type: 'accident', address: null };
        if (/corte|cortada|trafico|tráfico|bache|inundacion/.test(t)) return { type: 'traffic', address: null };
        return null;
    }

    /**
     * Analiza el mensaje con Gemini (HTTP directo) para detectar alertas.
     */
    async function _analyzeMessageWithAI(text) {
        if (!GEMINI_KEY) return null;
        
        const prompt = `Analiza este mensaje de un grupo de WhatsApp de choferes de Uber/Didi en la zona de Rosario, Argentina.
Mensaje: "${text}"

ABREVIATURAS COMUNES (IMPORTANTE — resolvé estas SIEMPRE):
- "vgg" / "VGG" / "v.g.g" = Villa Gobernador Gálvez
- "vgb" = Villa Gobernador Gálvez (variante)  
- "bv" / "bvard" / "bulevard" = Boulevard
- "av" = Avenida
- "pte" = Presidente
- "cba" = Córdoba (la calle, no la provincia)
- "pcia" = Provincia
- "muni" = Municipal
- "oño" / "oroño" = Oroño

LUGARES CONOCIDOS DE ROSARIO (usá estas direcciones exactas si se mencionan):
- "cancha de Central" / "Arroyito" / "estadio de Central" → "Avenida Gorriti 2001"
- "cancha de Ñuls" / "cancha de Newells" / "el Parque" → "Miguel Lamas y Cafferata"
- "el monumento" → "Belgrano y Córdoba"
- "la terminal" / "terminal de ómnibus" → "Cafferata 702"
- "el HECA" / "hospital de emergencias" → "Pellegrini y Vera Mujica"
- "el Puerto" / "zona del puerto" → "Avenida Estación del Puerto"
- "el Parque Independencia" → "Av. Oroño y Pellegrini"
- "el shopping Alto Rosario" → "Junín 501"
- "el Portal" / "shopping Portal" → "Av. Presidente Perón 4200"
- "la Facultad" / "UNR" → "Maipú y Corrientes"
- "el aeropuerto" → "Av. Vías del Ferrocarril 1000, Fisherton"
- "Fisherton" → "zona Av. Dante Alighieri, Rosario"
- "Tablada" → "zona Av. Presidente Perón, Rosario"
- "Villa Gobernador Gálvez" / "VGG" → "Av. Alberdi 800, Villa Gobernador Gálvez"
- "cementerio" + "vgg" / "Villa Gobernador Gálvez" → "Cementerio, Villa Gobernador Gálvez"
- "Funes" → "Funes, Santa Fe"
- "Pérez" → "Pérez, Santa Fe"
- "Granadero Baigorria" / "baigorria" → "Granadero Baigorria, Santa Fe"

REGLAS DE CLASIFICACIÓN (MUY IMPORTANTE - leé con cuidado):
1. "CODIGO ROJO" / "HELICOPTERO" → tipo: "helicopter", address: "Pellegrini y Vera Mujica"
2. Si el mensaje dice EXPLÍCITAMENTE "policía", "cana", "ratis", "chanchos", "gorra", "patrulla" → tipo: "police"
3. Si el mensaje dice EXPLÍCITAMENTE "municipal", "tránsito municipal", "grúa municipal", "zorros", "inspectores" → tipo: "municipal"
4. Si el mensaje dice EXPLÍCITAMENTE "gendarmería" o "gendarme" → tipo: "police" (subtipo gendarmería)
5. Si el mensaje dice EXPLÍCITAMENTE "prefectura" → tipo: "police" (subtipo prefectura)
6. Si dice "OPERATIVO" o "CONTROL" de forma GENÉRICA sin especificar qué fuerza → tipo: "checkpoint" (NO asumas que es policía)
7. "RADAR", "CAMARA", "MULTA FOTO", "FOTO MULTA", "RADAR MOVIL" → tipo: "radar"
8. "AMBULANCIA", "SAMU", "107" → tipo: "ambulance"
9. "BOMBEROS", "INCENDIO", "FUEGO" → tipo: "firetruck"
10. "ACCIDENTE", "CHOQUE" → tipo: "accident"
11. Cortes, baches, inundaciones, tráfico pesado → tipo: "traffic"

Responde SOLO JSON válido:
{"isAlert":boolean,"type":"police"|"checkpoint"|"radar"|"helicopter"|"ambulance"|"firetruck"|"municipal"|"accident"|"traffic","address":"dirección completa o null","description":"resumen breve","confidence":0.0}
Si NO es alerta: {"isAlert":false}
Si CODIGO ROJO: address="Pellegrini y Vera Mujica"`;

        try {
            const jsonText = await callGemini(prompt);
            if (!jsonText) return null;
            const clean = jsonText.trim().replace(/```json|```/g, '').trim();
            const analysis = JSON.parse(clean);
            if (analysis.isAlert && analysis.address && analysis.address !== 'null') {
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
        // Regex para "Calle A y Calle B"
        const regex = /([a-z0-9\sáéíóúñ]+)\sy\s([a-z0-9\sáéíóúñ]+)/i;
        const match = text.match(regex);
        if (match) {
            let street1 = match[1].trim();
            let street2 = match[2].trim();

            // Limpiar palabras comunes al inicio de la primera calle
            const noise = ['hay', 'en', 'visto', 'un', 'el', 'una', 'un', 'operativo', 'control', 'la', 'los', 'las'];
            let words = street1.split(' ');
            while (words.length > 0 && noise.includes(words[0].toLowerCase())) {
                words.shift();
            }
            street1 = words.join(' ');

            if (street1 && street2) {
                return `${street1} y ${street2}`;
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
        if (result.toLowerCase() !== address.toLowerCase()) {
            console.log(`📝 [ALIAS] "${address}" → "${result}"`);
        }
        return result;
    }

    /**
     * Geocodifica y guarda en Firebase.
     */
    async function _processAlert(address, originalText, sourceGroup, aiType = null) {
        const fleetId = await _resolveFleetId();
        const alertId = `bot_${Date.now()}`;
        
        // Determinar tipo
        let type = aiType || (/gorra|control|operativo|zorros|chanchos|ratis/i.test(originalText) ? 'police' : 'warning');
        
        let lat = -32.9468; // Centro de Rosario (fallback)
        let lng = -60.6393;
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
                // Sin dirección: usar centro de Rosario directamente
                console.log('⚠️ [GEO] Sin dirección exacta, usando centro de Rosario');
            } else {
                // Respetar rate limit de Nominatim (1 req/segundo)
                await new Promise(r => setTimeout(r, 1500));
                
                expandedAddress = _expandStreetNames(address);
                console.log(`🔍 [GEO] Geocodificando: "${expandedAddress}" en Rosario...`);
                
                // REPARACIÓN CRÍTICA: Reemplazar " y " por ", " para que Photon/OpenStreetMap identifique el cruce de calles.
                // Photon falla si ve la palabra de enlace "y". Con la coma encuentra la intersección central de inmediato.
                const cleanAddressForGeo = expandedAddress.replace(/\s+[yY]\s+/gi, ', ');
                const fullAddress = `${cleanAddressForGeo}, Rosario, Argentina`;
                
                // Usamos Photon con sesgo espacial forzado al Centro de Rosario (-32.9477, -60.6652) para dar prioridad absoluta a la zona urbana central
                const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(fullAddress)}&limit=1&lat=-32.9477&lon=-60.6652`;
                console.log(`🌐 [GEO] URL Photon: ${url.substring(0,100)}...`);
                
                const response = await axios.get(url, { timeout: 10000 });
                const features = response.data?.features || [];

                console.log(`🌐 [GEO] Respuesta: ${features.length} resultados`);

                if (features.length > 0 && features[0].geometry?.coordinates) {
                    // Photon devuelve [lon, lat]
                    lng = parseFloat(features[0].geometry.coordinates[0]);
                    lat = parseFloat(features[0].geometry.coordinates[1]);
                    approximate = false;
                    console.log(`📍 [GEO] ✅ Ubicación exacta: ${lat}, ${lng}`);
                } else {
                    console.log(`⚠️ [GEO] Sin resultados, usando centro de Rosario`);
                }
            }
        } catch (err) {
            console.error(`⚠️ [GEO] Error (${err.message}), guardando con ubicación aproximada`);
        }

        const alertData = {
            id: alertId,
            type: type,
            location: expandedAddress || "Rosario (ubicación aprox.)",
            lat: lat,
            lng: lng,
            timestamp: Date.now(),
            expiresAt: Date.now() + (60 * 60 * 1000),
            authorName: sourceGroup,
            originalText: originalText,
            confirmations: approximate ? 0 : 1,
            status: 'active',
            source: 'whatsapp_bot',
            approximate: approximate
        };

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
            } catch (e) {
                console.error('❌ [FIREBASE] Error guardando alerta en flotas:', e.message);
            }
        } else {
            console.error('❌ [DB] Firebase db es NULL - NO SE PUEDE GUARDAR');
        }
    }

    async function resetSession() {
        console.log('🔄 [RESET] Forzando limpieza de sesión...');
        if (sock) {
            try { await sock.logout(); } catch(e) { /* ignorar */ }
            sock = null;
        }
        await clearAuthInfo();
        await new Promise(r => setTimeout(r, 3000));
        await startSocket();
        console.log('✅ [RESET] Sesión limpiada, bot reiniciado. Buscá el QR en los logs.');
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
                if (fleets) {
                    for (const fid in fleets) {
                        const alerts = fleets[fid].traffic_alerts;
                        if (alerts) {
                            for (const aid in alerts) {
                                const a = alerts[aid];
                                // Si tiene timestamp y es más viejo que 24hs, O si expiró explícitamente
                                if ((a.timestamp && a.timestamp < cutOffAlerts) || (a.expiresAt && a.expiresAt < now)) {
                                    await db.ref(`fleets/${fid}/traffic_alerts/${aid}`).remove();
                                    countAlerts++;
                                }
                            }
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

    return { 
        init, 
        resetSession,
        getFleetId: _resolveFleetId,
        getDb: () => db
    };
})();

module.exports = WhatsappBot;
