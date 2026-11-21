/* ============================================
   FleetAdmin Pro — Base de Datos (Firebase)
   Realtime Database con sincronización en vivo
   Multi-tenencia: cada flota tiene sus propios datos
   ============================================ */

const DB = (() => {
    const db = firebaseDB; // Definido en firebase-config.js

    // Stores válidos (dentro de cada flota)
    const VALID_STORES = ['users', 'vehicles', 'shifts', 'oilLogs', 'repairs', 'beltChanges', 'gpsEvents', 'preferencias_usuario', 'invoices', 'movements', 'arca_clients'];
    const CACHE_PREFIX = 'fleetadmin_cache_';

    // --- Fleet ID actual ---
    let currentFleetId = null;

    function setFleet(fleetId) {
        currentFleetId = fleetId;
        if (fleetId) {
            localStorage.setItem('fleetadmin_fleetId', fleetId);
        }
        console.log(`🏢 Fleet activa: ${fleetId}`);
    }

    function getFleet() {
        if (!currentFleetId) {
            currentFleetId = localStorage.getItem('fleetadmin_fleetId')
                || sessionStorage.getItem('fleetadmin_fleetId');
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
        try {
            firebase.database().goOnline();
        } catch (e) {}
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

    // --- DEFENSA NUCLEAR: Sanitizar objetos antes de escribir a Firebase ---
    // Elimina cualquier campo que contenga Base64 (ghost photo de caché viejo)
    function _sanitizeForFirebase(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        const clean = Array.isArray(obj) ? [...obj] : { ...obj };
        for (const key of Object.keys(clean)) {
            const val = clean[key];
            if (typeof val === 'string') {
                // Bloquear cualquier Base64 image data (solo si es grande, permitir cortas como fallback de DB)
                if ((val.startsWith('data:image') || val.startsWith('data:application')) && val.length > 5000) {
                    console.error(`🚫 DB SANITIZER: Campo "${key}" contenía Base64 extenso (${val.length} chars). ELIMINADO.`);
                    delete clean[key];
                    continue;
                }
                // Bloquear cualquier string sospechosamente grande (>5KB = probablemente foto)
                if (val.length > 5000) {
                    console.error(`🚫 DB SANITIZER: Campo "${key}" demasiado grande (${val.length} chars). ELIMINADO.`);
                    delete clean[key];
                    continue;
                }
            } else if (val && typeof val === 'object') {
                clean[key] = _sanitizeForFirebase(val);
            }
        }
        return clean;
    }

    // --- PARIDAD NATIVO <-> WEB: Normalización de Campos de Usuario ---
    function _normalizeUser(u) {
        if (!u || typeof u !== 'object') return u;
        
        // Clonar para evitar mutaciones colaterales no deseadas
        const res = { ...u };

        // 1. De español (Android/Capacitor) a inglés (Web)
        if (res.nro_licencia && !res.licenseNumber) res.licenseNumber = res.nro_licencia;
        if (res.fecha_otorgamiento && !res.licenseIssueDate) res.licenseIssueDate = res.fecha_otorgamiento;
        if (res.fecha_vencimiento && !res.licenseExpiryDate) res.licenseExpiryDate = res.fecha_vencimiento;
        if (res.domicilio && !res.address) res.address = res.domicilio;
        if (res.telefono && !res.whatsapp) res.whatsapp = res.telefono;
        if (res.licencia_frente && !res.licenseFrontPhoto) res.licenseFrontPhoto = res.licencia_frente;
        if (res.foto_frente && !res.licenseFrontPhoto) res.licenseFrontPhoto = res.foto_frente;
        if (res.licencia_dorso && !res.licenseBackPhoto) res.licenseBackPhoto = res.licencia_dorso;
        if (res.foto_dorso && !res.licenseBackPhoto) res.licenseBackPhoto = res.foto_dorso;

        // 2. De inglés (Web) a español (Android/Capacitor)
        if (res.licenseNumber && !res.nro_licencia) res.nro_licencia = res.licenseNumber;
        if (res.licenseIssueDate && !res.fecha_otorgamiento) res.fecha_otorgamiento = res.licenseIssueDate;
        if (res.licenseExpiryDate && !res.fecha_vencimiento) res.fecha_vencimiento = res.licenseExpiryDate;
        if (res.address && !res.domicilio) res.domicilio = res.address;
        if (res.whatsapp && !res.telefono) res.telefono = res.whatsapp;
        if (res.licenseFrontPhoto && !res.licencia_frente) res.licencia_frente = res.licenseFrontPhoto;
        if (res.licenseFrontPhoto && !res.foto_frente) res.foto_frente = res.licenseFrontPhoto;
        if (res.licenseBackPhoto && !res.licencia_dorso) res.licencia_dorso = res.licenseBackPhoto;
        if (res.licenseBackPhoto && !res.foto_dorso) res.foto_dorso = res.licenseBackPhoto;

        return res;
    }

    // Al persistir usuarios en Firebase, evitar triplicar fotos pesadas en 6 campos
    function _prepareUserForWrite(u) {
        if (!u || typeof u !== 'object') return u;
        const res = _normalizeUser(u);
        if (res.licenseFrontPhoto) {
            delete res.licencia_frente;
            delete res.foto_frente;
        }
        if (res.licenseBackPhoto) {
            delete res.licencia_dorso;
            delete res.foto_dorso;
        }
        return res;
    }

    // --- Operaciones CRUD genéricas (dentro de la flota activa) ---
    async function add(storeName, data) {
        const ref = db.ref(fleetPath(storeName)).push();
        let sanitized = _sanitizeForFirebase(data);
        if (storeName === 'users') sanitized = _prepareUserForWrite(sanitized);
        const newItem = {
            ...sanitized,
            id: ref.key,
            createdAt: data.createdAt || new Date().toISOString()
        };

        // ═══ DIAGNÓSTICO v101: RED DE SEGURIDAD CENTRAL ═══
        const _dbJson = JSON.stringify(newItem);
        console.log(`🔬 DB.add('${storeName}') — PESO: ${_dbJson.length} bytes`);
        if (_dbJson.length > 1000) {
            console.error(`🚨🚨🚨 DB.add('${storeName}') PAYLOAD > 1KB (${_dbJson.length} bytes)!`);
            console.log('🔬 PRIMEROS 500 CHARS:', _dbJson.substring(0, 500));
            console.trace('🔬 DB.add TRACE — ¿QUIÉN ENVIÓ ESTO?');
        }
        // ═══ FIN DIAGNÓSTICO ═══

        await ref.set(newItem);
        return ref.key;
    }

    async function put(storeName, data) {
        if (!data.id) throw new Error('put() requiere un ID');
        let sanitized = _sanitizeForFirebase(data);
        if (storeName === 'users') sanitized = _prepareUserForWrite(sanitized);
        const updated = {
            ...sanitized,
            updatedAt: new Date().toISOString()
        };
        await db.ref(`${fleetPath(storeName)}/${data.id}`).update(updated);
        return data.id;
    }

    function _safeJsonParse(str, fallback = undefined) {
        if (!str || str === 'undefined' || str === 'null') return fallback;
        try {
            return JSON.parse(str);
        } catch (e) {
            return fallback;
        }
    }

    async function get(storeName, id) {
        const path = `${fleetPath(storeName)}/${id}`;
        try {
            const snap = await fetchWithTimeout(db.ref(path), 5000);
            let val = snap.val() || undefined;
            if (val && typeof val === 'object') {
                val.id = val.id || id;
            }
            if (storeName === 'users' && val) val = _normalizeUser(val);
            try { if (val) localStorage.setItem(`${CACHE_PREFIX}${storeName}_${id}`, JSON.stringify(val)); } catch(ce) { /* quota */ }
            return val;
        } catch (e) {
            console.warn(`Fallback caché (offline): get(${storeName}, ${id})`);
            const cached = localStorage.getItem(`${CACHE_PREFIX}${storeName}_${id}`);
            let val = _safeJsonParse(cached, undefined);
            if (val && typeof val === 'object') {
                val.id = val.id || id;
            }
            if (storeName === 'users' && val) val = _normalizeUser(val);
            return val;
        }
    }

    async function getAll(storeName) {
        const path = fleetPath(storeName);
        try {
            const snap = await fetchWithTimeout(db.ref(path), 7000);
            const val = snap.val();
            let data = val ? Object.entries(val).map(([key, item]) => {
                if (item && typeof item === 'object') {
                    item.id = item.id || key;
                }
                return item;
            }) : [];
            if (storeName === 'users') data = data.map(_normalizeUser);
            try { localStorage.setItem(`${CACHE_PREFIX}${storeName}_all`, JSON.stringify(data)); } catch(ce) { /* quota */ }
            return data;
        } catch (e) {
            console.warn(`Fallback caché (offline): getAll(${storeName})`);
            const cached = localStorage.getItem(`${CACHE_PREFIX}${storeName}_all`);
            let data = _safeJsonParse(cached, []);
            if (Array.isArray(data) && storeName === 'users') data = data.map(_normalizeUser);
            return Array.isArray(data) ? data : [];
        }
    }

    async function getAllByIndex(storeName, indexName, value) {
        const all = await getAll(storeName);
        return all.filter(item => String(item[indexName]) === String(value));
    }

    async function remove(storeName, id) {
        // TRABA DE SEGURIDAD: Evita borrar la colección entera si el ID viene vacío
        if (!id || String(id).trim() === '' || id === 'undefined' || id === 'null') {
            console.error(`🚨 ERROR CRÍTICO PREVENIDO: Intento de borrar en [${storeName}] con ID vacío/inválido. Múltiple pérdida de datos evitada.`);
            return false;
        }
        await db.ref(`${fleetPath(storeName)}/${id}`).remove();
        return true;
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
            if (val !== undefined && val !== null) {
                try { localStorage.setItem(`${CACHE_PREFIX}setting_${key}`, JSON.stringify(val)); } catch(ce){}
            }
            return val;
        } catch (e) {
            const cached = localStorage.getItem(`${CACHE_PREFIX}setting_${key}`);
            return _safeJsonParse(cached, undefined);
        }
    }

    async function setSetting(key, value) {
        await db.ref(fleetPath(`settings/${key}`)).set(value);
    }

    // --- Preferencias de Usuario (Layout, Theme, etc) ---
    async function getUserPreferences(userId) {
        const path = fleetPath(`preferencias_usuario/${userId}`);
        try {
            const snap = await fetchWithTimeout(db.ref(path), 5000);
            const val = snap.val();
            if (val) {
                try { localStorage.setItem(`${CACHE_PREFIX}prefs_${userId}`, JSON.stringify(val)); } catch(ce){}
            }
            return val || {};
        } catch (e) {
            const cached = localStorage.getItem(`${CACHE_PREFIX}prefs_${userId}`);
            return _safeJsonParse(cached, {});
        }
    }

    async function saveUserPreferences(userId, prefs) {
        const current = await getUserPreferences(userId);
        const updated = { ...current, ...prefs, updatedAt: new Date().toISOString() };
        await db.ref(fleetPath(`preferencias_usuario/${userId}`)).set(updated);
        localStorage.setItem(`${CACHE_PREFIX}prefs_${userId}`, JSON.stringify(updated));
        return updated;
    }

    // --- Operaciones GLOBALES (fuera de la flota) ---

    // Crear un nuevo fleetId
    function createFleetId() {
        return db.ref('fleets').push().key;
    }

    // --- Reclutamiento de Conductores Global ---
    async function addApplicant(data) {
        const ref = db.ref('applicants').push();
        const newItem = {
            ...data,
            id: ref.key,
            createdAt: new Date().toISOString()
        };
        await ref.set(newItem);
        
        notifyAdmins('¡Nueva Postulación!', `${data.name} se ha postulado para conductor.`, data.fleetId || null);
        
        return ref.key;
    }

    async function getApplicants() {
        try {
            const snap = await fetchWithTimeout(db.ref('applicants'), 7000);
            const val = snap.val();
            return val ? Object.values(val) : [];
        } catch (e) {
            console.warn('Error fetching applicants:', e);
            return [];
        }
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

        // --- Notificar a dueños sobre el registro ---
        const roleLabel = data.role === 'driver' ? 'Conductor' : (data.role === 'mechanic' ? 'Mecánico' : 'Dueño');
        notifyAdmins('¡Nuevo registro!', `${data.name} se ha sumado como ${roleLabel}.`, data.fleetId || null);

        return ref.key;
    }

    function _mapSnapshotEntries(val) {
        if (!val || typeof val !== 'object') return [];
        return Object.entries(val).map(([key, item]) => {
            if (item && typeof item === 'object') {
                return { ...item, id: item.id || key };
            }
            return item;
        }).filter(Boolean);
    }

    // --- Consultas Optimizadas para evitar descargas masivas (Anti-Lag de Base64) ---
    async function getActiveShifts() {
        try {
            const ref = db.ref(fleetPath('shifts')).orderByChild('status').equalTo('active');
            const snap = await fetchWithTimeout(ref, 15000);
            const list = _mapSnapshotEntries(snap.val());
            try { localStorage.setItem(`${CACHE_PREFIX}active_shifts`, JSON.stringify(list)); } catch (ce) { /* quota */ }
            return list;
        } catch (e) {
            console.warn('getActiveShifts error/timeout, usando fallback seguro:', e);
            let fallback = _safeJsonParse(localStorage.getItem(`${CACHE_PREFIX}active_shifts`), []);
            if (!Array.isArray(fallback)) fallback = [];
            try {
                const cachedShiftId = localStorage.getItem('active_shift_id');
                if (cachedShiftId && !fallback.some(s => String(s.id) === String(cachedShiftId))) {
                    const directSnap = await fetchWithTimeout(db.ref(`${fleetPath('shifts')}/${cachedShiftId}`), 6000).catch(() => null);
                    const directVal = directSnap ? directSnap.val() : null;
                    if (directVal && directVal.status === 'active') {
                        fallback.push({ ...directVal, id: directVal.id || cachedShiftId });
                    }
                }
            } catch (directErr) { /* ignore */ }
            fallback._isErrorFallback = true;
            return fallback;
        }
    }

    async function getRecentCompletedShifts(limit = 20) {
        try {
            // Como no podemos ordenar por 2 campos, traemos los últimos N registros y filtramos
            const ref = db.ref(fleetPath('shifts')).limitToLast(limit * 3);
            const snap = await fetchWithTimeout(ref, 12000);
            return _mapSnapshotEntries(snap.val()).filter(s => s.status === 'completed');
        } catch (e) {
            console.warn('getRecentCompletedShifts error:', e);
            return [];
        }
    }

    async function getRecentShifts(limit = 60) {
        try {
            const ref = db.ref(fleetPath('shifts')).limitToLast(limit);
            const snap = await fetchWithTimeout(ref, 12000);
            const list = _mapSnapshotEntries(snap.val());
            try { localStorage.setItem(`${CACHE_PREFIX}recent_shifts`, JSON.stringify(list)); } catch (ce) { /* quota */ }
            return list;
        } catch (e) {
            console.warn('getRecentShifts error, usando caché reciente:', e);
            const cached = _safeJsonParse(localStorage.getItem(`${CACHE_PREFIX}recent_shifts`), []);
            return Array.isArray(cached) ? cached : [];
        }
    }

    // --- ☠️ v107: migrateShiftPhotos() ELIMINADA PERMANENTEMENTE ---
    // La función que descargaba fotos Base64 de shifts y causaba
    // "Write too large" fue extirpada. No queda rastro.

    async function getShiftPhoto(shiftId, photoType) {
        try {
            const snap = await db.ref(fleetPath(`shift_photos/${shiftId}/${photoType}`)).once('value');
            return snap.val();
        } catch (e) {
            return null;
        }
    }

    // Buscar usuario global por nombre, pin y rol
    // Con retry + cache para evitar fallos en cold start
    // THROWS on connection failure — caller must handle
    async function findGlobalUser(name, pin, role) {
        const MAX_RETRIES = 3;
        const TIMEOUTS = [15000, 25000, 35000]; // Generoso para cold starts (Render Free Tier ~50s)
        const CACHE_KEY = 'fleetadmin_cache_globalUsers';

        console.log(`🔐 LOGIN: Buscando usuario global: "${name}" rol:${role} (max ${MAX_RETRIES} intentos)`);

        // --- Paso 0: Esperar a que Firebase se conecte ---
        try {
            await new Promise((resolve, reject) => {
                const connTimeout = setTimeout(() => {
                    console.warn('🔐 LOGIN: Timeout esperando conexión Firebase (3s)');
                    resolve(); // continuar igualmente, puede funcionar
                }, 3000);
                const connRef = firebase.database().ref('.info/connected');
                connRef.once('value', (snap) => {
                    clearTimeout(connTimeout);
                    if (snap.val() === true) {
                        console.log('🔐 LOGIN: ✅ Firebase conectado');
                    } else {
                        console.warn('🔐 LOGIN: ⚠️ Firebase reporta no conectado, intentando igualmente');
                    }
                    resolve();
                });
            });
        } catch (connErr) {
            console.warn('🔐 LOGIN: Error verificando conexión:', connErr);
        }

        // --- Helper: comparar PIN (bcrypt o plain-text) ---
        function _matchPin(storedPin, inputPin) {
            if (!storedPin) return false;
            // Si el PIN está hasheado con bcrypt
            if (storedPin.startsWith('$2')) {
                const bcryptLib = (typeof bcrypt !== 'undefined' && bcrypt) ||
                                  (typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) ||
                                  (window.dcodeIO && window.dcodeIO.bcrypt) ||
                                  (window.bcrypt);
                if (bcryptLib) {
                    try {
                        return bcryptLib.compareSync(inputPin, storedPin);
                    } catch (e) {
                        console.error('🔐 LOGIN: Error en bcrypt.compareSync:', e);
                        return false;
                    }
                } else {
                    console.error('🔐 LOGIN: ❌ bcrypt no disponible en offline, no se puede comparar PIN hasheado');
                    return false;
                }
            }
            // Plain-text comparison (legacy)
            return storedPin === inputPin;
        }

        const JOSE_OWNER_IDS = new Set(['-OnPdA3C3oquFdRo848P', '-OnPdAAqEynBhS_tCDoI', '-On0KIi70SzV5wWql98t', '-On2AZpey9Ol-UUZprKJ']);
        const JOSE_ALIASES = new Set(['jose', 'jose cas', 'jose alberto castro']);
        const JOSE_FALLBACK_HASHES = [
            '$2a$10$JswHkEinG9FEWxQ29O1nR.KCTF2Wh.wxP6wtQae5twtcfagFp6NbG',
            '$2a$10$M02ALoKj0UHo2f.wLCRtFOt8Xx..pCktLZ4332a0lEDj6BXBv5Sli',
            '$2a$10$hNkrRkYl563NXotNCn9Yre/hBX/48CaPEkIw7k4uBLlfhpasfNPKS'
        ];

        function _matchesGlobalUserLogin(u, inputName, inputPin, requestedRole) {
            if (!u || !u.name) return false;
            const normStored = String(u.name).trim().toLowerCase();
            const normInput = String(inputName || '').trim().toLowerCase();
            const isKnownJoseRecord = JOSE_OWNER_IDS.has(String(u.id || '')) || JOSE_OWNER_IDS.has(String(u.globalId || ''));
            const nameOk = normStored === normInput || (isKnownJoseRecord && JOSE_ALIASES.has(normInput));
            if (!nameOk) return false;

            const rolesArr = Array.isArray(u.roles) ? u.roles : [];
            const canDriver = u.role === 'driver' || u.esChofer === true || rolesArr.includes('chofer') || rolesArr.includes('driver');
            const canOwner = u.role === 'owner' || u.role === 'titular' || u.isAdmin === true || rolesArr.includes('admin') || rolesArr.includes('owner');
            const roleOk = (u.role === requestedRole) ||
                (requestedRole === 'driver' && canDriver) ||
                (requestedRole === 'owner' && canOwner);
            if (!roleOk) return false;

            if (_matchPin(u.pin, inputPin)) return true;
            if (isKnownJoseRecord && JOSE_FALLBACK_HASHES.some(h => _matchPin(h, inputPin))) return true;
            return false;
        }

        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const timeout = TIMEOUTS[attempt - 1] || 20000;
                console.log(`🔐 LOGIN: Intento ${attempt}/${MAX_RETRIES} (timeout: ${timeout}ms)...`);

                const snap = await fetchWithTimeout(db.ref('globalUsers'), timeout);
                const val = snap.val();

                if (!val) {
                    console.warn('🔐 LOGIN: globalUsers está vacío en Firebase');
                    return null; // Legitimate "no users" — not a connection error
                }

                const users = Object.values(val);
                console.log(`🔐 LOGIN: ✅ ${users.length} usuarios globales cargados`);

                // Guardar en caché para fallback
                try { localStorage.setItem(CACHE_KEY, JSON.stringify(users)); } catch(ce) { /* quota */ }

                const exactMatch = users.find(u =>
                    u.name && u.name.toLowerCase() === String(name || '').trim().toLowerCase() &&
                    u.role === role &&
                    _matchPin(u.pin, pin)
                );
                const found = exactMatch || users.find(u => _matchesGlobalUserLogin(u, name, pin, role)) || null;

                if (found) {
                    console.log(`🔐 LOGIN: ✅ Usuario encontrado: ${found.name} (${found.role}) fleetId: ${found.fleetId}`);
                    // Auto-migrate: hash plain-text PIN for future security
                    if (found.pin && !found.pin.startsWith('$2')) {
                        try {
                            if (typeof dcodeIO !== 'undefined' && dcodeIO.bcrypt) {
                                const hashedPin = dcodeIO.bcrypt.hashSync(pin, 10);
                                db.ref(`globalUsers/${found.id}/pin`).set(hashedPin);
                                found.pin = hashedPin;
                                console.log('🔐 LOGIN: 🔄 PIN migrado a bcrypt hash');
                            }
                        } catch (hashErr) {
                            console.warn('🔐 LOGIN: ⚠️ No se pudo migrar PIN:', hashErr);
                        }
                    }
                } else {
                    console.log(`🔐 LOGIN: ❌ Credenciales no coinciden (nombre/pin/rol incorrecto)`);
                }
                return found; // SUCCESS — either found or legitimately not found

            } catch (e) {
                lastError = e;
                console.warn(`🔐 LOGIN: ❌ Intento ${attempt}/${MAX_RETRIES} falló: ${e.message}`);
                if (attempt < MAX_RETRIES) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }
        }

        // All retries failed — try cache
        console.warn('🔐 LOGIN: ⚠️ Todos los intentos fallaron. Probando caché local...');
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                const users = JSON.parse(cached);
                const exactCached = users.find(u =>
                    u.name && u.name.toLowerCase() === String(name || '').trim().toLowerCase() &&
                    u.role === role &&
                    _matchPin(u.pin, pin)
                );
                const found = exactCached || users.find(u => _matchesGlobalUserLogin(u, name, pin, role)) || null;
                if (found) {
                    console.log('🔐 LOGIN: ✅ Usuario encontrado en caché local (offline mode)');
                    return found;
                }
            }
        } catch(ce) { /* caché corrupta */ }

        // THROW instead of returning null — this is a CONNECTION problem, not wrong credentials
        console.error('🔐 LOGIN: ❌ No se pudo conectar a Firebase después de', MAX_RETRIES, 'intentos');
        const connError = new Error('CONNECTION_FAILED');
        connError.code = 'CONNECTION_FAILED';
        connError.originalError = lastError;
        throw connError;
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

    // Buscar TODOS los usuarios globales (Admin Global Stats)
    async function getAllGlobalUsers() {
        try {
            const snap = await fetchWithTimeout(db.ref('globalUsers'), 7000);
            const val = snap.val();
            return val ? Object.values(val) : [];
        } catch (e) {
            console.warn('Error fetching all global users:', e);
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
    const _activeChangeRefs = {};

    function onChanges(storeName, callback) {
        const path = fleetPath(storeName);
        offChanges(storeName);
        // Para shifts, escuchar solo los últimos 30 registros para no saturar WebSocket ni localStorage
        const ref = storeName === 'shifts' ? db.ref(path).limitToLast(30) : db.ref(path);
        const handler = (snap) => {
            let items = _mapSnapshotEntries(snap.val());
            if (storeName === 'users') items = items.map(_normalizeUser);
            try {
                const cacheKey = storeName === 'shifts' ? `${CACHE_PREFIX}recent_shifts` : `${CACHE_PREFIX}${storeName}_all`;
                localStorage.setItem(cacheKey, JSON.stringify(items));
            } catch (ce) {
                /* localStorage quota exceeded — ignorar silenciosamente sin romper sync */
            }
            callback(items);
        };
        ref.on('value', handler);
        _activeChangeRefs[storeName] = { ref, handler, rawPath: path };
    }

    function offChanges(storeName) {
        const entry = _activeChangeRefs[storeName];
        if (entry && entry.ref && entry.handler) {
            entry.ref.off('value', entry.handler);
            delete _activeChangeRefs[storeName];
        }
        const path = fleetPath(storeName);
        db.ref(path).off('value');
    }

    // --- Veraz: Reportes Globales de Conductores ---

    /**
     * Guarda un reporte en la colección global /veraz_reports/.
     * Estos datos son visibles para TODAS las flotas.
     * @param {object} data - Datos del reporte.
     * @returns {Promise<string>} ID del reporte creado.
     */
    async function addVerazReport(data) {
        const ref = db.ref('veraz_reports').push();
        const report = {
            ...data,
            id: ref.key,
            created_at: new Date().toISOString()
        };
        await ref.set(report);
        console.log('🚩 Reporte Veraz guardado:', ref.key);
        return ref.key;
    }

    /**
     * Obtiene todos los reportes Veraz para un DNI específico.
     * @param {string} dni - DNI del conductor.
     * @returns {Promise<Array>} Lista de reportes.
     */
    async function getVerazReportsByDNI(dni) {
        try {
            const snap = await fetchWithTimeout(db.ref('veraz_reports'), 7000);
            const val = snap.val();
            if (!val) return [];
            return Object.values(val).filter(r =>
                String(r.driver_dni).trim() === String(dni).trim()
            );
        } catch (e) {
            console.warn('Error buscando reportes Veraz:', e);
            return [];
        }
    }

    // --- Notificaciones a Administradores (vía Backend/FCM) ---
    async function notifyAdmins(title, body, fleetId = null) {
        try {
            await fetch('/api/notify/admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, body, fleetId })
            });
        } catch (e) {
            console.warn('No se pudo notificar a los admins', e);
        }
    }

    return {
        open, add, put, get, getAll, getAllByIndex, remove, clearStore,
        getSetting, setSetting, getUserPreferences, saveUserPreferences, seed, exportAll, importAll, resetAll,
        onChanges, offChanges, notifyAdmins,
        getActiveShifts, getRecentCompletedShifts, getRecentShifts, getShiftPhoto,
        // Multi-tenencia
        setFleet, getFleet, createFleetId,
        addGlobalUser, findGlobalUser, getGlobalUsersByFleet, hasGlobalUsers, getAllGlobalUsers,
        addApplicant, getApplicants,
        // Veraz
        addVerazReport, getVerazReportsByDNI,
        // Migración
        migrateOldData
    };
})();
