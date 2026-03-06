/* ============================================
   FleetAdmin Pro — Componentes UI Reutilizables
   ============================================ */

const Components = (() => {

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
                    <div class="app-content" id="pageContent">
                        ${content}
                    </div>
                </div>
            </div>
        `;
    }

    // --- Sidebar de navegación ---
    function renderSidebar(activeRoute, user, role) {
        const navItems = getNavItems(role);

        return `
            <aside class="app-sidebar" id="sidebar">
                <div class="sidebar-header">
                    <div class="sidebar-logo">🚗</div>
                    <span class="sidebar-brand">FleetAdmin</span>
                </div>
                <nav class="sidebar-nav">
                    <div class="nav-section-title">${I18n.t('nav_operations')}</div>
                    ${navItems.filter(n => n.section === 'ops').map(item =>
            `<div class="nav-item ${activeRoute === item.route ? 'active' : ''}" onclick="Router.navigate('${item.route}')">
                            <span class="nav-icon">${item.icon}</span>
                            <span>${I18n.t(item.label)}</span>
                        </div>`
        ).join('')}

                    <div class="nav-section-title">${I18n.t('nav_management')}</div>
                    ${navItems.filter(n => n.section === 'mgmt').map(item =>
            `<div class="nav-item ${activeRoute === item.route ? 'active' : ''}" onclick="Router.navigate('${item.route}')">
                            <span class="nav-icon">${item.icon}</span>
                            <span>${I18n.t(item.label)}</span>
                        </div>`
        ).join('')}
                </nav>
                <div class="sidebar-footer">
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
                { icon: '⏱️', label: 'nav_shifts', route: 'shifts', section: 'ops' },
                { icon: '🔧', label: 'nav_maintenance', route: 'maintenance', section: 'mgmt' },
                { icon: '🛢️', label: 'nav_oil', route: 'oil', section: 'mgmt' },
                { icon: '⚙️', label: 'nav_settings', route: 'settings', section: 'mgmt' },
            ],
            driver: [
                { icon: '⏱️', label: 'nav_shifts', route: 'shifts', section: 'ops' },
                { icon: '🛢️', label: 'nav_oil', route: 'oil', section: 'ops' },
                { icon: '⚙️', label: 'nav_settings', route: 'settings', section: 'mgmt' },
            ],
            mechanic: [
                { icon: '🔧', label: 'nav_maintenance', route: 'maintenance', section: 'ops' },
                { icon: '⚙️', label: 'nav_settings', route: 'settings', section: 'mgmt' },
            ]
        };
        return items[role] || [];
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
            settings: 'nav_settings'
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
    function showModal(title, bodyHTML, footerHTML = '') {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'activeModal';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3 class="modal-title">${title}</h3>
                    <button class="modal-close" onclick="Components.closeModal()">✕</button>
                </div>
                <div class="modal-body">${bodyHTML}</div>
                ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
            </div>
        `;
        modal.addEventListener('click', (e) => {
            if (e.target === modal) Components.closeModal();
        });
        document.body.appendChild(modal);
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
    function renderPhotoCapture(id, label) {
        return `
            <div class="form-group">
                <label class="form-label">${label}</label>
                <div class="photo-capture" id="${id}Wrapper">
                    <input type="file" accept="image/*" capture="environment"
                        id="${id}Input" onchange="Components.handlePhoto('${id}', event)">
                    <div class="photo-capture-icon">📷</div>
                    <div class="photo-capture-text">${I18n.t('shift_take_photo')} / ${I18n.t('shift_upload_photo')}</div>
                </div>
                <div id="${id}Preview" style="display:none;" class="photo-preview">
                    <img id="${id}Img" src="" alt="">
                    <button class="photo-preview-remove" onclick="Components.removePhoto('${id}')">✕</button>
                </div>
            </div>
        `;
    }

    function handlePhoto(id, event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById(`${id}Img`).src = e.target.result;
            document.getElementById(`${id}Wrapper`).style.display = 'none';
            document.getElementById(`${id}Preview`).style.display = 'inline-block';
        };
        reader.readAsDataURL(file);
    }

    function removePhoto(id) {
        document.getElementById(`${id}Input`).value = '';
        document.getElementById(`${id}Img`).src = '';
        document.getElementById(`${id}Wrapper`).style.display = '';
        document.getElementById(`${id}Preview`).style.display = 'none';
    }

    function getPhotoData(id) {
        const img = document.getElementById(`${id}Img`);
        return img?.src || null;
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

    return {
        renderLayout, renderSidebar, renderHeader, renderUnitToggles,
        renderLanguageSelector, showModal, closeModal, showToast,
        renderPhotoCapture, handlePhoto, removePhoto, getPhotoData,
        renderEmptyState, confirm
    };
})();
