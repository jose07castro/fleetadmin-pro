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
    let _showCameras = localStorage.getItem('radarShowCameras') !== 'off'; // ON por defecto (Fotomultas)
    let _cameraMarkers = [];

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
            constructor(latlng, html, popupHtml, offsetX = 30, offsetY = 40) {
                super();
                this.latlng = latlng;
                this.html = html;
                this.popupHtml = popupHtml;
                this.offsetX = offsetX;
                this.offsetY = offsetY;
                this.div = null;
                this.isUpdatingPosition = false;
            }
            onAdd() {
                this.div = document.createElement('div');
                this.div.style.position = 'absolute';
                this.div.style.cursor = 'pointer';
                this.div.style.zIndex = '10';
                this.div.style.transition = 'none'; // v166: Sin transición por defecto para evitar rezago en drag/zoom
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
                    if (this.isUpdatingPosition) {
                        this.div.style.transition = 'left 2s linear, top 2s linear'; // Solo al cambiar posición de GPS
                    } else {
                        this.div.style.transition = 'none'; // Instantáneo al arrastrar/hacer zoom el mapa
                    }
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
                this.isUpdatingPosition = true;
                this.draw();
                // Limpiar el flag después de que inicie la transición
                setTimeout(() => {
                    this.isUpdatingPosition = false;
                }, 100);
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
            <style>
                .gm-style-pbc, div.gm-style-pbc, div[class*="gm-style-pbc"] {
                    display: none !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                    visibility: hidden !important;
                }
                .gm-err-container, .gm-err-content, .gm-err-icon, .gm-err-title, .gm-err-message, .gm-err-autocomplete, div[class*="gm-err"] {
                    display: none !important;
                    opacity: 0 !important;
                    visibility: hidden !important;
                    pointer-events: none !important;
                }
                #radarMap div:has(> .gm-err-container),
                #radarMap div:has(> .gm-err-content),
                #radarMap div:has(> button.dismissButton) {
                    display: none !important;
                }
                #radarMap button.dismissButton {
                    display: none !important;
                }
            </style>
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
                    <button class="radar-test-btn" id="radarTestBtn"
                        onclick="RadarModule.testAlerts()"
                        title="Probar advertencia HUD, Chime y Voz">
                        🔔 Probar
                    </button>
                    <button class="radar-cameras-btn" id="radarCamerasBtn"
                        onclick="RadarModule.toggleCameras()"
                        title="Mostrar u ocultar fotomultas en el mapa"
                        style="background:${_showCameras ? 'rgba(239, 68, 68, 0.28)' : 'rgba(255,255,255,0.1)'};border-color:${_showCameras ? '#ef4444' : 'rgba(255,255,255,0.2)'};">
                        📷 Cámaras (80)
                    </button>
                    <div class="radar-volume-box" id="radarVolumeBox" title="Volumen independiente de alertas">
                        <button class="radar-voice-btn" id="radarVoiceBtn"
                            onclick="RadarModule.toggleVoice()"
                            title="Activar/desactivar voz">
                            ${_voiceEnabled ? '🔊' : '🔇'}
                        </button>
                        <input type="range" min="10" max="100" step="5" value="${localStorage.getItem('radarVolumePercent') || 85}"
                            id="radarVolSlider" class="radar-vol-slider" title="Volumen independiente de alertas"
                            oninput="if(typeof CopilotModule!=='undefined'&&CopilotModule.setVolume)CopilotModule.setVolume(this.value);" />
                        <span id="radarVolLabel" style="font-size:10px;font-weight:700;color:#38bdf8;min-width:24px;text-align:right;">${localStorage.getItem('radarVolumePercent') || 85}%</span>
                    </div>
                </div>
                <button class="radar-close-btn" id="radarCloseBtn" onclick="RadarModule.close()" title="Cerrar mapa">
                    ✕ Salir
                </button>
            </div>
            <div id="radarMap" class="radar-map"></div>
            <div class="radar-warning-container" id="radarWarningContainer" style="position:absolute; top: 92px; left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; flex-direction: column; gap: 8px; width: 90%; max-width: 400px; pointer-events: none;"></div>
            <!-- Controles flotantes elevados del mapa (Zoom + / - y Estilo Satelital) -->
            <div class="radar-floating-controls" style="position:absolute; bottom: 80px; right: 14px; z-index: 1000; display: flex; flex-direction: column; gap: 8px;">
                <button id="radarZoomInBtn" onclick="RadarModule.zoomIn()" title="Acercar mapa (+)" 
                    style="background: #1e293b; color: #f8fafc; border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; width: 40px; height: 40px; font-size: 22px; font-weight: bold; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.5); user-select: none;">
                    +
                </button>
                <button id="radarZoomOutBtn" onclick="RadarModule.zoomOut()" title="Alejar mapa (-)" 
                    style="background: #1e293b; color: #f8fafc; border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; width: 40px; height: 40px; font-size: 22px; font-weight: bold; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.5); user-select: none;">
                    −
                </button>
                <button id="radarMapStyleBtn" onclick="RadarModule.toggleMapStyle()" title="Cambiar Vista del Mapa" 
                    style="background: white; color: #333; border: 2px solid rgba(0,0,0,0.2); border-radius: 8px; width: 40px; height: 40px; font-size: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.4); font-weight: bold; user-select: none;">
                    🗺️
                </button>
            </div>
            <div class="radar-legend" id="radarLegend">
                <span class="radar-legend-item">🚗 Choferes activos: <strong id="radarActiveCount">0</strong></span>
                <span class="radar-legend-item">📷 Fotomultas: <strong id="radarCameraCount">80 oficiales</strong></span>
                <span class="radar-legend-item">🕐 Actualización: <strong>Tiempo real (2s)</strong></span>
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

    let _suppressInterval = null;
    let _suppressObserver = null;
    function _suppressGoogleOverlays() {
        const clean = () => {
            // 1. Quitar capa de desarrollo y marca de agua 'For development purposes only'
            const pbcElements = document.querySelectorAll('.gm-style-pbc, [class*="gm-style-pbc"]');
            pbcElements.forEach(el => {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('opacity', '0', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
            });

            // 2. Ocultar carteles de error nativos de Google Maps
            const errElements = document.querySelectorAll('.gm-err-container, .gm-err-content, [class*="gm-err"]');
            errElements.forEach(el => {
                el.style.setProperty('display', 'none', 'important');
                el.style.setProperty('visibility', 'hidden', 'important');
                el.style.setProperty('pointer-events', 'none', 'important');
                const modalWrapper = el.closest('div[style*="position: absolute"]');
                if (modalWrapper && modalWrapper !== document.getElementById('radarMap') && modalWrapper !== document.body) {
                    modalWrapper.style.setProperty('display', 'none', 'important');
                }
            });

            // 3. Buscar y silenciar modales con texto 'Esta página no puede cargar Google Maps' o 'propietario'
            const candidates = document.querySelectorAll('#radarMap div, #radarMap dialog, body > div[style*="z-index"]');
            candidates.forEach(node => {
                const txt = node.textContent || node.innerText || '';
                if (txt.includes('Esta página no puede cargar Google Maps') ||
                    txt.includes("This page can't load Google Maps") ||
                    txt.includes('¿Eres el propietario de este sitio web?')) {
                    const btn = node.querySelector('button');
                    if (btn) {
                        try { btn.click(); } catch (e) {}
                    }
                    node.style.setProperty('display', 'none', 'important');
                    node.style.setProperty('visibility', 'hidden', 'important');
                    node.style.setProperty('pointer-events', 'none', 'important');
                }
            });
        };

        clean();
        if (_suppressInterval) clearInterval(_suppressInterval);
        _suppressInterval = setInterval(clean, 300);

        const mapEl = document.getElementById('radarMap');
        if (mapEl && window.MutationObserver) {
            if (_suppressObserver) _suppressObserver.disconnect();
            _suppressObserver = new MutationObserver(() => clean());
            _suppressObserver.observe(mapEl, { childList: true, subtree: true });
            _suppressObserver.observe(document.body, { childList: true });
        }
    }

    function close() {
        _isOpen = false;

        // Limpiar supresor de Google
        if (_suppressInterval) {
            clearInterval(_suppressInterval);
            _suppressInterval = null;
        }
        if (_suppressObserver) {
            _suppressObserver.disconnect();
            _suppressObserver = null;
        }

        // Stop Firebase listener
        _stopFirebaseListener();
        _stopAlertListener();

        // Destroy map
        _clearCameraMarkers();
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
            zoomControl: false, // Reemplazado por botones flotantes elevados (+ / -) para que nunca queden tapados por carteles o el pie
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false
        });

        // Supresión continua de marcas de agua 'For development purposes only' y carteles de error
        _suppressGoogleOverlays();

        // Cargar pines de cámaras de fotomultas oficiales de Rosario
        _renderCameraMarkers();
    }

    // ============ CREATE CAR MARKER ============

    function _createCarIcon(heading, displayName, statusClass, carColor, speed, status, driverId) {
        const rotation = heading || 0;
        const currentSpeed = speed || 0;
        
        let speedText = `${currentSpeed.toFixed(0)} km/h`;
        if (status === 'logout_voluntario') {
            speedText = 'OFFLINE';
        } else if (status === 'suspicious_disconnect') {
            speedText = 'SIN SEÑAL';
        } else if (status === 'gps_desactivado') {
            speedText = 'GPS APAGADO';
        } else if (status === 'offline') {
            speedText = 'SIN SEÑAL';
        }
        
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

        const carColorKey = (status === 'logout_voluntario' ? 'gray' : (carColor || 'gray')).toLowerCase();
        const theme = colors[carColorKey] || colors['gray'];
        const isTaxi = carColorKey === 'taxi';

        // v120: Diseño Top-Down Super Moderno (Premium "4k" feel)
        // Rotación continua 360 grados, sombras dinámicas y gradientes.
        // v126: Diseño Top-Down Super Moderno con Luces Nocturnas Automáticas
        // v127 FIX: IDs de gradientes únicos por conductor para evitar conflictos DOM
        function generateDetailedCarSVG(heading, theme, isTaxi, uid) {
            const baseStyle = `style="display:block; filter: drop-shadow(0 6px 12px rgba(0,0,0,0.5)); transform: rotate(${heading}deg); transform-origin: center center; transition: transform 0.6s cubic-bezier(0.4, 0, 0.2, 1); margin: -10px;"`;
            
            // IDs únicos por marcador para evitar que se pisen entre conductores
            const safeUid = (uid || 'default').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 16);
            const bodyGradId = `bodyGrad_${safeUid}`;
            const glassGradId = `glassGrad_${safeUid}`;
            const hlBeamId = `hlBeam_${safeUid}`;
            const tlBeamId = `tlBeam_${safeUid}`;
            
            // Determinar si es de noche (v126: 19:00 a 07:00)
            const hours = new Date().getHours();
            const isNight = hours >= 19 || hours < 7;
            
            return `
            <svg viewBox="0 0 60 110" width="25" height="45" ${baseStyle}>
                <defs>
                    <linearGradient id="${bodyGradId}" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stop-color="${theme.side}" />
                        <stop offset="25%" stop-color="${theme.body}" />
                        <stop offset="75%" stop-color="${theme.body}" />
                        <stop offset="100%" stop-color="${theme.side}" />
                    </linearGradient>
                    <linearGradient id="${glassGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#020617" />
                        <stop offset="50%" stop-color="#1e293b" />
                        <stop offset="100%" stop-color="#020617" />
                    </linearGradient>
                    <!-- Gradientes para proyección de luces -->
                    <radialGradient id="${hlBeamId}" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stop-color="rgba(255,255,255,0.4)" />
                        <stop offset="100%" stop-color="rgba(255,255,255,0)" />
                    </radialGradient>
                    <radialGradient id="${tlBeamId}" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stop-color="rgba(239,68,68,0.3)" />
                        <stop offset="100%" stop-color="rgba(239,68,68,0)" />
                    </radialGradient>
                </defs>
                
                <!-- PROYECCIÓN DE LUCES (Solo de noche) -->
                ${isNight ? `
                    <!-- Haz de luz delantera izquierda -->
                    <path d="M 15 15 L -10 -40 L 30 -40 Z" fill="url(#${hlBeamId})" filter="blur(5px)" />
                    <!-- Haz de luz delantera derecha -->
                    <path d="M 45 15 L 70 -40 L 30 -40 Z" fill="url(#${hlBeamId})" filter="blur(5px)" />
                    <!-- Brillo luces traseras -->
                    <circle cx="30" cy="100" r="25" fill="url(#${tlBeamId})" filter="blur(8px)" />
                ` : ''}

                <!-- Sombra base aerodinámica -->
                <path d="M 12 10 Q 30 -5 48 10 L 52 90 Q 30 115 8 90 Z" fill="rgba(0,0,0,0.4)" filter="blur(3px)" />

                <!-- Carrocería -->
                <path d="M 14 12 Q 30 -2 46 12 L 50 92 Q 30 110 10 92 Z" fill="url(#${bodyGradId})" stroke="rgba(255,255,255,0.15)" stroke-width="1.5"/>

                <!-- Parabrisas y Techo -->
                <path d="M 18 30 Q 30 20 42 30 L 44 70 Q 30 80 16 70 Z" fill="url(#${glassGradId})" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
                
                <!-- Reflejo curvo -->
                <path d="M 22 32 Q 30 26 38 32 L 36 66 Q 30 72 24 66 Z" fill="rgba(255,255,255,0.04)" />

                <!-- Espejos -->
                <path d="M 15 32 Q 6 30 4 36 Q 8 40 14 37 Z" fill="${theme.body}" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>
                <path d="M 45 32 Q 54 30 56 36 Q 52 40 46 37 Z" fill="${theme.body}" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/>

                <!-- Faros Delanteros -->
                <path d="M 15 15 L 23 11 L 21 16 Z" fill="#ffffff" filter="drop-shadow(0 -3px ${isNight ? '12px' : '6px'} rgba(255,255,255,${isNight ? '1' : '0.6'}))" />
                <path d="M 45 15 L 37 11 L 39 16 Z" fill="#ffffff" filter="drop-shadow(0 -3px ${isNight ? '12px' : '6px'} rgba(255,255,255,${isNight ? '1' : '0.6'}))" />

                <!-- Parrilla -->
                <path d="M 24 10 Q 30 12 36 10 L 34 13 Q 30 14 26 13 Z" fill="#000" />

                <!-- Luces Traseras -->
                <path d="M 12 91 Q 30 96 48 91 L 46 89 Q 30 93 14 89 Z" fill="#ef4444" filter="drop-shadow(0 4px ${isNight ? '15px' : '8px'} rgba(239,68,68,${isNight ? '1' : '0.7'}))" />

                <!-- Señal de Taxi -->
                ${isTaxi ? '<g filter="drop-shadow(0 0 4px rgba(250,204,21,0.6))"><rect x="22" y="44" width="16" height="8" rx="2" fill="#facc15" stroke="#111" stroke-width="1.5"/><text x="30" y="50" font-family="sans-serif" font-size="5" fill="#111" text-anchor="middle" font-weight="bold">TAXI</text></g>' : ''}
            </svg>`;
        }

        const carSvg = generateDetailedCarSVG(rotation, theme, isTaxi, driverId);

        return `
            <div class="radar-car-container">
                <div class="radar-car-label ${statusClass}">
                    <div class="radar-car-info">${displayName}</div>
                    <div class="radar-car-speed">${speedText}</div>
                </div>
                <div class="radar-car-icon-wrapper ${statusClass}">
                    <div class="radar-car-internal">
                        ${carSvg}
                    </div>
                </div>
            </div>
        `;
    }

    async function _updateMarker(driverId, data, shift, vehicle) {
        if (!_map || !data || !data.lat || !data.lng) return null;

        // v119: Filtro de autorretrato - Ocultar mi propio marcador en el mapa SOLO si soy conductor sin turno
        // Un administrador/dueño SIEMPRE debe ver toda su flota en el mapa.
        const isOwnerOrAdmin = typeof Auth !== 'undefined' && (Auth.getRole() === 'owner' || Auth.getRole() === 'titular');
        if (!isOwnerOrAdmin && !shift) {
            const myId = typeof Auth !== 'undefined' ? (Auth.getUserId() || Auth.getUserName()) : null;
            if (driverId === myId) {
                _removeMarker(driverId);
                return null;
            }
        }

        const lat = parseFloat(data.lat);
        const lng = parseFloat(data.lng);
        if (isNaN(lat) || isNaN(lng)) return null;

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
        
        // Formato final limpio "Nombre - Patente"
        let displayName = `${firstName} - ${vehiclePlate}`;

        // CRÍTICO: Si el chofer tiene turno activo (shift != null), NUNCA se elimina del mapa.
        // Se mantiene visible con su última ubicación para que el dueño sepa dónde está el auto.
        const hasActiveShift = !!shift;

        if (!hasActiveShift) {
            // Choferes sin turno: limpieza de fantasmas antiguos
            let maxSilenceSecs = 60;
            if (data.status === 'suspicious_disconnect') {
                maxSilenceSecs = 600; // 10 minutos
            } else if (data.status === 'logout_voluntario') {
                maxSilenceSecs = 300; // 5 minutos
            } else if (data.status === 'gps_desactivado') {
                maxSilenceSecs = 600; // 10 minutos
            } else if (data.status === 'permissions_disabled') {
                maxSilenceSecs = 600; // 10 minutos
            } else if (data.status === 'app_killed') {
                maxSilenceSecs = 900; // 15 minutos
            }

            if (timeAgoSecs > maxSilenceSecs) {
                _removeMarker(driverId);
                return null;
            }
        }

        // Si el chofer está enviando GPS fresco (últimos 90s), reflejar su estado real de movimiento
        const isFresh = timeAgoSecs <= 90;
        let carMode = (speed > 5) ? 'moving' : 'stopped';
        let effectiveStatus = data.status || 'active';

        // Auto-sanar choferes que volvieron a reportar ubicación pero tenían el status bloqueado en sospechoso
        if (isFresh && (effectiveStatus === 'suspicious_disconnect' || effectiveStatus === 'gps_desactivado')) {
            effectiveStatus = 'active';
            if (typeof DB !== 'undefined' && DB.getRef) {
                try {
                    DB.getRef(`driver_positions/${driverId}`).update({ status: 'active', last_heartbeat_gap: null });
                } catch (e) {}
            }
        }

        if (!isFresh && hasActiveShift) {
            // En turno pero sin señal en tiempo real (más de 90s)
            carMode = 'offline';
            if (effectiveStatus === 'active') {
                effectiveStatus = 'offline';
            }
        } else if (effectiveStatus === 'logout_voluntario') {
            carMode = 'logout';
        } else if (effectiveStatus === 'app_killed') {
            carMode = 'app-killed';
        } else if (effectiveStatus === 'suspicious_disconnect') {
            carMode = 'suspicious';
        } else if (effectiveStatus === 'gps_desactivado') {
            carMode = 'gps-disabled';
        } else if (timeAgoSecs > 60 && (effectiveStatus === 'permissions_disabled' || data.permissions_ok === false)) {
            // Solo marcar permissions-disabled si además dejó de enviar GPS fresco
            carMode = 'permissions-disabled';
        }
        const statusClass = 'status-' + carMode;
        
        let shiftStatusText = shift ? (carMode === 'offline' ? `En turno (Sin señal ${timeAgo})` : (carMode === 'moving' ? 'En viaje' : 'Detenido')) : 'Sin turno activo';
        let statusLabelText = shiftStatusText;
        let statusColor = '#f59e0b';
        if (carMode === 'offline') {
            statusLabelText = `En turno (Sin señal ${timeAgo})`;
            statusColor = '#94a3b8'; // Gris o tenue
        } else if (effectiveStatus === 'logout_voluntario') {
            statusLabelText = 'Desconectado (Sesión Cerrada)';
            statusColor = '#94a3b8'; // Gris
        } else if (effectiveStatus === 'app_killed') {
            statusLabelText = '🚨 APP CERRADA MANUALMENTE';
            statusColor = '#dc2626'; // Rojo intenso
        } else if (effectiveStatus === 'suspicious_disconnect') {
            statusLabelText = `Desconexión Sospechosa (Últ. señal ${timeAgo})`;
            statusColor = '#ef4444'; // Rojo
        } else if (effectiveStatus === 'gps_desactivado') {
            statusLabelText = 'GPS Desactivado por el Conductor';
            statusColor = '#f97316'; // Naranja
        } else if (carMode === 'permissions-disabled') {
            statusLabelText = 'Permisos de segundo plano / Batería desactivados';
            statusColor = '#f97316'; // Naranja
        } else if (carMode === 'moving') {
            statusColor = '#22c55e'; // Verde
        }

        const batteryText = (data.battery !== undefined && data.battery !== null) ? `${data.battery}%` : 'N/A';

        const appVersion = data.appVersion || 'Desconocida';
        let versionStyle = 'color: #94a3b8;'; // default gray
        
        if (appVersion !== 'Desconocida') {
            const verClean = appVersion.replace('v', '').trim();
            const parts = verClean.split('.').map(Number);
            const major = parts[0] || 0;
            const minor = parts[1] || 0;
            const patch = parts[2] || 0;
            
            let isOld = false;
            let isVeryOld = false;
            
            if (major < 1) {
                isVeryOld = true;
            } else if (major === 1) {
                if (minor < 2) {
                    isVeryOld = true;
                } else if (minor === 2) {
                    if (patch < 38) {
                        isOld = true;
                    }
                    if (patch < 30) {
                        isVeryOld = true;
                    }
                }
            }
            
            if (isVeryOld) {
                versionStyle = 'color: #ef4444; font-weight: bold;';
            } else if (isOld) {
                versionStyle = 'color: #eab308; font-weight: bold;';
            } else {
                versionStyle = 'color: #10b981; font-weight: bold;';
            }
        }

        let maintenanceHtml = '';
        if (vehicle && typeof Alerts !== 'undefined' && typeof Units !== 'undefined') {
            try {
                const belt = await Alerts.getBeltStatus(vehicle);
                const oil = Alerts.getOilChangeStatus(vehicle);
                
                const alerts = [];
                // Alertas de Mantenimiento (Timing Belt) alert check
                if (belt && (belt.level === 'danger' || belt.level === 'warning')) {
                    const isDanger = belt.level === 'danger';
                    const label = isDanger ? '🔴 Correa Vencida' : '🟡 Correa Próxima';
                    alerts.push(`
                        <div style="display:flex; align-items:center; gap:6px; font-size:0.8rem; margin-top:4px; color:${isDanger ? '#ef4444' : '#f59e0b'}; font-weight:600; background:rgba(${isDanger ? '239,68,68' : '245,158,11'},0.1); padding:4px 8px; border-radius:6px; border:1px solid rgba(${isDanger ? '239,68,68' : '245,158,11'},0.2);">
                            <span>⚙️</span>
                            <span>${label} (${Units.formatDistance(belt.remainingKm)})</span>
                        </div>
                    `);
                }
                // Oil Change alert check
                if (oil && (oil.level === 'danger' || oil.level === 'warning')) {
                    const isDanger = oil.level === 'danger';
                    const label = isDanger ? '🔴 Aceite Vencido' : '🟡 Aceite Próximo';
                    alerts.push(`
                        <div style="display:flex; align-items:center; gap:6px; font-size:0.8rem; margin-top:4px; color:${isDanger ? '#ef4444' : '#f59e0b'}; font-weight:600; background:rgba(${isDanger ? '239,68,68' : '245,158,11'},0.1); padding:4px 8px; border-radius:6px; border:1px solid rgba(${isDanger ? '239,68,68' : '245,158,11'},0.2);">
                            <span>🛢️</span>
                            <span>${label} (${Units.formatDistance(oil.remainingKm)})</span>
                        </div>
                    `);
                }

                if (alerts.length > 0) {
                    maintenanceHtml = `
                        <div style="margin-top:10px; padding-top:8px; border-top:1px dashed rgba(0,0,0,0.15);">
                            <div style="font-size:0.75rem; font-weight:700; color:var(--text-secondary); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px; display:flex; align-items:center; gap:4px;">
                                ⚠️ Mantenimiento Crítico
                            </div>
                            ${alerts.join('')}
                        </div>
                    `;
                }
            } catch (e) {
                console.warn('Error al verificar alertas en Radar popup:', e);
            }
        }

        const popupContent = `
            <div style="font-family:Inter,sans-serif; min-width:210px;">
                <div class="radar-popup-header">
                    <div class="radar-popup-avatar">👤</div>
                    <div>
                        <div class="radar-popup-title">${firstName}</div>
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
                    <strong style="color: ${statusColor}">${statusLabelText}</strong>
                </div>
                ${(data.permissions_ok === false || data.bg_location_ok === false || data.battery_optimization_ok === false) ? `
                <div class="radar-popup-row" style="color: #f97316; font-weight: bold; background: rgba(249,115,22,0.1); padding: 8px 10px; border-radius: 8px; margin-top: 6px; border: 1px solid rgba(249,115,22,0.25); font-size: 11px; flex-direction: column; align-items: flex-start; gap: 4px;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span>⚠️ Configuración Celular Chofer:</span>
                    </div>
                    ${data.bg_location_ok === false ? '<div style="color:#ef4444; font-size:10.5px;">• Falta ubicación: Debe elegir "Permitir todo el tiempo" (en Ajustes → Permisos → Ubicación).</div>' : ''}
                    ${data.battery_optimization_ok === false ? '<div style="color:#eab308; font-size:10.5px;">• Ahorro de batería activo: Debe elegir "Sin restricciones" (en Ajustes → Batería o tocar "Configurar Ahora" en su app).</div>' : ''}
                </div>
                ` : ''}
                <div class="radar-popup-row">
                    <span><span class="radar-popup-icon">📱</span> Versión App:</span>
                    <strong style="${versionStyle}">${appVersion}</strong>
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
                ${maintenanceHtml}
            </div>
        `;

        const carColor = vehicle ? (vehicle.color || 'gray') : 'gray';

        const latlng = new google.maps.LatLng(lat, lng);
        const html = _createCarIcon(heading, displayName, statusClass, carColor, speed, effectiveStatus, driverId);

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

        return { isAlive: true, isFresh: isFresh, hasShift: hasActiveShift }; // Marcador vivo y renderizado
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
            for (const s of activeShifts) {
                if (s.driverId) driverShiftMap[s.driverId] = s;
                if (s.driver_id) driverShiftMap[s.driver_id] = s;
                if (s.userId) driverShiftMap[s.userId] = s;
            }

            const driverIds = Object.keys(allPositions);
            let activeCount = 0;
            let onlineCount = 0;

            // Update/create markers
            for (const driverId of driverIds) {
                const data = allPositions[driverId];
                if (data && data.lat && data.lng) {
                    const shift = driverShiftMap[driverId];
                    const vehicle = shift ? vehiclesMap[shift.vehicleId] : null;
                    const res = await _updateMarker(driverId, data, shift, vehicle);
                    if (res && res.isAlive) {
                        activeCount++;
                        if (res.isFresh) {
                            onlineCount++;
                        }
                    }

                    // Verificar transiciones de estado para disparar alertas sonoras y visuales
                    // FIX: usar sessionStorage para persistir el cache entre aperturas del radar
                    if (!window._driverStatusCache) {
                        try {
                            const saved = sessionStorage.getItem('_driverStatusCache');
                            window._driverStatusCache = saved ? JSON.parse(saved) : {};
                        } catch(e) { window._driverStatusCache = {}; }
                    }
                    const prevStatus = window._driverStatusCache[driverId] || null;
                    const newStatus = data.status || 'active';

                    if (newStatus !== prevStatus) {
                        let rawName = data.driverName || (shift ? shift.driverName : null) || 'Chofer';
                        let firstName = rawName.split(' ')[0];
                        if (firstName.length > 20) firstName = 'Chofer';
                        const plateText = vehicle && vehicle.plate ? ` (${vehicle.plate})` : '';

                        // Cooldown per driver and event type to prevent infinite warning popups
                        if (!window._radarWarningCooldowns) window._radarWarningCooldowns = {};
                        const warningCooldownKey = `${driverId}_${newStatus}`;
                        const lastWarningTime = window._radarWarningCooldowns[warningCooldownKey] || 0;
                        const nowMs = Date.now();

                        // Solo alertar si el estado CAMBIA hacia algo negativo (no al abrir radar por primera vez)
                        // Y solo si transcurrieron más de 10 minutos (600,000ms) desde el último aviso igual para este chofer
                        if (prevStatus !== null && (nowMs - lastWarningTime > 10 * 60 * 1000)) {
                            if (newStatus === 'app_killed') {
                                window._radarWarningCooldowns[warningCooldownKey] = nowMs;
                                playWarningBeep();
                                speakRadarAlert(`¡Atención! El conductor ${firstName} cerró la aplicación manualmente.`);
                                showRadarWarning(`🚨 ${firstName}${plateText} cerró la app manualmente desde el panel de recientes`, 'danger');
                            } else if (newStatus === 'gps_desactivado') {
                                window._radarWarningCooldowns[warningCooldownKey] = nowMs;
                                playWarningBeep();
                                speakRadarAlert(`¡Alerta! El conductor ${firstName} apagó el GPS de su dispositivo.`);
                                showRadarWarning(`El conductor ${firstName}${plateText} ha desactivado el GPS de su dispositivo`, 'warning');
                            } else if (newStatus === 'suspicious_disconnect') {
                                window._radarWarningCooldowns[warningCooldownKey] = nowMs;
                                playWarningBeep();
                                speakRadarAlert(`¡Alerta! Se detectó una desconexión sospechosa de ${firstName}.`);
                                showRadarWarning(`Desconexión sospechosa detectada para ${firstName}${plateText} (Sin señal)`, 'danger');
                            } else if (newStatus === 'permissions_disabled') {
                                window._radarWarningCooldowns[warningCooldownKey] = nowMs;
                                playWarningBeep();
                                speakRadarAlert(`¡Alerta! El conductor ${firstName} desactivó los permisos de segundo plano o de batería.`);
                                showRadarWarning(`Permisos de segundo plano / Batería desactivados en el celular de ${firstName}${plateText}`, 'warning');
                            } else if (newStatus === 'logout_voluntario') {
                                window._radarWarningCooldowns[warningCooldownKey] = nowMs;
                                playWarningBeep();
                                speakRadarAlert(`El conductor ${firstName} ha cerrado sesión voluntariamente.`);
                                showRadarWarning(`El conductor ${firstName}${plateText} ha cerrado sesión voluntariamente (Desconectado)`, 'info');
                            }
                        }
                        
                        window._driverStatusCache[driverId] = newStatus;
                        try { sessionStorage.setItem('_driverStatusCache', JSON.stringify(window._driverStatusCache)); } catch(e) {}
                    }
                }
            }

            // Remove markers for drivers that left (solo si no tienen turno activo)
            for (const existingId of Object.keys(_markers)) {
                if (!allPositions[existingId] && !driverShiftMap[existingId]) {
                    _removeMarker(existingId);
                    if (window._driverStatusCache) delete window._driverStatusCache[existingId];
                }
            }

            _updateActiveCount(activeCount);
            if (onlineCount > 0) {
                _setStatus('connected', `${onlineCount} en línea · ${activeCount} en turno`);
            } else if (activeCount > 0) {
                _setStatus('connected', `${activeCount} chofer${activeCount !== 1 ? 'es' : ''} en turno`);
            } else {
                _setStatus('idle', 'Sin choferes activos');
            }

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

    let _globalAlertRef = null;
    let _activeAlertsMap = {}; // id -> data

    function _syncAndRenderAlerts() {
        if (!_map) return;
        const now = Date.now();
        const activeIds = Object.keys(_activeAlertsMap);

        activeIds.forEach(id => {
            const alert = _activeAlertsMap[id];
            if (!alert) return;
            const notExpired = (!alert.expiresAt || alert.expiresAt > now);
            const isActive = (alert.status === 'active' || !alert.status);
            if (notExpired && isActive && alert.lat && alert.lng) {
                _updateAlertMarker(id, alert);
            } else {
                _removeAlertMarker(id);
            }
        });

        // Eliminar marcadores que ya no están en los datos
        Object.keys(_alertMarkers).forEach(id => {
            if (!_activeAlertsMap[id]) {
                _removeAlertMarker(id);
            }
        });
    }

    function _startAlertListener() {
        if (typeof firebaseDB === 'undefined') return;

        console.log('[RADAR] Escuchando nodo global_traffic_alerts...');
        // 1. Escuchar nodo GLOBAL incondicionalmente
        _globalAlertRef = firebaseDB.ref('global_traffic_alerts');
        _globalAlertRef.on('value', (snap) => {
            const val = snap.val() || {};
            console.log(`[RADAR] Alertas globales recibidas: ${Object.keys(val).length}`);
            for (const id in val) {
                _activeAlertsMap[id] = val[id];
            }
            _syncAndRenderAlerts();
        }, (error) => {
            console.error('[RADAR] Error escuchando global_traffic_alerts:', error);
        });

        // 2. Escuchar nodo FLOTA si existe fleetId
        const fleetId = (typeof Auth !== 'undefined') ? Auth.getFleetId() : null;
        if (fleetId) {
            _alertRef = firebaseDB.ref(`fleets/${fleetId}/traffic_alerts`);
            _alertRef.on('value', (snap) => {
                const val = snap.val() || {};
                for (const id in val) {
                    _activeAlertsMap[id] = val[id];
                }
                _syncAndRenderAlerts();
            });
        }
    }

    function _stopAlertListener() {
        if (_globalAlertRef) {
            _globalAlertRef.off('value');
            _globalAlertRef = null;
        }
        if (_alertRef) {
            _alertRef.off('value');
            _alertRef = null;
        }
        _activeAlertsMap = {};
    }

    function _updateAlertMarker(id, data) {
        if (!_map) return;

        const lat = parseFloat(data.lat);
        const lng = parseFloat(data.lng);
        const type = data.type || 'warning'; // 'police' | 'radar' | 'traffic' | 'helicopter' | 'warning'
        
        const typeLabels = {
            police:     '🚔 Operativo Policial',
            checkpoint: '🚧 Control de Tránsito',
            municipal:  '🦊 Inspector Municipal',
            radar:      '📷 Radar / Fotomulta',
            helicopter: '🚁 Helicóptero Sanitario',
            ambulance:  '🚑 Servicio de Ambulancia',
            firetruck:  '🚒 Bomberos en Emergencia',
            accident:   '💥 Accidente de Tránsito',
            traffic:    '🚗 Tránsito Demorado',
            warning:    '⚠️ Alerta'
        };
        const label = typeLabels[type] || typeLabels.warning;

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

        const iconUrl = _getAlertIconUrl(type);
        const borderColor = BORDER_COLORS[type] || BORDER_COLORS.warning;
        const glowStyle = GLOW_SHADOWS[type] || GLOW_SHADOWS.warning;

        // Marcador premium: chapa circular blanca con borde y brillo
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

        const cleanSummary = data.description || (data.originalText ? data.originalText.substring(0, 60) : '');

        let detailsHtml = '';
        if (data.originalText) {
            detailsHtml = `
                <details style="margin-top: 6px; text-align: left; font-size: 10px; color: #64748b; cursor: pointer; outline: none;">
                    <summary style="font-weight: 600; color: #3b82f6; outline: none; margin-bottom: 2px;">Ver texto original</summary>
                    <div style="max-height: 65px; overflow-y: auto; padding: 4px 6px; background: #f8fafc; border-radius: 4px; border: 1px solid #e2e8f0; font-style: italic; white-space: pre-wrap; line-height: 1.2; color: #334155;">
                        "${data.originalText}"
                    </div>
                </details>
            `;
        }

        let audioButtonHtml = '';
        if (data.audioUrl) {
            audioButtonHtml = `
                <div style="margin-top: 10px; border-top: 1px solid #e2e8f0; padding-top: 8px;">
                    <button id="play-btn-${id}" class="audio-play-btn btn btn-primary btn-sm" 
                        onclick="RadarModule.playAudio('${data.audioUrl}', 'play-btn-${id}')"
                        style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 12px; font-size: 11px; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; background: #3b82f6; color: white;">
                        ▶️ Escuchar Audio
                    </button>
                </div>
            `;
        }

        const popupContent = `
            <div class="radar-alert-popup" style="padding: 4px; font-family: Inter, sans-serif; min-width: 160px; max-width: 220px;">
                <div class="alert-popup-header ${type}" style="font-weight: bold; color: ${borderColor}; font-size: 13px; margin-bottom: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
                    ${label}
                </div>
                <div class="alert-popup-body" style="font-size: 11px; color: #1e293b; line-height: 1.3;">
                    ${cleanSummary ? `<p style="font-weight: 600; margin: 0 0 6px 0; font-size: 12px;">${cleanSummary}</p>` : ''}
                    <p style="margin: 2px 0;"><strong>Ubicación:</strong> ${data.location}</p>
                    <p style="margin: 2px 0;"><strong>Detectado:</strong> ${new Date(data.timestamp).toLocaleTimeString()}</p>
                    <p class="alert-expiry" style="margin: 2px 0; color: #ef4444; font-weight: 500;">Expira en: ${Math.round((data.expiresAt - Date.now()) / 60000)} min</p>
                    ${detailsHtml}
                    ${audioButtonHtml}
                </div>
                <div class="alert-popup-actions" style="margin-top: 10px; display: flex; gap: 6px; justify-content: space-between;">
                    <button class="btn-confirm" onclick="RadarModule.confirmAlert('${id}')" style="flex: 1; padding: 4px 8px; font-size: 10px; border-radius: 4px; border: 1px solid #d1d5db; background: #f3f4f6; cursor: pointer; font-weight: 500;">👍 Sigue ahí</button>
                    <button class="btn-dismiss" onclick="RadarModule.dismissAlert('${id}')" style="flex: 1; padding: 4px 8px; font-size: 10px; border-radius: 4px; border: 1px solid #d1d5db; background: #f3f4f6; cursor: pointer; font-weight: 500;">👎 Ya no está</button>
                </div>
            </div>
        `;

        const latlng = new google.maps.LatLng(lat, lng);

        if (_alertMarkers[id]) {
            // Alerta existente: actualizar posición, contenido HTML y popup
            _alertMarkers[id].setPosition(latlng);
            _alertMarkers[id].setHtml(iconHtml);
            _alertMarkers[id].setPopupContent(popupContent);
        } else {
            // Alerta NUEVA: instanciar HTMLMapMarker (offset 20, 20 para centrar la chapa de 40px)
            const MarkerClass = _getHTMLMapMarkerClass();
            const marker = new MarkerClass(latlng, iconHtml, popupContent, 20, 20);
            marker.setMap(_map);
            _alertMarkers[id] = marker;
            
            // Auto-enfocar el mapa en la nueva alerta con una animación suave
            if (_map) {
                _map.panTo(latlng);
                _map.setZoom(14);
            }

            // Abrir automáticamente la ventana emergente para que el conductor vea la alerta y pueda reproducir el audio
            setTimeout(() => {
                if (_alertMarkers[id]) {
                    _alertMarkers[id].openPopup();
                }
            }, 500);
        }
    }

    function toggleVoice() {
        _voiceEnabled = !_voiceEnabled;
        localStorage.setItem('radarVoice', _voiceEnabled ? 'on' : 'off');
        const btn = document.getElementById('radarVoiceBtn');
        if (btn) btn.textContent = _voiceEnabled ? '🔊' : '🔇';
        
        if (!_voiceEnabled) {
            if (typeof CopilotModule !== 'undefined' && typeof CopilotModule.stopAudio === 'function') {
                CopilotModule.stopAudio();
            }
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setVoiceMuted === 'function') {
                AndroidServices.setVoiceMuted(true);
            }
            if (typeof window !== 'undefined' && window.speechSynthesis) {
                try { window.speechSynthesis.cancel(); } catch (_) {}
            }
            console.log('🔇 [VOZ] DESACTIVADA y audios cortados.');
        } else {
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setVoiceMuted === 'function') {
                AndroidServices.setVoiceMuted(false);
            }
            // Confirmar con voz global si se activa
            if (typeof TrafficAlerts !== 'undefined') {
                TrafficAlerts.speakAlert('warning', null);
            }
            console.log('🔊 [VOZ] ACTIVADA');
        }
    }

    function _removeAlertMarker(id) {
        if (_alertMarkers[id]) {
            _alertMarkers[id].setMap(null);
            delete _alertMarkers[id];
        }
    }

    function _getAlertIconUrl(type) {
        const iconMap = {
            police:     'assets/alert-icons/police.png',
            checkpoint: 'assets/alert-icons/police.png',
            radar:      'assets/alert-icons/radar.png',
            helicopter: 'assets/alert-icons/helicopter.png',
            ambulance:  'assets/alert-icons/ambulance.png',
            firetruck:  'assets/alert-icons/firetruck.png',
            municipal:  'assets/alert-icons/municipal.png',
            accident:   'assets/alert-icons/accident.png',
            traffic:    'assets/alert-icons/accident.png',
            warning:    'assets/alert-icons/accident.png',
        };
        return iconMap[type] || iconMap.warning;
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
        const volPercent = parseInt(localStorage.getItem('radarVolumePercent') || '85', 10);
        currentAudio.volume = Math.max(0.05, Math.min(1.0, volPercent / 100.0));

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

    // ============ ALARM & WARNING HACKS ============

    function speakRadarAlert(text) {
        if (!text) return;
        try {
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
                AndroidServices.speak(text);
            } else if (window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
                try { window.NativeServiceBridge.speak(text); } catch(e) {}
            } else if (window.speechSynthesis) {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                window.speechSynthesis.cancel();
                const utter = new SpeechSynthesisUtterance(text);
                utter.lang = 'es-AR';
                utter.rate = 1.0;
                window.speechSynthesis.speak(utter);
            }
        } catch (e) {
            console.warn('Radar TTS failed:', e);
        }
    }

    function playWarningBeep() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(880, ctx.currentTime); 
            osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15); 
            
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.4);
        } catch (e) {
            console.warn('Warning beep failed:', e);
        }
    }

    function showRadarWarning(message, type = 'danger') {
        const container = document.getElementById('radarWarningContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `radar-warning-toast ${type}`;
        toast.style.cssText = `
            background: ${type === 'danger' ? '#7f1d1d' : '#7c2d12'};
            color: ${type === 'danger' ? '#fecaca' : '#ffedd5'};
            border: 2px solid ${type === 'danger' ? '#ef4444' : '#f97316'};
            border-radius: 12px;
            padding: 12px 16px;
            font-family: Inter, sans-serif;
            font-size: 0.9rem;
            font-weight: 600;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: space-between;
            pointer-events: auto;
            margin-bottom: 8px;
            animation: slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        `;
        
        const now = new Date();
        const dateStr = now.toLocaleDateString();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const dateTimeStr = `${dateStr} ${timeStr}`;

        toast.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:2px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span>${type === 'danger' ? '🚨' : '⚠️'}</span>
                    <span>${message}</span>
                </div>
                <div style="font-size:0.75rem; opacity:0.8; margin-left:24px; font-weight:normal;">
                    ${dateTimeStr}
                </div>
            </div>
            <button onclick="this.parentElement.remove()" style="background:none; border:none; color:white; font-size:1.1rem; cursor:pointer; padding: 0 4px; align-self: center; margin-left: 12px;">✕</button>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.animation = 'slideUp 0.4s forwards';
                setTimeout(() => toast.remove(), 400);
            }
        }, 10000);
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

    // ============ CÁMARAS Y FOTOMULTAS OFICIALES ============

    function _renderCameraMarkers() {
        _clearCameraMarkers();
        if (!_showCameras || !_map || typeof CopilotModule === 'undefined') return;

        const radars = CopilotModule.getAllRadars ? CopilotModule.getAllRadars() : [];
        if (!radars || !radars.length) return;

        const MarkerClass = _getHTMLMapMarkerClass();

        radars.forEach(radar => {
            const isThreeDigits = (radar.limit >= 100);
            const fontSize = isThreeDigits ? '6.5px' : '7.5px';
            const letterSpacing = isThreeDigits ? '-0.5px' : '-0.2px';
            const pinHtml = `
                <div class="radar-cam-pin" title="${radar.name} (Máx ${radar.limit} km/h)" style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.55));cursor:pointer;transition:transform 0.15s ease;" onmouseenter="this.style.transform='scale(1.35)'" onmouseleave="this.style.transform='scale(1)'">
                    <div style="background:#ffffff;border:1.8px solid #dc2626;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.4);">
                        <span style="font-size:${fontSize};font-weight:900;color:#0f172a;line-height:1;letter-spacing:${letterSpacing};">${radar.limit}</span>
                    </div>
                    <div style="width:0;height:0;border-left:2.5px solid transparent;border-right:2.5px solid transparent;border-top:3.5px solid #dc2626;margin-top:-1px;"></div>
                </div>
            `;

            const popupHtml = `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;padding:8px 10px;max-width:240px;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
                        <span style="background:#dc2626;color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:10px;">📷 FOTOMULTA</span>
                        <span style="font-size:11px;font-weight:700;color:#dc2626;">MÁX ${radar.limit} km/h</span>
                    </div>
                    <div style="font-size:13px;font-weight:800;line-height:1.2;color:#0f172a;margin-bottom:4px;">${radar.name}</div>
                    <div style="font-size:11px;color:#64748b;line-height:1.3;">${radar.desc || 'Videocontrol municipal de tránsito'}</div>
                </div>
            `;

            const marker = new MarkerClass(
                new google.maps.LatLng(radar.lat, radar.lng),
                pinHtml,
                popupHtml,
                8,
                19
            );
            marker.setMap(_map);
            _cameraMarkers.push(marker);
        });
    }

    function _clearCameraMarkers() {
        if (_cameraMarkers && _cameraMarkers.length) {
            _cameraMarkers.forEach(m => {
                if (m && m.setMap) m.setMap(null);
            });
            _cameraMarkers = [];
        }
    }

    function toggleCameras() {
        _showCameras = !_showCameras;
        localStorage.setItem('radarShowCameras', _showCameras ? 'on' : 'off');
        const btn = document.getElementById('radarCamerasBtn');
        if (btn) {
            btn.style.background = _showCameras ? 'rgba(239, 68, 68, 0.28)' : 'rgba(255,255,255,0.1)';
            btn.style.borderColor = _showCameras ? '#ef4444' : 'rgba(255,255,255,0.2)';
        }
        if (_showCameras) {
            _renderCameraMarkers();
        } else {
            _clearCameraMarkers();
        }
    }

    function testAlerts() {
        if (typeof CopilotModule !== 'undefined' && typeof CopilotModule.testAlert === 'function') {
            // Probar alternando entre fotomulta y alerta de tránsito
            const lastType = RadarModule._lastTestType === 'transito' ? 'fotomulta' : 'transito';
            RadarModule._lastTestType = lastType;
            CopilotModule.testAlert(lastType);
        } else if (typeof Components !== 'undefined' && Components.showToast) {
            Components.showToast('CopilotModule no disponible', 'warning');
        }
    }

    function zoomIn() {
        if (_map) {
            _map.setZoom((_map.getZoom() || 13) + 1);
        }
    }

    function zoomOut() {
        if (_map) {
            _map.setZoom((_map.getZoom() || 13) - 1);
        }
    }

    // ============ PUBLIC API ============

    return {
        renderDashboardButton, open, close, confirmAlert, dismissAlert, toggleVoice, toggleMapStyle, toggleCameras, playAudio, testAlerts, zoomIn, zoomOut
    };
})();
