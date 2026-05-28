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
// In-App Update: Version Control Endpoints
// ============================================

// Check minimum required version code/name
app.get('/api/version-check', async (req, res) => {
    try {
        const db = WhatsappBot.getDb();
        let minVersionCode = 53; // default fallback
        let minVersionName = "1.2.44";
        let playStoreUrl = "https://play.google.com/store/apps/details?id=com.fleetadminpro.app";

        if (db) {
            const snap = await db.ref('global_settings/min_version').once('value');
            const val = snap.val();
            if (val) {
                if (val.minVersionCode) minVersionCode = parseInt(val.minVersionCode);
                if (val.minVersionName) minVersionName = val.minVersionName;
                if (val.playStoreUrl) playStoreUrl = val.playStoreUrl;
            }
        }
        res.json({
            min_required_version_code: minVersionCode,
            min_required_version_name: minVersionName,
            play_store_url: playStoreUrl
        });
    } catch (e) {
        console.error('⚠️ Error checking version from DB:', e.message);
        res.json({
            min_required_version_code: 53,
            min_required_version_name: "1.2.44",
            play_store_url: "https://play.google.com/store/apps/details?id=com.fleetadminpro.app"
        });
    }
});

// Report driver's current app version
app.post('/api/driver/report-version', async (req, res) => {
    try {
        const { driver_id, fleetId, version } = req.body;
        if (!driver_id || !fleetId || !version) {
            return res.status(400).json({ ok: false, error: 'driver_id, fleetId, and version are required' });
        }

        const db = WhatsappBot.getDb();
        if (!db) {
            return res.status(503).json({ ok: false, error: 'Database not available' });
        }

        console.log(`📱 [VERSION REPORT] Driver ${driver_id} reported version ${version}`);

        // Update in globalUsers
        await db.ref(`globalUsers/${driver_id}/appVersion`).set(version);

        // Update in fleet users
        await db.ref(`fleets/${fleetId}/users/${driver_id}/appVersion`).set(version);

        // Update in driver_positions as well (for live tracking indicators)
        await db.ref(`driver_positions/${driver_id}/appVersion`).set(version);

        res.json({ ok: true });
    } catch (e) {
        console.error('❌ Error processing report-version:', e.message);
        res.status(500).json({ ok: false, error: e.message });
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

Debes extraer la siguiente información y validarla con rigor empresarial:
1. ¿El nombre ingresado coincide exactamente (ignorando acentos/minúsculas) con el Titular Registral de la Tarjeta Verde y el asegurado del Seguro?
   IMPORTANTE: Las Tarjetas Azules (Cédula para autorizado a conducir) NO son válidas para el alta de titular. Debe ser el dueño directo.
2. ¿La patente ingresada coincide con la de la Tarjeta Verde y el Seguro?
3. ¿Los datos del vehículo (Marca, Modelo) coinciden en ambos documentos?
4. ¿El seguro está vigente? (Hoy es ${new Date().toLocaleDateString()}).
   Nota: Si la póliza venció, marcar ok: false.

Devuelve ÚNICAMENTE un objeto JSON con el siguiente formato, sin ningún formato markdown (\`\`\`json) ni texto adicional, solo el objeto JSON puro:
{
  "ok": true o false,
  "errors": ["Motivo específico si ok es false. Ej: 'El nombre en la Tarjeta Verde no coincide con el registrado'"],
  "extractedData": {
    "tarjetaVerde": { "nombre": "...", "patente": "...", "esTitularDirecto": true/false },
    "seguro": { "nombre": "...", "patente": "...", "vencimiento": "...", "marcaModelo": "..." }
  }
}
Si no es titular directo (Tarjeta Azul detectada), ok debe ser false con el error correspondiente.`;

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
// Onboarding IA - Validación de Pasajeros
// ============================================
app.post('/api/auth/verify-passenger', async (req, res) => {
    try {
        const { name, dni, address, dniFrontBase64, selfieBase64, code } = req.body;
        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
            return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY no configurada en el servidor' });
        }
        if (!name || !dni || !address || !dniFrontBase64 || !selfieBase64 || !code) {
            return res.status(400).json({ ok: false, error: 'Faltan datos o imágenes para la validación' });
        }

        const axios = require('axios');

        const prompt = `Actúa como un estricto oficial de verificación de identidad (KYC) para una aplicación de seguridad en transporte.
Se te proveen dos imágenes:
1. Una foto del DNI (frente) del usuario.
2. Una Selfie del usuario sosteniendo un papel manuscrito con un código dinámico.

Se te han provisto los datos ingresados por el usuario:
- Nombre y Apellido ingresado: "${name}"
- Número de DNI ingresado: "${dni}"
- Código dinámico esperado: "${code}"

Debes verificar estrictamente lo siguiente:
1. ¿El nombre y apellido ingresado por el usuario coincide con el nombre que figura en la imagen del DNI? (Permite pequeñas diferencias tipográficas o acentos, pero debe ser la misma persona).
2. ¿El número de DNI ingresado coincide con el que figura en la imagen del DNI?
3. ¿La persona en la foto del DNI es la misma persona que se tomó la Selfie? Compara rasgos biométricos faciales con rigurosidad (forma de ojos, nariz, boca, distancia interpupilar, cejas).
4. ¿El usuario sostiene un papel escrito a mano en la Selfie que muestra claramente el código esperado "${code}"?
5. ¿La Selfie es una foto real tomada a una persona viva (liveness check básico) y no una foto tomada a otra pantalla o papel impreso?

Devuelve ÚNICAMENTE un objeto JSON con el siguiente formato, sin ningún formato markdown (\`\`\`json) ni texto adicional, solo el objeto JSON puro:
{
  "ok": true o false,
  "errors": ["Motivo específico si ok es false. Ej: 'La selfie no contiene el código dinámico esperado', 'El nombre en el DNI no coincide con el ingresado'"],
  "extractedData": {
    "dni": { "nombre": "...", "numero": "..." },
    "selfie": { "codigoDetectado": "...", "coincideRostro": true/false }
  }
}`;

        // Ensure base64 strings have the proper data URI prefix
        const dniUrl = dniFrontBase64.startsWith('http') || dniFrontBase64.startsWith('data:') 
            ? dniFrontBase64 
            : `data:image/jpeg;base64,${dniFrontBase64}`;
            
        const selfieUrl = selfieBase64.startsWith('http') || selfieBase64.startsWith('data:') 
            ? selfieBase64 
            : `data:image/jpeg;base64,${selfieBase64}`;

        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: dniUrl, detail: 'high' } },
                        { type: 'image_url', image_url: { url: selfieUrl, detail: 'high' } }
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
            timeout: 25000 // 25 seconds timeout for image processing
        });

        let content = response.data.choices[0].message.content.trim();
        // Fallback for markdown cleanup if GPT ignores instruction
        if (content.startsWith('\`\`\`json')) {
            content = content.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
        }

        const result = JSON.parse(content);
        res.json(result);

    } catch (e) {
        console.error('❌ Error en verify-passenger:', e.response?.data || e.message);
        res.status(500).json({ 
            ok: false, 
            error: 'Error procesando las imágenes con IA. Intenta de nuevo.',
            details: e.message 
        });
    }
});


