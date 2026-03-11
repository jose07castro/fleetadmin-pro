/* ============================================
   FleetAdmin Pro — Sistema de Autenticación
   Multi-tenencia: cada usuario pertenece a una flota
   Roles: owner (admin), driver (chofer), mechanic (mecánico)
   ============================================ */

const Auth = (() => {
    let currentUser = null;

    function login(user) {
        currentUser = user;
        sessionStorage.setItem('fleetadmin_user', JSON.stringify(user));
        // Activar la flota del usuario
        if (user.fleetId) {
            DB.setFleet(user.fleetId);
        }
    }

    function logout() {
        currentUser = null;
        sessionStorage.removeItem('fleetadmin_user');
        sessionStorage.removeItem('fleetadmin_fleetId');
    }

    function getUser() {
        if (!currentUser) {
            const saved = sessionStorage.getItem('fleetadmin_user');
            if (saved) {
                try {
                    currentUser = JSON.parse(saved);
                    // Restaurar fleetId en DB
                    if (currentUser.fleetId) {
                        DB.setFleet(currentUser.fleetId);
                    }
                } catch (e) { /* ignorar */ }
            }
        }
        return currentUser;
    }

    function isLoggedIn() {
        return getUser() !== null;
    }

    function getRole() {
        return getUser()?.role || null;
    }

    function isOwner() {
        return getRole() === 'owner';
    }

    function isDriver() {
        return getRole() === 'driver';
    }

    function isMechanic() {
        return getRole() === 'mechanic';
    }

    function getUserName() {
        return getUser()?.name || '';
    }

    function getUserId() {
        return getUser()?.id || null;
    }

    function getFleetId() {
        return getUser()?.fleetId || DB.getFleet() || null;
    }

    // Verificar credenciales contra globalUsers
    async function authenticate(name, pin, role) {
        const globalUser = await DB.findGlobalUser(name, pin, role);
        if (globalUser) {
            login(globalUser);
            return true;
        }
        return false;
    }

    // Verificar si tiene acceso a una ruta
    function canAccess(route) {
        const role = getRole();
        if (!role) return false;

        const permissions = {
            owner: ['dashboard', 'vehicles', 'shifts', 'maintenance', 'oil', 'settings'],
            driver: ['shifts', 'oil', 'settings'],
            mechanic: ['maintenance', 'settings']
        };

        return permissions[role]?.includes(route) || false;
    }

    return {
        login, logout, getUser, isLoggedIn, getRole,
        isOwner, isDriver, isMechanic,
        getUserName, getUserId, getFleetId, authenticate, canAccess
    };
})();
