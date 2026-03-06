/* ============================================
   FleetAdmin Pro — Sistema de Autenticación
   Roles: owner (dueño), driver (chofer), mechanic (mecánico)
   ============================================ */

const Auth = (() => {
    let currentUser = null;

    function login(user) {
        currentUser = user;
        sessionStorage.setItem('fleetadmin_user', JSON.stringify(user));
    }

    function logout() {
        currentUser = null;
        sessionStorage.removeItem('fleetadmin_user');
    }

    function getUser() {
        if (!currentUser) {
            const saved = sessionStorage.getItem('fleetadmin_user');
            if (saved) {
                try { currentUser = JSON.parse(saved); } catch (e) { /* ignorar */ }
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

    // Verificar credenciales contra la BD
    async function authenticate(name, pin, role) {
        const users = await DB.getAllByIndex('users', 'role', role);
        const match = users.find(u =>
            u.name.toLowerCase() === name.toLowerCase() && u.pin === pin
        );
        if (match) {
            login(match);
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
        getUserName, getUserId, authenticate, canAccess
    };
})();
