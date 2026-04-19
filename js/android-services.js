/* ============================================
   FleetAdmin Pro — Android Native Services v2.0
   
   Puente JS ↔ Android Nativo para:
   1. Foreground Service persistente (GPS en Doze Mode)
   2. Solicitud de exención de batería (Intent nativo)
   3. Recepción de coordenadas del GPS nativo
   4. Fallback PWA para navegadores web
   
   Arquitectura:
   ┌──────────────────────────────────────────────┐
   │  JS (WebView)                                 │
   │  ├─ AndroidServices.enableForegroundService() │
   │  │   → startService(LocationTrackingService)  │
   │  │                                            │
   │  └─ window._onNativeGPS(lat, lng, speed, brg) │
   │      ← evaluateJavascript() del Service Java  │
   └──────────────────────────────────────────────┘
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

    // =============================================
    // 1. FOREGROUND SERVICE — INMORTALIDAD GPS
    // 
    // Se conecta al LocationTrackingService.java nativo
    // que usa startForeground() con foregroundServiceType="location"
    // → Sobrevive a Doze Mode, App Standby, OEM killers
    // =============================================

    async function enableForegroundService(shiftId, vehiclePlate) {
        console.log('📱 AndroidServices: enableForegroundService() llamado');
        console.log(`📱 AndroidServices: shiftId=${shiftId} | plate=${vehiclePlate}`);

        // === RUTA A: NATIVO ANDROID (Capacitor) ===
        if (isNativeAndroid()) {
            try {
                // Registrar el receptor de GPS nativo ANTES de arrancar el servicio
                _registerNativeGPSReceiver();

                // Arrancar el Foreground Service via BackgroundMode plugin
                if (Capacitor.Plugins.BackgroundMode) {
                    await Capacitor.Plugins.BackgroundMode.enable();

                    // Deshabilitar optimizaciones del WebView (throttling de timers)
                    if (Capacitor.Plugins.BackgroundMode.disableWebViewOptimizations) {
                        await Capacitor.Plugins.BackgroundMode.disableWebViewOptimizations();
                    }

                    await Capacitor.Plugins.BackgroundMode.setSettings({
                        title: 'Punto Remis: Turno activo',
                        text: `📍 GPS de alta precisión — ${vehiclePlate || 'En turno'}`,
                        icon: 'ic_launcher',
                        color: '1e1b4b',
                        resume: true,
                        hidden: false,
                        // stopOnTerminate: false → el servicio sigue aunque cierren la app
                        // (requiere plugin que soporte esta opción)
                    });

                    _nativeGPSActive = true;
                    console.log('📱 AndroidServices: ✅ Foreground Service ACTIVADO (BackgroundMode)');
                }
                // Fallback: si no hay BackgroundMode, intentar plugin genérico
                else {
                    console.warn('📱 AndroidServices: BackgroundMode plugin no encontrado');
                    console.warn('📱 AndroidServices: El Service Java arrancará por el WebView hack');
                    // El LocationTrackingService se arranca desde la propia Activity
                    // si tenemos un plugin bridge, o via el hack de audio silencioso
                }

                return;
            } catch (e) {
                console.error('📱 AndroidServices: Error en ruta nativa:', e);
                // Caer al fallback PWA
            }
        }

        // === RUTA B: FALLBACK PWA (Chrome/Safari en Android) ===
        console.log('📱 AndroidServices: Usando fallback PWA (audio silencioso + Wake Lock)');
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
                    requireInteraction: true // No se descarta automáticamente
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
            try {
                if (Capacitor.Plugins.BackgroundMode) {
                    await Capacitor.Plugins.BackgroundMode.disable();
                    console.log('📱 AndroidServices: ✅ Foreground Service DETENIDO');
                }
            } catch (e) {
                console.error('📱 AndroidServices: Error deteniendo Foreground Service:', e);
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
    // Acá recibimos esos datos y los subimos a Firebase.
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

            // Subir a Firebase
            try {
                await firebaseDB.ref(`driver_positions/${userId}`).set({
                    lat: lat,
                    lng: lng,
                    heading: bearing || 0,
                    speed: speed || 0,
                    battery: batteryLevel,
                    driverName: (typeof Auth !== 'undefined') ? Auth.getUserName() || userId : userId,
                    updated_at: new Date().toISOString(),
                    _source: 'native_foreground_service'  // Marca: GPS nativo (no WebView)
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
    // Abre el diálogo nativo de Android:
    // "¿Permitir que FleetAdmin Pro se ejecute sin restricciones?"
    //
    // Esto previene que Doze Mode mate nuestro Service.
    // =============================================

    async function requestBatteryExemption() {
        console.log('📱 AndroidServices: requestBatteryExemption() llamado');

        if (!isNativeAndroid()) {
            console.log('📱 AndroidServices: No es Android nativo, saltando battery exemption');
            return;
        }

        try {
            // Método 1: via BackgroundMode plugin (más común)
            if (Capacitor.Plugins.BackgroundMode) {
                try {
                    const result = await Capacitor.Plugins.BackgroundMode.checkBatteryOptimizations();
                    if (!result || !result.disabled) {
                        console.log('📱 AndroidServices: Solicitando exención de optimización de batería...');
                        await Capacitor.Plugins.BackgroundMode.disableBatteryOptimizations();
                        console.log('📱 AndroidServices: ✅ Diálogo de batería mostrado al usuario');
                    } else {
                        console.log('📱 AndroidServices: ✅ La app ya está exenta de optimización de batería');
                    }
                    return;
                } catch (bgErr) {
                    console.warn('📱 AndroidServices: BackgroundMode battery check falló:', bgErr);
                }
            }

            // Método 2: via App plugin (openAppSettings)  
            // Fallback: enviar al usuario a la pantalla de configuración de la app
            if (Capacitor.Plugins.App && Capacitor.Plugins.App.openAppSettings) {
                console.log('📱 AndroidServices: Abriendo configuración nativa de la app...');
                if (typeof Components !== 'undefined') {
                    Components.showToast(
                        '⚡ Andá a "Batería" → "Sin restricciones" para que el GPS funcione con la pantalla apagada',
                        'warning'
                    );
                }
                await Capacitor.Plugins.App.openAppSettings();
            }
        } catch (e) {
            console.error('📱 AndroidServices: Error solicitando exención de batería:', e);
        }
    }

    /**
     * Muestra un modal explicativo ANTES de pedir la exención.
     * Los usuarios tienden a rechazar diálogos del sistema sin leerlos.
     */
    function showBatteryExemptionDialog() {
        if (!isNativeAndroid()) return;
        if (typeof Components === 'undefined') return;

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
                        <li>Tocá <strong>"Permitir"</strong> en el diálogo</li>
                        <li>Si no aparece, buscá <strong>"Batería → Sin restricciones"</strong></li>
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
        requestBatteryExemption,
        showBatteryExemptionDialog,
        
        // PWA fallbacks
        enableWebWakeLockHack,
        disableWebWakeLockHack
    };

})();
