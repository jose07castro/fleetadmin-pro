/* ============================================
   FleetAdmin Pro — Announcement Banner
   Banner de anuncios global con marquesina
   Controlable por el Owner.
   - Drivers ven 'announcement'
   - Owners ven 'announcement_owner'
   ============================================ */

const AnnouncementModule = (() => {
    let _listenerRef = null;
    let _listening = false;

    // =============================================
    // Iniciar suscripción en tiempo real
    // Selecciona el path según el rol del usuario
    // =============================================
    function startListening() {
        const fleetId = DB.getFleet();
        if (!fleetId || _listening) return;

        // Determinar qué banner escuchar según el rol
        const role = Auth.getRole();
        const settingKey = role === 'owner' ? 'announcement_owner' : 'announcement';

        const path = `fleets/${fleetId}/settings/${settingKey}`;
        _listenerRef = firebaseDB.ref(path);

        _listenerRef.on('value', (snap) => {
            const data = snap.val();
            _renderBanner(data);
        });

        _listening = true;
        console.log(`📢 Announcement: Listener iniciado (rol: ${role}, key: ${settingKey})`);
    }

    // =============================================
    // Detener suscripción
    // =============================================
    function stopListening() {
        if (_listenerRef) {
            _listenerRef.off('value');
            _listenerRef = null;
        }
        _listening = false;
        // Limpiar banner del DOM
        const container = document.getElementById('announcement-banner');
        if (container) container.innerHTML = '';
        console.log('📢 Announcement: Listener detenido');
    }

    // =============================================
    // Renderizar o ocultar el banner
    // =============================================
    function _renderBanner(data) {
        const container = document.getElementById('announcement-banner');
        if (!container) return;

        // Si no hay data o está apagado, ocultar
        if (!data || !data.bannerActive || !data.bannerText) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        container.innerHTML = `
            <div class="announcement-bar">
                <div class="announcement-icon">📢</div>
                <div class="announcement-marquee">
                    <span class="announcement-marquee-text">${_escapeHTML(data.bannerText)}</span>
                </div>
            </div>
        `;
    }

    // =============================================
    // Escapar HTML para prevenir inyección
    // =============================================
    function _escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { startListening, stopListening };
})();
