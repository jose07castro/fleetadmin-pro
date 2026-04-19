/* ============================================
   FleetAdmin Pro — Android Native Services
   Puente con Capacitor para Foreground Service,
   batería y permisos de overlay (Web-Safe)
   ============================================ */

const AndroidServices = (() => {

    /**
     * Verifica si la PWA está siendo ejecutada dentro de un contenedor
     * nativo Capacitor en un dispositivo Android.
     */
    function isNativeAndroid() {
        return (
            typeof Capacitor !== 'undefined' &&
            Capacitor.isNativePlatform() &&
            Capacitor.getPlatform() === 'android'
        );
    }

    /**
     * Activa el Foreground Service con la notificación persistente
     * usando '@anuradev/capacitor-background-mode'.
     */
    async function enableForegroundService(shiftId, vehiclePlate) {
        if (!isNativeAndroid()) return;
        
        try {
            if (Capacitor.Plugins.BackgroundMode) {
                // Habilitamos el modo background continuo (Partial WakeLock nativo)
                await Capacitor.Plugins.BackgroundMode.enable();
                
                // Forzar Wakelock parcial a nivel de WebView si la librería lo soporta
                if (Capacitor.Plugins.BackgroundMode.disableWebViewOptimizations) {
                    await Capacitor.Plugins.BackgroundMode.disableWebViewOptimizations();
                }

                // Configuramos los detalles de la notificación
                await Capacitor.Plugins.BackgroundMode.setSettings({
                    title: 'Punto Remis: Rastreo de seguridad activo',
                    text: `Tracking GPS de alta precisión en viaje (Vehículo: ${vehiclePlate || 'N/A'})`,
                    icon: 'ic_launcher',
                    color: '1e1b4b', // Deep Indigo para mantener el esquema
                    resume: true,
                    hidden: false
                });

                console.log('📱 AndroidServices: Foreground Service (WakeLock parcial) activado.');
            } else {
                console.warn('📱 AndroidServices: Capacitor.Plugins.BackgroundMode no está instalado en el wrapper.');
            }
        } catch (e) {
            console.error('📱 AndroidServices: Error habilitando Foreground Service:', e);
        }
    }

    /**
     * Detiene el Foreground Service al finalizar el turno.
     */
    async function disableForegroundService() {
        if (!isNativeAndroid()) return;
        
        try {
            if (Capacitor.Plugins.BackgroundMode) {
                await Capacitor.Plugins.BackgroundMode.disable();
                console.log('📱 AndroidServices: Foreground Service detenido (Turno finalizado).');
            }
        } catch (e) {
            console.error('📱 AndroidServices: Error deteniendo Foreground Service:', e);
        }
    }

    /**
     * Solicita la excepción de optimización de batería al SO, crucial 
     * para que FCM Alta Prioridad y el GPS funcionen ininterrumpidamente.
     */
    async function requestBatteryExemption() {
        if (!isNativeAndroid()) return;
        
        try {
            if (Capacitor.Plugins.BackgroundMode) {
                // Verificar si ya está exento
                const isIgnoring = await Capacitor.Plugins.BackgroundMode.checkBatteryOptimizations();
                if (!isIgnoring) {
                    console.log('📱 AndroidServices: Solicitando exención de optimización de batería...');
                    await Capacitor.Plugins.BackgroundMode.disableBatteryOptimizations();
                } else {
                    console.log('📱 AndroidServices: La aplicación ya está exenta de las optimizaciones de batería.');
                }
            }
        } catch (e) {
            console.error('📱 AndroidServices: Error solicitando exención de batería:', e);
        }
    }

    /**
     * Preparación de permisos "Dibujar sobre otras apps" 
     * (SYSTEM_ALERT_WINDOW) desde un plugin (Si estuviese disponible o a futuro).
     * El BackgroundMode muchas veces intenta levantar un Intent para esto, 
     * o se usa un App Plugin dedicado.
     */
    async function requestOverlayPermission() {
        if (!isNativeAndroid()) return;
        
        try {
            // Nota: Este plugin y método puede variar según la librería Capacitor específica que tengan instalada.
            // Sirve de preparación lógica y registro para debug si desarrollan su propio plugin Android en java.
            console.log('📱 AndroidServices: Preparando/solicitando permiso SYSTEM_ALERT_WINDOW...');
            
            // Si usan intent plugins o WebViewOverlay, la llamada va aquí.
            if (Capacitor.Plugins.App && Capacitor.Plugins.App.openAppSettings) {
                // A veces, la forma más rápida de obtener permisos de capa especial en capacitor
                // es dirigir al usuario a la página nativa de la app en Settings.
                // Queda preparado en este hook.
            }
        } catch (e) {
            console.error('📱 AndroidServices: Error intentando solicitar Overlay:', e);
        }
    }

    return {
        isNativeAndroid,
        enableForegroundService,
        disableForegroundService,
        requestBatteryExemption,
        requestOverlayPermission
    };

})();
