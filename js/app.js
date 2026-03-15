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

    // Cerrar sesión
    function logout() {
        stopRealtimeSync();
        Auth.logout();
        Router.navigate('login');
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

    return { init, logout, setLanguage, setDistanceUnit, setVolumeUnit, toggleSidebar, startRealtimeSync };
})();

// --- Iniciar la aplicación cuando cargue la página ---
document.addEventListener('DOMContentLoaded', App.init);
