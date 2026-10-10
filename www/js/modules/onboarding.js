/* ============================================
   Punto Alertas — Módulo de Identificación y Bienvenida
   Permite a cualquier usuario nuevo registrar su Nombre,
   Teléfono y Correo para personalizar las alertas por voz
   y ser identificado en la red vial sin necesidad de turno activo.
   ============================================ */

const UserOnboarding = (() => {
    const PROFILE_KEY = 'fa_user_profile';

    /**
     * Obtiene el perfil del usuario guardado en el dispositivo.
     */
    function getProfile() {
        try {
            const raw = localStorage.getItem(PROFILE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Verifica si el perfil está completo (nombre, teléfono y correo válidos).
     */
    function isProfileComplete() {
        const p = getProfile();
        if (p) {
            const validName = typeof p.name === 'string' && p.name.trim().length >= 2;
            const validPhone = typeof p.phone === 'string' && p.phone.replace(/[^0-9]/g, '').length >= 6;
            const validEmail = typeof p.email === 'string' && p.email.includes('@') && p.email.includes('.');
            if (validName && validPhone && validEmail) return true;
        }
        // Si el usuario ya está autenticado con sesión activa en la app, auto-completar perfil
        try {
            const currentUser = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
            if (currentUser && currentUser.name && currentUser.name !== 'Chofer' && currentUser.name !== 'Usuario Desconocido') {
                saveProfile(
                    currentUser.name,
                    currentUser.phone || currentUser.whatsapp || '3410000000',
                    currentUser.email || `${currentUser.username || 'usuario'}@fleetadmin.com`
                );
                return true;
            }
        } catch (e) {}
        return false;
    }

    /**
     * Obtiene el primer nombre para locución de alertas.
     */
    function getUserFirstName() {
        try {
            const currentUser = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
            if (currentUser && currentUser.name && currentUser.name !== 'Chofer' && currentUser.name !== 'Usuario Desconocido') {
                return _cleanFirstName(currentUser.name);
            }
            const p = getProfile();
            if (p && p.name) {
                return _cleanFirstName(p.name);
            }
        } catch (e) {}
        return '';
    }

    function _cleanFirstName(fullName) {
        if (!fullName) return '';
        const first = fullName.trim().split(/\s+/)[0];
        return first.charAt(0).toUpperCase() + first.slice(1);
    }

    /**
     * Guarda el perfil en el dispositivo, en el servicio nativo y en Firebase.
     */
    function saveProfile(name, phone, email) {
        const cleanName = name.trim();
        const cleanPhone = phone.trim();
        const cleanEmail = email.trim().toLowerCase();

        const profileData = {
            name: cleanName,
            phone: cleanPhone,
            email: cleanEmail,
            registeredAt: Date.now()
        };

        // 1. Guardar en localStorage del dispositivo
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profileData));

        // 2. Pre-llenar nombre de login para flotas
        try {
            const loginInput = document.getElementById('loginName');
            if (loginInput && !loginInput.value) {
                loginInput.value = cleanName;
            }
        } catch (e) {}

        // 3. Notificar al servicio nativo de Android
        try {
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setDriverName === 'function') {
                AndroidServices.setDriverName(cleanName);
            }
            if (window.NativeServiceBridge && typeof window.NativeServiceBridge.setDriverName === 'function') {
                window.NativeServiceBridge.setDriverName(cleanName);
            }
        } catch (e) {
            console.warn('⚠️ No se pudo enviar el nombre al servicio nativo:', e);
        }

        // 4. Guardar en nodo global de Firebase (community_users)
        try {
            const db = (typeof firebase !== 'undefined' && firebase.database) ? firebase.database() : null;
            if (db) {
                const phoneKey = cleanPhone.replace(/[^0-9]/g, '') || `user_${Date.now()}`;
                db.ref(`community_users/${phoneKey}`).update({
                    name: cleanName,
                    phone: cleanPhone,
                    email: cleanEmail,
                    updatedAt: Date.now(),
                    platform: (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) ? 'android_native' : 'web_pwa'
                }).catch(() => {});
            }
        } catch (e) {
            console.warn('⚠️ No se pudo sincronizar usuario comunitario con Firebase:', e);
        }

        console.log('✅ [ONBOARDING] Perfil guardado con éxito:', cleanName);
        return profileData;
    }

    /**
     * Muestra la pantalla o modal de bienvenida para pedir Nombre, Teléfono y Correo.
     * @param {boolean} force - Si es true, muestra el modal aunque ya esté completo (para editar).
     */
    function showModal(force = false) {
        if (!force && isProfileComplete()) {
            return;
        }

        const existing = getProfile() || {};
        const currentName = existing.name || '';
        const currentPhone = existing.phone || '';
        const currentEmail = existing.email || '';

        const modalId = 'onboardingModal_' + Date.now();

        const bodyHTML = `
            <div style="text-align: center; padding: 4px 8px 12px 8px;">
                <div style="width: 64px; height: 64px; margin: 0 auto 16px auto; background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(16, 185, 129, 0.2)); border: 2px solid rgba(99, 102, 241, 0.4); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 30px; box-shadow: 0 0 20px rgba(99, 102, 241, 0.25);">
                    🚗
                </div>

                <h3 style="margin: 0 0 6px 0; font-size: 1.35rem; font-weight: 800; color: #f8fafc; font-family: var(--font-family, sans-serif);">
                    ¡Bienvenido a Punto Alertas!
                </h3>
                <p style="margin: 0 0 20px 0; font-size: 0.88rem; color: #94a3b8; line-height: 1.45;">
                    Completá tus datos para que el copiloto te reconozca, <b>te llame por tu nombre</b> antes de cada alerta vial y proteja tus viajes.
                </p>

                <div style="text-align: left; display: flex; flex-direction: column; gap: 14px;">
                    <div>
                        <label style="display: block; font-size: 0.82rem; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">
                            👤 Nombre y Apellido <span style="color:#ef4444;">*</span>
                        </label>
                        <input type="text" id="obName" class="form-input" placeholder="Ej: Jose Castro" value="${currentName}" 
                            style="width: 100%; box-sizing: border-box; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 10px; color: #fff; padding: 12px 14px; font-size: 0.95rem;" autofocus>
                    </div>

                    <div>
                        <label style="display: block; font-size: 0.82rem; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">
                            📱 Teléfono / WhatsApp <span style="color:#ef4444;">*</span>
                        </label>
                        <input type="tel" id="obPhone" class="form-input" placeholder="Ej: 341 612 3456" value="${currentPhone}" 
                            style="width: 100%; box-sizing: border-box; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 10px; color: #fff; padding: 12px 14px; font-size: 0.95rem;">
                    </div>

                    <div>
                        <label style="display: block; font-size: 0.82rem; font-weight: 700; color: #cbd5e1; margin-bottom: 6px;">
                            ✉️ Correo Electrónico <span style="color:#ef4444;">*</span>
                        </label>
                        <input type="email" id="obEmail" class="form-input" placeholder="Ej: jose@gmail.com" value="${currentEmail}" 
                            style="width: 100%; box-sizing: border-box; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(148, 163, 184, 0.25); border-radius: 10px; color: #fff; padding: 12px 14px; font-size: 0.95rem;">
                    </div>
                </div>

                <div id="obError" style="display: none; margin-top: 14px; padding: 8px 12px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; font-size: 0.84rem; border-radius: 8px; text-align: center;">
                </div>

                <button type="button" id="obSubmitBtn" onclick="UserOnboarding.submitForm()" 
                    style="margin-top: 20px; width: 100%; padding: 14px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; border-radius: 12px; color: #ffffff; font-size: 1.05rem; font-weight: 800; cursor: pointer; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.35); transition: transform 0.15s ease;">
                    🚀 Comenzar a usar la App
                </button>
            </div>
        `;

        if (typeof Components !== 'undefined' && typeof Components.showModal === 'function') {
            Components.showModal('Identificación de Usuario', bodyHTML, '', { staticBackdrop: !force });
        }
    }

    function submitForm() {
        const nameInput = document.getElementById('obName');
        const phoneInput = document.getElementById('obPhone');
        const emailInput = document.getElementById('obEmail');
        const errEl = document.getElementById('obError');

        if (!nameInput || !phoneInput || !emailInput) return;

        const name = nameInput.value.trim();
        const phone = phoneInput.value.trim();
        const email = emailInput.value.trim();

        const showError = (msg) => {
            if (errEl) {
                errEl.style.display = 'block';
                errEl.innerText = msg;
            }
        };

        if (name.length < 2) {
            showError('Por favor ingresá tu nombre y apellido.');
            nameInput.focus();
            return;
        }

        const digits = phone.replace(/[^0-9]/g, '');
        if (digits.length < 6) {
            showError('Por favor ingresá un número de teléfono válido.');
            phoneInput.focus();
            return;
        }

        if (!email.includes('@') || !email.includes('.')) {
            showError('Por favor ingresá un correo electrónico válido.');
            emailInput.focus();
            return;
        }

        if (errEl) errEl.style.display = 'none';

        // Guardar perfil
        const saved = saveProfile(name, phone, email);

        if (typeof Components !== 'undefined' && typeof Components.closeModal === 'function') {
            Components.closeModal();
        }

        if (typeof Components !== 'undefined' && typeof Components.showToast === 'function') {
            Components.showToast(`¡Bienvenido, ${name}! Tu copiloto de alertas viales está activo.`, 'success');
        }

        // Saludo por voz usando el primer nombre
        const firstName = _cleanFirstName(name);
        const greeting = `Hola ${firstName}, bienvenido a Punto Alertas. Tu protección vial está lista.`;
        if (typeof KittVoice !== 'undefined' && typeof KittVoice.speak === 'function') {
            KittVoice.speak(greeting);
        } else if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
            AndroidServices.speak(greeting);
        }
    }

    return {
        getProfile,
        isProfileComplete,
        getUserFirstName,
        saveProfile,
        showModal,
        submitForm
    };
})();

// Soporte global
window.UserOnboarding = UserOnboarding;
