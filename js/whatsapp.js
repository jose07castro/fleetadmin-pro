/* ============================================
   FleetAdmin Pro — Integración WhatsApp
   Envío de notificaciones via CallMeBot API
   ============================================ */

const WhatsApp = (() => {

    /**
     * Enviar mensaje por WhatsApp usando CallMeBot
     * @param {string} phone - Número con código de país (ej: 5493476123456)
     * @param {string} apiKey - API Key de CallMeBot
     * @param {string} message - Mensaje a enviar
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async function send(phone, apiKey, message) {
        if (!phone || !apiKey || !message) {
            return { ok: false, error: 'Faltan parámetros (phone, apiKey, message)' };
        }

        try {
            // Usar el proxy del servidor para evitar CORS
            const response = await fetch('/api/whatsapp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, apiKey, message })
            });

            const data = await response.json();
            if (response.ok && data.success) {
                console.log('📱 WhatsApp enviado correctamente');
                return { ok: true };
            } else {
                console.warn('📱 Error WhatsApp:', data.error);
                return { ok: false, error: data.error || 'Error desconocido' };
            }
        } catch (e) {
            console.error('📱 Error de red WhatsApp:', e);
            return { ok: false, error: e.message };
        }
    }

    /**
     * Notificar auto-cierre de turno
     * @param {object} shift - Datos del turno
     * @param {object} vehicle - Datos del vehículo
     */
    async function notifyShiftAutoClose(shift, vehicle) {
        const phone = await DB.getSetting('whatsapp_phone');
        const apiKey = await DB.getSetting('whatsapp_apikey');

        if (!phone || !apiKey) {
            console.log('📱 WhatsApp no configurado, omitiendo notificación');
            return;
        }

        const vehicleName = vehicle ? `${vehicle.name} (${vehicle.plate})` : 'Desconocido';
        const driverName = shift.driverName || 'Sin conductor';
        const hoursActive = shift.startTime
            ? Math.round((Date.now() - new Date(shift.startTime).getTime()) / 3600000)
            : '?';

        const message = `🚨 *AUTO-CIERRE DE TURNO*\n\n` +
            `🚗 Vehículo: ${vehicleName}\n` +
            `👤 Conductor: ${driverName}\n` +
            `⏱️ Horas activo: ${hoursActive}h\n` +
            `📍 Motivo: Vehículo en zona DOMICILIO_CHOFER por +8h\n` +
            `📅 ${new Date().toLocaleString()}\n\n` +
            `_Enviado por FleetAdmin Pro_`;

        return send(phone, apiKey, message);
    }

    /**
     * Notificar evento GPS genérico
     * @param {string} eventType - Tipo de evento
     * @param {object} details - Detalles adicionales
     */
    async function notifyGPSEvent(eventType, details) {
        const phone = await DB.getSetting('whatsapp_phone');
        const apiKey = await DB.getSetting('whatsapp_apikey');

        if (!phone || !apiKey) return;

        const message = `📡 *ALERTA GPS*\n\n` +
            `📋 Evento: ${eventType}\n` +
            `🚗 Vehículo: ${details.vehiclePlate || '-'}\n` +
            `📍 Zona: ${details.zone || '-'}\n` +
            `📅 ${new Date().toLocaleString()}\n\n` +
            `_Enviado por FleetAdmin Pro_`;

        return send(phone, apiKey, message);
    }

    return { send, notifyShiftAutoClose, notifyGPSEvent };
})();
