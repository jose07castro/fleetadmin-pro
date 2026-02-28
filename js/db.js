/* ============================================
   FleetAdmin Pro — Base de Datos (API Backend)
   Todas las operaciones van al servidor Node.js
   API idéntica a la versión IndexedDB
   ============================================ */

const DB = (() => {
    const API_BASE = '/api';

    // --- Helper para llamadas fetch ---
    async function apiFetch(url, options = {}) {
        const res = await fetch(`${API_BASE}${url}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Error de red' }));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        return res.json();
    }

    // --- Abrir conexión (health-check) ---
    async function open() {
        // Verificar que el servidor responde
        try {
            await apiFetch('/settings');
            return true;
        } catch (e) {
            console.error('No se pudo conectar al servidor:', e);
            throw e;
        }
    }

    // --- Operaciones CRUD genéricas ---
    async function add(storeName, data) {
        const result = await apiFetch(`/${storeName}`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
        return result.id;
    }

    async function put(storeName, data) {
        if (!data.id) throw new Error('put() requiere un ID');
        const result = await apiFetch(`/${storeName}/${data.id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        return result.id;
    }

    async function get(storeName, id) {
        try {
            return await apiFetch(`/${storeName}/${id}`);
        } catch (e) {
            return undefined;
        }
    }

    async function getAll(storeName) {
        return await apiFetch(`/${storeName}`);
    }

    async function getAllByIndex(storeName, indexName, value) {
        return await apiFetch(`/${storeName}/index/${indexName}/${encodeURIComponent(value)}`);
    }

    async function remove(storeName, id) {
        await apiFetch(`/${storeName}/${id}`, { method: 'DELETE' });
    }

    async function clearStore(storeName) {
        await apiFetch(`/${storeName}`, { method: 'DELETE' });
    }

    // --- Configuración (clave-valor) ---
    async function getSetting(key) {
        const result = await apiFetch(`/settings/${key}`);
        return result.value;
    }

    async function setSetting(key, value) {
        await apiFetch(`/settings/${key}`, {
            method: 'PUT',
            body: JSON.stringify({ value })
        });
    }

    // --- Datos iniciales (seed) ---
    async function seed() {
        await apiFetch('/seed', { method: 'POST' });
    }

    // --- Exportar/Importar datos ---
    async function exportAll() {
        return await apiFetch('/export');
    }

    async function importAll(data) {
        await apiFetch('/import', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async function resetAll() {
        await apiFetch('/reset', { method: 'POST' });
    }

    return {
        open, add, put, get, getAll, getAllByIndex, remove, clearStore,
        getSetting, setSetting, seed, exportAll, importAll, resetAll
    };
})();