// ============================================
// Driver Status Monitoring & Disconnection Alerts
// ============================================

// 1. Manual Voluntary Logout
app.post('/api/auth/logout-voluntario', async (req, res) => {
    try {
        const { driver_id, fleetId, timestamp } = req.body;
        if (!driver_id) {
            return res.status(400).json({ ok: false, error: 'driver_id is required' });
        }

        const eventTime = timestamp || Date.now();
        console.log(`🚪 [LOGOUT] Driver ${driver_id} voluntary logout received.`);

        // Intentar registrar en Firebase (no crítico — si falla, el logout igual procede)
        try {
            const db = WhatsappBot.getDb();
            if (db) {
                let driverName = req.body.driverName;
                if (!driverName) {
                    const posSnap = await db.ref(`driver_positions/${driver_id}/driverName`).once('value');
                    driverName = posSnap.val() || 'Chofer';
                }

                // 1. Actualizar estado del chofer en Firebase RTDB
                await db.ref(`driver_positions/${driver_id}`).update({
                    status: 'logout_voluntario',
                    gps_status: 'inactive',
                    last_heartbeat: eventTime,
                    updated_at: new Date(eventTime).toISOString()
                });

                // 2. Loguear evento en fleet logs si hay fleetId
                const fid = fleetId || await WhatsappBot.getFleetId();
                if (fid) {
                    await db.ref(`fleets/${fid}/driver_status_logs`).push({
                        event: 'logout_voluntario',
                        driverId: driver_id,
                        driverName: driverName || req.body.driverName || 'Chofer',
                        timestamp: eventTime
                    });
                }

                // Notificación push a admins
                WhatsappBot.sendPushToAdmins(
                    `🚪 Chofer Desconectado`,
                    `El chofer ${driverName || req.body.driverName || driver_id} ha cerrado sesión voluntariamente.`
                );
            } else {
                console.warn(`⚠️ [LOGOUT] DB no disponible — logout de ${driver_id} confirmado sin registro en Firebase.`);
            }
        } catch (dbErr) {
            // Error de Firebase no crítico: el logout igual se confirma
            console.error('⚠️ [LOGOUT] Error no crítico al registrar en Firebase:', dbErr.message);
        }

        // Siempre confirmar el logout al cliente
        res.json({ ok: true });
    } catch (e) {
        console.error('❌ Error processing logout-voluntario:', e.message);
        // Incluso ante error general, intentar confirmar el logout
        res.json({ ok: true, warning: e.message });
    }
});

