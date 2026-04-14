/* ============================================
   FleetAdmin Pro — Módulo GPS & Geofencing
   Recepción de alertas GPS, geofencing con
   auto-checkout y panel de eventos
   ============================================ */

const GPSModule = (() => {

    // --- Renderizar panel GPS (solo owner) ---
    async function render() {
        const gpsToken = await DB.getSetting('gps_webhook_token') || '';
        const whatsappPhone = await DB.getSetting('whatsapp_phone') || '';
        const whatsappApiKey = await DB.getSetting('whatsapp_apikey') || '';
        const events = await DB.getAll('gpsEvents');
        const recentEvents = events
            .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt))
            .slice(0, 30);

        return `
            <h2 style="font-size:var(--font-size-2xl); font-weight:700; margin-bottom:var(--space-6);">
                📡 GPS & Geofencing
            </h2>

            <!-- Configuración del Webhook -->
            <div class="settings-section">
                <div class="settings-section-title">🔑 Configuración Webhook GPS</div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">Token de Seguridad</div>
                        <div class="settings-item-desc">Se envía como header X-GPS-Token en cada request</div>
                    </div>
                    <div style="display:flex; gap:var(--space-2); align-items:center;">
                        <input type="text" id="gpsTokenInput" class="form-input" value="${gpsToken}"
                            style="width:200px; background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;"
                            placeholder="mi-token-secreto">
                        <button class="btn btn-primary btn-sm" onclick="GPSModule.saveToken()">💾</button>
                    </div>
                </div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">URL del Webhook</div>
                        <div class="settings-item-desc">Configura este URL en tu dispositivo GPS</div>
                    </div>
                    <code style="font-size:var(--font-size-xs); background:var(--bg-tertiary); padding:var(--space-2) var(--space-3); border-radius:var(--radius-md); word-break:break-all;">
                        POST ${window.location.origin}/api/gps/webhook
                    </code>
                </div>
            </div>

            <!-- Configuración WhatsApp -->
            <div class="settings-section">
                <div class="settings-section-title">📱 Notificaciones WhatsApp (CallMeBot)</div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">Número de teléfono</div>
                        <div class="settings-item-desc">Con código de país, ej: 5493476123456</div>
                    </div>
                    <input type="text" id="waPhoneInput" class="form-input" value="${whatsappPhone}"
                        style="width:200px; background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;"
                        placeholder="5493476123456" inputmode="tel">
                </div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">API Key de CallMeBot</div>
                        <div class="settings-item-desc">Obtené tu key en callmebot.com/blog/free-api-whatsapp-messages</div>
                    </div>
                    <div style="display:flex; gap:var(--space-2); align-items:center;">
                        <input type="text" id="waApiKeyInput" class="form-input" value="${whatsappApiKey}"
                            style="width:200px; background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;"
                            placeholder="123456">
                        <button class="btn btn-primary btn-sm" onclick="GPSModule.saveWhatsApp()">💾</button>
                    </div>
                </div>
                <div class="settings-item" style="justify-content:flex-end;">
                    <button class="btn btn-secondary btn-sm" onclick="GPSModule.testWhatsApp()">
                        📤 Enviar Test
                    </button>
                </div>
            </div>

            <!-- Simulador GPS (para testing) -->
            <div class="settings-section">
                <div class="settings-section-title">🧪 Simulador GPS</div>
                <div class="settings-item" style="flex-direction:column; align-items:stretch; gap:var(--space-3);">
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label">Patente del Vehículo</label>
                            <input type="text" class="form-input" id="simPlate" placeholder="ABC-1234"
                                style="background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important; text-transform:uppercase;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Zona</label>
                            <select class="form-select" id="simZone"
                                style="background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                                <option value="DOMICILIO_CHOFER">DOMICILIO_CHOFER</option>
                                <option value="TALLER">TALLER</option>
                                <option value="ZONA_OPERACION">ZONA_OPERACION</option>
                            </select>
                        </div>
                    </div>
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label">Latitud</label>
                            <input type="number" class="form-input" id="simLat" value="-33.0232" step="0.0001"
                                style="background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Longitud</label>
                            <input type="number" class="form-input" id="simLng" value="-60.6389" step="0.0001"
                                style="background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                        </div>
                    </div>
                    <button class="btn btn-warning btn-block" onclick="GPSModule.simulateGPS()">
                        📡 Simular Alerta GPS
                    </button>
                </div>
            </div>

            <!-- Log de eventos GPS -->
            <div class="dashboard-section">
                <div class="dashboard-section-title">📋 Últimos Eventos GPS (${recentEvents.length})</div>
                ${recentEvents.length > 0 ? renderEventsTable(recentEvents) :
                    '<p style="color:var(--text-tertiary); text-align:center; padding:var(--space-4);">No hay eventos GPS registrados aún.</p>'}
            </div>
        `;
    }

    function renderEventsTable(events) {
        let rows = '';
        for (const e of events) {
            const time = e.timestamp ? new Date(e.timestamp).toLocaleString() : '-';
            const actionBadge = e.autoCheckout
                ? '<span class="badge badge-danger" style="font-size:0.7rem;">⏹️ Auto-Checkout</span>'
                : (e.event === 'ZONE_ENTER'
                    ? '<span class="badge badge-success" style="font-size:0.7rem;">📍 Entrada</span>'
                    : '<span class="badge badge-warning" style="font-size:0.7rem;">📍 Evento</span>');

            rows += `
                <tr>
                    <td data-label="Hora">${time}</td>
                    <td data-label="Vehículo">${e.vehiclePlate || '-'}</td>
                    <td data-label="Zona">${e.zone || '-'}</td>
                    <td data-label="Coords">${e.lat ? e.lat.toFixed(4) : '-'}, ${e.lng ? e.lng.toFixed(4) : '-'}</td>
                    <td data-label="Acción">${actionBadge}</td>
                </tr>
            `;
        }

        return `
            <div class="data-table-wrapper">
                <table class="data-table data-table-responsive">
                    <thead>
                        <tr>
                            <th>Hora</th>
                            <th>Vehículo</th>
                            <th>Zona</th>
                            <th>Coords</th>
                            <th>Acción</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    // --- Guardar token GPS ---
    async function saveToken() {
        const token = document.getElementById('gpsTokenInput')?.value.trim();
        if (!token) {
            Components.showToast('Ingresá un token de seguridad', 'danger');
            return;
        }
        await DB.setSetting('gps_webhook_token', token);
        Components.showToast('Token GPS guardado ✅', 'success');
    }

    // --- Guardar config WhatsApp ---
    async function saveWhatsApp() {
        const phone = document.getElementById('waPhoneInput')?.value.trim();
        const apiKey = document.getElementById('waApiKeyInput')?.value.trim();
        if (!phone || !apiKey) {
            Components.showToast('Completá teléfono y API Key', 'danger');
            return;
        }
        await DB.setSetting('whatsapp_phone', phone);
        await DB.setSetting('whatsapp_apikey', apiKey);
        Components.showToast('WhatsApp configurado ✅', 'success');
    }

    // --- Test WhatsApp ---
    async function testWhatsApp() {
        const phone = document.getElementById('waPhoneInput')?.value.trim() || await DB.getSetting('whatsapp_phone');
        const apiKey = document.getElementById('waApiKeyInput')?.value.trim() || await DB.getSetting('whatsapp_apikey');
        if (!phone || !apiKey) {
            Components.showToast('Configurá WhatsApp primero', 'danger');
            return;
        }
        Components.showToast('Enviando mensaje de prueba...', 'warning');
        const result = await WhatsApp.send(phone, apiKey, '🚗 FleetAdmin Pro: Test de notificación exitoso ✅');
        if (result.ok) {
            Components.showToast('Mensaje enviado ✅', 'success');
        } else {
            Components.showToast('Error: ' + (result.error || 'No se pudo enviar'), 'danger');
        }
    }

    // --- Simulador GPS ---
    async function simulateGPS() {
        const plate = document.getElementById('simPlate')?.value.trim().toUpperCase();
        const zone = document.getElementById('simZone')?.value;
        const lat = parseFloat(document.getElementById('simLat')?.value);
        const lng = parseFloat(document.getElementById('simLng')?.value);

        if (!plate) {
            Components.showToast('Ingresá la patente del vehículo', 'danger');
            return;
        }

        const token = await DB.getSetting('gps_webhook_token');

        try {
            const response = await fetch('/api/gps/webhook', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-GPS-Token': token || ''
                },
                body: JSON.stringify({
                    vehiclePlate: plate,
                    lat: lat || -33.0232,
                    lng: lng || -60.6389,
                    speed: 0,
                    timestamp: new Date().toISOString(),
                    event: 'ZONE_ENTER',
                    zone: zone
                })
            });

            const data = await response.json();
            if (response.ok) {
                Components.showToast(`Alerta GPS procesada: ${data.action || 'registrada'} ✅`, 'success');
                // Refrescar la vista
                Router.navigate('gps');
            } else {
                Components.showToast('Error: ' + (data.error || response.statusText), 'danger');
            }
        } catch (e) {
            Components.showToast('Error de red: ' + e.message, 'danger');
        }
    }

    return { render, saveToken, saveWhatsApp, testWhatsApp, simulateGPS };
})();
