/* ============================================
   FleetAdmin Pro — Android Native Services v3.0
   
   Puente JS ↔ Android Nativo para:
   1. Foreground Service REAL via NativeServiceBridge.startTracking()
   2. BackgroundMode Cordova plugin como 2da capa de protección
   3. Recepción de coordenadas del GPS nativo via window._onNativeGPS()
   4. Solicitud de exención de batería via Intent nativo
   5. Fallback PWA para navegadores web
   
   Arquitectura v3.0 (Senior):
   ┌──────────────────────────────────────────────────────────────────┐
   │  JS (WebView)                                                    │
   │  ├─ window.NativeServiceBridge.startTracking()                  │
   │  │   → startForegroundService(LocationTrackingService.class)    │
   │  │   → startForeground() + PARTIAL_WAKE_LOCK + GPS_PROVIDER    │
   │  │                                                               │
   │  ├─ BackgroundMode.enable() (2da capa, desactiva JS throttle)   │
   │  │                                                               │
   │  └─ window._onNativeGPS(lat, lng, speed, brg)                  │
   │      ← evaluateJavascript() desde LocationTrackingService.java  │
   │      → firebaseDB.ref('driver_positions/{userId}').set({...})   │
   └──────────────────────────────────────────────────────────────────┘
   ============================================ */