// 2. GPS Toggle Event
app.post('/api/driver/gps-event', async (req, res) => {
    try {
        const { driver_id, event, timestamp, fleetId } = req.body;
        if (!driver_id || !event) {
            return res.status(400).json({ ok: false, error: 'driver_id and event are required' });
        }

        const db = WhatsappBot.getDb();
        if (!db) {
            return res.status(503).json({ ok: false, error: 'Database not available' });
        }

        const eventTime = timestamp || Date.now();
        console.log(`🔌 [GPS EVENT] Driver ${driver_id} reported: ${event}`);

        let driverName = req.body.driverName;
        if (!driverName) {
            const posSnap = await db.ref(`driver_positions/${driver_id}/driverName`).once('value');
            driverName = posSnap.val() || 'Chofer';
        }

        const isEnabled = event === 'gps_activado';
        const permissionsOk = event !== 'permissions_disabled';

        // 1. Update driver status in Firebase RTDB
        const updateData = {
            status: event,
            last_heartbeat: eventTime,
            updated_at: new Date(eventTime).toISOString()
        };

        if (event === 'gps_activado' || event === 'gps_desactivado') {
            updateData.gps_status = isEnabled ? 'active' : 'disabled';
        }

        if (event === 'permissions_disabled' || event === 'permissions_enabled') {
            updateData.permissions_ok = permissionsOk;
            if (permissionsOk) {
                updateData.gps_status = 'active';
            }
        }

        await db.ref(`driver_positions/${driver_id}`).update(updateData);

        // 2. Log event in fleet logs
        const fid = fleetId || await WhatsappBot.getFleetId();
        if (fid) {
            await db.ref(`fleets/${fid}/driver_status_logs`).push({
                event: event,
                driverId: driver_id,
                driverName: driverName,
                timestamp: eventTime
            });
        }

        // Send push notification to admins for critical warnings
        if (event === 'gps_desactivado') {
            WhatsappBot.sendPushToAdmins(
                `🔌 GPS Apagado`,
                `El chofer ${driverName} desactivó el GPS de su dispositivo.`
            );
        } else if (event === 'permissions_disabled') {
            WhatsappBot.sendPushToAdmins(
                `🔋 Ahorro de Energía / Permisos`,
                `El chofer ${driverName} desactivó permisos en segundo plano o activó ahorro de batería.`
            );
        }

        res.json({ ok: true });
    } catch (e) {
        console.error('❌ Error processing gps-event:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ============================================
// Driver Location Reporting & Snapping (Road Matching)
// ============================================
app.post('/api/driver/location', async (req, res) => {
    try {
        const { driver_id, lat, lng, speed, heading, battery, driverName, timestamp, source, snap } = req.body;
        if (!driver_id || lat === undefined || lng === undefined) {
            return res.status(400).json({ ok: false, error: 'driver_id, lat, and lng are required' });
        }

        const db = WhatsappBot.getDb();
        if (!db) {
            return res.status(503).json({ ok: false, error: 'Database not available' });
        }

        let finalLat = parseFloat(lat);
        let finalLng = parseFloat(lng);
        let corrected = false;

        // Snappear a la calle desactivado para evitar desplazamientos a calles paralelas por GPS drift en punto único
        if (false) {
            try {
                const axios = require('axios');
                const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyATwi1CCdw5q-8nYXTsTn8VCKoP13jbHBE';
                const url = `https://roads.googleapis.com/v1/snapToRoads?path=${finalLat},${finalLng}&key=${googleApiKey}`;
                const response = await axios.get(url, { timeout: 4000 });
                if (response.data && response.data.snappedPoints && response.data.snappedPoints.length > 0) {
                    const snappedPoint = response.data.snappedPoints[0].location;
                    if (snappedPoint.latitude !== undefined && snappedPoint.longitude !== undefined) {
                        finalLat = snappedPoint.latitude;
                        finalLng = snappedPoint.longitude;
                        corrected = true;
                    }
                }
            } catch (e) {
                console.error(`⚠️ [SNAP] Error snapping location for driver ${driver_id}:`, e.message);
            }
        }

        const eventTime = timestamp ? new Date(timestamp).getTime() : Date.now();
        const updateData = {
            lat: finalLat,
            lng: finalLng,
            lat_raw: parseFloat(lat),
            lng_raw: parseFloat(lng),
            corrected: corrected,
            heading: heading !== undefined ? parseFloat(heading) : 0,
            speed: speed !== undefined ? parseFloat(speed) : 0,
            battery: battery !== undefined && battery !== null ? parseInt(battery) : null,
            driverName: driverName || 'Chofer',
            updated_at: new Date(eventTime).toISOString(),
            last_heartbeat: eventTime,
            status: 'active',
            gps_status: 'active',
            _source: source || 'server_api'
        };

        await db.ref(`driver_positions/${driver_id}`).update(updateData);
        res.json({ ok: true, lat: finalLat, lng: finalLng, corrected });
    } catch (e) {
        console.error('❌ Error updating driver location:', e.message);
        res.status(500).json({ ok: false, error: e.message });
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

    // Iniciar el monitoreo en segundo plano de latidos (heartbeats) de choferes
    console.log('⏳ Iniciando verificador de latidos de choferes cada 60s...');
    setInterval(checkActiveDriverHeartbeats, 60000);
});

// Tarea periódica de verificación de latidos
async function checkActiveDriverHeartbeats() {
    try {
        const db = WhatsappBot.getDb();
        if (!db) return;

        // Fetch positions and fleets
        const [positionsSnap, fleetsSnap] = await Promise.all([
            db.ref('driver_positions').once('value'),
            db.ref('fleets').once('value')
        ]);

        const positions = positionsSnap.val() || {};
        const fleets = fleetsSnap.val() || {};

        const now = Date.now();

        for (const [fleetId, fleetData] of Object.entries(fleets)) {
            const shifts = fleetData.shifts || {};
            const activeShifts = Object.values(shifts).filter(s => s.status === 'active');

            for (const shift of activeShifts) {
                const driverId = shift.driverId;
                if (!driverId) continue;

                const posData = positions[driverId];
                if (!posData) continue;

                // Skip if voluntarily logged out or already marked as suspicious/gps_desactivado
                if (posData.status === 'logout_voluntario' || posData.status === 'suspicious_disconnect' || posData.status === 'gps_desactivado') {
                    continue;
                }

                // Check heartbeat
                const lastHeartbeat = posData.last_heartbeat || (posData.updated_at ? new Date(posData.updated_at).getTime() : 0);
                if (!lastHeartbeat) continue;

                const timeDiffMs = now - lastHeartbeat;
                if (timeDiffMs > 5 * 60 * 1000) { // 5 minutes
                    const driverName = posData.driverName || 'Chofer';
                    console.log(`🚨 [HEARTBEAT] Driver ${driverId} (${driverName}) inactive for ${Math.round(timeDiffMs/1000)}s. Marking as suspicious disconnect.`);
                    
                    // Mark in driver_positions
                    await db.ref(`driver_positions/${driverId}`).update({
                        status: 'suspicious_disconnect',
                        last_heartbeat_gap: timeDiffMs
                    });

                    // Log the event under fleet status logs
                    await db.ref(`fleets/${fleetId}/driver_status_logs`).push({
                        event: 'suspicious_disconnect',
                        driverId: driverId,
                        driverName: driverName,
                        timestamp: now
                    });

                    // Send push notification to admins
                    WhatsappBot.sendPushToAdmins(
                        `🚨 Desconexión Sospechosa`,
                        `El chofer ${driverName} ha dejado de reportar ubicación (sin señal o app cerrada).`
                    );
                }
            }
        }
    } catch (e) {
        console.error('❌ Error checking driver heartbeats:', e.message);
    }
}