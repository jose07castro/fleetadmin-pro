/* ============================================
   FleetAdmin Pro — Base de Datos (Firebase)
   Realtime Database con sincronización en vivo
   Multi-tenencia: cada flota tiene sus propios datos
   ============================================ */

const DB = (() => {
    const db = firebaseDB; // Definido en firebase-config.js

    // Stores válidos (dentro de cada flota)
    const VALID_STORES = ['users', 'vehicles', 'shifts', 'oilLogs', 'repairs', 'beltChanges'];
    const CACHE_PREFIX = 'fleetadmin_cache_';

    // --- Fleet ID actual ---
    let currentFleetId = null;

    function setFleet(fleetId) {
        currentFleetId = fleetId;
        if (fleetId) {
            sessionStorage.setItem('fleetadmin_fleetId', fleetId);
        }
        console.log(`🏢 Fleet activa: ${fleetId}`);
    }

    function getFleet() {
        if (!currentFleetId) {
            currentFleetId = sessionStorage.getItem('fleetadmin_fleetId');
        }
        return currentFleetId;
    }

    // Helper: obtener la ruta con prefijo de flota
    function fleetPath(path) {
        const fid = getFleet();
        if (!fid) {
            console.warn('⚠️ No hay fleetId configurado, usando ruta sin prefijo');
            return path;
        }
        return `fleets/${fid}/${path}`;
    }

    // --- Helper de timeout con promesa ---
    async function fetchWithTimeout(ref, timeoutMs = 7000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => reject(new Error('Firebase timeout')), timeoutMs);
            ref.once('value').then(snap => {
                clearTimeout(timeoutId);
                resolve(snap);
            }).catch(e => {
                clearTimeout(timeoutId);
                reject(e);
            });
        });
    }

    // --- Abrir conexión (verificar Firebase) ---
    async function open() {
        return new Promise((resolve) => {
            const connRef = firebase.database().ref('.info/connected');
            const timeout = setTimeout(() => {
                console.warn('Firebase: timeout de conexión, continuando...');
                resolve(true);
            }, 5000);

            connRef.once('value', (snap) => {
                clearTimeout(timeout);
                if (snap.val() === true) {
                    console.log('✅ Conectado a Firebase Realtime Database');
                } else {
                    console.warn('⚠️ Firebase: sin conexión activa');
                }
                resolve(true);
            });
        });
    }

    // --- Operaciones CRUD genéricas (dentro de la flota activa) ---
    async function add(storeName, data) {
        const ref = db.ref(fleetPath(storeName)).push();
        const newItem = {
            ...data,
            id: ref.key,
            createdAt: data.createdAt || new Date().toISOString()
        };
        await ref.set(newItem);
        return ref.key;
    }

    async function put(storeName, data) {
        if (!data.id) throw new Error('put() requiere un ID');
        const updated = {
            ...data,
            updatedAt: new Date().toISOString()
        };
        await db.ref(`${fleetPath(storeName)}/${data.id}`).update(updated);
        return data.id;
    }

    async function get(storeName, id) {
        const path = `${fleetPath(storeName)}/${id}`;
        try {
            const snap = await fetchWithTimeout(db.ref(path), 5000);
            const val = snap.val() || undefined;
            try { if (val) localStorage.setItem(`${CACHE_PREFIX}${storeName}_${id}`, JSON.stringify(val)); } catch(ce) { /* quota */ }
            return val;
        } catch (e) {
            console.warn(`Fallback caché (offline): get(${storeName}, ${id})`);
            const cached = localStorage.getItem(`${CACHE_PREFIX}${storeName}_${id}`);
            return cached ? JSON.parse(cached) : undefined;
        }
    }

    async function getAll(storeName) {
        const path = fleetPath(storeName);
        try {
            const snap = await fetchWithTimeout(db.ref(path), 7000);
            const val = snap.val();
            const data = val ? Object.values(val) : [];
            try { localStorage.setItem(`${CACHE_PREFIX}${storeName}_all`, JSON.stringify(data)); } catch(ce) { /* quota */ }
            return data;
        } catch (e) {
            console.warn(`Fallback caché (offline): getAll(${storeName})`);
            const cached = localStorage.getItem(`${CACHE_PREFIX}${storeName}_all`);
            return cached ? JSON.parse(cached) : [];
        }
    }

    async function getAllByIndex(storeName, indexName, value) {
        const all = await getAll(storeName);
        return all.filter(item => String(item[indexName]) === String(value));
    }

    async function remove(storeName, id) {
        await db.ref(`${fleetPath(storeName)}/${id}`).remove();
    }

    async function clearStore(storeName) {
        await db.ref(fleetPath(storeName)).remove();
    }

    // --- Configuración (clave-valor, dentro de la flota) ---
    async function getSetting(key) {
        const path = fleetPath(`settings/${key}`);
        try {
            const snap = await fetchWithTimeout(db.ref(path), 5000);
            const val = snap.val();
            localStorage.setItem(`${CACHE_PREFIX}setting_${key}`, JSON.stringify(val));
            return val;
        } catch (e) {
            const cached = localStorage.getItem(`${CACHE_PREFIX}setting_${key}`);
            return cached ? JSON.parse(cached) : undefined;
        }
    }

    async function setSetting(key, value) {
        await db.ref(fleetPath(`settings/${key}`)).set(value);
    }

    // --- Operaciones GLOBALES (fuera de la flota) ---

    // Crear un nuevo fleetId
    function createFleetId() {
        return db.ref('fleets').push().key;
    }

    // Registro global de usuario (para login cross-fleet)
    async function addGlobalUser(data) {
        const ref = db.ref('globalUsers').push();
        const newItem = {
            ...data,
            id: ref.key,
            createdAt: new Date().toISOString()
        };
        await ref.set(newItem);
        return ref.key;
    }

    // Buscar usuario global por nombre, pin y rol
    async function findGlobalUser(name, pin, role) {
        try {
            const snap = await fetchWithTimeout(db.ref('globalUsers'), 7000);
            const val = snap.val();
            if (!val) return null;
            const users = Object.values(val);
            return users.find(u =>
                u.name.toLowerCase() === name.toLowerCase() &&
                u.pin === pin &&
                u.role === role
            ) || null;
        } catch (e) {
            console.warn('Error buscando usuario global:', e);
            return null;
        }
    }

    // Buscar todos los usuarios globales de una flota
    async function getGlobalUsersByFleet(fleetId) {
        try {
            const snap = await fetchWithTimeout(db.ref('globalUsers'), 7000);
            const val = snap.val();
            if (!val) return [];
            return Object.values(val).filter(u => u.fleetId === fleetId);
        } catch (e) {
            return [];
        }
    }

    // Verificar si existen usuarios globales registrados
    async function hasGlobalUsers() {
        try {
            const snap = await fetchWithTimeout(db.ref('globalUsers'), 5000);
            const val = snap.val();
            return val && Object.keys(val).length > 0;
        } catch (e) {
            return false;
        }
    }

    // --- Migración: mover datos viejos (sin flota) a una flota ---
    async function migrateOldData() {
        try {
            // Verificar si hay datos en el path viejo /users/
            const oldUsersSnap = await fetchWithTimeout(db.ref('users'), 5000);
            const oldUsers = oldUsersSnap.val();

            if (!oldUsers || Object.keys(oldUsers).length === 0) {
                return null; // No hay datos viejos
            }

            console.log('🔄 Migrando datos viejos a nueva estructura de flotas...');

            // Crear una flota para los datos existentes
            const fleetId = createFleetId();

            // Migrar cada store
            for (const store of VALID_STORES) {
                const snap = await fetchWithTimeout(db.ref(store), 5000).catch(() => null);
                if (snap && snap.val()) {
                    await db.ref(`fleets/${fleetId}/${store}`).set(snap.val());
                    await db.ref(store).remove();
                }
            }

            // Migrar settings
            const settingsSnap = await fetchWithTimeout(db.ref('settings'), 5000).catch(() => null);
            if (settingsSnap && settingsSnap.val()) {
                await db.ref(`fleets/${fleetId}/settings`).set(settingsSnap.val());
                await db.ref('settings').remove();
            }

            // Crear globalUsers para cada usuario viejo
            const users = Object.values(oldUsers);
            for (const u of users) {
                await addGlobalUser({
                    name: u.name,
                    pin: u.pin,
                    role: u.role,
                    fleetId: fleetId,
                    profilePhoto: u.profilePhoto || null
                });
            }

            console.log(`✅ Migración completada. FleetId: ${fleetId}`);
            return fleetId;
        } catch (e) {
            console.warn('Error en migración:', e);
            return null;
        }
    }

    // --- Datos iniciales (seed) — ya no crea datos por defecto ---
    async function seed() {
        // La migración se maneja desde login/registro
        return Promise.resolve();
    }

    // --- Exportar/Importar datos (dentro de la flota activa) ---
    async function exportAll() {
        const exportData = {};
        for (const store of VALID_STORES) {
            exportData[store] = await getAll(store);
        }
        const settingsPath = fleetPath('settings');
        const settingsSnap = await db.ref(settingsPath).once('value');
        const settingsVal = settingsSnap.val() || {};
        exportData.settings = Object.entries(settingsVal).map(([key, value]) => ({ key, value }));
        return exportData;
    }

    async function importAll(data) {
        for (const store of VALID_STORES) {
            if (data[store] && Array.isArray(data[store])) {
                await db.ref(fleetPath(store)).remove();
                for (const item of data[store]) {
                    const ref = db.ref(fleetPath(store)).push();
                    await ref.set({ ...item, id: ref.key });
                }
            }
        }
        if (data.settings) {
            if (Array.isArray(data.settings)) {
                const settingsObj = {};
                data.settings.forEach(s => { settingsObj[s.key] = s.value; });
                await db.ref(fleetPath('settings')).set(settingsObj);
            } else {
                await db.ref(fleetPath('settings')).set(data.settings);
            }
        }
    }

    async function resetAll() {
        const fid = getFleet();
        if (fid) {
            await db.ref(`fleets/${fid}`).remove();
        }
    }

    // --- Sincronización en tiempo real (dentro de la flota) ---
    function onChanges(storeName, callback) {
        const path = fleetPath(storeName);
        db.ref(path).on('value', (snap) => {
            const val = snap.val();
            const items = val ? Object.values(val) : [];
            localStorage.setItem(`${CACHE_PREFIX}${storeName}_all`, JSON.stringify(items));
            callback(items);
        });
    }

    function offChanges(storeName) {
        const path = fleetPath(storeName);
        db.ref(path).off('value');
    }

    return {
        open, add, put, get, getAll, getAllByIndex, remove, clearStore,
        getSetting, setSetting, seed, exportAll, importAll, resetAll,
        onChanges, offChanges,
        // Multi-tenencia
        setFleet, getFleet, createFleetId,
        addGlobalUser, findGlobalUser, getGlobalUsersByFleet, hasGlobalUsers,
        migrateOldData
    };
})();
