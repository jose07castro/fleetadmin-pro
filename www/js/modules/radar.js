/* ============================================
   FleetAdmin Pro — Radar GPS en Tiempo Real (v111)
   Mapa fullscreen con Leaflet.js + Firebase RTDB
   - Botón "Desplegar Mapa" en dashboard
   - Tracking GPS con watchPosition + intervalo 20s
   - Marcadores de auto por cada chofer activo
   - Botón "Salir" grande para S-Pen
   ============================================ */

const RadarModule = (() => {
    const DRIVER_POSITIONS_NODE = 'driver_positions';
    const UPDATE_INTERVAL_MS = 20000; // 20 segundos
    let _map = null;
    let _firebaseRef = null;
    let _alertRef = null;
    let _isOpen = false;
    let _markers = {};       // { driverId: HTMLMapMarker }
    let _alertMarkers = {};  // { alertId: {marker, infoWindow} }
    let _trackingInterval = null;
    let _watchId = null;
    let _voiceEnabled = localStorage.getItem('radarVoice') !== 'off'; // ON por defecto
    let _mapStyle = localStorage.getItem('radarMapStyle') || 'dark'; // Estilo por defecto

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
            constructor(latlng, html, popupHtml) {
                super();
                this.latlng = latlng;
                this.html = html;
                this.popupHtml = popupHtml;
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
                            pixelOffset: new google.maps.Size(0, -25)
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
                    this.div.style.left = (pos.x - 30) + 'px';
                    this.div.style.top = (pos.y - 30) + 'px';
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
            getPosition() {
                return this.latlng;
            }
        };
        return _HTMLMapMarkerClass;
    }

    // ============ RENDER BUTTON IN DASHBOARD ============

    function renderDashboardButton() {
        return `
            <button class="radar-deploy-btn" id="radarDeployBtn" onclick="RadarModule.open()">
                <span class="radar-deploy-icon">📡</span>
                <span class="radar-deploy-label">Desplegar Radar GPS</span>
                <span class="radar-deploy-pulse"></span>
            </button>
        `;
    }

    // ============ OPEN FULLSCREEN MAP ============

    function open() {
        if (_isOpen) return;
        _isOpen = true;

        // Create fullscreen container
        const container = document.createElement('div');
        container.id = 'radarFullscreen';
        container.className = 'radar-fullscreen';
        container.innerHTML = `
            <div class="radar-header">
                <div class="radar-header-left">
                    <span class="radar-header-icon">📡</span>
                    <span class="radar-header-title">Radar GPS — Flota en Tiempo Real</span>
                </div>
                <div class="radar-header-right">
                    <span class="radar-status" id="radarStatus">
                        <span class="radar-status-dot"></span>
                        Conectando...
                    </span>
                    <button class="radar-voice-btn" id="radarVoiceBtn"
                        onclick="RadarModule.toggleVoice()"
                        title="Activar/desactivar voz"
                        style="background:rgba(255,255,255,0.15);border:none;border-radius:8px;padding:6px 12px;color:white;font-size:18px;cursor:pointer;margin-right:8px;">
                        ${_voiceEnabled ? '🔊' : '🔇'}
                    </button>
                    <button class="radar-close-btn" id="radarCloseBtn" onclick="RadarModule.close()" title="Cerrar mapa">
                        ✕ Salir
                    </button>
                </div>
            </div>
            <div id="radarMap" class="radar-map"></div>
            <button id="radarMapStyleBtn" onclick="RadarModule.toggleMapStyle()" title="Cambiar Vista del Mapa" 
                style="position:absolute; bottom: 80px; right: 12px; z-index: 1000; background: white; color: #333; border: 2px solid rgba(0,0,0,0.2); border-radius: 8px; width: 42px; height: 42px; font-size: 22px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 3px 8px rgba(0,0,0,0.4); font-weight: bold; transition: transform 0.1s active;">
                🗺️
            </button>
            <div class="radar-legend" id="radarLegend">
                <span class="radar-legend-item">🚗 Choferes activos: <strong id="radarActiveCount">0</strong></span>
                <span class="radar-legend-item">🕐 Actualización: <strong>Tiempo real (3.5s)</strong></span>
            </div>
        `;

        document.body.appendChild(container);
        document.body.style.overflow = 'hidden';

        // Animate in
        requestAnimationFrame(() => {
            container.classList.add('radar-visible');
        });

        // Init Leaflet map
        _initMap();

        // Start listening to driver positions
        _startFirebaseListener();
        _startAlertListener();
    }

    // ============ CLOSE MAP ============

    function close() {
        _isOpen = false;

        // Stop Firebase listener
        _stopFirebaseListener();
        _stopAlertListener();

        // Destroy map
        if (_map) {
            _map = null;
        }
        _markers = {};

        // Remove container
        const container = document.getElementById('radarFullscreen');
        if (container) {
            container.classList.remove('radar-visible');
            setTimeout(() => {
                container.remove();
                document.body.style.overflow = '';
            }, 300);
        }
    }

    // ============ GOOGLE MAP INIT ============

    function _initMap() {
        // Default center: Rosario, Argentina (approximate fleet location)
        const defaultLat = -33.0232;
        const defaultLng = -60.6389;

        const activeStyle = _mapStyle === 'light' ? GOOGLE_MAP_LIGHT_STYLE : GOOGLE_MAP_DARK_STYLE;

        _map = new google.maps.Map(document.getElementById('radarMap'), {
            center: { lat: defaultLat, lng: defaultLng },
            zoom: 13,
            styles: activeStyle,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });
    }

    // ============ CREATE CAR MARKER ============

    function _createCarIcon(heading, displayName, statusClass, carColor) {
        const rotation = heading || 0;
        
        // Mapeo de colores técnicos para SVG (Versión HD 3D)
        const colors = {
            'white': { body: '#ffffff', side: '#cbd5e1', roof: '#f8fafc', glass: '#94a3b8' },
            'blanco': { body: '#ffffff', side: '#cbd5e1', roof: '#f8fafc', glass: '#94a3b8' },
            'black': { body: '#1e293b', side: '#0f172a', roof: '#334155', glass: '#64748b' },
            'negro': { body: '#1e293b', side: '#0f172a', roof: '#334155', glass: '#64748b' },
            'taxi': { body: '#1e293b', side: '#0f172a', roof: '#facc15', glass: '#64748b' },
            'gray': { body: '#64748b', side: '#475569', roof: '#94a3b8', glass: '#cbd5e1' },
            'gris': { body: '#64748b', side: '#475569', roof: '#94a3b8', glass: '#cbd5e1' },
            'silver': { body: '#e2e8f0', side: '#94a3b8', roof: '#f1f5f9', glass: '#cbd5e1' },
            'plata': { body: '#e2e8f0', side: '#94a3b8', roof: '#f1f5f9', glass: '#cbd5e1' },
            'red': { body: '#ef4444', side: '#b91c1c', roof: '#f87171', glass: '#fca5a5' },
            'rojo': { body: '#ef4444', side: '#b91c1c', roof: '#f87171', glass: '#fca5a5' },
            'blue': { body: '#3b82f6', side: '#1e40af', roof: '#60a5fa', glass: '#93c5fd' },
            'azul': { body: '#3b82f6', side: '#1e40af', roof: '#60a5fa', glass: '#93c5fd' },
            'maroon': { body: '#991b1b', side: '#7f1d1d', roof: '#b91c1c', glass: '#fca5a5' },
            'bordo': { body: '#7f1d1d', side: '#450a0a', roof: '#991b1b', glass: '#fca5a5' },
            'bordo metalizado': { body: '#991b1b', side: '#450a0a', roof: '#b91c1c', glass: '#fca5a5' }
        };

        const carColorKey = (carColor || 'gray').toLowerCase();
        const theme = colors[carColorKey] || colors['gray'];
        const isTaxi = carColorKey === 'taxi';

        // v119: Lógica de Perspectiva 3D Dinámica (8 ángulos)
        // Mapeamos el 'heading' (rumbo) a una de las 8 vistas isométricas detalladas
        const angle = (rotation + 360) % 360;
        let viewAngle = 180; // Default: Trompa (acercándose)
        
        if (angle >= 337.5 || angle < 22.5) viewAngle = 0;      // Espalda (alejándose)
        else if (angle >= 22.5 && angle < 67.5) viewAngle = 45;   // Espalda-Derecha
        else if (angle >= 67.5 && angle < 112.5) viewAngle = 90;  // Perfil Derecho
        else if (angle >= 112.5 && angle < 157.5) viewAngle = 135; // Frente-Derecha
        else if (angle >= 157.5 && angle < 202.5) viewAngle = 180; // Frente (trompa)
        else if (angle >= 202.5 && angle < 247.5) viewAngle = 225; // Frente-Izquierda
        else if (angle >= 247.5 && angle < 292.5) viewAngle = 270; // Perfil Izquierdo
        else if (angle >= 292.5 && angle < 337.5) viewAngle = 315; // Espalda-Izquierda

        // Generar el SVG según la perspectiva (Plantillas de Alta Definición)
        function generateDetailedCarSVG(view, theme, isTaxi) {
            const baseStyle = `style="display:block; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3)); overflow:visible;"`;
            const glassColor = theme.glass || 'rgba(148, 163, 184, 0.7)';
            
            // Plantilla: FRENTE (Trompa) - 180°
            if (view === 180) {
                return `
                <svg viewBox="0 0 60 40" width="60" height="40" ${baseStyle}>
                    <path d="M5 30 L55 30 L50 15 L10 15 Z" fill="${theme.side}" /> <!-- Chasis bajo -->
                    <path d="M10 25 L50 25 L45 5 L15 5 Z" fill="${theme.body}" /> <!-- Capó/Techo -->
                    <path d="M18 15 L42 15 L38 8 L22 8 Z" fill="${glassColor}" /> <!-- Parabrisas -->
                    <rect x="5" y="22" width="8" height="4" fill="#fef08a" /> <!-- Luz Izq -->
                    <rect x="47" y="22" width="8" height="4" fill="#fef08a" /> <!-- Luz Der -->
                    ${isTaxi ? '<rect x="22" y="2" width="16" height="5" fill="#facc15" stroke="black" rx="1"/>' : ''}
                </svg>`;
            }
            
            // Plantilla: ESPALDA (Cola) - 0°
            if (view === 0) {
                return `
                <svg viewBox="0 0 60 40" width="60" height="40" ${baseStyle}>
                    <path d="M5 30 L55 30 L50 15 L10 15 Z" fill="${theme.side}" />
                    <path d="M10 25 L50 25 L45 5 L15 5 Z" fill="${theme.body}" />
                    <path d="M18 20 L42 20 L40 10 L20 10 Z" fill="${glassColor}" opacity="0.6"/> <!-- Luneta -->
                    <rect x="8" y="22" width="10" height="3" fill="#ef4444" /> <!-- Luz Roja Izq -->
                    <rect x="42" y="22" width="10" height="3" fill="#ef4444" /> <!-- Luz Roja Der -->
                </svg>`;
            }

            // Plantilla: DIAGONALES (45, 135, 225, 315)
            if ([45, 135, 225, 315].includes(view)) {
                const isFront = [135, 225].includes(view);
                const isLeft = [225, 315].includes(view);
                return `
                <svg viewBox="0 0 70 45" width="70" height="45" ${baseStyle} transform="${isLeft ? 'scale(-1, 1)' : ''}">
                    <path d="M5 35 L60 30 L55 15 L10 20 Z" fill="${theme.side}" /> <!-- Lateral Fugado -->
                    <path d="M10 20 L55 15 L45 5 L15 10 Z" fill="${theme.body}" /> <!-- Techo Fugado -->
                    <path d="${isFront ? 'M10 20 L25 10 L45 8 L50 15 Z' : 'M30 15 L50 12 L55 18 L35 22 Z'}" fill="${glassColor}" /> <!-- Parabrisas/Luneta -->
                    ${isFront ? '<rect x="5" y="25" width="6" height="4" fill="#fef08a" transform="skewY(-10)"/>' : '<rect x="50" y="20" width="6" height="3" fill="#ef4444"/>'}
                    ${isTaxi ? '<rect x="25" y="5" width="12" height="4" fill="#facc15" stroke="black" rx="1" transform="rotate(-5)"/>' : ''}
                </svg>`;
            }

            // Plantilla: PERFIL (Derecho/Izquierdo) - 90°/270°
            const isLeft = view === 270;
            return `
            <svg viewBox="0 0 80 40" width="80" height="40" ${baseStyle} transform="${isLeft ? 'scale(-1, 1)' : ''}">
                <path d="M5 30 L75 30 L70 15 L10 15 Z" fill="${theme.side}" /> <!-- Lateral -->
                <path d="M15 15 L65 15 L55 5 L20 5 Z" fill="${theme.body}" /> <!-- Techo/Cuerpo -->
                <path d="M25 15 L35 7 L55 7 L60 15 Z" fill="${glassColor}" /> <!-- Ventanas -->
                <circle cx="15" cy="30" r="6" fill="#111" /> <!-- Rueda del -->
                <circle cx="65" cy="30" r="6" fill="#111" /> <!-- Rueda tra -->
                ${isTaxi ? '<rect x="35" y="2" width="15" height="5" fill="#facc15" stroke="black" rx="1"/>' : ''}
            </svg>`;
        }

        const carSvg = generateDetailedCarSVG(viewAngle, theme, isTaxi);

        return `
            <div class="radar-car-container">
                <div class="radar-car-label ${statusClass}">${displayName}</div>
                <div class="radar-car-icon-wrapper ${statusClass}">
                    <div class="radar-car-internal">
                        ${carSvg}
                    </div>
                </div>
            </div>
        `;
    }

    function _updateMarker(driverId, data, shift, vehicle) {
        if (!_map || !data || !data.lat || !data.lng) return;

        // v119: Filtro de autorretrato - Ocultar mi propio marcador en el mapa
        const myId = typeof Auth !== 'undefined' ? (Auth.getUserId() || Auth.getUserName()) : null;
        if (driverId === myId) {
            _removeMarker(driverId);
            return false;
        }

        const lat = parseFloat(data.lat);
        const lng = parseFloat(data.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        const heading = data.heading || 0;
        const speed = data.speed || 0;
        const updatedAt = data.updated_at ? new Date(data.updated_at) : null;
        const timeAgoSecs = updatedAt ? Math.floor((Date.now() - updatedAt.getTime()) / 1000) : 99999;
        const timeAgo = updatedAt ? _timeAgo(updatedAt) : 'desconocido';

        let rawName = data.driverName || data.name || '';
        if (!rawName || rawName === driverId) {
            rawName = shift ? (shift.driverName || 'Chofer') : 'Chofer';
        }
        
        let firstName = rawName.split(' ')[0];
        // v116: Evitar mostrar UID largos "chorizos"
        if (firstName.length > 20) firstName = 'Chofer';

        const vehicleName = vehicle ? vehicle.name : 'V. no asignado';
        const vehiclePlate = vehicle ? vehicle.plate : 'N/P';
        
        // Formato final "Nombre - Patente"
        const displayName = `${firstName} - ${vehiclePlate}`;

        // v117 - Limpieza TOTAL de fantasmas
        if (timeAgoSecs > 60) {
            _removeMarker(driverId);
            return false; // Indicamos al caller que el chofer ya no está online
        }

        let carMode = (speed > 5) ? 'moving' : 'stopped';
        const statusClass = 'status-' + carMode;
        const shiftStatusText = shift ? (carMode === 'offline' ? 'Sin Señal GPS (Fantasma)' : (carMode === 'moving' ? 'En viaje' : 'Detenido')) : 'Sin turno activo';

        const batteryText = (data.battery !== undefined && data.battery !== null) ? `${data.battery}%` : 'N/A';

        const popupContent = `
            <div style="font-family:Inter,sans-serif; min-width:200px;">
                <div class="radar-popup-header">
                    <div class="radar-popup-avatar">👤</div>
                    <div>
                        <div class="radar-popup-title">${name}</div>
                        <div class="radar-popup-subtitle">${shift ? (shift.shiftType === 'day' ? '🌅 Turno Día' : '🌙 Turno Noche') : 'Off-Duty'}</div>
                    </div>
                </div>
                <div class="radar-popup-row">
                    <span><span class="radar-popup-icon">🚗</span> ${vehicleName}</span>
                </div>
                <div class="radar-popup-row">
                    <span><span class="radar-popup-icon">🏷️</span> Patente:</span>
                    <strong>${vehiclePlate}</strong>
                </div>
                <div class="radar-popup-row" style="margin-top:8px;">
                    <span><span class="radar-popup-icon">🚦</span> Estado:</span>
                    <strong style="color: ${carMode === 'moving' ? '#22c55e' : '#f59e0b'}">${shiftStatusText}</strong>
                </div>
                <div class="radar-popup-row">
                    <span><span class="radar-popup-icon">🏎️</span> Velocidad:</span>
                    <strong>${speed.toFixed(0)} km/h</strong>
                </div>
                <div class="radar-popup-row">
                    <span><span class="radar-popup-icon">🔋</span> Batería:</span>
                    <strong style="color: ${data.battery < 20 ? '#ef4444' : 'inherit'}">${batteryText}</strong>
                </div>
                <div class="radar-popup-row">
                    <span><span class="radar-popup-icon">🕐</span> Actividad:</span>
                    <span>${timeAgo}</span>
                </div>
            </div>
        `;

        const carColor = vehicle ? (vehicle.color || 'gray') : 'gray';

        const latlng = new google.maps.LatLng(lat, lng);
        const html = _createCarIcon(heading, displayName, statusClass, carColor);

        if (_markers[driverId]) {
            // Update existing marker
            _markers[driverId].setPosition(latlng);
            _markers[driverId].setHtml(html);
            _markers[driverId].setPopupContent(popupContent);
        } else {
            // Create new marker
            const MarkerClass = _getHTMLMapMarkerClass();
            const marker = new MarkerClass(latlng, html, popupContent);
            marker.setMap(_map);
            _markers[driverId] = marker;
        }

        return true; // Marcador vivo y renderizado
    }

    function _removeMarker(driverId) {
        if (_markers[driverId]) {
            _markers[driverId].setMap(null);
            delete _markers[driverId];
        }
    }

    function _timeAgo(date) {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 30) return 'ahora';
        if (seconds < 60) return `hace ${seconds}s`;
        if (seconds < 3600) return `hace ${Math.floor(seconds / 60)}min`;
        return `hace ${Math.floor(seconds / 3600)}h`;
    }

    // ============ FIREBASE LISTENER (ADMIN) ============

    // Reconectar Firebase cuando la app vuelve del background (Android Doze Mode fix)
    let _visibilityHandler = null;
    function _setupReconnectOnResume() {
        if (_visibilityHandler) return; // Ya registrado
        _visibilityHandler = () => {
            if (document.visibilityState === 'visible' && _isOpen) {
                console.log('[RADAR] App volvió al frente — reconectando Firebase...');
                _stopFirebaseListener();
                setTimeout(() => {
                    _startFirebaseListener();
                    _loadTrafficAlerts();
                }, 500);
            }
        };
        document.addEventListener('visibilitychange', _visibilityHandler);
        // También en pageshow (iOS Safari / Android WebView)
        window.addEventListener('pageshow', _visibilityHandler);
        window.addEventListener('focus', _visibilityHandler);
    }

    function _startFirebaseListener() {
        if (typeof firebaseDB === 'undefined') {
            _setStatus('error', 'Firebase no disponible');
            return;
        }

        // Activar auto-reconexión al volver del background
        _setupReconnectOnResume();

        _firebaseRef = firebaseDB.ref(DRIVER_POSITIONS_NODE);

        // Listen for all driver positions
        _firebaseRef.on('value', async (snap) => {
            const allPositions = snap.val();
            if (!allPositions) {
                _setStatus('idle', 'Sin choferes activos');
                _updateActiveCount(0);
                return;
            }

            // Fetch contextual fleet data
            const activeShifts = typeof DB !== 'undefined' ? await DB.getActiveShifts() : [];
            const allVehicles = typeof DB !== 'undefined' ? await DB.getAll('vehicles') : [];
            
            const vehiclesMap = {};
            for (const v of allVehicles) vehiclesMap[v.id] = v;

            const driverShiftMap = {};
            for (const s of activeShifts) driverShiftMap[s.driverId] = s;

            const driverIds = Object.keys(allPositions);
            let activeCount = 0;

            // Update/create markers
            for (const driverId of driverIds) {
                const data = allPositions[driverId];
                if (data && data.lat && data.lng) {
                    const shift = driverShiftMap[driverId];
                    const vehicle = shift ? vehiclesMap[shift.vehicleId] : null;
                    const isAlive = _updateMarker(driverId, data, shift, vehicle);
                    if (isAlive) {
                        activeCount++;
                    }
                }
            }

            // Remove markers for drivers that left
            for (const existingId of Object.keys(_markers)) {
                if (!allPositions[existingId]) {
                    _removeMarker(existingId);
                }
            }

            _updateActiveCount(activeCount);
            _setStatus('connected', `${activeCount} chofer${activeCount !== 1 ? 'es' : ''} en línea`);

            // Auto-fit bounds if markers exist
            if (activeCount > 0 && !_hasUserPanned) {
                _fitBounds();
            }
        });

        _setStatus('connected', 'Escuchando posiciones...');
    }

    let _hasUserPanned = false;

    function _fitBounds() {
        const positions = Object.values(_markers).map(m => m.getPosition());
        if (positions.length === 0) return;

        if (positions.length === 1) {
            _map.setCenter(positions[0]);
            _map.setZoom(15);
        } else {
            const bounds = new google.maps.LatLngBounds();
            positions.forEach(p => bounds.extend(p));
            _map.fitBounds(bounds);
        }

        // After first auto-fit, don't auto-fit again (let user pan freely)
        setTimeout(() => { _hasUserPanned = true; }, 2000);
    }

    function _stopFirebaseListener() {
        if (_firebaseRef) {
            _firebaseRef.off('value');
            _firebaseRef = null;
        }
    }

    // ============ TRAFFIC ALERTS LISTENER ============

    function _startAlertListener() {
        if (typeof firebaseDB === 'undefined' || typeof Auth === 'undefined') return;

        const fleetId = Auth.getFleetId();
        if (!fleetId) return;

        _alertRef = firebaseDB.ref(`fleets/${fleetId}/traffic_alerts`);

        _alertRef.on('value', (snap) => {
            const allAlerts = snap.val() || {};
            const alertIds = Object.keys(allAlerts);

            // 1. Update/Add alerts
            alertIds.forEach(id => {
                const alert = allAlerts[id];
                const now = Date.now();
                
                // Solo mostrar si no ha expirado
                if (alert.expiresAt > now && alert.status === 'active') {
                    _updateAlertMarker(id, alert);
                } else {
                    _removeAlertMarker(id);
                }
            });

            // 2. Remove deleted alerts
            Object.keys(_alertMarkers).forEach(id => {
                if (!allAlerts[id]) {
                    _removeAlertMarker(id);
                }
            });
        });
    }

    function _stopAlertListener() {
        if (_alertRef) {
            _alertRef.off('value');
            _alertRef = null;
        }
    }

    function _updateAlertMarker(id, data) {
        if (!_map) return;

        const lat = parseFloat(data.lat);
        const lng = parseFloat(data.lng);
        const type = data.type || 'warning'; // 'police' | 'radar' | 'traffic' | 'helicopter' | 'warning'
        
        const typeLabels = {
            police:     '👮 Control de Policía',
            checkpoint: '🚧 Operativo / Control',
            radar:      '📷 Radar / Cámara de Velocidad',
            helicopter: '🚁 Helicóptero Sanitario (HECA)',
            traffic:    '🚦 Alerta de Tráfico',
            warning:    '⚠️ Alerta'
        };
        const label = typeLabels[type] || typeLabels.warning;
        const description = data.description || '';

        const popupContent = `
            <div class="radar-alert-popup">
                <div class="alert-popup-header ${type}">
                    ${label}
                </div>
                <div class="alert-popup-body">
                    ${description ? `<p>${description}</p>` : ''}
                    <p><strong>Ubicación:</strong> ${data.location}</p>
                    <p><strong>Detectado:</strong> ${new Date(data.timestamp).toLocaleTimeString()}</p>
                    <p class="alert-expiry">Expira en: ${Math.round((data.expiresAt - Date.now()) / 60000)} min</p>
                </div>
                <div class="alert-popup-actions">
                    <button class="btn-confirm" onclick="RadarModule.confirmAlert('${id}')">👍 Sigue ahí</button>
                    <button class="btn-dismiss" onclick="RadarModule.dismissAlert('${id}')">👎 Ya no está</button>
                </div>
            </div>
        `;

        const latlng = { lat, lng };

        if (_alertMarkers[id]) {
            // Alerta existente: solo actualizar posición y popup
            _alertMarkers[id].marker.setPosition(latlng);
            _alertMarkers[id].infoWindow.setContent(popupContent);
        } else {
            // Alerta NUEVA: mostrar en mapa
            const iconUrl = _getAlertIconUrl(type);
            
            const marker = new google.maps.Marker({
                position: latlng,
                map: _map,
                icon: {
                    url: iconUrl,
                    scaledSize: new google.maps.Size(44, 44),
                    anchor: new google.maps.Point(22, 22)
                }
            });

            const infoWindow = new google.maps.InfoWindow({
                content: popupContent
            });

            marker.addListener('click', () => {
                if (window._activeInfoWindow) window._activeInfoWindow.close();
                infoWindow.open(_map, marker);
                window._activeInfoWindow = infoWindow;
            });

            _alertMarkers[id] = { marker, infoWindow };
            
            // Auto-enfocar el mapa en la nueva alerta con una animación suave
            if (_map) {
                _map.panTo(latlng);
                _map.setZoom(14);
            }
        }
    }

    function toggleVoice() {
        _voiceEnabled = !_voiceEnabled;
        localStorage.setItem('radarVoice', _voiceEnabled ? 'on' : 'off');
        const btn = document.getElementById('radarVoiceBtn');
        if (btn) btn.textContent = _voiceEnabled ? '🔊' : '🔇';
        
        // Confirmar con voz global si se activa
        if (_voiceEnabled && typeof TrafficAlerts !== 'undefined') {
            TrafficAlerts.speakAlert('warning', null);
        }
        console.log(`🔊 [VOZ] ${_voiceEnabled ? 'ACTIVADA' : 'DESACTIVADA'}`);
    }

    function _removeAlertMarker(id) {
        if (_alertMarkers[id]) {
            _alertMarkers[id].marker.setMap(null);
            delete _alertMarkers[id];
        }
    }

    function _getAlertIconUrl(type) {
        const iconMap = {
            police:     '/assets/alert-icons/police.png',
            checkpoint: '/assets/alert-icons/police.png',
            radar:      '/assets/alert-icons/radar.png',
            helicopter: '/assets/alert-icons/helicopter.png',
            ambulance:  '/assets/alert-icons/ambulance.png',
            firetruck:  '/assets/alert-icons/firetruck.png',
            municipal:  '/assets/alert-icons/municipal.png',
            accident:   '/assets/alert-icons/accident.png',
            traffic:    '/assets/alert-icons/accident.png',
            warning:    '/assets/alert-icons/accident.png',
        };
        return iconMap[type] || iconMap.warning;
    }

    // ============ FEEDBACK LOGIC ============

    async function confirmAlert(alertId) {
        const fleetId = Auth.getFleetId();
        if (!fleetId) return;

        try {
            const ref = firebaseDB.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`);
            await ref.transaction(current => {
                if (current) {
                    current.confirmations = (current.confirmations || 0) + 1;
                    // Extender vida 15 min si hay confirmación
                    current.expiresAt = Math.max(current.expiresAt, Date.now() + (15 * 60 * 1000));
                }
                return current;
            });
            if (typeof Components !== 'undefined') Components.showToast('¡Gracias por confirmar!', 'success');
        } catch(e) { console.error('Error confirming alert:', e); }
    }

    async function dismissAlert(alertId) {
        const fleetId = Auth.getFleetId();
        if (!fleetId) return;

        try {
            const ref = firebaseDB.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`);
            await ref.update({ status: 'dismissed' });
            if (typeof Components !== 'undefined') Components.showToast('Alerta marcada como inactiva', 'info');
        } catch(e) { console.error('Error dismissing alert:', e); }
    }

    // ============ UI HELPERS ============

    function _setStatus(type, text) {
        const el = document.getElementById('radarStatus');
        if (!el) return;
        const dotClass = type === 'connected' ? 'radar-status-dot--live' :
                         type === 'error' ? 'radar-status-dot--error' : '';
        el.innerHTML = `<span class="radar-status-dot ${dotClass}"></span> ${text}`;
    }

    function _updateActiveCount(count) {
        const el = document.getElementById('radarActiveCount');
        if (el) el.textContent = count;
    }

    // ============ TOGGLE MAP STYLE ============

    function toggleMapStyle() {
        if (!_map) return;
        
        _mapStyle = _mapStyle === 'dark' ? 'light' : 'dark';
        localStorage.setItem('radarMapStyle', _mapStyle);
        
        const activeStyle = _mapStyle === 'light' ? GOOGLE_MAP_LIGHT_STYLE : GOOGLE_MAP_DARK_STYLE;
        
        // Cambiar estilos suavemente sin recrear el mapa
        _map.setOptions({ styles: activeStyle });
        
        // Cambiar look del botón flotante
        const btn = document.getElementById('radarMapStyleBtn');
        if (btn) {
            btn.style.background = _mapStyle === 'light' ? '#333' : '#fff';
            btn.style.borderColor = _mapStyle === 'light' ? '#111' : 'rgba(0,0,0,0.2)';
            btn.style.boxShadow = _mapStyle === 'light' ? '0 3px 8px rgba(0,0,0,0.6)' : '0 3px 8px rgba(0,0,0,0.4)';
        }
    }

    // ============ PUBLIC API ============

    return {
        renderDashboardButton, open, close, confirmAlert, dismissAlert, toggleVoice, toggleMapStyle
    };
})();
