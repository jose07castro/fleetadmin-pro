try { require('dotenv').config(); } catch (e) { console.log('ℹ️ dotenv no está instalado, se usarán variables de entorno del sistema.'); }
const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// Importar Bot de WhatsApp (Escucha grupos en segundo plano)
const WhatsappBot = require('./js/bot/whatsapp-bot');

// Importar Agente Centinela IA (Google Gemini 2.5 Flash)
const geminiAgent = require('./services/geminiAgent');

// Importar Servicio de Fotomultas e Infracciones de Velocidad
const SpeedInfractions = require('./services/speedInfractions');

// Habilitar CORS para todas las peticiones (requerido para clientes Capacitor/móviles)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// 1. Dejamos que Express sirva los archivos libremente (JS, CSS, HTML, lo que sea)
app.use(express.static(__dirname));

// Servir de forma explícita la carpeta de audios de alertas
const fs = require('fs');
const audioDir = path.join(__dirname, 'audio');
if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
}
app.use('/audio', express.static(audioDir, {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.ogg')) {
            res.setHeader('Content-Type', 'audio/ogg; codecs=opus');
        }
    }
}));

app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ limit: '60mb', extended: true }));

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
// Endpoint para Sugerencias de Usuarios al Desarrollador
// ============================================
app.post('/api/suggestions', async (req, res) => {
    try {
        const { userName, userRole, userPhone, fleetName, message } = req.body || {};
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
        }

        const devPhone = '5493415707731';
        const nowStr = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

        const whatsappText = `💡 *NUEVA SUGERENCIA DE PUNTO ALERTAS*
👤 *Usuario:* ${userName || 'Usuario'} (${userRole || 'General'})
📞 *Contacto:* ${userPhone || 'No informado'}
🚗 *Flota:* ${fleetName || 'General'}
📅 *Fecha:* ${nowStr}

💬 *Mensaje:*
"${message.trim()}"`;

        // 1. Guardar en Firebase RTDB como respaldo permanente
        const db = typeof WhatsappBot.getDb === 'function' ? WhatsappBot.getDb() : null;
        if (db) {
            try {
                await db.ref('developer_suggestions').push({
                    userName: userName || 'Usuario',
                    userRole: userRole || 'General',
                    userPhone: userPhone || null,
                    fleetName: fleetName || null,
                    message: message.trim(),
                    timestamp: Date.now(),
                    dateStr: nowStr
                });
            } catch(dbErr) {
                console.warn('⚠️ [SUGGESTION] No se pudo guardar en Firebase:', dbErr.message);
            }
        }

        // 2. Enviar por WhatsApp a todos los números administradores registrados
        const targetNumbers = ['5493415707731', '5493417327248'];
        if (typeof WhatsappBot.getTrustedAdminNumbers === 'function') {
            const dynamic = WhatsappBot.getTrustedAdminNumbers();
            if (Array.isArray(dynamic)) targetNumbers.push(...dynamic);
        }

        let sentToWhatsApp = false;
        if (typeof WhatsappBot.sendTextMessage === 'function') {
            const uniqueNumbers = [...new Set(targetNumbers.map(n => String(n).replace(/[^0-9]/g, '')))];
            for (const phone of uniqueNumbers) {
                if (!phone) continue;
                const sendRes = await WhatsappBot.sendTextMessage(phone, whatsappText);
                if (sendRes && sendRes.success) sentToWhatsApp = true;
            }
        }

        res.json({
            ok: true,
            sentToWhatsApp,
            message: '¡Gracias! Tu sugerencia fue enviada al desarrollador de Punto Alertas.'
        });
    } catch(err) {
        console.error('❌ Error en /api/suggestions:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// Bot Management Endpoints
// ============================================
// Endpoint de Health Check — usado por Render y por el keep-alive interno
app.get('/health', (req, res) => {
    res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

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

// Endpoint HTML para vincular WhatsApp o panel de control en vivo
app.get('/qr', async (req, res) => {
    try {
        let isConnected = false;
        let diag = {};
        let groups = {};
        let botConfig = {
            sentinel_enabled: true,
            max_alert_repeats: 2,
            traffic_keywords: [
                'operativo', 'operativos', 'control', 'controles', 'zorros', 'fiscalizacion', 
                'fiscalización', 'fisca', 'fizca', 'policia', 'policía', 'gorra', 'ratis', 
                'chanchos', 'radar', 'fotomulta', 'camara', 'cámara', 'alcoholemia', 'carreton', 
                'carretón', 'grua', 'grúa', 'accidente', 'choque', 'corte', 'cortada', 
                'levantaron', 'limpio', 'via libre', 'vía libre', 'despejado'
            ],
            forbidden_words: [
                'puto', 'puta', 'conchudo', 'conchuda', 'concha', 'pija', 'culo', 'verga', 'poronga', 'traba',
                'boludo', 'boluda', 'tarado', 'tarada', 'hijo de puta', 'hija de puta', 'hdp', 'forro', 'forra',
                'pelotudo', 'pelotuda', 'orto', 'pajero', 'pajera', 'cagon', 'cagona', 'culiao', 'culiada',
                'chota', 'mierda', 'trola', 'trolo', 'sorete', 'cabron', 'malparido', 'imbecil',
                'estafa', 'prestamo', 'préstamo', 'vendo', 'compro', 'sorteo', 'promo', 'promocion', 'promoción',
                'transferencia', 'ganaste', 'loteria', 'lotería', 'porno', 'casino'
            ],
            group_settings: {}
        };

        try {
            if (typeof WhatsappBot !== 'undefined') {
                if (typeof WhatsappBot.isConnected === 'function') isConnected = WhatsappBot.isConnected();
                if (typeof WhatsappBot.getDiagnostics === 'function') diag = WhatsappBot.getDiagnostics() || {};
                if (typeof WhatsappBot.getGroupCache === 'function') groups = WhatsappBot.getGroupCache() || {};
                if (typeof WhatsappBot.getBotConfig === 'function') botConfig = WhatsappBot.getBotConfig() || botConfig;
            }
        } catch(bErr) {
            console.warn('⚠️ [QR-ENDPOINT] Error leyendo bot:', bErr.message);
        }

        let qrUrl = diag.lastQr || null;
        if (!isConnected && !qrUrl && typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.getDb === 'function') {
            try {
                const db = WhatsappBot.getDb();
                if (db) {
                    const stSnap = await db.ref('bot_status').once('value');
                    const stVal = stSnap.val() || {};
                    if (stVal.qrUrl) qrUrl = stVal.qrUrl;
                    if (stVal.connected) isConnected = true;
                    if (stVal.phone && !diag.botNumber) diag.botNumber = stVal.phone;

                    const cfgSnap = await db.ref('bot_config').once('value');
                    const cVal = cfgSnap.val();
                    if (cVal) {
                        if (typeof cVal.sentinel_enabled === 'boolean') botConfig.sentinel_enabled = cVal.sentinel_enabled;
                        if (typeof cVal.max_alert_repeats === 'number') botConfig.max_alert_repeats = cVal.max_alert_repeats;
                        if (Array.isArray(cVal.traffic_keywords)) botConfig.traffic_keywords = cVal.traffic_keywords;
                        if (Array.isArray(cVal.forbidden_words)) botConfig.forbidden_words = cVal.forbidden_words;
                        if (cVal.group_settings) botConfig.group_settings = { ...botConfig.group_settings, ...cVal.group_settings };
                    }
                }
            } catch(dbErr) {}
        }

        const isSentinelActive = botConfig.sentinel_enabled !== false;
        const maxRepeats = botConfig.max_alert_repeats || 2;
        const trafficKeywordsStr = Array.isArray(botConfig.traffic_keywords) ? botConfig.traffic_keywords.join(', ') : '';
        const forbiddenWordsStr = Array.isArray(botConfig.forbidden_words) ? botConfig.forbidden_words.join(', ') : '';

        // Combinar grupos del bot y de la configuración
        const allGroupsMap = { ...groups };
        if (botConfig.group_settings) {
            for (const item of Object.values(botConfig.group_settings)) {
                if (item && item.jid && !allGroupsMap[item.jid]) {
                    allGroupsMap[item.jid] = item.name || item.jid;
                }
            }
        }

        const groupRowsHtml = Object.entries(allGroupsMap).map(([jid, name]) => {
            const safeKey = jid.replace(/[^a-zA-Z0-9_-]/g, '_');
            const gConf = botConfig.group_settings ? (botConfig.group_settings[safeKey] || botConfig.group_settings[jid]) : null;
            const isGroupActive = gConf ? gConf.enabled !== false : true;
            const displayName = (gConf && gConf.name) ? gConf.name : name;

            return `
            <div class="group-row" data-jid="${jid}" data-name="${displayName}">
                <div class="group-info">
                    <span class="group-name">${displayName}</span>
                    <span class="group-jid">${jid}</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span id="badge-${safeKey}" class="badge ${isGroupActive ? 'badge-ok' : 'badge-paused'}">${isGroupActive ? 'Activo' : 'Silenciado'}</span>
                    <button class="btn btn-sm ${isGroupActive ? 'btn-toggle-on' : 'btn-toggle-off'}" 
                            data-active="${isGroupActive}" 
                            onclick="toggleGroup('${jid}', this)">
                        ${isGroupActive ? '🟢 Activo' : '⚪ Silenciado'}
                    </button>
                </div>
            </div>`;
        }).join('');

        const totalGroupsCount = Object.keys(allGroupsMap).length;

        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FleetAdmin Pro — Panel de Control Bot & Centinela IA</title>
    <style>
        :root {
            --bg-main: #090d16;
            --card-bg: #131b2e;
            --card-border: #1e293b;
            --accent-blue: #0ea5e9;
            --accent-emerald: #10b981;
            --accent-amber: #f59e0b;
            --accent-rose: #f43f5e;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--bg-main);
            color: var(--text-main);
            padding: 24px 16px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .container {
            width: 100%;
            max-width: 860px;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 22px;
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
        }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--card-border);
            padding-bottom: 14px;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 10px;
        }
        .card-title {
            font-size: 1.15rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            border-radius: 9999px;
            font-weight: 700;
            font-size: 12px;
        }
        .badge-ok { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
        .badge-paused { background: rgba(244, 63, 94, 0.2); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.3); }
        .badge-wait { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 9px 16px;
            border-radius: 10px;
            border: none;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
        }
        .btn:hover { transform: translateY(-1px); filter: brightness(1.1); }
        .btn:active { transform: translateY(0); }
        .btn-blue { background: #0284c7; color: white; }
        .btn-emerald { background: #059669; color: white; }
        .btn-amber { background: #d97706; color: white; }
        .btn-rose { background: #e11d48; color: white; }
        .btn-secondary { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
        .btn-sm { padding: 6px 12px; font-size: 12px; border-radius: 8px; }
        .btn-toggle-on { background: #059669; color: white; }
        .btn-toggle-off { background: #334155; color: #94a3b8; }

        .qr-box { background: white; padding: 14px; border-radius: 12px; display: inline-block; margin: 15px auto; }
        .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        @media (max-width: 680px) {
            .grid-2 { grid-template-columns: 1fr; }
        }
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
            text-align: left;
        }
        .form-label {
            font-size: 13px;
            font-weight: 600;
            color: #cbd5e1;
        }
        .form-hint {
            font-size: 11px;
            color: var(--text-muted);
            margin-bottom: 2px;
            line-height: 1.4;
        }
        textarea.form-control, input.form-control, select.form-control {
            width: 100%;
            background: #090d16;
            border: 1px solid #1e293b;
            border-radius: 10px;
            color: #f8fafc;
            padding: 10px 12px;
            font-size: 13px;
            font-family: inherit;
            outline: none;
            transition: border 0.2s;
        }
        textarea.form-control:focus, input.form-control:focus, select.form-control:focus {
            border-color: var(--accent-blue);
        }
        textarea.form-control {
            resize: vertical;
            min-height: 90px;
            line-height: 1.5;
        }
        .group-search-box {
            display: flex;
            gap: 10px;
            margin-bottom: 12px;
            flex-wrap: wrap;
        }
        .group-list-box {
            max-height: 340px;
            overflow-y: auto;
            border: 1px solid #1e293b;
            border-radius: 12px;
            background: #090d16;
            padding: 4px;
        }
        .group-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 9px 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
            gap: 10px;
        }
        .group-row:last-child { border-bottom: none; }
        .group-row:hover { background: rgba(255, 255, 255, 0.02); }
        .group-info {
            display: flex;
            flex-direction: column;
            text-align: left;
            overflow: hidden;
            flex: 1;
        }
        .group-name {
            font-weight: 600;
            font-size: 13.5px;
            color: #f1f5f9;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .group-jid {
            font-size: 11px;
            color: var(--text-muted);
            font-family: monospace;
        }
        .toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #065f46;
            color: #34d399;
            border: 1px solid #059669;
            padding: 12px 20px;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            font-weight: 600;
            font-size: 14px;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s ease;
            z-index: 9999;
            pointer-events: none;
        }
        .toast.show {
            opacity: 1;
            transform: translateY(0);
        }
    </style>
    ${!isConnected ? '<meta http-equiv="refresh" content="5">' : ''}
</head>
<body>
    <div class="container">
        <!-- 1. ESTADO WHATSAPP -->
        <div class="card">
            <div class="card-header">
                <span class="card-title">🚗 FleetAdmin Pro — Bot de WhatsApp</span>
                <span class="badge ${isConnected ? 'badge-ok' : 'badge-wait'}">
                    ${isConnected ? '✅ CONECTADO Y ACTIVO' : '📱 ESPERANDO QR'}
                </span>
            </div>
            
            <div style="margin: 10px 0; text-align:center;">
                ${isConnected 
                    ? '<p style="font-size:15px; color:#cbd5e1;">Número Vinculado: <b style="color:#38bdf8;">+' + (diag.botNumber || 'Activo') + '</b></p>' 
                    : '<p style="color:#94a3b8; font-size:13px;">Abrí WhatsApp en tu teléfono > Dispositivos vinculados > Vincular un dispositivo</p>'}
            </div>

            ${!isConnected && qrUrl ? `
                <div style="text-align:center;">
                    <div class="qr-box">
                        <img src="${qrUrl}" alt="Código QR WhatsApp" style="width: 250px; height: 250px; display: block;" />
                    </div>
                    <p style="color:#94a3b8;font-size:12px;">Se actualiza automáticamente cada 5 segundos.</p>
                </div>
            ` : ''}

            ${!isConnected && !qrUrl ? `
                <p style="color:#fbbf24;padding:15px;text-align:center;font-size:14px;">⏳ Generando código QR o conectando... Si demora, tocá "Generar Nuevo QR".</p>
            ` : ''}

            <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-top:14px;">
                <button class="btn btn-blue" onclick="fetch('/api/bot/test-alert', {method:'POST'}).then(r=>r.json()).then(d=>showToast('🚨 Alerta de prueba enviada al mapa'))">🚨 Enviar Alerta Prueba</button>
                <button class="btn btn-amber" onclick="fetch('/api/bot/soft-reset', {method:'POST'}).then(r=>r.json()).then(d=>{showToast(d.message); setTimeout(()=>location.reload(), 800);})">🔧 Curar Sesión (Soft Reset)</button>
                <button class="btn btn-rose" onclick="if(confirm('¿Desvincular WhatsApp y pedir QR nuevo?')) fetch('/api/bot/reset-session', {method:'POST'}).then(r=>r.json()).then(d=>{showToast(d.message); setTimeout(()=>location.reload(), 800);})">🔑 Generar Nuevo QR</button>
            </div>
        </div>

        <!-- 2. CONTROL MAESTRO DEL CENTINELA IA -->
        <div class="card">
            <div class="card-header">
                <span class="card-title">🧠 Control Maestro del Centinela IA</span>
                <span id="sentinelStatusBadge" class="badge ${isSentinelActive ? 'badge-ok' : 'badge-paused'}">
                    ${isSentinelActive ? '🟢 ACTIVO Y ESCUCHANDO' : '🔴 PAUSADO (Silenciado)'}
                </span>
            </div>

            <p style="text-align:left; color:#94a3b8; font-size:13px; margin-bottom:14px; line-height:1.5;">
                Desde acá podés pausar el Centinela en cualquier momento para evitar que hable o publique alertas. También podés configurar el límite estricto de repetición de voz y silenciar el sistema si ocurre una emergencia.
            </p>

            <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:16px;">
                <button id="btnToggleSentinel" 
                        class="btn ${isSentinelActive ? 'btn-rose' : 'btn-emerald'}" 
                        onclick="toggleSentinel()">
                    ${isSentinelActive ? '⏸️ Pausar Centinela IA' : '▶️ Reanudar Centinela IA'}
                </button>
                <button class="btn btn-rose" onclick="clearAlertsAndSilence()">
                    🔇 Silenciar Voz y Limpiar Alertas Repetidas
                </button>
            </div>

            <div class="form-group" style="max-width:320px;">
                <label class="form-label">Límite de repetición de voz por alerta:</label>
                <p class="form-hint">Máxima cantidad de veces que se reproduce por voz la misma ubicación (en 15 minutos).</p>
                <select id="maxRepeatsSelect" class="form-control" onchange="saveMaxRepeats(this.value)">
                    <option value="1" ${maxRepeats === 1 ? 'selected' : ''}>1 vez (Ultra silencioso)</option>
                    <option value="2" ${maxRepeats === 2 ? 'selected' : ''}>2 veces (Recomendado por defecto)</option>
                    <option value="3" ${maxRepeats === 3 ? 'selected' : ''}>3 veces</option>
                </select>
            </div>
        </div>

        <!-- 3. ADMINISTRACIÓN DE GRUPOS DE WHATSAPP -->
        <div class="card">
            <div class="card-header">
                <span class="card-title">👥 Administración de Grupos (${totalGroupsCount} Conectados)</span>
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-sm btn-secondary" onclick="toggleAll(true)">✅ Activar Todos</button>
                    <button class="btn btn-sm btn-secondary" onclick="toggleAll(false)">🔇 Silenciar Todos</button>
                </div>
            </div>

            <div class="group-search-box">
                <input type="text" 
                       id="groupSearchInput" 
                       class="form-control" 
                       placeholder="🔍 Buscar grupo por nombre o JID..." 
                       oninput="filterGroups(this.value)" />
            </div>

            <div class="group-list-box">
                ${groupRowsHtml ? groupRowsHtml : '<p style="color:#94a3b8; padding:20px; text-align:center;">No hay grupos sincronizados aún.</p>'}
            </div>
        </div>

        <!-- 4. PALABRAS PERMITIDAS Y PROHIBIDAS -->
        <div class="card">
            <div class="card-header">
                <span class="card-title">📝 Palabras Permitidas y Prohibidas</span>
                <button id="btnSaveKeywords" class="btn btn-emerald" onclick="saveKeywords()">
                    💾 Guardar Cambios en Palabras Clave
                </button>
            </div>

            <div class="grid-2">
                <div class="form-group">
                    <label class="form-label" style="color:#34d399;">🟢 Palabras Permitidas (Tránsito y Operativos)</label>
                    <p class="form-hint">Términos que el Centinela clasifica como incidentes viales activos (separados por coma).</p>
                    <textarea id="trafficKeywordsInput" class="form-control" rows="5">${trafficKeywordsStr}</textarea>
                </div>

                <div class="form-group">
                    <label class="form-label" style="color:#fb7185;">🔴 Palabras Prohibidas (Filtro / Censura / Spam)</label>
                    <p class="form-hint">Mensajes con spam, estafas o estas palabras son descartados o censurados automáticamente.</p>
                    <textarea id="forbiddenWordsInput" class="form-control" rows="5">${forbiddenWordsStr}</textarea>
                </div>
            </div>
        </div>
    </div>

    <!-- TOAST NOTIFICATION -->
    <div id="toast" class="toast">Acción completada</div>

    <script>
        function showToast(msg, isError = false) {
            const t = document.getElementById('toast');
            if (!t) return;
            t.textContent = msg;
            t.style.background = isError ? '#881337' : '#065f46';
            t.style.color = isError ? '#fda4af' : '#34d399';
            t.style.borderColor = isError ? '#e11d48' : '#059669';
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 3500);
        }

        async function toggleSentinel() {
            const btn = document.getElementById('btnToggleSentinel');
            btn.disabled = true;
            try {
                const res = await fetch('/api/bot/toggle-sentinel', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    showToast(data.sentinel_enabled ? '✅ Centinela IA REANUDADO' : '⏸️ Centinela IA PAUSADO');
                    setTimeout(() => location.reload(), 600);
                } else {
                    showToast('Error: ' + data.error, true);
                    btn.disabled = false;
                }
            } catch(e) {
                showToast('Error de conexión', true);
                btn.disabled = false;
            }
        }

        async function clearAlertsAndSilence() {
            if (!confirm('¿Seguro que querés silenciar y vaciar todas las alertas en el mapa y celulares?')) return;
            try {
                if (typeof window !== 'undefined' && window.speechSynthesis) {
                    window.speechSynthesis.cancel();
                }
                const res = await fetch('/api/bot/clear-alerts', { method: 'POST' });
                const data = await res.json();
                if (data.ok) {
                    showToast('🔇 Alertas limpiadas y voz detenida en todos los celulares');
                } else {
                    showToast('Error: ' + data.error, true);
                }
            } catch(e) {
                showToast('Error de conexión', true);
            }
        }

        async function saveKeywords() {
            const btn = document.getElementById('btnSaveKeywords');
            btn.disabled = true;
            btn.textContent = 'Guardando...';
            try {
                const trafficRaw = document.getElementById('trafficKeywordsInput').value;
                const forbiddenRaw = document.getElementById('forbiddenWordsInput').value;
                const maxRepeats = parseInt(document.getElementById('maxRepeatsSelect').value) || 2;

                const traffic_keywords = trafficRaw.split(',').map(s => s.trim()).filter(Boolean);
                const forbidden_words = forbiddenRaw.split(',').map(s => s.trim()).filter(Boolean);

                const res = await fetch('/api/bot/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        traffic_keywords,
                        forbidden_words,
                        max_alert_repeats: maxRepeats
                    })
                });
                const data = await res.json();
                if (data.ok) {
                    showToast('💾 Configuración de palabras guardada con éxito');
                } else {
                    showToast('Error guardando: ' + (data.error || 'Desconocido'), true);
                }
            } catch(e) {
                showToast('Error de red al guardar', true);
            } finally {
                btn.disabled = false;
                btn.textContent = '💾 Guardar Cambios en Palabras Clave';
            }
        }

        async function saveMaxRepeats(val) {
            try {
                const repeats = parseInt(val) || 2;
                await fetch('/api/bot/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ max_alert_repeats: repeats })
                });
                showToast('Límite actualizado a ' + repeats + ' repeticiones');
            } catch(e) {}
        }

        async function toggleGroup(jid, btn) {
            const isCurrentlyActive = btn.getAttribute('data-active') === 'true';
            const newStatus = !isCurrentlyActive;
            btn.disabled = true;
            try {
                const res = await fetch('/api/bot/group-setting', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jid, enabled: newStatus })
                });
                const data = await res.json();
                if (data.ok) {
                    btn.setAttribute('data-active', newStatus ? 'true' : 'false');
                    btn.className = 'btn btn-sm ' + (newStatus ? 'btn-toggle-on' : 'btn-toggle-off');
                    btn.textContent = newStatus ? '🟢 Activo' : '⚪ Silenciado';
                    const safeKey = jid.replace(/[^a-zA-Z0-9_-]/g, '_');
                    const badge = document.getElementById('badge-' + safeKey);
                    if (badge) {
                        badge.className = 'badge ' + (newStatus ? 'badge-ok' : 'badge-paused');
                        badge.textContent = newStatus ? 'Activo' : 'Silenciado';
                    }
                    showToast(newStatus ? 'Grupo activado' : 'Grupo silenciado');
                } else {
                    showToast('Error: ' + data.error, true);
                }
            } catch(e) {
                showToast('Error de conexión', true);
            } finally {
                btn.disabled = false;
            }
        }

        async function toggleAll(enableAll) {
            if (!confirm(enableAll ? '¿Activar alertas en todos los grupos?' : '¿Silenciar todos los grupos?')) return;
            try {
                const res = await fetch('/api/bot/group-toggle-all', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: enableAll })
                });
                const data = await res.json();
                if (data.ok) {
                    showToast(enableAll ? 'Todos los grupos activados' : 'Todos los grupos silenciados');
                    setTimeout(() => location.reload(), 600);
                } else {
                    showToast('Error: ' + data.error, true);
                }
            } catch(e) {
                showToast('Error de conexión', true);
            }
        }

        function filterGroups(query) {
            const q = query.toLowerCase().trim();
            const rows = document.querySelectorAll('.group-row');
            rows.forEach(r => {
                const name = (r.getAttribute('data-name') || '').toLowerCase();
                const jid = (r.getAttribute('data-jid') || '').toLowerCase();
                if (name.includes(q) || jid.includes(q)) {
                    r.style.display = 'flex';
                } else {
                    r.style.display = 'none';
                }
            });
        }
    </script>
