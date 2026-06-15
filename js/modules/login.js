/* ============================================
   FleetAdmin Pro — Módulo de Login
   Pantalla de inicio de sesión con selección de rol
   Registro de nuevos administradores con flota propia
   ============================================ */

const LoginModule = (() => {
    let selectedRole = 'owner';
    let _loginWakeLock = null;
    let _audioUnlocked = false;

    const REMEMBER_KEY = 'fleetadmin_remember_credentials';

    function _loadRemembered() {
        try {
            const saved = localStorage.getItem(REMEMBER_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch(e) { return null; }
    }

    function _saveRemembered(name, pin, role) {
        try {
            localStorage.setItem(REMEMBER_KEY, JSON.stringify({ name, pin, role, savedAt: Date.now() }));
        } catch(e) { /* quota */ }
    }

    function _clearRemembered() {
        localStorage.removeItem(REMEMBER_KEY);
    }

    function render() {
        // Precargar rol recordado si existe
        const remembered = _loadRemembered();
        if (remembered && remembered.role) {
            selectedRole = remembered.role;
        }
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
                                    <img src="assets/admin.png" style="width: 100%; height: 100%; object-fit: contain; border-radius: var(--radius-md);" alt="Admin">
                                </span>
                                <span class="role-label">${I18n.t('role_owner')}</span>
                            </button>
                            <button class="role-option ${selectedRole === 'titular' ? 'selected' : ''}" data-role="titular" onclick="LoginModule.selectRole('titular')">
                                <span class="role-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" fill="currentColor" fill-opacity="0.08"/>
                                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                                    </svg>
                                </span>
                                <span class="role-label">${I18n.t('role_titular')}</span>
                            </button>
                            <button class="role-option ${selectedRole === 'mechanic' ? 'selected' : ''}" data-role="mechanic" onclick="LoginModule.selectRole('mechanic')">
                                <span class="role-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" fill="currentColor" fill-opacity="0.08"/>
                                    </svg>
                                </span>
                                <span class="role-label">${I18n.t('role_mechanic')}</span>
                            </button>
                            <button class="role-option ${selectedRole === 'driver' ? 'selected' : ''}" data-role="driver" onclick="LoginModule.selectRole('driver')">
                                <span class="role-icon">
                                    <img src="assets/auto-conductor2.png" style="width: 100%; height: 100%; object-fit: contain; border-radius: var(--radius-md);" alt="Driver">
                                </span>
                                <span class="role-label">${I18n.t('role_driver')}</span>
                            </button>
                            <button class="role-option ${selectedRole === 'passenger' ? 'selected' : ''}" data-role="passenger" onclick="LoginModule.selectRole('passenger')">
                                <span class="role-icon">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" fill="currentColor" fill-opacity="0.08"/>
                                        <circle cx="12" cy="7" r="4"/>
                                    </svg>
                                </span>
                                <span class="role-label">${I18n.t('role_passenger')}</span>
                            </button>
                        </div>

                        <form id="loginForm" onsubmit="event.preventDefault(); LoginModule.doLogin();" autocomplete="on">

                        <div class="form-group">
                            <label class="form-label">${I18n.t('login_name')}</label>
                            <input type="text" class="form-input" id="loginName"
                                name="username"
                                placeholder="${I18n.t('login_name_placeholder')}" autocomplete="username"
                                value="${_loadRemembered()?.name || ''}">
                        </div>

                        <div class="form-group">
                            <label class="form-label">${I18n.t('login_pin')} (${I18n.t('login_pin_hint')})</label>
                            <div style="position:relative;">
                                <input type="password" class="form-input" id="loginPin"
                                    name="password"
                                    placeholder="${I18n.t('login_pin_placeholder')}" maxlength="15" inputmode="numeric"
                                    autocomplete="current-password"
                                    value="${_loadRemembered()?.pin || ''}"
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

                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:var(--space-4);">
                            <input type="checkbox" id="rememberMe" style="width:18px; height:18px; accent-color:var(--color-primary); cursor:pointer;"
                                ${_loadRemembered() ? 'checked' : ''}>
                            <label for="rememberMe" style="color:var(--text-secondary); font-size:0.9rem; cursor:pointer; user-select:none;">Recordar mis datos</label>
                        </div>

                        <button type="submit" class="btn btn-primary btn-block btn-lg">
                            ${I18n.t('login_enter')}
                        </button>

                        </form>

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

                    <!-- Live Alerts Monitor Widget -->
                    <div id="liveAlertsWidget"></div>

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

                // Liberar WakeLock de login y remover listeners
                _releaseLoginWakeLock();
                document.removeEventListener('visibilitychange', _handleVisibilityChange);

                // Guardar credenciales si el usuario marcó "Recordar mis datos"
                const rememberCb = document.getElementById('rememberMe');
                if (rememberCb && rememberCb.checked) {
                    _saveRemembered(name, pin, selectedRole);
                } else {
                    _clearRemembered();
                }

                App.startRealtimeSync();

                if (typeof SOSModule !== 'undefined') {
                    SOSModule.startListening();
                }

                // NAVEGACIÓN INMEDIATA — no bloqueamos con queries post-login
                Router.navigate(Router.getDefaultRoute());

                // Registrar/actualizar estado de instalación
                const currentUserId = Auth.getUserId();
                const currentUser = Auth.getUser();
                if (currentUserId && currentUser && typeof App !== 'undefined' && App.trackAppInstallation) {
                    App.trackAppInstallation(currentUserId, currentUser);
                }

                // Reportar versión del chofer al backend
                if (typeof App !== 'undefined' && App.reportAppVersionToServer) {
                    App.reportAppVersionToServer();
                }

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

    async function _acquireLoginWakeLock() {
        if (_loginWakeLock) return;
        if ('wakeLock' in navigator) {
            try {
                _loginWakeLock = await navigator.wakeLock.request('screen');
                console.log('🛡️ Login: Screen Wake Lock adquirido.');
                _loginWakeLock.addEventListener('release', () => {
                    _loginWakeLock = null;
                });
            } catch (err) {
                console.warn('🛡️ Login: No se pudo adquirir Wake Lock:', err.message);
            }
        }
    }

    function _releaseLoginWakeLock() {
        if (_loginWakeLock) {
            try {
                _loginWakeLock.release();
                console.log('🛡️ Login: Screen Wake Lock liberado.');
            } catch (e) {}
            _loginWakeLock = null;
        }
    }

    function _handleVisibilityChange() {
        if (document.visibilityState === 'visible' && !_loginWakeLock && Router.getCurrentRoute() === 'login') {
            _acquireLoginWakeLock();
        }
    }

    async function init() {
        console.log('📡 LoginModule: Inicializando...');
        
        // 1. Inyectar estilos CSS
        if (!document.getElementById('live-alerts-styles')) {
            const style = document.createElement('style');
            style.id = 'live-alerts-styles';
            style.textContent = `
                .live-alerts-card {
                    background: rgba(15, 23, 42, 0.45);
                    backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px);
                    border: 1px solid rgba(129, 140, 248, 0.15);
                    border-radius: var(--radius-xl);
                    padding: var(--space-4);
                    margin-top: var(--space-6);
                    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                }
                .live-alerts-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: var(--space-3);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                    padding-bottom: var(--space-2);
                }
                .live-alerts-title {
                    font-weight: 700;
                    font-size: 0.9rem;
                    color: #e0e7ff;
                    display: flex;
                    align-items: center;
                    gap: var(--space-2);
                }
                .status-indicator {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 0.75rem;
                    color: var(--text-secondary);
                }
                .status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #f59e0b;
                    box-shadow: 0 0 8px #f59e0b;
                    display: inline-block;
                }
                .status-dot.active {
                    animation: statusPulse 1.8s infinite;
                }
                @keyframes statusPulse {
                    0%, 100% { transform: scale(0.95); opacity: 0.5; }
                    50% { transform: scale(1.1); opacity: 1; }
                }
                .audio-unlock-btn {
                    width: 100%;
                    background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(129, 140, 248, 0.2));
                    border: 1px dashed rgba(129, 140, 248, 0.4);
                    color: #a5b4fc;
                    padding: var(--space-3);
                    border-radius: var(--radius-lg);
                    font-size: 0.85rem;
                    font-weight: 700;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    margin-bottom: var(--space-3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: var(--space-2);
                }
                .audio-unlock-btn:hover {
                    background: linear-gradient(135deg, rgba(99, 102, 241, 0.35), rgba(129, 140, 248, 0.35));
                    border-color: #818cf8;
                    color: #e0e7ff;
                    transform: translateY(-1px);
                }
                .audio-unlock-btn.unlocked {
                    background: rgba(16, 185, 129, 0.1);
                    border: 1px solid rgba(16, 185, 129, 0.3);
                    color: #34d399;
                    cursor: default;
                    transform: none;
                }
                .live-alerts-list {
                    display: flex;
                    flex-direction: column;
                    gap: var(--space-2);
                    max-height: 180px;
                    overflow-y: auto;
                }
                .live-alerts-empty {
                    text-align: center;
                    font-size: 0.8rem;
                    color: var(--text-tertiary);
                    padding: var(--space-3) 0;
                }
                .live-alert-item {
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    border-radius: var(--radius-md);
                    padding: var(--space-2) var(--space-3);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: var(--space-2);
                    animation: slideInLeft 0.3s ease;
                }
                .live-alert-info {
                    flex: 1;
                    min-width: 0;
                }
                .live-alert-loc {
                    font-size: 0.8rem;
                    font-weight: 600;
                    color: #f1f5f9;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .live-alert-time {
                    font-size: 0.7rem;
                    color: var(--text-tertiary);
                    margin-top: 2px;
                }
                .live-alert-badge {
                    font-size: 0.7rem;
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 4px;
                    text-transform: uppercase;
                    white-space: nowrap;
                }
                .badge-police { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
                .badge-checkpoint { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
                .badge-radar { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
                .badge-warning { background: rgba(107, 114, 128, 0.15); color: #9ca3af; border: 1px solid rgba(107, 114, 128, 0.3); }
            `;
            document.head.appendChild(style);
        }

        // 2. Renderizar esqueleto de widget
        const container = document.getElementById('liveAlertsWidget');
        if (!container) return;

        _audioUnlocked = localStorage.getItem('login_audio_unlocked') === 'true';

        container.innerHTML = `
            <div class="live-alerts-card">
                <div class="live-alerts-header">
                    <span class="live-alerts-title">📡 Copiloto en Vivo</span>
                    <span class="status-indicator">
                        <span id="liveAlertsStatusDot" class="status-dot active"></span>
                        <span id="liveAlertsStatusText">Conectando...</span>
                    </span>
                </div>
                <button id="liveAlertsAudioBtn" class="audio-unlock-btn \${_audioUnlocked ? 'unlocked' : ''}" onclick="LoginModule.unlockAudio()">
                    \${_audioUnlocked ? '✅ Sonido Habilitado' : '🔊 Habilitar Sonido y Pantalla'}
                </button>
                <div id="liveAlertsList" class="live-alerts-list">
                    <div class="live-alerts-empty">Cargando alertas en vivo...</div>
                </div>
            </div>
        `;

        // Adquirir WakeLock si ya estaba desbloqueado
        if (_audioUnlocked) {
            _acquireLoginWakeLock();
        }

        // 3. Sincronizar estado de conexión de Firebase
        if (typeof firebase !== 'undefined') {
            const connRef = firebase.database().ref('.info/connected');
            connRef.on('value', (snap) => {
                const statusDot = document.getElementById('liveAlertsStatusDot');
                const statusText = document.getElementById('liveAlertsStatusText');
                if (statusDot && statusText) {
                    if (snap.val() === true) {
                        statusDot.style.background = '#10b981';
                        statusDot.style.boxShadow = '0 0 8px #10b981';
                        statusText.textContent = 'En vivo';
                    } else {
                        statusDot.style.background = '#f59e0b';
                        statusDot.style.boxShadow = '0 0 8px #f59e0b';
                        statusText.textContent = 'Conectando...';
                    }
                }
            });
        }

        // 4. Cargar alertas históricas
        if (typeof TrafficAlerts !== 'undefined') {
            try {
                const recent = await TrafficAlerts.getLastAlerts(3);
                _renderAlerts(recent);

                // 5. Suscribirse a nuevas alertas en tiempo real
                TrafficAlerts.onNewAlert((newAlert) => {
                    _addNewAlert(newAlert);
                });
            } catch (err) {
                console.warn('Error cargando alertas en login:', err);
            }
        }

        // 6. Configurar Wake Lock y eventos de visibilidad
        document.addEventListener('visibilitychange', _handleVisibilityChange);
    }

    function _renderAlerts(alertsList) {
        const listContainer = document.getElementById('liveAlertsList');
        if (!listContainer) return;

        if (!alertsList || alertsList.length === 0) {
            listContainer.innerHTML = `<div class="live-alerts-empty">Sin alertas recientes.</div>`;
            return;
        }

        listContainer.innerHTML = '';
        alertsList.forEach(alert => {
            listContainer.appendChild(_createAlertDOM(alert));
        });
    }

    function _addNewAlert(alert) {
        const listContainer = document.getElementById('liveAlertsList');
        if (!listContainer) return;

        const emptyMsg = listContainer.querySelector('.live-alerts-empty');
        if (emptyMsg) emptyMsg.remove();

        const itemDOM = _createAlertDOM(alert);
        listContainer.insertBefore(itemDOM, listContainer.firstChild);

        // Limitar a máximo 5 elementos para evitar sobrecarga en la pantalla
        while (listContainer.children.length > 5) {
            listContainer.lastChild.remove();
        }
    }

    function _createAlertDOM(alert) {
        const div = document.createElement('div');
        div.className = 'live-alert-item';
        
        const typeLabels = {
            police: '👮 Policía',
            checkpoint: '🚧 Control',
            radar: '📷 Radar',
            warning: '⚠️ Tránsito',
            accident: '💥 Accidente',
            traffic: '🚗 Lento'
        };
        const label = typeLabels[alert.type] || '⚠️ Alerta';
        
        const date = alert.timestamp ? new Date(alert.timestamp) : new Date();
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        div.innerHTML = `
            <div class="live-alert-info">
                <div class="live-alert-loc">\${alert.location || 'Ubicación desconocida'}</div>
                <div class="live-alert-time">\${timeStr}</div>
            </div>
            <span class="live-alert-badge badge-\${alert.type || 'warning'}">\${label}</span>
        `;
        return div;
    }

    async function unlockAudio() {
        if (_audioUnlocked) return;

        _audioUnlocked = true;
        localStorage.setItem('login_audio_unlocked', 'true');

        const btn = document.getElementById('liveAlertsAudioBtn');
        if (btn) {
            btn.className = 'audio-unlock-btn unlocked';
            btn.innerHTML = '✅ Sonido Habilitado';
        }

        // Adquirir Wake Lock
        _acquireLoginWakeLock();

        // Hablar para desbloquear Autoplay en el browser
        if (typeof KittVoice !== 'undefined') {
            KittVoice.speak("Copiloto activo. Recibiendo alertas de tránsito en tiempo real.", true);
        } else if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance("Copiloto activo");
            utter.lang = 'es-AR';
            window.speechSynthesis.speak(utter);
        }
    }

    return { render, selectRole, doLogin, togglePin, showRegister, doRegister, showPassengerRegister, doPassengerRegister, init, unlockAudio };
})();
