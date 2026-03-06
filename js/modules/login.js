/* ============================================
   FleetAdmin Pro — Módulo de Login
   Pantalla de inicio de sesión con selección de rol
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
                            <input type="password" class="form-input" id="loginPin"
                                placeholder="${I18n.t('login_pin_placeholder')}" maxlength="15" inputmode="numeric"
                                onkeydown="if(event.key==='Enter') LoginModule.doLogin()">
                        </div>

                        <div id="loginError" class="form-error" style="text-align:center; margin-bottom:var(--space-4); display:none;">
                            ${I18n.t('login_error')}
                        </div>

                        <button class="btn btn-primary btn-block btn-lg" onclick="LoginModule.doLogin()">
                            ${I18n.t('login_enter')}
                        </button>
                    </div>

                    <div class="login-lang" style="margin-top:var(--space-6);">
                        ${Components.renderLanguageSelector()}
                    </div>

                    <div style="text-align:center; margin-top:var(--space-4); color:var(--text-tertiary); font-size:var(--font-size-xs);">
                        Demo — ${I18n.t('role_owner')}: Admin / 123456789012345
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

        const success = await Auth.authenticate(name, pin, selectedRole);
        if (success) {
            errorEl.style.display = 'none';
            App.startRealtimeSync();
            Router.navigate(Router.getDefaultRoute());
        } else {
            errorEl.style.display = 'block';
            errorEl.textContent = I18n.t('login_error');
            errorEl.parentElement.style.animation = 'shake 0.4s ease';
            setTimeout(() => errorEl.parentElement.style.animation = '', 400);
        }
    }

    return { render, selectRole, doLogin };
})();
