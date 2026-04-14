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
        apply: () => ApplicantsModule.renderApply(),
        applicants: () => ApplicantsModule.renderAdmin(),
    };

    async function navigate(route) {
        // Si no está logueado, forzar login
        if (!Auth.isLoggedIn() && route !== 'login' && route !== 'apply') {
            route = 'login';
        }

        // Verificar permisos
        if (route !== 'login' && route !== 'apply' && route !== 'complete-profile' && !Auth.canAccess(route)) {
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
        if (Auth.isLoggedIn() && Auth.isDriver() && route !== 'login' && route !== 'apply' && route !== 'complete-profile') {
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
            try {
                const content = await routes[route]();
                // Guard: si el módulo devuelve undefined/null/empty, mostrar error
                if (!content && route !== 'login' && route !== 'apply') {
                    throw new Error('El módulo no devolvió contenido');
                }
                if (route === 'login' || route === 'apply' || route === 'complete-profile') {
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
            } catch (renderError) {
                console.error('🔴 Router: Error renderizando ruta "' + route + '":', renderError);
                // NUNCA dejar pantalla en blanco — mostrar error con retry
                app.innerHTML = `
                    <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; background:rgba(15,23,42,0.95);">
                        <div style="text-align:center; padding:2rem; max-width:400px;">
                            <div style="font-size:3rem; margin-bottom:1rem;">⚠️</div>
                            <h2 style="color:#f1f5f9; margin-bottom:0.5rem;">Error de Carga</h2>
                            <p style="color:#94a3b8; margin-bottom:1rem; font-size:0.9rem;">${renderError.message || 'Error de conexión al servidor'}</p>
                            <button onclick="Router.navigate('${route}')" style="background:linear-gradient(135deg,#6366f1,#06b6d4); color:white; border:none; padding:12px 24px; border-radius:12px; font-size:1rem; font-weight:600; cursor:pointer; margin-right:8px;">🔄 Reintentar</button>
                            <button onclick="Router.navigate('login')" style="background:#334155; color:#f1f5f9; border:1px solid #475569; padding:12px 24px; border-radius:12px; font-size:1rem; font-weight:600; cursor:pointer;">🚪 Ir a Login</button>
                        </div>
                    </div>`;
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
