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