/* ============================================
   FleetAdmin Pro — WhatsApp Bot Worker (v200 - Baileys)
   Escucha grupos de Rosario, detecta operativos y sincroniza con Firebase.
   Usa Baileys (ultra-liviano, sin navegador).
   ============================================ */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const axios = require('axios');
const admin = require('firebase-admin');

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
 * Módulo de Lógica del Bot (Baileys)
 */
const WhatsappBot = (() => {
    let sock = null;

    // Diccionario de Slang Rosarino (Sincronizado con el cliente)
    const ALERT_KEYWORDS = ['gorra', 'operativo', 'control', 'zorros', 'chanchos', 'palo', 'parando', 'evitar', 'ratis'];

    async function init() {
        console.log('🚀 INICIANDO BOT v200 (BAILEYS - ULTRA LIVIANO)...');
        console.log('📡 Sin navegador necesario - conexión directa a WhatsApp');
        
        await startSocket();
    }

    async function startSocket() {
        // Autenticación persistente (se guarda en ./auth_info)
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
        const { version } = await fetchLatestBaileysVersion();
        
        console.log(`📱 Versión de WhatsApp: ${version.join('.')}`);

        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false, // Lo manejamos nosotros
            logger: P({ level: 'silent' }), // Silenciar logs internos
            browser: ['FleetAdmin Pro', 'Chrome', '122.0.0'],
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000,
            markOnlineOnConnect: false // Ahorrar batería
        });

        // Solicitar código de vinculación si no está registrado
        const phone = process.env.WWEBJS_PHONE;
        if (phone && !state.creds.registered) {
            const cleanPhone = phone.replace(/\D/g, '');
            // Formato que funcionó: sin el prefijo 54
            const targetNumber = cleanPhone.startsWith('54') ? cleanPhone.substring(2) : cleanPhone;
            
            // Esperar un par de segundos a que el socket se estabilice
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            try {
                console.log(`📲 Solicitando código de vinculación para: ${targetNumber}...`);
                const code = await sock.requestPairingCode(targetNumber);
                console.log('📲 ========================================');
                console.log(`📲 CÓDIGO DE VINCULACIÓN: >>> ${code} <<<`);
                console.log('📲 ========================================');
                console.log('📲 Ingresá este código en tu celular:');
                console.log('📲 WhatsApp > Dispositivos vinculados > Vincular dispositivo');
            } catch (err) {
                console.error(`❌ Error al pedir código: ${err.message}`);
            }
        }

        // Evento: Actualización de conexión
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log(`⚠️ Conexión cerrada. Código: ${statusCode}. Reconectando: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    // Esperar 5 segundos antes de reconectar
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    await startSocket();
                } else {
                    console.log('🔴 Bot deslogueado. Para reconectar, eliminá la carpeta auth_info y reiniciá.');
                }
            } else if (connection === 'open') {
                console.log('✅ ¡Bot de WhatsApp conectado y escuchando mensajes!');
                console.log('📡 Memoria usada:', Math.round(process.memoryUsage().heapUsed / 1024 / 1024), 'MB');
            }
        });

        // Guardar credenciales cuando se actualizan
        sock.ev.on('creds.update', saveCreds);

        // Evento: Mensajes nuevos
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                // Solo mensajes de grupos
                if (!msg.key.remoteJid?.endsWith('@g.us')) continue;
                // Ignorar mensajes propios
                if (msg.key.fromMe) continue;

                const text = msg.message?.conversation 
                    || msg.message?.extendedTextMessage?.text 
                    || '';
                
                if (!text) continue;

                const content = text.toLowerCase();

                // Filtrado por Palabras Clave
                if (ALERT_KEYWORDS.some(k => content.includes(k))) {
                    console.log(`🚨 Alerta detectada en grupo: "${text}"`);
                    
                    try {
                        // Obtener info del grupo
                        const groupInfo = await sock.groupMetadata(msg.key.remoteJid);
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
    }

    /**
     * Extrae calles de un texto usando Regex.
     */
    function _extractIntersection(text) {
        // Regex simplificado para "Calle A y Calle B"
        const regex = /([a-z0-9\s]+)\sy\s([a-z0-9\s]+)/i;
        const match = text.match(regex);
        if (match) {
            return `${match[1].trim()} y ${match[2].trim()}`;
        }
        return null;
    }

    /**
     * Geocodifica y guarda en Firebase.
     */
    async function _processAlert(address, originalText, sourceGroup) {
        console.log(`🔍 Geocodificando: ${address} en Rosario...`);
        
        try {
            const fullAddress = `${address}, Rosario, Santa Fe, Argentina`;
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;
            
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'FleetAdminBot/1.0' }
            });

            if (response.data && response.data.length > 0) {
                const { lat, lon } = response.data[0];
                console.log(`📍 Ubicación encontrada: ${lat}, ${lon}`);

                // Guardar en Firebase (FLEET_ID por defecto o detectado)
                const fleetId = process.env.DEFAULT_FLEET_ID || 'jose07'; 
                const alertId = `bot_${Date.now()}`;
                
                const alertData = {
                    id: alertId,
                    type: originalText.includes('gorra') || originalText.includes('control') ? 'police' : 'warning',
                    location: address,
                    lat: parseFloat(lat),
                    lng: parseFloat(lon),
                    timestamp: Date.now(),
                    expiresAt: Date.now() + (60 * 60 * 1000), // 60 min TTL
                    authorName: 'Bot WhatsApp',
                    confirmations: 1,
                    status: 'active',
                    source: 'whatsapp_bot'
                };

                if (db) {
                    await db.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(alertData);
                    console.log('✅ Alerta sincronizada con éxito en el mapa de la flota.');
                }
            }
        } catch (e) {
            console.error('❌ Error procesando alerta:', e.message);
        }
    }

    return { init };
})();

module.exports = WhatsappBot;
