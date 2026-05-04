/* ============================================
   FleetAdmin Pro — WhatsApp Bot Worker (v201 - Baileys Fix)
   Escucha grupos de Rosario, detecta operativos y sincroniza con Firebase.
   Usa Baileys (ultra-liviano, sin navegador).
   ============================================ */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const axios = require('axios');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let gemini = null;
if (process.env.GEMINI_API_KEY) {
    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        gemini = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    } catch (e) {
        console.error('❌ Error inicializando Gemini:', e.message);
    }
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

    async function init() {
        console.log('🚀 INICIANDO BOT v204 (BAILEYS - DEBUG TOTAL)...');
        console.log('📡 Sin navegador - conexión directa a WhatsApp');
        console.log(`🔥 Firebase DB: ${db ? '✅ CONECTADO' : '❌ NULL - LAS ALERTAS NO SE GUARDARÁN'}`);
        console.log(`🧠 Gemini IA: ${gemini ? '✅ ACTIVO' : '❌ NO CONFIGURADO (sin GEMINI_API_KEY)'}`);
        console.log(`🔑 Env vars: FIREBASE_PROJECT_ID=${process.env.FIREBASE_PROJECT_ID ? 'SET' : 'MISSING'}, DEFAULT_FLEET_ID=${process.env.DEFAULT_FLEET_ID || 'jose07 (default)'}`);
        
        await startSocket();
    }

    /**
     * Limpia la carpeta de autenticación para forzar un nuevo pairing
     */
    function clearAuthInfo() {
        try {
            if (fs.existsSync(AUTH_DIR)) {
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                console.log('🗑️ Credenciales antiguas eliminadas.');
            }
        } catch (e) {
            console.error('⚠️ Error limpiando credenciales:', e.message);
        }
    }

    async function startSocket() {
        try {
            if (!fs.existsSync(AUTH_DIR)) {
                fs.mkdirSync(AUTH_DIR, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
            const { version } = await fetchLatestBaileysVersion();
            
            sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: true,
                logger: P({ level: 'silent' }),
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
                connectTimeoutMs: 120000,
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
                        clearAuthInfo();
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await startSocket();
                    } else if (statusCode === reason.restartRequired || statusCode === reason.connectionTimedOut) {
                        await startSocket();
                    } else if (statusCode === 401) {
                        retryCount++;
                        if (retryCount > MAX_RETRIES) {
                            console.log('🔴 Demasiados reintentos. Limpiando sesión...');
                            clearAuthInfo();
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
                    if (msg.key.fromMe) continue;

                    // Extraer texto del mensaje (múltiples formatos de WhatsApp)
                    let text = msg.message?.conversation 
                        || msg.message?.extendedTextMessage?.text 
                        || msg.message?.imageMessage?.caption
                        || msg.message?.videoMessage?.caption
                        || msg.message?.buttonsResponseMessage?.selectedDisplayText
                        || '';
                    
                    const isAudio = msg.message?.audioMessage;

                    console.log(`📩 [MSG] From=${jid?.substring(0,15)}... | Group=${isGroup} | Audio=${!!isAudio} | Text="${text.substring(0,80)}"`);

                    // 1. PROCESAR AUDIO (Speech-to-Text con OpenAI)
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
                    const content = text.toLowerCase();

                    // 2. PRIORIDAD: ALERTA DE TRÁFICO
                    console.log(`🔎 [CHECK] Buscando keywords en: "${content.substring(0,60)}" | Keywords: ${ALERT_KEYWORDS.join(',')}`);
                    const matchedKeyword = ALERT_KEYWORDS.find(k => content.includes(k));
                    console.log(`🔎 [CHECK] Resultado: ${matchedKeyword ? '✅ ' + matchedKeyword : '❌ ninguna'}`);
                    let isAlertProcessed = false;

                    if (matchedKeyword) {
                        console.log(`🚨 [KEYWORD] Detectada: "${matchedKeyword}" en mensaje: "${text.substring(0,60)}"`);
                        
                        try {
                            let groupName = 'Privado';
                            if (isGroup) {
                                try {
                                    const groupInfo = await sock.groupMetadata(jid);
                                    groupName = groupInfo.subject;
                                } catch(ge) { groupName = 'Grupo Desconocido'; }
                            }
                            const senderNumber = msg.key.participant || msg.key.remoteJid;
                            
                            // Guardar raw en bot_alerts (diagnóstico)
                            if (db) {
                                await db.ref('bot_alerts').push({
                                    group: groupName,
                                    author: senderNumber,
                                    text: text,
                                    timestamp: Date.now(),
                                    type: isAudio ? 'audio' : 'text'
                                });
                                console.log('📝 [DB] Raw alert guardada en bot_alerts');
                            } else {
                                console.log('❌ [DB] Firebase db es NULL - no se puede guardar');
                            }

                            // Extraer dirección con IA o Regex
                            console.log('🧠 [EXTRACT] Intentando extraer dirección...');
                            const intersection = await _extractAddressWithAI(text);
                            console.log(`📍 [EXTRACT] Resultado: "${intersection || 'NULL'}"`);
                            
                            if (intersection) {
                                await _processAlert(intersection, text, groupName);
                                isAlertProcessed = true;
                            } else {
                                console.log('⚠️ [EXTRACT] No se pudo extraer dirección del mensaje');
                            }
                        } catch (err) { console.error('❌ Error alerta:', err.message, err.stack); }
                    }

                    // 3. PRIORIDAD: INTERACCIÓN IA (Gemini Flash)
                    if (!isAlertProcessed && gemini) {
                        const botNumber = sock.user?.id?.split(':')[0] || '';
                        const isMentioned = content.includes(botNumber) || content.includes('bot');
                        const isPrivate = !isGroup;

                        if (isPrivate || isMentioned) {
                            try {
                                console.log(`🧠 Consultando Gemini...`);
                                const result = await gemini.generateContent(text);
                                const response = await result.response;
                                const aiResponse = response.text();

                                if (aiResponse) {
                                    await sock.sendMessage(jid, { text: aiResponse }, { quoted: msg });
                                    console.log('✅ IA respondió con éxito.');
                                }
                            } catch (aiErr) { console.error('❌ Error Gemini:', aiErr.message); }
                        }
                    }
                    } catch (outerErr) {
                        console.error('💥 [CRASH] Error procesando mensaje:', outerErr.message, outerErr.stack);
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
     * Extrae la dirección usando Gemini IA para mayor precisión (con fallback a Regex).
     */
    async function _extractAddressWithAI(text) {
        if (!gemini) return _extractIntersection(text);
        
        try {
            const prompt = `Extrae SOLAMENTE la dirección, calle, intersección o altura (sin ciudad ni provincia) del siguiente mensaje de alerta de tráfico de Rosario, Argentina. 
Mensaje: "${text}"
Si no hay una ubicación clara, responde exactamente con la palabra "NULL".
Ejemplos:
- "Gorra en San Martin y Pellegrini" -> "San Martin y Pellegrini"
- "Control por Oroño al 3000" -> "Oroño 3000"
- "Hay zorros en el parque" -> "NULL"
Responde SOLO con la dirección o NULL.`;
            
            const result = await gemini.generateContent(prompt);
            const response = await result.response;
            const address = response.text().trim();
            
            if (address && address !== 'NULL' && address !== 'null') {
                return address;
            }
        } catch (e) {
            console.error('❌ Error IA extrayendo dirección:', e.message);
        }
        return _extractIntersection(text);
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
     * Geocodifica y guarda en Firebase.
     */
    async function _processAlert(address, originalText, sourceGroup) {
        console.log(`🔍 [GEO] Intentando geocodificar: "${address}" en Rosario...`);
        
        try {
            const fullAddress = `${address}, Rosario, Santa Fe, Argentina`;
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;
            
            console.log(`🌐 [GEO] URL: ${url.substring(0,80)}...`);
            
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'FleetAdminBot/1.0' },
                timeout: 10000
            });

            console.log(`🌐 [GEO] Respuesta: ${response.data?.length || 0} resultados`);

            if (response.data && response.data.length > 0) {
                const { lat, lon } = response.data[0];
                console.log(`📍 [GEO] ✅ Ubicación encontrada: ${lat}, ${lon}`);

                // Guardar en Firebase
                const fleetId = process.env.DEFAULT_FLEET_ID || 'jose07'; 
                const alertId = `bot_${Date.now()}`;
                
                // Determinar tipo
                const isPolice = /gorra|control|operativo|zorros|chanchos|ratis|fiscaliz/i.test(originalText);

                const alertData = {
                    id: alertId,
                    type: isPolice ? 'police' : 'warning',
                    location: address,
                    lat: parseFloat(lat),
                    lng: parseFloat(lon),
                    timestamp: Date.now(),
                    expiresAt: Date.now() + (60 * 60 * 1000), // 60 min TTL
                    authorName: `Bot WA (${sourceGroup})`,
                    confirmations: 1,
                    status: 'active',
                    source: 'whatsapp_bot'
                };

                console.log(`💾 [DB] Guardando alerta en fleets/${fleetId}/traffic_alerts/${alertId}...`);

                if (db) {
                    await db.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(alertData);
                    console.log(`✅ [DB] ¡¡¡ALERTA PUBLICADA CON ÉXITO en flota ${fleetId}!!!`);
                    console.log(`✅ [DB] Data: type=${alertData.type}, lat=${alertData.lat}, lng=${alertData.lng}`);
                } else {
                    console.error('❌ [DB] Firebase db es NULL - NO SE PUEDE GUARDAR LA ALERTA');
                }
            } else {
                console.log(`⚠️ [GEO] No se pudo encontrar "${address}" en el mapa de Rosario.`);
                
                // FALLBACK: si no se encuentra, guardar con coordenadas del centro de Rosario
                const fleetId = process.env.DEFAULT_FLEET_ID || 'jose07';
                const alertId = `bot_${Date.now()}`;
                const isPolice = /gorra|control|operativo|zorros|chanchos|ratis|fiscaliz/i.test(originalText);
                
                const fallbackData = {
                    id: alertId,
                    type: isPolice ? 'police' : 'warning',
                    location: address + ' (ubicación aprox.)',
                    lat: -32.9468,
                    lng: -60.6393,
                    timestamp: Date.now(),
                    expiresAt: Date.now() + (60 * 60 * 1000),
                    authorName: `Bot WA (${sourceGroup})`,
                    confirmations: 0,
                    status: 'active',
                    source: 'whatsapp_bot',
                    approximate: true
                };
                
                if (db) {
                    await db.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(fallbackData);
                    console.log(`⚠️ [DB] Alerta guardada CON UBICACIÓN APROXIMADA (centro Rosario)`);
                }
            }
        } catch (err) {
            console.error('❌ [GEO] Error en geocodificación:', err.message);
            console.error('❌ [GEO] Stack:', err.stack);
        }
    }

    return { init };
})();

module.exports = WhatsappBot;
