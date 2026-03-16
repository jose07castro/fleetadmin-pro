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

                <!-- 🚩 Veraz de Conductores — Tarjeta expandible -->
                <div class="settings-section veraz-card" id="verazCard" onclick="SettingsModule.toggleVerazCard()">
                    <div class="veraz-card-header">
                        <span style="font-size:1.4rem;">🚩</span>
                        <span class="veraz-card-title">Veraz de Conductores</span>
                        <span class="veraz-card-chevron" id="verazChevron">▼</span>
                    </div>
                    <div class="veraz-card-body" id="verazCardBody">
                        <div class="veraz-card-desc">Sistema global de reportes. Registrá incidentes contra conductores que otros administradores podrán consultar.</div>
                        <button class="btn btn-sm veraz-report-btn" onclick="event.stopPropagation(); SettingsModule.showReportModal()">
                            🚩 Reportar Conductor
                        </button>
                    </div>
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

        // Mapeo de side -> { dataId, previewId, label }
        const sideMap = {
            front:     { dataId: 'licenseFrontData',     previewId: 'licenseFrontPreview',     label: 'Frente' },
            back:      { dataId: 'licenseBackData',      previewId: 'licenseBackPreview',      label: 'Dorso' },
            editFront: { dataId: 'editLicenseFrontData', previewId: 'editLicenseFrontPreview', label: 'Frente' },
            editBack:  { dataId: 'editLicenseBackData',  previewId: 'editLicenseBackPreview',  label: 'Dorso' },
            cpFront:   { dataId: 'cpFrontData',          previewId: 'cpFrontPreview',          label: 'Frente' },
            cpBack:    { dataId: 'cpBackData',           previewId: 'cpBackPreview',           label: 'Dorso' },
        };

        const mapping = sideMap[side];
        if (!mapping) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const el = document.getElementById(mapping.dataId);
            if (el) el.value = e.target.result;
            const preview = document.getElementById(mapping.previewId);
            if (preview) {
                preview.innerHTML = `
                    <img src="${e.target.result}" style="max-width:100%; max-height:150px; border-radius:var(--radius-md); border:2px solid #22c55e;">
                    <div style="color:#22c55e; font-weight:700; font-size:12px; margin-top:4px;">✅ ${mapping.label} cargado</div>
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
            // Las fotos se subirán a Storage después de crear el usuario
        }

        const fleetId = Auth.getFleetId();

        // Crear en globalUsers para que pueda loguearse
        const globalId = await DB.addGlobalUser({
            name, pin, role, fleetId
        });

        // Crear dentro de la flota
        userData.globalId = globalId;
        const newUserId = await DB.add('users', userData);

        // Subir fotos a Firebase Storage (si es driver y tiene fotos)
        if (role === 'driver' && (licenseFront || licenseBack)) {
            try {
                const savedUser = await DB.get('users', newUserId);
                if (savedUser) {
                    await StorageUtil.processLicensePhotos(savedUser, licenseFront || null, licenseBack || null);
                    await DB.put('users', savedUser);
                }
            } catch (err) {
                Components.showToast('⚠️ Usuario creado pero error al subir fotos: ' + (err.message || 'desconocido'), 'warning');
            }
        }

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
            try {
            const icon = roleIcons[u.role] || '👤';
            const roleName = I18n.t('role_' + (u.role || 'driver')) || u.role;
            const safeName = u.name || 'Sin nombre';

            // Badge de licencia para conductores
            let licenseBadge = '';
            let editBtn = '';
            let deleteBtn = '';
            if (u.role === 'driver') {
                try {
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
                } catch (alertErr) {
                    console.warn('⚠️ Error obteniendo estado de licencia para', safeName, alertErr);
                    licenseBadge = `<span class="badge" style="font-size:0.7rem; background:var(--bg-tertiary); color:var(--text-secondary);">⚪ Sin licencia</span>`;
                }
                editBtn = `<button class="btn btn-sm" onclick="SettingsModule.showEditUser('${u.id}')" style="font-size:0.75rem; padding:var(--space-1) var(--space-2);">
                    🪪 ${I18n.t('edit')}
                </button>`;
            }
            // Botón eliminar (solo no-owners)
            if (u.role !== 'owner') {
                deleteBtn = `<button class="btn btn-sm" onclick="SettingsModule.deepDeleteUser('${u.id}')" style="font-size:0.75rem; padding:var(--space-1) var(--space-2); background:#dc2626; color:white; border:none;">
                    🗑️
                </button>`;
            }

            html += `
                <div class="settings-item" style="padding:var(--space-3); border-bottom:1px solid var(--border-color);">
                    <div style="display:flex; align-items:center; gap:var(--space-2); flex:1; min-width:0;">
                        <span style="font-size:1.3rem;">${icon}</span>
                        <div style="min-width:0;">
                            <div style="font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${safeName}</div>
                            <div style="font-size:var(--font-size-xs); color:var(--text-secondary);">${roleName}${u.whatsapp ? ' • 📱 ' + u.whatsapp : ''}</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:var(--space-2); flex-shrink:0;">
                        ${licenseBadge}
                        ${editBtn}
                        ${deleteBtn}
                    </div>
                </div>
            `;
            } catch (userErr) {
                console.error('⚠️ Error renderizando usuario en lista:', u?.id, userErr);
            }
        }

        container.innerHTML = html;
    }

    // --- Editar legajo de un conductor existente ---
    async function showEditUser(userId) {
        try {
        const user = await DB.get('users', userId);
        if (!user) return;

        // 🔍 DEBUG: Verificar datos recibidos en el celular
        alert('🔍 DEBUG showEditUser\nID: ' + userId + '\nNombre: ' + (user.name || 'NULL') + '\nDomicilio: ' + (user.address || 'NULL') + '\nWhatsApp: ' + (user.whatsapp || 'NULL') + '\n¿Foto frente?: ' + !!user.licenseFrontPhoto + '\n¿Foto dorso?: ' + !!user.licenseBackPhoto);

        // Proteger campos contra null/undefined Y escapar para HTML
        const esc = Components.escapeHTML;
        const safeName = esc(user.name || 'Sin nombre');
        const safeAddress = esc(user.address || '');
        const safeWhatsapp = esc(user.whatsapp || '');
        const safeLicenseNumber = esc(user.licenseNumber || '');
        const safeIssueDate = esc(user.licenseIssueDate || '');
        const safeExpiryDate = esc(user.licenseExpiryDate || '');
        // Validación estricta de fotos: debe ser string no vacío
        const hasFront = !!(user.licenseFrontPhoto && typeof user.licenseFrontPhoto === 'string' && user.licenseFrontPhoto.length > 0);
        const hasBack = !!(user.licenseBackPhoto && typeof user.licenseBackPhoto === 'string' && user.licenseBackPhoto.length > 0);
        const hasLegacyPhoto = !!(user.licensePhoto && typeof user.licensePhoto === 'string' && user.licensePhoto.length > 0);

        Components.showModal(
            `🪪 Legajo — ${safeName}`,
            `
                <!-- Datos de Contacto -->
                <div style="font-weight:600; margin-bottom:var(--space-2); font-size:var(--font-size-sm); color:var(--text-secondary);">🏠 Datos de Contacto</div>
                <div class="form-group">
                    <label class="form-label">Domicilio Real y Actual *</label>
                    <input type="text" class="form-input" id="editDriverAddress" value="${safeAddress}"
                        placeholder="Calle 123, Villa Gobernador Gálvez"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>
                <div class="form-group">
                    <label class="form-label">Número de WhatsApp *</label>
                    <input type="text" class="form-input" id="editDriverWhatsApp" value="${safeWhatsapp}"
                        placeholder="5493476123456" inputmode="tel"
                        style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                </div>

                <!-- Documentación -->
                <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">🪪 Documentación</div>
                <div class="form-group">
                    <label class="form-label">Número de Licencia *</label>
                    <input type="text" class="form-input" id="editLicenseNumber" value="${safeLicenseNumber}"
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

                <!-- Fotos -->
                <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">📸 Capturas de Licencia</div>
                <div class="form-group">
                    <label class="form-label">🆔 Frente</label>
                    ${hasFront ? `<div style="margin-bottom:var(--space-2);">
                        <img src="${user.licenseFrontPhoto}" style="max-width:100%; max-height:150px; border-radius:var(--radius-md); border:2px solid #22c55e;">
                        <div style="display:flex; align-items:center; gap:var(--space-2); margin-top:4px;">
                            <span style="color:#22c55e; font-weight:700; font-size:12px;">✅ Cargada</span>
                            <button type="button" class="btn btn-sm" onclick="StorageUtil.deleteSinglePhoto('${user.id}', 'front', 'settings')" style="background:#dc2626; color:white; border:none; font-size:11px; padding:2px 8px; cursor:pointer;">🗑️ Eliminar</button>
                        </div>
                    </div>` : (hasLegacyPhoto ? `<div style="margin-bottom:var(--space-2);"><img src="${user.licensePhoto}" style="max-width:100%; max-height:150px; border-radius:var(--radius-md); border:2px solid var(--border-color);"></div>` : '<div style="color:#dc2626; font-weight:700; font-size:12px; margin-bottom:var(--space-2);">❌ No cargada</div>')}
                    <label class="btn btn-sm" style="cursor:pointer;">
                        📷 Actualizar Frente
                        <input type="file" id="editLicenseFrontFile" accept="image/*" style="display:none;" onchange="SettingsModule.handleLicensePhoto(event, 'editFront')">
                    </label>
                    <div id="editLicenseFrontPreview" style="margin-top:var(--space-2);"></div>
                    <input type="hidden" id="editLicenseFrontData" value="">
                </div>
                <div class="form-group">
                    <label class="form-label">🔄 Dorso</label>
                    ${hasBack ? `<div style="margin-bottom:var(--space-2);">
                        <img src="${user.licenseBackPhoto}" style="max-width:100%; max-height:150px; border-radius:var(--radius-md); border:2px solid #22c55e;">
                        <div style="display:flex; align-items:center; gap:var(--space-2); margin-top:4px;">
                            <span style="color:#22c55e; font-weight:700; font-size:12px;">✅ Cargada</span>
                            <button type="button" class="btn btn-sm" onclick="StorageUtil.deleteSinglePhoto('${user.id}', 'back', 'settings')" style="background:#dc2626; color:white; border:none; font-size:11px; padding:2px 8px; cursor:pointer;">🗑️ Eliminar</button>
                        </div>
                    </div>` : '<div style="color:#dc2626; font-weight:700; font-size:12px; margin-bottom:var(--space-2);">❌ No cargada</div>'}
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
        } catch (error) {
            console.error('❌ Error al renderizar modal de edición de legajo:', error);
            alert('Error al abrir legajo: ' + (error.message || error));
        }
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

        // Subir fotos a Firebase Storage (si hay nuevas)
        if (newFront || newBack) {
            try {
                await StorageUtil.processLicensePhotos(user, newFront || null, newBack || null);
            } catch (err) {
                Components.showToast('❌ Error al subir fotos: ' + (err.message || 'desconocido'), 'danger');
                return;
            }
        }

        await DB.put('users', user);
        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        // Refrescar la lista
        loadUserList();
    }

    // ===========================================
    // PANTALLA DE COMPLETAR PERFIL (Bloqueo)
    // ===========================================

    async function renderCompleteProfile() {
        const user = Auth.getUser();
        const fullUser = user ? await DB.get('users', user.id) : null;

        return `
            <div style="max-width:500px; margin:0 auto; padding:var(--space-6) var(--space-4);">
                <!-- Alerta de Bloqueo -->
                <div style="background:#dc2626; color:#fff; padding:var(--space-4); border-radius:var(--radius-lg); margin-bottom:var(--space-6); text-align:center;">
                    <div style="font-size:2.5rem; margin-bottom:var(--space-2);">🚫</div>
                    <div style="font-size:var(--font-size-lg); font-weight:800; margin-bottom:var(--space-2);">
                        PERFIL INCOMPLETO
                    </div>
                    <div style="font-size:var(--font-size-sm); opacity:0.9;">
                        Para continuar trabajando, es obligatorio actualizar sus datos de contacto y fotos de la licencia por seguridad de la flota.
                    </div>
                </div>

                <div class="card" style="padding:var(--space-5);">
                    <h3 style="margin-bottom:var(--space-4); text-align:center;">📝 Completar Legajo</h3>

                    <!-- Datos de Contacto -->
                    <div style="font-weight:600; margin-bottom:var(--space-2); font-size:var(--font-size-sm); color:var(--text-secondary);">🏠 Datos de Contacto</div>
                    <div class="form-group">
                        <label class="form-label">Domicilio Real y Actual *</label>
                        <input type="text" class="form-input" id="cpAddress" value="${fullUser?.address || ''}"
                            placeholder="Calle 123, Villa Gobernador Gálvez"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Número de WhatsApp * (con código de país)</label>
                        <input type="text" class="form-input" id="cpWhatsApp" value="${fullUser?.whatsapp || ''}"
                            placeholder="5493476123456" inputmode="tel"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>

                    <!-- Documentación -->
                    <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">🪪 Documentación</div>
                    <div class="form-group">
                        <label class="form-label">Número de Licencia *</label>
                        <input type="text" class="form-input" id="cpLicenseNumber" value="${fullUser?.licenseNumber || ''}"
                            placeholder="N° de licencia"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('license_issue_date')} *</label>
                        <input type="date" class="form-input" id="cpIssueDate" value="${fullUser?.licenseIssueDate || ''}"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('license_expiry_date')} *</label>
                        <input type="date" class="form-input" id="cpExpiryDate" value="${fullUser?.licenseExpiryDate || ''}"
                            style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                    </div>

                    <!-- Fotos de Licencia -->
                    <div style="font-weight:600; margin-bottom:var(--space-2); margin-top:var(--space-4); font-size:var(--font-size-sm); color:var(--text-secondary);">📸 Capturas de Licencia (obligatorias)</div>
                    <div class="form-group">
                        <label class="form-label">🆔 Frente de Licencia *</label>
                        ${fullUser?.licenseFrontPhoto ? '<div style="margin-bottom:var(--space-2);"><img src="' + fullUser.licenseFrontPhoto + '" style="max-width:100%; max-height:120px; border-radius:var(--radius-md); border:2px solid #22c55e;"><div style="color:#22c55e; font-weight:700; font-size:12px;">✅ Ya cargada</div></div>' : ''}
                        <label class="btn btn-sm" style="cursor:pointer;">
                            📷 Tomar / Subir Foto Frente
                            <input type="file" accept="image/*" style="display:none;" onchange="SettingsModule.handleLicensePhoto(event, 'cpFront')">
                        </label>
                        <div id="cpFrontPreview" style="margin-top:var(--space-2);"></div>
                        <input type="hidden" id="cpFrontData" value="">
                    </div>
                    <div class="form-group">
                        <label class="form-label">🔄 Dorso de Licencia *</label>
                        ${fullUser?.licenseBackPhoto ? '<div style="margin-bottom:var(--space-2);"><img src="' + fullUser.licenseBackPhoto + '" style="max-width:100%; max-height:120px; border-radius:var(--radius-md); border:2px solid #22c55e;"><div style="color:#22c55e; font-weight:700; font-size:12px;">✅ Ya cargada</div></div>' : ''}
                        <label class="btn btn-sm" style="cursor:pointer;">
                            📷 Tomar / Subir Foto Dorso
                            <input type="file" accept="image/*" style="display:none;" onchange="SettingsModule.handleLicensePhoto(event, 'cpBack')">
                        </label>
                        <div id="cpBackPreview" style="margin-top:var(--space-2);"></div>
                        <input type="hidden" id="cpBackData" value="">
                    </div>

                    <button type="button" id="btnSaveCompleteProfile" class="btn btn-primary" style="width:100%; margin-top:var(--space-4); font-size:var(--font-size-lg); padding:var(--space-3);" onclick="console.log('--- BOTON PRESIONADO ---'); SettingsModule.saveCompleteProfile()">
                        ✅ Guardar y Continuar
                    </button>
                </div>
            </div>
        `;
    }

    async function saveCompleteProfile() {
        console.log('--- FUNCIÓN saveCompleteProfile EJECUTADA ---');
        const btn = document.getElementById('btnSaveCompleteProfile');

        try {
            // Feedback visual en botón
            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ Guardando fotos y datos...';
            }

            console.log('📝 saveCompleteProfile: inicio');

            const address = document.getElementById('cpAddress')?.value.trim();
            const whatsapp = document.getElementById('cpWhatsApp')?.value.trim();
            const licenseNumber = document.getElementById('cpLicenseNumber')?.value.trim();
            const issueDate = document.getElementById('cpIssueDate')?.value;
            const expiryDate = document.getElementById('cpExpiryDate')?.value;
            const newFront = document.getElementById('cpFrontData')?.value;
            const newBack = document.getElementById('cpBackData')?.value;

            console.log('📝 Valores:', { address, whatsapp, licenseNumber, issueDate, expiryDate, hasFront: !!newFront, hasBack: !!newBack });

            if (!address || !whatsapp || !licenseNumber || !issueDate || !expiryDate) {
                Components.showToast('Completá todos los campos obligatorios', 'danger');
                if (btn) { btn.disabled = false; btn.textContent = '✅ Guardar y Continuar'; }
                return;
            }

            // Buscar usuario en la flota (NO usar Auth.getUserId que es el ID global)
            const user = await Auth.getFleetUserRecord();
            console.log('📝 Usuario encontrado:', user ? user.id : 'NULL');

            if (!user) {
                alert('Error: No se pudo encontrar tu usuario en la base de datos. Cerrá sesión y volvé a entrar.');
                if (btn) { btn.disabled = false; btn.textContent = '✅ Guardar y Continuar'; }
                return;
            }

            // Verificar que tenga fotos (nuevas o existentes)
            const hasFront = newFront || user.licenseFrontPhoto;
            const hasBack = newBack || user.licenseBackPhoto;

            if (!hasFront || !hasBack) {
                Components.showToast('❌ Debés subir FRENTE y DORSO de la licencia', 'danger');
                if (btn) { btn.disabled = false; btn.textContent = '✅ Guardar y Continuar'; }
                return;
            }

            // Actualizar campos de texto
            user.address = address;
            user.whatsapp = whatsapp;
            user.licenseNumber = licenseNumber;
            user.licenseIssueDate = issueDate;
            user.licenseExpiryDate = expiryDate;

            // Subir fotos a Firebase Storage (si hay nuevas)
            if (newFront || newBack) {
                console.log('📤 Subiendo fotos a Storage...');
                await StorageUtil.processLicensePhotos(user, newFront || null, newBack || null);
                console.log('✅ Fotos subidas OK');
            }

            // Guardar en la base de datos
            console.log('💾 Guardando en DB:', user.id);
            await DB.put('users', user);
            console.log('✅ Guardado OK');

            Components.showToast('✅ Legajo actualizado correctamente', 'success');

            // Redirigir al panel principal
            setTimeout(() => Router.navigate(Router.getDefaultRoute()), 500);

        } catch (error) {
            console.error('❌ Error en saveCompleteProfile:', error);
            alert('Error al guardar perfil: ' + (error.message || error) + '\n\nRevisá la consola del navegador (F12) para más detalles.');
            if (btn) { btn.disabled = false; btn.textContent = '✅ Guardar y Continuar'; }
        }
    }

    // Eliminación profunda desde Settings
    async function deepDeleteUser(userId) {
        if (!confirm('⚠️ ¿Eliminar este usuario PERMANENTEMENTE?\n\nSe borrarán sus datos y fotos del servidor.')) return;

        try {
            Components.showToast('🗑️ Eliminando usuario y fotos...', 'info');

            const user = await DB.get('users', userId);
            if (user) {
                // 1. Borrar fotos de Storage
                if (user.licenseFrontPhoto || user.licenseBackPhoto) {
                    await StorageUtil.deleteUserPhotos(user);
                }
                // 2. Borrar de globalUsers
                if (user.globalId) {
                    try {
                        await firebaseDB.ref('globalUsers/' + user.globalId).remove();
                    } catch (e) {
                        console.warn('⚠️ No se pudo borrar de globalUsers:', e.message);
                    }
                }
            }

            // 3. Borrar de la flota
            await DB.remove('users', userId);
            Components.showToast('✅ Usuario y fotos eliminados', 'success');
            loadUserList();

        } catch (error) {
            console.error('❌ Error eliminando:', error);
            alert('Error al eliminar: ' + (error.message || error));
        }
    }

    // ============================================
    // SISTEMA DE REPORTES GLOBALES (VERAZ) — Fase 1
    // ============================================

    async function showReportModal() {
        try {
            // Cargar lista de conductores de la flota para el select
            const allUsers = await DB.getAll('users');
            const drivers = (allUsers || []).filter(u => u.role === 'driver');
            const esc = Components.escapeHTML;

            const driverOptions = drivers.map(d => {
                const name = esc(d.name || 'Sin nombre');
                const dni = esc(d.licenseNumber || d.dni || 'Sin DNI');
                return `<option value="${esc(d.id)}">${name} — ${dni}</option>`;
            }).join('');

            Components.showModal(
                '🚩 Reportar Conductor al Sistema Global',
                `
                    <div style="background:rgba(220,38,38,0.08); border:2px solid #dc2626; border-radius:var(--radius-lg); padding:var(--space-3); margin-bottom:var(--space-4);">
                        <div style="color:#dc2626; font-weight:700; font-size:var(--font-size-sm); margin-bottom:var(--space-1);">⚠️ Atención</div>
                        <div style="color:var(--text-secondary); font-size:var(--font-size-xs);">Este reporte quedará registrado en el sistema global. Otros administradores de flota podrán ver este historial al consultar al conductor.</div>
                    </div>

                    <!-- A. Selector de tipo de chofer -->
                    <div class="form-group">
                        <label class="form-label" style="font-weight:700;">Tipo de Conductor</label>
                        <div style="display:flex; flex-direction:column; gap:var(--space-2);">
                            <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer; padding:var(--space-2); border:2px solid var(--border-color); border-radius:var(--radius-md);" id="reportOptionFleet">
                                <input type="radio" name="reportDriverType" value="fleet" checked onchange="SettingsModule.toggleReportDriverType('fleet')">
                                <span style="font-weight:600;">🚗 Chofer de mi flota actual</span>
                            </label>
                            <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer; padding:var(--space-2); border:2px solid var(--border-color); border-radius:var(--radius-md);" id="reportOptionExternal">
                                <input type="radio" name="reportDriverType" value="external" onchange="SettingsModule.toggleReportDriverType('external')">
                                <span style="font-weight:600;">📋 Chofer Histórico / Externo</span>
                            </label>
                        </div>
                    </div>

                    <!-- B. Campos condicionales: Flota -->
                    <div id="reportFleetFields">
                        <div class="form-group">
                            <label class="form-label">Seleccionar Conductor de la Flota *</label>
                            <select class="form-input" id="reportFleetDriverSelect"
                                style="background:#ffffff !important; color:#000000 !important; font-size:18px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                                <option value="">— Seleccionar conductor —</option>
                                ${driverOptions}
                            </select>
                        </div>
                    </div>

                    <!-- B. Campos condicionales: Externo (oculto por defecto) -->
                    <div id="reportExternalFields" style="display:none;">
                        <div class="form-group">
                            <label class="form-label">🪪 DNI del Conductor *</label>
                            <input type="text" class="form-input" id="reportExternalDNI" placeholder="Ej: 30123456"
                                style="background:#ffffff !important; color:#000000 !important; font-size:18px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">👤 Nombre Completo *</label>
                            <input type="text" class="form-input" id="reportExternalName" placeholder="Nombre y Apellido"
                                style="background:#ffffff !important; color:#000000 !important; font-size:18px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">📷 Foto Frente Licencia (Opcional)</label>
                            <input type="file" class="form-input" id="reportExternalPhotoFront" accept="image/*"
                                style="background:#ffffff !important; color:#000000 !important; border:2px solid #d1d5db !important;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">📷 Foto Dorso Licencia (Opcional)</label>
                            <input type="file" class="form-input" id="reportExternalPhotoBack" accept="image/*"
                                style="background:#ffffff !important; color:#000000 !important; border:2px solid #d1d5db !important;">
                        </div>
                        <small style="color:#dc2626; font-weight:600; display:block; margin-bottom:var(--space-3);">
                            ⚠️ Aviso legal: Al subir imágenes de terceros, el administrador confirma poseer el consentimiento para su uso en la plataforma.
                        </small>
                    </div>

                    <!-- C. Campos globales (siempre visibles) -->
                    <div style="border-top:2px solid var(--border-color); padding-top:var(--space-4); margin-top:var(--space-2);">
                        <div class="form-group">
                            <label class="form-label">📋 Motivo del Reporte *</label>
                            <select class="form-input" id="reportMotive" required
                                style="background:#ffffff !important; color:#000000 !important; font-size:18px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                                <option value="">— Seleccionar motivo —</option>
                                <option value="deuda">Deuda económica (Alquiler/Liquidación)</option>
                                <option value="multas">Acumulación de multas graves</option>
                                <option value="negligencia">Negligencia al volante / Choque con culpa</option>
                                <option value="abandono">Abandono de vehículo / Maltrato de unidad</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label class="form-label">📝 Detalles del incidente *</label>
                            <textarea class="form-input" id="reportDetails" rows="4" required
                                placeholder="Describa brevemente la situación..."
                                style="background:#ffffff !important; color:#000000 !important; font-size:16px !important; font-weight:600 !important; border:2px solid #000000 !important; resize:vertical;"></textarea>
                        </div>
                    </div>
                `,
                `
                    <button class="btn btn-secondary" onclick="Components.closeModal()">Cancelar</button>
                    <button class="btn" onclick="SettingsModule.submitReport()" style="background:#dc2626; color:white; border:none; font-weight:700; font-size:var(--font-size-base);">🚩 Confirmar Reporte</button>
                `
            );
        } catch (error) {
            console.error('❌ Error al abrir modal de reporte:', error);
            alert('Error al abrir formulario de reporte: ' + (error.message || error));
        }
    }

    // Toggle entre campos de flota y campos externos
    function toggleReportDriverType(type) {
        const fleetFields = document.getElementById('reportFleetFields');
        const externalFields = document.getElementById('reportExternalFields');
        const optFleet = document.getElementById('reportOptionFleet');
        const optExternal = document.getElementById('reportOptionExternal');

        if (type === 'fleet') {
            fleetFields.style.display = 'block';
            externalFields.style.display = 'none';
            if (optFleet) optFleet.style.borderColor = 'var(--color-primary)';
            if (optExternal) optExternal.style.borderColor = 'var(--border-color)';
        } else {
            fleetFields.style.display = 'none';
            externalFields.style.display = 'block';
            if (optFleet) optFleet.style.borderColor = 'var(--border-color)';
            if (optExternal) optExternal.style.borderColor = 'var(--color-primary)';
        }
    }

    async function submitReport() {
        // Determinar tipo de conductor
        const driverType = document.querySelector('input[name="reportDriverType"]:checked')?.value;
        const motive = document.getElementById('reportMotive')?.value;
        const details = document.getElementById('reportDetails')?.value?.trim();

        // Validar motivo y detalles
        if (!motive) {
            alert('⚠️ Debe seleccionar un motivo de reporte.');
            return;
        }
        if (!details || details.length < 10) {
            alert('⚠️ Debe escribir una descripción de al menos 10 caracteres.');
            return;
        }

        let conductorData = {};

        if (driverType === 'fleet') {
            const selectedId = document.getElementById('reportFleetDriverSelect')?.value;
            if (!selectedId) {
                alert('⚠️ Debe seleccionar un conductor de la flota.');
                return;
            }
            // Obtener datos del conductor seleccionado
            const driver = await DB.get('users', selectedId);
            if (!driver) {
                alert('Error: Conductor no encontrado en la flota.');
                return;
            }
            conductorData = {
                tipo: 'flota',
                conductorId: selectedId,
                conductorDNI: driver.licenseNumber || driver.dni || '',
                conductorNombre: driver.name || ''
            };
        } else {
            const externalDNI = document.getElementById('reportExternalDNI')?.value?.trim();
            const externalName = document.getElementById('reportExternalName')?.value?.trim();
            if (!externalDNI) {
                alert('⚠️ Debe ingresar el DNI del conductor.');
                return;
            }
            if (!externalName) {
                alert('⚠️ Debe ingresar el nombre completo del conductor.');
                return;
            }
            conductorData = {
                tipo: 'externo',
                conductorId: null,
                conductorDNI: externalDNI,
                conductorNombre: externalName
            };
        }

        const reportData = {
            ...conductorData,
            motivo: motive,
            detalles: details,
            reportadoPor: Auth.getUserName(),
            fleetId: Auth.getFleetId(),
            fecha: new Date().toISOString()
        };

        console.log('🚩 REPORTE DE CONDUCTOR (simulado):', reportData);

        Components.closeModal();
        Components.showToast('Interfaz de reporte lista. Fase 1 completada.', 'success');
    }

    // afterRender: se llama desde Router después de que el HTML fue insertado
    function afterRender() {
        if (Auth.isOwner()) {
            loadUserList();
        }
    }

    // Toggle para la tarjeta expandible del Veraz
    function toggleVerazCard() {
        const body = document.getElementById('verazCardBody');
        const chevron = document.getElementById('verazChevron');
        const card = document.getElementById('verazCard');
        if (!body) return;
        const isOpen = body.classList.contains('veraz-open');
        if (isOpen) {
            body.classList.remove('veraz-open');
            card.classList.remove('veraz-expanded');
            chevron.textContent = '▼';
        } else {
            body.classList.add('veraz-open');
            card.classList.add('veraz-expanded');
            chevron.textContent = '▲';
        }
    }

    return {
        render, renderCompleteProfile, saveCompleteProfile,
        afterRender, exportData, importData, resetData, showUserManager, saveUser,
        showLocationEditor, showLocationSetup, saveLocation,
        toggleLicenseFields, handleLicensePhoto, captureLicensePhoto,
        loadUserList, showEditUser, updateUserLicense, deepDeleteUser,
        showReportModal, submitReport, toggleReportDriverType,
        toggleVerazCard
    };
})();
