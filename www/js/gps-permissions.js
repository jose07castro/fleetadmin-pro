/* ============================================
   FleetAdmin Pro — GPS Permissions Manager (v112)
   Solicitud de permisos con diálogo explicativo,
   detección de rechazo, reintento persistente,
   y guía paso a paso para "Permitir siempre"
   ============================================ */

const GPSPermissions = (() => {
    const PERMISSION_KEY = 'fleetadmin_gps_permission_asked';
    let _permissionState = 'unknown'; // 'unknown', 'prompt', 'granted', 'denied'
    let _retryInterval = null;

    // ============ CHECK CURRENT STATE ============

    async function checkPermission() {
        try {
            if ('permissions' in navigator) {
                const result = await navigator.permissions.query({ name: 'geolocation' });
                _permissionState = result.state; // 'granted', 'denied', 'prompt'
                
                // Listen for changes (user toggles in Android settings)
                result.addEventListener('change', () => {
                    const oldState = _permissionState;
                    _permissionState = result.state;
                    console.log(`📍 GPSPerms: Permiso cambió ${oldState} → ${_permissionState}`);
                    
                    if (_permissionState === 'granted') {
                        _onPermissionGranted();
                    } else if (_permissionState === 'denied') {
                        _onPermissionDenied();
                    }
                });
                
                return _permissionState;
            }
        } catch (e) {
            console.warn('📍 GPSPerms: Permissions API no disponible:', e);
        }
        return 'unknown';
    }

    // ============ MAIN FLOW: Request with Dialog ============

    async function requestWithDialog() {
        const state = await checkPermission();
        
        if (state === 'granted') {
            console.log('📍 GPSPerms: ✅ Ya tiene permiso, activando tracking...');
            _onPermissionGranted();
            return true;
        }
        
        if (state === 'denied') {
            console.warn('📍 GPSPerms: ❌ Permiso denegado previamente');
            _showDeniedDialog();
            return false;
        }
        
        // State is 'prompt' or 'unknown' — show explanatory dialog first
        return new Promise((resolve) => {
            _showExplanatoryDialog(resolve);
        });
    }

    // ============ EXPLANATORY DIALOG (Before requesting) ============

    function _showExplanatoryDialog(resolveCallback) {
        const bodyHTML = `
            <div style="text-align:center; padding:8px 0;">
                <div style="font-size:3rem; margin-bottom:12px;">📍</div>
                <div style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin-bottom:16px;">
                    Permiso de Ubicación Requerido
                </div>
                <div style="font-size:0.9rem; color:var(--text-secondary); line-height:1.6; margin-bottom:20px; text-align:center; padding:0 8px;">
                    Para que el radar de la flota funcione, necesitamos acceso a tu ubicación mientras usás la app.
                </div>
                <div style="margin-top:16px; padding:12px; background:rgba(34,197,94,0.08); border:1px solid rgba(34,197,94,0.2); border-radius:12px; text-align:left;">
                    <div style="font-size:0.85rem; color:#86efac; font-weight:600; margin-bottom:6px;">⚠️ Por favor seleccioná:</div>
                    <ul style="font-size:0.8rem; color:var(--text-secondary); margin:0; padding-left:16px; line-height:1.8;">
                        <li><strong>"Permitir solo con la app en uso"</strong></li>
                        <li><strong>"Ubicación precisa"</strong></li>
                    </ul>
                </div>
            </div>
        `;

        const footerHTML = `
            <button class="btn btn-ghost" onclick="GPSPermissions._onDialogCancel()">Ahora No</button>
            <button class="btn btn-primary" style="min-width:160px;" onclick="GPSPermissions._onDialogAccept()">
                📍 Activar Ubicación
            </button>
        `;

        Components.showModal('📍 Ubicación en Tiempo Real', bodyHTML, footerHTML);
        
        // Store callback
        GPSPermissions._resolveCallback = resolveCallback;
    }

    // Called when user taps "Activar Ubicación"
    function _onDialogAccept() {
        Components.closeModal();
        localStorage.setItem(PERMISSION_KEY, 'asked');
        
        // Actually request geolocation — this triggers the browser prompt
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                console.log('📍 GPSPerms: ✅ Permiso concedido, posición:', pos.coords.latitude.toFixed(4));
                _permissionState = 'granted';
                _onPermissionGranted();
                if (GPSPermissions._resolveCallback) {
                    GPSPermissions._resolveCallback(true);
                    GPSPermissions._resolveCallback = null;
                }
            },
            (err) => {
                console.warn('📍 GPSPerms: ❌ Error/Rechazo:', err.code, err.message);
                if (err.code === 1) {
                    // PERMISSION_DENIED
                    _permissionState = 'denied';
                    _showDeniedDialog();
                } else {
                    // POSITION_UNAVAILABLE or TIMEOUT — permission might still be granted
                    Components.showToast('⚠️ No se pudo obtener la ubicación. Verificá que el GPS esté encendido.', 'warning');
                }
                if (GPSPermissions._resolveCallback) {
                    GPSPermissions._resolveCallback(false);
                    GPSPermissions._resolveCallback = null;
                }
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    // Called when user taps "Ahora No"
    function _onDialogCancel() {
        Components.closeModal();
        _showWarningBanner();
        if (GPSPermissions._resolveCallback) {
            GPSPermissions._resolveCallback(false);
            GPSPermissions._resolveCallback = null;
        }
    }

    // ============ DENIED DIALOG (With instructions) ============

    function _showDeniedDialog() {
        const isAndroid = /android/i.test(navigator.userAgent);
        const isIOS = /iphone|ipad/i.test(navigator.userAgent);
        
        let instructions = '';
        if (isAndroid) {
            instructions = `
                <div class="gps-perm-steps">
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">1</span>
                        <span>Tocá el botón <strong>"Abrir Configuración"</strong> abajo</span>
                    </div>
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">2</span>
                        <span>Buscá <strong>"Permisos"</strong> o <strong>"Ubicación"</strong></span>
                    </div>
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">3</span>
                        <span>Seleccioná <strong>"Permitir siempre"</strong> o <strong>"Permitir todo el tiempo"</strong></span>
                    </div>
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">4</span>
                        <span>Volvé a la app y tocá <strong>"Reintentar"</strong></span>
                    </div>
                </div>
            `;
        } else if (isIOS) {
            instructions = `
                <div class="gps-perm-steps">
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">1</span>
                        <span>Abrí <strong>Ajustes → Safari → Ubicación</strong></span>
                    </div>
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">2</span>
                        <span>Seleccioná <strong>"Permitir"</strong> para este sitio</span>
                    </div>
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">3</span>
                        <span>Volvé y tocá <strong>"Reintentar"</strong></span>
                    </div>
                </div>
            `;
        } else {
            instructions = `
                <div class="gps-perm-steps">
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">1</span>
                        <span>Hacé clic en el ícono de 🔒 candado en la barra de direcciones</span>
                    </div>
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">2</span>
                        <span>Cambiá <strong>"Ubicación"</strong> a <strong>"Permitir"</strong></span>
                    </div>
                    <div class="gps-perm-step">
                        <span class="gps-perm-step-num">3</span>
                        <span>Recargá la página y tocá <strong>"Reintentar"</strong></span>
                    </div>
                </div>
            `;
        }

        const bodyHTML = `
            <div style="text-align:center; padding:8px 0;">
                <div style="font-size:3rem; margin-bottom:12px;">🚫</div>
                <div style="font-size:1.05rem; font-weight:700; color:#fca5a5; margin-bottom:8px;">
                    Ubicación Denegada
                </div>
                <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:16px; line-height:1.5;">
                    Sin el permiso de ubicación, el modo <strong>"En Línea"</strong> no funcionará 
                    correctamente y el administrador no podrá ver tu posición en el radar.
                </div>
                <div style="font-size:0.85rem; font-weight:600; color:var(--text-primary); margin-bottom:12px;">
                    Seguí estos pasos para activarlo y seleccioná "Permitir siempre":
                </div>
                ${instructions}
            </div>
        `;

        const footerHTML = `
            <button class="btn btn-ghost" onclick="Components.closeModal()">Cerrar</button>
            ${isAndroid ? `<button class="btn btn-warning" onclick="GPSPermissions._openAndroidSettings()">⚙️ Abrir Configuración</button>` : ''}
            <button class="btn btn-primary" onclick="GPSPermissions._retry()">🔄 Reintentar</button>
        `;

        Components.showModal('🚫 Permiso de Ubicación', bodyHTML, footerHTML);
    }

    // ============ RETRY ============

    function _retry() {
        Components.closeModal();
        Components.showToast('📍 Verificando permisos...', 'info');
        
        // Try requesting again
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                _permissionState = 'granted';
                _onPermissionGranted();
                Components.showToast('✅ ¡Ubicación activada! Tracking GPS funcionando.', 'success');
            },
            (err) => {
                if (err.code === 1) {
                    _permissionState = 'denied';
                    Components.showToast('❌ Ubicación aún denegada. Verificá los ajustes del navegador.', 'danger');
                    // Show denied dialog again after a brief pause
                    setTimeout(() => _showDeniedDialog(), 1500);
                } else {
                    Components.showToast('⚠️ Error de GPS. Verificá que el GPS esté encendido.', 'warning');
                }
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    // ============ ANDROID SETTINGS DEEP-LINK ============

    async function _openAndroidSettings() {
        // v121: Auto-Ajustes Nativos en App Híbrida Capacitor
        if (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.App) {
            try {
                await Capacitor.Plugins.App.openAppSettings();
                return; // Si es nativo, corta acá y abre el Activity en Java directamente
            } catch(e) {}
        }

        // Para Chrome en Android (PWA pura): Web fallback Deep link a settings
        try {
            if (window.location.protocol === 'https:') {
                window.open('intent://settings/location#Intent;scheme=android-app;end;', '_blank');
            }
        } catch (e) {
            console.warn('📍 GPSPerms: No se pudo abrir settings web:', e);
        }
        
        Components.showToast('⚙️ Abrí Ajustes → Permisos → Ubicación → "Permitir siempre" o "Permitir todo el tiempo"', 'info');
    }

    // ============ WARNING BANNER ============

    function _showWarningBanner() {
        Components.showToast(
            '⚠️ El modo "En Línea" no funcionará sin permiso GPS. Tocá ⚙️ para activarlo.',
            'warning'
        );
        
        // Set up periodic retry reminder (every 60s)
        if (!_retryInterval) {
            _retryInterval = setInterval(() => {
                if (_permissionState === 'granted') {
                    clearInterval(_retryInterval);
                    _retryInterval = null;
                    return;
                }
                // Only remind if user is a driver
                if (typeof Auth !== 'undefined' && !Auth.isOwner()) {
                    Components.showToast(
                        '📍 Tu ubicación GPS está desactivada. El admin no puede verte en el radar.',
                        'warning'
                    );
                }
            }, 60000);
        }
    }

    // ============ CALLBACKS ============

    function _onPermissionGranted() {
        console.log('📍 GPSPerms: ✅ Permiso concedido — activando tracking persistente');
        
        if (_retryInterval) {
            clearInterval(_retryInterval);
            _retryInterval = null;
        }

        // Acquire Wake Lock for persistent tracking
        _acquireTrackingWakeLock();
        
        // Start background GPS tracking automatically
        _startPersistentTracking();
    }

    function _onPermissionDenied() {
        console.warn('📍 GPSPerms: ❌ Permiso denegado');
        _showWarningBanner();
    }

    // ============ PERSISTENT TRACKING (FOREGROUND SERVICE EQUIVALENT) ============

    let _persistentTrackingActive = false;
    let _persistentInterval = null;
    let _persistentWatchId = null;
    let _wakeLock = null;
    let _cachedPosition = null;
    let _keepAliveWorker = null;
    let _lastPositionPushTime = 0;

    // v121: MOTOR NATIVO ANDROID VÍA CAPACITOR API
    async function _startNativeBackgroundTracking(userId) {
        if (!Capacitor.Plugins.BackgroundGeolocation) return;
        
        console.log('📱 GPSPerms: Modo INMORTAL Híbrido Android Detectado. Desplegando Foreground Service.');

        try {
            const watcherId = await Capacitor.Plugins.BackgroundGeolocation.addWatcher(
                {
                    // Alerta y título de la Notificación Persistente de Sistema (Obligatorio en Android 10+)
                    backgroundMessage: 'Enviando coordenadas GPS de la Flota...', 
                    backgroundTitle: 'Punto Remis: Turno activo',
                    requestPermissions: true, // Auto-chequeo del Permiso "Siempre" / "Always" y abre el prompt de OS
                    stale: false,
                    distanceFilter: 0 // Cada cambio actualiza
                },
                async (location, error) => {
                    if (error) return console.error('BG_GEO Native Error:', error);
                    
                    const inShift = localStorage.getItem('active_shift_state') === 'true';
                    if (!inShift) return;

                    // --- INTEGRACIÓN DE COPILOTO DE RADARES ---
                    if (typeof CopilotModule !== 'undefined') {
                        CopilotModule.checkProximity(location.latitude, location.longitude);
                    }

                    let batteryLevel = null;
                    if (navigator.getBattery) {
                        try { const b = await navigator.getBattery(); batteryLevel = Math.round(b.level * 100); } catch(e){}
                    }

                    try {
                        await firebaseDB.ref(`driver_positions/${userId}`).set({
                            lat: location.latitude,
                            lng: location.longitude,
                            heading: location.bearing || 0,
                            speed: (location.speed || 0) * 3.6, // m/s to km/h
                            battery: batteryLevel,
                            driverName: Auth.getUserName() || userId,
                            updated_at: new Date().toISOString(),
                            _native: true // Marca nativa de calidad paridad
                        });
                        _lastPositionPushTime = Date.now();
                    } catch(e) {}
                }
            );
            _persistentWatchId = watcherId;
        } catch(e) {
            console.warn('Fallo iniciando BackgroundGeolocation nativa', e);
        }
    }

    async function _acquireTrackingWakeLock() {
        if (_wakeLock) return;
        try {
            if ('wakeLock' in navigator) {
                _wakeLock = await navigator.wakeLock.request('screen');
                console.log('🛡️ GPSPerms: Wake Lock adquirido — tracking GPS persistente');
                
                _wakeLock.addEventListener('release', () => {
                    console.warn('🛡️ GPSPerms: Wake Lock liberado — intentando re-adquirir');
                    _wakeLock = null;
                    // Re-acquire when app returns to foreground
                    if (document.visibilityState === 'visible') {
                        setTimeout(() => _acquireTrackingWakeLock(), 500);
                    }
                });
            }
        } catch (e) {
            console.warn('🛡️ GPSPerms: Wake Lock no disponible:', e.message);
        }

        // Re-acquire on visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !_wakeLock && _persistentTrackingActive) {
                _acquireTrackingWakeLock();
                // Also force a position update when coming back
                _forceSendPosition();
            }
        });
    }

    function _startPersistentTracking() {
        if (_persistentTrackingActive) return;
        
        const userId = typeof Auth !== 'undefined' ? (Auth.getUserId() || Auth.getUserName()) : null;
        if (!userId) return;
        
        // Don't track admins
        if (typeof Auth !== 'undefined' && Auth.isOwner()) return;

        _persistentTrackingActive = true;
        console.log('📡 GPSPerms: Tracking persistente ACTIVADO para', userId);

        // Immediate send
        _forceSendPosition();
        _lastPositionPushTime = Date.now();

        // v118/121: Integración Nivel Nativo (Cordova/Capacitor Foreground Service)
        _enableNativeForegroundService();

        // v121: Capacitor Native Background Geolocation (Immortal Mode)
        if (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.BackgroundGeolocation) {
            _startNativeBackgroundTracking(userId);
            // Salimos: el Tracking Nativo desactiva nuestro humilde fallback web porque es 100% superior
            return;
        }

        // Intervalo Dinámico (3.5s normal, 10s si batería baja) 
        const evaluateAndSend = async () => {
            let limitMs = 3500; // 3.5 segundos por defecto (agresivo)
            if (navigator.getBattery) {
                try {
                    const b = await navigator.getBattery();
                    if (b.level * 100 < 15) limitMs = 10000;
                } catch(e) {}
            }
            if (Date.now() - _lastPositionPushTime >= limitMs) {
                _forceSendPosition();
            }
        };

        // Fallback Web: Revisión ultra-rápida (1s) para no atrasar el ciclo de envío
        _persistentInterval = setInterval(evaluateAndSend, 1000);

        // v118: Web Worker Keep-Alive (Ignora suspensión en segundo plano de PWA)
        if (window.Worker) {
            _keepAliveWorker = new Worker('js/keep-alive-worker.js');
            _keepAliveWorker.postMessage('start');
            _keepAliveWorker.onmessage = (e) => {
                if (e.data === 'ping') {
                    // El worker reacciona cada 2 seg en segundo plano real
                    evaluateAndSend();
                }
            };
        }

        // v118: Integración Nivel Nativo (Cordova/Capacitor Foreground Service)
        _enableNativeForegroundService();

        // Continuous watch for caching
        try {
            _persistentWatchId = navigator.geolocation.watchPosition(
                (pos) => {
                    _cachedPosition = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        heading: pos.coords.heading || 0,
                        speed: (pos.coords.speed || 0) * 3.6
                    };
                },
                () => {},
                { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 }
            );
        } catch (e) {
            console.warn('📡 GPSPerms: watchPosition unavailable');
        }
    }

    // Activa la notificación nativa persistente si la App corre en un Wrapper Android
    function _enableNativeForegroundService() {
        // Plugin tipo Cordova Background Mode
        if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.backgroundMode) {
            try {
                cordova.plugins.backgroundMode.enable();
                cordova.plugins.backgroundMode.setDefaults({
                    title: 'Punto Remis: Turno activo',
                    text: 'Tracking de alta frecuencia (3s)',
                    icon: 'icon',
                    resume: true,
                    hidden: false
                });
            } catch(e) {}
        }
        
        // Simulación Capacitor (ejemplo genérico)
        if (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.BackgroundMode) {
            try {
                Capacitor.Plugins.BackgroundMode.enable();
            } catch(e) {}
        }

        // v119: PWA Foreground Service (Web Notification Hack)
        if (typeof Notification !== 'undefined') {
            if (Notification.permission === 'granted' && navigator.serviceWorker) {
                navigator.serviceWorker.ready.then(reg => {
                    reg.showNotification('Punto Remis: Turno activo', {
                        body: 'Reportando ubicación al radar del administrador. (App Activa)',
                        icon: 'assets/icons/icon-192x192.png',
                        tag: 'gps-tracking-fg',
                        silent: true,
                        requireInteraction: false
                    }).catch(() => {});
                });
            }
        }
    }

    async function _forceSendPosition() {
        const userId = typeof Auth !== 'undefined' ? (Auth.getUserId() || Auth.getUserName()) : null;
        if (!userId || typeof firebaseDB === 'undefined') return;

        // Validar si el chofer está en turno (En Línea)
        const inShift = localStorage.getItem('active_shift_state') === 'true';
        if (!inShift) {
            // No enviar coordenadas si no está trabajando
            // Opcional: limpiar la posición en la DB para forzar fantasma
            return;
        }

        // Extraer batería del dispositivo
        let batteryLevel = null;
        if (navigator.getBattery) {
            try {
                const b = await navigator.getBattery();
                batteryLevel = Math.round(b.level * 100);
            } catch(e) {}
        }

        try {
            const pos = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => reject(new Error('Hard timeout GPS')), 10000);

                const handleSuccess = (p) => {
                    clearTimeout(timeoutId);
                    resolve({
                        lat: p.coords.latitude,
                        lng: p.coords.longitude,
                        heading: p.coords.heading || 0,
                        speed: (p.coords.speed || 0) * 3.6
                    });
                };

                const handleError = (e) => {
                    clearTimeout(timeoutId);
                    reject(e);
                };

                // Prioridad absoluta a API Nativa de Capacitor si existe (funciona perfecto en 2do plano con BackgroundMode)
                if (typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.Geolocation) {
                    Capacitor.Plugins.Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 })
                        .then(handleSuccess)
                        .catch(handleError);
                } else {
                    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 });
                }
            });

            _cachedPosition = pos;

            // --- INTEGRACIÓN DE COPILOTO DE RADARES ---
            if (typeof CopilotModule !== 'undefined') {
                CopilotModule.checkProximity(pos.lat, pos.lng);
            }

            await firebaseDB.ref(`driver_positions/${userId}`).set({
                lat: pos.lat,
                lng: pos.lng,
                heading: pos.heading,
                speed: pos.speed,
                battery: batteryLevel,
                driverName: Auth.getUserName() || userId,
                updated_at: new Date().toISOString()
            });
            _lastPositionPushTime = Date.now();
        } catch (e) {
            // Si el GPS falla, subir 'ping' de última posición si hay alguna
            if (_cachedPosition) {
                try {
                    await firebaseDB.ref(`driver_positions/${userId}`).update({
                        updated_at: new Date().toISOString()
                    });
                    _lastPositionPushTime = Date.now();
                } catch (_) {}
            }
        }
    }

    // ============ INIT: Auto-request for drivers on login ============

    async function initForDriver() {
        if (typeof Auth === 'undefined' || Auth.isOwner()) return;
        
        const state = await checkPermission();
        
        // Request notifications for the background service hook
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
        }
        
        if (state === 'granted') {
            _onPermissionGranted();
            return;
        }
        
        // Only show dialog if not asked before, or if denied
        const wasAsked = localStorage.getItem(PERMISSION_KEY);
        if (!wasAsked || state === 'denied') {
            // Small delay so the app finishes loading first
            setTimeout(() => requestWithDialog(), 2000);
        }
    }

    // ============ PUBLIC API ============

    return {
        checkPermission,
        requestWithDialog,
        initForDriver,
        getState: () => _permissionState,
        // Internal methods exposed for onclick handlers
        _onDialogAccept,
        _onDialogCancel,
        _openAndroidSettings,
        _retry,
        _resolveCallback: null
    };
})();
