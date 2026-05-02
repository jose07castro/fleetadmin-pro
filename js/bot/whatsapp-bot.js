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

// 1. Inicialización de Firebase Admin (vía Variables de Entorno)
let db = null;

if (!admin.apps.length) {
    try {
        const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim().replace(/^"|"$/g, '');
        const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim().replace(/^"|"$/g, '');
        let privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim();

        if (privateKey) {
            privateKey = privateKey.replace(/\\n/g, '\n').replace(/\n\n+/g, '\n').replace(/^"|"$/g, '').trim();
            
            const hasStart = privateKey.includes('-----BEGIN PRIVATE KEY-----');
            const hasEnd = privateKey.includes('-----END PRIVATE KEY-----');
            
            if (!hasStart || !hasEnd) {
                console.error(`⚠️ LA CLAVE ESTÁ INCOMPLETA: Start=${hasStart}, End=${hasEnd}.`);
            }

            // Extracción
            if (hasStart && hasEnd) {
                privateKey = privateKey.substring(
                    privateKey.indexOf('-----BEGIN PRIVATE KEY-----'),
                    privateKey.indexOf('-----END PRIVATE KEY-----') + 25
                );
            }
        }

        console.log(`📡 Config: ID=${projectId.substring(0, 5)}..., KeyLength=${privateKey.length}, EndsCorrectly=${privateKey.endsWith('-----END PRIVATE KEY-----')}`);

        if (!projectId || !clientEmail || privateKey.length < 100) {
            throw new Error('Variables de Firebase incompletas o inválidas.');
        }

        admin.initializeApp({
            credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey
            }),
            databaseURL: process.env.FIREBASE_DATABASE_URL
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
        console.log('🚀 INICIANDO BOT v203 (BAILEYS - QR CODE)...');
        console.log('📡 Sin navegador - conexión directa a WhatsApp');
        
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
            // Asegurar que existe el directorio de auth
            if (!fs.existsSync(AUTH_DIR)) {
                fs.mkdirSync(AUTH_DIR, { recursive: true });
            }

            // Autenticación persistente
            const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
            const { version } = await fetchLatestBaileysVersion();
            
            const isRegistered = state.creds.registered;
            console.log(`📱 Versión WA: ${version.join('.')}`);
            console.log(`📱 Registrado: ${isRegistered}`);

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

            if (isRegistered) {
                console.log('📱 Sesión registrada encontrada, reconectando automáticamente...');
            } else {
                console.log('📱 Esperando QR para vincular... Mirá los logs.');
            }

            // Evento: Actualización de conexión
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                // ============================================
                // QR CODE: Mostrar como URL escaneable
                // ============================================
                if (qr) {
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=400x400`;
                    console.log('');
                    console.log('📱 ╔══════════════════════════════════════════════════════╗');
                    console.log('📱 ║          ESCANEÁ ESTE QR PARA VINCULAR               ║');
                    console.log('📱 ╠══════════════════════════════════════════════════════╣');
                    console.log('📱 ║ 1. Copiá este link y abrilo en tu navegador:        ║');
                    console.log(`📱 ║ ${qrUrl}`);
                    console.log('📱 ║                                                      ║');
                    console.log('📱 ║ 2. Abrí WhatsApp → Configuración →                  ║');
                    console.log('📱 ║    Dispositivos vinculados → Vincular dispositivo    ║');
                    console.log('📱 ║ 3. Escaneá el QR de la imagen del link               ║');
                    console.log('📱 ╚══════════════════════════════════════════════════════╝');
                    console.log('');
                }

                if (connection === 'connecting') {
                    console.log('🔄 Conectando a WhatsApp...');
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = DisconnectReason;
                    
                    console.log(`⚠️ Conexión cerrada. Código: ${statusCode}`);

                    if (statusCode === reason.loggedOut) {
                        // 401 = LoggedOut: Limpiar sesión y reconectar pidiendo nuevo código
                        console.log('🔴 Sesión cerrada por WhatsApp. Limpiando credenciales...');
                        clearAuthInfo();
                        retryCount = 0;
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        await startSocket();
                    } else if (statusCode === reason.restartRequired) {
                        // 515 = RestartRequired: Reconectar inmediatamente
                        console.log('🔄 Reinicio requerido por WhatsApp...');
                        retryCount = 0;
                        await startSocket();
                    } else if (statusCode === reason.timedOut || statusCode === 408) {
                        // 408 = Timeout: Reconectar con backoff
                        retryCount++;
                        if (retryCount > MAX_RETRIES) {
                            console.log('🔴 Demasiados reintentos. Limpiando sesión y empezando de cero...');
                            clearAuthInfo();
                            retryCount = 0;
                        }
                        const delay = Math.min(5000 * retryCount, 30000);
                        console.log(`🔄 Reintento ${retryCount}/${MAX_RETRIES} en ${delay / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        await startSocket();
                    } else if (statusCode === reason.connectionClosed || statusCode === reason.connectionLost) {
                        // 428/408 = Connection issues: Reconectar con backoff corto
                        retryCount++;
                        const delay = Math.min(3000 * retryCount, 20000);
                        console.log(`🔄 Reconectando (intento ${retryCount}) en ${delay / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        await startSocket();
                    } else {
                        // Cualquier otro error: reconectar con backoff
                        retryCount++;
                        if (retryCount <= MAX_RETRIES) {
                            const delay = Math.min(5000 * retryCount, 30000);
                            console.log(`🔄 Error desconocido (${statusCode}). Reintento ${retryCount}/${MAX_RETRIES} en ${delay / 1000}s...`);
                            await new Promise(resolve => setTimeout(resolve, delay));
                            await startSocket();
                        } else {
                            console.log('🔴 Máximo de reintentos alcanzado. Limpiando y reiniciando...');
                            clearAuthInfo();
                            retryCount = 0;
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            await startSocket();
                        }
                    }
                } else if (connection === 'open') {
                    retryCount = 0; // Reset retries on successful connection
                    console.log('');
                    console.log('✅ ══════════════════════════════════════════');
                    console.log('✅  ¡Bot de WhatsApp CONECTADO y ESCUCHANDO!');
                    console.log('✅ ══════════════════════════════════════════');
                    console.log(`📡 Memoria: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
                    console.log('');
                }
            });

            // Guardar credenciales cuando se actualizan
            sock.ev.on('creds.update', saveCreds);

            // Evento: Mensajes nuevos
            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                if (type !== 'notify') return;

                for (const msg of messages) {
                    const jid = msg.key.remoteJid;
                    const isGroup = jid?.endsWith('@g.us');
                    
                    // Ignorar mensajes propios
                    if (msg.key.fromMe) continue;

                    const text = msg.message?.conversation 
                        || msg.message?.extendedTextMessage?.text 
                        || msg.message?.imageMessage?.caption
                        || '';
                    
                    if (!text) continue;

                    // Log para debugging (puedes verlo en Render)
                    if (isGroup) {
                        console.log(`📩 Mensaje en grupo [${jid}]: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
                    }

                    const content = text.toLowerCase();

                    // Filtrado por Palabras Clave
                    if (ALERT_KEYWORDS.some(k => content.includes(k))) {
                        console.log(`🚨 ¡PALABRA CLAVE DETECTADA!: "${text}"`);
                        
                        try {
                            // Solo procesar si es grupo (para evitar spam de privados)
                            if (!isGroup) continue;

                            // Obtener info del grupo
                            const groupInfo = await sock.groupMetadata(jid);
                            const senderNumber = msg.key.participant || msg.key.remoteJid;
                            
                            // Guardar en Firebase
                            if (db) {
                                await db.ref('bot_alerts').push({
                                    group: groupInfo.subject,
                                    author: senderNumber,
                                    text: text,
                                    timestamp: Date.now()
                                });
                                console.log('✅ Alerta guardada en Firebase');
                            }

                            // Intentar geocodificar
                            const intersection = _extractIntersection(content);
                            if (intersection) {
                                await _processAlert(intersection, text, groupInfo.subject);
                            }
                        } catch (err) {
                            console.error('❌ Error al procesar alerta:', err.message);
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
        console.log(`🔍 Intentando geocodificar: "${address}" en Rosario...`);
        
        try {
            const fullAddress = `${address}, Rosario, Santa Fe, Argentina`;
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;
            
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'FleetAdminBot/1.0' }
            });

            if (response.data && response.data.length > 0) {
                const { lat, lon } = response.data[0];
                console.log(`📍 ✅ Ubicación encontrada: ${lat}, ${lon}`);

                // Guardar en Firebase
                const fleetId = process.env.DEFAULT_FLEET_ID || 'jose07'; 
                const alertId = `bot_${Date.now()}`;
                
                // Determinar tipo: Operativo/Gorra/Control -> policía. Otros -> advertencia.
                const isPolice = /gorra|control|operativo|zorros|chanchos|ratis/i.test(originalText);

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

                if (db) {
                    await db.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(alertData);
                    console.log(`✅ ¡Alerta publicada con éxito en la flota ${fleetId}!`);
                }
            } else {
                console.log(`⚠️ No se pudo encontrar "${address}" en el mapa de Rosario.`);
            }
        } catch (err) {
            console.error('❌ Error en geocodificación:', err.message);
        }
    }
        } catch (e) {
            console.error('❌ Error procesando alerta:', e.message);
        }
    }

    return { init };
})();

module.exports = WhatsappBot;