const AndroidServices = (() => {

    let _nativeGPSActive = false;
    let _silentAudio = null;
    let _lastNativeGPSTime = 0;

    // =============================================
    // DETECCIÓN DE PLATAFORMA
    // =============================================

    function isNativeAndroid() {
        return (
            typeof Capacitor !== 'undefined' &&
            Capacitor.isNativePlatform() &&
            Capacitor.getPlatform() === 'android'
        );
    }

    function isCapacitorAvailable() {
        return typeof Capacitor !== 'undefined' && Capacitor.Plugins;
    }

    /**
     * Verifica si el bridge nativo Java está disponible.
     * (Registrado en MainActivity.java como @JavascriptInterface)
     */
    function _hasNativeBridge() {
        return typeof window.NativeServiceBridge !== 'undefined';
    }

    // =============================================
    // 1. FOREGROUND SERVICE — INMORTALIDAD GPS
    // 
    // CAPA 1: NativeServiceBridge → startForegroundService()
    //         Arranca LocationTrackingService.java REAL
    //
    // CAPA 2: BackgroundMode plugin → evita JS throttling
    //         Desactiva optimizaciones del WebView
    //
    // CAPA 3: Audio silencioso PWA (fallback web)
    // =============================================

    async function enableForegroundService(shiftId, vehiclePlate) {
        console.log('📱 AndroidServices: enableForegroundService() llamado');
        console.log(`📱 AndroidServices: shiftId=${shiftId} | plate=${vehiclePlate}`);

        // Registrar receptor de GPS nativo SIEMPRE primero
        _registerNativeGPSReceiver();

        // Obtener userId, driverName y fleetId para pasarle al Service Java
        const userId = (typeof Auth !== 'undefined') ? (Auth.getUserId() || Auth.getUserName()) : null;
        const driverName = (typeof Auth !== 'undefined') ? (Auth.getUserName() || 'Chofer') : 'Chofer';
        const fleetId = (typeof Auth !== 'undefined') ? Auth.getFleetId() : null;

        // === RUTA A: NATIVO ANDROID (Capacitor con bridge Java) ===
        if (isNativeAndroid()) {
            try {
                // ── CAPA 1: Arrancar el Foreground Service Java REAL ──
                if (_hasNativeBridge()) {
                    console.log('📱 AndroidServices: 🔥 CAPA 1 — Arrancando LocationTrackingService via NativeServiceBridge');
                    console.log(`📱 AndroidServices: userId=${userId} | driverName=${driverName} | fleetId=${fleetId}`);
                    
                    // Pasar userId, driverName y fleetId al Service
                    window.NativeServiceBridge.startTracking(userId, driverName, fleetId);
                    
                    _nativeGPSActive = true;
                    console.log('📱 AndroidServices: ✅ LocationTrackingService ARRANCADO — GPS nativo + Firebase Direct');
                } else {
                    console.warn('📱 AndroidServices: ⚠️ NativeServiceBridge NO disponible — el Service Java NO se arrancó');
                }

                // ── CAPA 2: BackgroundMode plugin (desactiva JS throttling) ──
                if (Capacitor.Plugins.BackgroundMode) {
                    try {
                        await Capacitor.Plugins.BackgroundMode.enable();
                        console.log('📱 AndroidServices: ✅ CAPA 2 — BackgroundMode habilitado');

                        // Desactivar optimizaciones del WebView (JS timers throttling)
                        if (Capacitor.Plugins.BackgroundMode.disableWebViewOptimizations) {
                            await Capacitor.Plugins.BackgroundMode.disableWebViewOptimizations();
                            console.log('📱 AndroidServices: ✅ WebView optimizations desactivadas');
                        }

                        await Capacitor.Plugins.BackgroundMode.setSettings({
                            title: 'Punto Remis: Turno activo',
                            text: `📍 GPS de alta precisión — ${vehiclePlate || 'En turno'}`,
                            icon: 'ic_launcher',
                            color: '1e1b4b',
                            resume: true,
                            hidden: false,
                        });
                    } catch (bgErr) {
                        console.warn('📱 AndroidServices: BackgroundMode falló (no crítico):', bgErr.message);
                    }
                }

                return;
            } catch (e) {
                console.error('📱 AndroidServices: Error en ruta nativa:', e);
                // Caer al fallback PWA
            }
        }

        // === RUTA B: FALLBACK PWA (Chrome/Safari en Android) ===
        console.log('📱 AndroidServices: CAPA 3 — Usando fallback PWA (audio silencioso + Wake Lock)');
        enableWebWakeLockHack();

        // Web Notification persistente (simula foreground service en PWA)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && navigator.serviceWorker) {
            try {
                const reg = await navigator.serviceWorker.ready;
                await reg.showNotification('Punto Remis: Turno activo', {
                    body: `📍 GPS de alta precisión — ${vehiclePlate || 'En turno'}`,
                    icon: 'assets/icons/icon-192x192.png',
                    tag: 'gps-tracking-fg',
                    silent: true,
                    requireInteraction: true
                });
            } catch (e) {
                console.warn('📱 AndroidServices: No se pudo mostrar notificación PWA:', e);
            }
        }
    }

    /**
     * Detiene el Foreground Service al finalizar el turno.
     */
    async function disableForegroundService() {
        console.log('📱 AndroidServices: disableForegroundService() llamado');

        _nativeGPSActive = false;

        if (isNativeAndroid()) {
            // ── CAPA 1: Detener el Service Java ──
            if (_hasNativeBridge()) {
                try {
                    window.NativeServiceBridge.stopTracking();
                    console.log('📱 AndroidServices: ✅ LocationTrackingService DETENIDO');
                } catch (e) {
                    console.error('📱 AndroidServices: Error deteniendo Service Java:', e);
                }
            }

            // ── CAPA 2: Desactivar BackgroundMode ──
            try {
                if (Capacitor.Plugins.BackgroundMode) {
                    await Capacitor.Plugins.BackgroundMode.disable();
                    console.log('📱 AndroidServices: ✅ BackgroundMode desactivado');
                }
            } catch (e) {
                console.warn('📱 AndroidServices: Error desactivando BackgroundMode:', e);
            }
        }

        // Limpiar fallback PWA
        disableWebWakeLockHack();

        // Cerrar notificación PWA si existe
        if (navigator.serviceWorker) {
            try {
                const reg = await navigator.serviceWorker.ready;
                const notifications = await reg.getNotifications({ tag: 'gps-tracking-fg' });
                notifications.forEach(n => n.close());
            } catch (e) { /* ignorar */ }
        }
    }

    // =============================================
    // 2. RECEPTOR DE GPS NATIVO
    //
    // El LocationTrackingService.java llama:
    //   window._onNativeGPS(lat, lng, speed, bearing)
    // via evaluateJavascript() desde el thread nativo.
    //
    // PARIDAD: El formato del objeto Firebase es IDÉNTICO
    // al que usa gps-permissions.js/_forceSendPosition()
    // para la ruta Web. Campos:
    //   { lat, lng, heading, speed, battery, driverName, updated_at, _source }
    // =============================================

    function _registerNativeGPSReceiver() {
        if (window._onNativeGPS) {
            console.log('📱 AndroidServices: _onNativeGPS ya registrado');
            return;
        }

        window._onNativeGPS = async function(lat, lng, speed, bearing) {
            _lastNativeGPSTime = Date.now();

            // Validar que estemos en turno activo
            const inShift = localStorage.getItem('active_shift_state') === 'true';
            if (!inShift) return;

            // Obtener userId
            const userId = (typeof Auth !== 'undefined') 
                ? (Auth.getUserId() || Auth.getUserName()) 
                : null;
            if (!userId || typeof firebaseDB === 'undefined') return;

            // Obtener batería
            let batteryLevel = null;
            if (navigator.getBattery) {
                try {
                    const b = await navigator.getBattery();
                    batteryLevel = Math.round(b.level * 100);
                } catch(e) {}
            }

            // ══════════════════════════════════════════════
            // PARIDAD: Mismo formato que _forceSendPosition()
            // en gps-permissions.js (ruta Web)
            // ══════════════════════════════════════════════
            try {
                await firebaseDB.ref(`driver_positions/${userId}`).set({
                    lat: lat,
                    lng: lng,
                    heading: bearing || 0,
                    speed: speed || 0,
                    battery: batteryLevel,
                    driverName: (typeof Auth !== 'undefined') ? Auth.getUserName() || userId : userId,
                    updated_at: new Date().toISOString(),
                    _source: 'native_foreground_service'
                });
            } catch (e) {
                console.warn('📱 _onNativeGPS: Error subiendo a Firebase:', e);
            }
        };

        console.log('📱 AndroidServices: ✅ window._onNativeGPS registrado — esperando coordenadas del Service Java');
    }

    /**
     * Verifica si el GPS nativo está enviando datos.
     * Útil para mostrar warnings si el Service se murió.
     */
    function isNativeGPSAlive() {
        if (!_nativeGPSActive) return false;
        // Considerar "vivo" si recibimos datos en los últimos 15 segundos
        return (Date.now() - _lastNativeGPSTime) < 15000;
    }

    // =============================================
    // 3. SOLICITUD DE EXENCIÓN DE BATERÍA
    //
    // RUTA A: NativeServiceBridge.requestBatteryExemption()
    //   → Intent directo ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
    //   → Diálogo NATIVO del sistema Android
    //
    // RUTA B: BackgroundMode.disableBatteryOptimizations()
    //   → Depende del plugin Cordova
    //
    // RUTA C: App.openAppSettings() → manual del usuario
    // =============================================

    async function requestBatteryExemption() {
        console.log('📱 AndroidServices: requestBatteryExemption() llamado');

        if (!isNativeAndroid()) {
            console.log('📱 AndroidServices: No es Android nativo, saltando battery exemption');
            return;
        }

        // ── RUTA A: Bridge nativo directo (más confiable) ──
        if (_hasNativeBridge()) {
            try {
                window.NativeServiceBridge.requestBatteryExemption();
                console.log('📱 AndroidServices: ✅ Diálogo nativo de batería mostrado');
                return;
            } catch (e) {
                console.warn('📱 AndroidServices: Bridge battery exemption falló:', e);
            }
        }

        // ── RUTA B: BackgroundMode plugin ──
        try {
            if (Capacitor.Plugins.BackgroundMode) {
                const result = await Capacitor.Plugins.BackgroundMode.checkBatteryOptimizations();
                if (!result || !result.disabled) {
                    await Capacitor.Plugins.BackgroundMode.disableBatteryOptimizations();
                    console.log('📱 AndroidServices: ✅ Diálogo de batería mostrado (BackgroundMode)');
                } else {
                    console.log('📱 AndroidServices: ✅ Ya exenta de optimización de batería');
                }
                return;
            }
        } catch (bgErr) {
            console.warn('📱 AndroidServices: BackgroundMode battery check falló:', bgErr);
        }

        // ── RUTA C: Fallback manual ──
        if (Capacitor.Plugins.App && Capacitor.Plugins.App.openAppSettings) {
            if (typeof Components !== 'undefined') {
                Components.showToast(
                    '⚡ Andá a "Batería" → "Sin restricciones" para que el GPS funcione con la pantalla apagada',
                    'warning'
                );
            }
            await Capacitor.Plugins.App.openAppSettings();
        }
    }

    /**
     * Pide permiso de UBICACIÓN EN SEGUNDO PLANO (Background Location)
     * Requerido para Android 10+ para que el GPS no se corte.
     */
    async function requestBackgroundLocationPermission() {
        if (!isNativeAndroid()) return true;

        try {
            // v10: NativeServiceBridge.requestBackgroundLocationPermission()
            // Llama al Intent nativo de Android 10+ (Allow all the time)
            if (_hasNativeBridge() && window.NativeServiceBridge.requestBackgroundLocationPermission) {
                console.log('📱 AndroidServices: Solicitando permiso Background Location via Bridge');
                window.NativeServiceBridge.requestBackgroundLocationPermission();
                return true;
            }
            
            // Fallback: abrir configuración de la app
            if (Capacitor.Plugins.App && Capacitor.Plugins.App.openAppSettings) {
                await Capacitor.Plugins.App.openAppSettings();
                return true;
            }
        } catch (e) {
            console.error('📱 AndroidServices: Error pidiendo background location:', e);
            return false;
        }
    }

    /**
     * Muestra un diálogo explicativo de por qué necesitamos la ubicación "Todo el tiempo".
     * Exigido por las políticas de Google Play.
     */
    function showBackgroundLocationDialog(onConfirm) {
        if (!isNativeAndroid()) {
            if (onConfirm) onConfirm();
            return;
        }

        const bodyHTML = `
            <div style="text-align:center; padding:var(--space-2);">
                <div style="font-size:3.5rem; margin-bottom:var(--space-4);">📍</div>
                <h3 style="font-size:var(--font-size-xl); font-weight:800; margin-bottom:var(--space-3); color:var(--text-primary);">
                    Ubicación en Segundo Plano
                </h3>
                <p style="font-size:var(--font-size-sm); color:var(--text-secondary); margin-bottom:var(--space-4); line-height:1.6;">
                    Punto Alertas recopila datos de ubicación para permitir el <strong>seguimiento en tiempo real de tu vehículo</strong> y el <strong>envío de alertas de seguridad</strong> incluso cuando la aplicación está cerrada o no está en uso.
                </p>
                <div style="background:rgba(59,130,246,0.1); border-radius:var(--radius-lg); padding:var(--space-4); text-align:left; border:1px solid rgba(59,130,246,0.2);">
                    <div style="font-weight:700; color:#3b82f6; margin-bottom:var(--space-2); font-size:var(--font-size-sm);">
                        💡 Instrucción para el siguiente paso:
                    </div>
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin:0;">
                        Seleccioná la opción <strong>"Permitir todo el tiempo"</strong> (o "Allow all the time") para asegurar que el sistema de SOS y Radar funcione correctamente mientras conducís.
                    </p>
                </div>
            </div>
        `;

        Components.showModal(
            '📍 Permiso de Ubicación',
            bodyHTML,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">Después</button>
                <button class="btn btn-primary" style="min-width:180px;" onclick="Components.closeModal(); AndroidServices.requestBackgroundLocationPermission(); if(${!!onConfirm}) { (${onConfirm.toString()})() }">
                    Configurar Ahora
                </button>
            `,
            { staticBackdrop: true }
        );
    }

    /**
     * Muestra un modal explicativo ANTES de pedir la exención.
     * Los usuarios tienden a rechazar diálogos del sistema sin leerlos.
     */
    function showBatteryExemptionDialog() {
        if (!isNativeAndroid()) return;
        if (typeof Components === 'undefined') return;

        // Si el bridge nativo detecta que ya está exenta, no mostrar
        if (_hasNativeBridge()) {
            try {
                if (!window.NativeServiceBridge.isBatteryOptimized()) {
                    console.log('📱 AndroidServices: ✅ Ya exenta — no se muestra diálogo');
                    return;
                }
            } catch (e) {}
        }

        const bodyHTML = `
            <div style="text-align:center; padding:8px 0;">
                <div style="font-size:3rem; margin-bottom:12px;">🔋</div>
                <div style="font-size:1.1rem; font-weight:700; color:var(--text-primary); margin-bottom:16px;">
                    Permiso de Batería Requerido
                </div>
                <div style="font-size:0.9rem; color:var(--text-secondary); line-height:1.6; margin-bottom:20px; padding:0 8px;">
                    Para que el <strong>GPS funcione con la pantalla apagada</strong>, 
                    Android necesita que pongas la app en <strong>"Sin restricciones"</strong>.
                </div>
                <div style="margin-top:16px; padding:12px; background:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.3); border-radius:12px; text-align:left;">
                    <div style="font-size:0.85rem; color:#fde047; font-weight:600; margin-bottom:6px;">⚡ En el siguiente paso:</div>
                    <ul style="font-size:0.8rem; color:var(--text-secondary); margin:0; padding-left:16px; line-height:1.8;">
                        <li>Tocá <strong>"Permitir"</strong> en el diálogo del sistema</li>
                        <li>Esto evita que Android mate el GPS cuando apagás la pantalla</li>
                    </ul>
                </div>
            </div>
        `;

        const footerHTML = `
            <button class="btn btn-ghost" onclick="Components.closeModal()">Después</button>
            <button class="btn btn-primary" style="min-width:160px;" onclick="Components.closeModal(); AndroidServices.requestBatteryExemption();">
                ⚡ Configurar Ahora
            </button>
        `;

        Components.showModal('⚡ Optimización de Batería', bodyHTML, footerHTML);
    }

    // =============================================
    // 4. WEB WAKELOCK HACK (Fallback PWA)
    //
    // Para cuando la app se ejecuta como PWA en Chrome
    // (no como APK nativo con Capacitor).
    // Reproduce audio silencioso para que Android piense
    // que es una app de música y no suspenda el JS.
    // =============================================

    function enableWebWakeLockHack() {
        if (_silentAudio) return;
        try {
            // WAV silencioso mínimo en base64 (44 bytes)
            const silentURI = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
            _silentAudio = new Audio(silentURI);
            _silentAudio.loop = true;
            _silentAudio.volume = 0.01;

            const p = _silentAudio.play();
            if (p !== undefined) {
                p.then(() => {
                    console.log('🛡️ WebWakeLock: Audio silencioso activado — PWA no se suspenderá');
                }).catch(() => {
                    console.warn('🛡️ WebWakeLock: Audio silencioso bloqueado por autoplay policy');
                });
            }
        } catch (e) {
            console.warn('🛡️ WebWakeLock: Error activando audio silencioso:', e);
        }

        // Screen Wake Lock API (complementario)
        if ('wakeLock' in navigator) {
            navigator.wakeLock.request('screen').then(lock => {
                console.log('🛡️ WebWakeLock: Screen Wake Lock adquirido');
            }).catch(e => {
                console.warn('🛡️ WebWakeLock: Screen Wake Lock no disponible:', e.message);
            });
        }
    }

    function disableWebWakeLockHack() {
        if (_silentAudio) {
            try {
                _silentAudio.pause();
                _silentAudio.src = '';
            } catch (e) { /* ignorar */ }
            _silentAudio = null;
            console.log('🛡️ WebWakeLock: Audio silencioso detenido');
        }
    }

    // =============================================
    // 5. INICIALIZACIÓN AUTOMÁTICA
    //
    // Si estamos en Capacitor, registrar el receptor
    // de GPS nativo al cargar el módulo.
    // =============================================

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                if (isNativeAndroid()) {
                    _registerNativeGPSReceiver();
                    console.log('📱 AndroidServices: Módulo inicializado en modo NATIVO');
                    console.log('📱 AndroidServices: NativeServiceBridge disponible:', _hasNativeBridge());
                } else {
                    console.log('📱 AndroidServices: Módulo inicializado en modo WEB/PWA');
                }
            });
        } else {
            if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
                _registerNativeGPSReceiver();
            }
        }
    }

    // =============================================
    // API PÚBLICA
    // =============================================

    return {
        // Detección
        isNativeAndroid,
        isCapacitorAvailable,
        
        // Foreground Service
        enableForegroundService,
        disableForegroundService,
        
        // GPS nativo
        isNativeGPSAlive,
        
        // Batería
        requestBackgroundLocationPermission,
        showBackgroundLocationDialog,
        requestBatteryExemption,
        showBatteryExemptionDialog,
        
        // PWA fallbacks
        enableWebWakeLockHack,
        disableWebWakeLockHack
    };

})();
