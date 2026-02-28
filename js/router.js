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
        mechanic: () => MechanicModule.render(),
        oil: () => OilModule.render(),
        settings: () => SettingsModule.render(),
    };

    async function navigate(route) {
        // Si no está logueado, forzar login
        if (!Auth.isLoggedIn() && route !== 'login') {
            route = 'login';
        }

        // Verificar permisos
        if (route !== 'login' && !Auth.canAccess(route)) {
            const defaultRoutes = {
                owner: 'dashboard',
                driver: 'shifts',
                mechanic: 'mechanic'
            };
            route = defaultRoutes[Auth.getRole()] || 'login';
        }

        currentRoute = route;

        // Cerrar sidebar en móvil
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');
        const overlay = document.getElementById('sidebarOverlay');
        if (overlay) overlay.classList.remove('active');

        // Renderizar la ruta
        const app = document.getElementById('app');
        if (routes[route]) {
            const content = await routes[route]();
            if (route === 'login') {
                app.innerHTML = content;
            } else {
                app.innerHTML = Components.renderLayout(content, route);
                // Reactivar el sidebar overlay para móvil
                setupMobileMenu();
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
            mechanic: 'mechanic'
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
