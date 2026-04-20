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
    let _markers = {};       // { driverId: L.marker }
    let _firebaseRef = null;
    let _isOpen = false;
    let _trackingInterval = null;
    let _watchId = null;

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
                    <button class="radar-close-btn" id="radarCloseBtn" onclick="RadarModule.close()" title="Cerrar mapa">
                        ✕ Salir
                    </button>
                </div>
            </div>
            <div id="radarMap" class="radar-map"></div>
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
    }

    // ============ CLOSE MAP ============

    function close() {
        _isOpen = false;

        // Stop Firebase listener
        _stopFirebaseListener();

        // Destroy map
        if (_map) {
            _map.remove();
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

    // ============ LEAFLET MAP INIT ============

    function _initMap() {
        // Default center: Rosario, Argentina (approximate fleet location)
        const defaultLat = -33.0232;
        const defaultLng = -60.6389;

        _map = L.map('radarMap', {
            center: [defaultLat, defaultLng],
            zoom: 13,
            zoomControl: true,
            attributionControl: false
        });

        // v120: Mapa a full color y alta resolución (Standard Streets / OpenStreetMap)
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            detectRetina: true, // Alta definición para pantallas S25 Ultra / iPhone / Web
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(_map);


        // Fix map sizing
        setTimeout(() => {
            _map.invalidateSize();
        }, 100);
    }

    // ============ CREATE CAR MARKER ============

    function _createCarIcon(heading, displayName, statusClass, carColor) {
        const rotation = heading || 0;
        
        // Mapeo de colores técnicos para SVG (Versión HD 3D)
        const colors = {
            'white': { body: '#ffffff', side: '#e5e7eb', roof: '#f9fafb' },
            'black': { body: '#18181b', side: '#09090b', roof: '#27272a' },
            'taxi': { body: '#18181b', side: '#09090b', roof: '#facc15' },
            'gray': { body: '#52525b', side: '#3f3f46', roof: '#71717a' },
            'silver': { body: '#a1a1aa', side: '#71717a', roof: '#d4d4d8' },
            'red': { body: '#dc2626', side: '#991b1b', roof: '#ef4444' },
            'blue': { body: '#2563eb', side: '#1e40af', roof: '#3b82f6' },
            'maroon': { body: '#7f1d1d', side: '#450a0a', roof: '#991b1b' }
        };

        const theme = colors[carColor] || colors['gray'];
        const isTaxi = carColor === 'taxi';

        // SVG Isométrico (Vista 3/4) - Perspectiva desde arriba y costado
        const carSvg = `
            <svg viewBox="0 0 100 100" width="50" height="50" style="display:block; filter: drop-shadow(2px 4px 3px rgba(0,0,0,0.4));">
                <g transform="translate(10, 10) scale(0.8)">
                    <!-- Chasis - Parte Lateral (Sombra/Profundidad) -->
                    <path d="M20 40 L20 70 L80 80 L80 50 Z" fill="${theme.side}" />
                    
                    <!-- Carrocería Principal (Frente y Capó) -->
                    <path d="M20 40 L50 30 L90 40 L80 50 L50 45 Z" fill="${theme.body}" />
                    
                    <!-- Techo (Visto desde arriba) -->
                    <path d="M35 35 L60 25 L85 35 L75 50 L45 48 Z" fill="${theme.roof}" stroke="rgba(0,0,0,0.1)" />
                    
                    <!-- Cristales con Brillo (Shimmer) -->
                    <path d="M40 36 L55 30 L60 38 L42 42 Z" fill="rgba(255,255,255,0.3)">
                        <animate attributeName="opacity" values="0.3;0.6;0.3" dur="3s" repeatCount="indefinite" />
                    </path>
                    <path d="M65 32 L82 38 L75 48 L62 42 Z" fill="rgba(255,255,255,0.2)" />
                    
                    <!-- Luces Delanteras -->
                    <ellipse cx="25" cy="42" rx="4" ry="2" fill="#fef9c3" />
                    <ellipse cx="85" cy="45" rx="4" ry="2" fill="#fef9c3" />
                    
                    <!-- Retrovisor -->
                    <rect x="35" y="30" width="4" height="2" fill="${theme.body}" transform="rotate(-15)" />
                    
                    <!-- Letrero TAXI -->
                    ${isTaxi ? `
                        <g transform="translate(50, 32) rotate(-5)">
                            <rect x="-10" y="-8" width="20" height="8" fill="#facc15" stroke="black" stroke-width="1" rx="1" />
                            <text x="0" y="-2" font-size="5" font-family="Arial, sans-serif" font-weight="bold" fill="black" text-anchor="middle">TAXI</text>
                        </g>
                    ` : ''}
                </g>
            </svg>
        `;

        return L.divIcon({
            className: 'radar-car-marker',
            html: `
                <div class="radar-car-container">
                    <div class="radar-car-label ${statusClass}">${displayName}</div>
                    <div class="radar-car-icon-wrapper ${statusClass}" style="transform: rotate(${rotation}deg);">
                        <div class="radar-car-internal">
                            ${carSvg}
                        </div>
                    </div>
                </div>
            `,
            iconSize: [60, 60],
            iconAnchor: [30, 30],
            popupAnchor: [0, -30]
        });
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

        if (_markers[driverId]) {
            // Update existing marker
            _markers[driverId].setLatLng([lat, lng]);
            _markers[driverId].setIcon(_createCarIcon(heading, displayName, statusClass, carColor));
            _markers[driverId].getPopup().setContent(popupContent);
        } else {
            // Create new marker
            const marker = L.marker([lat, lng], {
                icon: _createCarIcon(heading, displayName, statusClass, carColor)
            }).addTo(_map);
            marker.bindPopup(popupContent);
            _markers[driverId] = marker;
        }

        return true; // Marcador vivo y renderizado
    }

    function _removeMarker(driverId) {
        if (_markers[driverId]) {
            _map.removeLayer(_markers[driverId]);
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

    function _startFirebaseListener() {
        if (typeof firebaseDB === 'undefined') {
            _setStatus('error', 'Firebase no disponible');
            return;
        }

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
        const positions = Object.values(_markers).map(m => m.getLatLng());
        if (positions.length === 0) return;

        if (positions.length === 1) {
            _map.setView(positions[0], 15);
        } else {
            const bounds = L.latLngBounds(positions);
            _map.fitBounds(bounds, { padding: [50, 50] });
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

    // ============ PUBLIC API ============

    return {
        renderDashboardButton, open, close
    };
})();
