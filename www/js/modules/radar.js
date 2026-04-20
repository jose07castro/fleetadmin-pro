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
            'white': { body: '#ffffff', side: '#cbd5e1', roof: '#f8fafc', glass: '#94a3b8' },
            'black': { body: '#1e293b', side: '#0f172a', roof: '#334155', glass: '#64748b' },
            'taxi': { body: '#1e293b', side: '#0f172a', roof: '#facc15', glass: '#64748b' },
            'gray': { body: '#64748b', side: '#475569', roof: '#94a3b8', glass: '#cbd5e1' },
            'silver': { body: '#e2e8f0', side: '#94a3b8', roof: '#f1f5f9', glass: '#cbd5e1' },
            'red': { body: '#ef4444', side: '#b91c1c', roof: '#f87171', glass: '#fca5a5' },
            'blue': { body: '#3b82f6', side: '#1e40af', roof: '#60a5fa', glass: '#93c5fd' },
            'maroon': { body: '#991b1b', side: '#7f1d1d', roof: '#b91c1c', glass: '#fca5a5' }
        };

        const theme = colors[carColor] || colors['gray'];
        const isTaxi = carColor === 'taxi';

        // SVG Top-Down HD — Diseño Detallado (Capó, Baúl, Vidrios)
        const carSvg = `
            <svg viewBox="0 0 40 60" width="40" height="60" style="display:block; filter: drop-shadow(0 3px 5px rgba(0,0,0,0.4)); overflow:visible;">
                <!-- Carrocería Principal -->
                <path d="M10 5 C10 2, 30 2, 30 5 L35 15 L35 45 L30 55 C30 58, 10 58, 10 55 L5 45 L5 15 Z" fill="${theme.body}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
                
                <!-- Parabrisas Delantero -->
                <path d="M8 18 L32 18 L30 28 L10 28 Z" fill="${theme.glass || 'rgba(255,255,255,0.4)'}" opacity="0.7"/>
                
                <!-- Luneta Trasera -->
                <path d="M10 42 L30 42 L32 50 L8 50 Z" fill="${theme.glass || 'rgba(255,255,255,0.4)'}" opacity="0.6"/>
                
                <!-- Techo -->
                <rect x="10" y="28" width="20" height="14" fill="${theme.roof}" opacity="0.2"/>
                
                <!-- Retrovisores -->
                <rect x="1" y="20" width="4" height="2" rx="1" fill="${theme.side}"/>
                <rect x="35" y="20" width="4" height="2" rx="1" fill="${theme.side}"/>
                
                <!-- Líneas de Capó y Baúl -->
                <path d="M12 10 L28 10" stroke="rgba(0,0,0,0.2)" stroke-width="0.5"/>
                <path d="M12 52 L28 52" stroke="rgba(0,0,0,0.2)" stroke-width="0.5"/>
                
                <!-- Letrero TAXI (Solo color taxi) -->
                ${isTaxi ? `
                    <g transform="translate(10, 30)">
                        <rect width="20" height="10" fill="#facc15" stroke="black" stroke-width="1" rx="2"/>
                        <text x="10" y="7" font-size="6" font-family="Arial" font-weight="bold" fill="black" text-anchor="middle">TAXI</text>
                    </g>
                ` : ''}
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
