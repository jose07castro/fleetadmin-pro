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
                        <div class="login-logo-icon" style="background:transparent; box-shadow:none; border:none;">
                            <img src="assets/logo-v135.png" style="width:100%; height:100%; object-fit:contain; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4));" alt="Logo">
                        </div>
                        <h1>${I18n.t('app_name')}</h1>
                        <p>${I18n.t('app_subtitle')}</p>
                    </div>

                    <div class="login-card">
                        <h2>${I18n.t('login_title')}</h2>
                        <p style="text-align:center; color:var(--text-secondary); margin-bottom:var(--space-6); font-size:var(--font-size-sm);">
                            ${I18n.t('login_subtitle')}
                        </p>

                        <div class="role-selector" id="roleSelector">
                            <button class="role-option ${selectedRole === 'owner' ? 'selected' : ''}" data-role="owner" onclick="LoginModule.selectRole('owner')">
                                <span class="role-icon">
                                    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                                        <defs>
                                            <linearGradient id="crownGold" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#FFE259"/>
                                                <stop offset="50%" stop-color="#FFA751"/>
                                                <stop offset="100%" stop-color="#D48A37"/>
                                            </linearGradient>
                                            <linearGradient id="crownGoldDark" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stop-color="#B8732A"/>
                                                <stop offset="100%" stop-color="#5C3A15"/>
                                            </linearGradient>
                                            <linearGradient id="crownGlow" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.6"/>
                                                <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
                                            </linearGradient>
                                            <radialGradient id="gemRed" cx="50%" cy="50%" r="50%">
                                                <stop offset="0%" stop-color="#FF5E62"/>
                                                <stop offset="100%" stop-color="#FF1E27"/>
                                            </radialGradient>
                                            <radialGradient id="gemBlue" cx="50%" cy="50%" r="50%">
                                                <stop offset="0%" stop-color="#00C9FF"/>
                                                <stop offset="100%" stop-color="#92FE9D"/>
                                            </radialGradient>
                                            <radialGradient id="gemPurple" cx="50%" cy="50%" r="50%">
                                                <stop offset="0%" stop-color="#F355FF"/>
                                                <stop offset="100%" stop-color="#8000FF"/>
                                            </radialGradient>
                                        </defs>
                                        <ellipse cx="32" cy="52" rx="20" ry="5" fill="#000000" opacity="0.3"/>
                                        <path d="M12 42 C12 47, 52 47, 52 42 L52 46 C52 50, 12 50, 12 46 Z" fill="url(#crownGoldDark)"/>
                                        <path d="M12 42 C12 47, 52 47, 52 42 C52 38, 12 38, 12 42" fill="url(#crownGold)"/>
                                        <path d="M12 42 L12 28 L22 36 L32 20 L42 36 L52 28 L52 42 C52 42, 32 45, 12 42 Z" fill="#996020"/>
                                        <path d="M12 42 L12 28 L22 36 L21 44 Z" fill="url(#crownGold)"/>
                                        <path d="M21 44 L22 36 L32 20 L42 36 L43 44 C32 46, 21 46, 21 44 Z" fill="url(#crownGold)"/>
                                        <path d="M43 44 L42 36 L52 28 L52 42 Z" fill="url(#crownGold)"/>
                                        <path d="M12 42 L12 28 L22 36 L32 20 L42 36 L52 28 L52 42 C52 42, 32 45, 12 42 Z" fill="url(#crownGlow)" opacity="0.4"/>
                                        <circle cx="12" cy="28" r="3.5" fill="url(#gemPurple)"/>
                                        <circle cx="32" cy="20" r="5" fill="url(#gemRed)"/>
                                        <circle cx="52" cy="28" r="3.5" fill="url(#gemPurple)"/>
                                        <circle cx="20" cy="42.5" r="2" fill="url(#gemBlue)"/>
                                        <circle cx="32" cy="43.5" r="2.5" fill="url(#gemRed)"/>
                                        <circle cx="44" cy="42.5" r="2" fill="url(#gemBlue)"/>
                                        <path d="M32 17 L33 20 L36 21 L33 22 L32 25 L31 22 L28 21 L31 20 Z" fill="#FFFFFF" opacity="0.9"/>
                                    </svg>
                                </span>
                                <span class="role-label">${I18n.t('role_owner')}</span>
                            </button>
                            <button class="role-option ${selectedRole === 'titular' ? 'selected' : ''}" data-role="titular" onclick="LoginModule.selectRole('titular')">
                                <span class="role-icon">
                                    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                                        <defs>
                                            <linearGradient id="briefcaseBody" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#E27D60"/>
                                                <stop offset="50%" stop-color="#C35A3E"/>
                                                <stop offset="100%" stop-color="#8E2D13"/>
                                            </linearGradient>
                                            <linearGradient id="briefcaseSide" x1="0%" y1="0%" x2="100%" y2="0%">
                                                <stop offset="0%" stop-color="#70200C"/>
                                                <stop offset="100%" stop-color="#3D0F04"/>
                                            </linearGradient>
                                            <linearGradient id="briefcaseTop" x1="0%" y1="100%" x2="0%" y2="0%">
                                                <stop offset="0%" stop-color="#A54028"/>
                                                <stop offset="100%" stop-color="#F2987E"/>
                                            </linearGradient>
                                            <linearGradient id="goldMetal" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#FFE066"/>
                                                <stop offset="50%" stop-color="#F5B041"/>
                                                <stop offset="100%" stop-color="#9A7D0A"/>
                                            </linearGradient>
                                            <linearGradient id="chromeMetal" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stop-color="#FFFFFF"/>
                                                <stop offset="30%" stop-color="#BDC3C7"/>
                                                <stop offset="100%" stop-color="#7F8C8D"/>
                                            </linearGradient>
                                        </defs>
                                        <ellipse cx="34.5" cy="52" rx="22" ry="5" fill="#000000" opacity="0.35"/>
                                        <path d="M17 28 L22 25 L22 45 L17 48 Z" fill="url(#briefcaseSide)"/>
                                        <path d="M17 28 L22 25 L52 25 L47 28 Z" fill="url(#briefcaseTop)"/>
                                        <path d="M17 28 L47 28 L47 48 L17 48 Z" fill="url(#briefcaseBody)"/>
                                        <path d="M17 28 L47 28 L47 36 C47 36, 40 39, 32 39 C24 39, 17 36, 17 36 Z" fill="#6A1A0A"/>
                                        <path d="M19 29 L45 29 L45 35 C45 35, 39 38, 32 38 C25 38, 19 35, 19 35 Z" fill="url(#briefcaseBody)" opacity="0.8"/>
                                        <rect x="23" y="34" width="5" height="7" rx="1" fill="url(#goldMetal)"/>
                                        <circle cx="25.5" cy="38" r="1" fill="#3D0F04"/>
                                        <rect x="36" y="34" width="5" height="7" rx="1" fill="url(#goldMetal)"/>
                                        <circle cx="38.5" cy="38" r="1" fill="#3D0F04"/>
                                        <path d="M27 25 L27 22 L30 22 L30 25 Z" fill="url(#chromeMetal)"/>
                                        <path d="M39 25 L39 22 L42 22 L42 25 Z" fill="url(#chromeMetal)"/>
                                        <path d="M28 22 C28 15, 41 15, 41 22 L38 22 C38 18, 31 18, 31 22 Z" fill="#3D0F04"/>
                                        <path d="M29 22 C29 16, 40 16, 40 22" stroke="url(#briefcaseTop)" stroke-width="1.5" fill="none"/>
                                        <path d="M17 44 L21 44 L21 48 L17 48 Z" fill="url(#goldMetal)" opacity="0.9"/>
                                        <path d="M43 44 L47 44 L47 48 L43 48 Z" fill="url(#goldMetal)" opacity="0.9"/>
                                    </svg>
                                </span>
                                <span class="role-label">${I18n.t('role_titular')}</span>
                            </button>
                            <button class="role-option ${selectedRole === 'mechanic' ? 'selected' : ''}" data-role="mechanic" onclick="LoginModule.selectRole('mechanic')">
                                <span class="role-icon">
                                    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                                        <defs>
                                            <linearGradient id="chromeBody" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#FFFFFF"/>
                                                <stop offset="25%" stop-color="#E2E8F0"/>
                                                <stop offset="50%" stop-color="#94A3B8"/>
                                                <stop offset="75%" stop-color="#475569"/>
                                                <stop offset="100%" stop-color="#1E293B"/>
                                            </linearGradient>
                                            <linearGradient id="chromeHighlight" x1="0%" y1="100%" x2="100%" y2="0%">
                                                <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.8"/>
                                                <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0"/>
                                                <stop offset="100%" stop-color="#00D2FF" stop-opacity="0.3"/>
                                            </linearGradient>
                                            <linearGradient id="neonCyan" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#00F2FE"/>
                                                <stop offset="100%" stop-color="#4FACFE"/>
                                            </linearGradient>
                                        </defs>
                                        <ellipse cx="32" cy="46" rx="24" ry="4" transform="rotate(-25, 32, 46)" fill="#000000" opacity="0.35"/>
                                        <g transform="translate(0, 3.5) rotate(-30, 32, 32)" fill="#334155">
                                            <path fill-rule="evenodd" d="M 21 27 L 44 27 C 47 23, 53 23, 56 27 C 60 30, 60 34, 56 37 C 53 41, 47 41, 44 37 L 21 37 C 17 41, 11 41, 8 37 C 5 34, 5 30, 8 27 C 11 23, 17 23, 21 27 Z M 5 30 L 11 30 L 14 32 L 11 34 L 5 34 L 8 32 Z M 50 27 C 47.2 27, 45 29.2, 45 32 C 45 34.8, 47.2 37, 50 37 C 52.8 37, 55 34.8, 55 32 C 55 29.2, 52.8 27, 50 27 Z"/>
                                        </g>
                                        <g transform="rotate(-30, 32, 32)">
                                            <path fill-rule="evenodd" d="M 21 27 L 44 27 C 47 23, 53 23, 56 27 C 60 30, 60 34, 56 37 C 53 41, 47 41, 44 37 L 21 37 C 17 41, 11 41, 8 37 C 5 34, 5 30, 8 27 C 11 23, 17 23, 21 27 Z M 5 30 L 11 30 L 14 32 L 11 34 L 5 34 L 8 32 Z M 50 27 C 47.2 27, 45 29.2, 45 32 C 45 34.8, 47.2 37, 50 37 C 52.8 37, 55 34.8, 55 32 C 55 29.2, 52.8 27, 50 27 Z" fill="url(#chromeBody)"/>
                                            <rect x="23" y="30.5" width="18" height="3" rx="1" fill="url(#neonCyan)"/>
                                            <path d="M 21 27 L 44 27 C 45.5 25, 47.5 24, 50 24 L 50 27 Z" fill="url(#chromeHighlight)"/>
                                        </g>
                                    </svg>
                                </span>
                                <span class="role-label">${I18n.t('role_mechanic')}</span>
                            </button>
                            <button class="role-option ${selectedRole === 'driver' ? 'selected' : ''}" data-role="driver" onclick="LoginModule.selectRole('driver')">
                                <span class="role-icon">
                                    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                                        <defs>
                                            <linearGradient id="carBodyRed" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#FF416C"/>
                                                <stop offset="100%" stop-color="#9A0F2B"/>
                                            </linearGradient>
                                            <linearGradient id="carBodyRedDark" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stop-color="#9A0F2B"/>
                                                <stop offset="100%" stop-color="#4A0512"/>
                                            </linearGradient>
                                            <linearGradient id="carGlass" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#4A5568"/>
                                                <stop offset="50%" stop-color="#1A202C"/>
                                                <stop offset="100%" stop-color="#0F1219"/>
                                            </linearGradient>
                                            <linearGradient id="glassShine" x1="0%" y1="0%" x2="100%" y2="0%">
                                                <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.6"/>
                                                <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0"/>
                                            </linearGradient>
                                            <radialGradient id="headlightGlow" cx="50%" cy="50%" r="50%">
                                                <stop offset="0%" stop-color="#FFFBD0"/>
                                                <stop offset="40%" stop-color="#FFEB3B"/>
                                                <stop offset="100%" stop-color="#FFEB3B" stop-opacity="0"/>
                                            </radialGradient>
                                        </defs>
                                        <ellipse cx="32" cy="50" rx="24" ry="6" fill="#000000" opacity="0.4"/>
                                        <!-- Front Wheel (left side from viewer, X=18) -->
                                        <ellipse cx="18" cy="46" rx="6" ry="6" fill="#1A202C"/>
                                        <ellipse cx="18" cy="46" rx="3" ry="3" fill="#718096"/>
                                        <!-- Rear Wheel (right side from viewer, X=42) -->
                                        <ellipse cx="42" cy="46" rx="6" ry="6" fill="#1A202C"/>
                                        <ellipse cx="42" cy="46" rx="3" ry="3" fill="#718096"/>
                                        <path d="M12 40 L52 40 L50 44 L14 44 Z" fill="#2D0B11"/>
                                        <path d="M12 36 C12 36, 15 32, 22 32 C29 32, 45 35, 52 38 L52 42 L12 42 Z" fill="url(#carBodyRedDark)"/>
                                        <path d="M12 36 L28 32 L44 32 L52 38 L48 42 L12 42 Z" fill="url(#carBodyRed)"/>
                                        <path d="M20 32 L25 22 L38 22 L45 32 Z" fill="url(#carGlass)"/>
                                        <path d="M22 32 L26 23 L29 23 L25 32 Z" fill="url(#glassShine)"/>
                                        <path d="M32 32 L36 23 L37 23 L33 32 Z" fill="url(#glassShine)"/>
                                        <path d="M25 22 L38 22 C38 22, 36 20, 31 20 C26 20, 25 22, 25 22 Z" fill="#FFA3B1"/>
                                        <circle cx="15" cy="38" r="3" fill="#FFF"/>
                                        <circle cx="15" cy="38" r="8" fill="url(#headlightGlow)"/>
                                        <path d="M48 31 L53 31 L52 33 L47 33 Z" fill="url(#carBodyRedDark)"/>
                                    </svg>
                                </span>
                                <span class="role-label">${I18n.t('role_driver')}</span>
                            </button>
                            <button class="role-option ${selectedRole === 'passenger' ? 'selected' : ''}" data-role="passenger" onclick="LoginModule.selectRole('passenger')">
                                <span class="role-icon">
                                    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                                        <defs>
                                            <linearGradient id="badgeBg" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#1E293B"/>
                                                <stop offset="100%" stop-color="#0F172A"/>
                                            </linearGradient>
                                            <linearGradient id="neonBlue" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#3B82F6"/>
                                                <stop offset="50%" stop-color="#60A5FA"/>
                                                <stop offset="100%" stop-color="#1D4ED8"/>
                                            </linearGradient>
                                            <linearGradient id="avatarGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stop-color="#E2E8F0"/>
                                                <stop offset="100%" stop-color="#94A3B8"/>
                                            </linearGradient>
                                            <linearGradient id="glassOverlay" x1="0%" y1="0%" x2="100%" y2="100%">
                                                <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.15"/>
                                                <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.02"/>
                                            </linearGradient>
                                        </defs>
                                        <ellipse cx="32" cy="52" rx="20" ry="5" fill="#000000" opacity="0.35"/>
                                        <ellipse cx="32" cy="33" rx="22" ry="22" fill="url(#neonBlue)"/>
                                        <ellipse cx="32" cy="34.5" rx="20" ry="20" fill="#0F172A"/>
                                        <ellipse cx="32" cy="32" rx="20" ry="20" fill="url(#badgeBg)"/>
                                        <g>
                                            <path d="M18 48 C18 41, 23 37, 32 37 C41 37, 46 41, 46 48 Z" fill="url(#avatarGrad)"/>
                                            <path d="M18 48 C18 41, 23 37, 32 37 C41 37, 46 41, 46 48 Z" fill="url(#neonBlue)" opacity="0.3"/>
                                            <circle cx="32" cy="28" r="8" fill="url(#avatarGrad)"/>
                                            <circle cx="30" cy="26" r="6" fill="#FFF" opacity="0.2"/>
                                        </g>
                                        <path d="M22 34 L42 28 L46 44 L26 50 Z" fill="url(#glassOverlay)" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="1"/>
                                        <path d="M22 34 L42 28 L32 39 Z" fill="#FFFFFF" opacity="0.08"/>
                                        <circle cx="44" cy="42" r="6" fill="#10B981"/>
                                        <path d="M41 42 L43 44 L47 40" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                                    </svg>
                                </span>
                                <span class="role-label">${I18n.t('role_passenger')}</span>
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

                        <div style="text-align:center; margin-top:var(--space-4); overflow: visible !important; position: relative; z-index: 9999;">
                            <button class="btn btn-block" id="btnRegisterOwner" onclick="LoginModule.showRegister()"
                                style="background:transparent; border:2px solid var(--color-primary); color:var(--color-primary); font-weight:600; margin-bottom:var(--space-3); display: ${(selectedRole === 'owner' || selectedRole === 'titular') ? 'block' : 'none'};">
                                💼 ${I18n.t('register_admin')}
                            </button>
                            <button class="btn btn-secondary block w-full" id="btnApplyDriver" onclick="Router.navigate('apply')"
                                style="margin-top:var(--space-4); padding:var(--space-4); background:rgba(16, 185, 129, 0.1); border:2px solid #10b981; color:#059669; font-weight:700; font-size:1.1rem; border-radius:var(--radius-lg); display: ${selectedRole === 'driver' ? 'flex' : 'none'} !important; justify-content:center; align-items:center; gap:8px; z-index:99999 !important; position:relative; overflow:visible !important; width:100% !important;">
                                🪪 ${I18n.t('app_apply_btn')}
                            </button>
                            <button class="btn btn-secondary block w-full" id="btnRegisterPassenger" onclick="LoginModule.showPassengerRegister()"
                                style="margin-top:var(--space-4); padding:var(--space-4); background:rgba(59, 130, 246, 0.1); border:2px solid #3b82f6; color:#2563eb; font-weight:700; font-size:1.1rem; border-radius:var(--radius-lg); display: ${selectedRole === 'passenger' ? 'flex' : 'none'} !important; justify-content:center; align-items:center; gap:8px; z-index:99999 !important; position:relative; overflow:visible !important; width:100% !important;">
                                🙋 ${I18n.t('register_passenger')}
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

        const btnOwner = document.getElementById('btnRegisterOwner');
        const btnDriver = document.getElementById('btnApplyDriver');
        const btnPassenger = document.getElementById('btnRegisterPassenger');

        if (btnOwner) btnOwner.style.setProperty('display', 'none', 'important');
        if (btnDriver) btnDriver.style.setProperty('display', 'none', 'important');
        if (btnPassenger) btnPassenger.style.setProperty('display', 'none', 'important');

        if (role === 'owner' || role === 'titular') {
            if (btnOwner) btnOwner.style.setProperty('display', 'block', 'important');
        } else if (role === 'driver') {
            if (btnDriver) btnDriver.style.setProperty('display', 'flex', 'important');
        } else if (role === 'passenger') {
            if (btnPassenger) btnPassenger.style.setProperty('display', 'flex', 'important');
        }
    }

    async function doLogin() {
        const name = document.getElementById('loginName').value.trim();
        const pin = document.getElementById('loginPin').value.trim();
        const errorEl = document.getElementById('loginError');
        const loginBtn = document.querySelector('.btn-primary.btn-block.btn-lg');

        if (!name || !pin) {
            errorEl.style.display = 'block';
            errorEl.textContent = I18n.t('login_error');
            return;
        }

        // --- Loading state ---
        errorEl.style.display = 'none';
        if (loginBtn) {
            loginBtn.disabled = true;
            loginBtn._originalText = loginBtn.textContent;
            loginBtn.textContent = '⏳ Conectando al servidor... (puede tardar un minuto)';
            loginBtn.style.opacity = '0.7';
        }

        const MAX_LOGIN_RETRIES = 3;
        let success = false;
        let wasConnectionError = false;

        try {
            for (let loginAttempt = 1; loginAttempt <= MAX_LOGIN_RETRIES; loginAttempt++) {
                try {
                    if (loginBtn && loginAttempt > 1) {
                        loginBtn.textContent = `🔄 Reintentando conexión (${loginAttempt}/${MAX_LOGIN_RETRIES})... esperá un momento`;
                    }

                    success = await Auth.authenticate(name, pin, selectedRole);

                    // If authenticate returned (didn't throw), connection worked
                    wasConnectionError = false;

                    if (success) break;

                    // Not a connection error, genuinely wrong credentials — try migration
                    if (!success && loginAttempt === 1) {
                        const hasGlobal = await DB.hasGlobalUsers();
                        if (!hasGlobal) {
                            const migratedFleetId = await DB.migrateOldData();
                            if (migratedFleetId) {
                                console.log('📦 Datos migrados, reintentando login...');
                                success = await Auth.authenticate(name, pin, selectedRole);
                                if (success) break;
                            }
                        }
                    }

                    // Credentials are wrong, no point retrying
                    break;

                } catch (authErr) {
                    // CONNECTION_FAILED — Firebase couldn't connect
                    if (authErr.code === 'CONNECTION_FAILED' || authErr.message === 'CONNECTION_FAILED') {
                        wasConnectionError = true;
                        console.warn(`🔐 LOGIN: Conexión fallida (intento ${loginAttempt}/${MAX_LOGIN_RETRIES})`);
                        if (loginAttempt < MAX_LOGIN_RETRIES) {
                            if (loginBtn) loginBtn.textContent = `📡 El servidor está despertando... (${loginAttempt + 1}/${MAX_LOGIN_RETRIES})`;
                            await new Promise(r => setTimeout(r, 3000));
                            continue;
                        }
                    } else {
                        throw authErr; // unexpected error — rethrow
                    }
                }
            }

            if (success) {
                errorEl.style.display = 'none';
                App.startRealtimeSync();

                if (typeof SOSModule !== 'undefined') {
                    SOSModule.startListening();
                }

                // NAVEGACIÓN INMEDIATA — no bloqueamos con queries post-login
                Router.navigate(Router.getDefaultRoute());

                // Verificaciones diferidas (fire-and-forget, no bloquean la UI):

                // 1. Perfil incompleto (conductores) — se redirige después si falta
                if (Auth.isDriver()) {
                    Auth.isProfileComplete().then(profileOk => {
                        if (!profileOk) {
                            console.log('🚫 Perfil incompleto — redirigiendo a completar perfil');
                            Router.navigate('complete-profile');
                        }
                    }).catch(e => console.warn('⚠️ Error verificando perfil (no bloquea):', e));
                }

                // 2. Configuración de ubicación (dueños) — se muestra wizard después
                if (Auth.isOwner()) {
                    DB.getSetting('location').then(location => {
                        if (!location || !location.country) {
                            setTimeout(() => SettingsModule.showLocationSetup(), 800);
                        }
                    }).catch(e => console.warn('⚠️ Error verificando ubicación (no bloquea):', e));
                }
            } else if (wasConnectionError) {
                // All retries failed due to connection
                errorEl.style.display = 'block';
                errorEl.innerHTML = '📡 <strong>El servidor está despertando.</strong><br>Esperá unos segundos e intentá de nuevo. (Puede tardar hasta un minuto en la primera conexión)';
                errorEl.style.background = 'rgba(234, 179, 8, 0.15)';
                errorEl.style.borderColor = '#eab308';
                errorEl.style.color = '#ca8a04';
            } else {
                // Genuine wrong credentials
                errorEl.style.display = 'block';
                errorEl.textContent = I18n.t('login_error');
                errorEl.style.background = '';
                errorEl.style.borderColor = '';
                errorEl.style.color = '';
                errorEl.parentElement.style.animation = 'shake 0.4s ease';
                setTimeout(() => errorEl.parentElement.style.animation = '', 400);
            }
        } catch (e) {
            console.error('🔐 Fallo en Login: ', e);

            // --- "Luz de Check Engine": traducir código de error a mensaje claro ---
            const errorCode = e.code || e.message || '';
            let userMessage = '';

            switch (errorCode) {
                case 'auth/network-request-failed':
                    userMessage = '📡 Sin conexión a internet. Revisá tu WiFi o datos móviles.';
                    break;
                case 'auth/wrong-password':
                case 'auth/invalid-credential':
                    userMessage = '🔑 PIN incorrecto. Verificá los datos e intentá de nuevo.';
                    break;
                case 'auth/user-not-found':
                    userMessage = '👤 Usuario no encontrado. Verificá el nombre y el rol.';
                    break;
                case 'auth/too-many-requests':
                    userMessage = '⏳ Demasiados intentos fallidos. Esperá unos minutos antes de reintentar.';
                    break;
                case 'auth/user-disabled':
                    userMessage = '🚫 Esta cuenta fue deshabilitada. Contactá al administrador de la flota.';
                    break;
                case 'CONNECTION_FAILED':
                    userMessage = '📡 No se pudo conectar al servidor. Intentá de nuevo en unos segundos.';
                    break;
                case 'permission-denied':
                case 'PERMISSION_DENIED':
                    userMessage = '🔒 Permiso denegado. Tu cuenta no tiene acceso a esta flota.';
                    break;
                default:
                    userMessage = `❌ Error inesperado: ${e.message || errorCode || 'desconocido'}. Revisá la consola (F12) para más detalles.`;
            }

            // Toast rojo visible
            if (typeof Components !== 'undefined' && Components.showToast) {
                Components.showToast(userMessage, 'danger');
            }

            // También mostrarlo en el div de error inline
            errorEl.style.display = 'block';
            errorEl.textContent = userMessage;
        } finally {
            if (loginBtn) {
                loginBtn.disabled = false;
                loginBtn.textContent = loginBtn._originalText || I18n.t('login_enter');
                loginBtn.style.opacity = '1';
            }
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
            `💼 Registro de Titular Validado por IA`,
            `
                <p style="text-align:center; color:var(--text-secondary); margin-bottom:var(--space-4); font-size:var(--font-size-sm);">
                    Para dar de alta tu flota, necesitamos validar tus datos vehiculares. Solo el titular directo (según Tarjeta Verde) puede registrarse.
                </p>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_name')} (Tal cual figura en la Tarjeta Verde)</label>
                    <input type="text" class="form-input" id="regName"
                        placeholder="Ej: Juan Perez" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label">Patente / Dominio del Vehículo</label>
                    <input type="text" class="form-input" id="regPlate"
                        placeholder="Ej: AE 123 CD" autocomplete="off" style="text-transform: uppercase;">
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
                
                <hr style="border:none; border-top:1px solid rgba(255,255,255,0.1); margin:var(--space-4) 0;">
                <p style="color:var(--text-secondary); font-size:0.85rem; margin-bottom:8px;"><strong>Documentación Obligatoria</strong></p>
                
                <div class="form-group">
                    <label class="form-label">📸 Foto de la Tarjeta Verde</label>
                    <input type="file" id="regTarjetaVerde" accept="image/*" class="form-input" style="padding:10px;">
                </div>
                <div class="form-group">
                    <label class="form-label">📸 Foto de la Póliza de Seguro</label>
                    <input type="file" id="regSeguro" accept="image/*" class="form-input" style="padding:10px;">
                </div>

                <div id="regError" class="form-error" style="text-align:center; margin-bottom:var(--space-2); display:none;"></div>
                <div id="regLoading" style="display:none; text-align:center; margin-bottom:var(--space-3); color:var(--color-primary); font-weight:600; font-size:0.9rem;">
                    🤖 Verificando documentos con IA... (puede tardar unos 10 segundos)
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()" id="btnCancelReg">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="LoginModule.doRegister()" id="btnSubmitReg">${I18n.t('register_btn')}</button>
            `
        );
    }

    // Helper: Comprimir imagen a base64
    function _compressImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 1200;
                    const MAX_HEIGHT = 1200;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.8)); // 80% quality
                };
                img.onerror = reject;
            };
            reader.onerror = reject;
        });
    }

    async function doRegister() {
        const name = document.getElementById('regName')?.value.trim();
        const pin = document.getElementById('regPin')?.value.trim();
        const pinConfirm = document.getElementById('regPinConfirm')?.value.trim();
        const plate = document.getElementById('regPlate')?.value.trim().toUpperCase();
        const fileTv = document.getElementById('regTarjetaVerde')?.files[0];
        const fileSeg = document.getElementById('regSeguro')?.files[0];
        
        const errorEl = document.getElementById('regError');
        const loadingEl = document.getElementById('regLoading');
        const btnCancel = document.getElementById('btnCancelReg');
        const btnSubmit = document.getElementById('btnSubmitReg');

        errorEl.style.display = 'none';

        if (!name || !pin || !plate) {
            errorEl.style.display = 'block';
            errorEl.textContent = '❌ Por favor completá todos los campos de texto.';
            return;
        }

        if (!fileTv || !fileSeg) {
            errorEl.style.display = 'block';
            errorEl.textContent = '❌ Es obligatorio subir ambas fotos (Tarjeta Verde y Seguro).';
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
            // UI Loading state
            loadingEl.style.display = 'block';
            btnCancel.disabled = true;
            btnSubmit.disabled = true;

            // 1. Convertir imágenes a base64 (reducidas)
            const tvBase64 = await _compressImage(fileTv);
            const segBase64 = await _compressImage(fileSeg);

            // 2. Llamar al Backend de IA para validación
            const response = await fetch('/api/auth/verify-documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    plate: plate,
                    tarjetaVerdeBase64: tvBase64,
                    seguroBase64: segBase64
                })
            });

            if (!response.ok) {
                throw new Error('Error en la comunicación con el servidor de IA.');
            }

            const aiResult = await response.json();

            if (!aiResult.ok) {
                // Rechazo por la IA
                errorEl.style.display = 'block';
                const errorMsg = aiResult.errors ? aiResult.errors.join('<br>') : 'Documentos inválidos o no coinciden los datos.';
                errorEl.innerHTML = `🚫 <strong>Validación rechazada:</strong><br>${errorMsg}`;
                loadingEl.style.display = 'none';
                btnCancel.disabled = false;
                btnSubmit.disabled = false;
                return;
            }

            console.log('✅ Validación IA Exitosa:', aiResult.extractedData);
            loadingEl.textContent = '✅ Validación exitosa. Creando flota...';

            // --- FLUJO DE CREACIÓN ---
            
            // 3. Crear un fleetId nuevo para esta flota
            const fleetId = DB.createFleetId();

            // 4. Hash PIN before saving
            let hashedPin = pin;
            try {
                hashedPin = dcodeIO.bcrypt.hashSync(pin, 10);
            } catch (e) {
                console.warn('⚠️ bcrypt no disponible, guardando PIN sin hash:', e);
            }

            // 5. Registrar en globalUsers con su fleetId
            const globalId = await DB.addGlobalUser({
                name,
                pin: hashedPin,
                role: 'titular',
                fleetId
            });

            // 6. Activar la flota nueva
            DB.setFleet(fleetId);

            // 7. Subir fotos a Firebase Storage
            loadingEl.textContent = '☁️ Subiendo documentos al archivo en la nube...';
            const tvUrl = await StorageUtil.uploadImage(tvBase64, `fleets/${fleetId}/documents/tarjeta_verde_${plate}.jpg`);
            const segUrl = await StorageUtil.uploadImage(segBase64, `fleets/${fleetId}/documents/seguro_${plate}.jpg`);

            // 8. Crear el vehículo validado en la flota
            const vehicleId = Date.now().toString();
            await DB.add('vehicles', {
                id: vehicleId,
                name: `${aiResult.extractedData?.tarjetaVerde?.nombre || 'Vehículo'} (${plate})`,
                plate: plate,
                status: 'active',
                currentKm: 0,
                colorKey: 'taxi',
                documents: {
                    tarjetaVerdeUrl: tvUrl || '',
                    seguroUrl: segUrl || '',
                    seguroVencimiento: aiResult.extractedData?.seguro?.vencimiento || '',
                    validatedByAI: true
                }
            });

            // 9. Crear el usuario dentro de la flota
            await DB.add('users', {
                name,
                pin: hashedPin,
                role: 'titular',
                globalId
            });

            Components.closeModal();

            // 10. Auto-login directo (NO usar authenticate para evitar match con entradas viejas)
            Auth.login({
                id: globalId,
                name,
                pin: hashedPin,
                role: 'titular',
                fleetId
            });
            App.startRealtimeSync();
            Router.navigate(Router.getDefaultRoute());
            // Mostrar wizard de ubicación
            setTimeout(() => SettingsModule.showLocationSetup(), 500);

        } catch (e) {
            errorEl.style.display = 'block';
            errorEl.textContent = '❌ ' + (e.message || I18n.t('error'));
            console.error('Error en registro:', e);
        } finally {
            loadingEl.style.display = 'none';
            btnCancel.disabled = false;
            btnSubmit.disabled = false;
        }
    }
    let currentVerificationCode = '';

    function showPassengerRegister() {
        // Generate a dynamic verification code: PAS- followed by 4 random digits
        const codeDigits = Math.floor(1000 + Math.random() * 9000);
        currentVerificationCode = `PAS-${codeDigits}`;

        Components.showModal(
            `🙋 ${I18n.t('register_passenger')}`,
            `
                <p style="text-align:center; color:var(--text-secondary); margin-bottom:var(--space-4); font-size:var(--font-size-sm);">
                    ${I18n.t('register_passenger_subtitle')}
                </p>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_name')} (Tal cual figura en tu DNI)</label>
                    <input type="text" class="form-input" id="passName"
                        placeholder="Ej: Juan Perez" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label">Número de DNI</label>
                    <input type="text" class="form-input" id="passDni"
                        placeholder="Ej: 12345678" autocomplete="off" inputmode="numeric">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('register_passenger_address')}</label>
                    <input type="text" class="form-input" id="passAddress"
                        placeholder="Ej: Av. Siempreviva 742" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('login_pin')} (${I18n.t('login_pin_hint')})</label>
                    <input type="password" class="form-input" id="passPin"
                        placeholder="${I18n.t('login_pin_placeholder')}" maxlength="15" inputmode="numeric">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('register_confirm_pin')}</label>
                    <input type="password" class="form-input" id="passPinConfirm"
                        placeholder="${I18n.t('login_pin_placeholder')}" maxlength="15" inputmode="numeric">
                </div>
                
                <hr style="border:none; border-top:1px solid rgba(255,255,255,0.1); margin:var(--space-4) 0;">
                
                <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-4);">
                    <h4 style="color: #60a5fa; margin-bottom: 4px; font-weight: 600;">${I18n.t('register_passenger_selfie_alert')}</h4>
                    <p style="color: var(--text-secondary); font-size: 0.85rem; line-height: 1.4; margin: 0;">
                        ${I18n.t('register_passenger_selfie_desc')}
                    </p>
                    <div style="text-align: center; margin-top: var(--space-3); margin-bottom: var(--space-2);">
                        <span id="passVerificationCode" style="font-family: monospace; font-size: 1.5rem; font-weight: 700; color: #fff; background: rgba(255,255,255,0.1); padding: var(--space-2) var(--space-4); border-radius: var(--radius-sm); border: 1px dashed rgba(255,255,255,0.3); display: inline-block; letter-spacing: 2px;">
                            ${currentVerificationCode}
                        </span>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">${I18n.t('register_passenger_dni_front')}</label>
                    <input type="file" id="passDniFront" accept="image/*" class="form-input" style="padding:10px;">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('register_passenger_selfie')}</label>
                    <input type="file" id="passSelfie" accept="image/*" class="form-input" style="padding:10px;">
                </div>

                <div id="passError" class="form-error" style="text-align:center; margin-bottom:var(--space-2); display:none;"></div>
                <div id="passLoading" style="display:none; text-align:center; margin-bottom:var(--space-3); color: #60a5fa; font-weight:600; font-size:0.9rem;">
                    🤖 Verificando identidad y selfie con IA... (puede tardar unos 15 segundos)
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()" id="btnCancelPassReg">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="LoginModule.doPassengerRegister()" id="btnSubmitPassReg">${I18n.t('register_btn')}</button>
            `
        );
    }

    async function doPassengerRegister() {
        const name = document.getElementById('passName')?.value.trim();
        const dni = document.getElementById('passDni')?.value.trim();
        const address = document.getElementById('passAddress')?.value.trim();
        const pin = document.getElementById('passPin')?.value.trim();
        const pinConfirm = document.getElementById('passPinConfirm')?.value.trim();
        const fileDni = document.getElementById('passDniFront')?.files[0];
        const fileSelfie = document.getElementById('passSelfie')?.files[0];
        
        const errorEl = document.getElementById('passError');
        const loadingEl = document.getElementById('passLoading');
        const btnCancel = document.getElementById('btnCancelPassReg');
        const btnSubmit = document.getElementById('btnSubmitPassReg');

        if (errorEl) errorEl.style.display = 'none';

        if (!name || !dni || !address || !pin || !pinConfirm) {
            if (errorEl) {
                errorEl.style.display = 'block';
                errorEl.textContent = '❌ Por favor completá todos los campos de texto.';
            }
            return;
        }

        if (!fileDni || !fileSelfie) {
            if (errorEl) {
                errorEl.style.display = 'block';
                errorEl.textContent = '❌ Es obligatorio subir ambas fotos (DNI frente y Selfie).';
            }
            return;
        }

        if (pin.length < 4) {
            if (errorEl) {
                errorEl.style.display = 'block';
                errorEl.textContent = I18n.t('register_pin_min');
            }
            return;
        }

        if (pin !== pinConfirm) {
            if (errorEl) {
                errorEl.style.display = 'block';
                errorEl.textContent = I18n.t('register_pin_mismatch');
            }
            return;
        }

        try {
            // UI Loading state
            if (loadingEl) loadingEl.style.display = 'block';
            if (btnCancel) btnCancel.disabled = true;
            if (btnSubmit) btnSubmit.disabled = true;

            // 1. Convertir imágenes a base64 (reducidas)
            const dniBase64 = await _compressImage(fileDni);
            const selfieBase64 = await _compressImage(fileSelfie);

            // 2. Llamar al Backend de IA para validación de pasajero
            const response = await fetch('/api/auth/verify-passenger', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name,
                    dni: dni,
                    address: address,
                    dniFrontBase64: dniBase64,
                    selfieBase64: selfieBase64,
                    code: currentVerificationCode
                })
            });

            if (!response.ok) {
                throw new Error('Error en la comunicación con el servidor de IA.');
            }

            const aiResult = await response.json();

            if (!aiResult.ok) {
                // Rechazo por la IA
                if (errorEl) {
                    errorEl.style.display = 'block';
                    const errorMsg = aiResult.errors ? aiResult.errors.join('<br>') : 'Documento o Selfie inválidos.';
                    errorEl.innerHTML = `🚫 <strong>Validación rechazada:</strong><br>${errorMsg}`;
                }
                if (loadingEl) loadingEl.style.display = 'none';
                if (btnCancel) btnCancel.disabled = false;
                if (btnSubmit) btnSubmit.disabled = false;
                return;
            }

            console.log('✅ Validación Pasajero IA Exitosa:', aiResult.extractedData);
            if (loadingEl) loadingEl.textContent = '✅ Validación exitosa. Registrando usuario...';

            // --- FLUJO DE REGISTRO ---
            
            // 3. Resolve active fleetId (default to 'jose07' if not set)
            const fleetId = DB.getFleet() || 'jose07';

            // 4. Hash PIN before saving
            let hashedPin = pin;
            try {
                hashedPin = dcodeIO.bcrypt.hashSync(pin, 10);
            } catch (e) {
                console.warn('⚠️ bcrypt no disponible, guardando PIN sin hash:', e);
            }

            // 5. Registrar en globalUsers con su fleetId
            const globalId = await DB.addGlobalUser({
                name,
                pin: hashedPin,
                role: 'passenger',
                fleetId
            });

            // 6. Activar la flota
            DB.setFleet(fleetId);

            // 7. Crear el usuario dentro de la flota
            await DB.add('users', {
                name,
                pin: hashedPin,
                role: 'passenger',
                globalId,
                dni,
                address,
                verifiedByAI: true
            });

            Components.closeModal();

            // 8. Auto-login directo
            Auth.login({
                id: globalId,
                name,
                pin: hashedPin,
                role: 'passenger',
                fleetId
            });
            App.startRealtimeSync();
            Router.navigate(Router.getDefaultRoute());

        } catch (e) {
            if (errorEl) {
                errorEl.style.display = 'block';
                errorEl.textContent = '❌ ' + (e.message || I18n.t('error'));
            }
            console.error('Error en registro de pasajero:', e);
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
            if (btnCancel) btnCancel.disabled = false;
            if (btnSubmit) btnSubmit.disabled = false;
        }
    }

    return { render, selectRole, doLogin, togglePin, showRegister, doRegister, showPassengerRegister, doPassengerRegister };
})();
