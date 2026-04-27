/* ============================================
   FleetAdmin Pro — WhatsApp Bot Worker (v120)
   Escucha grupos de Rosario, detecta operativos y sincroniza con Firebase.
   ============================================ */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
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

// Nota: db ya fue declarado arriba como let y asignado dentro del try.
// Eliminamos la declaración redundante aquí.

/**
 * Módulo de Lógica del Bot
 */
const WhatsappBot = (() => {
    let client = null;

    // Diccionario de Slang Rosarino (Sincronizado con el cliente)
    const ALERT_KEYWORDS = ['gorra', 'operativo', 'control', 'zorros', 'chanchos', 'palo', 'parando', 'evitar', 'ratis'];

    function init() {
        // Log diagnóstico solicitado por el usuario para ver la ruta en Render
        const exePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
        console.log(`🚀 Iniciando WhatsApp Bot Worker...`);
        console.log(`🔍 Ruta del navegador en uso: ${exePath}`);
        
        client = new Client({
            authStrategy: new LocalAuth(),
            qrMaxRetries: 15,
            authTimeoutMs: 120000,
            puppeteer: {
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--no-zygote',
                    '--disable-extensions',
                    '--disable-gpu'
                ],
                executablePath: exePath
            }
        });

        // Eventos de depuración
        client.on('loading_screen', (percent, message) => console.log(`⏳ Cargando WhatsApp: ${percent}% - ${message}`));
        client.on('authenticated', () => console.log('✅ Bot autenticado'));
        client.on('auth_failure', msg => console.error('❌ Error de autenticación:', msg));

        let isRequesting = false;
        client.on('qr', async (qr) => {
            const phone = process.env.WWEBJS_PHONE;
            if (phone && !isRequesting) {
                isRequesting = true;
                console.log(`📲 QR Detectado. Calentando motores (15s)...`);
                await new Promise(resolve => setTimeout(resolve, 15000));
                
                try {
                    const cleanPhone = phone.replace(/\D/g, '');
                    console.log(`📲 Intento 1: Enviando pedido para ${cleanPhone}...`);
                    const pairingCode = await client.requestPairingCode(cleanPhone);
                    console.log('📲 ========================================');
                    console.log(`📲 CÓDIGO ACTUAL: >>> ${pairingCode} <<<`);
                    console.log('📲 ========================================');
                } catch (err) {
                    console.error(`❌ Intento 1 falló: ${err.message}`);
                    
                    // Intento 2: Sin el '9' (formato alternativo para Argentina)
                    try {
                        const altPhone = phone.replace(/\D/g, '').replace('549', '54');
                        console.log(`📲 Intento 2: Probando sin el "9": ${altPhone}...`);
                        const pairingCode = await client.requestPairingCode(altPhone);
                        console.log('📲 ========================================');
                        console.log(`📲 CÓDIGO ACTUAL (Alt): >>> ${pairingCode} <<<`);
                        console.log('📲 ========================================');
                    } catch (err2) {
                        console.error(`❌ Intento 2 también falló: ${err2.message}`);
                    }
                } finally {
                    isRequesting = false;
                }
            }
        });

        client.on('ready', () => {
            console.log('✅ Bot de WhatsApp listo y escuchando mensajes');
        });

        // Evento Mensaje
        client.on('message_create', async (msg) => {
            // Ignorar mis propios mensajes o mensajes que no son de grupos
            if (!msg.from.includes('@g.us')) return;

            const content = (msg.body || '').toLowerCase();
            
            // 1. Filtrado por Palabras Clave
            if (ALERT_KEYWORDS.some(k => content.includes(k))) {
                console.log(`🚨 Posible alerta detectada en grupo: "${msg.body}"`);
                
                try {
                    const group = await msg.getChat();
                    const contact = await msg.getContact();
                    
                    // Guardar en Firebase
                    await db.ref('bot_alerts').push({
                        group: group.name,
                        author: contact.pushname || contact.number,
                        text: msg.body,
                        timestamp: Date.now()
                    });
                    
                    console.log('✅ Alerta guardada en Firebase');
                } catch (err) {
                    console.error('❌ Error al procesar alerta:', err.message);
                }
            }
        });

        console.log('🚀 INICIANDO BOT v135 (FRENO DE MANO ACTIVO)...');
        console.log('📡 Vigilando conexión con WhatsApp... (esto puede tardar 1 minuto)');
        client.initialize().catch(err => console.error('❌ Error al iniciar cliente:', err.message));
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

                await db.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(alertData);
                console.log('✅ Alerta sincronizada con éxito en el mapa de la flota.');
            }
        } catch (e) {
            console.error('❌ Error procesando alerta:', e.message);
        }
    }

    return { init };
})();

module.exports = WhatsappBot;
