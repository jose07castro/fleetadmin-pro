/* ============================================
   FleetAdmin Pro — Archivo Principal
   Inicialización de la aplicación PWA
   con sincronización Firebase en tiempo real
   ============================================ */

const App = (() => {

    // Listener refs para limpieza
    let realtimeListenersActive = false;

    // Inicializar la aplicación
    async function init() {
        try {
            // 1. Inicializar sistema de idiomas
            I18n.init();

            // 2. Conectar a Firebase
            await DB.open();

            // 3. Seed (no-op en multi-tenencia, migración en login)
            await DB.seed();

            // 3.5. Activar manejo de reconexión (móvil)
            setupReconnectionHandler();

            // 4. Ocultar pantalla de carga
            setTimeout(() => {
                const splash = document.getElementById('splash-screen');
                if (splash) splash.classList.add('hidden');
            }, 800);

            // 5. Navegar a la ruta correcta
            setTimeout(async () => {
                if (Auth.isLoggedIn()) {
                    // Bloqueo de perfil incompleto al restaurar sesión
                    if (Auth.isDriver()) {
                        const profileOk = await Auth.isProfileComplete();
                        if (!profileOk) {
                            Router.navigate('complete-profile');
                            startRealtimeSync();
                            return;
                        }
                    }
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
                    // 9. Mostrar banner PWA de instalación (solo drivers móviles)
                    if (typeof PWAInstall !== 'undefined') {
                        setTimeout(() => PWAInstall.showBanner(), 2000);
                    }
                } else {
                    Router.navigate('login');
                }
            }, 1000);

        } catch (error) {
            console.error('Error al inicializar la aplicación:', error);
            document.getElementById('app').innerHTML = `
                <div class="login-screen">
                    <div class="login-container" style="text-align:center;">
                        <div style="font-size:3rem; margin-bottom:var(--space-4);">❌</div>
                        <h2>${I18n.t('error')}</h2>
                        <p style="color:var(--text-secondary); margin-top:var(--space-2);">
                            Error al inicializar. Verifica tu conexión a internet.
                        </p>
                        <button class="btn btn-primary" onclick="location.reload()" style="margin-top:var(--space-4);">
                            🔄 Refrescar
                        </button>
                    </div>
                </div>
            `;
        }
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

    // --- Reconexión al volver del segundo plano (móvil) ---
    let _lastResumeTime = 0;

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
    async function _restoreSessionOnResume() {
        // Debounce: no restaurar más de 1 vez cada 3 segundos 
        const now = Date.now();
        if (now - _lastResumeTime < 3000) return;
        _lastResumeTime = now;

        try {
            // 1. Forzar re-lectura de localStorage
            const user = Auth.getUser();
            if (!user) {
                console.warn('📱 No hay sesión guardada — redirigir a login');
                Router.navigate('login');
                return;
            }

            console.log('📱 Sesión encontrada:', user.name, '| Rol:', user.role, '| Fleet:', user.fleetId);

            // 2. Asegurar que el fleetId está configurado
            if (user.fleetId) {
                DB.setFleet(user.fleetId);
            }

            // 3. Reconectar Firebase Realtime Database
            try {
                firebase.database().goOnline();
                console.log('📱 Firebase DB reconectada');
            } catch (e) {
                console.warn('📱 No se pudo reconectar Firebase:', e);
            }

            // 4. Re-verificar conectividad con Firebase
            await DB.open();

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
                const hadActiveShift = await ShiftsModule.hydrateActiveShift();
                if (hadActiveShift) {
                    console.log('📱 ✅ Turno activo restaurado correctamente');
                    return; // hydrateActiveShift ya navegó a 'shifts'
                }
                console.log('📱 No hay turno activo — continuando navegación normal');
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
            // No forzar logout, el usuario puede seguir offline
        }
    }

    return { init, logout, setLanguage, setDistanceUnit, setVolumeUnit, toggleSidebar, startRealtimeSync };
})();

// --- Iniciar la aplicación cuando cargue la página ---
document.addEventListener('DOMContentLoaded', App.init);
