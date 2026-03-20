/* ============================================
   FleetAdmin Pro — Sistema de Autenticación
   Multi-tenencia: cada usuario pertenece a una flota
   Roles: owner (admin), driver (chofer), mechanic (mecánico)
   ============================================ */

const Auth = (() => {
    let currentUser = null;

    function login(user) {
        currentUser = user;
        localStorage.setItem('fleetadmin_user', JSON.stringify(user));
        // Activar la flota del usuario
        if (user.fleetId) {
            DB.setFleet(user.fleetId);
        }
        // 🔔 Registrar FCM token para push notifications (background SOS)
        // Fire-and-forget: no bloqueamos el login por esto
        if (typeof FCM !== 'undefined') {
            try { FCM.init().catch(e => console.warn('🔔 FCM init error:', e)); } catch(e) { /* ignorar */ }
        }
    }

    function logout() {
        // 🔔 Limpiar FCM token antes de borrar datos del usuario
        if (typeof FCM !== 'undefined') {
            try { FCM.removeToken().catch(e => console.warn('🔔 FCM removeToken error:', e)); } catch(e) { /* ignorar */ }
        }
        currentUser = null;
        localStorage.removeItem('fleetadmin_user');
        localStorage.removeItem('fleetadmin_fleetId');
        // Limpiar sessionStorage legacy también
        sessionStorage.removeItem('fleetadmin_user');
        sessionStorage.removeItem('fleetadmin_fleetId');
    }

    function getUser() {
        if (!currentUser) {
            // Prioridad: localStorage (persistente) > sessionStorage (legacy)
            const saved = localStorage.getItem('fleetadmin_user')
                || sessionStorage.getItem('fleetadmin_user');
            if (saved) {
                try {
                    currentUser = JSON.parse(saved);
                    // Migrar de session a local si estaba en legacy
                    localStorage.setItem('fleetadmin_user', saved);
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
        // FUENTE PRIMARIA: Firebase Auth
        try {
            const fbUser = firebase.auth().currentUser;
            if (fbUser) {
                console.log('Datos del usuario activo:', fbUser);
                const nombre = fbUser.displayName || fbUser.email || null;
                if (nombre) return nombre;
            }
        } catch (e) { /* Firebase Auth no disponible */ }

        // Fallback: nombre del sistema custom
        const user = getUser();
        return user?.name || user?.email || 'Usuario Desconocido';
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
            owner: ['dashboard', 'vehicles', 'shifts', 'maintenance', 'oil', 'gps', 'settings', 'community'],
            driver: ['shifts', 'oil', 'settings', 'community'],
            mechanic: ['maintenance', 'settings']
        };

        return permissions[role]?.includes(route) || false;
    }

    // Verificar si el perfil del conductor está completo
    // Busca en la colección 'users' de la flota por nombre+rol
    async function isProfileComplete() {
        const user = getUser();
        if (!user || user.role !== 'driver') return true;
        try {
            const fleetUser = await getFleetUserRecord();
            if (!fleetUser) return true; // No encontrado, no bloquear
            // Todos estos campos son OBLIGATORIOS
            return !!(
                fleetUser.address &&
                fleetUser.whatsapp &&
                fleetUser.licenseNumber &&
                fleetUser.licenseFrontPhoto &&
                fleetUser.licenseBackPhoto
            );
        } catch (e) {
            console.warn('Error verificando perfil:', e);
            return true;
        }
    }

    // Obtener el registro del usuario en la flota (no el globalUser)
    async function getFleetUserRecord() {
        const user = getUser();
        if (!user) return null;
        try {
            // Intentar primero por ID directo
            const direct = await DB.get('users', user.id);
            if (direct && direct.role === user.role) return direct;
            // Fallback: buscar por nombre y rol en la colección de la flota
            const allUsers = await DB.getAll('users');
            return allUsers.find(u =>
                u.name && u.name.toLowerCase() === user.name.toLowerCase() &&
                u.role === user.role
            ) || null;
        } catch (e) {
            return null;
        }
    }

    return {
        login, logout, getUser, isLoggedIn, getRole,
        isOwner, isDriver, isMechanic,
        getUserName, getUserId, getFleetId, authenticate, canAccess,
        isProfileComplete, getFleetUserRecord
    };
})();
