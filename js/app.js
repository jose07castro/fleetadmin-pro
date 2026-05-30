// ==========================================
// 🛡️ AJUSTE ANTIGRAVITY - MODO WEB
// ==========================================
// import { BackgroundMode } from '@anuradev/capacitor-background-mode';

/* ============================================
   FleetAdmin Pro — Archivo Principal
   Inicialización de la aplicación PWA
   con sincronización Firebase en tiempo real
   ============================================ */

const App = (() => {

    // Listener refs para limpieza
    let realtimeListenersActive = false;

    // Auto-despertar servidor (Keep-Alive) para evitar que Render duerma el servicio
    function startWebHeartbeat() {
        const heartbeat = () => {
            fetch('/api/bot/status')
                .then(r => console.log('🏓 Keep-alive ping enviado'))
                .catch(e => console.warn('⚠️ Falló keep-alive:', e));
        };
        heartbeat(); // Ejecutar inmediatamente al cargar
        setInterval(heartbeat, 5 * 60 * 1000); // cada 5 minutos
    }

    // Inicializar la aplicación
    async function init() {
        try {
            // 0. Verificar versión de la app (In-App forced update check)
            const versionOk = await checkAppVersion();
            if (!versionOk) return; // Detener inicio de la app

            // 0. Iniciar keep-alive del bot (Modo Web)
            startWebHeartbeat();

            // 0.5. Configurar Pull-To-Refresh visual (v122)
            setupPullToRefresh();

            // 1. Inicializar sistema de idiomas
            I18n.init();

            // 1.5. Inicializar panel de personalización UI (v110)
            if (typeof UISettings !== 'undefined') {
                UISettings.init();
            }

            // 2. Conectar a Firebase (con timeout defensivo)
            try {
                const splashStatus = document.getElementById('splashStatus');
                if (splashStatus) splashStatus.innerText = 'Conectando con la base de datos...';
                await DB.open();
            } catch (dbErr) {
                console.warn('⚠️ Firebase open() falló, continuando:', dbErr);
            }

            // 3. Seed (no-op en multi-tenencia, migración en login)
            try {
                await DB.seed();
            } catch (seedErr) {
                console.warn('⚠️ DB seed() falló, continuando:', seedErr);
            }

            // 3.5. Activar manejo de reconexión (móvil)
            setupReconnectionHandler();

            // 4. Navegar a la ruta correcta
            // USAR isLoggedInAsync() para recuperar sesión desde IndexedDB si Android mató el proceso
            setTimeout(async () => {
                try {
                    const splashStatus = document.getElementById('splashStatus');
                    if (splashStatus) splashStatus.innerText = 'Verificando seguridad...';
                    
                    const loggedIn = await Auth.isLoggedInAsync();
                    if (loggedIn) {
                        console.log('🔐 Sesión activa confirmada (incluyendo recovery IndexedDB)');
                        
                        // 4.5 Cargar tema del usuario
                        const currentUserId = Auth.getUserId();
                        if (currentUserId) {
                            await applyUserTheme(currentUserId);
                        }

                        // Reportar versión al servidor al recuperar sesión
                        reportAppVersionToServer();

                        // Bloqueo de perfil incompleto al restaurar sesión
                        if (Auth.isDriver()) {
                            try {
                                const profileOk = await Auth.isProfileComplete();
                                if (!profileOk) {
                                    _hideSplash();
                                    Router.navigate('complete-profile');
                                    startRealtimeSync();
                                    return;
                                }
                            } catch (profileErr) {
                                // Error de red verificando perfil — NO bloquear, dejar pasar
                                console.warn('📱 Error verificando perfil (red), continuando:', profileErr);
                            }

                            // Sincronizar turno activo/GPS al iniciar la app
                            await syncActiveShiftGPS();
                        }
                        _hideSplash();
                        Router.navigate(Router.getDefaultRoute());
                        // 6. Activar sincronización en tiempo real
                        startRealtimeSync();
                        // 7. Iniciar checker de notificaciones locales
                        if (typeof Notifications !== 'undefined') {
                            Notifications.init();
                        }
                        // 8. Activar listener SOS para TODOS (dueños y conductores)
                        if (typeof SOSModule !== 'undefined') {
                            SOSModule.startListening();
                        }
                        // 8.5 Activar detección de alertas de tráfico (WhatsApp)
                        if (typeof TrafficAlerts !== 'undefined') {
                            TrafficAlerts.init();
                        }
                        // 8.6 Activar comandos de voz (Manos Libres)
                        if (typeof VoiceModule !== 'undefined') {
                            VoiceModule.init();
                        }
                        // 9. Mostrar banner PWA de instalación (solo drivers móviles)
                        if (typeof PWAInstall !== 'undefined') {
                            setTimeout(() => PWAInstall.showBanner(), 2000);
                        }
                    } else {
                        _hideSplash();
                        Router.navigate('login');
                    }
                } catch (navError) {
                    console.error('🔴 Error en navegación post-init:', navError);
                    _hideSplash();
                    _showConnectionError(navError);
                }
            }, 800);

        } catch (error) {
            console.error('Error al inicializar la aplicación:', error);
            _hideSplash();
            _showConnectionError(error);
        }
    }

    // --- Helper: ocultar splash screen ---
    function _hideSplash() {
        const splash = document.getElementById('splash-screen');
        if (splash) splash.classList.add('hidden');
    }

    // --- Helper: mostrar pantalla de error de conexión (NUNCA dejar blanco) ---
    function _showConnectionError(error) {
        document.getElementById('app').innerHTML = `
            <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; background:rgba(15,23,42,0.95);">
                <div style="text-align:center; padding:2rem; max-width:400px;">
                    <div style="font-size:3rem; margin-bottom:1rem;">📡</div>
                    <h2 style="color:#f1f5f9; margin-bottom:0.5rem;">Conectando...</h2>
                    <p style="color:#94a3b8; margin-bottom:0.5rem; font-size:0.9rem;">
                        Error al conectar con el servidor. Verificá tu conexión a internet.
                    </p>
                    <p style="color:#64748b; margin-bottom:1.5rem; font-size:0.75rem;">
                        ${error?.message || 'Error desconocido'}
                    </p>
                    <button onclick="location.reload()" style="background:linear-gradient(135deg,#6366f1,#06b6d4); color:white; border:none; padding:12px 32px; border-radius:12px; font-size:1rem; font-weight:600; cursor:pointer;">
                        🔄 Reintentar
                    </button>
                </div>
            </div>`;
    }

    // --- Sincronización en tiempo real ---
    function startRealtimeSync() {
        if (realtimeListenersActive) return;
        realtimeListenersActive = true;

        const stores = ['users', 'vehicles', 'shifts', 'oilLogs', 'repairs', 'beltChanges'];
        let initialLoad = {};

        stores.forEach(store => {
            initialLoad[store] = true;
            DB.onChanges(store, (items) => {
                // Ignorar la primera carga (ya se renderizó)
                if (initialLoad[store]) {
                    initialLoad[store] = false;
                    return;
                }

                console.log(`🔄 Sync: ${store} actualizado (${items.length} items)`);

                // Sincronizar turno activo/GPS si cambian los turnos
                if (store === 'shifts' && typeof Auth !== 'undefined' && Auth.isDriver()) {
                    syncActiveShiftGPS();
                }

                // Refrescar la vista actual si hay cambios
                const currentRoute = Router.getCurrentRoute();
                if (currentRoute && currentRoute !== 'login') {
                    Router.navigate(currentRoute);
                }
            });
        });

        // ☠️ v107: migrateShiftPhotos() EXTIRPADA del código
        // La función fue eliminada permanentemente de DB.

        console.log('📡 Sincronización en tiempo real activada');
    }

    // --- Detener sincronización ---
    function stopRealtimeSync() {
        if (!realtimeListenersActive) return;

        const stores = ['users', 'vehicles', 'shifts', 'oilLogs', 'repairs', 'beltChanges'];
        stores.forEach(store => {
            DB.offChanges(store);
        });

        realtimeListenersActive = false;
        console.log('📡 Sincronización en tiempo real desactivada');
    }

    // Cerrar sesión (completo: limpia listeners, Firebase Auth, storage)
    async function logout() {
        // Confirmación para evitar toques accidentales
        const confirmed = confirm('¿Cerrar sesión?\nSe desconectará de esta cuenta.');
        if (!confirmed) return;

        // Si es chofer, registramos la desconexión voluntaria en el servidor ANTES de limpiar nada
        if (typeof Auth !== 'undefined' && Auth.isDriver()) {
            let toastId = null;
            if (typeof Components !== 'undefined' && typeof Components.showToast === 'function') {
                toastId = Components.showToast('Registrando desconexión en el servidor...', 'info');
            }

            const driverId = Auth.getUserId();
            const fleetId = Auth.getFleetId();
            const baseUrl = (window.location.hostname === 'localhost' || 
                             window.location.hostname === '127.0.0.1' ||
                             window.location.protocol === 'file:') 
                             ? 'https://fleetadmin-web-nueva.onrender.com' 
                             : window.location.origin;

            try {
                const response = await fetch(`${baseUrl}/api/auth/logout-voluntario`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        driver_id: driverId,
                        fleetId: fleetId,
                        timestamp: Date.now(),
                        driverName: Auth.getUserName()
                    })
                });

                if (!response.ok) {
                    throw new Error('El servidor retornó código de error: ' + response.status);
                }
                console.log('✅ Desconexión voluntaria confirmada por el servidor');
            } catch (e) {
                // Error no crítico: el logout local igual procede
                console.warn('⚠️ No se pudo registrar desconexión en el servidor (el logout local continuará):', e.message);
            }
        }

        try {
            // Detener el Foreground Service de rastreo GPS en Android
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.disableForegroundService === 'function') {
                try {
                    await AndroidServices.disableForegroundService();
                } catch (e) {
                    console.warn('Error desactivando foreground service:', e);
                }
            }
            // 1. Detener sincronización en tiempo real (Firebase listeners)
            stopRealtimeSync();

            // 2. Detener SOS listener si está activo
            if (typeof SOSModule !== 'undefined' && typeof SOSModule.stopListening === 'function') {
                try { SOSModule.stopListening(); } catch (e) { /* ignorar */ }
            }

            // 3. Detener notifications checker si está activo
            if (typeof Notifications !== 'undefined' && typeof Notifications.stop === 'function') {
                try { Notifications.stop(); } catch (e) { /* ignorar */ }
            }

            // 4. Cerrar sesión en Firebase Auth
            try {
                await firebase.auth().signOut();
                console.log('🔒 Firebase Auth: sesión cerrada');
            } catch (e) {
                console.warn('Firebase Auth signOut error (no crítico):', e);
            }

            // 5. Desconectar Firebase Realtime Database
            try {
                firebase.database().goOffline();
            } catch (e) { /* ignorar */ }

            // 6. Limpiar estado de Auth (localStorage, sessionStorage, currentUser)
            Auth.logout();

            // 7. Redirigir forzosamente a login
            Router.navigate('login');

            console.log('🚪 Sesión cerrada correctamente');
        } catch (error) {
            console.error('Error durante logout:', error);
            // Forzar limpieza y navegación aunque haya error
            Auth.logout();
            Router.navigate('login');
        }
    }

    // Cambiar idioma y refrescar la vista actual
    function setLanguage(lang) {
        I18n.setLanguage(lang);
        Router.navigate(Router.getCurrentRoute() || 'login');
    }

    // Cambiar unidad de distancia y refrescar
    function setDistanceUnit(unit) {
        Units.setDistanceUnit(unit);
        Router.navigate(Router.getCurrentRoute());
    }

    // Cambiar unidad de volumen y refrescar
    function setVolumeUnit(unit) {
        Units.setVolumeUnit(unit);
        Router.navigate(Router.getCurrentRoute());
    }

    // Toggle sidebar en móvil
    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar) {
            sidebar.classList.toggle('open');
            if (overlay) overlay.classList.toggle('active');
        }
    }

    // Aplicar tema guardado por el usuario
    async function applyUserTheme(userId) {
        if (!userId) return;
        try {
            const prefs = await DB.getUserPreferences(userId);
            const isAndroid = /Android/i.test(navigator.userAgent);
            const layoutKey = isAndroid ? 'config_android' : 'config_web';
            const theme = prefs[layoutKey]?.theme;
            
            if (theme) {
                if (theme.primary) document.documentElement.style.setProperty('--color-primary', theme.primary);
                if (theme.bg) {
                    document.documentElement.style.setProperty('--bg-primary', theme.bg);
                    document.body.style.backgroundImage = 'none';
                }
                if (theme.font) document.documentElement.style.setProperty('--font-size-base', theme.font);
            }
        } catch (e) {
            console.warn('⚠️ Error aplicando tema:', e);
        }
    }

    // --- Reconexión al volver del segundo plano (móvil) ---

    function setupReconnectionHandler() {
        // Al volver a la pestaña (después de que el SO la mató o puso en background)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('📱 App volvió al primer plano');
                _restoreSessionOnResume();
            } else {
                // Al ir a background: hacer un ping a Firebase para mantener conexión
                try {
                    firebaseDB.ref('.info/connected').once('value');
                    console.log('📱 App en background — ping Firebase enviado');
                } catch(e) { /* ignorar */ }
            }
        });

        // Algunos mobile browsers disparan pageshow en lugar de visibilitychange
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                console.log('📱 Página restaurada desde bfcache');
                _restoreSessionOnResume();
            }
        });

        // Al recuperar conexión WiFi/datos
        window.addEventListener('online', () => {
            console.log('🌐 Conexión recuperada');
            // Forzar reconexión de Firebase
            try { firebase.database().goOnline(); } catch(e) {}
            if (Auth.isLoggedIn()) {
                // Reiniciar SOS listener (se muere en cambios WiFi↔4G)
                if (typeof SOSModule !== 'undefined') {
                    console.log('🌐 Reiniciando SOS listener después de reconexión...');
                    try { SOSModule.stopListening(); } catch(e) {}
                    try { SOSModule.startListening(); } catch(e) {
                        console.error('🌐 Error reiniciando SOS listener:', e);
                    }
                }
                // Refrescar vista actual
                const currentRoute = Router.getCurrentRoute();
                if (currentRoute && currentRoute !== 'login') {
                    Router.navigate(currentRoute);
                }
            }
        });

        // Al perder conexión
        window.addEventListener('offline', () => {
            console.warn('📱 Sin conexión — modo offline');
        });
    }

    // Restaurar sesión y refrescar vista si estamos logueados
    // REGLA DE ORO: NUNCA redirigir a login por un error de red.
    async function _restoreSessionOnResume() {
        // Debounce: no restaurar más de 1 vez cada 3 segundos 
        const now = Date.now();
        if (now - _lastResumeTime < 3000) return;
        _lastResumeTime = now;

        try {
            // 1. Recuperar sesión con cascada completa (localStorage > sessionStorage > IndexedDB)
            const user = await Auth.recoverSession();
            if (!user) {
                // Las 3 capas de almacenamiento están vacías — esto SÍ es un logout real
                console.warn('📱 No hay sesión en ninguna capa de almacenamiento — redirigir a login');
                Router.navigate('login');
                return;
            }

            console.log('📱 Sesión encontrada:', user.name, '| Rol:', user.role, '| Fleet:', user.fleetId);

            // 2. Asegurar que el fleetId está configurado
            if (user.fleetId) {
                DB.setFleet(user.fleetId);
            }

            // 2.5. Cargar tema de usuario
            if (user.id) {
                await applyUserTheme(user.id);
            }

            // 3. Reconectar Firebase Realtime Database (no bloqueante)
            try {
                firebase.database().goOnline();
                console.log('📱 Firebase DB reconectada');
            } catch (e) {
                console.warn('📱 No se pudo reconectar Firebase (no crítico):', e);
            }

            // 4. Re-verificar conectividad con Firebase — timeout corto, NO bloquear
            try {
                await Promise.race([
                    DB.open(),
                    new Promise(resolve => setTimeout(resolve, 3000)) // 3s max
                ]);
            } catch (dbErr) {
                // Error de red — NO hacer logout, continuar con datos en caché
                console.warn('📱 Firebase no responde (continuando offline):', dbErr);
            }

            // 5. Reiniciar realtime sync si no está activa
            if (!realtimeListenersActive) {
                startRealtimeSync();
            }

            // 5.5. CRÍTICO: Reiniciar SOS listener (se muere en background móvil)
            if (typeof SOSModule !== 'undefined') {
                console.log('📱 Reiniciando SOS listener después de resume...');
                try { SOSModule.stopListening(); } catch(e) { /* ignorar */ }
                try { SOSModule.startListening(); } catch(e) {
                    console.error('📱 Error reiniciando SOS listener:', e);
                }
            }

            // Sincronizar turno activo/GPS al volver del background
            await syncActiveShiftGPS();

            // 6. SHIFT HYDRATION: Si es conductor, verificar turno activo ANTES de refrescar
            if (Auth.isDriver() && typeof ShiftsModule !== 'undefined') {
                console.log('📱 Conductor detectado — verificando turno activo (hydration)...');
                try {
                    const hadActiveShift = await ShiftsModule.hydrateActiveShift();
                    if (hadActiveShift) {
                        console.log('📱 ✅ Turno activo restaurado correctamente');
                        return; // hydrateActiveShift ya navegó a 'shifts'
                    }
                    console.log('📱 No hay turno activo — continuando navegación normal');
                } catch (shiftErr) {
                    // Error de red consultando turnos — NO bloquear, continuar
                    console.warn('📱 Error en shift hydration (no crítico):', shiftErr);
                }
            }

            // 7. Refrescar la vista actual (esto re-obtiene datos del DB)
            const currentRoute = Router.getCurrentRoute();
            if (currentRoute && currentRoute !== 'login') {
                console.log(`📱 Restaurando vista: ${currentRoute}`);
                Router.navigate(currentRoute);
            }

            // Mostrar banner PWA si aplica (driver que vuelve del background)
            if (typeof PWAInstall !== 'undefined') {
                setTimeout(() => PWAInstall.showBanner(), 1500);
            }
        } catch (e) {
            console.warn('📱 Error al restaurar sesión:', e);
            // REGLA DE ORO: NUNCA hacer logout por un error acá.
            // El usuario puede seguir trabajando con datos cacheados.
            // Solo mostrar un aviso si hay UI disponible.
            if (typeof Components !== 'undefined' && Components.showToast) {
                Components.showToast('📡 Reconectando al servidor...', 'warning');
            }
        }
    }

    // --- Pull To Refresh Web Simulation (v122) ---
    function setupPullToRefresh() {
        let startY = 0;
        let currentY = 0;
        let pulling = false;
        const THRESHOLD = 80; // Distancia mínima para gatillar
        const RESISTANCE = 0.4;

        // Crear contenedor e inyectar en Body
        let container = document.getElementById('pull-refresh-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'pull-refresh-container';
            container.innerHTML = `
                <div id="pull-refresh-circle" style="width:42px; height:42px; background:#ffffff; border-radius:50%; box-shadow:0 4px 12px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; transition: transform 0.1s ease, opacity 0.1s ease; transform: translateY(-40px) scale(0); opacity:0; transform-origin: center; pointer-events: none;">
                    <svg viewBox="0 0 24 24" style="width:22px; height:22px; fill:none; stroke:#6366f1; stroke-width:3.5; stroke-linecap:round; transition: transform 0.1s linear;" id="pull-refresh-svg">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l.73-.73"/>
                    </svg>
                </div>
            `;
            Object.assign(container.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: '999999',
                paddingTop: '12px'
            });
            document.body.appendChild(container);
        }

        const circle = document.getElementById('pull-refresh-circle');
        const svg = document.getElementById('pull-refresh-svg');

        window.addEventListener('touchstart', (e) => {
            // v122: Mejorar detección de scroll al tope para pull-to-refresh
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
            
            if (scrollTop <= 1) { // Pequeño margen para compensar redondeos
                startY = e.touches[0].clientY;
                pulling = true;
            } else {
                pulling = false;
            }
        }, { passive: true });

        window.addEventListener('touchmove', (e) => {
            if (!pulling) return;
            currentY = e.touches[0].clientY;
            const diff = currentY - startY;

            if (diff > 0) {
                // Calculamos distancia con factor de amortiguación
                const pullDist = Math.min(diff * RESISTANCE, 120);
                
                circle.style.transform = `translateY(${pullDist}px) scale(${Math.min(pullDist / 50, 1)})`;
                circle.style.opacity = `${Math.min(pullDist / 35, 1)}`;
                
                // Rotamos dinámicamente el icono
                svg.style.transform = `rotate(${pullDist * 3.5}deg)`;
                
                // Modificar el color del borde cuando se supera el límite de activación
                if (pullDist >= THRESHOLD) {
                    svg.style.stroke = '#10b981'; // Verde éxito
                    circle.style.background = '#ffffff';
                } else {
                    svg.style.stroke = '#6366f1'; // Violeta estándar
                }
            }
        }, { passive: true });

        window.addEventListener('touchend', (e) => {
            if (!pulling) return;
            const diff = currentY - startY;
            const pullDist = diff * RESISTANCE;

            if (pullDist >= THRESHOLD) {
                // Gatillar refresco
                circle.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                circle.style.transform = `translateY(${THRESHOLD}px) scale(1)`;
                svg.style.animation = 'pullSpinFast 0.7s linear infinite';
                
                // CSS in-line para la animación del spinner
                if (!document.getElementById('pull-spin-style')) {
                    const style = document.createElement('style');
                    style.id = 'pull-spin-style';
                    style.textContent = `@keyframes pullSpinFast { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
                    document.head.appendChild(style);
                }

                // Breve delay para feedback visual, luego refrescar vista o recarga total
                setTimeout(() => {
                    const currentRoute = (typeof Router !== 'undefined') ? Router.getCurrentRoute() : null;
                    if (currentRoute && currentRoute !== 'login') {
                        console.log('🔄 Pull-To-Refresh: Recargando ruta ' + currentRoute);
                        Router.navigate(currentRoute);
                        if (typeof Components !== 'undefined' && Components.showToast) {
                            Components.showToast('🔄 Datos actualizados', 'success');
                        }
                    } else {
                        console.log('🔄 Pull-To-Refresh: Forzando reload de página completo.');
                        window.location.reload();
                    }
                    
                    // Contraer y ocultar después de completar
                    setTimeout(() => {
                        circle.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
                        circle.style.transform = `translateY(-40px) scale(0)`;
                        circle.style.opacity = '0';
                        setTimeout(() => {
                            svg.style.animation = 'none';
                            circle.style.transition = 'none';
                        }, 450);
                    }, 400);
                }, 600);
            } else {
                // Cancelado, colapsar inmediatamente
                circle.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                circle.style.transform = `translateY(-40px) scale(0)`;
                circle.style.opacity = '0';
                setTimeout(() => {
                    circle.style.transition = 'none';
                }, 300);
            }

            pulling = false;
            startY = 0;
            currentY = 0;
        });
    }

    // --- In-App Updates System (Actualizaciones Forzadas) ---
    async function checkAppVersion() {
        if (typeof window.NativeServiceBridge === 'undefined') {
            console.log('🌐 Ejecutándose en modo Web/PWA. Omitiendo verificación de actualización de Play Store.');
            return true; // Continuar normalmente
        }

        try {
            const currentVersionCode = window.NativeServiceBridge.getAppVersionCode();
            const currentVersionName = window.NativeServiceBridge.getAppVersionName();

            // Leer caché por si no hay conexión
            let cachedMinCode = parseInt(localStorage.getItem('min_required_version_code') || '0');
            let cachedMinName = localStorage.getItem('min_required_version_name') || '1.2.44';
            let cachedPlayStoreUrl = localStorage.getItem('play_store_url') || 'https://play.google.com/store/apps/details?id=com.fleetadminpro.app';

            // Si la caché nos dice que ya estamos desactualizados, bloquear de inmediato
            if (cachedMinCode > 0 && currentVersionCode < cachedMinCode) {
                showForcedUpdateScreen(currentVersionName, cachedMinName, cachedPlayStoreUrl);
                return false; // Detener inicio de la app
            }

            // Consultar al servidor
            const response = await fetch('/api/version-check');
            if (response.ok) {
                const data = await response.json();
                const minCode = data.min_required_version_code;
                const minName = data.min_required_version_name;
                const playStoreUrl = data.play_store_url;

                // Guardar en caché para futuras ejecuciones offline
                localStorage.setItem('min_required_version_code', String(minCode));
                localStorage.setItem('min_required_version_name', minName);
                localStorage.setItem('play_store_url', playStoreUrl);

                if (currentVersionCode < minCode) {
                    showForcedUpdateScreen(currentVersionName, minName, playStoreUrl);
                    return false; // Bloquear inicio
                }
            }
        } catch (e) {
            console.warn('⚠️ Error al verificar versión de la app (continuando con caché):', e);
        }
        return true;
    }

    function showForcedUpdateScreen(currentVersion, minVersion, playStoreUrl) {
        _hideSplash();

        // Limpiar todo el cuerpo de la página e inyectar el bloqueo
        const appEl = document.getElementById('app');
        if (!appEl) return;

        // Inyectar estilos para animación
        const styleId = 'forced-update-styles';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                @keyframes scaleIn {
                    from { opacity: 0; transform: scale(0.9); }
                    to { opacity: 1; transform: scale(1); }
                }
                @keyframes float {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-10px); }
                }
            `;
            document.head.appendChild(style);
        }

        appEl.innerHTML = `
            <div id="forced-update-overlay" style="position:fixed; inset:0; z-index:9999999; background:linear-gradient(135deg, #0f172a, #1e293b); display:flex; align-items:center; justify-content:center; padding: 24px; font-family:'Inter',sans-serif; color: #f1f5f9;">
                <div style="max-width:400px; width:100%; text-align:center; padding: 40px 32px; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 24px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); backdrop-filter: blur(16px); transform: scale(1); animation: scaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);">
                    <div style="font-size: 64px; margin-bottom: 24px; animation: float 3s ease-in-out infinite; display: inline-block;">🚀</div>
                    <h2 style="font-size: 24px; font-weight: 800; margin-bottom: 12px; background: linear-gradient(135deg, #a5b4fc, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Actualización Obligatoria</h2>
                    <p style="font-size: 15px; line-height: 1.6; color: #cbd5e1; margin-bottom: 32px;">Actualización obligatoria requerida para salir a trabajar. Por favor, instala la versión más reciente desde Google Play Store para continuar.</p>
                    <a href="${playStoreUrl}" target="_blank" rel="noopener noreferrer" style="display: block; width: 100%; padding: 16px; background: linear-gradient(135deg, #6366f1, #4f46e5); color: #ffffff; text-decoration: none; border-radius: 14px; font-weight: 700; font-size: 16px; box-shadow: 0 10px 15px -3px rgba(99, 102, 241, 0.4); text-align: center; border: none; outline: none; cursor: pointer; transition: transform 0.2s;">
                        ⚡ Actualizar en Play Store
                    </a>
                    <div style="margin-top: 24px; font-size: 12px; color: #64748b;">
                        Versión actual: ${currentVersion} | Mínima requerida: ${minVersion}
                    </div>
                </div>
            </div>
        `;
    }

    async function syncActiveShiftGPS() {
        if (typeof Auth === 'undefined' || !Auth.isDriver()) return;
        try {
            const userId = Auth.getUserId();
            if (!userId) return;

            const activeShifts = await DB.getActiveShifts();
            const activeShift = activeShifts.find(s => String(s.driverId) === String(userId));

            if (activeShift) {
                localStorage.setItem('active_shift_id', activeShift.id);
                localStorage.setItem('active_shift_state', 'true');
                console.log('✅ [GPS] Sincronización: Turno activo detectado → GPS activado:', activeShift.id);

                if (typeof AndroidServices !== 'undefined') {
                    const vehicles = await DB.getAll('vehicles');
                    const vehicle = vehicles.find(v => v.id === activeShift.vehicleId);
                    const vehiclePlate = vehicle ? vehicle.plate : null;
                    
                    console.log('✅ [GPS] Iniciando Foreground Service Nativo...');
                    AndroidServices.enableForegroundService(activeShift.id, vehiclePlate);
                }
            } else {
                const wasActive = localStorage.getItem('active_shift_state') === 'true';
                localStorage.removeItem('active_shift_id');
                localStorage.removeItem('active_shift_state');

                if (wasActive) {
                    console.log('ℹ️ [GPS] Sincronización: Sin turno activo → Deteniendo GPS');
                    if (typeof AndroidServices !== 'undefined') {
                        AndroidServices.disableForegroundService();
                    }
                }
            }
        } catch (e) {
            console.warn('⚠️ [GPS] Error en syncActiveShiftGPS:', e);
        }
    }

    async function reportAppVersionToServer() {
        const user = Auth.getUser();
        if (!user || user.role !== 'driver') return; // Reportar específicamente para conductores

        let version = 'v1.2.44'; // default
        if (typeof window.NativeServiceBridge !== 'undefined') {
            version = 'v' + window.NativeServiceBridge.getAppVersionName();
        }

        try {
            await fetch('/api/driver/report-version', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    driver_id: user.id,
                    fleetId: user.fleetId,
                    version: version
                })
            });
            console.log(`📱 App version reported to server: ${version}`);
        } catch (e) {
            console.warn('⚠️ Error al reportar versión al servidor:', e);
        }
    }

    return { init, logout, setLanguage, setDistanceUnit, setVolumeUnit, toggleSidebar, startRealtimeSync, applyUserTheme, reportAppVersionToServer, syncActiveShiftGPS };
})();

// --- Iniciar la aplicación cuando cargue la página ---
document.addEventListener('DOMContentLoaded', App.init);
