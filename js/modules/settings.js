/* ============================================
   FleetAdmin Pro — Módulo de Configuración
   Idioma, unidades, perfil, datos
   ============================================ */

const SettingsModule = (() => {

    async function render() {
        const distUnit = Units.getDistanceUnit();
        const volUnit = Units.getVolumeUnit();

        return `
            <h2 style="font-size:var(--font-size-2xl); font-weight:700; margin-bottom:var(--space-6);">
                ⚙️ ${I18n.t('settings_title')}
            </h2>

            <!-- Idioma -->
            <div class="settings-section">
                <div class="settings-section-title">🌐 ${I18n.t('settings_language')}</div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">${I18n.t('settings_language')}</div>
                        <div class="settings-item-desc">${I18n.t('login_subtitle')}</div>
                    </div>
                    ${Components.renderLanguageSelector()}
                </div>
            </div>

            <!-- Unidades de medida -->
            <div class="settings-section">
                <div class="settings-section-title">📏 ${I18n.t('settings_units')}</div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">${I18n.t('settings_distance')}</div>
                        <div class="settings-item-desc">${I18n.t('unit_km')} / ${I18n.t('unit_mi')}</div>
                    </div>
                    <div class="toggle-group">
                        <button class="toggle-option ${distUnit === 'km' ? 'active' : ''}"
                            onclick="App.setDistanceUnit('km')">
                            🔵 ${I18n.t('unit_km_short')}
                        </button>
                        <button class="toggle-option ${distUnit === 'mi' ? 'active' : ''}"
                            onclick="App.setDistanceUnit('mi')">
                            🔴 ${I18n.t('unit_mi_short')}
                        </button>
                    </div>
                </div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">${I18n.t('settings_volume')}</div>
                        <div class="settings-item-desc">${I18n.t('unit_liters')} / ${I18n.t('unit_gallons')}</div>
                    </div>
                    <div class="toggle-group">
                        <button class="toggle-option ${volUnit === 'l' ? 'active' : ''}"
                            onclick="App.setVolumeUnit('l')">
                            🔵 ${I18n.t('unit_l_short')}
                        </button>
                        <button class="toggle-option ${volUnit === 'gal' ? 'active' : ''}"
                            onclick="App.setVolumeUnit('gal')">
                            🔴 ${I18n.t('unit_gal_short')}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Perfil -->
            <div class="settings-section">
                <div class="settings-section-title">👤 ${I18n.t('settings_profile')}</div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">${I18n.t('login_name')}</div>
                    </div>
                    <span style="font-weight:600;">${Auth.getUserName()}</span>
                </div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">${I18n.t('role_' + Auth.getRole())}</div>
                    </div>
                    <span class="badge badge-primary">${I18n.t('role_' + Auth.getRole())}</span>
                </div>
            </div>

            ${Auth.isOwner() ? `
                <!-- Datos (solo dueño) -->
                <div class="settings-section">
                    <div class="settings-section-title">💾 ${I18n.t('settings_data')}</div>
                    <div class="settings-item">
                        <div>
                            <div class="settings-item-label">${I18n.t('settings_export')}</div>
                            <div class="settings-item-desc">JSON</div>
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="SettingsModule.exportData()">
                            📤 ${I18n.t('settings_export')}
                        </button>
                    </div>
                    <div class="settings-item">
                        <div>
                            <div class="settings-item-label">${I18n.t('settings_import')}</div>
                            <div class="settings-item-desc">JSON</div>
                        </div>
                        <div style="position:relative;">
                            <input type="file" accept=".json" id="importFile"
                                onchange="SettingsModule.importData(event)"
                                style="position:absolute;opacity:0;width:100%;height:100%;cursor:pointer;">
                            <button class="btn btn-secondary btn-sm">
                                📥 ${I18n.t('settings_import')}
                            </button>
                        </div>
                    </div>
                    <div class="settings-item">
                        <div>
                            <div class="settings-item-label">${I18n.t('settings_reset')}</div>
                            <div class="settings-item-desc" style="color:var(--color-danger);">
                                ${I18n.t('settings_reset_confirm')}
                            </div>
                        </div>
                        <button class="btn btn-danger btn-sm" onclick="SettingsModule.resetData()">
                            ⚠️ ${I18n.t('settings_reset')}
                        </button>
                    </div>
                </div>

                <!-- Gestión de Usuarios -->
                <div class="settings-section">
                    <div class="settings-section-title">👥 Usuarios</div>
                    <div class="settings-item">
                        <div>
                            <div class="settings-item-label">Gestionar usuarios</div>
                            <div class="settings-item-desc">Agregar conductores y mecánicos</div>
                        </div>
                        <button class="btn btn-primary btn-sm" onclick="SettingsModule.showUserManager()">
                            ➕ ${I18n.t('add')}
                        </button>
                    </div>
                    <div id="userList"></div>
                </div>
            ` : ''}

            <!-- Acerca de -->
            <div class="settings-section">
                <div class="settings-section-title">ℹ️ ${I18n.t('settings_about')}</div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">FleetAdmin Pro</div>
                        <div class="settings-item-desc">${I18n.t('app_subtitle')}</div>
                    </div>
                    <span class="badge badge-info">${I18n.t('settings_version')} 1.0.0</span>
                </div>
            </div>
        `;
    }

    async function exportData() {
        try {
            const data = await DB.exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fleetadmin_backup_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            Components.showToast(I18n.t('success') + ' ✅', 'success');
        } catch (e) {
            Components.showToast(I18n.t('error'), 'danger');
        }
    }

    async function importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await DB.importAll(data);
            Components.showToast(I18n.t('success') + ' ✅', 'success');
            Router.navigate('settings');
        } catch (e) {
            Components.showToast(I18n.t('error') + ': JSON inválido', 'danger');
        }
    }

    function resetData() {
        Components.confirm(
            I18n.t('settings_reset_confirm'),
            async () => {
                await DB.resetAll();
                Components.showToast(I18n.t('success'), 'success');
                Router.navigate('settings');
            }
        );
    }

    function showUserManager() {
        Components.showModal(
            '➕ ' + I18n.t('add') + ' Usuario',
            `
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_name')}</label>
                    <input type="text" class="form-input" id="newUserName" placeholder="${I18n.t('login_name_placeholder')}">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_pin')}</label>
                    <input type="text" class="form-input" id="newUserPin" placeholder="Hasta 15 dígitos" maxlength="15" inputmode="numeric">
                </div>
                <div class="form-group">
                    <label class="form-label">Rol</label>
                    <select class="form-select" id="newUserRole">
                        <option value="driver">${I18n.t('role_driver')}</option>
                        <option value="mechanic">${I18n.t('role_mechanic')}</option>
                    </select>
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="SettingsModule.saveUser()">${I18n.t('save')}</button>
            `
        );
    }

    async function saveUser() {
        const name = document.getElementById('newUserName')?.value.trim();
        const pin = document.getElementById('newUserPin')?.value.trim();
        const role = document.getElementById('newUserRole')?.value;

        if (!name || !pin || pin.length < 4) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        await DB.add('users', { name, pin, role });
        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
    }

    return { render, exportData, importData, resetData, showUserManager, saveUser };
})();
