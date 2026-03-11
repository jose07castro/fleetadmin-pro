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
        settings: () => SettingsModule.render(),
    };

    // Mapeo de rutas a nombres de módulos (para afterRender)
    const moduleNames = {
        settings: 'SettingsModule',
        dashboard: 'DashboardModule',
        vehicles: 'VehiclesModule',
        shifts: 'ShiftsModule',
        maintenance: 'MaintenanceModule',
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
                mechanic: 'maintenance'
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
            // Llamar afterRender si el módulo lo tiene
            const modName = moduleNames[route];
            const mod = modName ? window[modName] : null;
            if (mod && typeof mod.afterRender === 'function') {
                setTimeout(() => mod.afterRender(), 50);
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
