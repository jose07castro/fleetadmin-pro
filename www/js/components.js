/* ============================================
   FleetAdmin Pro — Componentes UI Reutilizables
   ============================================ */

const Components = (() => {

    // Helper: escapar valores para insertar de forma segura en atributos HTML (value="...")
    // Previene que comillas, &, < en datos del usuario rompan el HTML en móviles
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // --- Layout principal con sidebar ---
    function renderLayout(content, activeRoute) {
        const user = Auth.getUser();
        const role = Auth.getRole();

        return `
            <div class="app-layout">
                ${renderSidebar(activeRoute, user, role)}
                <div class="sidebar-overlay" id="sidebarOverlay"></div>
                <div class="app-main">
                    ${renderHeader(activeRoute)}
                    <div id="announcement-banner"></div>
                    <div class="app-content" id="pageContent">
                        ${content}
                    </div>
                </div>
                ${renderMobileBottomNav(activeRoute, role)}
                ${role === 'driver' ? renderSOSFab() : ''}
            </div>
        `;
    }

    // --- Sidebar de navegación ---
    function renderSidebar(activeRoute, user, role) {
        const navItems = getNavItems(role);

        return `
            <aside class="app-sidebar" id="sidebar">
                <div class="sidebar-header">
                    <div class="sidebar-logo">
                        <img src="assets/sidebar-banner.png" class="sidebar-logo-img" alt="Punto Alertas Branding">
                    </div>
                </div>
                <nav class="sidebar-nav">
                    <div class="nav-section-title">${I18n.t('nav_operations')}</div>
                    ${navItems.filter(n => n.section === 'ops').map(item => {
                        if (item.route === 'apply') {
                            return `<div class="nav-item apply-mobile-btn" onclick="Router.navigate('${item.route}')" style="display:flex !important; visibility:visible !important; opacity:1 !important; margin: var(--space-4) 0; padding: var(--space-3); width: 100% !important; background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; color: #10b981; border-radius: var(--radius-lg); justify-content: center; align-items: center; font-weight: 700; font-size: 1.1rem; box-sizing: border-box;">
                                <span style="font-size: 1.3rem; margin-right: 8px;">${item.icon}</span>
                                <span>${I18n.t(item.label)}</span>
                            </div>`;
                        }
                        return `<div class="nav-item ${activeRoute === item.route ? 'active' : ''}" onclick="Router.navigate('${item.route}')">
                            <span class="nav-icon">${item.icon}</span>
                            <span>${I18n.t(item.label)}</span>
                        </div>`;
                    }).join('')}

                    <div class="nav-section-title">${I18n.t('nav_management')}</div>
                    ${navItems.filter(n => n.section === 'mgmt').map(item => {
                        if (item.route === 'apply') {
                            return `<div class="nav-item apply-mobile-btn" onclick="Router.navigate('${item.route}')" style="display:flex !important; visibility:visible !important; opacity:1 !important; margin: var(--space-4) 0; padding: var(--space-3); width: 100% !important; background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; color: #10b981; border-radius: var(--radius-lg); justify-content: center; align-items: center; font-weight: 700; font-size: 1.1rem; box-sizing: border-box;">
                                <span style="font-size: 1.3rem; margin-right: 8px;">${item.icon}</span>
                                <span>${I18n.t(item.label)}</span>
                            </div>`;
                        }
                        return `<div class="nav-item ${activeRoute === item.route ? 'active' : ''}" onclick="Router.navigate('${item.route}')">
                            <span class="nav-icon">${item.icon}</span>
                            <span>${I18n.t(item.label)}</span>
                        </div>`;
                    }).join('')}
                    ${role === 'owner' ? `<div class="nav-item" onclick="document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('sidebarOverlay')?.classList.remove('active'); SettingsModule.showReportModal()">
                            <span class="nav-icon">🚩</span>
                            <span>Veraz de Conductores</span>
                        </div>` : ''}
                </nav>
                <div class="sidebar-footer">
                    <div class="nav-item" onclick="Components.showDonationModal()" style="margin-bottom: var(--space-3); background: rgba(255, 193, 7, 0.08); border: 1px solid rgba(255, 193, 7, 0.3); color: #ffc107; border-radius: var(--radius-md); font-weight: 700; display: flex; align-items: center; cursor: pointer;">
                        <span class="nav-icon" style="color: #ffc107; margin-right: 8px;">💝</span>
                        <span>Colaborar App</span>
                    </div>
                    <div class="sidebar-user">
                        ${user?.profilePhoto
                ? `<img src="${user.profilePhoto}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">`
                : `<div class="sidebar-user-avatar">${(user?.name || 'U')[0].toUpperCase()}</div>`
            }
                        <div class="sidebar-user-info">
                            <div class="sidebar-user-name">${user?.name || ''}</div>
                            <div class="sidebar-user-role">${I18n.t('role_' + role)}</div>
                        </div>
                    </div>
                    <div class="nav-item" onclick="App.logout()" style="margin-top: var(--space-2);">
                        <span class="nav-icon">🚪</span>
                        <span>${I18n.t('nav_logout')}</span>
                    </div>
                </div>
            </aside>
        `;
    }

    // --- Items de navegación según el rol ---
    function getNavItems(role) {
        const items = {
            owner: [
                { icon: '📊', label: 'nav_dashboard', route: 'dashboard', section: 'ops' },
                { icon: '🚗', label: 'nav_vehicles', route: 'vehicles', section: 'ops' },
                { icon: '📝', label: 'Candidatos', route: 'applicants', section: 'ops' },
                { icon: '⏱️', label: 'nav_shifts', route: 'shifts', section: 'ops' },
                { icon: '🤝', label: 'nav_community', route: 'community', section: 'ops' },
                { icon: '🔧', label: 'nav_maintenance', route: 'maintenance', section: 'mgmt' },
                { icon: '🛢️', label: 'nav_oil', route: 'oil', section: 'mgmt' },
                { icon: '📡', label: 'nav_gps', route: 'gps', section: 'mgmt' },
            ],
            driver: [
                { icon: '📡', label: 'nav_gps', route: 'gps', section: 'ops' },
                { icon: '⏱️', label: 'nav_shifts', route: 'shifts', section: 'ops' },
                { icon: '🛢️', label: 'nav_oil', route: 'oil', section: 'ops' },
                { icon: '🤝', label: 'nav_community', route: 'community', section: 'ops' },
                { icon: '🪪', label: 'app_apply_btn', route: 'apply', section: 'ops' },
            ],
            mechanic: [
                { icon: '🔧', label: 'nav_maintenance', route: 'maintenance', section: 'ops' },
                { icon: '🤝', label: 'nav_community', route: 'community', section: 'ops' },
                { icon: '🪪', label: 'app_apply_btn', route: 'apply', section: 'ops' }
            ]
        };
        return items[role] || [];
    }

    // --- Mobile bottom navigation bar ---
    function renderMobileBottomNav(activeRoute, role) {
        const mobileItems = {
            owner: [
                { icon: '📊', label: 'Panel', route: 'dashboard' },
                { icon: '⏱️', label: 'Turnos', route: 'shifts' },
                { icon: '🤝', label: 'Comunidad', route: 'community' },
                { icon: '🚪', label: 'Salir', route: '__logout__' }
            ],
            driver: [
                { icon: '📡', label: 'Desplegar GPS', route: 'gps' },
                { icon: '⏱️', label: 'Turnos', route: 'shifts' },
                { icon: '🤝', label: 'Comunidad', route: 'community' },
                { icon: '🛢️', label: 'Aceite', route: 'oil' },
                { icon: '🚪', label: 'Salir', route: '__logout__' }
            ],
            mechanic: [
                { icon: '🔧', label: 'Taller', route: 'maintenance' },
                { icon: '🤝', label: 'Comunidad', route: 'community' },
                { icon: '🪪', label: 'Postular', route: 'apply' },
                { icon: '🚪', label: 'Salir', route: '__logout__' }
            ]
        };
        const items = mobileItems[role] || [];

        return `
            <nav class="mobile-bottom-nav">
                ${items.map(item => {
                    if (item.route === '__logout__') {
                        return `
                        <div class="mobile-nav-item mobile-nav-logout" 
                             onclick="App.logout()">
                            <span class="mobile-nav-icon">${item.icon}</span>
                            <span class="mobile-nav-label">${item.label}</span>
                        </div>`;
                    }
                    return `
                    <div class="mobile-nav-item ${activeRoute === item.route ? 'active' : ''}" 
                         onclick="Router.navigate('${item.route}')"
                         ${item.route === 'apply' ? 'style="display:flex !important; visibility:visible !important; opacity:1 !important;"' : ''}>
                        <span class="mobile-nav-icon">${item.icon}</span>
                        <span class="mobile-nav-label">${item.label}</span>
                    </div>`;
                }).join('')}
            </nav>
        `;
    }

    // --- SOS Floating Action Button (drivers only, mobile) ---
    function renderSOSFab() {
        return `
            <button class="sos-fab" onclick="(function(){
                if (typeof SOSModule === 'undefined') { console.warn('SOSModule not loaded yet'); return; }
                var d = typeof ShiftsModule !== 'undefined' ? ShiftsModule.getActiveShiftData() : {};
                SOSModule.triggerSOS(d.shiftId || '', d.vehicleId || '', d.vehicleName || '');
            })()" title="SOS Emergencia">
                🆘
            </button>
        `;
    }

    // --- Header ---
    function renderHeader(activeRoute) {
        const titles = {
            dashboard: 'nav_dashboard',
            vehicles: 'nav_vehicles',
            shifts: 'nav_shifts',
            maintenance: 'nav_maintenance',
            mechanic: 'nav_mechanic',
            oil: 'nav_oil',
            gps: 'nav_gps',
            settings: 'nav_settings',
            community: 'nav_community'
        };

        return `
            <header class="app-header">
                <div class="header-left">
                    <button class="header-menu-btn" id="menuBtn" onclick="App.toggleSidebar()">☰</button>
                    <h1 class="header-title">${I18n.t(titles[activeRoute] || 'app_name')}</h1>
                </div>
                <div class="header-right">
                    ${renderUnitToggles()}
                </div>
            </header>
        `;
    }

    // --- Toggles de unidades en el header ---
    function renderUnitToggles() {
        const dUnit = Units.getDistanceUnit();
        const vUnit = Units.getVolumeUnit();

        return `
            <div class="toggle-group">
                <button class="toggle-option ${dUnit === 'km' ? 'active' : ''}"
                    onclick="App.setDistanceUnit('km')">KM</button>
                <button class="toggle-option ${dUnit === 'mi' ? 'active' : ''}"
                    onclick="App.setDistanceUnit('mi')">MI</button>
            </div>
            <div class="toggle-group">
                <button class="toggle-option ${vUnit === 'l' ? 'active' : ''}"
                    onclick="App.setVolumeUnit('l')">L</button>
                <button class="toggle-option ${vUnit === 'gal' ? 'active' : ''}"
                    onclick="App.setVolumeUnit('gal')">GAL</button>
            </div>
        `;
    }

    // --- Selector de idioma ---
    function renderLanguageSelector() {
        const langs = I18n.getAvailableLanguages();
        const current = I18n.getLanguage();

        return `
            <div class="toggle-group">
                ${langs.map(l =>
            `<button class="toggle-option ${current === l.code ? 'active' : ''}"
                        onclick="App.setLanguage('${l.code}')">${l.flag} ${l.code.toUpperCase()}</button>`
        ).join('')}
            </div>
        `;
    }

    // --- Modal genérico ---
    // options: { staticBackdrop: boolean, onClose: function }
    //   staticBackdrop = true → clic fuera NO cierra el modal
    //   onClose = fn → el botón ✕ ejecuta fn() en vez de closeModal()
    function showModal(title, bodyHTML, footerHTML = '', options = {}) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'activeModal';

        // Determinar la acción del botón ✕
        const closeButtonId = 'modalCloseBtn_' + Date.now();

        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3 class="modal-title">${title}</h3>
                    <button class="modal-close" id="${closeButtonId}">✕</button>
                </div>
                <div class="modal-body">${bodyHTML}</div>
                ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
            </div>
        `;

        // Backdrop click: solo si NO es static
        if (!options.staticBackdrop) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) Components.closeModal();
            });
        }

        document.body.appendChild(modal);

        // Wiring del botón ✕
        const closeBtn = document.getElementById(closeButtonId);
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (typeof options.onClose === 'function') {
                    options.onClose();
                } else {
                    Components.closeModal();
                }
            });
        }
    }

    function closeModal() {
        const modal = document.getElementById('activeModal');
        if (modal) modal.remove();
    }

    // --- Notificación toast ---
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `alert-banner alert-banner-${type}`;
        toast.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2000;max-width:400px;box-shadow:var(--shadow-lg);';
        toast.innerHTML = `
            <span class="alert-icon">${type === 'success' ? '✅' : type === 'danger' ? '❌' : '⚠️'}</span>
            <div class="alert-content">${message}</div>
            <button class="alert-close" onclick="this.parentElement.remove()">✕</button>
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // --- Componente de captura de foto ---
    // v106: FileReader.readAsDataURL() ELIMINADO
    // Ya no se convierte la imagen a Base64 en memoria.
    // El preview usa URL.createObjectURL (no toca la RAM).
    // La subida real a Storage la hace StorageUtil directamente.
    function renderPhotoCapture(id, label) {
        return `
            <div class="form-group">
                <label class="form-label">${label}</label>
                <div class="photo-capture" id="${id}Wrapper" style="display:flex; flex-direction:column; gap:10px; padding:var(--space-4);">
                    <div style="display:flex; gap:10px;">
                        <!-- Botón para Cámara -->
                        <div style="flex:1; position:relative; border:2px dashed var(--border-color); border-radius:var(--radius-lg); padding:var(--space-4); text-align:center; cursor:pointer;">
                            <input type="file" accept="image/*" capture="environment" id="${id}InputCamera" onchange="Components.handlePhoto('${id}', event, this)" style="position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%;">
                            <div style="font-size:2rem; margin-bottom:5px;">📷</div>
                            <div style="font-size:var(--font-size-xs); color:var(--text-secondary);">Cámara</div>
                        </div>
                        <!-- Botón para Galería -->
                        <div style="flex:1; position:relative; border:2px dashed var(--border-color); border-radius:var(--radius-lg); padding:var(--space-4); text-align:center; cursor:pointer;">
                            <input type="file" accept="image/*" id="${id}InputGallery" onchange="Components.handlePhoto('${id}', event, this)" style="position:absolute; inset:0; opacity:0; cursor:pointer; width:100%; height:100%;">
                            <div style="font-size:2rem; margin-bottom:5px;">🖼️</div>
                            <div style="font-size:var(--font-size-xs); color:var(--text-secondary);">Galería</div>
                        </div>
                    </div>
                </div>
                <!-- Input principal oculto para compatibilidad con código existente -->
                <input type="hidden" id="${id}Input">
                <div id="${id}Preview" style="display:none;" class="photo-preview">
                    <img id="${id}Img" src="" alt="">
                    <button class="photo-preview-remove" onclick="Components.removePhoto('${id}')">✕</button>
                </div>
            </div>
        `;
    }

    // v106: handlePhoto ya NO usa FileReader.readAsDataURL()
    // Usa URL.createObjectURL para preview ligero (0 bytes en RAM)
    function handlePhoto(id, event) {
        const file = event.target.files[0];
        if (!file) return;

        // Preview ligero sin Base64
        const objectUrl = URL.createObjectURL(file);
        document.getElementById(`${id}Img`).src = objectUrl;
        document.getElementById(`${id}Wrapper`).style.display = 'none';
        document.getElementById(`${id}Preview`).style.display = 'inline-block';

        // Guardar referencia al File para que StorageUtil lo suba después
        const hiddenInput = document.getElementById(`${id}Input`);
        if (hiddenInput) hiddenInput.dataset.file = 'pending';

        console.log(`📷 v106 handlePhoto('${id}'): preview con ObjectURL (0 bytes Base64)`);
    }

    function removePhoto(id) {
        const inputCam = document.getElementById(`${id}InputCamera`);
        if (inputCam) inputCam.value = '';
        const inputGal = document.getElementById(`${id}InputGallery`);
        if (inputGal) inputGal.value = '';
        const inputMain = document.getElementById(`${id}Input`);
        if (inputMain) { inputMain.value = ''; delete inputMain.dataset.file; }
        const img = document.getElementById(`${id}Img`);
        if (img && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
        if (img) img.src = '';
        document.getElementById(`${id}Wrapper`).style.display = 'flex';
        document.getElementById(`${id}Preview`).style.display = 'none';
    }

    // v106: getPhotoData ya NO devuelve Base64 gigante
    // Devuelve el File original del input para que StorageUtil lo comprima y suba
    function getPhotoData(id) {
        const inputCam = document.getElementById(`${id}InputCamera`);
        const inputGal = document.getElementById(`${id}InputGallery`);
        const file = (inputCam && inputCam.files[0]) || (inputGal && inputGal.files[0]);
        if (file) {
            // Devolver como data URL solo si es estrictamente necesario (legacy compat)
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(file);
            });
        }
        return null;
    }

    // --- Estado vacío ---
    function renderEmptyState(icon, text, subText = '', actionBtn = '') {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">${icon}</div>
                <div class="empty-state-text">${text}</div>
                <div class="empty-state-sub">${subText}</div>
                ${actionBtn}
            </div>
        `;
    }

    // --- Confirmación ---
    function confirm(message, onConfirm) {
        showModal(I18n.t('confirm'), `<p>${message}</p>`, `
            <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
            <button class="btn btn-danger" onclick="Components.closeModal(); (${onConfirm.toString()})()">${I18n.t('confirm')}</button>
        `);
    }

    // --- Modal de Colaboración Internacional ---
    function showDonationModal() {
        const alias = "Punto.alertas";
        const bodyHTML = `
            <div style="text-align:center; padding:var(--space-2);">
                <div style="font-size:3.5rem; margin-bottom:var(--space-3); animation: pulseYellow 2s infinite;">💝</div>
                <h3 style="font-size:var(--font-size-xl); font-weight:800; margin-bottom:var(--space-2); color:var(--text-primary);">
                    ¡Apoyá el crecimiento de Punto Alertas!
                </h3>
                <p style="font-size:var(--font-size-sm); color:var(--text-secondary); margin-bottom:var(--space-5); line-height:1.5;">
                    Gracias por apoyar el mantenimiento de Punto Alertas. Tu colaboración ayuda a que el servicio siga creciendo a nivel global.
                </p>

                <div style="background:rgba(255, 193, 7, 0.08); border:1px dashed rgba(255,193,7,0.4); border-radius:var(--radius-lg); padding:var(--space-4); margin-bottom:var(--space-5);">
                    <div style="font-size:var(--font-size-xs); color:var(--text-secondary); font-weight:700; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">
                        Alias Personal Pay (Principal)
                    </div>
                    <div style="font-size:22px; font-weight:900; color:#ffc107; text-shadow:0 2px 4px rgba(0,0,0,0.2); margin-bottom:var(--space-3); font-family:monospace;">
                        ${alias}
                    </div>
                    <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${alias}').then(() => { Components.showToast('✅ Alias copiado: ¡Gracias por apoyar el mantenimiento de Punto Alertas. Tu colaboración ayuda a que el servicio siga creciendo a nivel global!', 'success'); })" style="background:#ffc107; border-color:#ffc107; color:#000; font-weight:800; width:100%; display:flex; justify-content:center; align-items:center; gap:8px; border-radius:var(--radius-md);">
                        📋 Copiar Alias
                    </button>
                </div>

                <div style="margin-bottom:var(--space-4);">
                    <div style="font-size:var(--font-size-xs); color:var(--text-secondary); margin-bottom:var(--space-3); font-weight:600;">Montos sugeridos</div>
                    <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:10px;">
                        <button class="btn btn-outline" onclick="navigator.clipboard.writeText('${alias}').then(() => { Components.showToast('✅ Alias copiado por $1.000. ¡Muchas gracias!', 'success'); })" style="font-weight:700; display:flex; justify-content:center; border-radius:var(--radius-md);">$1.000</button>
                        <button class="btn btn-outline" onclick="navigator.clipboard.writeText('${alias}').then(() => { Components.showToast('✅ Alias copiado por $3.000. ¡Muchas gracias!', 'success'); })" style="font-weight:700; display:flex; justify-content:center; border-radius:var(--radius-md);">$3.000</button>
                        <button class="btn btn-outline" onclick="navigator.clipboard.writeText('${alias}').then(() => { Components.showToast('✅ Alias copiado por $5.000. ¡Muchas gracias!', 'success'); })" style="font-weight:700; display:flex; justify-content:center; border-radius:var(--radius-md);">$5.000</button>
                        <button class="btn btn-ghost" onclick="navigator.clipboard.writeText('${alias}').then(() => { Components.showToast('✅ Alias copiado. ¡Muchas gracias por tu aporte libre!', 'success'); })" style="font-weight:700; border:1px solid var(--border-color); display:flex; justify-content:center; border-radius:var(--radius-md);">Monto Libre</button>
                    </div>
                </div>
            </div>
        `;
        
        showModal('🤝 Colaboración Internacional', bodyHTML, `
            <button class="btn btn-secondary" onclick="Components.closeModal()" style="width:100%; display:flex; justify-content:center; border-radius:var(--radius-md);">Cerrar</button>
        `);
    }

    return {
        renderLayout, renderSidebar, renderHeader, renderUnitToggles,
        renderLanguageSelector, showModal, closeModal, showToast,
        renderPhotoCapture, handlePhoto, removePhoto, getPhotoData,
        renderEmptyState, confirm, escapeHTML, showDonationModal
    };
})();
