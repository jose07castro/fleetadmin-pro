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

    async function init() {
        console.log('🚀 INICIANDO BOT v207 (BAILEYS - AUTO FLEET)...');
        console.log('📡 Sin navegador - conexión directa a WhatsApp');
        console.log(`🔥 Firebase DB: ${db ? '✅ CONECTADO' : '❌ NULL - LAS ALERTAS NO SE GUARDARÁN'}`);
        console.log(`🧠 Gemini IA: ${gemini ? '✅ ACTIVO' : '❌ NO CONFIGURADO (sin GEMINI_API_KEY)'}`);
        
        // Auto-detectar fleet ID ANTES de conectar WhatsApp
        await _resolveFleetId();
        
        await startSocket();
    }

    /**
     * Guarda/restaura credenciales de WhatsApp en Firebase
     * para que sobrevivan los reinicios de Render
     */
    async function _firebaseAuthState() {
        // Asegurar directorio local existe
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

        // Intentar restaurar credenciales desde Firebase
        if (db) {
            try {
                const snap = await db.ref('bot_auth/creds').once('value');
                const savedCreds = snap.val();
                if (savedCreds) {
                    const credsPath = path.join(AUTH_DIR, 'creds.json');
                    fs.writeFileSync(credsPath, JSON.stringify(savedCreds));
                    console.log('🔑 [AUTH] Credenciales restauradas desde Firebase ✅');
                } else {
                    console.log('🔑 [AUTH] No hay credenciales guardadas, se necesita QR nuevo');
                }
            } catch (e) {
                console.error('🔑 [AUTH] Error restaurando credenciales:', e.message);
            }
        }

        // Usar el sistema de archivos local (ya restaurado desde Firebase)
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        // Wrapper que guarda en Firebase además de local
        const saveCredsToFirebase = async () => {
            await saveCreds(); // Guardar local primero
            if (db) {
                try {
                    const credsPath = path.join(AUTH_DIR, 'creds.json');
                    if (fs.existsSync(credsPath)) {
                        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
                        await db.ref('bot_auth/creds').set(creds);
                        console.log('🔑 [AUTH] Credenciales guardadas en Firebase ✅');
                    }
                } catch (e) {
                    console.error('🔑 [AUTH] Error guardando en Firebase:', e.message);
                }
            }
        };

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
            // También limpiar en Firebase
            if (db) {
                await db.ref('bot_auth').remove();
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
                        console.log(`⚠️ [${statusCode}] Conflicto de sesión (posible despliegue en curso). Esperando 15s...`);
                        await new Promise(resolve => setTimeout(resolve, 15000));
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
                    if (msg.key.fromMe) continue;

                    // Extraer texto del mensaje (múltiples formatos de WhatsApp)
                    let text = "";
                    const m = msg.message;
                    
                    if (m) {
                        text = m.conversation || 
                               m.extendedTextMessage?.text || 
                               m.imageMessage?.caption || 
                               m.videoMessage?.caption ||
                               m.buttonsResponseMessage?.selectedDisplayText ||
                               m.templateButtonReplyMessage?.selectedId ||
                               m.listResponseMessage?.title ||
                               // Caso especial: Mensajes efímeros
                               m.ephemeralMessage?.message?.conversation ||
                               m.ephemeralMessage?.message?.extendedTextMessage?.text ||
                               // Caso especial: Ver en el dispositivo (view once)
                               m.viewOnceMessage?.message?.buttonsResponseMessage?.selectedDisplayText ||
                               m.viewOnceMessageV2?.message?.imageMessage?.caption ||
                               "";
                    }

                    // Si sigue vacío, intentar buscar en el cuerpo crudo por si es un formato nuevo
                    if (!text && m) {
                        const content = m.extendedTextMessage || m.conversation;
                        if (typeof content === 'string') text = content;
                    }
                    
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

                    // --- NUEVA LÓGICA: TODO PASA POR GEMINI FLASH ---
                    console.log(`🧠 [GEMINI] Analizando mensaje: "${text.substring(0,60)}..."`);
                    
                    try {
                        const analysis = await _analyzeMessageWithAI(text);
                        
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
                                const result = await gemini.generateContent(text);
                                const response = await result.response;
                                const aiResponse = response.text();
                                if (aiResponse) {
                                    await sock.sendMessage(jid, { text: aiResponse }, { quoted: msg });
                                }
                            }
                        }
                    } catch (err) {
                        console.error('❌ Error en el flujo de IA:', err.message);
                    }
                    } catch (outerErr) {
                        console.error('💥 [CRASH] Error procesando mensaje:', outerErr.message, outerErr.stack);
                        // Si es error de MAC, la sesión está corrompida → limpiar y reconectar
                        if (outerErr.message && (outerErr.message.includes('MAC') || outerErr.message.includes('decrypt'))) {
                            console.log('🔴 [MAC] Sesión corrompida detectada. Limpiando y reiniciando...');
                            await clearAuthInfo();
                            await new Promise(r => setTimeout(r, 3000));
                            await startSocket();
                            return;
                        }
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
     * Analiza el mensaje con Gemini Flash para determinar si es una alerta y extraer datos.
     * Incluye lógica especial para Rosario (Helicóptero HECA, etc.)
     */
    async function _analyzeMessageWithAI(text) {
        if (!gemini) return null;
        
        try {
            const prompt = `Analiza este mensaje de un grupo de WhatsApp de tráfico en Rosario, Argentina.
Mensaje: "${text}"

REGLAS ESPECIALES:
1. Si menciona "CODIGO ROJO" o "HELICOPTERO", es el helicóptero sanitario aterrizando en el HECA. La ubicación es "Pellegrini y Vera Mujica". El tipo es "helicopter".
2. Si menciona "GORRA", "ZORROS", "CONTROL", "OPERATIVO", "RATIS", "CHANCHOS", es una alerta de POLICÍA.
3. Si menciona accidentes, cortes, baches o tráfico pesado, es una alerta de TRÁFICO.

Responde estrictamente en formato JSON con esta estructura:
{
  "isAlert": boolean,
  "type": "police" | "traffic" | "helicopter",
  "address": "calle y calle" o "calle altura",
  "confidence": 0-1
}
Si no es una alerta de tráfico o policía, pon "isAlert": false.
Si es un "CODIGO ROJO", pon la dirección como "Pellegrini y Vera Mujica".

Responde SOLO el JSON.`;
            
            const result = await gemini.generateContent(prompt);
            const response = await result.response;
            const jsonText = response.text().trim().replace(/```json|```/g, '');
            
            try {
                const analysis = JSON.parse(jsonText);
                if (analysis.isAlert && analysis.address && analysis.address !== 'NULL') {
                    return analysis;
                }
            } catch (jsonErr) {
                console.error('❌ Error parseando JSON de Gemini:', jsonText);
            }
        } catch (e) {
            console.error('❌ Error IA analizando mensaje:', e.message);
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
        // Expandir nombres abreviados ANTES de geocodificar
        const expandedAddress = _expandStreetNames(address);
        console.log(`🔍 [GEO] Geocodificando: "${expandedAddress}" en Rosario...`);
        
        const fleetId = await _resolveFleetId();
        const alertId = `bot_${Date.now()}`;
        
        // Determinar tipo: Prioridad a lo que diga la IA, fallback a keywords
        let type = aiType || ( /gorra|control|operativo|zorros|chanchos|ratis/i.test(originalText) ? 'police' : 'warning');
        
        let lat = -32.9468; // Centro de Rosario (fallback)
        let lng = -60.6393;
        let approximate = true;
        
        try {
            // Caso especial: Helicóptero en Pellegrini y Vera Mujica (HECA)
            if (type === 'helicopter' || originalText.toLowerCase().includes('codigo rojo')) {
                lat = -32.9515; // Coordenadas HECA Rosario
                lng = -60.6625;
                approximate = false;
                type = 'police'; // Usar icono de policía o aviso por ahora en el mapa
                console.log('🚁 [HECA] Ubicación forzada para Helicóptero Sanitario');
            } else {
                // Respetar rate limit de Nominatim (1 req/segundo)
                await new Promise(r => setTimeout(r, 1500));
                
                const fullAddress = `${expandedAddress}, Rosario, Santa Fe, Argentina`;
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;
            
            console.log(`🌐 [GEO] URL: ${url.substring(0,80)}...`);
            
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'FleetAdminPro/2.0 (jose07castro@gmail.com)' },
                timeout: 10000
            });

            console.log(`🌐 [GEO] Respuesta: ${response.data?.length || 0} resultados`);

            if (response.data && response.data.length > 0) {
                lat = parseFloat(response.data[0].lat);
                lng = parseFloat(response.data[0].lon);
                approximate = false;
                console.log(`📍 [GEO] ✅ Ubicación exacta: ${lat}, ${lng}`);
            } else {
                console.log(`⚠️ [GEO] Sin resultados, usando centro de Rosario`);
            }
        }
    } catch (err) {
            console.error(`⚠️ [GEO] Error geocodificando (${err.message}), guardando con ubicación aproximada`);
        }

        // SIEMPRE guardar la alerta, con o sin coordenadas exactas
        const alertData = {
            id: alertId,
            type: type,
            location: expandedAddress + (approximate ? ' (ubicación aprox.)' : ''),
            lat,
            lng,
            timestamp: Date.now(),
            expiresAt: Date.now() + (60 * 60 * 1000),
            authorName: `Bot WA (${sourceGroup})`,
            confirmations: approximate ? 0 : 1,
            status: 'active',
            source: 'whatsapp_bot',
            approximate
        };

        console.log(`💾 [DB] Guardando alerta en fleets/${fleetId}/traffic_alerts/${alertId}...`);

        if (db) {
            await db.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(alertData);
            console.log(`✅ [DB] ¡¡¡ALERTA PUBLICADA!!! flota=${fleetId}, type=${alertData.type}, lat=${lat}, lng=${lng}, exact=${!approximate}`);
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

    return { init, resetSession };
})();

module.exports = WhatsappBot;
