/* ============================================
   FleetAdmin Pro — Dashboard del Dueño
   Vista general de la flota con gestión de usuarios
   ============================================ */

window.DashboardModule = (() => {
    // --- RENDER TRADICIONAL: fetch datos, devolver HTML completo ---
    async function render() {
        try {
            const [vehicles, shifts, repairs, alerts, users, location] = await Promise.all([
                DB.getAll('vehicles'),
                DB.getAll('shifts'),
                DB.getAll('repairs'),
                Alerts.getAllAlerts(),
                DB.getAll('users'),
                DB.getSetting('location')
            ]);

            const activeShifts = shifts.filter(s => s.status === 'active');
            const completedShifts = shifts.filter(s => s.status === 'completed');
            const totalEarnings = completedShifts.reduce((sum, s) => sum + (s.earnings || 0), 0);
            const totalRepairCost = repairs.reduce((sum, r) => sum + (r.cost || 0), 0);
            const netProfit = totalEarnings - totalRepairCost;

            const locationBadge = (location && location.city) ? `
                <p style="margin-top:var(--space-2); font-size:var(--font-size-sm);">
                    <span style="display:inline-flex; align-items:center; gap:var(--space-1); background:var(--bg-tertiary); padding:var(--space-1) var(--space-3); border-radius:var(--radius-full); color:var(--text-secondary);">
                        📍 ${location.city}, ${location.province}, ${location.country}
                    </span>
                </p>` : '';

            const locationBanner = (!location || !location.country) ? `
                <div class="card" style="background:linear-gradient(135deg, var(--color-primary), var(--color-info)); color:white; padding:var(--space-5); margin-bottom:var(--space-6); border:none;">
                    <div style="display:flex; align-items:center; gap:var(--space-4); flex-wrap:wrap;">
                        <div style="font-size:2.5rem;">🗺️</div>
                        <div style="flex:1; min-width:200px;">
                            <div style="font-size:var(--font-size-lg); font-weight:700; margin-bottom:var(--space-1);">${I18n.t('location_setup_title')}</div>
                            <div style="opacity:0.9; font-size:var(--font-size-sm);">${I18n.t('location_setup_subtitle')}</div>
                        </div>
                        <button class="btn" style="background:rgba(255,255,255,0.2); color:white; border:2px solid rgba(255,255,255,0.4); font-weight:600;" onclick="SettingsModule.showLocationSetup()">📍 ${I18n.t('location_edit')}</button>
                    </div>
                </div>` : '';

            const alertsHTML = alerts.length > 0 ? `
                <div class="dashboard-section">
                    <div class="dashboard-section-title">🚨 ${I18n.t('dash_alerts')}</div>
                    ${alerts.map(a => Alerts.renderAlertBanner(a)).join('')}
                </div>` : '';

            // NUEVO: Accesos Rápidos Dashboard (Botonera VIP)
            const quickActionsHTML = `
            <div class="dashboard-section" style="margin-bottom:var(--space-5);">
                <div class="dashboard-section-title" style="font-size:0.85rem; opacity:0.8; margin-bottom:var(--space-2); letter-spacing:0.5px; text-transform:uppercase;">⚡ Accesos Rápidos</div>
                <div class="quick-actions-scroll-container" style="display:flex; gap:var(--space-3); overflow-x:auto; padding:var(--space-1) var(--space-1) var(--space-3) var(--space-1); margin:0 -4px; scrollbar-width:none; -ms-overflow-style:none; -webkit-overflow-scrolling:touch;">
                    <style> .quick-actions-scroll-container::-webkit-scrollbar { display: none; } .q-btn:active { transform: scale(0.96); opacity: 0.9; } </style>
                    
                    <button class="q-btn" onclick="Router.navigate('oil')" style="background:linear-gradient(135deg, #f59e0b, #d97706); color:white; border:none; padding:14px 20px; border-radius:16px; display:flex; align-items:center; gap:10px; font-weight:700; flex-shrink:0; box-shadow:0 6px 12px rgba(217,119,6,0.25); cursor:pointer; transition:all 0.2s;">
                        <span style="font-size:1.5rem;">🛢️</span> Cargar Aceite
                    </button>
                    
                    ${Auth.isOwner() ? `
                    <button class="q-btn" onclick="Router.navigate('maintenance')" style="background:linear-gradient(135deg, #ef4444, #b91c1c); color:white; border:none; padding:14px 20px; border-radius:16px; display:flex; align-items:center; gap:10px; font-weight:700; flex-shrink:0; box-shadow:0 6px 12px rgba(185,28,28,0.25); cursor:pointer; transition:all 0.2s;">
                        <span style="font-size:1.5rem;">🔧</span> Reparaciones
                    </button>
                    ` : ''}
                    
                    <button class="q-btn" onclick="Router.navigate('shifts')" style="background:linear-gradient(135deg, #10b981, #059669); color:white; border:none; padding:14px 20px; border-radius:16px; display:flex; align-items:center; gap:10px; font-weight:700; flex-shrink:0; box-shadow:0 6px 12px rgba(16,185,129,0.25); cursor:pointer; transition:all 0.2s;">
                        <span style="font-size:1.5rem;">⏱️</span> Iniciar Turno
                    </button>
                    
                    <button class="q-btn" onclick="Router.navigate('vehicles')" style="background:linear-gradient(135deg, #3b82f6, #1d4ed8); color:white; border:none; padding:14px 20px; border-radius:16px; display:flex; align-items:center; gap:10px; font-weight:700; flex-shrink:0; box-shadow:0 6px 12px rgba(59,130,246,0.25); cursor:pointer; transition:all 0.2s;">
                        <span style="font-size:1.5rem;">🚗</span> Ver Flota
                    </button>
                </div>
            </div>`;

            let fleetHTML = '';
            if (vehicles.length > 0) {
                fleetHTML = `<div class="vehicle-cards">${await renderVehicleCards(vehicles)}</div>`;
            } else {
                fleetHTML = Components.renderEmptyState('🚗', I18n.t('veh_no_vehicles'), I18n.t('veh_add_first'),
                    `<button class="btn btn-primary" onclick="Router.navigate('vehicles')">${I18n.t('veh_add')}</button>`);
            }

            const activityHTML = await renderRecentActivity(shifts, repairs);

            let communityBadgeCount = '0';
            try {
                const snap = await firebaseDB.ref('community_posts').once('value');
                const c = snap.numChildren();
                communityBadgeCount = c > 99 ? '99+' : String(c);
            } catch (e) { communityBadgeCount = '0'; }

            let annData = null, annOwnerData = null;
            try { annData = await DB.getSetting('announcement'); } catch(e) {}
            try { annOwnerData = await DB.getSetting('announcement_owner'); } catch(e) {}
            const annText = annData?.bannerText || '';
            const annActive = !!annData?.bannerActive;
            const annOwnerText = annOwnerData?.bannerText || '';
            const annOwnerActive = !!annOwnerData?.bannerActive;

            // Wiring de toggles después del mount
            setTimeout(() => _wireAnnouncementToggles(), 100);

            // Wiring de Drag & Drop
            if (Auth.getUserName() === 'OwnerAdmin') {
                setTimeout(() => _wireDragAndDrop(), 100);
            }

            // Wiring de Split-Panes arrastrables (v110)
            setTimeout(() => {
                if (typeof UISettings !== 'undefined' && UISettings.wireSplitPanes) {
                    UISettings.wireSplitPanes();
                }
            }, 150);

            // Cargar Order del Layout
            let savedOrder = [];
            try {
                const prefs = await DB.getUserPreferences(Auth.getUserId());
                const isAndroid = /Android/i.test(navigator.userAgent);
                const layoutKey = isAndroid ? 'config_android' : 'config_web';
                savedOrder = prefs[layoutKey]?.statsOrder || [];
            } catch(e) {}

            let globalStatsHTML = '';
            if (Auth.getRole() === 'owner') {
                try {
                    const allGlobal = await DB.getAllGlobalUsers();
                    const globalOwners = allGlobal.filter(u => u.role === 'owner').length;
                    const globalDrivers = allGlobal.filter(u => u.role === 'driver').length;
                    
                    globalStatsHTML = `
                    <div class="dashboard-section" style="margin-bottom: var(--space-6);">
                        <div class="dashboard-section-title" style="color: var(--color-primary); display:flex; align-items:center; gap:8px;">
                            <span style="font-size: 1.5rem;">🛡️</span> <span style="font-weight:900; letter-spacing: -0.5px;">ESTADÍSTICA GLOBAL ADMIN</span>
                        </div>
                        <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                            <div class="stat-card" style="border: 2px solid #3b82f6; background: rgba(59, 130, 246, 0.05); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); cursor:pointer;" onclick="DashboardModule.showGlobalUsers('owner')">
                                <div class="stat-icon" style="background: #3b82f6; color: white;">👤</div>
                                <div><div class="stat-value" style="color: #3b82f6; font-size: 2.2rem; font-weight: 900;">${globalOwners}</div><div class="stat-label" style="font-weight: 700; color:var(--text-secondary);">Total Dueños Registrados</div></div>
                            </div>
                            <div class="stat-card" style="border: 2px solid #10b981; background: rgba(16, 185, 129, 0.05); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); cursor:pointer;" onclick="DashboardModule.showGlobalUsers('driver')">
                                <div class="stat-icon" style="background: #10b981; color: white;">👤</div>
                                <div><div class="stat-value" style="color: #10b981; font-size: 2.2rem; font-weight: 900;">${globalDrivers}</div><div class="stat-label" style="font-weight: 700; color:var(--text-secondary);">Total Choferes Registrados</div></div>
                            </div>
                        </div>
                    </div>`;
                } catch(e) {
                    console.warn('⚠️ Error Load Global Stats:', e);
                }
            }

            return `
            ${globalStatsHTML}
            <div class="dashboard-welcome" style="display:flex; align-items:flex-start; justify-content:space-between; gap:var(--space-4); flex-wrap:wrap;">
                <div>
                    <h2>${I18n.t('dash_welcome')} ${Auth.getUserName()}! 👋</h2>
                    <p>${I18n.t('dash_summary')}</p>
                    ${locationBadge}
                </div>
                ${Auth.isOwner() ? `
                    <div style="display:flex; align-items:center; gap:var(--space-3); flex-wrap:wrap;">
                        <button class="community-header-btn community-header-btn-xl" onclick="Router.navigate('community')">
                            <span class="community-btn-icon">💬</span>
                            <span class="community-btn-label">Comunidad de Dueños</span>
                            <span class="community-badge" id="communityBadge">${communityBadgeCount}</span>
                        </button>
                        ${typeof SOSModule !== 'undefined' ? SOSModule.renderAudioActivationBanner() : ''}
                    </div>
                ` : ''}
            </div>

            ${Auth.getUserName() === 'OwnerAdmin' ? `
            <div style="display:flex; justify-content:flex-end; margin-top:var(--space-3); margin-bottom:var(--space-3);">
                <button class="btn btn-sm" style="background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-color);" onclick="DashboardModule.showLayoutSettings()">🎨 Configurar Layout</button>
            </div>
            ` : ''}

            ${(Auth.isOwner() || Auth.getUserName() === 'OwnerAdmin') ? `
            <div style="margin-top:var(--space-3); margin-bottom:var(--space-3);">
                ${typeof RadarModule !== 'undefined' ? RadarModule.renderDashboardButton() : ''}
            </div>
            ` : ''}

            ${locationBanner}
            ${alertsHTML}
            ${quickActionsHTML}

            <div class="stats-grid" id="dashboardStatsGrid" style="margin-bottom:var(--space-6);">
                ${(() => {
                    const dragAttr = Auth.getUserName() === 'OwnerAdmin' ? 'draggable="true"' : '';
                    const statCardsDict = {
                        'card-vehicles': '<div class="stat-card" ' + dragAttr + ' data-id="card-vehicles"><div class="stat-icon primary" style="pointer-events:none;">🚗</div><div style="pointer-events:none;"><div class="stat-value">' + vehicles.length + '</div><div class="stat-label">' + I18n.t("dash_vehicles") + '</div></div></div>',
                        'card-shifts': '<div class="stat-card" ' + dragAttr + ' data-id="card-shifts"><div class="stat-icon info" style="pointer-events:none;">⏱️</div><div style="pointer-events:none;"><div class="stat-value">' + activeShifts.length + '</div><div class="stat-label">' + I18n.t("dash_active_shifts") + '</div></div></div>',
                        'card-earnings': '<div class="stat-card" ' + dragAttr + ' data-id="card-earnings"><div class="stat-icon success" style="pointer-events:none;">💰</div><div style="pointer-events:none;"><div class="stat-value">' + I18n.t("unit_currency") + totalEarnings.toLocaleString() + '</div><div class="stat-label">' + I18n.t("dash_total_earnings") + '</div></div></div>',
                        'card-profit': '<div class="stat-card" ' + dragAttr + ' data-id="card-profit"><div class="stat-icon ' + (netProfit >= 0 ? "success" : "danger") + '" style="pointer-events:none;">📈</div><div style="pointer-events:none;"><div class="stat-value">' + I18n.t("unit_currency") + netProfit.toLocaleString() + '</div><div class="stat-label">' + I18n.t("dash_net_profit") + '</div></div></div>',
                        'card-expenses': '<div class="stat-card" ' + dragAttr + ' data-id="card-expenses"><div class="stat-icon warning" style="pointer-events:none;">💸</div><div style="pointer-events:none;"><div class="stat-value">' + I18n.t("unit_currency") + totalRepairCost.toLocaleString() + '</div><div class="stat-label">' + I18n.t("dash_expenses") + ' (' + I18n.t("maint_repairs") + ')</div></div></div>',
                        'card-users': '<div class="stat-card" ' + dragAttr + ' data-id="card-users" style="cursor:pointer;" onclick="DashboardModule.showUsers()"><div class="stat-icon primary" style="pointer-events:none;">👥</div><div style="pointer-events:none;"><div class="stat-value">' + users.length + '</div><div class="stat-label">' + I18n.t("nav_users") + ' — ' + I18n.t("user_manage") + ' →</div></div></div>'
                    };
                    const allKeys = ['card-vehicles', 'card-shifts', 'card-earnings', 'card-profit', 'card-expenses', 'card-users'];
                    const sk = savedOrder && savedOrder.length === 6 ? savedOrder : allKeys;
                    return sk.map(k => statCardsDict[k] || '').join('');
                })()}
            </div>

            <div class="dashboard-community-grid">
                <div>
                    <div class="dashboard-section" id="announcementSection" style="margin-bottom:var(--space-6);">
                        <div class="dashboard-section-title">📢 Banner de Anuncios para Conductores</div>
                        <div class="card" style="padding:var(--space-5);">
                            <div class="form-group" style="margin-bottom:var(--space-3);">
                                <label class="form-label">Texto del anuncio</label>
                                <input type="text" class="form-input" id="announcementText" placeholder="Ej: Mañana no hay servicio por feriado..." maxlength="200" value="${annText.replace(/"/g, '&quot;')}">
                            </div>
                            <div style="display:flex; align-items:center; justify-content:space-between; gap:var(--space-3); flex-wrap:wrap;">
                                <label class="toggle-label" for="announcementActive">
                                    <input type="checkbox" id="announcementActive" class="toggle-input" ${annActive ? 'checked' : ''}>
                                    <div class="toggle-switch"><div class="toggle-knob"></div></div>
                                    <span id="announcementStatusLabel" class="toggle-status">${annActive ? '🟢 Encendido' : '⚫ Apagado'}</span>
                                </label>
                                <button class="btn btn-primary btn-sm" onclick="DashboardModule.saveAnnouncement()">💾 Guardar Anuncio</button>
                            </div>
                        </div>
                    </div>
                    <div class="dashboard-section" id="announcementOwnerSection" style="margin-bottom:var(--space-6);">
                        <div class="dashboard-section-title">📢 Banner de Anuncios para Titulares</div>
                        <div class="card" style="padding:var(--space-5); border-left:3px solid var(--color-accent);">
                            <div class="form-group" style="margin-bottom:var(--space-3);">
                                <label class="form-label">Texto del anuncio para Titulares</label>
                                <input type="text" class="form-input" id="announcementOwnerText" placeholder="Ej: Reunión de titulares el viernes a las 19hs..." maxlength="200" value="${annOwnerText.replace(/"/g, '&quot;')}">
                            </div>
                            <div style="display:flex; align-items:center; justify-content:space-between; gap:var(--space-3); flex-wrap:wrap;">
                                <label class="toggle-label" for="announcementOwnerActive">
                                    <input type="checkbox" id="announcementOwnerActive" class="toggle-input" ${annOwnerActive ? 'checked' : ''}>
                                    <div class="toggle-switch"><div class="toggle-knob"></div></div>
                                    <span id="announcementOwnerStatusLabel" class="toggle-status">${annOwnerActive ? '🟢 Encendido' : '⚫ Apagado'}</span>
                                </label>
                                <button class="btn btn-primary btn-sm" onclick="DashboardModule.saveAnnouncementOwner()">💾 Guardar Anuncio</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="dashboard-section">
                    <div class="dashboard-section-title">📢 Centro de Comunidad Fleet</div>
                    <div class="card" style="padding:var(--space-6);">
                        ${Auth.getRole() === 'owner' ? `
                        <button class="btn btn-block" onclick="Router.navigate('community')" style="background:var(--bg-tertiary); color:var(--text-primary); font-weight:600; font-size:var(--font-size-base); padding:var(--space-4); margin-bottom:var(--space-5); border:1px solid var(--border-color);">
                            💬 Abrir Chat Comunidad Dueños
                            <span class="badge badge-info" style="margin-left:var(--space-2); font-size:0.7rem;">${communityBadgeCount}</span>
                        </button>
                        <div style="border-top:1px solid var(--border-color); margin-bottom:var(--space-5);"></div>
                        ` : ''}
                        <div style="display:flex; flex-direction:column; gap:var(--space-3);">
                            ${Auth.getRole() !== 'owner' ? `
                            <a href="https://chat.whatsapp.com/D3CGMxKDqSx1vHjILi6LtW" target="_blank" rel="noopener noreferrer"
                               class="btn btn-block" style="background:#25D366; color:#fff; font-weight:600; font-size:var(--font-size-base); padding:var(--space-4); text-decoration:none; display:flex; align-items:center; justify-content:center; gap:var(--space-2); border-radius:var(--radius-lg);">
                                🚕 Unirse a Conductores
                            </a>` : ''}
                            ${Auth.getRole() === 'owner' ? `
                            <a href="https://chat.whatsapp.com/HxnVSmJSKBwGTcDLPZAzfc" target="_blank" rel="noopener noreferrer"
                               class="btn btn-block" style="background:#25D366; color:#fff; font-weight:600; font-size:var(--font-size-base); padding:var(--space-4); text-decoration:none; display:flex; align-items:center; justify-content:center; gap:var(--space-2); border-radius:var(--radius-lg);">
                                💼 Unirse a Dueños
                            </a>` : ''}
                        </div>
                        <p style="text-align:center; font-size:var(--font-size-xs); color:var(--text-tertiary); margin-top:var(--space-4); line-height:1.4;">
                            Para unirse al grupo exclusivo de Fleet
                        </p>
                    </div>
                </div>
            </div>

            <div class="dashboard-section">
                <div class="dashboard-section-title">🚗 ${I18n.t('dash_fleet_overview')}</div>
                ${fleetHTML}
            </div>

            <div class="dashboard-section">
                <div class="dashboard-section-title">📋 ${I18n.t('dash_recent_activity')}</div>
                ${activityHTML}
            </div>`;

        } catch (e) {
            console.error('📊 Dashboard render error:', e);
            return `
                <div style="text-align:center; padding:var(--space-8);">
                    <div style="font-size:3rem; margin-bottom:var(--space-4);">⚠️</div>
                    <h3>Error cargando el panel</h3>
                    <p style="color:var(--text-secondary); margin-top:var(--space-2);">${e.message || 'Error de conexión'}</p>
                    <button class="btn btn-primary" onclick="Router.navigate('dashboard')" style="margin-top:var(--space-4);">🔄 Reintentar</button>
                </div>`;
        }
    }

    // Wiring de toggles de anuncio (llamado vía setTimeout después del mount)
    function _wireAnnouncementToggles() {
        const activeCheck = document.getElementById('announcementActive');
        const statusLabel = document.getElementById('announcementStatusLabel');
        const textInput = document.getElementById('announcementText');
        if (activeCheck && statusLabel) {
            activeCheck.onchange = async () => {
                const on = activeCheck.checked;
                statusLabel.textContent = on ? '🟢 Encendido' : '⚫ Apagado';
                statusLabel.style.color = on ? 'var(--color-success)' : 'var(--text-secondary)';
                try {
                    await DB.setSetting('announcement', { bannerText: textInput?.value?.trim() || '', bannerActive: on, updatedAt: new Date().toISOString(), updatedBy: Auth.getUserName() });
                } catch (err) { console.error('📢 Error auto-guardando:', err); }
            };
        }
        const ownerCheck = document.getElementById('announcementOwnerActive');
        const ownerLabel = document.getElementById('announcementOwnerStatusLabel');
        const ownerText = document.getElementById('announcementOwnerText');
        if (ownerCheck && ownerLabel) {
            ownerCheck.onchange = async () => {
                const on = ownerCheck.checked;
                ownerLabel.textContent = on ? '🟢 Encendido' : '⚫ Apagado';
                ownerLabel.style.color = on ? 'var(--color-success)' : 'var(--text-secondary)';
                try {
                    await DB.setSetting('announcement_owner', { bannerText: ownerText?.value?.trim() || '', bannerActive: on, updatedAt: new Date().toISOString(), updatedBy: Auth.getUserName() });
                } catch (err) { console.error('📢 Error auto-guardando titulares:', err); }
            };
        }
    }
    // ====== EVENTOS DRAG & DROP Y LAYOUT ======
    let draggedItem = null;

    function _wireDragAndDrop() {
        const grid = document.getElementById('dashboardStatsGrid');
        if (!grid) return;

        grid.addEventListener('dragstart', (e) => {
            const target = e.target.closest('.stat-card');
            if (target) {
                draggedItem = target;
                setTimeout(() => target.style.opacity = '0.5', 0);
            }
        });

        grid.addEventListener('dragend', (e) => {
            if (draggedItem) {
                draggedItem.style.opacity = '1';
                draggedItem = null;
                _saveNewLayoutOrder();
            }
        });

        grid.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.target.closest('.stat-card');
            if (target && target !== draggedItem && draggedItem) {
                const rect = target.getBoundingClientRect();
                const relX = e.clientX - rect.left;
                if (relX > rect.width / 2) {
                    target.parentNode.insertBefore(draggedItem, target.nextSibling);
                } else {
                    target.parentNode.insertBefore(draggedItem, target);
                }
            }
        });
    }

    async function _saveNewLayoutOrder() {
        const grid = document.getElementById('dashboardStatsGrid');
        if (!grid) return;
        
        const order = Array.from(grid.querySelectorAll('.stat-card')).map(card => card.getAttribute('data-id'));
        const userId = Auth.getUserId();
        if (!userId) return;

        const isAndroid = /Android/i.test(navigator.userAgent);
        const layoutKey = isAndroid ? 'config_android' : 'config_web';

        try {
            const prefs = await DB.getUserPreferences(userId);
            prefs[layoutKey] = prefs[layoutKey] || {};
            prefs[layoutKey].statsOrder = order;
            await DB.saveUserPreferences(userId, prefs);
        } catch (e) {
            console.warn('Error saving layout order:', e);
        }
    }

    async function showLayoutSettings() {
        const userId = Auth.getUserId();
        if(!userId) return;
        const prefs = await DB.getUserPreferences(userId);
        const isAndroid = /Android/i.test(navigator.userAgent);
        const layoutKey = isAndroid ? 'config_android' : 'config_web';
        const theme = prefs[layoutKey]?.theme || {};
        
        const currentPrimary = theme.primary || '#6366f1';
        const currentBg = theme.bg || '#0f172a';
        const currentFont = theme.font || '1rem';

        Components.showModal(
            `🎨 Configurar Layout (${isAndroid ? 'Android' : 'PC/Web'})`,
            `
                <div class="form-group" style="margin-bottom:var(--space-3);">
                    <label class="form-label">Color Primario</label>
                    <input type="color" id="themePrimary" class="form-input" value="${currentPrimary}" style="height:50px; padding:0; cursor:pointer;">
                </div>
                <div class="form-group" style="margin-bottom:var(--space-3);">
                    <label class="form-label">Color de Fondo</label>
                    <input type="color" id="themeBg" class="form-input" value="${currentBg}" style="height:50px; padding:0; cursor:pointer;">
                </div>
                <div class="form-group" style="margin-bottom:var(--space-3);">
                    <label class="form-label">Tamaño de Fuente</label>
                    <select id="themeFont" class="form-select">
                        <option value="0.875rem" ${currentFont === '0.875rem' ? 'selected' : ''}>Pequeño</option>
                        <option value="1rem" ${currentFont === '1rem' ? 'selected' : ''}>Normal</option>
                        <option value="1.125rem" ${currentFont === '1.125rem' ? 'selected' : ''}>Grande</option>
                        <option value="1.25rem" ${currentFont === '1.25rem' ? 'selected' : ''}>Extra Grande</option>
                    </select>
                </div>
                <p style="font-size:0.8rem; color:var(--text-secondary); margin-top:var(--space-4);">
                    ℹ️ Los cambios se guardarán solo para la vista actual (${isAndroid ? 'Android' : 'PC/Web'}).
                </p>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="DashboardModule.saveLayoutSettings()">${I18n.t('save')}</button>
            `
        );
    }

    async function saveLayoutSettings() {
        const userId = Auth.getUserId();
        if(!userId) return;

        const primary = document.getElementById('themePrimary').value;
        const bg = document.getElementById('themeBg').value;
        const font = document.getElementById('themeFont').value;

        const isAndroid = /Android/i.test(navigator.userAgent);
        const layoutKey = isAndroid ? 'config_android' : 'config_web';

        try {
            const prefs = await DB.getUserPreferences(userId);
            prefs[layoutKey] = prefs[layoutKey] || {};
            prefs[layoutKey].theme = { primary, bg, font };
            
            await DB.saveUserPreferences(userId, prefs);
            
            // Apply instantly
            if (typeof App !== 'undefined' && App.applyUserTheme) {
                await App.applyUserTheme(userId);
            }
            
            Components.closeModal();
            Components.showToast('Layout actualizado exitosamente', 'success');
        } catch (e) {
            Components.showToast('Error al guardar layout', 'danger');
        }
    }



    async function renderVehicleCards(vehicles) {
        let html = '';
        for (const v of vehicles) {
            const belt = await Alerts.getBeltStatus(v);
            const beltBadge = belt.level === 'danger'
                ? `<span class="badge badge-danger">⚠️ ${I18n.t('maint_timing_belt')}</span>`
                : belt.level === 'warning'
                    ? `<span class="badge badge-warning">🔔 ${I18n.t('maint_timing_belt')}</span>`
                    : '';

            html += `
                <div class="vehicle-card" onclick="Router.navigate('vehicles')">
                    <div class="vehicle-card-header">
                        <span class="vehicle-name">${v.name}</span>
                        <span class="vehicle-plate">${v.plate || ''}</span>
                    </div>
                    ${beltBadge}
                    <div class="vehicle-stats">
                        <div class="vehicle-stat">
                            <div class="vehicle-stat-value">${Units.formatDistance(v.currentOdometer || 0)}</div>
                            <div class="vehicle-stat-label">${I18n.t('veh_odometer')}</div>
                        </div>
                        <div class="vehicle-stat">
                            <div class="vehicle-stat-value">
                                <span class="badge ${v.status === 'active' ? 'badge-success' : 'badge-warning'}">
                                    ${v.status === 'active' ? I18n.t('veh_active') : I18n.t('veh_inactive')}
                                </span>
                            </div>
                            <div class="vehicle-stat-label">${I18n.t('veh_status')}</div>
                        </div>
                    </div>
                </div>
            `;
        }
        return html;
    }

    async function renderRecentActivity(shifts, repairs) {
        const activities = [];

        shifts.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
        for (const s of shifts.slice(0, 5)) {
            const driver = await DB.get('users', s.driverId);
            const vehicle = await DB.get('vehicles', s.vehicleId);
            const driverName = driver?.name || s.driverName || 'Conductor';
            const vehicleName = s.vehicleName || (vehicle ? `${vehicle.name} (${vehicle.plate})` : '');
            const startTime24 = new Date(s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            activities.push({
                type: 'shift',
                id: s.id,
                date: s.startTime,
                icon: '⏱️',
                text: `Turno de <strong>${driverName}</strong>`,
                subtext: vehicleName ? `🚗 ${vehicleName} | Inicio: ${startTime24} hs` : `Inicio: ${startTime24} hs`,
                badge: s.status === 'active' ? 'badge-success' : 'badge-info',
                badgeText: s.status === 'active' ? I18n.t('shift_active') : I18n.t('label_turno_finalizado')
            });
        }

        repairs.sort((a, b) => new Date(b.date) - new Date(a.date));
        for (const r of repairs.slice(0, 5)) {
            activities.push({
                type: 'repair',
                date: r.date,
                icon: '🔧',
                text: `${I18n.t('maint_repairs')}: ${r.description || ''}`,
                badge: 'badge-warning',
                badgeText: `${I18n.t('unit_currency')}${(r.cost || 0).toLocaleString()}`
            });
        }

        activities.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (activities.length === 0) {
            return `<p style="color:var(--text-tertiary); font-size:var(--font-size-sm);">${I18n.t('no_data')}</p>`;
        }

        return `
            <div class="card" style="padding:0;">
                ${activities.slice(0, 8).map(a => `
                    <div style="display:flex; align-items:center; gap:var(--space-3); padding:var(--space-3) var(--space-4); border-bottom:1px solid var(--border-color);">
                        <span style="font-size:1.2rem; flex-shrink:0;">${a.icon}</span>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:var(--font-size-sm);">${a.text}</div>
                            ${a.subtext ? `<div style="font-size:var(--font-size-xs); color:var(--text-secondary); margin-top:2px;">${a.subtext}</div>` : ''}
                            <div style="font-size:var(--font-size-xs); color:var(--text-tertiary);">
                                ${new Date(a.date).toLocaleDateString()} ${new Date(a.date).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12: false })}
                            </div>
                        </div>
                        <span class="badge ${a.badge}" style="flex-shrink:0;">${a.badgeText}</span>
                        ${Auth.isOwner() && a.type === 'shift' ? `
                        <div style="display:flex; gap:var(--space-2); flex-shrink:0;">
                            <button class="btn btn-icon btn-primary" onclick="ShiftsModule.editShift('${a.id}')" title="Editar" style="padding:6px; font-size:14px; min-width:32px;">✏️</button>
                            <button class="btn btn-icon btn-danger" onclick="ShiftsModule.deleteShift('${a.id}')" title="Eliminar" style="padding:6px; font-size:14px; min-width:32px;">🗑️</button>
                        </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }

    // --- Panel de Usuarios (se abre como modal) ---
    async function showUsers() {
        const users = await DB.getAll('users');

        // Identificar Super Admin para protección
        let superAdminId = null;
        try {
            const fleetId = Auth.getFleetId();
            if (fleetId) {
                const globalUsers = await DB.getGlobalUsersByFleet(fleetId);
                const owners = globalUsers.filter(u => u.role === 'owner');
                if (owners.length > 0) {
                    owners.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                    superAdminId = owners[0].id;
                }
            }
        } catch (e) { /* ignore */ }

        const userCards = users.map(u => {
            const safeName = u.name || 'Sin nombre';
            const initial = safeName[0] ? safeName[0].toUpperCase() : '?';
            const isSuperAdmin = superAdminId && (u.globalId === superAdminId || u.id === superAdminId);

            // Delete button: Super Admin gets badge, everyone else gets trash button
            let deleteAction = '';
            if (isSuperAdmin) {
                deleteAction = `<span class="badge" style="font-size:0.65rem; background:linear-gradient(135deg, #f59e0b, #d97706); color:white; padding:3px 8px; border-radius:20px; font-weight:700;">🛡️ Fundador</span>`;
            } else {
                deleteAction = `<button class="btn btn-ghost btn-sm" onclick="DashboardModule.deleteUser('${u.id}')">🗑️</button>`;
            }

            return `
            <div style="display:flex; align-items:center; gap:var(--space-4); padding:var(--space-4); border-bottom:1px solid var(--border-color);">
                <div style="position:relative; cursor:pointer;" onclick="DashboardModule.changeUserPhoto('${u.id}')">
                    ${u.profilePhoto
                ? `<img src="${u.profilePhoto}" style="width:50px;height:50px;border-radius:50%;object-fit:cover;">`
                : `<div style="width:50px;height:50px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;color:white;">
                            ${initial}
                          </div>`
            }
                    <div style="position:absolute;bottom:-2px;right:-2px;background:var(--color-primary);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;border:2px solid var(--bg-secondary);">📷</div>
                </div>
                <div style="flex:1;">
                    <div style="font-weight:600;">${safeName}</div>
                    <span class="badge badge-${u.role === 'owner' ? 'primary' : u.role === 'driver' ? 'success' : 'warning'}">
                        ${u.role === 'owner' ? '👑' : u.role === 'driver' ? '🚗' : '🔧'} ${I18n.t('role_' + (u.role || 'driver'))}
                    </span>
                </div>
                <div style="display:flex; gap:var(--space-2); align-items:center;">
                    <button class="btn btn-ghost btn-sm" onclick="DashboardModule.editUser('${u.id}')">✏️</button>
                    ${deleteAction}
                </div>
            </div>
        `;
        }).join('');

        Components.showModal(
            `👥 ${I18n.t('user_list')}`,
            `
                <div style="margin-bottom:var(--space-4);">
                    <button class="btn btn-primary btn-sm" onclick="DashboardModule.addUser()">
                        ➕ ${I18n.t('add')}
                    </button>
                </div>
                <div style="border:1px solid var(--border-color); border-radius:var(--radius-lg); overflow:hidden;">
                    ${userCards}
                </div>
                <p style="font-size:var(--font-size-xs); color:var(--text-tertiary); margin-top:var(--space-3);">
                    📷 ${I18n.t('user_change_photo')}: toca la foto del usuario
                </p>
            `
        );
    }

    function addUser() {
        Components.closeModal();
        Components.showModal(
            `➕ ${I18n.t('add')} ${I18n.t('nav_users')}`,
            `
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_name')}</label>
                    <input type="text" class="form-input" id="newUserName" placeholder="${I18n.t('login_name_placeholder')}">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_pin')} (${I18n.t('login_pin_hint')})</label>
                    <input type="text" class="form-input" id="newUserPin" placeholder="${I18n.t('login_pin_placeholder')}" maxlength="15" inputmode="numeric">
                </div>
                <div class="form-group">
                    <label class="form-label">Rol</label>
                    <select class="form-select" id="newUserRole">
                        <option value="owner">${I18n.t('role_owner')}</option>
                        <option value="driver">${I18n.t('role_driver')}</option>
                        <option value="mechanic">${I18n.t('role_mechanic')}</option>
                    </select>
                </div>
                ${Components.renderPhotoCapture('newUserPhoto', I18n.t('user_photo') + ' (' + I18n.t('optional') + ')')}
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal(); DashboardModule.showUsers()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="DashboardModule.saveNewUser()">${I18n.t('save')}</button>
            `
        );
    }

    async function saveNewUser() {
        const name = document.getElementById('newUserName')?.value.trim();
        const pin = document.getElementById('newUserPin')?.value.trim();
        const role = document.getElementById('newUserRole')?.value;
        const photo = Components.getPhotoData('newUserPhoto');

        if (!name || !pin || pin.length < 4) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        // Hash PIN before saving
        let hashedPin = pin;
        try {
            hashedPin = dcodeIO.bcrypt.hashSync(pin, 10);
        } catch (e) {
            console.warn('⚠️ bcrypt no disponible, guardando PIN sin hash:', e);
        }

        const fleetId = Auth.getFleetId();

        // Crear en globalUsers para que pueda loguearse
        const globalId = await DB.addGlobalUser({
            name, pin: hashedPin, role, fleetId
        });

        await DB.add('users', { name, pin: hashedPin, role, profilePhoto: photo, globalId });
        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        showUsers();
    }

    async function editUser(userId) {
        try {
        const user = await DB.get('users', userId);
        if (!user) return;

        // 🔍 DEBUG: Verificar datos recibidos en el celular
        alert('🔍 DEBUG editUser\nID: ' + userId + '\nNombre: ' + (user.name || 'NULL') + '\nDomicilio: ' + (user.address || 'NULL') + '\nWhatsApp: ' + (user.whatsapp || 'NULL') + '\n¿Foto frente?: ' + !!user.licenseFrontPhoto + '\n¿Foto dorso?: ' + !!user.licenseBackPhoto);

        const isDriver = user.role === 'driver';
        // Proteger contra null/undefined en campos de foto
        const hasFront = !!(user.licenseFrontPhoto && typeof user.licenseFrontPhoto === 'string' && user.licenseFrontPhoto.length > 0);
        const hasBack = !!(user.licenseBackPhoto && typeof user.licenseBackPhoto === 'string' && user.licenseBackPhoto.length > 0);
        // Proteger campos de texto contra null/undefined Y escapar para HTML
        const esc = Components.escapeHTML;
        const safeName = esc(user.name || 'Sin nombre');
        const safePin = esc(user.pin || '');
        const safeAddress = esc(user.address || '');
        const safeWhatsapp = esc(user.whatsapp || '');
        const safeLicenseNumber = esc(user.licenseNumber || '');
        const safeIssueDate = esc(user.licenseIssueDate || '');
        const safeExpiryDate = esc(user.licenseExpiryDate || '');
        const initial = (user.name || '?')[0].toUpperCase();

        Components.closeModal();
        Components.showModal(
            `✏️ ${I18n.t('edit')} — ${safeName}`,
            `
                <div style="text-align:center; margin-bottom:var(--space-4);">
                    ${user.profilePhoto
                ? `<img src="${user.profilePhoto}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto;">`
                : `<div style="width:80px;height:80px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:white;margin:0 auto;">
                            ${initial}
                          </div>`
            }
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_name')} *</label>
                    <input type="text" class="form-input" id="editUserName" value="${safeName}"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_pin')} * (${I18n.t('login_pin_hint')})</label>
                    <input type="text" class="form-input" id="editUserPin" value="${safePin}" maxlength="15" inputmode="numeric"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>
                ${Components.renderPhotoCapture('editUserPhoto', I18n.t('user_change_photo'))}

                ${isDriver ? `
                <!-- ====== LEGAJO DIGITAL DEL CONDUCTOR ====== -->
                <div style="border-top:2px solid var(--color-primary); padding-top:var(--space-4); margin-top:var(--space-4);">
                    <div style="font-weight:700; margin-bottom:var(--space-3); color:var(--color-primary); font-size:var(--font-size-lg);">
                        📝 Legajo Digital del Conductor
                    </div>

                    <!-- Datos de Contacto -->
                    <div style="font-weight:600; margin-bottom:var(--space-2); font-size:var(--font-size-sm); color:var(--text-secondary);">🏠 Datos de Contacto</div>
                    <div class="form-group">
                        <label class="form-label">Domicilio Real y Actual *</label>
                        <input type="text" class="form-input" id="editDriverAddress" value="${safeAddress}"
                            placeholder="Calle 123, Villa Gobernador Gálvez"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Número de WhatsApp * (con código de país)</label>
                        <input type="text" class="form-input" id="editDriverWhatsApp" value="${safeWhatsapp}"
                            placeholder="5493476123456" inputmode="tel"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>

                    <!-- Documentación -->
                    <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">🪪 Documentación</div>
                    <div class="form-group">
                        <label class="form-label">Número de Licencia *</label>
                        <input type="text" class="form-input" id="editLicenseNumber" value="${safeLicenseNumber}"
                            placeholder="N° de licencia"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('license_issue_date')} *</label>
                        <input type="date" class="form-input" id="editLicenseIssue" value="${safeIssueDate}"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('license_expiry_date')} *</label>
                        <input type="date" class="form-input" id="editLicenseExpiry" value="${safeExpiryDate}"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>

                    <!-- Fotos de Licencia -->
                    <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">📸 Capturas de Licencia (obligatorias)</div>
                    <div class="form-group">
                        <label class="form-label">🆔 Frente de Licencia *</label>
                        ${hasFront ? `<div style="margin-bottom:var(--space-2); position:relative;">
                            <img src="${user.licenseFrontPhoto}" style="max-width:100%; max-height:120px; border-radius:var(--radius-md); border:2px solid #22c55e;">
                            <div style="display:flex; align-items:center; gap:var(--space-2); margin-top:4px;">
                                <span style="color:#22c55e; font-weight:700; font-size:12px;">✅ Cargada</span>
                                <button type="button" class="btn btn-sm" onclick="StorageUtil.deleteSinglePhoto('${user.id}', 'front', 'dashboard')" style="background:#dc2626; color:white; border:none; font-size:11px; padding:2px 8px; cursor:pointer;">🗑️ Eliminar</button>
                            </div>
                        </div>` : '<div style="color:#dc2626; font-weight:700; font-size:12px; margin-bottom:var(--space-2);">❌ No cargada</div>'}
                        <label class="btn btn-sm" style="cursor:pointer;">
                            📷 Tomar / Subir Foto Frente
                            <input type="file" accept="image/*" style="display:none;" onchange="SettingsModule.handleLicensePhoto(event, 'editFront')">
                        </label>
                        <div id="editLicenseFrontPreview" style="margin-top:var(--space-2);"></div>
                        <input type="hidden" id="editLicenseFrontData" value="">
                    </div>
                    <div class="form-group">
                        <label class="form-label">🔄 Dorso de Licencia *</label>
                        ${hasBack ? `<div style="margin-bottom:var(--space-2); position:relative;">
                            <img src="${user.licenseBackPhoto}" style="max-width:100%; max-height:120px; border-radius:var(--radius-md); border:2px solid #22c55e;">
                            <div style="display:flex; align-items:center; gap:var(--space-2); margin-top:4px;">
                                <span style="color:#22c55e; font-weight:700; font-size:12px;">✅ Cargada</span>
                                <button type="button" class="btn btn-sm" onclick="StorageUtil.deleteSinglePhoto('${user.id}', 'back', 'dashboard')" style="background:#dc2626; color:white; border:none; font-size:11px; padding:2px 8px; cursor:pointer;">🗑️ Eliminar</button>
                            </div>
                        </div>` : '<div style="color:#dc2626; font-weight:700; font-size:12px; margin-bottom:var(--space-2);">❌ No cargada</div>'}
                        <label class="btn btn-sm" style="cursor:pointer;">
                            📷 Tomar / Subir Foto Dorso
                            <input type="file" accept="image/*" style="display:none;" onchange="SettingsModule.handleLicensePhoto(event, 'editBack')">
                        </label>
                        <div id="editLicenseBackPreview" style="margin-top:var(--space-2);"></div>
                        <input type="hidden" id="editLicenseBackData" value="">
                    </div>
                </div>
                ` : ''}
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal(); DashboardModule.showUsers()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="DashboardModule.saveEditUser('${userId}')">${I18n.t('save')}</button>
            `
        );
        } catch (error) {
            console.error('❌ Error al renderizar modal de edición de usuario:', error);
            alert('Error al abrir editor de usuario: ' + (error.message || error));
        }
    }

    async function saveEditUser(userId) {
        const user = await DB.get('users', userId);
        if (!user) return;

        const name = document.getElementById('editUserName')?.value.trim();
        const pin = document.getElementById('editUserPin')?.value.trim();
        const photo = Components.getPhotoData('editUserPhoto');

        if (!name || !pin || pin.length < 4) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        // Sincronizar hash del PIN si fue editado
        let finalPin = pin;
        if (!pin.startsWith('$2')) {
            try {
                finalPin = dcodeIO.bcrypt.hashSync(pin, 10);
            } catch (e) {
                console.warn('⚠️ bcrypt no disponible al editar, usando texto plano:', e);
            }
        }

        user.name = name;
        user.pin = finalPin;
        if (photo && !photo.includes('data:,')) {
            user.profilePhoto = photo;
        }

        // Si es conductor, capturar campos del legajo
        if (user.role === 'driver') {
            const address = document.getElementById('editDriverAddress')?.value.trim();
            const whatsapp = document.getElementById('editDriverWhatsApp')?.value.trim();
            const licenseNumber = document.getElementById('editLicenseNumber')?.value.trim();
            const issueDate = document.getElementById('editLicenseIssue')?.value;
            const expiryDate = document.getElementById('editLicenseExpiry')?.value;
            const newFront = document.getElementById('editLicenseFrontData')?.value;
            const newBack = document.getElementById('editLicenseBackData')?.value;

            if (address) user.address = address;
            if (whatsapp) user.whatsapp = whatsapp;
            if (licenseNumber) user.licenseNumber = licenseNumber;
            if (issueDate) user.licenseIssueDate = issueDate;
            if (expiryDate) user.licenseExpiryDate = expiryDate;

            // Subir fotos a Firebase Storage (si hay nuevas)
            if (newFront || newBack) {
                try {
                    await StorageUtil.processLicensePhotos(user, newFront || null, newBack || null);
                } catch (err) {
                    Components.showToast('❌ Error al subir fotos: ' + (err.message || 'desconocido'), 'danger');
                    return;
                }
            }
        }

        // === CRÍTICO: PROPAGAR A GLOBALUSERS ===
        if (user.globalId) {
            try {
                const globalUpdate = { name: user.name, pin: user.pin };
                if (user.profilePhoto) {
                    globalUpdate.profilePhoto = user.profilePhoto;
                }
                await firebaseDB.ref('globalUsers/' + user.globalId).update(globalUpdate);
                console.log('✅ Sincronizado con globalUsers:', user.globalId);
            } catch (globalErr) {
                console.error('⚠️ Falló actualización en globalUsers:', globalErr);
                Components.showToast('⚠️ Alerta: Los datos se guardaron en la flota pero falló la sincronización global. Por favor verifica la conexión.', 'warning');
            }
        } else {
            console.warn('⚠️ Usuario local no tiene globalId registrado para replicar.');
        }

        // Guardar localmente en la flota
        await DB.put('users', user);

        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        showUsers();
    }

    async function changeUserPhoto(userId) {
        const user = await DB.get('users', userId);
        if (!user) return;

        Components.closeModal();
        Components.showModal(
            `📷 ${I18n.t('user_change_photo')} — ${user.name}`,
            `
                <div style="text-align:center; margin-bottom:var(--space-4);">
                    ${user.profilePhoto
                ? `<img src="${user.profilePhoto}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;margin:0 auto;">`
                : `<div style="width:100px;height:100px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-size:2.5rem;font-weight:700;color:white;margin:0 auto;">
                            ${user.name[0].toUpperCase()}
                          </div>`
            }
                </div>
                ${Components.renderPhotoCapture('changePhoto', I18n.t('user_photo'))}
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal(); DashboardModule.showUsers()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="DashboardModule.saveUserPhoto('${userId}')">${I18n.t('save')}</button>
            `
        );
    }

    async function saveUserPhoto(userId) {
        const user = await DB.get('users', userId);
        if (!user) return;

        const photo = Components.getPhotoData('changePhoto');
        if (photo && !photo.includes('data:,')) {
            user.profilePhoto = photo;
            await DB.put('users', user);
            Components.showToast(I18n.t('success') + ' ✅', 'success');
        }

        Components.closeModal();
        showUsers();
    }

    function deleteUser(userId) {
        Components.closeModal();
        Components.showModal(
            '🗑️ Eliminar Usuario',
            `<p style="text-align:center; font-size:var(--font-size-lg);">⚠️</p>
             <p style="text-align:center;">¿Estás seguro? Esto eliminará al usuario, sus datos y las fotos de licencia del servidor de forma <strong>PERMANENTE</strong>.</p>`,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal(); DashboardModule.showUsers()">${I18n.t('cancel')}</button>
                <button class="btn btn-danger" onclick="DashboardModule.confirmDeleteUser('${userId}')">🗑️ Eliminar Todo</button>
            `
        );
    }

    async function confirmDeleteUser(userId) {
        try {
            const user = await DB.get('users', userId);

            // 🛡️ PROTECCIÓN SUPER ADMIN
            try {
                const fleetId = Auth.getFleetId();
                if (fleetId) {
                    const globalUsers = await DB.getGlobalUsersByFleet(fleetId);
                    const owners = globalUsers.filter(u => u.role === 'owner');
                    if (owners.length > 0) {
                        owners.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                        const superAdminId = owners[0].id;
                        if (user && superAdminId && (user.globalId === superAdminId || user.id === superAdminId)) {
                            Components.closeModal();
                            Components.showToast('🛡️ Acción denegada: No se puede eliminar al Super Administrador', 'danger');
                            return;
                        }
                    }
                }
            } catch (e) { /* ignore */ }

            Components.showToast('🗑️ Eliminando usuario y fotos...', 'info');

            if (!user) {
                await DB.remove('users', userId);
                Components.closeModal();
                Components.showToast('✅ Usuario eliminado', 'success');
                showUsers();
                return;
            }

            // 1. Borrar fotos de Firebase Storage
            if (user.licenseFrontPhoto || user.licenseBackPhoto) {
                console.log('🗑️ Eliminando fotos de Storage...');
                const result = await StorageUtil.deleteUserPhotos(user);
                console.log('🗑️ Resultado borrado fotos:', result);
            }

            // 2. Borrar de globalUsers si tiene globalId
            if (user.globalId) {
                try {
                    await firebaseDB.ref('globalUsers/' + user.globalId).remove();
                    console.log('🗑️ Eliminado de globalUsers:', user.globalId);
                } catch (e) {
                    console.warn('⚠️ No se pudo borrar de globalUsers:', e.message);
                }
            }

            // 3. Borrar documento del usuario de la flota
            await DB.remove('users', userId);

            Components.closeModal();
            Components.showToast('✅ Usuario y fotos eliminados permanentemente', 'success');
            showUsers();

        } catch (error) {
            console.error('❌ Error en eliminación profunda:', error);
            alert('Error al eliminar: ' + (error.message || error));
            Components.closeModal();
        }
    }


    // --- Banner de Anuncios CONDUCTORES: Guardar ---
    async function saveAnnouncement() {
        const text = document.getElementById('announcementText')?.value?.trim() || '';
        const active = document.getElementById('announcementActive')?.checked || false;

        if (active && !text) {
            Components.showToast('⚠️ Escribí un texto para el anuncio antes de activarlo', 'warning');
            return;
        }

        try {
            await DB.setSetting('announcement', {
                bannerText: text,
                bannerActive: active,
                updatedAt: new Date().toISOString(),
                updatedBy: Auth.getUserName()
            });
            Components.showToast(active ? '📢 Anuncio activado ✅' : '📢 Anuncio guardado (apagado)', active ? 'success' : 'info');
        } catch (e) {
            Components.showToast('❌ Error guardando anuncio: ' + e.message, 'danger');
        }
    }

    // --- Banner de Anuncios TITULARES: Guardar ---
    async function saveAnnouncementOwner() {
        const text = document.getElementById('announcementOwnerText')?.value?.trim() || '';
        const active = document.getElementById('announcementOwnerActive')?.checked || false;

        if (active && !text) {
            Components.showToast('⚠️ Escribí un texto para el anuncio antes de activarlo', 'warning');
            return;
        }

        try {
            await DB.setSetting('announcement_owner', {
                bannerText: text,
                bannerActive: active,
                updatedAt: new Date().toISOString(),
                updatedBy: Auth.getUserName()
            });
            Components.showToast(active ? '📢 Anuncio para titulares activado ✅' : '📢 Anuncio guardado (apagado)', active ? 'success' : 'info');
        } catch (e) {
            Components.showToast('❌ Error guardando anuncio: ' + e.message, 'danger');
        }
    }

    async function showGlobalUsers(roleFilter) {
        if (Auth.getRole() !== 'owner') {
            Components.showToast('Acceso denegado. Solo administradores.', 'danger');
            Router.navigate('dashboard');
            return;
        }

        try {
            const allGlobal = await DB.getAllGlobalUsers();
            const localUsers = await DB.getAll('users');
            const currentFleetId = Auth.getFleetId();
            
            // Map local users para tener acceso al ID real (legajo) y fotos de licencia
            const localMap = {};
            localUsers.forEach(lu => {
                if (lu.globalId) localMap[lu.globalId] = lu;
            });

            const enrichedUsers = allGlobal.filter(u => u.role === roleFilter).map(gu => {
                let enriched = { ...gu };
                if (localMap[gu.id]) {
                    enriched = { ...gu, ...localMap[gu.id], localId: localMap[gu.id].id, isLocal: true };
                } else {
                    enriched.isLocal = gu.fleetId === currentFleetId;
                }
                
                // Semáforo Logic (Estado Perfil)
                const hasDni = !!(enriched.dni || enriched.cuit || enriched.licenseNumber);
                const hasPhone = !!(enriched.whatsapp || enriched.phone);
                const hasLicense = !!(enriched.licenseFrontPhoto || enriched.licenseBackPhoto);
                
                enriched.isProfileComplete = hasDni && hasPhone && hasLicense;
                return enriched;
            });

            // Ordenar por fecha de más reciente a más antiguo
            enrichedUsers.sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

            window._currentGlobalUsers = enrichedUsers;
            
            const titleIcon = roleFilter === 'owner' ? '🛡️' : '🚗';
            const titleText = roleFilter === 'owner' ? 'Lista de Dueños' : 'Lista Choferes';
            
            Components.showModal(
                `${titleIcon} ${titleText}`,
                `
                <div style="margin-bottom:var(--space-4);">
                    <input type="text" id="globalUsersSearch" class="form-input" placeholder="🔍 Buscar por Nombre, DNI/CUIT o Email..." onkeyup="DashboardModule.filterGlobalUsers()" style="width:100%; font-size:16px; border:2px solid var(--border-color); border-radius:8px;">
                </div>
                <!-- Contenedor con scroll interno para la tabla sticky -->
                <div id="globalUsersListContainer" style="max-height: 65vh; overflow-y: auto; background:var(--bg-primary); border-radius:var(--radius-lg); border: 1px solid var(--border-color); box-shadow: inset 0 2px 4px rgba(0,0,0,0.05); -webkit-overflow-scrolling: touch;">
                    ${DashboardModule.renderGlobalUsersList(window._currentGlobalUsers)}
                </div>
                `
            );
        } catch(e) {
            console.error('Error load global users', e);
            Components.showToast('Error al cargar la lista.', 'danger');
        }
    }

    function filterGlobalUsers() {
        const query = (document.getElementById('globalUsersSearch')?.value || '').toLowerCase();
        const users = window._currentGlobalUsers || [];
        const filtered = users.filter(u => {
            const name = (u.name || '').toLowerCase();
            const email = (u.email || '').toLowerCase();
            const dni = (u.dni || u.cuit || u.licenseNumber || '').toLowerCase();
            return name.includes(query) || dni.includes(query) || email.includes(query);
        });
        const container = document.getElementById('globalUsersListContainer');
        if (container) {
            container.innerHTML = DashboardModule.renderGlobalUsersList(filtered);
        }
    }

    function renderGlobalUsersList(users) {
        if (!users || users.length === 0) {
            return '<div style="padding:var(--space-6); text-align:center; color:var(--text-secondary); font-size:16px; font-weight:600;">No se encontraron usuarios en la búsqueda.</div>';
        }
        
        // El contenedor es el div scrolleable anterior, acá dibujamos la tabla que abarca el 100%
        let html = '<table class="dashboard-table" style="width:100%; min-width:850px; border-collapse:collapse; background:var(--bg-secondary); text-align:left;">';
        
        // THEAD: Sticky
        html += '<thead style="background:var(--bg-tertiary); position:sticky; top:0; z-index:10; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">';
        html += '<tr>';
        html += '<th style="padding:16px 12px; font-size:12px; font-weight:800; color:var(--text-secondary);">USUARIO</th>';
        html += '<th style="padding:16px 12px; font-size:12px; font-weight:800; color:var(--text-secondary); text-align:center;">ESTADO PERFIL</th>';
        html += '<th style="padding:16px 12px; font-size:12px; font-weight:800; color:var(--text-secondary);">CONTACTO</th>';
        html += '<th style="padding:16px 12px; font-size:12px; font-weight:800; color:var(--text-secondary);">FECHA REGISTRO</th>';
        html += '<th style="padding:16px 12px; font-size:12px; font-weight:800; color:var(--text-secondary); text-align:right;">ACCIONES (LEG. COMPLETO)</th>';
        html += '</tr></thead><tbody style="divide-y: 1px solid var(--border-color);">';
        
        for (const u of users) {
             const safeName = Components.escapeHTML(u.name || 'Sin Nombre');
             const safePhone = Components.escapeHTML(u.whatsapp || u.phone || '');
             const safeEmail = Components.escapeHTML(u.email || '');
             const wpLink = safePhone ? `https://wa.me/${safePhone.replace(/\D/g,'')}` : '#';
             
             const dateStr = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—';
             
             // Semáforo
             let profileStatusHtml = '';
             if (u.isProfileComplete) {
                 profileStatusHtml = `<div style="display:flex; flex-direction:column; align-items:center; gap:6px;"><div style="width:18px; height:18px; border-radius:50%; background:#10b981; box-shadow: 0 0 10px rgba(16, 185, 129, 0.6); border:2px solid white;"></div><span style="font-size:11px; color:#10b981; font-weight:800;">COMPLETADO</span></div>`;
             } else {
                 profileStatusHtml = `<div style="display:flex; flex-direction:column; align-items:center; gap:6px;"><div style="width:18px; height:18px; border-radius:50%; background:#ef4444; box-shadow: 0 0 10px rgba(239, 68, 68, 0.6); border:2px solid white;"></div><span style="font-size:11px; color:#ef4444; font-weight:800;">PENDIENTE</span></div>`;
             }

             // Datos de contacto
             let contactHtml = '';
             if (safePhone) {
                 contactHtml += `<div style="font-size:13px; color:var(--text-primary); font-weight:700;">📞 ${safePhone}</div>`;
             } else {
                 contactHtml += `<div style="font-size:13px; color:var(--text-tertiary); font-style:italic;">Sin número celular</div>`;
             }
             if (safeEmail) {
                 contactHtml += `<div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">📧 ${safeEmail}</div>`;
             }

             // Acciones directas
             let actionsHtml = '';
             if (safePhone) {
                 actionsHtml += `<a href="${wpLink}" target="_blank" class="btn btn-sm" style="background:#25D366; color:white; padding:8px 12px; border-radius:8px; display:inline-flex; align-items:center; gap:6px; text-decoration:none; font-size:13px; font-weight:800; box-shadow:0 2px 4px rgba(37,211,102,0.3);"><span style="font-size:16px;">💬</span> WhatsApp</a>`;
             }
             if (u.localId) {
                 actionsHtml += `<button onclick="Components.closeModal(); DashboardModule.editUser('${u.localId}')" class="btn btn-sm btn-primary" style="padding:8px 12px; border-radius:8px; display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:800; margin-left:8px; box-shadow:0 2px 4px rgba(59,130,246,0.3);">📄 Ver Detalle</button>`;
             } else {
                 actionsHtml += `<span class="badge badge-warning" style="margin-left:8px; font-size:11px;">Externo</span>`;
             }

             html += `
             <tr style="border-bottom: 1px solid var(--border-color); transition: background 0.2s;">
                <td style="padding:16px 12px;">
                    <div style="display:flex; align-items:center; gap:12px;">
                        ${u.profilePhoto 
                            ? `<img src="${u.profilePhoto}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid var(--border-color);">` 
                            : `<div style="width:40px; height:40px; border-radius:50%; background:var(--bg-tertiary); display:flex; align-items:center; justify-content:center; font-weight:800; color:var(--text-secondary); border:2px solid var(--border-color);">${u.name[0]?.toUpperCase()||'?'}</div>`}
                        <div>
                            <div style="font-weight:900; color:var(--text-primary); font-size:15px;">${safeName}</div>
                            ${(u.dni || u.cuit || u.licenseNumber) ? `<div style="font-size:12px; color:var(--text-secondary); margin-top:2px; font-weight:600;">DNI/Id: ${Components.escapeHTML(u.dni || u.cuit || u.licenseNumber)}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td style="padding:16px 12px; text-align:center;">${profileStatusHtml}</td>
                <td style="padding:16px 12px;">${contactHtml}</td>
                <td style="padding:16px 12px; font-size:13px; color:var(--text-secondary); font-weight:600;">${dateStr}</td>
                <td style="padding:16px 12px; text-align:right;">
                    <div style="display:flex; justify-content:flex-end; align-items:center; flex-wrap:wrap;">${actionsHtml}</div>
                </td>
             </tr>`;
        }
        html += '</tbody></table>';

        // CSS Fallback Responsive Celular: Convertir filas en tarjetas
        html = `
        <style>
            @media (max-width: 850px) {
                #globalUsersListContainer .dashboard-table, #globalUsersListContainer thead, #globalUsersListContainer tbody, #globalUsersListContainer th, #globalUsersListContainer td, #globalUsersListContainer tr { display: block; width: 100% !important; min-width: 0 !important; }
                #globalUsersListContainer thead { position: absolute; top: -9999px; left: -9999px; }
                #globalUsersListContainer tr { border: 2px solid var(--border-color); margin-bottom: 20px; border-radius: 16px; background: var(--bg-primary); padding: 16px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
                #globalUsersListContainer td { border: none !important; position: relative; padding: 10px 0 !important; text-align: left !important; }
                #globalUsersListContainer td:not(:last-child) { border-bottom: 1px dashed var(--border-color) !important; padding-bottom: 14px !important; margin-bottom: 6px; }
                #globalUsersListContainer td div { text-align: left; }
                #globalUsersListContainer td:nth-child(2) div { align-items: flex-start !important; }
                #globalUsersListContainer td:nth-child(5) div { justify-content: flex-start !important; margin-top:4px; }
            }
        </style>
        ` + html;

        return html;
    }

    return { render, showUsers, addUser, saveNewUser, editUser, saveEditUser, changeUserPhoto, saveUserPhoto, deleteUser, confirmDeleteUser, saveAnnouncement, saveAnnouncementOwner, showGlobalUsers, filterGlobalUsers, renderGlobalUsersList };
})();
