/* ============================================
   FleetAdmin Pro — Archivo Principal
   Inicialización de la aplicación PWA
   ============================================ */

const App = (() => {

    // Inicializar la aplicación
    async function init() {
        try {
            // 1. Inicializar sistema de idiomas
            I18n.init();

            // 2. Abrir la base de datos IndexedDB
            await DB.open();

            // 3. Crear datos iniciales si es primera vez
            await DB.seed();

            // 4. Ocultar pantalla de carga
            setTimeout(() => {
                const splash = document.getElementById('splash-screen');
                if (splash) splash.classList.add('hidden');
            }, 800);

            // 5. Navegar a la ruta correcta
            setTimeout(() => {
                if (Auth.isLoggedIn()) {
                    Router.navigate(Router.getDefaultRoute());
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
                            Error al inicializar. Refresca la página.
                        </p>
                        <button class="btn btn-primary" onclick="location.reload()" style="margin-top:var(--space-4);">
                            🔄 Refrescar
                        </button>
                    </div>
                </div>
            `;
        }
    }

    // Cerrar sesión
    function logout() {
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

    return { init, logout, setLanguage, setDistanceUnit, setVolumeUnit, toggleSidebar };
})();

// --- Iniciar la aplicación cuando cargue la página ---
document.addEventListener('DOMContentLoaded', App.init);
