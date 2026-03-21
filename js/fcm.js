/* ============================================
   FleetAdmin Pro — Firebase Cloud Messaging (FCM)
   Token management for background push notifications
   ============================================ */

const FCM = (() => {
    let _messaging = null;
    let _currentToken = null;

    /**
     * Obtiene la VAPID key desde:
     * 1. localStorage (configurada por el admin en Settings)
     * 2. Firebase RTDB setting 'fcm_vapid_key'
     * Retorna null si no está configurada.
     */
    async function _getVapidKey() {
        // 1. Primero probar localStorage (más rápido)
        const localKey = localStorage.getItem('fleetadmin_vapid_key');
        if (localKey && localKey.length > 20) {
            return localKey;
        }

        // 2. Fallback: leer de Firebase RTDB (configurada por el admin)
        try {
            const dbKey = await DB.getSetting('fcm_vapid_key');
            if (dbKey && dbKey.length > 20) {
                // Cachear en localStorage para la próxima vez
                localStorage.setItem('fleetadmin_vapid_key', dbKey);
                return dbKey;
            }
        } catch (e) {
            console.warn('🔔 FCM: Error leyendo VAPID key de RTDB:', e.message);
        }

        return null;
    }

    /**
     * Inicializa FCM: pide permisos, obtiene token y lo guarda en Firebase RTDB.
     * Llamar después del login exitoso.
     */
    async function init() {
        try {
            // Verificar soporte
            if (!('Notification' in window)) {
                console.log('🔔 FCM: Notification API no soportada');
                return null;
            }

            if (!firebase.messaging) {
                console.warn('🔔 FCM: firebase.messaging no disponible (SDK no cargado)');
                return null;
            }

            // Solicitar permisos de notificación
            const permission = await Notification.requestPermission();
            console.log('🔔 FCM: Permiso de notificaciones:', permission);

            if (permission !== 'granted') {
                console.warn('🔔 FCM: Permiso denegado — no se puede obtener token FCM');
                return null;
            }

            // Obtener VAPID key
            const vapidKey = await _getVapidKey();
            if (!vapidKey) {
                console.warn('🔔 FCM: ⚠️ VAPID key NO configurada — FCM Push DESHABILITADO');
                console.warn('🔔 FCM: 📋 El admin debe configurarla en:');
                console.warn('🔔 FCM:    Settings → 🔔 Push Notifications → VAPID Key');
                console.warn('🔔 FCM:    Obtenerla de: https://console.firebase.google.com/project/fleetadmin-pro/settings/cloudmessaging');
                return null;
            }

            // Inicializar Firebase Messaging
            _messaging = firebase.messaging();

            // Obtener token FCM con VAPID key
            const swRegistration = await navigator.serviceWorker?.getRegistration();
            const tokenOptions = {
                vapidKey: vapidKey,
                serviceWorkerRegistration: swRegistration
            };

            _currentToken = await _messaging.getToken(tokenOptions);

            if (_currentToken) {
                console.log('🔔 FCM: ✅ Token obtenido:', _currentToken.substring(0, 20) + '...');
                await _saveToken(_currentToken);
                _setupTokenRefresh(vapidKey);
                _setupForegroundHandler();
                return _currentToken;
            } else {
                console.warn('🔔 FCM: No se pudo obtener token (VAPID key inválida o SW no registrado)');
                return null;
            }

        } catch (error) {
            console.error('🔔 FCM: ❌ Error inicializando:', error.message || error);
            // No bloquear el flujo de login por un error de FCM
            return null;
        }
    }

    /**
     * Guarda el FCM token en Firebase RTDB bajo /fcm_tokens/{userId}
     */
    async function _saveToken(token) {
        try {
            const user = Auth.getUser();
            if (!user) {
                console.warn('🔔 FCM: No hay usuario logueado, no se puede guardar token');
                return;
            }

            const userId = user.id || Auth.getUserName();
            const tokenData = {
                token: token,
                userId: userId,
                userName: user.name || Auth.getUserName(),
                role: user.role || 'unknown',
                fleetId: user.fleetId || Auth.getFleetId() || 'unknown',
                platform: _detectPlatform(),
                updatedAt: new Date().toISOString()
            };

            await firebaseDB.ref(`fcm_tokens/${userId}`).set(tokenData);
            console.log('🔔 FCM: ✅ Token guardado en RTDB para:', userId);

        } catch (error) {
            console.error('🔔 FCM: ❌ Error guardando token:', error.message || error);
        }
    }

    /**
     * Detecta la plataforma del dispositivo
     */
    function _detectPlatform() {
        const ua = navigator.userAgent || '';
        if (/android/i.test(ua)) return 'android';
        if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
        if (/Windows/.test(ua)) return 'windows';
        if (/Mac/.test(ua)) return 'mac';
        return 'web';
    }

    /**
     * Configura listener para refresh de token
     */
    function _setupTokenRefresh(vapidKey) {
        if (!_messaging) return;
        try {
            if (typeof _messaging.onTokenRefresh === 'function') {
                _messaging.onTokenRefresh(async () => {
                    console.log('🔔 FCM: 🔄 Token refreshed');
                    try {
                        const swRegistration = await navigator.serviceWorker?.getRegistration();
                        const tokenOptions = {
                            vapidKey: vapidKey,
                            serviceWorkerRegistration: swRegistration
                        };
                        const newToken = await _messaging.getToken(tokenOptions);
                        if (newToken) {
                            _currentToken = newToken;
                            await _saveToken(newToken);
                        }
                    } catch (e) {
                        console.error('🔔 FCM: Error en token refresh:', e);
                    }
                });
            }
        } catch (e) {
            console.warn('🔔 FCM: onTokenRefresh no disponible:', e.message);
        }
    }

    /**
     * Handler para mensajes recibidos cuando la app está en foreground.
     * En foreground, FCM NO muestra notificación automática,
     * pero el listener onSnapshot ya maneja este caso (pantalla roja, sirena, etc.)
     * Solo logueamos para diagnóstico.
     */
    function _setupForegroundHandler() {
        if (!_messaging) return;
        try {
            _messaging.onMessage((payload) => {
                console.log('🔔 FCM: 📩 Mensaje recibido en FOREGROUND (ignorado — onSnapshot lo maneja):', payload);
            });
        } catch (e) {
            console.warn('🔔 FCM: Error configurando foreground handler:', e);
        }
    }

    /**
     * Elimina el token FCM de Firebase RTDB (llamar al hacer logout)
     */
    async function removeToken() {
        try {
            const user = Auth.getUser();
            const userId = user?.id || Auth.getUserName();
            if (userId) {
                await firebaseDB.ref(`fcm_tokens/${userId}`).remove();
                console.log('🔔 FCM: 🗑️ Token eliminado de RTDB para:', userId);
            }

            // Eliminar token del dispositivo también
            if (_messaging) {
                try {
                    await _messaging.deleteToken();
                    console.log('🔔 FCM: 🗑️ Token eliminado del dispositivo');
                } catch (e) {
                    // Ignorar — puede fallar si el SW no está activo
                }
            }

            _currentToken = null;
        } catch (error) {
            console.error('🔔 FCM: Error eliminando token:', error.message || error);
        }
    }

    /**
     * Retorna el token FCM actual (puede ser null)
     */
    function getToken() {
        return _currentToken;
    }

    /**
     * Guardar VAPID key (llamado desde Settings)
     */
    async function setVapidKey(key) {
        if (!key || key.length < 20) {
            console.warn('🔔 FCM: VAPID key inválida (demasiado corta)');
            return false;
        }
        localStorage.setItem('fleetadmin_vapid_key', key);
        try {
            await DB.setSetting('fcm_vapid_key', key);
            console.log('🔔 FCM: ✅ VAPID key guardada');
        } catch (e) {
            console.warn('🔔 FCM: Error guardando VAPID key en RTDB:', e.message);
        }
        // Reinicializar FCM con la nueva key
        return await init();
    }

    /**
     * Verifica si FCM está completamente configurado
     */
    async function isConfigured() {
        const key = await _getVapidKey();
        return !!(key && key.length > 20);
    }

    return { init, removeToken, getToken, setVapidKey, isConfigured };
})();
