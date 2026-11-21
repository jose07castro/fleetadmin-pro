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

    const ACTIVE_VIEW_KEY = 'fa_active_view';
    const TEMP_ADMIN_KEY = 'fa_temp_admin_unlocked';
    const KNOWN_OWNER_IDS = new Set([
        '-On0KIi70SzV5wWql98t', // JOSE CAS (fleet owner)
        '-OnPdA3C3oquFdRo848P', // Jose (global owner)
        '-On2AZpey9Ol-UUZprKJ', // jose Cas (dueno perfil chofer)
        '-OnPdAAqEynBhS_tCDoI'  // jose Cas (globalId)
    ]);

    function isUserDriverEligible(u) {
        if (!u) return false;
        if (u.role === 'driver' || u.role === 'conductor') return true;
        if (u.esChofer === true || u.esChofer === 'true' || u.isDriver === true) return true;
        if (Array.isArray(u.roles) && (u.roles.includes('chofer') || u.roles.includes('driver'))) return true;
        return false;
    }

    function isUserAdminEligible(u) {
        if (!u) return false;
        if (u.role === 'owner' || u.role === 'titular' || u.role === 'admin') return true;
        if (u.isAdmin === true || u.isAdmin === 'true') return true;
        if (Array.isArray(u.roles) && (u.roles.includes('admin') || u.roles.includes('owner') || u.roles.includes('titular'))) return true;
        const uid = String(u.id || '');
        const gid = String(u.globalId || '');
        if (KNOWN_OWNER_IDS.has(uid) || KNOWN_OWNER_IDS.has(gid)) return true;
        const email = String(u.email || '').trim().toLowerCase();
        const name = String(u.name || '').trim().toLowerCase();
        if (email === 'josealbertocastro@gmail.com' || name === 'jose alberto castro') return true;
        return false;
    }

    function _hydrateDualFlags(u) {
        if (!u || typeof u !== 'object') return u;
        const uid = String(u.id || '');
        const gid = String(u.globalId || '');
        if (KNOWN_OWNER_IDS.has(uid) || KNOWN_OWNER_IDS.has(gid)) {
            u.isAdmin = true;
            u.esChofer = true;
            const roleSet = new Set(Array.isArray(u.roles) ? u.roles : []);
            roleSet.add('admin');
            roleSet.add('chofer');
            if (u.role) roleSet.add(u.role === 'owner' ? 'owner' : u.role);
            u.roles = Array.from(roleSet);
        }
        return u;
    }

    // =============================================
    // Login — Triple almacenamiento
    // =============================================
    function login(user) {
        _hydrateDualFlags(user);
        currentUser = user;

        // Vista inicial por defecto según capacidades de cuenta
        const defaultView = isUserAdminEligible(user) ? 'admin' : 'driver';
        localStorage.setItem(ACTIVE_VIEW_KEY, defaultView);
        sessionStorage.removeItem(TEMP_ADMIN_KEY);

        // Capa 1: localStorage (persistente, sobrevive recargas)
        localStorage.setItem('fleetadmin_user', JSON.stringify(user));

        // Capa 2: sessionStorage (sincrónico, distinta pestaña)
        sessionStorage.setItem('fleetadmin_user', JSON.stringify(user));

        // Capa 3: IndexedDB (más resistente a limpieza de storage por el OS)
        _saveToIDB(user);

        // Activar la flota del usuario
        if (user.fleetId) {
            DB.setFleet(user.fleetId);
            localStorage.setItem('last_fleet_id', user.fleetId);
        }

        if (user.role && typeof AndroidServices !== 'undefined' && typeof AndroidServices.setUserRole === 'function') {
            AndroidServices.setUserRole(getRole() || user.role);
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
        // Guardia de turno activo: un chofer en turno IN_PROGRESS no puede desloguearse
        if (typeof App !== 'undefined' && typeof App.isDriverShiftLocked === 'function' && App.isDriverShiftLocked()) {
            if (typeof App.showShiftExitBlockedModal === 'function') App.showShiftExitBlockedModal();
            return;
        }

        // Detener el Foreground Service de rastreo GPS en Android antes de limpiar nada
        if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.disableForegroundService === 'function') {
            try { AndroidServices.disableForegroundService(); } catch (e) { console.warn('Error desactivando foreground service:', e); }
        }

        // 🔔 Limpiar FCM token antes de borrar datos del usuario
        if (typeof FCM !== 'undefined') {
            try { FCM.removeToken().catch(e => console.warn('🔔 FCM removeToken error:', e)); } catch(e) { /* ignorar */ }
        }
        currentUser = null;

        // Limpiar las 3 capas
        localStorage.removeItem('fleetadmin_user');
        localStorage.removeItem('fleetadmin_fleetId');
        localStorage.removeItem(ACTIVE_VIEW_KEY);
        sessionStorage.removeItem('fleetadmin_user');
        sessionStorage.removeItem('fleetadmin_fleetId');
        sessionStorage.removeItem(TEMP_ADMIN_KEY);
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
                    currentUser = _hydrateDualFlags(JSON.parse(saved));
                    // Re-sincronizar ambos storages
                    const updatedJson = JSON.stringify(currentUser);
                    localStorage.setItem('fleetadmin_user', updatedJson);
                    sessionStorage.setItem('fleetadmin_user', updatedJson);
                    // Restaurar fleetId en DB
                    if (currentUser.fleetId) {
                        DB.setFleet(currentUser.fleetId);
                        localStorage.setItem('last_fleet_id', currentUser.fleetId);
                    }
                    console.log('🔐 Sesión restaurada desde storage sincrónico');
                } catch (e) { /* ignorar */ }
            }
        }
        return _hydrateDualFlags(currentUser);
    }

    // =============================================
    // recoverSession — Recuperación ASYNC desde IndexedDB
    // Usar cuando getUser() retorna null (Android mató todo)
    // =============================================
    async function recoverSession() {
        // Si ya tenemos usuario, no hace falta recuperar
        if (currentUser) return _hydrateDualFlags(currentUser);

        // Intentar getUser() (sync) primero por si acaso
        const syncUser = getUser();
        if (syncUser) return syncUser;

        // Último recurso: IndexedDB
        console.log('🔐 Intentando recuperar sesión desde IndexedDB...');
        const idbUser = await _loadFromIDB();
        if (idbUser && idbUser.id && idbUser.fleetId) {
            _hydrateDualFlags(idbUser);
            console.log('🔐 ✅ Sesión recuperada desde IndexedDB:', idbUser.name, '| Rol:', idbUser.role);
            // Re-hidratar las otras capas
            currentUser = idbUser;
            localStorage.setItem('fleetadmin_user', JSON.stringify(idbUser));
            sessionStorage.setItem('fleetadmin_user', JSON.stringify(idbUser));
            if (idbUser.fleetId) {
                DB.setFleet(idbUser.fleetId);
                localStorage.setItem('last_fleet_id', idbUser.fleetId);
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

    function getAccountRole() {
        return getUser()?.role || null;
    }

    function hasTempAdminUnlock() {
        try {
            return sessionStorage.getItem(TEMP_ADMIN_KEY) === 'true';
        } catch (e) {
            return false;
        }
    }

    function hasAdminCapability() {
        const user = getUser();
        if (!user) return false;
        return isUserAdminEligible(user) || hasTempAdminUnlock();
    }

    function hasDriverCapability() {
        const user = getUser();
        if (!user) return false;
        return isUserDriverEligible(user);
    }

    function isDualRole() {
        return hasAdminCapability() && (hasDriverCapability() || isUserAdminEligible(getUser()));
    }

    function getActiveView() {
        const user = getUser();
        if (!user) return null;
        if (!hasAdminCapability()) {
            return isUserDriverEligible(user) ? 'driver' : (user.role || 'driver');
        }
        const saved = localStorage.getItem(ACTIVE_VIEW_KEY);
        if (saved === 'driver') return 'driver';
        if (saved === 'admin') return 'admin';
        // Por defecto: admin si su rol base es owner/titular/admin o se desbloqueó temporalmente, si no driver
        return isUserAdminEligible(user) && user.role !== 'driver' ? 'admin' : 'driver';
    }

    function getRole() {
        const user = getUser();
        if (!user) return null;
        if (hasAdminCapability()) {
            const view = getActiveView();
            if (view === 'driver') return 'driver';
            return (user.role === 'titular' ? 'titular' : 'owner');
        }
        return user.role || null;
    }

    function switchActiveView(targetView) {
        const user = getUser();
        if (!user) return false;
        if (targetView !== 'admin' && targetView !== 'driver') return false;
        if (targetView === 'admin' && !hasAdminCapability()) return false;

        // Cambiar SOLO la vista activa sin cerrar sesión ni tocar turno en curso
        localStorage.setItem(ACTIVE_VIEW_KEY, targetView);

        // Actualizar rol en puente Android para que botón Atrás respete el modo actual SIN detener LocationTrackingService
        const effectiveRole = targetView === 'driver' ? 'driver' : (user.role === 'titular' ? 'titular' : 'owner');
        if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setUserRole === 'function') {
            try { AndroidServices.setUserRole(effectiveRole); } catch (e) { /* no crítico */ }
        }

        // Navegar a la pantalla principal de la vista seleccionada
        if (typeof Router !== 'undefined' && typeof Router.navigate === 'function') {
            const dest = targetView === 'admin' ? 'dashboard' : 'shifts';
            Router.navigate(dest);
        }

        if (typeof Components !== 'undefined' && typeof Components.showToast === 'function') {
            Components.showToast(
                targetView === 'admin' ? '⚙️ Modo Administrador activado (tu sesión y turno continúan intactos)' : '🚗 Modo Chofer activado',
                'info'
            );
        }
        return true;
    }

    async function syncUserCapabilitiesFromFleet() {
        const user = getUser();
        if (!user) return;
        try {
            const rec = await getFleetUserRecord();
            if (!rec) return;
            let changed = false;
            if (typeof rec.esChofer !== 'undefined' && user.esChofer !== rec.esChofer) {
                user.esChofer = Boolean(rec.esChofer);
                changed = true;
            }
            if (typeof rec.isAdmin !== 'undefined' && user.isAdmin !== rec.isAdmin) {
                user.isAdmin = Boolean(rec.isAdmin);
                changed = true;
            }
            if (Array.isArray(rec.roles)) {
                user.roles = rec.roles;
                changed = true;
            }
            _hydrateDualFlags(user);
            if (changed) {
                currentUser = user;
                const serialized = JSON.stringify(user);
                localStorage.setItem('fleetadmin_user', serialized);
                sessionStorage.setItem('fleetadmin_user', serialized);
                _saveToIDB(user);
            }
        } catch (e) { /* red no disponible */ }
    }

    function promptAdminPinSwitch() {
        if (hasAdminCapability()) {
            switchActiveView('admin');
            return;
        }
        if (typeof Components === 'undefined' || typeof Components.showModal !== 'function') return;

        const bodyHTML = `
            <div style="padding:4px 0;">
                <p style="font-size:0.9rem; color:var(--text-secondary); margin:0 0 12px 0; line-height:1.45;">
                    Ingresá el PIN maestro de Administrador para cambiar temporalmente al Panel de Control <b>sin cerrar sesión ni finalizar tu turno actual</b>.
                </p>
                <div class="form-group" style="margin-bottom:8px;">
                    <label class="form-label" for="tempAdminPinInput">PIN de Administrador</label>
                    <input type="password" inputmode="numeric" maxlength="12" class="form-input" id="tempAdminPinInput" placeholder="••••" autocomplete="off">
                </div>
                <div id="tempAdminPinError" style="color:#f87171; font-size:0.85rem; min-height:20px; font-weight:600;"></div>
            </div>
        `;
        const footerHTML = `
            <div style="display:flex; gap:10px; width:100%;">
                <button class="btn btn-secondary" style="flex:1;" onclick="Components.closeModal()">Cancelar</button>
                <button class="btn btn-primary" style="flex:1;" id="tempAdminPinBtn" onclick="Auth._submitAdminPinSwitch()">⚙️ Desbloquear</button>
            </div>
        `;
        Components.showModal('🔑 Acceso Rápido Administrador', bodyHTML, footerHTML);
        setTimeout(() => {
            const inp = document.getElementById('tempAdminPinInput');
            if (inp) {
                inp.focus();
                inp.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') _submitAdminPinSwitch();
                });
            }
        }, 120);
    }

    async function _submitAdminPinSwitch() {
        const inp = document.getElementById('tempAdminPinInput');
        const err = document.getElementById('tempAdminPinError');
        const btn = document.getElementById('tempAdminPinBtn');
        const pin = String(inp?.value || '').trim();
        if (!pin) {
            if (err) err.textContent = 'Ingresá el PIN de Administrador.';
            return;
        }
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Verificando...'; }
        if (err) err.textContent = '';

        let valid = false;
        const baseUrl = (window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.protocol === 'file:')
            ? 'https://fleetadmin-web-nueva.onrender.com'
            : window.location.origin;

        try {
            const res = await fetch(`${baseUrl}/api/bot/verify-admin-pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.ok) {
                valid = true;
            }
        } catch (netErr) {
            console.warn('Error verificando PIN contra servidor:', netErr);
        }

        // Fallback: verificar contra PIN de dueño local de la flota
        if (!valid && typeof DB !== 'undefined' && typeof DB.getAll === 'function' && typeof DB.verifyPin === 'function') {
            try {
                const users = await DB.getAll('users');
                const owners = (users || []).filter(u => isUserAdminEligible(u) && u.pin);
                for (const own of owners) {
                    if (await DB.verifyPin(pin, own.pin)) {
                        valid = true;
                        break;
                    }
                }
            } catch (dbErr) { /* ignorar */ }
        }

        if (valid) {
            sessionStorage.setItem(TEMP_ADMIN_KEY, 'true');
            if (typeof Components !== 'undefined' && typeof Components.closeModal === 'function') {
                Components.closeModal();
            }
            switchActiveView('admin');
        } else {
            if (err) err.textContent = 'PIN incorrecto. Verificá e intentá nuevamente.';
            if (btn) { btn.disabled = false; btn.textContent = '⚙️ Desbloquear'; }
        }
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

    function isPassenger() {
        return getRole() === 'passenger';
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
        return getUser()?.fleetId || DB.getFleet() || localStorage.getItem('last_fleet_id') || null;
    }

    // Verificar credenciales contra globalUsers
    async function authenticate(name, pin, role) {
        const globalUser = await DB.findGlobalUser(name, pin, role);
        if (globalUser) {
            login(globalUser);
            const targetView = role === 'driver' ? 'driver' : (isUserAdminEligible(globalUser) ? 'admin' : 'driver');
            localStorage.setItem(ACTIVE_VIEW_KEY, targetView);
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setUserRole === 'function') {
                AndroidServices.setUserRole(getRole() || globalUser.role);
            }
            return true;
        }
        return false;
    }

    // Verificar si tiene acceso a una ruta
    function canAccess(route) {
        const role = getRole();
        if (!role) return false;

        const permissions = {
            owner: ['dashboard', 'vehicles', 'shifts', 'maintenance', 'oil', 'gps', 'settings', 'community', 'applicants', 'balances', 'vehicle-costs', 'invoicing'],
            titular: ['dashboard', 'vehicles', 'shifts', 'maintenance', 'oil', 'gps', 'settings', 'community', 'applicants', 'balances', 'vehicle-costs', 'invoicing'],
            driver: ['shifts', 'oil', 'settings', 'community', 'gps', 'invoicing'],
            mechanic: ['maintenance', 'settings'],
            passenger: ['gps', 'settings']
        };

        return permissions[role]?.includes(route) || false;
    }

    // Verificar si el perfil del conductor está completo
    // Busca en la colección 'users' de la flota por nombre+rol
    async function isProfileComplete() {
        const user = getUser();
        if (!user || user.role !== 'driver') return true;
        if (hasAdminCapability()) return true;
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

            // 3. Fallback: buscar por nombre y rol (o si el dueño ingresó con globalId distinto)
            match = allUsers.find(u =>
                u.name && u.name.toLowerCase() === String(user.name || '').toLowerCase() &&
                u.role === user.role
            ) || allUsers.find(u =>
                isUserAdminEligible(u) && isUserAdminEligible(user) && u.role === user.role
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
        login, logout, getUser, isLoggedIn, isLoggedInAsync, getRole, getAccountRole,
        isOwner, isDriver, isMechanic, isPassenger,
        isUserDriverEligible, isUserAdminEligible,
        hasAdminCapability, hasDriverCapability, isDualRole,
        getActiveView, switchActiveView, syncUserCapabilitiesFromFleet,
        promptAdminPinSwitch, _submitAdminPinSwitch,
        getUserName, getUserId, getFleetId, authenticate, canAccess,
        isProfileComplete, getFleetUserRecord, recoverSession
    };
})();
