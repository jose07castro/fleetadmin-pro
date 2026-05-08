const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// Importar Bot de WhatsApp (Escucha grupos en segundo plano)
const WhatsappBot = require('./js/bot/whatsapp-bot');

// 1. Dejamos que Express sirva los archivos libremente (JS, CSS, HTML, lo que sea)
app.use(express.static(__dirname));
app.use(express.json());

// Ruta de Salud rápida para Render (evita el "Port binding timeout")
app.get('/', (req, res) => {
    res.send('🚀 FleetAdmin Pro Backend is ONLINE');
});

// ============================================
// WhatsApp Bot Webhook
// Receives group messages and filters them for alerts
// ============================================
app.post('/api/whatsapp/webhook', (req, res) => {
    const { from, body, fleetId } = req.body;

    if (!body || !fleetId) {
        return res.status(400).json({ error: 'Missing body or fleetId' });
    }

    console.log(`📱 WhatsApp: Mensaje recibido de ${from}: ${body}`);

    // Filtro de IA / Palabras clave
    const alertKeywords = ['gorra', 'operativo', 'control', 'zorros', 'chanchos', 'palo', 'parando', 'evitar'];
    const content = body.toLowerCase();
    
    if (alertKeywords.some(k => content.includes(k))) {
        console.log('🚨 WhatsApp: Alerta detectada por filtro de IA automatizado.');
        // Nota: El geocoding real se hace en el cliente o mediante una API externa.
        // Aquí solo marcamos el mensaje para que el sistema lo procese.
        // En una implementación real, dispararíamos el geocoding aquí.
    }

    res.json({ ok: true, status: 'Message received and filtered' });
});

// ============================================
// Bot Management Endpoints
// ============================================
app.get('/api/bot/status', (req, res) => {
    res.json({ 
        ok: true, 
        status: 'Bot running',
        timestamp: new Date().toISOString()
    });
});

// Endpoint para resetear la sesión corrompida (MAC malo)
app.post('/api/bot/reset-session', async (req, res) => {
    try {
        console.log('🔄 [RESET] Limpiando sesión corrompida por petición manual...');
        await WhatsappBot.resetSession();
        res.json({ ok: true, message: 'Sesión limpiada. El bot va a pedir QR nuevo en los logs.' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Inyectar alerta de prueba directamente a Firebase (sin pasar por WhatsApp)
// Útil para verificar que el mapa lee alertas correctamente
app.post('/api/bot/test-alert', async (req, res) => {
    try {
        const fleetId = await WhatsappBot.getFleetId();
        const db = WhatsappBot.getDb();
        if (!db) return res.status(503).json({ ok: false, error: 'Firebase no disponible' });

        const alertId = `test_${Date.now()}`;
        const alertData = {
            id: alertId,
            type: req.body?.type || 'police',
            location: req.body?.location || 'Salta y Oroño (PRUEBA)',
            lat: req.body?.lat || -32.9468,
            lng: req.body?.lng || -60.6393,
            timestamp: Date.now(),
            expiresAt: Date.now() + (60 * 60 * 1000),
            authorName: 'Test Manual',
            confirmations: 1,
            status: 'active',
            source: 'test_manual',
            approximate: false
        };
        await db.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(alertData);
        res.json({ ok: true, fleetId, alertId, message: `✅ Alerta de prueba guardada en fleets/${fleetId}/traffic_alerts/${alertId}` });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Ver qué fleet ID está usando el bot
app.get('/api/bot/fleet-id', async (req, res) => {
    try {
        const fleetId = await WhatsappBot.getFleetId();
        res.json({ ok: true, fleetId });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});


// List Gemini Models
app.get('/api/bot/list-models', async (req, res) => {
    try {
        const axios = require('axios');
        const key = process.env.GEMINI_API_KEY;
        if (!key) return res.status(400).json({ error: 'No key' });
        
        const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        res.json({ ok: true, models: response.data });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message, data: e.response?.data });
    }
});

// Ver todos los fleets
app.get('/api/bot/fleets', async (req, res) => {
    try {
        const WhatsappBot = require('./js/bot/whatsapp-bot');
        const db = WhatsappBot.getDb();
        if (!db) return res.status(503).json({ error: 'DB not ready' });
        const snap = await db.ref('fleets').once('value');
        res.json({ ok: true, fleets: snap.val() });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. Arranque del motor
app.listen(PORT, () => {
    console.log('Servidor FleetAdmin Pro rugiendo en el puerto ' + PORT);
    
    // Iniciar Bot de WhatsApp de forma asíncrona para no bloquear el puerto
    console.log('⏳ Iniciando componente WhatsApp en segundo plano...');
    WhatsappBot.init();
});