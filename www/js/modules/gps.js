const GPSModule = (() => {
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

        // v125: Leaflet dependencies replaced by Google Maps global SDK

        // Inicializar mapa después del render
        setTimeout(() => _initMap(), 100);

        return `
            <div class="gps-admin-panel" style="animation: fadeIn 0.5s ease-out;">
                <h2 style="font-size:var(--font-size-2xl); font-weight:700; margin-bottom:var(--space-6); display:flex; align-items:center; gap:10px;">
                    <span style="background:var(--accent-gradient); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">📡 GPS & Alertas de Tránsito</span>
                </h2>

                <!-- ===== MAPA DE ALERTAS EN VIVO ===== -->
                <div class="map-container-wrapper" style="height: 400px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
                    <div class="map-header" style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-secondary); padding: 12px 18px; border-radius: 16px; border: 1px solid var(--border-color); box-shadow: var(--shadow-md);">
                        <div>
                            <h3 style="margin:0; font-size: 1.1rem; color: var(--text-primary);">📍 Mapa de Tránsito en Vivo</h3>
                            <p style="margin:0; font-size: 0.8rem; color: var(--text-tertiary);">Sincronizado con Bot WhatsApp</p>
                        </div>
                        <div id="gps-status-badge" class="badge badge-warning">🛰️ Cargando mapa...</div>
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

                <!-- ===== CONFIGURACIÓN TÉCNICA ===== -->
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
        // v125: Leaflet dependencies replaced by Google Maps global SDK

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
                    <!-- Botón flotante para alternar estilo de mapa -->
                    <button id="gpsMapStyleBtn" onclick="GPSModule.toggleMapStyle()" title="Cambiar Vista del Mapa" 
                        style="position:absolute; bottom: 20px; right: 12px; z-index: 1000; background: white; color: #333; border: 2px solid rgba(0,0,0,0.2); border-radius: 8px; width: 42px; height: 42px; font-size: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 3px 8px rgba(0,0,0,0.4); font-weight: bold;">
                        🗺️
                    </button>
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
    let _mapStyle = localStorage.getItem('gpsMapStyle') || 'dark';
    let markers = {};
    let userMarker = null;

    // JSON STYLES PARA GOOGLE MAPS API
    const GOOGLE_MAP_DARK_STYLE = [
        { "elementType": "geometry", "stylers": [{ "color": "#1d2d44" }] },
        { "elementType": "labels.text.fill", "stylers": [{ "color": "#8ec3b9" }] },
        { "elementType": "labels.text.stroke", "stylers": [{ "color": "#1a3646" }] },
        { "featureType": "administrative.locality", "elementType": "labels.text.fill", "stylers": [{ "color": "#d59563" }] },
        { "featureType": "poi", "stylers": [{ "visibility": "off" }] },
        { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#304a7d" }] },
        { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#9ca5b3" }] },
        { "featureType": "road.highway", "elementType": "geometry", "stylers": [{ "color": "#746855" }] },
        { "featureType": "road.highway", "elementType": "labels.text.fill", "stylers": [{ "color": "#f3d19c" }] },
        { "featureType": "transit", "stylers": [{ "visibility": "off" }] },
        { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#0f172a" }] }
    ];

    const GOOGLE_MAP_LIGHT_STYLE = [
        { "featureType": "poi", "stylers": [{ "visibility": "off" }] },
        { "featureType": "transit", "stylers": [{ "visibility": "simplified" }] }
    ];

    let _HTMLMapMarkerClass = null;
    function _getHTMLMapMarkerClass() {
        if (_HTMLMapMarkerClass) return _HTMLMapMarkerClass;
        
        _HTMLMapMarkerClass = class extends google.maps.OverlayView {
            constructor(latlng, html, popupHtml, offset = 30) {
                super();
                this.latlng = latlng;
                this.html = html;
                this.popupHtml = popupHtml;
                this.offset = offset;
                this.div = null;
            }
            onAdd() {
                this.div = document.createElement('div');
                this.div.style.position = 'absolute';
                this.div.style.cursor = 'pointer';
                this.div.style.zIndex = '10';
                this.div.innerHTML = this.html;
                
                if (this.popupHtml) {
                    this.div.addEventListener('click', () => {
                        if (window._activeInfoWindow) window._activeInfoWindow.close();
                        const iw = new google.maps.InfoWindow({
                            content: this.popupHtml,
                            pixelOffset: new google.maps.Size(0, -this.offset)
                        });
                        iw.setPosition(this.latlng);
                        iw.open(this.getMap());
                        window._activeInfoWindow = iw;
                    });
                }
                this.getPanes().overlayMouseTarget.appendChild(this.div);
            }
            draw() {
                if (!this.div) return;
                const pos = this.getProjection().fromLatLngToDivPixel(this.latlng);
                if (pos) {
                    this.div.style.left = (pos.x - this.offset) + 'px';
                    this.div.style.top = (pos.y - this.offset) + 'px';
                }
            }
            onRemove() {
                if (this.div) {
                    this.div.parentNode.removeChild(this.div);
                    this.div = null;
                }
            }
            setPosition(latlng) {
                this.latlng = latlng;
                this.draw();
            }
            setHtml(html) {
                this.html = html;
                if (this.div) this.div.innerHTML = html;
            }
            getPosition() {
                return this.latlng;
            }
        };
        return _HTMLMapMarkerClass;
    }

    async function _initMap() {
        const loader = document.getElementById('map-loader');
        
        // Rosario por defecto
        const defaultLat = -32.9468;
        const defaultLng = -60.6393;

        const activeStyle = _mapStyle === 'light' ? GOOGLE_MAP_LIGHT_STYLE : GOOGLE_MAP_DARK_STYLE;
        
        map = new google.maps.Map(document.getElementById('live-map'), {
            center: { lat: defaultLat, lng: defaultLng },
            zoom: 13,
            styles: activeStyle,
            zoomControl: true,
            zoomControlOptions: {
                position: google.maps.ControlPosition.RIGHT_TOP
            },
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });

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

                const latlng = new google.maps.LatLng(latitude, longitude);

                if (!userMarker) {
                    const MarkerClass = _getHTMLMapMarkerClass();
                    const html = '<div style="background:var(--accent-primary); width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px var(--accent-primary);"></div>';
                    userMarker = new MarkerClass(latlng, html, null, 8);
                    userMarker.setMap(map);
                    
                    map.panTo(latlng);
                } else {
                    userMarker.setPosition(latlng);
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
                markers[id].setMap(null);
                delete markers[id];
            }
        });

        // Agregar o actualizar markers
        Object.keys(alerts).forEach(id => {
            const alert = alerts[id];
            if (alert.type === 'police' || alert.type === 'checkpoint') pCount++; else tCount++;

            const latlng = new google.maps.LatLng(alert.lat, alert.lng);

            if (markers[id]) {
                markers[id].setPosition(latlng);
            } else {
                const isOperativo = alert.type === 'police' || alert.type === 'checkpoint';
                const iconHtml = isOperativo 
                    ? '<div style="font-size:24px; filter: drop-shadow(0 0 5px blue);">👮‍♂️</div>' 
                    : '<div style="font-size:24px; filter: drop-shadow(0 0 5px orange);">⚠️</div>';

                const popupLabel = isOperativo ? '🚔 Operativo Detectado' : '⚠️ Alerta de Tránsito';
                
                const popupContent = `
                    <div style="text-align:center; padding:5px; font-family:Inter,sans-serif;">
                        <strong style="display:block; margin-bottom:5px;">${popupLabel}</strong>
                        <p style="margin:0; font-size:12px;">${alert.location}</p>
                        <span style="font-size:10px; color:gray;">Detectado por Bot WhatsApp</span>
                    </div>
                `;

                const MarkerClass = _getHTMLMapMarkerClass();
                const marker = new MarkerClass(latlng, iconHtml, popupContent, 15);
                marker.setMap(map);
                markers[id] = marker;
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

    // ============ TOGGLE MAP STYLE ============
    function toggleMapStyle() {
        if (!map) return;
        
        _mapStyle = _mapStyle === 'dark' ? 'light' : 'dark';
        localStorage.setItem('gpsMapStyle', _mapStyle);
        
        const activeStyle = _mapStyle === 'light' ? GOOGLE_MAP_LIGHT_STYLE : GOOGLE_MAP_DARK_STYLE;
        
        // Cambiar estilos suavemente
        map.setOptions({ styles: activeStyle });
        
        // Cambiar aspecto del botón
        const btn = document.getElementById('gpsMapStyleBtn');
        if (btn) {
            btn.style.background = _mapStyle === 'light' ? '#333' : '#fff';
            btn.style.borderColor = _mapStyle === 'light' ? '#111' : 'rgba(0,0,0,0.2)';
            btn.style.boxShadow = _mapStyle === 'light' ? '0 3px 8px rgba(0,0,0,0.6)' : '0 3px 8px rgba(0,0,0,0.4)';
        }
    }

    return { render, saveToken, simulateGPS, toggleMapStyle };
})();

