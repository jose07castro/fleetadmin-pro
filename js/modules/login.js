/* ============================================
   FleetAdmin Pro — Módulo de Login
   Pantalla de inicio de sesión con selección de rol
   Registro de nuevos administradores con flota propia
   ============================================ */

const LoginModule = (() => {
    let selectedRole = 'owner';

    function render() {
        return `
            <div class="login-screen">
                <div class="login-container">
                    <div class="login-logo">
                        <div class="login-logo-icon">🚗</div>
                        <h1>${I18n.t('app_name')}</h1>
                        <p>${I18n.t('app_subtitle')}</p>
                    </div>

                    <div class="login-card">
                        <h2>${I18n.t('login_title')}</h2>
                        <p style="text-align:center; color:var(--text-secondary); margin-bottom:var(--space-6); font-size:var(--font-size-sm);">
                            ${I18n.t('login_subtitle')}
                        </p>

                        <div class="role-selector" id="roleSelector">
                            <button class="role-option selected" data-role="owner" onclick="LoginModule.selectRole('owner')">
                                <span class="role-icon">👑</span>
                                <span class="role-label">${I18n.t('role_owner')}</span>
                            </button>
                            <button class="role-option" data-role="driver" onclick="LoginModule.selectRole('driver')">
                                <span class="role-icon">🚗</span>
                                <span class="role-label">${I18n.t('role_driver')}</span>
                            </button>
                            <button class="role-option" data-role="mechanic" onclick="LoginModule.selectRole('mechanic')">
                                <span class="role-icon">🔧</span>
                                <span class="role-label">${I18n.t('role_mechanic')}</span>
                            </button>
                        </div>

                        <div class="form-group">
                            <label class="form-label">${I18n.t('login_name')}</label>
                            <input type="text" class="form-input" id="loginName"
                                placeholder="${I18n.t('login_name_placeholder')}" autocomplete="off">
                        </div>

                        <div class="form-group">
                            <label class="form-label">${I18n.t('login_pin')} (${I18n.t('login_pin_hint')})</label>
                            <div style="position:relative;">
                                <input type="password" class="form-input" id="loginPin"
                                    placeholder="${I18n.t('login_pin_placeholder')}" maxlength="15" inputmode="numeric"
                                    onkeydown="if(event.key==='Enter') LoginModule.doLogin()"
                                    style="padding-right:3rem;">
                                <button type="button" onclick="LoginModule.togglePin()" id="pinToggleBtn"
                                    style="position:absolute; right:0.75rem; top:50%; transform:translateY(-50%); background:none; border:none; cursor:pointer; font-size:1.2rem; padding:0.25rem; opacity:0.6; transition:opacity 0.2s;"
                                    onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">
                                    👁️
                                </button>
                            </div>
                        </div>

                        <div id="loginError" class="form-error" style="text-align:center; margin-bottom:var(--space-4); display:none;">
                            ${I18n.t('login_error')}
                        </div>

                        <button class="btn btn-primary btn-block btn-lg" onclick="LoginModule.doLogin()">
                            ${I18n.t('login_enter')}
                        </button>

                        <div style="text-align:center; margin-top:var(--space-4);">
                            <button class="btn btn-block" onclick="LoginModule.showRegister()"
                                style="background:transparent; border:2px solid var(--color-primary); color:var(--color-primary); font-weight:600;">
                                👑 ${I18n.t('register_admin')}
                            </button>
                        </div>
                    </div>

                    <div class="login-lang" style="margin-top:var(--space-6);">
                        ${Components.renderLanguageSelector()}
                    </div>

                </div>
            </div>
        `;
    }

    function selectRole(role) {
        selectedRole = role;
        document.querySelectorAll('.role-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.role === role);
        });
    }

    async function doLogin() {
        const name = document.getElementById('loginName').value.trim();
        const pin = document.getElementById('loginPin').value.trim();
        const errorEl = document.getElementById('loginError');

        if (!name || !pin) {
            errorEl.style.display = 'block';
            errorEl.textContent = I18n.t('login_error');
            return;
        }

        // Verificar si hay datos viejos sin migrar
        const hasGlobal = await DB.hasGlobalUsers();
        if (!hasGlobal) {
            // Primera vez con la nueva versión: migrar datos viejos
            const migratedFleetId = await DB.migrateOldData();
            if (migratedFleetId) {
                console.log('📦 Datos migrados, reintentando login...');
            }
        }

        const success = await Auth.authenticate(name, pin, selectedRole);
        if (success) {
            errorEl.style.display = 'none';
            App.startRealtimeSync();

            // Si es owner, verificar si la ubicación está configurada
            if (Auth.isOwner()) {
                const location = await DB.getSetting('location');
                if (!location || !location.country) {
                    Router.navigate(Router.getDefaultRoute());
                    setTimeout(() => SettingsModule.showLocationSetup(), 500);
                    return;
                }
            }

            Router.navigate(Router.getDefaultRoute());
        } else {
            errorEl.style.display = 'block';
            errorEl.textContent = I18n.t('login_error');
            errorEl.parentElement.style.animation = 'shake 0.4s ease';
            setTimeout(() => errorEl.parentElement.style.animation = '', 400);
        }
    }

    function togglePin() {
        const input = document.getElementById('loginPin');
        const btn = document.getElementById('pinToggleBtn');
        if (input.type === 'password') {
            input.type = 'text';
            btn.textContent = '🙈';
        } else {
            input.type = 'password';
            btn.textContent = '👁️';
        }
    }

    function showRegister() {
        Components.showModal(
            `👑 ${I18n.t('register_admin')}`,
            `
                <p style="text-align:center; color:var(--text-secondary); margin-bottom:var(--space-4); font-size:var(--font-size-sm);">
                    ${I18n.t('register_admin_subtitle')}
                </p>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_name')}</label>
                    <input type="text" class="form-input" id="regName"
                        placeholder="${I18n.t('login_name_placeholder')}" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_pin')} (${I18n.t('login_pin_hint')})</label>
                    <input type="password" class="form-input" id="regPin"
                        placeholder="${I18n.t('login_pin_placeholder')}" maxlength="15" inputmode="numeric">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('register_confirm_pin')}</label>
                    <input type="password" class="form-input" id="regPinConfirm"
                        placeholder="${I18n.t('login_pin_placeholder')}" maxlength="15" inputmode="numeric">
                </div>
                <div id="regError" class="form-error" style="text-align:center; margin-bottom:var(--space-2); display:none;"></div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="LoginModule.doRegister()">${I18n.t('register_btn')}</button>
            `
        );
    }

    async function doRegister() {
        const name = document.getElementById('regName')?.value.trim();
        const pin = document.getElementById('regPin')?.value.trim();
        const pinConfirm = document.getElementById('regPinConfirm')?.value.trim();
        const errorEl = document.getElementById('regError');

        if (!name || !pin) {
            errorEl.style.display = 'block';
            errorEl.textContent = I18n.t('error') + ': ' + I18n.t('required');
            return;
        }

        if (pin.length < 4) {
            errorEl.style.display = 'block';
            errorEl.textContent = I18n.t('register_pin_min');
            return;
        }

        if (pin !== pinConfirm) {
            errorEl.style.display = 'block';
            errorEl.textContent = I18n.t('register_pin_mismatch');
            return;
        }

        try {
            // 1. Crear un fleetId nuevo para esta flota
            const fleetId = DB.createFleetId();

            // 2. Registrar en globalUsers con su fleetId
            const globalId = await DB.addGlobalUser({
                name,
                pin,
                role: 'owner',
                fleetId
            });

            // 3. Activar la flota nueva
            DB.setFleet(fleetId);

            // 4. Crear el usuario dentro de la flota
            await DB.add('users', {
                name,
                pin,
                role: 'owner',
                globalId
            });

            Components.closeModal();

            // 5. Auto-login directo (NO usar authenticate para evitar match con entradas viejas)
            Auth.login({
                id: globalId,
                name,
                pin,
                role: 'owner',
                fleetId
            });
            App.startRealtimeSync();
            Router.navigate(Router.getDefaultRoute());
            // Mostrar wizard de ubicación
            setTimeout(() => SettingsModule.showLocationSetup(), 500);

        } catch (e) {
            errorEl.style.display = 'block';
            errorEl.textContent = I18n.t('error');
            console.error('Error en registro:', e);
        }
    }

    return { render, selectRole, doLogin, togglePin, showRegister, doRegister };
})();
