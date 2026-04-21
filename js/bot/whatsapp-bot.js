/* ============================================
   FleetAdmin Pro — WhatsApp Bot Worker (v120)
   Escucha grupos de Rosario, detecta operativos y sincroniza con Firebase.
   ============================================ */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const admin = require('firebase-admin');

// 1. Inicialización de Firebase Admin (vía Variables de Entorno)
if (!admin.apps.length) {
    try { 
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: process.env.FIREBASE_PROJECT_ID,
                clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
            }),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        console.log('✅ Firebase Admin: Conectado correctamente.');
    } catch (e) {
        console.warn('⚠️ Firebase Admin: Error inicializando. El bot no podrá guardar alertas.', e.message);
    }
}

const db = admin.database();

/**
 * Módulo de Lógica del Bot
 */
const WhatsappBot = (() => {
    let client = null;

    // Diccionario de Slang Rosarino (Sincronizado con el cliente)
    const ALERT_KEYWORDS = ['gorra', 'operativo', 'control', 'zorros', 'chanchos', 'palo', 'parando', 'evitar', 'ratis'];

    function init() {
        console.log('🚀 Iniciando WhatsApp Bot Worker...');
        
        client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
            }
        });

        // Evento QR
        client.on('qr', (qr) => {
            console.log('📲 ESCANEÁ ESTE QR PARA ACTIVAR EL BOT:');
            qrcode.generate(qr, { small: true });
        });

        // Evento Ready
        client.on('ready', () => {
            console.log('✅ Bot conectado y escuchando grupos satisfactoriamente.');
        });

        // Evento Mensaje
        client.on('message_create', async (msg) => {
            // Ignorar mis propios mensajes o mensajes que no son de grupos
            if (!msg.from.includes('@g.us')) return;

            const content = msg.body.toLowerCase();
            
            // 1. Filtrado por Palabras Clave
            if (ALERT_KEYWORDS.some(k => content.includes(k))) {
                console.log(`🚨 Posible alerta detectada en grupo: "${msg.body}"`);
                
                // 2. Intentar extraer intersección (Calle X y Calle Y)
                const intersection = _extractIntersection(content);
                if (intersection) {
                    _processAlert(intersection, msg.body, msg.from);
                }
            }
        });

        client.initialize();
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
