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
    let _ownPositionRef = null;
    let _hasReceivedFirebasePosition = false;

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
            constructor(latlng, html, popupHtml, offsetX = 15, offsetY = 15) {
                super();
                this.latlng = latlng;
                this.html = html;
                this.popupHtml = popupHtml;
                this.offsetX = offsetX;
                this.offsetY = offsetY;
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
                        this.openPopup();
                    });
                }
                this.getPanes().overlayMouseTarget.appendChild(this.div);
            }
            draw() {
                if (!this.div) return;
                const pos = this.getProjection().fromLatLngToDivPixel(this.latlng);
                if (pos) {
                    this.div.style.left = (pos.x - this.offsetX) + 'px';
                    this.div.style.top = (pos.y - this.offsetY) + 'px';
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
            setPopupContent(content) {
                this.popupHtml = content;
            }
            openPopup() {
                if (!this.popupHtml) return;
                if (window._activeInfoWindow) window._activeInfoWindow.close();
                const iw = new google.maps.InfoWindow({
                    content: this.popupHtml,
                    pixelOffset: new google.maps.Size(0, -this.offsetY)
                });
                iw.setPosition(this.latlng);
                iw.open(this.getMap());
                window._activeInfoWindow = iw;
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

        // 1b. Escuchar mi propia posición corregida de Firebase (para paridad chofer)
        if (typeof Auth !== 'undefined' && !Auth.isOwner()) {
            _listenToOwnPosition();
        }

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

                // Si ya recibimos coordenadas corregidas de Firebase, no pisamos con las crudas del GPS interno
                if (_hasReceivedFirebasePosition) return;

                const latlng = new google.maps.LatLng(latitude, longitude);

                if (!userMarker) {
                    const MarkerClass = _getHTMLMapMarkerClass();
                    
                    // v126: Icono de auto premium (Paridad con Radar)
                    const heading = pos.coords.heading || 0;
                    const hours = new Date().getHours();
                    const isNight = hours >= 19 || hours < 7;
                    const carColor = '#3b82f6'; // Azul por defecto para el "yo"

                    const html = `
                        <div style="transform: rotate(${heading}deg); transform-origin: center center; transition: transform 0.6s ease-out;">
                            <svg viewBox="0 0 60 110" width="22" height="40" style="display:block; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));">
                                <defs>
                                    <linearGradient id="bodyGrad_user" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stop-color="#1e40af" />
                                        <stop offset="25%" stop-color="#3b82f6" />
                                        <stop offset="75%" stop-color="#3b82f6" />
                                        <stop offset="100%" stop-color="#1e40af" />
                                    </linearGradient>
                                    <radialGradient id="headlightBeam" cx="50%" cy="50%" r="50%">
                                        <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
                                        <stop offset="100%" stop-color="rgba(255,255,255,0)" />
                                    </radialGradient>
                                </defs>
                                
                                ${isNight ? `
                                    <path d="M 15 15 L -10 -40 L 30 -40 Z" fill="url(#headlightBeam)" filter="blur(5px)" />
                                    <path d="M 45 15 L 70 -40 L 30 -40 Z" fill="url(#headlightBeam)" filter="blur(5px)" />
                                ` : ''}

                                <path d="M 12 10 Q 30 -5 48 10 L 52 90 Q 30 115 8 90 Z" fill="rgba(0,0,0,0.3)" filter="blur(2px)" />
                                <path d="M 14 12 Q 30 -2 46 12 L 50 92 Q 30 110 10 92 Z" fill="url(#bodyGrad_user)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                                <path d="M 18 30 Q 30 20 42 30 L 44 70 Q 30 80 16 70 Z" fill="#020617" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                                
                                <!-- Luces -->
                                <path d="M 15 15 L 23 11 L 21 16 Z" fill="#fff" filter="drop-shadow(0 0 ${isNight ? '8px' : '3px'} #fff)" />
                                <path d="M 45 15 L 37 11 L 39 16 Z" fill="#fff" filter="drop-shadow(0 0 ${isNight ? '8px' : '3px'} #fff)" />
                                <path d="M 12 91 Q 30 96 48 91 L 46 89 Q 30 93 14 89 Z" fill="#ef4444" filter="drop-shadow(0 0 ${isNight ? '10px' : '4px'} #ef4444)" />
                            </svg>
                        </div>
                    `;

                    userMarker = new MarkerClass(latlng, html, null, 11, 20);
                    userMarker.setMap(map);
                    
                    map.panTo(latlng);
                } else {
                    const heading = pos.coords.heading || 0;
                    const hours = new Date().getHours();
                    const isNight = hours >= 19 || hours < 7;
                    
                    // Actualizar posición y rotación
                    userMarker.setPosition(latlng);
                    userMarker.setHtml(`
                        <div style="transform: rotate(${heading}deg); transform-origin: center center; transition: transform 0.6s ease-out;">
                            <svg viewBox="0 0 60 110" width="22" height="40" style="display:block; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));">
                                <defs>
                                    <linearGradient id="bodyGrad_user" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stop-color="#1e40af" />
                                        <stop offset="25%" stop-color="#3b82f6" />
                                        <stop offset="75%" stop-color="#3b82f6" />
                                        <stop offset="100%" stop-color="#1e40af" />
                                    </linearGradient>
                                </defs>
                                ${isNight ? '<path d="M 15 15 L -10 -40 L 30 -40 Z" fill="rgba(255,255,255,0.2)" filter="blur(5px)" /><path d="M 45 15 L 70 -40 L 30 -40 Z" fill="rgba(255,255,255,0.2)" filter="blur(5px)" />' : ''}
                                <path d="M 14 12 Q 30 -2 46 12 L 50 92 Q 30 110 10 92 Z" fill="url(#bodyGrad_user)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                                <path d="M 18 30 Q 30 20 42 30 L 44 70 Q 30 80 16 70 Z" fill="#020617" />
                                <path d="M 12 91 Q 30 96 48 91 L 46 89 Q 30 93 14 89 Z" fill="#ef4444" filter="drop-shadow(0 0 ${isNight ? '10px' : '4px'} #ef4444)" />
                            </svg>
                        </div>
                    `);
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

    function _listenToOwnPosition() {
        const userId = typeof Auth !== 'undefined' ? (Auth.getUserId() || Auth.getUserName()) : null;
        if (!userId || typeof firebase === 'undefined') return;

        if (_ownPositionRef) {
            _ownPositionRef.off();
        }

        _ownPositionRef = firebase.database().ref(`driver_positions/${userId}`);
        _ownPositionRef.on('value', (snapshot) => {
            const data = snapshot.val();
            if (data && data.lat && data.lng) {
                _hasReceivedFirebasePosition = true;
                const latlng = new google.maps.LatLng(data.lat, data.lng);
                const heading = data.heading || 0;
                
                const hours = new Date().getHours();
                const isNight = hours >= 19 || hours < 7;

                if (!userMarker) {
                    const MarkerClass = _getHTMLMapMarkerClass();
                    const html = `
                        <div style="transform: rotate(${heading}deg); transform-origin: center center; transition: transform 0.6s ease-out;">
                            <svg viewBox="0 0 60 110" width="22" height="40" style="display:block; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));">
                                <defs>
                                    <linearGradient id="bodyGrad_user" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stop-color="#1e40af" />
                                        <stop offset="25%" stop-color="#3b82f6" />
                                        <stop offset="75%" stop-color="#3b82f6" />
                                        <stop offset="100%" stop-color="#1e40af" />
                                    </linearGradient>
                                    <radialGradient id="headlightBeam" cx="50%" cy="50%" r="50%">
                                        <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
                                        <stop offset="100%" stop-color="rgba(255,255,255,0)" />
                                    </radialGradient>
                                </defs>
                                
                                ${isNight ? `
                                    <path d="M 15 15 L -10 -40 L 30 -40 Z" fill="url(#headlightBeam)" filter="blur(5px)" />
                                    <path d="M 45 15 L 70 -40 L 30 -40 Z" fill="url(#headlightBeam)" filter="blur(5px)" />
                                ` : ''}

                                <path d="M 12 10 Q 30 -5 48 10 L 52 90 Q 30 115 8 90 Z" fill="rgba(0,0,0,0.3)" filter="blur(2px)" />
                                <path d="M 14 12 Q 30 -2 46 12 L 50 92 Q 30 110 10 92 Z" fill="url(#bodyGrad_user)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                                <path d="M 18 30 Q 30 20 42 30 L 44 70 Q 30 80 16 70 Z" fill="#020617" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                                
                                <!-- Luces -->
                                <path d="M 15 15 L 23 11 L 21 16 Z" fill="#fff" filter="drop-shadow(0 0 ${isNight ? '8px' : '3px'} #fff)" />
                                <path d="M 45 15 L 37 11 L 39 16 Z" fill="#fff" filter="drop-shadow(0 0 ${isNight ? '8px' : '3px'} #fff)" />
                                <path d="M 12 91 Q 30 96 48 91 L 46 89 Q 30 93 14 89 Z" fill="#ef4444" filter="drop-shadow(0 0 ${isNight ? '10px' : '4px'} #ef4444)" />
                            </svg>
                        </div>
                    `;
                    userMarker = new MarkerClass(latlng, html, null, 11, 20);
                    userMarker.setMap(map);
                    map.panTo(latlng);
                } else {
                    userMarker.setPosition(latlng);
                    userMarker.setHtml(`
                        <div style="transform: rotate(${heading}deg); transform-origin: center center; transition: transform 0.6s ease-out;">
                            <svg viewBox="0 0 60 110" width="22" height="40" style="display:block; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));">
                                <defs>
                                    <linearGradient id="bodyGrad_user" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stop-color="#1e40af" />
                                        <stop offset="25%" stop-color="#3b82f6" />
                                        <stop offset="75%" stop-color="#3b82f6" />
                                        <stop offset="100%" stop-color="#1e40af" />
                                    </linearGradient>
                                </defs>
                                ${isNight ? '<path d="M 15 15 L -10 -40 L 30 -40 Z" fill="rgba(255,255,255,0.2)" filter="blur(5px)" /><path d="M 45 15 L 70 -40 L 30 -40 Z" fill="rgba(255,255,255,0.2)" filter="blur(5px)" />' : ''}
                                <path d="M 14 12 Q 30 -2 46 12 L 50 92 Q 30 110 10 92 Z" fill="url(#bodyGrad_user)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                                <path d="M 18 30 Q 30 20 42 30 L 44 70 Q 30 80 16 70 Z" fill="#020617" />
                                <path d="M 12 91 Q 30 96 48 91 L 46 89 Q 30 93 14 89 Z" fill="#ef4444" filter="drop-shadow(0 0 ${isNight ? '10px' : '4px'} #ef4444)" />
                            </svg>
                        </div>
                    `);
                    map.panTo(latlng);
                }
            }
        });
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
        const now = Date.now();

        // 1. Limpiar markers que ya no están en Firebase o están inactivos/expirados
        Object.keys(markers).forEach(id => {
            const alert = alerts[id];
            const isExpired = alert && alert.expiresAt && alert.expiresAt <= now;
            const isInactive = alert && alert.status !== 'active';
            
            if (!alert || isExpired || isInactive) {
                markers[id].setMap(null);
                delete markers[id];
            }
        });

        const ALERT_ICONS = {
            police: 'assets/alert-icons/police.png',
            checkpoint: 'assets/alert-icons/police.png',
            radar: 'assets/alert-icons/radar.png',
            helicopter: 'assets/alert-icons/helicopter.png',
            ambulance: 'assets/alert-icons/ambulance.png',
            firetruck: 'assets/alert-icons/firetruck.png',
            municipal: 'assets/alert-icons/municipal.png',
            accident: 'assets/alert-icons/accident.png',
            traffic: 'assets/alert-icons/accident.png',
            warning: 'assets/alert-icons/warning.png'
        };
        
        const BORDER_COLORS = {
            police: '#3b82f6',
            checkpoint: '#1d40af',
            radar: '#f59e0b',
            helicopter: '#10b981',
            ambulance: '#ef4444',
            firetruck: '#b91c1c',
            municipal: '#10b981',
            accident: '#ef4444',
            traffic: '#f97316',
            warning: '#6b7280'
        };

        const GLOW_SHADOWS = {
            police: '0 0 10px rgba(59, 130, 246, 0.8)',
            checkpoint: '0 0 10px rgba(29, 64, 175, 0.8)',
            radar: '0 0 10px rgba(245, 158, 11, 0.8)',
            helicopter: '0 0 10px rgba(16, 185, 129, 0.8)',
            ambulance: '0 0 10px rgba(239, 68, 68, 0.8)',
            firetruck: '0 0 10px rgba(185, 28, 28, 0.8)',
            municipal: '0 0 10px rgba(16, 185, 129, 0.8)',
            accident: '0 0 10px rgba(239, 68, 68, 0.8)',
            traffic: '0 0 10px rgba(249, 115, 22, 0.8)',
            warning: '0 0 8px rgba(107, 114, 128, 0.5)'
        };

        // 2. Agregar o actualizar markers
        Object.keys(alerts).forEach(id => {
            const alert = alerts[id];
            if (!alert) return;

            // Validar latitud/longitud
            const lat = parseFloat(alert.lat);
            const lng = parseFloat(alert.lng);
            if (isNaN(lat) || isNaN(lng)) return;

            // Filtrar alertas inactivas o expiradas
            const isExpired = alert.expiresAt && alert.expiresAt <= now;
            const isInactive = alert.status !== 'active';
            if (isExpired || isInactive) return;

            // Registrar inspectores municipales en el conteo de operativos
            if (alert.type === 'police' || alert.type === 'checkpoint' || alert.type === 'municipal') {
                pCount++;
            } else {
                tCount++;
            }

            const latlng = new google.maps.LatLng(lat, lng);
            const iconUrl = ALERT_ICONS[alert.type] || ALERT_ICONS.warning;
            const borderColor = BORDER_COLORS[alert.type] || BORDER_COLORS.warning;
            const glowStyle = GLOW_SHADOWS[alert.type] || GLOW_SHADOWS.warning;

            const iconHtml = `
                <div class="custom-alert-marker" style="
                    width: 40px;
                    height: 40px;
                    background-color: #ffffff;
                    border: 3px solid ${borderColor};
                    border-radius: 50%;
                    box-shadow: ${glowStyle};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    position: relative;
                    box-sizing: border-box;
                ">
                    <img src="${iconUrl}" style="width: 24px; height: 24px; object-fit: contain;" />
                </div>
            `;

            let popupLabel = '⚠️ Alerta de Tránsito';
            if (alert.type === 'police') popupLabel = '🚔 Operativo Policial';
            else if (alert.type === 'checkpoint') popupLabel = '🚧 Control de Tránsito';
            else if (alert.type === 'municipal') popupLabel = '🦊 Inspector Municipal';
            else if (alert.type === 'radar') popupLabel = '📷 Radar / Fotomulta';
            else if (alert.type === 'helicopter') popupLabel = '🚁 Helicóptero Sanitario';
            else if (alert.type === 'ambulance') popupLabel = '🚑 Servicio de Ambulancia';
            else if (alert.type === 'firetruck') popupLabel = '🚒 Bomberos en Emergencia';
            else if (alert.type === 'accident') popupLabel = '💥 Accidente de Tránsito';
            else if (alert.type === 'traffic') popupLabel = '🚗 Tránsito Demorado';

            let audioButtonHtml = '';
            if (alert.audioUrl) {
                audioButtonHtml = `
                    <div style="margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
                        <button id="play-btn-${id}" class="audio-play-btn btn btn-primary btn-sm" 
                            onclick="GPSModule.playAudio('${alert.audioUrl}', 'play-btn-${id}')"
                            style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 12px; font-size: 11px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; background: #3b82f6; color: white;">
                            ▶️ Escuchar Audio
                        </button>
                    </div>
                `;
            }

            // Si hay descripción de IA/Resumen limpio, mostrarlo como primario. Si no, usar texto original recortado.
            const cleanSummary = alert.description || (alert.originalText ? alert.originalText.substring(0, 60) : '');
            
            // Texto original en un desplegable <details>
            let detailsHtml = '';
            if (alert.originalText) {
                detailsHtml = `
                    <details style="margin-top: 6px; text-align: left; font-size: 10px; color: #64748b; cursor: pointer; outline: none;">
                        <summary style="font-weight: 600; color: #3b82f6; outline: none; margin-bottom: 2px;">Ver texto original</summary>
                        <div style="max-height: 65px; overflow-y: auto; padding: 4px 6px; background: #f8fafc; border-radius: 4px; border: 1px solid #e2e8f0; font-style: italic; white-space: pre-wrap; line-height: 1.2; color: #334155;">
                            "${alert.originalText}"
                        </div>
                    </details>
                `;
            }

            const popupContent = `
                <div style="text-align:center; padding:8px; font-family:Inter,sans-serif; min-width: 160px; max-width: 220px; color: #1e293b;">
                    <strong style="display:block; margin-bottom:6px; font-size:13px; color: ${borderColor};">${popupLabel}</strong>
                    <p style="margin:0 0 6px 0; font-size:12px; font-weight:700;">${alert.location}</p>
                    ${cleanSummary ? `<p style="margin:0 0 6px 0; font-size:11px; font-weight: 500; color: #334155; line-height: 1.3;">${cleanSummary}</p>` : ''}
                    ${detailsHtml}
                    <span style="font-size:9px; color:#94a3b8; display:block; margin-top:6px;">Reportado por WhatsApp</span>
                    ${audioButtonHtml}
                </div>
            `;

            if (markers[id]) {
                markers[id].setPosition(latlng);
                markers[id].setHtml(iconHtml);
                markers[id].setPopupContent(popupContent);
            } else {
                const MarkerClass = _getHTMLMapMarkerClass();
                const marker = new MarkerClass(latlng, iconHtml, popupContent, 20, 20);
                marker.setMap(map);
                markers[id] = marker;

                // Auto-enfocar mapa y abrir popup para NUEVAS alertas si el mapa existe
                if (map) {
                    map.panTo(latlng);
                    map.setZoom(14);
                    setTimeout(() => {
                        if (markers[id]) {
                            markers[id].openPopup();
                        }
                    }, 500);
                }
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

    let currentAudio = null;
    let currentAudioId = null;

    function playAudio(audioUrl, btnId) {
        const btn = document.getElementById(btnId);
        if (!btn) return;

        const serverUrl = (window.location.hostname === 'localhost' || 
                           window.location.hostname === '127.0.0.1' ||
                           window.location.protocol === 'file:') 
                           ? 'https://fleetadmin-web-nueva.onrender.com' 
                           : window.location.origin;

        const fullUrl = audioUrl.startsWith('http') ? audioUrl : `${serverUrl}${audioUrl}`;

        if (currentAudio && currentAudioId === audioUrl) {
            if (!currentAudio.paused) {
                currentAudio.pause();
                btn.innerHTML = '▶️ Escuchar Audio';
                btn.classList.remove('playing');
            } else {
                currentAudio.play().catch(e => console.error('Audio play error:', e));
                btn.innerHTML = '⏸️ Pausar Audio';
                btn.classList.add('playing');
            }
            return;
        }

        if (currentAudio) {
            currentAudio.pause();
            const prevBtn = document.querySelector('.audio-play-btn.playing');
            if (prevBtn) {
                prevBtn.innerHTML = '▶️ Escuchar Audio';
                prevBtn.classList.remove('playing');
            }
        }

        currentAudio = new Audio(fullUrl);
        currentAudioId = audioUrl;
        currentAudio.preload = 'auto'; // Forzar precarga de audio para móviles

        btn.innerHTML = '⏳ Cargando...';

        // Intentar reproducir directamente (más rápido en la mayoría de navegadores modernos)
        currentAudio.play()
            .then(() => {
                if (currentAudioId === audioUrl) {
                    btn.innerHTML = '⏸️ Pausar Audio';
                    btn.classList.add('playing');
                }
            })
            .catch(e => {
                console.warn('Play directo falló, esperando evento canplay:', e);
            });

        // Evento alternativo más seguro para móviles que canplaythrough
        currentAudio.addEventListener('canplay', () => {
            if (currentAudioId === audioUrl && currentAudio.paused) {
                currentAudio.play()
                    .then(() => {
                        btn.innerHTML = '⏸️ Pausar Audio';
                        btn.classList.add('playing');
                    })
                    .catch(err => {
                        console.error('Audio play error in canplay:', err);
                    });
            }
        });

        currentAudio.addEventListener('ended', () => {
            btn.innerHTML = '▶️ Escuchar Audio';
            btn.classList.remove('playing');
            currentAudio = null;
            currentAudioId = null;
        });

        currentAudio.addEventListener('error', (e) => {
            console.error('Audio load error:', e);
            btn.innerHTML = '❌ Error';
            btn.classList.remove('playing');
            currentAudio = null;
            currentAudioId = null;
            setTimeout(() => {
                btn.innerHTML = '▶️ Escuchar Audio';
            }, 2000);
        });
    }

    return { render, saveToken, simulateGPS, toggleMapStyle, playAudio };
})();

