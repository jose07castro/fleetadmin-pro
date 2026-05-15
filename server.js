const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// Importar Bot de WhatsApp (Escucha grupos en segundo plano)
const WhatsappBot = require('./js/bot/whatsapp-bot');

// 1. Dejamos que Express sirva los archivos libremente (JS, CSS, HTML, lo que sea)
app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' })); // Aumentado para soportar base64 de imágenes

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
    const isConnected = typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.isConnected === 'function' 
        ? WhatsappBot.isConnected() 
        : false;

    res.json({ 
        ok: true, 
        status: 'Bot running',
        connected: isConnected,
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
// Endpoint para CURACIÓN RÁPIDA de sesión (Soft Reset)
// Cura el error "MAC Malo" / 440 sin forzar un nuevo código QR!!!
app.all('/api/bot/soft-reset', async (req, res) => {
    try {
        console.log('🔧 [SOFT-RESET] Solicitud de curación rápida manual recibida...');
        await WhatsappBot.softResetSession();
        res.json({ ok: true, message: '¡Curación rápida completada! Intentando reconectar conservando emparejamiento.' });
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

// ============================================
// Onboarding IA - Validación de Documentos
// ============================================
app.post('/api/auth/verify-documents', async (req, res) => {
    try {
        const { name, plate, tarjetaVerdeBase64, seguroBase64 } = req.body;
        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
            return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY no configurada en el servidor' });
        }
        if (!name || !plate || !tarjetaVerdeBase64 || !seguroBase64) {
            return res.status(400).json({ ok: false, error: 'Faltan datos o imágenes para la validación' });
        }

        const axios = require('axios');

        const prompt = `Actúa como un estricto validador legal de documentos vehiculares argentinos.
Se te proveen dos imágenes:
1. Una Tarjeta Verde (cédula de identificación del vehículo).
2. Una Póliza o Certificado de Seguro Automotor.

Se te ha provisto la entrada del usuario:
- Nombre ingresado: "${name}"
- Patente ingresada: "${plate}"

Debes extraer la siguiente información y validarla:
1. ¿El nombre ingresado coincide (total o parcialmente, ignorando acentos) con el titular de la Tarjeta Verde y el asegurado del Seguro? (Nota: Tarjetas Azules NO son válidas como titular).
2. ¿La patente ingresada coincide con la de la Tarjeta Verde y el Seguro?
3. ¿El seguro está vigente? (Hoy es ${new Date().toLocaleDateString()}).

Devuelve ÚNICAMENTE un objeto JSON con el siguiente formato, sin ningún formato markdown (\`\`\`json) ni texto adicional, solo el objeto JSON puro:
{
  "ok": true o false,
  "errors": ["Motivo específico si ok es false"],
  "extractedData": {
    "tarjetaVerde": { "nombre": "...", "patente": "..." },
    "seguro": { "nombre": "...", "patente": "...", "vencimiento": "..." }
  }
}`;

        // Ensure base64 strings have the proper data URI prefix
        const tvUrl = tarjetaVerdeBase64.startsWith('http') || tarjetaVerdeBase64.startsWith('data:') 
            ? tarjetaVerdeBase64 
            : `data:image/jpeg;base64,${tarjetaVerdeBase64}`;
            
        const segUrl = seguroBase64.startsWith('http') || seguroBase64.startsWith('data:') 
            ? seguroBase64 
            : `data:image/jpeg;base64,${seguroBase64}`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: tvUrl, detail: 'high' } },
                        { type: 'image_url', image_url: { url: segUrl, detail: 'high' } }
                    ]
                }
            ],
            max_tokens: 500,
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 20000 // 20 seconds timeout for image processing
        });

        let content = response.data.choices[0].message.content.trim();
        // Fallback for markdown cleanup if GPT ignores instruction
        if (content.startsWith('\`\`\`json')) {
            content = content.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
        }

        const result = JSON.parse(content);
        res.json(result);

    } catch (e) {
        console.error('❌ Error en verify-documents:', e.response?.data || e.message);
        res.status(500).json({ 
            ok: false, 
            error: 'Error procesando las imágenes con IA. Intenta de nuevo.',
            details: e.message 
        });
    }
});

// ============================================
// KITT Voice — ElevenLabs TTS Proxy
// Protege la API Key en el servidor y cachea audios
// ============================================
const _ttsCache = new Map(); // { textHash: { buffer, timestamp } }
const TTS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

app.get('/api/voice/tts', async (req, res) => {
    const text = req.query.text;
    if (!text) return res.status(400).json({ error: 'Missing ?text= parameter' });

    const apiKey = process.env.ELEVENLABS_API_KEY;
    // Voice ID: configurable via env, defaults to the hyper-premium deep "Adam" voice (perfect for KITT)
    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgmoE1GGz11j';

    if (!apiKey) {
        return res.status(503).json({ error: 'ELEVENLABS_API_KEY not configured on server' });
    }

    // Simple hash for cache key
    const cacheKey = `${voiceId}_${text}`;
    const cached = _ttsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < TTS_CACHE_TTL)) {
        console.log(`🎙️ [KITT-TTS] Cache HIT for: "${text.substring(0, 40)}..."`);
        res.set('Content-Type', 'audio/mpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(cached.buffer);
    }

    try {
        console.log(`🎙️ [KITT-TTS] Generating: "${text.substring(0, 60)}..."`);
        const axios = require('axios');
        const response = await axios({
            method: 'POST',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg'
            },
            data: {
                text: text,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.75,
                    similarity_boost: 0.80,
                    style: 0.45,
                    use_speaker_boost: true
                }
            },
            responseType: 'arraybuffer',
            timeout: 15000
        });

        const audioBuffer = Buffer.from(response.data);

        // Cache the result
        _ttsCache.set(cacheKey, { buffer: audioBuffer, timestamp: Date.now() });

        // Limit cache size (max 100 entries)
        if (_ttsCache.size > 100) {
            const oldest = _ttsCache.keys().next().value;
            _ttsCache.delete(oldest);
        }

        res.set('Content-Type', 'audio/mpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(audioBuffer);
    } catch (e) {
        console.error('🎙️ [KITT-TTS] ElevenLabs error:', e.response?.status, e.response?.data?.toString?.()?.substring(0, 200) || e.message);
        res.status(502).json({ error: 'ElevenLabs TTS failed', details: e.message });
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