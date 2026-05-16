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
                            <img src="assets/logo-3d.png" style="width:100%; height:100%; object-fit:contain; filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4));" alt="Logo">
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
                            <button class="role-option selected" data-role="owner" onclick="LoginModule.selectRole('owner')">
                                <span class="role-icon">👑</span>
                                <span class="role-label">${I18n.t('role_owner')}</span>
                            </button>
                            <button class="role-option" data-role="titular" onclick="LoginModule.selectRole('titular')">
                                <span class="role-icon">💼</span>
                                <span class="role-label">${I18n.t('role_titular')}</span>
                            </button>
                            <button class="role-option" data-role="mechanic" onclick="LoginModule.selectRole('mechanic')">
                                <span class="role-icon">🔧</span>
                                <span class="role-label">${I18n.t('role_mechanic')}</span>
                            </button>
                            <button class="role-option" data-role="driver" onclick="LoginModule.selectRole('driver')">
                                <span class="role-icon">🚗</span>
                                <span class="role-label">${I18n.t('role_driver')}</span>
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
                            <button class="btn btn-block" onclick="LoginModule.showRegister()"
                                style="background:transparent; border:2px solid var(--color-primary); color:var(--color-primary); font-weight:600; margin-bottom:var(--space-3);">
                                💼 ${I18n.t('register_admin')}
                            </button>
                            <button class="btn btn-secondary block w-full" onclick="Router.navigate('apply')"
                                style="margin-top:var(--space-4); padding:var(--space-4); background:rgba(16, 185, 129, 0.1); border:2px solid #10b981; color:#059669; font-weight:700; font-size:1.1rem; border-radius:var(--radius-lg); display:flex !important; justify-content:center; align-items:center; gap:8px; z-index:99999 !important; position:relative; overflow:visible !important; width:100% !important;">
                                🪪 ${I18n.t('app_apply_btn')}
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
    return { render, selectRole, doLogin, togglePin, showRegister, doRegister };
})();
