/* ============================================
   FleetAdmin Pro — PWA Install Prompt (A2HS)
   Intercepta beforeinstallprompt y muestra un
   banner de instalación para conductores móviles.
   ============================================ */

const PWAInstall = (() => {
    let deferredPrompt = null;
    let bannerShown = false;

    const DISMISS_KEY = 'fleetadmin_pwa_dismiss';
    const DISMISS_DAYS = 7; // No volver a mostrar por 7 días si el usuario cierra

    // =============================================
    // 1. Interceptar el evento beforeinstallprompt
    // =============================================
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); // Evitar el mini-infobar nativo de Chrome
        deferredPrompt = e;
        console.log('📱 PWA: beforeinstallprompt capturado — listo para instalar');

        // Si el banner ya fue mostrado (usuario logueado), mostrarlo ahora
        if (bannerShown) {
            _renderBanner();
        }
    });

    // Detectar si la app se instaló exitosamente
    window.addEventListener('appinstalled', () => {
        console.log('📱 PWA: ✅ App instalada exitosamente');
        deferredPrompt = null;
        _removeBanner();
        // Limpiar el dismiss para que no quede basura
        localStorage.removeItem(DISMISS_KEY);
    });

    // =============================================
    // 2. Verificar si ya está instalada (standalone)
    // =============================================
    function _isInstalled() {
        // display-mode: standalone (Android/Chrome)
        if (window.matchMedia('(display-mode: standalone)').matches) return true;
        // iOS Safari standalone
        if (window.navigator.standalone === true) return true;
        return false;
    }

    // =============================================
    // 3. Verificar si el usuario dismisseó recientemente
    // =============================================
    function _wasDismissed() {
        try {
            const dismissed = localStorage.getItem(DISMISS_KEY);
            if (!dismissed) return false;
            const dismissDate = parseInt(dismissed, 10);
            const daysPassed = (Date.now() - dismissDate) / (1000 * 60 * 60 * 24);
            return daysPassed < DISMISS_DAYS;
        } catch (e) {
            return false;
        }
    }

    // =============================================
    // 4. Mostrar el banner de instalación
    //    Solo para conductores, solo en móvil, 
    //    solo si no está ya instalada
    // =============================================
    function showBanner() {
        bannerShown = true;

        // No mostrar si ya está instalada como PWA
        if (_isInstalled()) {
            console.log('📱 PWA: Ya está instalada — no mostrar banner');
            return;
        }

        // No mostrar si el usuario lo cerró recientemente
        if (_wasDismissed()) {
            console.log('📱 PWA: Banner dismisseado recientemente — no mostrar');
            return;
        }

        // Solo mostrar para conductores
        if (!Auth.isDriver()) {
            return;
        }

        // Si el prompt ya está disponible, renderizar inmediatamente
        if (deferredPrompt) {
            _renderBanner();
        }
        // Si no, el listener de beforeinstallprompt lo renderizará cuando llegue
    }

    // =============================================
    // 5. Renderizar el banner en el DOM
    // =============================================
    function _renderBanner() {
        if (document.getElementById('pwa-install-banner')) return; // Ya existe

        const banner = document.createElement('div');
        banner.id = 'pwa-install-banner';
        banner.className = 'pwa-install-banner';
        banner.innerHTML = `
            <div class="pwa-install-content">
                <div class="pwa-install-icon">📱</div>
                <div class="pwa-install-text">
                    <strong>Instalar App en el Celular</strong>
                    <span>Acceso rápido desde tu pantalla de inicio</span>
                </div>
            </div>
            <div class="pwa-install-actions">
                <button class="pwa-install-btn" onclick="PWAInstall.triggerInstall()">
                    Instalar
                </button>
                <button class="pwa-install-close" onclick="PWAInstall.dismissBanner()" aria-label="Cerrar">
                    ✕
                </button>
            </div>
        `;

        document.body.appendChild(banner);

        // Animación de entrada (forzar reflow antes de agregar clase)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                banner.classList.add('visible');
            });
        });

        console.log('📱 PWA: Banner de instalación mostrado');
    }

    // =============================================
    // 6. Disparar el prompt nativo de instalación
    // =============================================
    async function triggerInstall() {
        if (!deferredPrompt) {
            console.warn('📱 PWA: No hay prompt disponible');
            // Fallback: mostrar instrucciones manuales
            _showManualInstructions();
            return;
        }

        try {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`📱 PWA: Usuario eligió: ${outcome}`);

            if (outcome === 'accepted') {
                console.log('📱 PWA: ✅ Instalación aceptada');
            } else {
                console.log('📱 PWA: ❌ Instalación rechazada');
            }
        } catch (err) {
            console.error('📱 PWA: Error en prompt:', err);
        } finally {
            deferredPrompt = null;
            _removeBanner();
        }
    }

    // =============================================
    // 7. Dismiss (cerrar) el banner con cooldown
    // =============================================
    function dismissBanner() {
        localStorage.setItem(DISMISS_KEY, Date.now().toString());
        _removeBanner();
        console.log('📱 PWA: Banner cerrado — no se mostrará por 7 días');
    }

    // =============================================
    // 8. Remover el banner del DOM
    // =============================================
    function _removeBanner() {
        const banner = document.getElementById('pwa-install-banner');
        if (!banner) return;

        banner.classList.remove('visible');
        banner.classList.add('hiding');
        setTimeout(() => banner.remove(), 400);
    }

    // =============================================
    // 9. Instrucciones manuales (fallback iOS/Firefox)
    // =============================================
    function _showManualInstructions() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const msg = isIOS
            ? 'Para instalar en iPhone/iPad:\n\n1. Tocá el botón "Compartir" (📤) en Safari\n2. Seleccioná "Agregar a pantalla de inicio"\n3. Tocá "Agregar"'
            : 'Para instalar la app:\n\n1. Abrí el menú del navegador (⋮)\n2. Seleccioná "Instalar aplicación" o "Agregar a pantalla de inicio"';

        if (typeof Components !== 'undefined' && Components.showToast) {
            Components.showToast(msg.replace(/\n/g, ' '), 'info');
        } else {
            alert(msg);
        }
        _removeBanner();
    }

    return { showBanner, triggerInstall, dismissBanner };
})();
