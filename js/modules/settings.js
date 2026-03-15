/* ============================================
   FleetAdmin Pro — Módulo de Configuración
   Idioma, unidades, perfil, datos
   ============================================ */

const SettingsModule = (() => {

    async function render() {
        const distUnit = Units.getDistanceUnit();
        const volUnit = Units.getVolumeUnit();
        const location = await DB.getSetting('location');

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

            ${Auth.isOwner() ? `
            <!-- Ubicación de Operación -->
            <div class="settings-section">
                <div class="settings-section-title">📍 ${I18n.t('location_title')}</div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">${I18n.t('location_country')}</div>
                    </div>
                    <span style="font-weight:600;">${location?.country || I18n.t('location_not_configured')}</span>
                </div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">${I18n.t('location_province')}</div>
                    </div>
                    <span style="font-weight:600;">${location?.province || I18n.t('location_not_configured')}</span>
                </div>
                <div class="settings-item">
                    <div>
                        <div class="settings-item-label">${I18n.t('location_city')}</div>
                    </div>
                    <span style="font-weight:600;">${location?.city || I18n.t('location_not_configured')}</span>
                </div>
                <div class="settings-item" style="justify-content:flex-end;">
                    <button class="btn btn-primary btn-sm" onclick="SettingsModule.showLocationEditor()">
                        ✏️ ${I18n.t('location_edit')}
                    </button>
                </div>
            </div>
            ` : ''}

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
                    <div id="userList" style="margin-top:var(--space-3);"></div>
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

    // ===========================================
    // LEGAJO DIGITAL DEL CONDUCTOR
    // ===========================================

    function showUserManager() {
        Components.showModal(
            '➕ ' + I18n.t('add') + ' Usuario',
            `
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_name')} *</label>
                    <input type="text" class="form-input" id="newUserName" placeholder="${I18n.t('login_name_placeholder')}"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_pin')} *</label>
                    <input type="text" class="form-input" id="newUserPin" placeholder="Hasta 15 dígitos" maxlength="15" inputmode="numeric"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>
                <div class="form-group">
                    <label class="form-label">Rol *</label>
                    <select class="form-select" id="newUserRole" onchange="SettingsModule.toggleLicenseFields()"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                        <option value="owner">${I18n.t('role_owner')}</option>
                        <option value="driver">${I18n.t('role_driver')}</option>
                        <option value="mechanic">${I18n.t('role_mechanic')}</option>
                    </select>
                </div>

                <!-- Legajo del Conductor (solo para drivers) -->
                <div id="licenseFields" style="display:none; border-top:1px solid var(--border-color); padding-top:var(--space-4); margin-top:var(--space-2);">
                    <div style="font-weight:600; margin-bottom:var(--space-3); color:var(--color-primary);">
                        📝 Legajo Digital del Conductor
                    </div>

                    <!-- Datos de Contacto -->
                    <div style="font-weight:600; margin-bottom:var(--space-2); font-size:var(--font-size-sm); color:var(--text-secondary);">🏠 Datos de Contacto</div>
                    <div class="form-group">
                        <label class="form-label">Domicilio Real y Actual *</label>
                        <input type="text" class="form-input" id="driverAddress" placeholder="Calle 123, Villa Gobernador Gálvez"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Número de WhatsApp * (con código de país)</label>
                        <input type="text" class="form-input" id="driverWhatsApp" placeholder="5493476123456" inputmode="tel"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>

                    <!-- Documentación -->
                    <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">🪪 Documentación</div>
                    <div class="form-group">
                        <label class="form-label">Número de Licencia *</label>
                        <input type="text" class="form-input" id="licenseNumber" placeholder="N° de licencia"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label">${I18n.t('license_issue_date')} *</label>
                            <input type="date" class="form-input" id="licenseIssueDate"
                                style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${I18n.t('license_expiry_date')} *</label>
                            <input type="date" class="form-input" id="licenseExpiryDate"
                                style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                        </div>
                    </div>

                    <!-- Fotos de Licencia -->
                    <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">📸 Capturas de Licencia (obligatorias)</div>
                    <div class="form-group">
                        <label class="form-label">🆔 Captura Frente Licencia *</label>
                        <label class="btn btn-sm" style="cursor:pointer;">
                            📷 Tomar / Subir Foto
                            <input type="file" id="licenseFrontFile" accept="image/*" style="display:none;" onchange="SettingsModule.handleLicensePhoto(event, 'front')">
                        </label>
                        <div id="licenseFrontPreview" style="margin-top:var(--space-2);"></div>
                        <input type="hidden" id="licenseFrontData">
                    </div>
                    <div class="form-group">
                        <label class="form-label">🔄 Captura Dorso Licencia *</label>
                        <label class="btn btn-sm" style="cursor:pointer;">
                            📷 Tomar / Subir Foto
                            <input type="file" id="licenseBackFile" accept="image/*" style="display:none;" onchange="SettingsModule.handleLicensePhoto(event, 'back')">
                        </label>
                        <div id="licenseBackPreview" style="margin-top:var(--space-2);"></div>
                        <input type="hidden" id="licenseBackData">
                    </div>
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="SettingsModule.saveUser()">${I18n.t('save')}</button>
            `
        );
    }

    function toggleLicenseFields() {
        const role = document.getElementById('newUserRole')?.value;
        const licenseDiv = document.getElementById('licenseFields');
        if (licenseDiv) {
            licenseDiv.style.display = role === 'driver' ? 'block' : 'none';
        }
    }

    function handleLicensePhoto(event, side) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            if (side === 'front' || side === 'editFront') {
                const dataId = side === 'editFront' ? 'editLicenseFrontData' : 'licenseFrontData';
                const previewId = side === 'editFront' ? 'editLicenseFrontPreview' : 'licenseFrontPreview';
                document.getElementById(dataId).value = e.target.result;
                document.getElementById(previewId).innerHTML = `
                    <img src="${e.target.result}" style="max-width:100%; max-height:150px; border-radius:var(--radius-md); border:2px solid #22c55e;">
                    <div style="color:#22c55e; font-weight:700; font-size:12px; margin-top:4px;">✅ Frente cargado</div>
                `;
            } else if (side === 'back' || side === 'editBack') {
                const dataId = side === 'editBack' ? 'editLicenseBackData' : 'licenseBackData';
                const previewId = side === 'editBack' ? 'editLicenseBackPreview' : 'licenseBackPreview';
                document.getElementById(dataId).value = e.target.result;
                document.getElementById(previewId).innerHTML = `
                    <img src="${e.target.result}" style="max-width:100%; max-height:150px; border-radius:var(--radius-md); border:2px solid #22c55e;">
                    <div style="color:#22c55e; font-weight:700; font-size:12px; margin-top:4px;">✅ Dorso cargado</div>
                `;
            }
        };
        reader.readAsDataURL(file);
    }

    async function captureLicensePhoto() {
        // Fallback: usar input file
        document.getElementById('licenseFrontFile')?.click();
    }

    async function saveUser() {
        const name = document.getElementById('newUserName')?.value.trim();
        const pin = document.getElementById('newUserPin')?.value.trim();
        const role = document.getElementById('newUserRole')?.value;

        if (!name || !pin || pin.length < 4) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        const userData = { name, pin, role };

        // Si es conductor, validar legajo completo
        if (role === 'driver') {
            const address = document.getElementById('driverAddress')?.value.trim();
            const whatsapp = document.getElementById('driverWhatsApp')?.value.trim();
            const licenseNumber = document.getElementById('licenseNumber')?.value.trim();
            const issueDate = document.getElementById('licenseIssueDate')?.value;
            const expiryDate = document.getElementById('licenseExpiryDate')?.value;
            const licenseFront = document.getElementById('licenseFrontData')?.value;
            const licenseBack = document.getElementById('licenseBackData')?.value;

            if (!address || !whatsapp || !licenseNumber || !issueDate || !expiryDate) {
                Components.showToast('Completá todos los campos obligatorios del legajo', 'danger');
                return;
            }

            if (!licenseFront || !licenseBack) {
                Components.showToast('❌ Debés subir FRENTE y DORSO de la licencia', 'danger');
                return;
            }

            userData.address = address;
            userData.whatsapp = whatsapp;
            userData.licenseNumber = licenseNumber;
            userData.licenseIssueDate = issueDate;
            userData.licenseExpiryDate = expiryDate;
            userData.licenseFrontPhoto = licenseFront;
            userData.licenseBackPhoto = licenseBack;
        }

        const fleetId = Auth.getFleetId();

        // Crear en globalUsers para que pueda loguearse
        const globalId = await DB.addGlobalUser({
            name, pin, role, fleetId
        });

        // Crear dentro de la flota
        userData.globalId = globalId;
        await DB.add('users', userData);
        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
    }

    // --- Ubicación ---
    async function showLocationEditor() {
        const location = await DB.getSetting('location') || {};
        _showLocationModal(location, false);
    }

    function showLocationSetup() {
        _showLocationModal({}, true);
    }

    function _showLocationModal(location, isSetup) {
        const title = isSetup
            ? `🗺️ ${I18n.t('location_setup_title')}`
            : `📍 ${I18n.t('location_edit')}`;

        Components.showModal(
            title,
            `
                ${isSetup ? `<p style="text-align:center; color:var(--text-secondary); margin-bottom:var(--space-4); font-size:var(--font-size-sm);">
                    ${I18n.t('location_setup_subtitle')}
                </p>` : ''}
                <div class="form-group">
                    <label class="form-label">${I18n.t('location_country')}</label>
                    <input type="text" class="form-input" id="locCountry"
                        placeholder="${I18n.t('location_placeholder_country')}"
                        value="${location.country || ''}" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('location_province')}</label>
                    <input type="text" class="form-input" id="locProvince"
                        placeholder="${I18n.t('location_placeholder_province')}"
                        value="${location.province || ''}" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('location_city')}</label>
                    <input type="text" class="form-input" id="locCity"
                        placeholder="${I18n.t('location_placeholder_city')}"
                        value="${location.city || ''}" autocomplete="off">
                </div>
            `,
            `
                ${isSetup ? '' : `<button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>`}
                <button class="btn btn-primary" onclick="SettingsModule.saveLocation(${isSetup})">${I18n.t('save')}</button>
            `
        );
    }

    async function saveLocation(isSetup = false) {
        const country = document.getElementById('locCountry')?.value.trim();
        const province = document.getElementById('locProvince')?.value.trim();
        const city = document.getElementById('locCity')?.value.trim();

        if (!country || !province || !city) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        await DB.setSetting('location', { country, province, city });
        Components.closeModal();
        Components.showToast(I18n.t('location_save_success') + ' ✅', 'success');

        if (isSetup) {
            Router.navigate(Router.getDefaultRoute());
        } else {
            Router.navigate('settings');
        }
    }

    // --- Lista de usuarios con estado de licencia ---
    async function loadUserList() {
        const container = document.getElementById('userList');
        if (!container) return;

        const users = await DB.getAll('users');
        if (!users || users.length === 0) {
            container.innerHTML = '<p style="color:var(--text-secondary); text-align:center; padding:var(--space-3);">No hay usuarios</p>';
            return;
        }

        const roleIcons = { owner: '👑', driver: '🚗', mechanic: '🔧' };
        let html = '';

        for (const u of users) {
            const icon = roleIcons[u.role] || '👤';
            const roleName = I18n.t('role_' + u.role) || u.role;

            // Badge de licencia para conductores
            let licenseBadge = '';
            let editBtn = '';
            if (u.role === 'driver') {
                const status = Alerts.getLicenseStatus(u);
                if (status.level === 'danger') {
                    licenseBadge = `<span class="badge badge-danger" style="font-size:0.7rem;">🔴 ${I18n.t('license_expired')}</span>`;
                } else if (status.level === 'warning') {
                    licenseBadge = `<span class="badge badge-warning" style="font-size:0.7rem;">🟡 ${I18n.t('license_expiring')} (${status.daysLeft}d)</span>`;
                } else if (status.level === 'ok') {
                    licenseBadge = `<span class="badge badge-success" style="font-size:0.7rem;">🟢 ${I18n.t('license_valid')} (${status.daysLeft}d)</span>`;
                } else {
                    licenseBadge = `<span class="badge" style="font-size:0.7rem; background:var(--bg-tertiary); color:var(--text-secondary);">⚪ Sin licencia</span>`;
                }
                editBtn = `<button class="btn btn-sm" onclick="SettingsModule.showEditUser('${u.id}')" style="font-size:0.75rem; padding:var(--space-1) var(--space-2);">
                    🪪 ${I18n.t('edit')}
                </button>`;
            }

            html += `
                <div class="settings-item" style="padding:var(--space-3); border-bottom:1px solid var(--border-color);">
                    <div style="display:flex; align-items:center; gap:var(--space-2); flex:1; min-width:0;">
                        <span style="font-size:1.3rem;">${icon}</span>
                        <div style="min-width:0;">
                            <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${u.name}</div>
                            <div style="font-size:var(--font-size-xs); color:var(--text-secondary);">${roleName}${u.whatsapp ? ' • 📱 ' + u.whatsapp : ''}</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:var(--space-2); flex-shrink:0;">
                        ${licenseBadge}
                        ${editBtn}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    }

    // --- Editar legajo de un conductor existente ---
    async function showEditUser(userId) {
        const user = await DB.get('users', userId);
        if (!user) return;

        const issueDate = user.licenseIssueDate || '';
        const expiryDate = user.licenseExpiryDate || '';
        const hasFront = !!user.licenseFrontPhoto;
        const hasBack = !!user.licenseBackPhoto;
        const hasLegacyPhoto = !!user.licensePhoto;

        Components.showModal(
            `🪪 Legajo — ${user.name}`,
            `
                <!-- Datos de Contacto -->
                <div style="font-weight:600; margin-bottom:var(--space-2); font-size:var(--font-size-sm); color:var(--text-secondary);">🏠 Datos de Contacto</div>
                <div class="form-group">
                    <label class="form-label">Domicilio Real y Actual *</label>
                    <input type="text" class="form-input" id="editDriverAddress" value="${user.address || ''}"
                        placeholder="Calle 123, Villa Gobernador Gálvez"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>
                <div class="form-group">
                    <label class="form-label">Número de WhatsApp *</label>
                    <input type="text" class="form-input" id="editDriverWhatsApp" value="${user.whatsapp || ''}"
                        placeholder="5493476123456" inputmode="tel"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>

                <!-- Documentación -->
                <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">🪪 Documentación</div>
                <div class="form-group">
                    <label class="form-label">Número de Licencia *</label>
                    <input type="text" class="form-input" id="editLicenseNumber" value="${user.licenseNumber || ''}"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('license_issue_date')} *</label>
                    <input type="date" class="form-input" id="editLicenseIssue" value="${issueDate}"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('license_expiry_date')} *</label>
                    <input type="date" class="form-input" id="editLicenseExpiry" value="${expiryDate}"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>

                <!-- Fotos -->
                <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">📸 Capturas de Licencia</div>
                <div class="form-group">
                    <label class="form-label">🆔 Frente</label>
                    ${hasFront ? `<div style="margin-bottom:var(--space-2);"><img src="${user.licenseFrontPhoto}" style="max-width:100%; max-height:150px; border-radius:var(--radius-md); border:2px solid #22c55e;"><div style="color:#22c55e; font-weight:700; font-size:12px;">✅ Cargada</div></div>` : (hasLegacyPhoto ? `<div style="margin-bottom:var(--space-2);"><img src="${user.licensePhoto}" style="max-width:100%; max-height:150px; border-radius:var(--radius-md); border:2px solid var(--border-color);"></div>` : '')}
                    <label class="btn btn-sm" style="cursor:pointer;">
                        📷 Actualizar Frente
                        <input type="file" id="editLicenseFrontFile" accept="image/*" style="display:none;" onchange="SettingsModule.handleLicensePhoto(event, 'editFront')">
                    </label>
                    <div id="editLicenseFrontPreview" style="margin-top:var(--space-2);"></div>
                    <input type="hidden" id="editLicenseFrontData" value="">
                </div>
                <div class="form-group">
                    <label class="form-label">🔄 Dorso</label>
                    ${hasBack ? `<div style="margin-bottom:var(--space-2);"><img src="${user.licenseBackPhoto}" style="max-width:100%; max-height:150px; border-radius:var(--radius-md); border:2px solid #22c55e;"><div style="color:#22c55e; font-weight:700; font-size:12px;">✅ Cargada</div></div>` : ''}
                    <label class="btn btn-sm" style="cursor:pointer;">
                        📷 Actualizar Dorso
                        <input type="file" id="editLicenseBackFile" accept="image/*" style="display:none;" onchange="SettingsModule.handleLicensePhoto(event, 'editBack')">
                    </label>
                    <div id="editLicenseBackPreview" style="margin-top:var(--space-2);"></div>
                    <input type="hidden" id="editLicenseBackData" value="">
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="SettingsModule.updateUserLicense('${userId}')">${I18n.t('save')}</button>
            `
        );
    }

    async function updateUserLicense(userId) {
        const issueDate = document.getElementById('editLicenseIssue')?.value;
        const expiryDate = document.getElementById('editLicenseExpiry')?.value;
        const newFront = document.getElementById('editLicenseFrontData')?.value;
        const newBack = document.getElementById('editLicenseBackData')?.value;
        const address = document.getElementById('editDriverAddress')?.value.trim();
        const whatsapp = document.getElementById('editDriverWhatsApp')?.value.trim();
        const licenseNumber = document.getElementById('editLicenseNumber')?.value.trim();

        if (!issueDate || !expiryDate) {
            Components.showToast(I18n.t('license_required'), 'danger');
            return;
        }

        const user = await DB.get('users', userId);
        if (!user) return;

        user.licenseIssueDate = issueDate;
        user.licenseExpiryDate = expiryDate;
        if (address) user.address = address;
        if (whatsapp) user.whatsapp = whatsapp;
        if (licenseNumber) user.licenseNumber = licenseNumber;
        if (newFront) user.licenseFrontPhoto = newFront;
        if (newBack) user.licenseBackPhoto = newBack;

        await DB.put('users', user);
        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        // Refrescar la lista
        loadUserList();
    }

    // afterRender: se llama desde Router después de que el HTML fue insertado
    function afterRender() {
        if (Auth.isOwner()) {
            loadUserList();
        }
    }

    return {
        render, afterRender, exportData, importData, resetData, showUserManager, saveUser,
        showLocationEditor, showLocationSetup, saveLocation,
        toggleLicenseFields, handleLicensePhoto, captureLicensePhoto,
        loadUserList, showEditUser, updateUserLicense
    };
})();
