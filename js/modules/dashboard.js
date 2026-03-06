/* ============================================
   FleetAdmin Pro — Dashboard del Dueño
   Vista general de la flota con gestión de usuarios
   ============================================ */

const DashboardModule = (() => {

    async function render() {
        const vehicles = await DB.getAll('vehicles');
        const shifts = await DB.getAll('shifts');
        const repairs = await DB.getAll('repairs');
        const alerts = await Alerts.getAllAlerts();
        const users = await DB.getAll('users');

        // Calcular estadísticas
        const activeShifts = shifts.filter(s => s.status === 'active');
        const completedShifts = shifts.filter(s => s.status === 'completed');
        const totalEarnings = completedShifts.reduce((sum, s) => sum + (s.earnings || 0), 0);
        const totalRepairCost = repairs.reduce((sum, r) => sum + (r.cost || 0), 0);
        const netProfit = totalEarnings - totalRepairCost;

        return `
            <div class="dashboard-welcome">
                <h2>${I18n.t('dash_welcome')} ${Auth.getUserName()}! 👋</h2>
                <p>${I18n.t('dash_summary')}</p>
            </div>

            <!-- Alertas de mantenimiento -->
            ${alerts.length > 0 ? `
                <div class="dashboard-section">
                    <div class="dashboard-section-title">🚨 ${I18n.t('dash_alerts')}</div>
                    ${alerts.map(a => Alerts.renderAlertBanner(a)).join('')}
                </div>
            ` : ''}

            <!-- Estadísticas rápidas -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon primary">🚗</div>
                    <div>
                        <div class="stat-value">${vehicles.length}</div>
                        <div class="stat-label">${I18n.t('dash_vehicles')}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon info">⏱️</div>
                    <div>
                        <div class="stat-value">${activeShifts.length}</div>
                        <div class="stat-label">${I18n.t('dash_active_shifts')}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon success">💰</div>
                    <div>
                        <div class="stat-value">${I18n.t('unit_currency')}${totalEarnings.toLocaleString()}</div>
                        <div class="stat-label">${I18n.t('dash_total_earnings')}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon ${netProfit >= 0 ? 'success' : 'danger'}">📈</div>
                    <div>
                        <div class="stat-value">${I18n.t('unit_currency')}${netProfit.toLocaleString()}</div>
                        <div class="stat-label">${I18n.t('dash_net_profit')}</div>
                    </div>
                </div>
            </div>

            <!-- Gastos + Usuarios -->
            <div class="stats-grid" style="margin-bottom:var(--space-6);">
                <div class="stat-card">
                    <div class="stat-icon warning">💸</div>
                    <div>
                        <div class="stat-value">${I18n.t('unit_currency')}${totalRepairCost.toLocaleString()}</div>
                        <div class="stat-label">${I18n.t('dash_expenses')} (${I18n.t('maint_repairs')})</div>
                    </div>
                </div>
                <div class="stat-card" style="cursor:pointer;" onclick="DashboardModule.showUsers()">
                    <div class="stat-icon primary">👥</div>
                    <div>
                        <div class="stat-value">${users.length}</div>
                        <div class="stat-label">${I18n.t('nav_users')} — ${I18n.t('user_manage')} →</div>
                    </div>
                </div>
            </div>

            <!-- Vista de flota -->
            <div class="dashboard-section">
                <div class="dashboard-section-title">🚗 ${I18n.t('dash_fleet_overview')}</div>
                ${vehicles.length > 0 ? `
                    <div class="vehicle-cards">
                        ${await renderVehicleCards(vehicles)}
                    </div>
                ` : Components.renderEmptyState(
            '🚗',
            I18n.t('veh_no_vehicles'),
            I18n.t('veh_add_first'),
            `<button class="btn btn-primary" onclick="Router.navigate('vehicles')">
                        ${I18n.t('veh_add')}
                    </button>`
        )}
            </div>

            <!-- Actividad reciente -->
            <div class="dashboard-section">
                <div class="dashboard-section-title">📋 ${I18n.t('dash_recent_activity')}</div>
                ${await renderRecentActivity(shifts, repairs)}
            </div>
        `;
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
            activities.push({
                date: s.startTime,
                icon: '⏱️',
                text: `${I18n.t('nav_shifts')}: ${driver?.name || ''}`,
                badge: s.status === 'active' ? 'badge-success' : 'badge-info',
                badgeText: s.status === 'active' ? I18n.t('shift_active') : I18n.t('shift_end')
            });
        }

        repairs.sort((a, b) => new Date(b.date) - new Date(a.date));
        for (const r of repairs.slice(0, 5)) {
            activities.push({
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
                        <span style="font-size:1.2rem;">${a.icon}</span>
                        <div style="flex:1;">
                            <div style="font-size:var(--font-size-sm);">${a.text}</div>
                            <div style="font-size:var(--font-size-xs); color:var(--text-tertiary);">
                                ${new Date(a.date).toLocaleDateString()}
                            </div>
                        </div>
                        <span class="badge ${a.badge}">${a.badgeText}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // --- Panel de Usuarios (se abre como modal) ---
    async function showUsers() {
        const users = await DB.getAll('users');

        const userCards = users.map(u => `
            <div style="display:flex; align-items:center; gap:var(--space-4); padding:var(--space-4); border-bottom:1px solid var(--border-color);">
                <div style="position:relative; cursor:pointer;" onclick="DashboardModule.changeUserPhoto('${u.id}')">
                    ${u.profilePhoto
                ? `<img src="${u.profilePhoto}" style="width:50px;height:50px;border-radius:50%;object-fit:cover;">`
                : `<div style="width:50px;height:50px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-size:1.3rem;font-weight:700;color:white;">
                            ${u.name[0].toUpperCase()}
                          </div>`
            }
                    <div style="position:absolute;bottom:-2px;right:-2px;background:var(--color-primary);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;border:2px solid var(--bg-secondary);">📷</div>
                </div>
                <div style="flex:1;">
                    <div style="font-weight:600;">${u.name}</div>
                    <span class="badge badge-${u.role === 'owner' ? 'primary' : u.role === 'driver' ? 'success' : 'warning'}">
                        ${u.role === 'owner' ? '👑' : u.role === 'driver' ? '🚗' : '🔧'} ${I18n.t('role_' + u.role)}
                    </span>
                </div>
                <div style="display:flex; gap:var(--space-2);">
                    <button class="btn btn-ghost btn-sm" onclick="DashboardModule.editUser('${u.id}')">✏️</button>
                    ${u.role !== 'owner' ? `<button class="btn btn-ghost btn-sm" onclick="DashboardModule.deleteUser('${u.id}')">🗑️</button>` : ''}
                </div>
            </div>
        `).join('');

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

        await DB.add('users', { name, pin, role, profilePhoto: photo });
        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        showUsers();
    }

    async function editUser(userId) {
        const user = await DB.get('users', userId);
        if (!user) return;

        Components.closeModal();
        Components.showModal(
            `✏️ ${I18n.t('edit')} — ${user.name}`,
            `
                <div style="text-align:center; margin-bottom:var(--space-4);">
                    ${user.profilePhoto
                ? `<img src="${user.profilePhoto}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin:0 auto;">`
                : `<div style="width:80px;height:80px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:white;margin:0 auto;">
                            ${user.name[0].toUpperCase()}
                          </div>`
            }
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_name')}</label>
                    <input type="text" class="form-input" id="editUserName" value="${user.name}">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_pin')} (${I18n.t('login_pin_hint')})</label>
                    <input type="text" class="form-input" id="editUserPin" value="${user.pin}" maxlength="15" inputmode="numeric">
                </div>
                ${Components.renderPhotoCapture('editUserPhoto', I18n.t('user_change_photo'))}
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal(); DashboardModule.showUsers()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="DashboardModule.saveEditUser('${userId}')">${I18n.t('save')}</button>
            `
        );
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

        user.name = name;
        user.pin = pin;
        if (photo && !photo.includes('data:,')) {
            user.profilePhoto = photo;
        }
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
            I18n.t('confirm'),
            `<p>${I18n.t('user_delete_confirm')}</p>`,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-danger" onclick="DashboardModule.confirmDeleteUser('${userId}')">${I18n.t('confirm')}</button>
            `
        );
    }

    async function confirmDeleteUser(userId) {
        await DB.remove('users', userId);
        Components.closeModal();
        Components.showToast(I18n.t('success'), 'success');
        showUsers();
    }

    return { render, showUsers, addUser, saveNewUser, editUser, saveEditUser, changeUserPhoto, saveUserPhoto, deleteUser, confirmDeleteUser };
})();
