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
                <span class="radar-legend-item">🕐 Actualización: cada 20s</span>
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

        // If I'm a driver, start my own tracking
        if (typeof Auth !== 'undefined' && !Auth.isOwner()) {
            _startDriverTracking();
        }
    }

    // ============ CLOSE MAP ============

    function close() {
        _isOpen = false;

        // Stop Firebase listener
        _stopFirebaseListener();

        // Stop driver tracking
        _stopDriverTracking();

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

        // Dark-themed tile layer (CartoDB Dark Matter)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            subdomains: 'abcd'
        }).addTo(_map);

        // Attribution
        L.control.attribution({
            prefix: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> | CartoDB'
        }).addTo(_map);

        // Fix map sizing
        setTimeout(() => {
            _map.invalidateSize();
        }, 100);
    }

    // ============ CREATE CAR MARKER ============

    function _createCarIcon(heading) {
        const rotation = heading || 0;
        return L.divIcon({
            className: 'radar-car-marker',
            html: `<div class="radar-car-icon" style="transform: rotate(${rotation}deg);">🚗</div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20],
            popupAnchor: [0, -20]
        });
    }

    function _updateMarker(driverId, data) {
        if (!_map || !data || !data.lat || !data.lng) return;

        const lat = parseFloat(data.lat);
        const lng = parseFloat(data.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        const heading = data.heading || 0;
        const speed = data.speed || 0;
        const name = data.driverName || data.name || driverId;
        const updatedAt = data.updated_at ? new Date(data.updated_at) : null;
        const timeAgo = updatedAt ? _timeAgo(updatedAt) : 'desconocido';

        const popupContent = `
            <div style="font-family:Inter,sans-serif; min-width:150px;">
                <div style="font-weight:700; font-size:14px; margin-bottom:4px;">🚗 ${name}</div>
                <div style="font-size:12px; color:#666; margin-bottom:2px;">📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
                <div style="font-size:12px; color:#666; margin-bottom:2px;">🏎️ ${speed.toFixed(0)} km/h</div>
                <div style="font-size:11px; color:#999;">🕐 ${timeAgo}</div>
            </div>
        `;

        if (_markers[driverId]) {
            // Update existing marker
            _markers[driverId].setLatLng([lat, lng]);
            _markers[driverId].setIcon(_createCarIcon(heading));
            _markers[driverId].getPopup().setContent(popupContent);
        } else {
            // Create new marker
            const marker = L.marker([lat, lng], {
                icon: _createCarIcon(heading)
            }).addTo(_map);
            marker.bindPopup(popupContent);
            _markers[driverId] = marker;
        }
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
        _firebaseRef.on('value', (snap) => {
            const allPositions = snap.val();
            if (!allPositions) {
                _setStatus('idle', 'Sin choferes activos');
                _updateActiveCount(0);
                return;
            }

            const driverIds = Object.keys(allPositions);
            let activeCount = 0;

            // Update/create markers
            for (const driverId of driverIds) {
                const data = allPositions[driverId];
                if (data && data.lat && data.lng) {
                    _updateMarker(driverId, data);
                    activeCount++;
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

    // ============ DRIVER TRACKING (MOBILE) ============

    function _startDriverTracking() {
        if (!navigator.geolocation) {
            console.warn('📡 Radar: Geolocation no soportada');
            return;
        }

        const userId = Auth.getUserId() || Auth.getUserName();
        if (!userId) return;

        console.log('📡 Radar: Iniciando tracking GPS para', userId);

        // Immediate position
        _sendPosition(userId);

        // Update every 20 seconds
        _trackingInterval = setInterval(() => _sendPosition(userId), UPDATE_INTERVAL_MS);

        // Watch for continuous updates
        try {
            _watchId = navigator.geolocation.watchPosition(
                (pos) => {
                    // Silently cache — actual Firebase writes happen on interval
                    _lastPosition = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        heading: pos.coords.heading || 0,
                        speed: (pos.coords.speed || 0) * 3.6 // m/s → km/h
                    };
                },
                (err) => console.warn('📡 Radar: watchPosition error:', err.message),
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
            );
        } catch (e) {
            console.warn('📡 Radar: watchPosition no disponible');
        }
    }

    let _lastPosition = null;

    async function _sendPosition(userId) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    (p) => resolve({
                        lat: p.coords.latitude,
                        lng: p.coords.longitude,
                        heading: p.coords.heading || 0,
                        speed: (p.coords.speed || 0) * 3.6
                    }),
                    (e) => reject(e),
                    { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
                );
            });

            _lastPosition = pos;

            if (typeof firebaseDB !== 'undefined') {
                await firebaseDB.ref(`${DRIVER_POSITIONS_NODE}/${userId}`).set({
                    lat: pos.lat,
                    lng: pos.lng,
                    heading: pos.heading,
                    speed: pos.speed,
                    driverName: Auth.getUserName() || userId,
                    updated_at: new Date().toISOString()
                });
            }

            console.log('📡 Radar: Posición enviada:', pos.lat.toFixed(4), pos.lng.toFixed(4), 
                         '| heading:', pos.heading.toFixed(0), '| speed:', pos.speed.toFixed(0));
        } catch (e) {
            // Use cached position if available
            if (_lastPosition && typeof firebaseDB !== 'undefined') {
                await firebaseDB.ref(`${DRIVER_POSITIONS_NODE}/${userId}`).update({
                    updated_at: new Date().toISOString()
                });
            }
            console.warn('📡 Radar: Error GPS:', e.message || e);
        }
    }

    function _stopDriverTracking() {
        if (_watchId !== null) {
            navigator.geolocation.clearWatch(_watchId);
            _watchId = null;
        }
        if (_trackingInterval) {
            clearInterval(_trackingInterval);
            _trackingInterval = null;
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
