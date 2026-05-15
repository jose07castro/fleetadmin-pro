/* ============================================
   FleetAdmin Pro — Sistema de Autenticación
   Multi-tenencia: cada usuario pertenece a una flota
   Roles: owner (admin), driver (chofer), mechanic (mecánico)
   
   PERSISTENCIA TRIPLE: localStorage + sessionStorage + IndexedDB
   Protege contra Android matando el proceso PWA en background.
   ============================================ */

const Auth = (() => {
    let currentUser = null;

    // =============================================
    // IndexedDB Backup — Capa de persistencia extra
    // =============================================
    const IDB_NAME = 'fleetadmin_auth_backup';
    const IDB_STORE = 'session';
    const IDB_KEY = 'current_user';

    function _openIDB() {
        return new Promise((resolve, reject) => {
            try {
                const request = indexedDB.open(IDB_NAME, 1);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(IDB_STORE)) {
                        db.createObjectStore(IDB_STORE);
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (e) {
                reject(e);
            }
        });
    }

    // Guardar en IndexedDB (fire-and-forget)
    async function _saveToIDB(user) {
        try {
            const db = await _openIDB();
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(user, IDB_KEY);
            // También guardar timestamp para saber cuán fresca es la sesión
            tx.objectStore(IDB_STORE).put(Date.now(), 'session_timestamp');
            db.close();
        } catch (e) {
            console.warn('🔐 IDB backup: error guardando sesión:', e);
        }
    }

    // Leer de IndexedDB (async — usado como último recurso)
    async function _loadFromIDB() {
        try {
            const db = await _openIDB();
            return new Promise((resolve) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
                req.onsuccess = () => {
                    db.close();
                    resolve(req.result || null);
                };
                req.onerror = () => {
                    db.close();
                    resolve(null);
                };
            });
        } catch (e) {
            console.warn('🔐 IDB backup: error leyendo sesión:', e);
            return null;
        }
    }

    // Borrar de IndexedDB
    async function _clearIDB() {
        try {
            const db = await _openIDB();
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).clear();
            db.close();
        } catch (e) {
            // ignorar
        }
    }

    // =============================================
    // Login — Triple almacenamiento
    // =============================================
    function login(user) {
        currentUser = user;

        // Capa 1: localStorage (persistente, sobrevive recargas)
        localStorage.setItem('fleetadmin_user', JSON.stringify(user));

        // Capa 2: sessionStorage (sincrónico, distinta pestaña)
        sessionStorage.setItem('fleetadmin_user', JSON.stringify(user));

        // Capa 3: IndexedDB (más resistente a limpieza de storage por el OS)
        _saveToIDB(user);

        // Activar la flota del usuario
        if (user.fleetId) {
            DB.setFleet(user.fleetId);
        }

        console.log('🔐 Sesión guardada en 3 capas (localStorage + sessionStorage + IndexedDB)');

        // 🔔 Registrar FCM token para push notifications (background SOS)
        // Fire-and-forget: no bloqueamos el login por esto
        if (typeof FCM !== 'undefined') {
            try { FCM.init().catch(e => console.warn('🔔 FCM init error:', e)); } catch(e) { /* ignorar */ }
        }
    }

    // =============================================
    // Logout — Limpieza completa de las 3 capas
    // =============================================
    function logout() {
        // 🔔 Limpiar FCM token antes de borrar datos del usuario
        if (typeof FCM !== 'undefined') {
            try { FCM.removeToken().catch(e => console.warn('🔔 FCM removeToken error:', e)); } catch(e) { /* ignorar */ }
        }
        currentUser = null;

        // Limpiar las 3 capas
        localStorage.removeItem('fleetadmin_user');
        localStorage.removeItem('fleetadmin_fleetId');
        sessionStorage.removeItem('fleetadmin_user');
        sessionStorage.removeItem('fleetadmin_fleetId');
        _clearIDB(); // async, fire-and-forget
    }

    // =============================================
    // getUser — Recuperación en cascada (sync)
    // =============================================
    function getUser() {
        if (!currentUser) {
            // Cascada: localStorage > sessionStorage
            const saved = localStorage.getItem('fleetadmin_user')
                || sessionStorage.getItem('fleetadmin_user');
            if (saved) {
                try {
                    currentUser = JSON.parse(saved);
                    // Re-sincronizar ambos storages
                    localStorage.setItem('fleetadmin_user', saved);
                    sessionStorage.setItem('fleetadmin_user', saved);
                    // Restaurar fleetId en DB
                    if (currentUser.fleetId) {
                        DB.setFleet(currentUser.fleetId);
                    }
                    console.log('🔐 Sesión restaurada desde storage sincrónico');
                } catch (e) { /* ignorar */ }
            }
        }
        return currentUser;
    }

    // =============================================
    // recoverSession — Recuperación ASYNC desde IndexedDB
    // Usar cuando getUser() retorna null (Android mató todo)
    // =============================================
    async function recoverSession() {
        // Si ya tenemos usuario, no hace falta recuperar
        if (currentUser) return currentUser;

        // Intentar getUser() (sync) primero por si acaso
        const syncUser = getUser();
        if (syncUser) return syncUser;

        // Último recurso: IndexedDB
        console.log('🔐 Intentando recuperar sesión desde IndexedDB...');
        const idbUser = await _loadFromIDB();
        if (idbUser && idbUser.id && idbUser.fleetId) {
            console.log('🔐 ✅ Sesión recuperada desde IndexedDB:', idbUser.name, '| Rol:', idbUser.role);
            // Re-hidratar las otras capas
            currentUser = idbUser;
            localStorage.setItem('fleetadmin_user', JSON.stringify(idbUser));
            sessionStorage.setItem('fleetadmin_user', JSON.stringify(idbUser));
            if (idbUser.fleetId) {
                DB.setFleet(idbUser.fleetId);
            }
            return idbUser;
        }

        console.log('🔐 ❌ No se encontró sesión en ninguna capa de almacenamiento');
        return null;
    }

    function isLoggedIn() {
        return getUser() !== null;
    }

    // Versión async que incluye IndexedDB recovery
    async function isLoggedInAsync() {
        if (getUser()) return true;
        const recovered = await recoverSession();
        return recovered !== null;
    }

    function getRole() {
        return getUser()?.role || null;
    }

    function isOwner() {
        const role = getRole();
        return role === 'owner' || role === 'titular';
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
            owner: ['dashboard', 'vehicles', 'shifts', 'maintenance', 'oil', 'gps', 'settings', 'community', 'applicants'],
            titular: ['dashboard', 'vehicles', 'shifts', 'maintenance', 'oil', 'gps', 'settings', 'community', 'applicants'],
            driver: ['shifts', 'oil', 'settings', 'community', 'gps'],
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
            // 1. Intentar primero por ID directo
            if (user.id) {
                const direct = await DB.get('users', user.id);
                if (direct && (direct.role === user.role || direct.globalId === user.id)) return direct;
            }
            
            const allUsers = await DB.getAll('users');
            
            // 2. CRÍTICO: Buscar por globalId en la colección de la flota
            let match = allUsers.find(u => u.globalId === user.id);
            if (match) return match;

            // 3. Fallback: buscar por nombre y rol
            match = allUsers.find(u =>
                u.name && u.name.toLowerCase() === user.name.toLowerCase() &&
                u.role === user.role
            );
            
            // Auto-reparación: si lo encontró por nombre pero carece de globalId, vincularlo ya
            if (match && !match.globalId && user.id) {
                console.log('🔧 Auth: Auto-reparando vinculación de globalId para', match.name);
                match.globalId = user.id;
                await DB.put('users', match).catch(err => console.warn('No se pudo auto-reparar globalId:', err));
            }

            return match || null;
        } catch (e) {
            return null;
        }
    }

    return {
        login, logout, getUser, isLoggedIn, isLoggedInAsync, getRole,
        isOwner, isDriver, isMechanic,
        getUserName, getUserId, getFleetId, authenticate, canAccess,
        isProfileComplete, getFleetUserRecord, recoverSession
    };
})();
