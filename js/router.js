/* ============================================
   FleetAdmin Pro — Router (SPA)
   Navegación entre módulos sin recargar la página
   ============================================ */

const Router = (() => {
    let currentRoute = null;

    const routes = {
        login: () => LoginModule.render(),
        dashboard: () => DashboardModule.render(),
        vehicles: () => VehiclesModule.render(),
        shifts: () => ShiftsModule.render(),
        maintenance: () => MaintenanceModule.render(),
        oil: () => OilModule.render(),
        gps: () => GPSModule.render(),
        settings: () => SettingsModule.render(),
        community: () => CommunityModule.render(),
        'complete-profile': () => SettingsModule.renderCompleteProfile(),
    };

    async function navigate(route) {
        // Si no está logueado, forzar login
        if (!Auth.isLoggedIn() && route !== 'login') {
            route = 'login';
        }

        // Verificar permisos
        if (route !== 'login' && route !== 'complete-profile' && !Auth.canAccess(route)) {
            const defaultRoutes = {
                owner: 'dashboard',
                driver: 'shifts',
                mechanic: 'maintenance'
            };
            route = defaultRoutes[Auth.getRole()] || 'login';
        }

        // Bloqueo de perfil incompleto para conductores
        // NOTA: No await — verificación diferida para no bloquear la navegación.
        // El check principal ocurre en doLogin() y App.init().
        if (Auth.isLoggedIn() && Auth.isDriver() && route !== 'login' && route !== 'complete-profile') {
            Auth.isProfileComplete().then(profileOk => {
                if (!profileOk && Router.getCurrentRoute() !== 'complete-profile') {
                    Router.navigate('complete-profile');
                }
            }).catch(() => { /* error de red, no bloquear */ });
        }

        // Cleanup previous module if needed
        if (currentRoute === 'community' && route !== 'community') {
            if (typeof CommunityModule !== 'undefined' && typeof CommunityModule.cleanup === 'function') {
                CommunityModule.cleanup();
            }
        }

        currentRoute = route;

        // Cerrar sidebar en móvil
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');
        const overlay = document.getElementById('sidebarOverlay');
        if (overlay) overlay.classList.remove('active');

        // Renderizar la ruta — cada módulo hace su propio fetch y devuelve HTML completo
        const app = document.getElementById('app');
        if (routes[route]) {
            const content = await routes[route]();
            if (route === 'login' || route === 'complete-profile') {
                app.innerHTML = content;
            } else {
                app.innerHTML = Components.renderLayout(content, route);
                // Reactivar el sidebar overlay para móvil
                setupMobileMenu();
            }
            // Iniciar listener de anuncios (para todos los roles)
            if (typeof AnnouncementModule !== 'undefined') {
                setTimeout(() => AnnouncementModule.startListening(), 100);
            }
        }
    }

    function getCurrentRoute() {
        return currentRoute;
    }

    function getDefaultRoute() {
        const role = Auth.getRole();
        const defaults = {
            owner: 'dashboard',
            driver: 'shifts',
            mechanic: 'maintenance'
        };
        return defaults[role] || 'login';
    }

    function setupMobileMenu() {
        const overlay = document.getElementById('sidebarOverlay');
        if (overlay) {
            overlay.onclick = () => {
                document.getElementById('sidebar')?.classList.remove('open');
                overlay.classList.remove('active');
            };
        }
    }

    return { navigate, getCurrentRoute, getDefaultRoute };
})();