</body>
</html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch(err) {
        res.status(500).send('Error cargando QR: ' + err.message);
    }
});

// ============================================
// ENDPOINTS DE CONTROL DEL BOT & CENTINELA IA
// ============================================
app.get('/api/bot/config', async (req, res) => {
    try {
        const cfg = typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.getBotConfig === 'function'
            ? WhatsappBot.getBotConfig()
            : { sentinel_enabled: true, max_alert_repeats: 2, traffic_keywords: [], forbidden_words: [], group_settings: {}, groups: {} };
        res.json({ ok: true, config: cfg });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/bot/config', async (req, res) => {
    try {
        if (typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.updateBotConfig === 'function') {
            const updated = await WhatsappBot.updateBotConfig(req.body || {});
            return res.json({ ok: true, config: updated });
        }
        res.status(503).json({ ok: false, error: 'Bot no inicializado' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/bot/toggle-sentinel', async (req, res) => {
    try {
        if (typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.toggleSentinel === 'function') {
            const result = await WhatsappBot.toggleSentinel(req.body?.enabled);
            return res.json(result);
        }
        res.status(503).json({ ok: false, error: 'Bot no inicializado' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/bot/clear-alerts', async (req, res) => {
    try {
        if (typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.clearAlertsAndSilence === 'function') {
            const result = await WhatsappBot.clearAlertsAndSilence();
            return res.json(result);
        }
        res.status(503).json({ ok: false, error: 'Bot no inicializado' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/bot/group-setting', async (req, res) => {
    try {
        const { jid, enabled, customName } = req.body || {};
        if (!jid) return res.status(400).json({ ok: false, error: 'jid is required' });
        if (typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.setGroupSetting === 'function') {
            const result = await WhatsappBot.setGroupSetting(jid, enabled, customName);
            return res.json({ ok: true, group: result });
        }
        res.status(503).json({ ok: false, error: 'Bot no inicializado' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/bot/group-toggle-all', async (req, res) => {
    try {
        const { enabled } = req.body || {};
        if (typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.toggleAllGroups === 'function') {
            const result = await WhatsappBot.toggleAllGroups(enabled);
            return res.json(result);
        }
        res.status(503).json({ ok: false, error: 'Bot no inicializado' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/bot/diagnostics', (req, res) => {
    try {
        const diag = typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.getDiagnostics === 'function' ? WhatsappBot.getDiagnostics() : {};
        const groups = typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.getGroupCache === 'function' ? WhatsappBot.getGroupCache() : {};
        res.json({ ok: true, ...diag, groups, timestamp: new Date().toISOString() });
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('/api/bot/live-events', async (req, res) => {
    try {
        const db = typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.getDb === 'function' ? WhatsappBot.getDb() : null;
        if (!db) return res.status(503).json({ ok: false, error: 'DB no disponible' });
        const snap = await db.ref('bot_live_events').limitToLast(30).once('value');
        res.json({ ok: true, events: snap.val() || {} });
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/bot/send-trabajo', async (req, res) => {
    try {
        const text = req.body?.text || '🤖 FleetAdmin Centinela activo y listo en el grupo Trabajo.';
        const result = await WhatsappBot.sendTextMessage('120363233913674611@g.us', text);
        res.json({ ok: true, result });
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/bot/simulate-group-message', async (req, res) => {
    try {
        const text = req.body?.text || 'Operativo de fiscalización en Belgrano y Rioja';
        const groupJid = req.body?.jid || '120363233913674611@g.us';
        const sender = req.body?.sender || '5493417327248@s.whatsapp.net';
        const pushName = req.body?.pushName || 'Marianela González';
        const mockMsg = {
            key: {
                remoteJid: groupJid,
                fromMe: false,
                id: 'SIM_' + Date.now(),
                participant: sender
            },
            message: {
                conversation: text
            },
            messageTimestamp: Math.floor(Date.now() / 1000),
            pushName: pushName
        };
        const ok = typeof WhatsappBot.emitMockMessage === 'function'
            ? WhatsappBot.emitMockMessage(mockMsg)
            : false;
        res.json({ ok, simulatedMessage: mockMsg });
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/api/bot/flush', (req, res) => {
    try {
        const ok = typeof WhatsappBot.flushBuffer === 'function' ? WhatsappBot.flushBuffer() : false;
        res.json({ ok, message: 'Buffer vaciado' });
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ============================================
// Endpoint para Reporte de Infracción de Chofer (Copiloto / App)
// ============================================
app.post('/api/driver/speed-infraction', async (req, res) => {
    try {
        const { driver_id, driverName, radarId, radarName, radarAddress, radarLimit, speed } = req.body;
        if (!driver_id) {
            return res.status(400).json({ ok: false, error: 'driver_id is required' });
        }

        let radar = null;
        const allRadars = SpeedInfractions.getRadars();
        if (radarId) {
            radar = allRadars.find(r => r.id === radarId);
        }
        if (!radar && radarName) {
            radar = allRadars.find(r => r.name.toLowerCase() === radarName.toLowerCase());
        }
        if (!radar) {
            radar = {
                id: radarId || 'radar_custom',
                name: radarName || 'Fotomulta',
                address: radarAddress || radarName || 'Rosario',
                limit: radarLimit || 40
            };
        }

        const result = await SpeedInfractions.reportInfraction({
            driverId: driver_id,
            driverName: driverName,
            radar: radar,
            speed: parseFloat(speed) || 0,
            source: 'client_copilot'
        });

        res.json(result);
    } catch (e) {
        console.error('❌ Error en /api/driver/speed-infraction:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Endpoint de prueba manual para enviar reporte de fotomulta al grupo Trabajo
app.post('/api/bot/test-speed-infraction', async (req, res) => {
    try {
        const { driverName, vehicleName, radarIndex, speed } = req.body;
        const result = await SpeedInfractions.testInfraction(
            driverName || 'Pablo',
            vehicleName || 'Chevrolet Cobalt LT (01)',
            radarIndex !== undefined ? parseInt(radarIndex) : 0,
            speed !== undefined ? parseFloat(speed) : 58
        );
        res.json({ ok: true, result });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});


// Endpoint de diagnóstico para verificar los archivos de audio en Render
app.get('/api/debug/audio-files', (req, res) => {
    try {
        const audioPath = path.join(__dirname, 'audio');
        const exists = fs.existsSync(audioPath);
        let files = [];
        if (exists) {
            files = fs.readdirSync(audioPath).map(file => {
                const stat = fs.statSync(path.join(audioPath, file));
                return {
                    name: file,
                    size: stat.size,
                    mtime: stat.mtime
                };
            });
        }
        res.json({
            ok: true,
            serverDirname: __dirname,
            audioPath: audioPath,
            exists: exists,
            files: files,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
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
        await db.ref(`global_traffic_alerts/${alertId}`).set(alertData);
        res.json({ ok: true, fleetId, alertId, message: `✅ Alerta de prueba guardada en fleets/${fleetId}/traffic_alerts/${alertId} y global_traffic_alerts` });
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

// Obtener estadísticas exactas de kilómetros de cada auto calculadas desde los turnos de la app
app.get('/api/fleet/km-stats', async (req, res) => {
    try {
        const fleetId = req.query.fleetId || (typeof WhatsappBot.getFleetId === 'function' ? await WhatsappBot.getFleetId() : '-OnPd8HaV1VZWBnYQQX7');
        const yearMonth = req.query.month || new Date().toISOString().substring(0, 7);
        if (typeof WhatsappBot.getVehicleKmStats === 'function') {
            const stats = await WhatsappBot.getVehicleKmStats(fleetId, yearMonth);
            res.json({ ok: true, stats });
        } else {
            res.status(500).json({ ok: false, error: 'WhatsappBot.getVehicleKmStats no está disponible' });
        }
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});



// List Gemini Models
app.get('/api/bot/list-models', async (req, res) => {
    try {
        const axios = require('axios');
        const WhatsappBot = require('./js/bot/whatsapp-bot');
        const key = process.env.GEMINI_API_KEY || (typeof WhatsappBot.getGeminiKey === 'function' ? WhatsappBot.getGeminiKey() : null);
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

// Diagnóstico de cola de WhatsApp y estado de comprobantes
app.get('/api/bot/queue-status', (req, res) => {
    try {
        const WhatsappBot = require('./js/bot/whatsapp-bot');
        const status = typeof WhatsappBot.getQueueStatus === 'function'
            ? WhatsappBot.getQueueStatus()
            : { queueSize: 0, sample: [] };
        const key = typeof WhatsappBot.getGeminiKey === 'function' ? WhatsappBot.getGeminiKey() : process.env.GEMINI_API_KEY;
        res.json({
            ok: true,
            hasGeminiKey: !!key,
            ...status
        });
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ============================================
// Endpoints de Pagos y Efectivo Pendientes
// ============================================

// Listar pagos y avisos de efectivo pendientes de confirmación
app.get('/api/bot/pending-payments', async (req, res) => {
    try {
        const WhatsappBot = require('./js/bot/whatsapp-bot');
        const fleetId = req.query.fleetId || await WhatsappBot.getFleetId();
        const payments = typeof WhatsappBot.listPendingPayments === 'function'
            ? await WhatsappBot.listPendingPayments(fleetId)
            : [];
        res.json({ ok: true, payments });
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Confirmar e ingresar pago al balance
app.post('/api/bot/pending-payments/confirm', async (req, res) => {
    try {
        const WhatsappBot = require('./js/bot/whatsapp-bot');
        const { code, fleetId } = req.body;
        if (typeof WhatsappBot.confirmPendingPayment !== 'function') {
            return res.status(500).json({ ok: false, error: 'Función no disponible en el bot.' });
        }
        const result = await WhatsappBot.confirmPendingPayment(code, fleetId, 'web_dashboard');
        res.json(result);
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Rechazar pago pendiente
app.post('/api/bot/pending-payments/reject', async (req, res) => {
    try {
        const WhatsappBot = require('./js/bot/whatsapp-bot');
        const { code, fleetId } = req.body;
        if (typeof WhatsappBot.rejectPendingPayment !== 'function') {
            return res.status(500).json({ ok: false, error: 'Función no disponible en el bot.' });
        }
        const result = await WhatsappBot.rejectPendingPayment(code, fleetId, 'web_dashboard');
        res.json(result);
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
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

// ====================================================
// GOOGLE SHEETS & DRIVE API (Auto-Creación de Planillas)
// ====================================================
const crypto = require('crypto');

function base64UrlEncode(strOrBuffer) {
    const buf = Buffer.isBuffer(strOrBuffer) ? strOrBuffer : Buffer.from(strOrBuffer, 'utf8');
    return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getGoogleAccessToken() {
    try {
        let certData = null;
        let possiblePaths = [
            path.join(__dirname, 'fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json'),
            path.join(__dirname, '../../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json'),
            path.join(__dirname, 'data/firebase-service-account.json')
        ];

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                try { certData = JSON.parse(fs.readFileSync(p, 'utf8')); break; } catch(e){}
            }
            if (fs.existsSync(p + '.base64')) {
                try {
                    const b64Str = fs.readFileSync(p + '.base64', 'utf8').trim();
                    certData = JSON.parse(Buffer.from(b64Str, 'base64').toString('utf8'));
                    break;
                } catch(e){}
            }
        }

        if (!certData && process.env.FIREBASE_SERVICE_ACCOUNT) {
            const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
            try {
                if (raw.startsWith('{')) {
                    certData = JSON.parse(raw);
                } else {
                    certData = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
                }
            } catch(e){}
        }

        if (!certData) {
            const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim().replace(/^"|"$/g, '');
            let privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim().replace(/^"|"$/g, '');
            if (privateKey) privateKey = privateKey.replace(/\\n/g, '\n');

            if (clientEmail && privateKey.length > 50) {
                certData = { client_email: clientEmail, private_key: privateKey };
            }
        }

        if (!certData || !certData.client_email || !certData.private_key) {
            console.warn('⚠️ Google Service Account no disponible para API token directo.');
            return null;
        }

        const now = Math.floor(Date.now() / 1000);
        const header = { alg: 'RS256', typ: 'JWT' };
        const claimSet = {
            iss: certData.client_email,
            scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
            aud: 'https://oauth2.googleapis.com/token',
            exp: now + 3600,
            iat: now
        };

        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
        const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

        const signer = crypto.createSign('RSA-SHA256');
        signer.update(signatureInput);
        const signature = base64UrlEncode(signer.sign(certData.private_key));

        const jwt = `${signatureInput}.${signature}`;

        const axios = require('axios');
        const tokenRes = await axios.post('https://oauth2.googleapis.com/token', 
            `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
        );

        return tokenRes.data?.access_token || null;
    } catch(e) {
        console.error('❌ Error obteniendo Google OAuth Token:', e.message);
        return null;
    }
}

async function autoCreateGoogleSpreadsheet(fleetId = '-OnPd8HaV1VZWBnYQQX7') {
    fleetId = await _resolveServerFleetId(fleetId);
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
        throw new Error('No se pudieron obtener credenciales de Google Service Account para crear la planilla.');
    }

    const axios = require('axios');

    // 1. Crear la planilla vía Google Sheets REST API
    try {
        const createRes = await axios.post('https://sheets.googleapis.com/v4/spreadsheets', {
            properties: {
                title: `FleetAdmin Pro - Balances y Comprobantes (${new Date().toLocaleDateString('es-AR')})`
            },
            sheets: [
                {
                    properties: { title: 'Movimientos' },
                    data: [
                        {
                            startRow: 0,
                            startColumn: 0,
                            rowData: [
                                {
                                    values: [
                                        { userEnteredValue: { stringValue: "ID Movimiento" } },
                                        { userEnteredValue: { stringValue: "Fecha" } },
                                        { userEnteredValue: { stringValue: "Tipo" } },
                                        { userEnteredValue: { stringValue: "Monto ($)" } },
                                        { userEnteredValue: { stringValue: "Concepto" } },
                                        { userEnteredValue: { stringValue: "Emisor / Receptor" } },
                                        { userEnteredValue: { stringValue: "Origen" } }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        }, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            timeout: 15000
        });

        const spreadsheetId = createRes.data?.spreadsheetId;
        const spreadsheetUrl = createRes.data?.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

        if (!spreadsheetId) {
            throw new Error('Google Sheets API no devolvió ID de la planilla.');
        }

        // 2. Hacer pública la planilla en Google Drive (permiso de lectura/escritura)
        try {
            await axios.post(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`, {
                role: 'writer',
                type: 'anyone'
            }, {
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                timeout: 10000
            });
        } catch(permErr) {
            console.warn('⚠️ No se pudo compartir públicamente la planilla:', permErr.message);
        }

        // 3. Guardar URL en la base de datos Firebase de la flota
        const db = WhatsappBot.getDb();
        if (db && fleetId) {
            await db.ref(`fleets/${fleetId}/settings/google_sheet_id`).set(spreadsheetUrl);
        }

        console.log(`✨ [GOOGLE-SHEETS] Planilla creada y configurada con éxito: ${spreadsheetUrl}`);
        return { spreadsheetId, spreadsheetUrl };
    } catch(apiErr) {
        console.error('❌ [GOOGLE-SHEETS-API] Error al crear la planilla:', apiErr.response?.data || apiErr.message);
        const gMessage = apiErr.response?.data?.error?.message || apiErr.message;
        if (gMessage.includes('Google Sheets API') || gMessage.includes('disabled')) {
            throw new Error(`Google Sheets API no está activada en Google Cloud Console (Project ID: 289124272326). Para usar la creación directa, activá la API en Google Cloud Console, o vinculá tu planilla usando la URL de Apps Script Webhook (botón Ver Apps Script).`);
        }
        throw new Error(`Error de Google API: ${gMessage}`);
    }
}

async function _resolveServerFleetId(providedId) {
    if (providedId && providedId !== 'jose07' && providedId !== 'default' && providedId !== 'null' && providedId !== 'undefined') {
        return providedId;
    }
    if (typeof WhatsappBot.getFleetId === 'function') {
        try {
            const fid = await WhatsappBot.getFleetId();
            if (fid && fid !== 'jose07') return fid;
        } catch(e) {}
    }
    return '-OnPd8HaV1VZWBnYQQX7';
}

// Endpoint para consultar fleetId activo
app.get('/api/bot/fleet-id', async (req, res) => {
    try {
        const fleetId = await _resolveServerFleetId(req.query.fleetId);
        return res.json({ ok: true, fleetId });
    } catch(e) {
        return res.json({ ok: true, fleetId: '-OnPd8HaV1VZWBnYQQX7' });
    }
});

// Endpoint CSV para sincronización automática instantánea en Google Sheets con =IMPORTDATA(...)
app.get('/api/sheets/csv', async (req, res) => {
    try {
        const fleetId = await _resolveServerFleetId(req.query.fleetId);
        const db = WhatsappBot.getDb();
        if (!db) {
            return res.status(503).send('Base de datos no disponible');
        }

        const snap = await db.ref(`fleets/${fleetId}/movements`).once('value');
        const movementsObj = snap.val() || {};
        const movements = Object.values(movementsObj).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        // Cabecera CSV en español
        let csv = 'ID Movimiento,Fecha,Tipo,Monto ($),Concepto,Emisor / Chofer,Origen\n';

        for (const m of movements) {
            const id = `"${(m.id || '').replace(/"/g, '""')}"`;
            const date = `"${(m.date ? new Date(m.date).toLocaleString('es-AR') : new Date().toLocaleString('es-AR')).replace(/"/g, '""')}"`;
            const type = `"${(m.type || 'Ingreso').replace(/"/g, '""')}"`;
            const amount = Number(m.amount) || 0;
            const concept = `"${(m.concept || '').replace(/"/g, '""')}"`;
            const party = `"${(m.party || m.driverName || '').replace(/"/g, '""')}"`;
            const source = `"${(m.source || 'WhatsApp Bot').replace(/"/g, '""')}"`;

            csv += `${id},${date},${type},${amount},${concept},${party},${source}\n`;
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="balance_${fleetId}.csv"`);
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.send(csv);
    } catch (e) {
        console.error('❌ [SHEETS-CSV] Error generando CSV de balance:', e.message);
        return res.status(500).send('Error generando CSV: ' + e.message);
    }
});

// Endpoint para auto-crear planilla de Google Sheets
app.post('/api/sheets/auto-create', async (req, res) => {
    try {
        const fleetId = await _resolveServerFleetId(req.body.fleetId);
        console.log(`✨ [AUTO-CREATE-SHEET] Solicitada creación de Google Sheet para flota: ${fleetId}`);
        const result = await autoCreateGoogleSpreadsheet(fleetId);

        return res.json({
            ok: true,
            spreadsheetUrl: result.spreadsheetUrl,
            spreadsheetId: result.spreadsheetId,
            message: 'Planilla de Google Sheets creada automáticamente y vinculada a tu flota 📊✨'
        });
    } catch(e) {
        console.error('❌ [AUTO-CREATE-SHEET] Error creando planilla:', e.message);
        const host = req.get('host') || 'fleetadmin-web-nueva.onrender.com';
        const proto = req.protocol === 'https' || host.includes('render.com') ? 'https' : 'http';
        const importFormula = `=IMPORTDATA("${proto}://${host}/api/sheets/csv?fleetId=${fleetId}")`;
        return res.status(500).json({ 
            ok: false, 
            error: e.message,
            suggestedMethod: 'importdata',
            importFormula: importFormula
        });
    }
});

// Endpoint para sincronizar movimientos a Google Sheets (Webhook/AppScript o Google Sheets Direct API)
app.post('/api/sheets/append', async (req, res) => {
    try {
        let sheetId = (req.body.google_sheet_id || req.body.sheetId || '').trim();
        const movement = req.body.movement;
        const fleetId = await _resolveServerFleetId(req.body.fleetId);

        if (!movement) {
            return res.status(400).json({ ok: false, error: 'movement es requerido' });
        }

        // Si no hay sheetId configurado, intentar crearla
        if (!sheetId) {
            try {
                console.log('✨ [GOOGLE-SHEETS] Sin planilla configurada. Creando planilla automáticamente...');
                const created = await autoCreateGoogleSpreadsheet(fleetId);
                sheetId = created.spreadsheetUrl;
            } catch(createErr) {
                console.warn('⚠️ No se pudo auto-crear planilla en Google Drive:', createErr.message);
                // Si falla por API deshabilitada, respondemos con ok para que el movimiento no se pierda (ya está en Firebase)
                return res.json({ 
                    ok: true, 
                    warning: 'Guardado en balance de la app. Para Google Sheets usá la fórmula =IMPORTDATA(...) o Apps Script.',
                    movement 
                });
            }
        }

        console.log(`📊 [GOOGLE-SHEETS] Sincronizando movimiento ${movement.id} con Google Sheet/Webhook: ${sheetId}`);

        // CASO A: Webhook de Google Apps Script (https://script.google.com/...)
        if (sheetId.startsWith('https://script.google.com/')) {
            const axios = require('axios');
            const response = await axios.post(sheetId, JSON.stringify(movement), {
                headers: { 'Content-Type': 'application/json' },
                maxRedirects: 5,
                timeout: 15000
            });
            return res.json({ ok: true, message: 'Fila agregada vía Google Apps Script Webhook ✅', data: response.data, spreadsheetUrl: sheetId });
        }

        // CASO B: ID o URL de Google Spreadsheet (https://docs.google.com/spreadsheets/d/ID/edit)
        const match = sheetId.match(/\/d\/([a-zA-Z0-9-_]+)/) || [null, sheetId];
        const rawSpreadsheetId = match[1];

        if (rawSpreadsheetId && rawSpreadsheetId.length > 10) {
            const accessToken = await getGoogleAccessToken();
            if (accessToken) {
                const axios = require('axios');
                const rowValues = [
                    movement.id || '',
                    movement.date ? new Date(movement.date).toLocaleString('es-AR') : new Date().toLocaleString('es-AR'),
                    movement.type || 'Ingreso',
                    movement.amount || 0,
                    movement.concept || '',
                    movement.party || '',
                    movement.source || 'WhatsApp Bot'
                ];

                const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${rawSpreadsheetId}/values/Movimientos!A1:append?valueInputOption=USER_ENTERED`;
                const appendRes = await axios.post(appendUrl, {
                    values: [rowValues]
                }, {
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    timeout: 15000
                });

                return res.json({ ok: true, message: 'Fila agregada directamente vía Google Sheets API ✅', data: appendRes.data, spreadsheetUrl: sheetId });
            }
        }

        return res.json({
            ok: true,
            warning: 'Movimiento registrado. Para sincronización en vivo con Google Sheets podés usar el Webhook de Apps Script o la fórmula =IMPORTDATA(...).'
        });
    } catch (e) {
        console.error('❌ [GOOGLE-SHEETS] Error al sincronizar con Google Sheets:', e.message);
        return res.json({ ok: true, warning: 'Movimiento registrado localmente. Detalle Google Sheets: ' + e.message });
    }
});

// Endpoint para probar conexión con Google Sheets Webhook / Direct API
app.post('/api/sheets/test', async (req, res) => {
    try {
        let sheetId = (req.body.google_sheet_id || req.body.sheetId || '').trim();
        const fleetId = await _resolveServerFleetId(req.body.fleetId);

        if (!sheetId) {
            return res.status(400).json({ ok: false, error: 'Ingresá la URL del Webhook de Apps Script o vinculá tu planilla.' });
        }

        const testMovement = {
            id: 'test_' + Date.now(),
            type: 'Ingreso',
            amount: 100.00,
            concept: 'Prueba de Conexión FleetAdmin Pro',
            party: 'Sistema FleetAdmin',
            date: new Date().toISOString(),
            source: 'Prueba manual'
        };

        const axios = require('axios');
        const response = await axios.post(`http://localhost:${PORT}/api/sheets/append`, {
            google_sheet_id: sheetId,
            fleetId: fleetId,
            movement: testMovement
        }, { timeout: 15000 });

        return res.json({ ok: true, message: '¡Conexión exitosa! Fila de prueba enviada a tu Google Sheet. 📊', spreadsheetUrl: sheetId, data: response.data });
    } catch (e) {
        console.error('❌ [GOOGLE-SHEETS-TEST] Error probando Google Sheets:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Endpoint para solicitar un escaneo histórico de comprobantes por WhatsApp
app.post('/api/bot/scan-historical', async (req, res) => {
    try {
        const fleetId = await _resolveServerFleetId(req.body.fleetId);
        console.log(`🔍 [HISTORICAL-SCAN] Iniciando escaneo de comprobantes por WhatsApp para flota: ${fleetId}`);
        
        let scanResult = { totalMovements: 0, newProcessed: 0, syncedToSheets: 0 };
        if (typeof WhatsappBot.scanRecentMessages === 'function') {
            scanResult = await WhatsappBot.scanRecentMessages(500, fleetId);
        }

        const host = req.get('host') || 'fleetadmin-web-nueva.onrender.com';
        const proto = req.protocol === 'https' || host.includes('render.com') ? 'https' : 'http';
        const importFormula = `=IMPORTDATA("${proto}://${host}/api/sheets/csv?fleetId=${fleetId}")`;
        const csvUrl = `${proto}://${host}/api/sheets/csv?fleetId=${fleetId}`;

        return res.json({
            ok: true,
            fleetId: fleetId,
            scanResult: scanResult,
            sheetUrl: scanResult.sheetUrl || null,
            csvUrl: csvUrl,
            importFormula: importFormula,
            message: `Escaneo completado. ${scanResult.totalMovements || 0} movimientos registrados en balance y listos para Google Sheets 📊`
        });
    } catch(e) {
        console.error('❌ [HISTORICAL-SCAN] Error en escaneo:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Endpoint para importación masiva directa de comprobantes, facturas (PDF / Imágenes) o texto de chat
app.post('/api/bot/import-receipts', async (req, res) => {
    try {
        const fleetId = await _resolveServerFleetId(req.body.fleetId);
        const { files, rawText } = req.body;
        console.log(`📥 [RECEIPT-IMPORT] Iniciando procesamiento de comprobantes/facturas para flota ${fleetId}...`);

        let processedMovements = [];
        let errors = [];

        // 1. Procesar archivos (imágenes y PDFs)
        if (Array.isArray(files) && files.length > 0) {
            console.log(`📁 [RECEIPT-IMPORT] Procesando ${files.length} archivos recibidos...`);
            for (const file of files) {
                try {
                    if (!file.base64) continue;
                    const cleanB64 = file.base64.replace(/^data:[^;]+;base64,/, '');
                    const buf = Buffer.from(cleanB64, 'base64');
                    const mimeType = file.mimeType || (file.name && file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

                    const result = await WhatsappBot.processDirectReceiptFile({
                        buffer: buf,
                        mimeType: mimeType,
                        fileName: file.name,
                        customDriverName: file.driverName || null,
                        fleetId: fleetId
                    });

                    if (result && result.ok && result.movement) {
                        processedMovements.push(result.movement);
                    } else if (result && result.error) {
                        errors.push({ file: file.name, error: result.error });
                    }
                } catch(fErr) {
                    console.warn(`⚠️ [RECEIPT-IMPORT] Error procesando archivo ${file.name}:`, fErr.message);
                    errors.push({ file: file.name, error: fErr.message });
                }
            }
        }

        // 2. Procesar texto plano o chat exportado
        if (rawText && typeof rawText === 'string' && rawText.trim().length > 5) {
            console.log(`📝 [RECEIPT-IMPORT] Procesando texto de chat exportado (${rawText.length} caracteres)...`);
            try {
                const chatRes = await WhatsappBot.processDirectChatText({
                    chatText: rawText,
                    fleetId: fleetId
                });
                if (chatRes && chatRes.movements) {
                    processedMovements.push(...chatRes.movements);
                }
            } catch(tErr) {
                console.warn('⚠️ [RECEIPT-IMPORT] Error procesando texto de chat:', tErr.message);
                errors.push({ file: 'chat_text', error: tErr.message });
            }
        }

        let totalIngresos = 0;
        let totalEgresos = 0;
        processedMovements.forEach(m => {
            const amt = Number(m.amount) || 0;
            if (m.type === 'Ingreso') totalIngresos += amt;
            else if (m.type === 'Egreso') totalEgresos += amt;
        });

        console.log(`✅ [RECEIPT-IMPORT] Finalizado: ${processedMovements.length} movimientos procesados (Ingresos: $${totalIngresos}, Egresos: $${totalEgresos}).`);

        return res.json({
            ok: true,
            fleetId: fleetId,
            processedCount: processedMovements.length,
            totalIngresos: totalIngresos,
            totalEgresos: totalEgresos,
            movements: processedMovements,
            errors: errors,
            message: `¡Se procesaron ${processedMovements.length} comprobantes y facturas con éxito!`
        });
    } catch(e) {
        console.error('❌ [RECEIPT-IMPORT] Error general en importación:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// Endpoint para solicitar QR de sincronización histórica completa
app.post('/api/bot/request-qr-fullsync', async (req, res) => {
    try {
        console.log('🔄 [QR-FULLSYNC] Solicitando reinicio suave para sincronización completa de historial...');
        await WhatsappBot.softResetSession();
        return res.json({
            ok: true,
            message: 'Sesión reiniciada en modo Desktop Full Sync. Escaneá el código QR en Pantalla para sincronizar todo el historial.'
        });
    } catch(e) {
        console.error('❌ [QR-FULLSYNC] Error:', e.message);
        return res.status(500).json({ ok: false, error: e.message });
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
        // Primero buscar si hay un usuario local con ese globalId
        const usersSnap = await db.ref(`fleets/${fleetId}/users`).once('value');
        const users = usersSnap.val() || {};
        let localUserId = null;
        for (const [key, u] of Object.entries(users)) {
            if (u.globalId === driver_id || key === driver_id) {
                localUserId = key;
                break;
            }
        }

        if (localUserId) {
            await db.ref(`fleets/${fleetId}/users/${localUserId}/appVersion`).set(version);
        } else {
            console.log(`⚠️ [VERSION REPORT] No local user found for global ID ${driver_id} in fleet ${fleetId}. Not writing local appVersion.`);
        }

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
        if (event === 'app_killed') {
            // 🚨 ALERTA CRÍTICA: El chofer cerró la app manualmente desde el panel de recientes
            // Esto ocurre cuando un chofer quiere esconder su posición cerrando la app a propósito
            console.log(`🚨 [APP KILLED] Driver ${driverName} (${driver_id}) cerró la app manualmente.`);
            WhatsappBot.sendPushToAdmins(
                `🚨 Chofer Cerró la App`,
                `⚠️ ${driverName} cerró la aplicación manualmente (deslizó desde recientes). El servicio GPS se reiniciará, pero puede haber perdido posición intencionalmente.`
            );
        } else if (event === 'gps_desactivado') {
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
        const { driver_id, lat, lng, speed, heading, battery, driverName, timestamp, source, snap, appVersion } = req.body;
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
            gps_status: 'active',
            _source: source || 'server_api'
        };

        // Si el chofer reporta nueva ubicación GPS válida, su estado se reactiva inmediatamente
        updateData.status = 'active';
        updateData.last_heartbeat_gap = null;

        // Escribir appVersion si viene en el payload (PWA o APK vía sendLocationToServer)
        if (appVersion && typeof appVersion === 'string' && appVersion.length > 0) {
            updateData.appVersion = appVersion;
        }

        await db.ref(`driver_positions/${driver_id}`).update(updateData);
        res.json({ ok: true, lat: finalLat, lng: finalLng, corrected });

        // Verificación en segundo plano de posibles infracciones de fotomulta
        if (SpeedInfractions && typeof SpeedInfractions.checkPosition === 'function') {
            SpeedInfractions.checkPosition({
                driverId: driver_id,
                driverName: updateData.driverName,
                lat: finalLat,
                lng: finalLng,
                speed: updateData.speed,
                heading: updateData.heading,
                source: updateData._source
            }).catch(se => console.warn('⚠️ [SPEED-CHECK] Error:', se.message));
        }
    } catch (e) {
        console.error('❌ Error updating driver location:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});


// ============================================
// Funciones Auxiliares para Alertas Dinámicas
// ============================================

const GEMINI_MODELS = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
];

async function callGeminiAudio(audioBuffer, mimeType) {
    const key = process.env.GEMINI_API_KEY || (typeof WhatsappBot.getGeminiKey === 'function' ? WhatsappBot.getGeminiKey() : null);
    if (!key || !audioBuffer) return null;
    const audioB64 = audioBuffer.toString('base64');
    const prompt = `Sos un transcriptor de mensajes de seguridad vial y tránsito para una flota en Argentina.
Transcribí de forma clara el audio de este mensaje.
REGLA ESTRICTA DE MODERACIÓN: Si el audio contiene insultos, palabras groseras o desagradables (como puto, puta, concha, pija, culo, verga, poronga, traba, boludo, pelotudo, forro, mierda, etc.), ELIMINÁ esas palabras por completo de la transcripción. No uses asteriscos ni notas, simplemente quitalas y transcribí el resto del mensaje informativo sobre el tránsito o control vial con redacción limpia y coherente.
Devolvé únicamente el texto limpio final, sin añadir comentarios, explicaciones ni formato.`;
    const axios = require('axios');
    const cleanMimeType = (mimeType || 'audio/ogg').split(';')[0].trim();
    for (const url of GEMINI_MODELS) {
        try {
            const res = await axios.post(`${url}?key=${key}`, {
                contents: [{
                    parts: [
                        { inlineData: { mimeType: cleanMimeType, data: audioB64 } },
                        { text: prompt }
                    ]
                }]
            }, { timeout: 25000 });
            const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (rawText) return rawText.trim();
        } catch (e) {
            console.warn(`⚠️ [GEMINI-AUDIO] ${url.split('/models/')[1]?.split(':')[0]} falló: ${e.message}`);
        }
    }
    return null;
}

/**
 * Filtra y elimina insultos y palabras prohibidas de un texto, conservando el resto del mensaje.
 * @param {string} text 
 * @returns {{ cleanText: string, hadForbiddenWords: boolean, removedWords: string[] }}
 */
function sanitizeForbiddenWords(text) {
    if (!text || typeof text !== 'string') {
        return { cleanText: '', hadForbiddenWords: false, removedWords: [] };
    }

    let cleaned = text;
    let hadForbiddenWords = false;
    const removedWords = [];

    // 1. Frases compuestas comunes de insultos
    const COMPOUND_PHRASES = [
        /\b(?:la\s+)?concha\s+de\s+(?:tu|su|la)\s+(?:madre|hermana|lora|mono|tia)\b/gi,
        /\b(?:la\s+)?puta\s+que\s+(?:te|lo|los|las)\s+pari[oó]\b/gi,
        /\b(?:la\s+)?puta\s+madre\b/gi,
        /\b(?:forr[oa]s?\s+de\s+mierda)\b/gi,
        /\bhij[oa]s?\s+de\s+(?:mil\s+)?puta\b/gi,
        /\bhdp\b/gi,
        /\blpm(?:qlp)?\b/gi,
        /\band[aá](?:te)?\s+a\s+la\s+mierda\b/gi,
        /\bchup[aá](?:me|te)?\s+(?:un\s+huevo|la\s+pija|la\s+chota|la\s+verga|la\s+poronga|el\s+culo|un\s+pingo)\b/gi,
        /\bme\s+cago\s+en\s+(?:la\s+puta|la\s+concha|todo|diez)\b/gi
    ];

    for (const pattern of COMPOUND_PHRASES) {
        if (pattern.test(cleaned)) {
            hadForbiddenWords = true;
            const matches = cleaned.match(pattern);
            if (matches) removedWords.push(...matches);
            cleaned = cleaned.replace(pattern, ' ');
        }
    }

    // 2. Palabras individuales e insultos (con soporte para vocales alargadas ej: putooo, veeerga)
    const SINGLE_WORD_PATTERNS = [
        /\bp+u+t+[oa](?:s|it[oa]s?)?\b/gi,           // puto, puta, putos, putas, putita, putito
        /\bc+o+n+c+h+[ao](?:s|ud[oa]s?)?\b/gi,      // concha, conchas, conchudo, conchuda
        /\bp+i+j+a(?:s|z[oa]s?)?\b/gi,              // pija, pijas, pijazo
        /\bc+u+l+o(?:s|it[oa]s?)?\b/gi,             // culo, culos, culito
        /\bv+e+r+g+a(?:s|z[oa]s?)?\b/gi,            // verga, vergas, vergazo
        /\bp+o+r+o+n+g+a(?:s|it[oa]s?)?\b/gi,       // poronga, porongas
        /\bt+r+a+b+a+s?\b/gi,                       // traba, trabas
        /\bb+o+l+u+d+[oa](?:s|ces|z)?\b/gi,         // boludo, boluda, boludeces
        /\bp+e+l+o+t+u+d+[oa]s?\b/gi,               // pelotudo, pelotuda
        /\bf+o+r+r+[oa]s?\b/gi,                     // forro, forra
        /\bc+h+o+t+[ao]s?\b/gi,                     // choto, chota
        /\bt+a+r+a+d+[oa]s?\b/gi,                   // tarado, tarada
        /\bp+a+j+e+r+[oa]s?\b/gi,                   // pajero, pajera
        /\bm+i+e+r+d+a+s?\b/gi,                     // mierda
        /\bc+a+g+[oó]+n+(?:a|es)?\b/gi,             // cagon, cagona, cagones
        /\bc+a+g+a+d+a+s?\b/gi,                     // cagada
        /\bc+u+l+i+a+[oa]s?\b/gi,                   // culiao, culiada
        /\bo+r+t+o+s?\b/gi,                         // orto
        /\bo+j+e+t+e+s?\b/gi,                       // ojete
        /\bt+r+o+l+[oa]s?\b/gi,                     // trolo, trola
        /\bm+o+g+[oó]+l+i+c+[oa]s?\b/gi,            // mogolico, mogolica
        /\bm+a+l+p+a+r+i+d+[oa]s?\b/gi,             // malparido, malparida
        /\bs+o+r+e+t+e+s?\b/gi,                     // sorete
        /\bc+a+b+r+[oó]+n+(?:a|es)?\b/gi,           // cabron
        /\bi+m+b+[eé]+c+i+l+(?:es)?\b/gi,           // imbecil
        /\be+s+t+[uú]+p+i+d+[oa]s?\b/gi             // estupido, estupida
    ];

    for (const pattern of SINGLE_WORD_PATTERNS) {
        if (pattern.test(cleaned)) {
            hadForbiddenWords = true;
            const matches = cleaned.match(pattern);
            if (matches) removedWords.push(...matches);
            cleaned = cleaned.replace(pattern, ' ');
        }
    }

    // 3. Limpieza de artículos o preposiciones colgantes
    cleaned = cleaned.replace(/\b(?:de|a|el|la|los|las|un|una|unos|unas)\s*([,.:;!?]|$)/gi, '$1');

    // 4. Limpieza de espaciado y signos de puntuación
    cleaned = cleaned
        .replace(/\s+/g, ' ')
        .replace(/\s*([,.:;!?])\s*/g, '$1 ')
        .replace(/([,.:;!?])\s*\1+/g, '$1')
        .replace(/^[,.:;!?-]+\s*/, '')
        .trim();

    if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return {
        cleanText: cleaned,
        hadForbiddenWords,
        removedWords
    };
}

// Endpoint de Alertas Dinámicas en Tiempo Real (Impulsado por Agente Centinela IA)
app.post('/api/alerts/dynamic', async (req, res) => {
    try {
        const { text, audio, audioMimeType, lat, lng, type, authorName, fleetId, voiceMode = 'app' } = req.body;

        if (!lat || !lng || !authorName) {
            return res.status(400).json({ error: 'Faltan parámetros requeridos: lat, lng, authorName' });
        }

        const db = WhatsappBot.getDb();
        if (!db) {
            return res.status(503).json({ error: 'Base de datos de Firebase no disponible' });
        }

        const typeLabels = {
            checkpoint: 'Control vehicular y operativo',
            police:     'Control policial',
            municipal:  'Inspector municipal de tránsito',
            warning:    'Precaución en la vía',
            radar:      'Radar de velocidad',
            accident:   'Accidente en la vía',
            traffic:    'Alerta de tráfico'
        };
        let assignedType = type || 'checkpoint';
        const defaultTypeLabel = typeLabels[assignedType] || 'Control o alerta de tránsito';

        let originalText = text || '';
        let transcribedText = '';
        let audioUrl = null;
        let detectedBadWordsInAudio = false;
        let vigenciaMinutos = 60;
        let finalLat = Number(lat);
        let finalLng = Number(lng);
        let approximate = false;
        let aiClassification = null;

        // 1. Si viene audio en base64
        if (audio) {
            console.log(`🎙️ [DYNAMIC-ALERT] Procesando audio de alerta (${audioMimeType || 'audio/webm'}) de ${authorName} (modo: ${voiceMode})...`);
            const audioBuffer = Buffer.from(audio, 'base64');

            // Procesar y clasificar con el Agente Centinela IA (Gemini 2.5 Flash)
            try {
                aiClassification = await geminiAgent.transcribeAndClassifyAudio(audioBuffer, audioMimeType || 'audio/webm', {
                    groupName: `Reporte de voz de ${authorName}`,
                    city: 'Rosario'
                });
            } catch (aiErr) {
                console.warn('⚠️ [DYNAMIC-ALERT] Error consultando Agente Centinela para audio:', aiErr.message);
            }

            if (aiClassification && aiClassification.transcripcion) {
                transcribedText = aiClassification.transcripcion;
                originalText = aiClassification.transcripcion;
                assignedType = aiClassification.tipo || assignedType;
                vigenciaMinutos = aiClassification.vigenciaMinutos || 60;
                console.log(`🎙️ [DYNAMIC-ALERT] Transcripción Centinela: "${transcribedText}" | Tipo: ${assignedType} | Vigencia: ${vigenciaMinutos}m`);
                
                // Si la IA identificó una intersección o calle específica en el audio, geocodificarla con precisión
                if (aiClassification.ubicacion) {
                    const geo = await geminiAgent.geocodeLocation(aiClassification.ubicacion, 'Rosario');
                    if (geo && !geo.approximate) {
                        finalLat = geo.lat;
                        finalLng = geo.lng;
                        console.log(`🎯 [DYNAMIC-ALERT-GEO] Ubicación detectada en audio geocodificada con éxito: "${aiClassification.ubicacion}" -> ${finalLat}, ${finalLng}`);
                    }
                }
            } else {
                // Fallback clásico si la IA no transcribió
                const transcription = await callGeminiAudio(audioBuffer, audioMimeType);
                if (transcription) {
                    transcribedText = transcription;
                    originalText = transcription;
                } else {
                    transcribedText = defaultTypeLabel;
                    originalText = defaultTypeLabel;
                }
            }
        } else if (text) {
            // Reporte escrito: clasificar con Agente Centinela
            try {
                aiClassification = await geminiAgent.classifyTrafficReport(text, {
                    groupName: `Reporte escrito de ${authorName}`,
                    city: 'Rosario'
                });
                if (aiClassification) {
                    assignedType = aiClassification.tipo || assignedType;
                    vigenciaMinutos = aiClassification.vigenciaMinutos || 60;
                    if (aiClassification.ubicacion) {
                        const geo = await geminiAgent.geocodeLocation(aiClassification.ubicacion, 'Rosario');
                        if (geo && !geo.approximate) {
                            finalLat = geo.lat;
                            finalLng = geo.lng;
                            console.log(`🎯 [DYNAMIC-ALERT-GEO] Ubicación en texto geocodificada: "${aiClassification.ubicacion}" -> ${finalLat}, ${finalLng}`);
                        }
                    }
                }
            } catch (aiErr) {
                console.warn('⚠️ [DYNAMIC-ALERT] Error clasificando texto con Centinela:', aiErr.message);
            }
        }

        // Moderación y limpieza de palabras prohibidas/insultos
        const moderation = sanitizeForbiddenWords(originalText);
        let finalVoiceMode = voiceMode;

        if (moderation.hadForbiddenWords) {
            detectedBadWordsInAudio = true;
            console.log(`🚫 [DYNAMIC-ALERT-CENSOR] Se detectaron insultos en la alerta de ${authorName}: [${moderation.removedWords.join(', ')}]. Palabras eliminadas. Texto limpio: "${moderation.cleanText}"`);
        }

        let cleanText = moderation.cleanText.trim();
        if (!cleanText || cleanText.length < 3) {
            cleanText = defaultTypeLabel;
        }

        if (audio && finalVoiceMode === 'real') {
            if (detectedBadWordsInAudio) {
                console.log(`⚠️ [DYNAMIC-ALERT] Modo 'real' cambiado a 'app' porque el audio original contenía insultos. Se emitirá vía voz TTS limpia.`);
                finalVoiceMode = 'app';
                audioUrl = null;
            } else {
                try {
                    const ext = (audioMimeType && audioMimeType.includes('ogg')) ? 'ogg' :
                                (audioMimeType && audioMimeType.includes('mp3')) ? 'mp3' : 'webm';
                    const alertIdTemp = `alert_dynamic_${Date.now()}`;
                    const audioFileName = `${alertIdTemp}_${Math.random().toString(36).substring(2, 7)}.${ext}`;
                    const audioPath = path.join(audioDir, audioFileName);
                    fs.writeFileSync(audioPath, Buffer.from(audio, 'base64'));
                    audioUrl = `/audio/${audioFileName}`;
                    console.log(`💾 [DYNAMIC-ALERT] Audio original limpio guardado en disco: ${audioUrl}`);
                } catch (saveErr) {
                    console.error('⚠️ [DYNAMIC-ALERT] Error guardando archivo de audio en disco:', saveErr);
                    audioUrl = `data:${audioMimeType || 'audio/webm'};base64,${audio}`;
                }
            }
        }

        const alertText = cleanText;
        const alertId = `alert_dynamic_${Date.now()}`;
        const finalFleetId = fleetId || await WhatsappBot.getFleetId() || 'default_fleet';

        const alertData = {
            id: alertId,
            type: assignedType,
            location: (aiClassification && aiClassification.ubicacion) ? aiClassification.ubicacion : alertText,
            lat: Number(finalLat),
            lng: Number(finalLng),
            timestamp: Date.now(),
            expiresAt: Date.now() + (vigenciaMinutos * 60 * 1000),
            authorName: authorName,
            status: 'active',
            voiceMode: finalVoiceMode,
            audioUrl: (finalVoiceMode === 'real') ? audioUrl : null,
            originalText: alertText,
            description: (aiClassification && aiClassification.descripcion) ? aiClassification.descripcion : ((finalVoiceMode === 'real') ? `Audio de ${authorName}` : alertText),
            censorApplied: detectedBadWordsInAudio,
            vigenciaMinutos: vigenciaMinutos,
            isLifting: Boolean(aiClassification && aiClassification.esLevantado)
        };

        // Guardar en fleets/${fleetId}/traffic_alerts/ y en global_traffic_alerts/
        await db.ref(`fleets/${finalFleetId}/traffic_alerts/${alertId}`).set(alertData);
        await db.ref(`global_traffic_alerts/${alertId}`).set(alertData);

        console.log(`✅ [DYNAMIC-ALERT] Alerta publicada correctamente: ${alertId} (tipo: ${assignedType}, vigencia: ${vigenciaMinutos}m, lat: ${finalLat}, lng: ${finalLng})`);
        res.json({
            ok: true,
            alertId,
            fleetId: finalFleetId,
            transcription: alertText,
            location: alertData.location,
            type: assignedType,
            vigenciaMinutos: vigenciaMinutos,
            voiceMode: finalVoiceMode,
            audioUrl: alertData.audioUrl,
            censorApplied: detectedBadWordsInAudio
        });

    } catch (e) {
        console.error('❌ [DYNAMIC-ALERT] Error en endpoint:', e);
        res.status(500).json({ error: e.message });
    }
});

// ============================================
// Endpoint del Agente Centinela IA (Gemini 2.5 Flash)
// Procesa reportes de choferes o webhooks y despacha en tiempo real
// ============================================
app.post('/api/alerts/sentinel', async (req, res) => {
    try {
        const { text, audio, audioMimeType, groupName, authorName, fleetId } = req.body;
        const db = typeof WhatsappBot.getDb === 'function' ? WhatsappBot.getDb() : null;

        if (!text && !audio) {
            return res.status(400).json({ error: 'Se requiere texto o audio para procesar' });
        }

        let classification = null;
        let audioUrl = null;

        if (audio) {
            const audioBuffer = Buffer.from(audio, 'base64');
            classification = await geminiAgent.transcribeAndClassifyAudio(audioBuffer, audioMimeType || 'audio/ogg', { groupName });
            if (classification && classification.esAlerta) {
                try {
                    const ext = (audioMimeType && audioMimeType.includes('mp3')) ? 'mp3' : 'ogg';
                    const audioFileName = `sentinel_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.${ext}`;
                    const audioPath = path.join(audioDir, audioFileName);
                    fs.writeFileSync(audioPath, audioBuffer);
                    audioUrl = `/audio/${audioFileName}`;
                } catch(e) {}
            }
        } else {
            classification = await geminiAgent.classifyTrafficReport(text, { groupName });
        }

        if (!classification) {
            return res.status(500).json({ error: 'No se pudo clasificar el reporte con el Agente Centinela' });
        }

        let dispatchResult = { dispatched: false };
        if (classification.esAlerta && db && req.body.autoDispatch !== false) {
            const resolvedFleetId = fleetId || (typeof WhatsappBot.getFleetId === 'function' ? await WhatsappBot.getFleetId() : 'default_fleet');
            dispatchResult = await geminiAgent.dispatchAlert(classification, {
                authorName: authorName || groupName || 'Chofer',
                groupName: groupName || 'App Conductor',
                fleetId: resolvedFleetId,
                originalText: text || classification.transcripcion || '',
                audioUrl: audioUrl,
                source: 'sentinel_api'
            }, db);
        }

        res.json({
            ok: true,
            classification,
            dispatched: dispatchResult.dispatched,
            alertId: dispatchResult.alertId || null,
            alertData: dispatchResult.alertData || null
        });
    } catch (err) {
        console.error('❌ [SENTINEL-API] Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// Endpoints de Notificaciones y Webhooks
// ============================================

// Notificación a administradores
app.post('/api/notify/admin', async (req, res) => {
    try {
        const { title, body, fleetId } = req.body;
        console.log(`📢 [NOTIFY-ADMIN] ${title}: ${body} (Fleet: ${fleetId || 'Global'})`);
        if (typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.sendPushToAdmins === 'function') {
            WhatsappBot.sendPushToAdmins(title || 'Notificación de Administración', body || '');
        }
        res.json({ ok: true });
    } catch (e) {
        console.error('❌ Error en /api/notify/admin:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Notificación de Mantenimiento Preventivo
app.post('/api/notify/maintenance', async (req, res) => {
    try {
        const { vehicleId, plate, motive, mileage, fleetId } = req.body;
        console.log(`🔧 [NOTIFY-MAINTENANCE] Vehículo ${plate || vehicleId} requiere mantenimiento: ${motive} (${mileage || 0} km)`);
        const db = WhatsappBot.getDb();
        if (db && fleetId) {
            await db.ref(`fleets/${fleetId}/notifications`).push({
                type: 'maintenance_alert',
                vehicleId,
                plate,
                motive,
                mileage,
                timestamp: Date.now()
            });
        }
        if (typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.sendPushToAdmins === 'function') {
            WhatsappBot.sendPushToAdmins('⚠️ Alerta de Mantenimiento', `El vehículo ${plate || 'unidad'} requiere revisión: ${motive}`);
        }
        res.json({ ok: true });
    } catch (e) {
        console.error('❌ Error en /api/notify/maintenance:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Envío Saliente de Mensaje de WhatsApp
app.post('/api/whatsapp/send', async (req, res) => {
    try {
        const { to, message, fleetId } = req.body;
        if (!to || !message) {
            return res.status(400).json({ ok: false, error: 'to y message son requeridos' });
        }
        console.log(`📱 [WHATSAPP-SEND] Enviando a ${to}: "${message.substring(0, 50)}..."`);
        if (typeof WhatsappBot !== 'undefined' && typeof WhatsappBot.sendMessage === 'function') {
            await WhatsappBot.sendMessage(to, message);
            return res.json({ ok: true, status: 'sent' });
        }
        res.json({ ok: true, status: 'queued', warning: 'Bot no conectado actualmente' });
    } catch (e) {
        console.error('❌ Error en /api/whatsapp/send:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Webhook para Rastreadores GPS Externos
app.post('/api/gps/webhook', async (req, res) => {
    try {
        const { deviceId, lat, lng, speed, heading, timestamp, fleetId } = req.body;
        if (!deviceId || lat === undefined || lng === undefined) {
            return res.status(400).json({ ok: false, error: 'deviceId, lat y lng son requeridos' });
        }
        console.log(`📡 [GPS-WEBHOOK] Dispositivo ${deviceId}: ${lat}, ${lng}`);
        const db = WhatsappBot.getDb();
        if (db) {
            const eventTime = timestamp ? new Date(timestamp).getTime() : Date.now();
            await db.ref(`gps_tracker/${deviceId}/last_position`).set({
                lat: parseFloat(lat),
                lng: parseFloat(lng),
                speed: speed ? parseFloat(speed) : 0,
                heading: heading ? parseFloat(heading) : 0,
                timestamp: eventTime,
                updated_at: new Date(eventTime).toISOString()
            });
        }
        res.json({ ok: true });
    } catch (e) {
        console.error('❌ Error en /api/gps/webhook:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. Arranque del motor
app.listen(PORT, '0.0.0.0', () => {
    console.log('Servidor FleetAdmin Pro rugiendo en el puerto ' + PORT);
    
    // Iniciar Bot de WhatsApp de forma asíncrona para no bloquear el puerto
    console.log('⏳ Iniciando componente WhatsApp en segundo plano...');
    WhatsappBot.init();

    // Manejo de apagado elegante (Render zero-downtime deploy)
    process.on('SIGTERM', async () => {
        console.log('🛑 [SHUTDOWN] SIGTERM recibido de Render. Liberando sesión...');
        try {
            const db = typeof WhatsappBot.getDb === 'function' ? WhatsappBot.getDb() : null;
            if (db) {
                await db.ref('bot_active_leader').remove();
            }
        } catch(e) {}
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('🛑 [SHUTDOWN] SIGINT recibido. Liberando sesión...');
        try {
            const db = typeof WhatsappBot.getDb === 'function' ? WhatsappBot.getDb() : null;
            if (db) {
                await db.ref('bot_active_leader').remove();
            }
        } catch(e) {}
        process.exit(0);
    });

    // Iniciar el monitoreo en segundo plano de latidos (heartbeats) de choferes
    console.log('⏳ Iniciando verificador de latidos de choferes cada 60s...');
    setInterval(checkActiveDriverHeartbeats, 60000);

    // Iniciar servicio de monitoreo de fotomultas y exceso de velocidad
    setTimeout(() => {
        try {
            const db = typeof WhatsappBot.getDb === 'function' ? WhatsappBot.getDb() : null;
            SpeedInfractions.init(db, WhatsappBot);

            if (db) {
                db.ref('driver_positions').on('child_changed', (snap) => {
                    try {
                        const driverId = snap.key;
                        const pos = snap.val();
                        if (pos && pos.status === 'active' && pos.lat && pos.lng) {
                            SpeedInfractions.checkPosition({
                                driverId: driverId,
                                driverName: pos.driverName,
                                lat: pos.lat,
                                lng: pos.lng,
                                speed: pos.speed,
                                heading: pos.heading,
                                source: pos._source || 'firebase_live'
                            });
                        }
                    } catch (err) {
                        console.error('❌ Error procesando posición en listener de fotomultas:', err.message);
                    }
                });
                console.log('📡 [SPEED-INFRACTIONS] Listener en tiempo real de driver_positions activado ✅');
            }
        } catch (e) {
            console.error('❌ Error inicializando SpeedInfractions:', e.message);
        }
    }, 4000);

    // ============================================================
    // KEEP-ALIVE: Auto-ping cada 10 minutos para evitar que Render
    // (free plan) duerma el servidor. Sin esto, el bot de WhatsApp
    // se desconecta y las alertas de tráfico se pierden.
    // ============================================================
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    setInterval(async () => {
        try {
            const https = require('https');
            const http = require('http');
            const url = new URL(`${RENDER_URL}/health`);
            const lib = url.protocol === 'https:' ? https : http;
            lib.get(`${RENDER_URL}/health`, (res) => {
                console.log(`💓 [KEEP-ALIVE] Auto-ping OK (${res.statusCode})`);
            }).on('error', (e) => {
                console.warn(`💓 [KEEP-ALIVE] Ping fallido: ${e.message}`);
            });
        } catch (pingErr) {
            console.warn(`💓 [KEEP-ALIVE] Error: ${pingErr.message}`);
        }
    }, 10 * 60 * 1000); // cada 10 minutos
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

                // Check heartbeat
                const lastHeartbeat = posData.last_heartbeat || (posData.updated_at ? new Date(posData.updated_at).getTime() : 0);
                if (!lastHeartbeat) continue;

                const timeDiffMs = now - lastHeartbeat;

                // Si el chofer estaba marcado como sospechoso o sin señal pero ahora volvió a transmitir (hace menos de 2 min)
                if ((posData.status === 'suspicious_disconnect' || posData.status === 'gps_desactivado') && timeDiffMs < 2 * 60 * 1000) {
                    console.log(`✅ [HEARTBEAT] Chofer ${driverId} (${posData.driverName || 'Chofer'}) reconectado. Restaurando estado a 'active'.`);
                    await db.ref(`driver_positions/${driverId}`).update({
                        status: 'active',
                        last_heartbeat_gap: null
                    });
                    continue;
                }

                // Skip if voluntarily logged out or already marked as suspicious/gps_desactivado
                if (posData.status === 'logout_voluntario' || posData.status === 'suspicious_disconnect' || posData.status === 'gps_desactivado') {
                    continue;
                }

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