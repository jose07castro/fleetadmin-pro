/* ============================================
   FleetAdmin Pro — Base de Datos (Firebase)
   Realtime Database con sincronización en vivo
   API compatible con la versión anterior
   ============================================ */

const DB = (() => {
    const db = firebaseDB; // Definido en firebase-config.js

    // Stores válidos
    const VALID_STORES = ['users', 'vehicles', 'shifts', 'oilLogs', 'repairs', 'beltChanges'];

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

    // --- Operaciones CRUD genéricas ---
    async function add(storeName, data) {
        const ref = db.ref(storeName).push();
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
        await db.ref(`${storeName}/${data.id}`).set(updated);
        return data.id;
    }

    async function get(storeName, id) {
        try {
            const snap = await db.ref(`${storeName}/${id}`).once('value');
            return snap.val() || undefined;
        } catch (e) {
            return undefined;
        }
    }

    async function getAll(storeName) {
        const snap = await db.ref(storeName).once('value');
        const val = snap.val();
        if (!val) return [];
        return Object.values(val);
    }

    async function getAllByIndex(storeName, indexName, value) {
        const all = await getAll(storeName);
        return all.filter(item => String(item[indexName]) === String(value));
    }

    async function remove(storeName, id) {
        await db.ref(`${storeName}/${id}`).remove();
    }

    async function clearStore(storeName) {
        await db.ref(storeName).remove();
    }

    // --- Configuración (clave-valor) ---
    async function getSetting(key) {
        const snap = await db.ref(`settings/${key}`).once('value');
        return snap.val();
    }

    async function setSetting(key, value) {
        await db.ref(`settings/${key}`).set(value);
    }

    // --- Datos iniciales (seed) ---
    async function seed() {
        const usersSnap = await db.ref('users').once('value');
        const usersVal = usersSnap.val();

        if (!usersVal || Object.keys(usersVal).length === 0) {
            console.log('📦 Creando datos iniciales (seed)...');

            // Dueño por defecto
            const ownerRef = db.ref('users').push();
            await ownerRef.set({
                id: ownerRef.key,
                name: 'Admin',
                role: 'owner',
                pin: '123456789012345',
                createdAt: new Date().toISOString()
            });

            // Conductor de ejemplo
            const driverRef = db.ref('users').push();
            await driverRef.set({
                id: driverRef.key,
                name: 'Carlos',
                role: 'driver',
                pin: '111111111111111',
                createdAt: new Date().toISOString()
            });

            // Mecánico de ejemplo
            const mechRef = db.ref('users').push();
            await mechRef.set({
                id: mechRef.key,
                name: 'Miguel',
                role: 'mechanic',
                pin: '222222222222222',
                createdAt: new Date().toISOString()
            });

            console.log('✅ Datos iniciales creados');
        }
    }

    // --- Exportar/Importar datos ---
    async function exportAll() {
        const exportData = {};
        for (const store of VALID_STORES) {
            exportData[store] = await getAll(store);
        }
        const settingsSnap = await db.ref('settings').once('value');
        const settingsVal = settingsSnap.val() || {};
        exportData.settings = Object.entries(settingsVal).map(([key, value]) => ({ key, value }));
        return exportData;
    }

    async function importAll(data) {
        for (const store of VALID_STORES) {
            if (data[store] && Array.isArray(data[store])) {
                await db.ref(store).remove();
                for (const item of data[store]) {
                    const ref = db.ref(store).push();
                    await ref.set({ ...item, id: ref.key });
                }
            }
        }
        if (data.settings) {
            if (Array.isArray(data.settings)) {
                const settingsObj = {};
                data.settings.forEach(s => { settingsObj[s.key] = s.value; });
                await db.ref('settings').set(settingsObj);
            } else {
                await db.ref('settings').set(data.settings);
            }
        }
    }

    async function resetAll() {
        for (const store of VALID_STORES) {
            await db.ref(store).remove();
        }
        await db.ref('settings').remove();
        await seed();
    }

    // --- Sincronización en tiempo real ---
    // Registrar un listener para cambios en un store
    function onChanges(storeName, callback) {
        db.ref(storeName).on('value', (snap) => {
            const val = snap.val();
            const items = val ? Object.values(val) : [];
            callback(items);
        });
    }

    // Remover listener
    function offChanges(storeName) {
        db.ref(storeName).off('value');
    }

    return {
        open, add, put, get, getAll, getAllByIndex, remove, clearStore,
        getSetting, setSetting, seed, exportAll, importAll, resetAll,
        onChanges, offChanges
    };
})();
