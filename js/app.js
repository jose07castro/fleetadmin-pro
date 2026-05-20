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

        try {
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

    return { init, logout, setLanguage, setDistanceUnit, setVolumeUnit, toggleSidebar, startRealtimeSync, applyUserTheme };
})();

// --- Iniciar la aplicación cuando cargue la página ---
document.addEventListener('DOMContentLoaded', App.init);

// Evitar cierre accidental cuando el turno está activo
window.addEventListener('beforeunload', (e) => {
    const inShift = localStorage.getItem('active_shift_state') === 'true';
    if (inShift) {
        e.preventDefault();
        e.returnValue = 'Tenés un turno activo. Si cerrás la pestaña, se detendrá el rastreo GPS. ¿Seguro que querés salir?';
        return e.returnValue;
    }
});

