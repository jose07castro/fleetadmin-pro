    // --- Renderizar panel GPS ---
    async function render() {
        const role = Auth.getRole();
        
        // Si es Dueño, mostrar configuración técnica
        if (role === 'owner') {
            return _renderOwnerSettings();
        }

        // Si es Conductor (o cualquier otro), mostrar el MAPA EN VIVO
        return _renderDriverMap();
    }

    // =============================================
    // VISTA PARA DUEÑOS: Configuración Técnica
    // =============================================
    async function _renderOwnerSettings() {
        const gpsToken = await DB.getSetting('gps_webhook_token') || '';
        const whatsappPhone = await DB.getSetting('whatsapp_phone') || '';
        const whatsappApiKey = await DB.getSetting('whatsapp_apikey') || '';
        const events = await DB.getAll('gpsEvents');
        const recentEvents = events
            .sort((a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt))
            .slice(0, 30);

        return `
            <div class="gps-admin-panel" style="animation: fadeIn 0.5s ease-out;">
                <h2 style="font-size:var(--font-size-2xl); font-weight:700; margin-bottom:var(--space-6); display:flex; align-items:center; gap:10px;">
                    <span style="background:var(--accent-gradient); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">📡 Configuración GPS</span>
                </h2>

                <div class="settings-section">
                    <div class="settings-section-title">🔑 Webhook GPS (Traccar/Protocolos)</div>
                    <div class="settings-item">
                        <div style="flex:1;">
                            <div class="settings-item-label">Token de Seguridad</div>
                            <div class="settings-item-desc">X-GPS-Token header</div>
                        </div>
                        <div style="display:flex; gap:10px;">
                            <input type="text" id="gpsTokenInput" class="form-input" value="${gpsToken}" style="width:150px;">
                            <button class="btn btn-primary" onclick="GPSModule.saveToken()">💾</button>
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <div class="settings-section-title">🧪 Simulador de Alertas</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:15px;">
                        <input type="text" id="simPlate" class="form-input" placeholder="Patente">
                        <select id="simZone" class="form-select">
                            <option value="ZONA_OPERACION">ZONA_OPERACION</option>
                            <option value="TALLER">TALLER</option>
                        </select>
                    </div>
                    <button class="btn btn-warning btn-block" onclick="GPSModule.simulateGPS()">Probar Alerta GPS</button>
                </div>

                <div class="dashboard-section">
                    <div class="dashboard-section-title">📋 Últimos Eventos</div>
                    ${renderEventsTable(recentEvents)}
                </div>
            </div>
        `;
    }

    // =============================================
    // VISTA PARA CONDUCTORES: Mapa en Vivo y Alertas
    // =============================================
    function _renderDriverMap() {
        // Inyectar Leaflet CSS si no está
        if (!document.getElementById('leaflet-css')) {
            const link = document.createElement('link');
            link.id = 'leaflet-css';
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }

        // Cargar Leaflet JS e inicializar
        setTimeout(() => _initMap(), 100);

        return `
            <div class="map-container-wrapper" style="height: calc(100vh - 180px); display: flex; flex-direction: column; gap: 15px; animation: fadeIn 0.5s ease-out;">
                <div class="map-header" style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-secondary); padding: 12px 18px; border-radius: 16px; border: 1px solid var(--border-color); box-shadow: var(--shadow-md);">
                    <div>
                        <h3 style="margin:0; font-size: 1.1rem; color: var(--text-primary);">📍 Mapa de Tránsito en Vivo</h3>
                        <p style="margin:0; font-size: 0.8rem; color: var(--text-tertiary);">Sincronizado con Bot WhatsApp</p>
                    </div>
                    <div id="gps-status-badge" class="badge badge-warning">🛰️ Localizando...</div>
                </div>

                <div id="live-map" style="flex: 1; border-radius: 20px; border: 1px solid var(--border-color); box-shadow: var(--shadow-lg); overflow: hidden; position: relative; z-index: 1;">
                    <div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--bg-tertiary); z-index: 1000;" id="map-loader">
                        <div class="loader-spinner"></div>
                    </div>
                </div>

                <div id="alerts-summary" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div class="stat-card" style="padding: 10px 15px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2);">
                        <div style="font-size: 0.7rem; text-transform: uppercase; color: #ef4444; font-weight: 700;">Operativos</div>
                        <div id="police-count" style="font-size: 1.5rem; font-weight: 800; color: #ef4444;">0</div>
                    </div>
                    <div class="stat-card" style="padding: 10px 15px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.2);">
                        <div style="font-size: 0.7rem; text-transform: uppercase; color: #f59e0b; font-weight: 700;">Alertas Tráfico</div>
                        <div id="traffic-count" style="font-size: 1.5rem; font-weight: 800; color: #f59e0b;">0</div>
                    </div>
                </div>
            </div>
        `;
    }

    let map = null;
    let markers = {};
    let userMarker = null;

    async function _initMap() {
        if (typeof L === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = () => _initMap();
            document.body.appendChild(script);
            return;
        }

        const loader = document.getElementById('map-loader');
        
        // Rosario por defecto
        const defaultCenter = [-32.9468, -60.6393];
        
        map = L.map('live-map', {
            zoomControl: false
        }).setView(defaultCenter, 13);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);

        L.control.zoom({ position: 'topright' }).addTo(map);

        if (loader) loader.style.display = 'none';

        // 1. Localizar al usuario
        _trackUserLocation();

        // 2. Escuchar alertas de Firebase
        _listenToFirebaseAlerts();
    }

    function _trackUserLocation() {
        const badge = document.getElementById('gps-status-badge');
        
        if (!navigator.geolocation) {
            if (badge) badge.textContent = '❌ GPS no soportado';
            return;
        }

        const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };

        navigator.geolocation.watchPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                if (badge) {
                    badge.textContent = '🟢 GPS Activo';
                    badge.className = 'badge badge-success';
                }

                if (!userMarker) {
                    const carIcon = L.divIcon({
                        html: '<div style="background:var(--accent-primary); width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px var(--accent-primary);"></div>',
                        className: '',
                        iconSize: [16, 16]
                    });
                    userMarker = L.marker([latitude, longitude], { icon: carIcon }).addTo(map);
                    map.panTo([latitude, longitude]);
                } else {
                    userMarker.setLatLng([latitude, longitude]);
                }
            },
            (err) => {
                console.warn('GPS Error:', err);
                if (badge) {
                    badge.textContent = '⚠️ GPS Débil';
                    badge.className = 'badge badge-warning';
                }
            },
            options
        );
    }

    function _listenToFirebaseAlerts() {
        const fleetId = Auth.getFleetId() || 'jose07';
        const alertsRef = firebase.database().ref(`fleets/${fleetId}/traffic_alerts`);

        alertsRef.on('value', (snapshot) => {
            const data = snapshot.val() || {};
            _updateMapMarkers(data);
        });
    }

    function _updateMapMarkers(alerts) {
        let pCount = 0;
        let tCount = 0;

        // Limpiar markers que ya no están en Firebase
        Object.keys(markers).forEach(id => {
            if (!alerts[id]) {
                map.removeLayer(markers[id]);
                delete markers[id];
            }
        });

        // Agregar o actualizar markers
        Object.keys(alerts).forEach(id => {
            const alert = alerts[id];
            if (alert.type === 'police') pCount++; else tCount++;

            if (markers[id]) {
                markers[id].setLatLng([alert.lat, alert.lng]);
            } else {
                const iconHtml = alert.type === 'police' 
                    ? '<div style="font-size:24px; filter: drop-shadow(0 0 5px blue);">👮‍♂️</div>' 
                    : '<div style="font-size:24px; filter: drop-shadow(0 0 5px orange);">⚠️</div>';

                const icon = L.divIcon({
                    html: iconHtml,
                    className: 'map-alert-icon',
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                });

                markers[id] = L.marker([alert.lat, alert.lng], { icon })
                    .addTo(map)
                    .bindPopup(`
                        <div style="text-align:center; padding:5px;">
                            <strong style="display:block; margin-bottom:5px;">${alert.type === 'police' ? '🚔 Operativo Detectado' : '⚠️ Alerta de Tránsito'}</strong>
                            <p style="margin:0; font-size:12px;">${alert.location}</p>
                            <span style="font-size:10px; color:gray;">Detectado por Bot WhatsApp</span>
                        </div>
                    `);
            }
        });

        // Actualizar contadores
        const pElem = document.getElementById('police-count');
        const tElem = document.getElementById('traffic-count');
        if (pElem) pElem.textContent = pCount;
        if (tElem) tElem.textContent = tCount;
    }

    function renderEventsTable(events) {
        let rows = '';
        for (const e of events) {
            const time = e.timestamp ? new Date(e.timestamp).toLocaleString() : '-';
            const actionBadge = e.autoCheckout
                ? '<span class="badge badge-danger">⏹️ Checkout</span>'
                : '<span class="badge badge-success">📍 Entrada</span>';

            rows += `
                <tr>
                    <td>${time}</td>
                    <td>${e.vehiclePlate || '-'}</td>
                    <td>${e.zone || '-'}</td>
                    <td>${actionBadge}</td>
                </tr>
            `;
        }

        return `
            <div class="data-table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr><th>Hora</th><th>Móvil</th><th>Zona</th><th>Estado</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    async function saveToken() {
        const token = document.getElementById('gpsTokenInput')?.value.trim();
        await DB.setSetting('gps_webhook_token', token);
        Components.showToast('Configuración guardada ✅');
    }

    async function simulateGPS() {
        const plate = document.getElementById('simPlate')?.value.trim().toUpperCase();
        const zone = document.getElementById('simZone')?.value;
        const token = await DB.getSetting('gps_webhook_token');
        
        if (!plate) return Components.showToast('Ingresá patente', 'danger');

        try {
            await fetch('/api/gps/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-GPS-Token': token || '' },
                body: JSON.stringify({
                    vehiclePlate: plate, lat: -32.9468, lng: -60.6393,
                    timestamp: new Date().toISOString(), event: 'ZONE_ENTER', zone: zone
                })
            });
            Components.showToast('Simulación enviada ✅');
            Router.navigate('gps');
        } catch (e) { Components.showToast('Error de red', 'danger'); }
    }

    return { render, saveToken, simulateGPS };
})();

