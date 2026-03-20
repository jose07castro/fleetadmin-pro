/* ============================================
   FleetAdmin Pro — Módulo SOS
   Botón de emergencia con GPS tracker + fallback
   Alertas en tiempo real vía Firebase
   v48 — Radar 30km geoespacial + alarma sonora
   ============================================ */

const SOSModule = (() => {

    // Emergency type options
    const EMERGENCY_TYPES = [
        { key: 'robbery',   icon: '🔫', label: 'Robo / Asalto' },
        { key: 'accident',  icon: '💥', label: 'Accidente' },
        { key: 'breakdown', icon: '🔧', label: 'Avería Mecánica' },
        { key: 'medical',   icon: '🏥', label: 'Emergencia Médica' },
        { key: 'other',     icon: '⚠️', label: 'Otra Emergencia' }
    ];

    let _currentAlertId = null;
    let _sosListenerRef = null;
    let _positionWatchId = null;
    let _positionInterval = null;
    let _myLastPosition = null; // { lat, lng }
    let _isSendingSOS = false; // Guard: previene que el listener sobreescriba el modal de tipo

    // =============================================
    // ALARMA SONORA (loop hasta que el dueño reaccione)
    // =============================================
    let _sosAlarm = null;
    let _audioUnlocked = localStorage.getItem('fleetadmin_audio_unlocked') === 'true';
    let _fallbackOscillator = null;
    let _fallbackAudioCtx = null;
    let _vibrationInterval = null;

    // --- Audio Unlock Hack (cross-browser) ---
    // Los navegadores bloquean autoplay hasta que el usuario interactúa.
    // Este hack hace play+pause silencioso en el primer toque para desbloquear.
    let _unlockListenersAdded = false;

    function _unlockHandler() {
        if (_audioUnlocked) {
            _removeUnlockListeners();
            return;
        }

        _initAlarm();
        if (!_sosAlarm) return;

        _sosAlarm.volume = 0;
        const p = _sosAlarm.play();
        if (p !== undefined) {
            p.then(() => {
                _sosAlarm.pause();
                _sosAlarm.currentTime = 0;
                _sosAlarm.volume = 1.0;
                _audioUnlocked = true;
                localStorage.setItem('fleetadmin_audio_unlocked', 'true');
                _removeUnlockListeners();
                _updateAudioBanner();
                console.log('🚨 SOS ALARM: ✅ Audio desbloqueado por interacción del usuario');
            }).catch(() => {
                _sosAlarm.volume = 1.0;
                console.warn('🚨 SOS ALARM: Unlock falló, se reintentará en próxima interacción');
            });
        }
    }

    function _removeUnlockListeners() {
        document.removeEventListener('click', _unlockHandler, true);
        document.removeEventListener('touchstart', _unlockHandler, true);
        document.removeEventListener('touchend', _unlockHandler, true);
        document.removeEventListener('keydown', _unlockHandler, true);
        _unlockListenersAdded = false;
    }

    function _setupAudioUnlock() {
        // Siempre registrar listeners: el AudioContext del navegador se resetea en cada recarga
        // _audioUnlocked de localStorage solo controla la visibilidad del banner
        if (_unlockListenersAdded) return;
        document.addEventListener('click', _unlockHandler, true);
        document.addEventListener('touchstart', _unlockHandler, true);
        document.addEventListener('touchend', _unlockHandler, true);
        document.addEventListener('keydown', _unlockHandler, true);
        _unlockListenersAdded = true;
        console.log('🚨 SOS ALARM: Listeners de unlock registrados (click/touch/keydown)');
    }

    // Desbloqueo manual exportable (para botón visible)
    function _manualUnlockAudio() {
        _initAlarm();
        if (!_sosAlarm) {
            console.warn('🚨 SOS ALARM: No se pudo inicializar audio para unlock manual');
            return;
        }
        _sosAlarm.volume = 0;
        const p = _sosAlarm.play();
        if (p !== undefined) {
            p.then(() => {
                _sosAlarm.pause();
                _sosAlarm.currentTime = 0;
                _sosAlarm.volume = 1.0;
                _audioUnlocked = true;
                localStorage.setItem('fleetadmin_audio_unlocked', 'true');
                _removeUnlockListeners();
                _updateAudioBanner();
                Components.showToast('🔊 Alertas sonoras activadas correctamente', 'success');
                console.log('🚨 SOS ALARM: ✅ Audio desbloqueado manualmente');
            }).catch(err => {
                _sosAlarm.volume = 1.0;
                console.error('🚨 SOS ALARM: ❌ Unlock manual falló:', err.name, err.message);
                Components.showToast('❌ No se pudo activar el audio. Intentá de nuevo.', 'danger');
            });
        }
    }

    // Actualizar banner visual si existe
    function _updateAudioBanner() {
        const banner = document.getElementById('sos-audio-banner');
        if (!banner) return;
        if (_audioUnlocked) {
            banner.innerHTML = `
                <span style="color: var(--color-success); font-size: var(--font-size-xs);">
                    🔊 Alertas sonoras activas
                </span>
            `;
            banner.style.cursor = 'default';
            banner.onclick = null;
            // Ocultar después de 3 segundos
            setTimeout(() => { if (banner) banner.style.display = 'none'; }, 3000);
        }
    }

    // Renderizar botón de fallback para el dashboard
    function renderAudioActivationBanner() {
        if (_audioUnlocked) return ''; // Ya está desbloqueado
        return `
            <div id="sos-audio-banner" 
                 onclick="SOSModule.unlockAudio()" 
                 style="display:inline-flex; align-items:center; gap:6px; padding:6px 14px; 
                        background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); 
                        border-radius:20px; cursor:pointer; transition:all 0.2s ease;
                        font-size:0.75rem; color:#fca5a5; font-weight:600;"
                 onmouseover="this.style.background='rgba(239,68,68,0.2)'"
                 onmouseout="this.style.background='rgba(239,68,68,0.1)'">
                🔊 Activar Alertas Sonoras
            </div>
        `;
    }

    // Iniciar el hack apenas cargue el módulo
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _setupAudioUnlock);
        } else {
            _setupAudioUnlock();
        }
    }

    // =============================================
    // 🔊 SIRENA SOS — Web Audio API (PRIMARIA)
    // No depende de archivos externos ni red
    // Genera una sirena real oscilando 400-800Hz
    // =============================================
    let _sirenInterval = null;

    function _initAlarm() {
        // Legacy: intentar crear HTML5 Audio como SECUNDARIO (best-effort)
        if (!_sosAlarm) {
            try {
                _sosAlarm = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');
                _sosAlarm.loop = true;
                _sosAlarm.volume = 1.0;
                _sosAlarm.preload = 'auto';
                _sosAlarm.addEventListener('error', () => {
                    console.warn('🚨 SOS ALARM: HTML5 Audio no disponible (OGG) — usando Web Audio API');
                    _sosAlarm = null;
                });
            } catch (e) {
                _sosAlarm = null;
            }
        }
    }

    function _startAlarm() {
        console.log('🚨 SOS ALARM: 🚀 Iniciando alarma...');

        // VIBRACIÓN FÍSICA (funciona incluso con audio bloqueado)
        _startVibration();

        // ========================================
        // MÉTODO PRIMARIO: Web Audio API Siren
        // No requiere archivos externos ni red
        // ========================================
        _startWebAudioSiren();

        // MÉTODO SECUNDARIO: HTML5 Audio (best-effort, puede fallar)
        _initAlarm();
        if (_sosAlarm) {
            try {
                _sosAlarm.currentTime = 0;
                const p = _sosAlarm.play();
                if (p) p.catch(() => { /* ignorar — Web Audio API ya está sonando */ });
            } catch (e) { /* ignorar */ }
        }
    }

    // Sirena con Web Audio API — oscila entre 400Hz y 800Hz
    function _startWebAudioSiren() {
        // Limpiar sirena anterior si existe
        _stopWebAudioSiren();

        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                console.error('🚨 SOS ALARM: ❌ Web Audio API no soportada');
                return;
            }

            _fallbackAudioCtx = new AudioCtx();

            // Resumir contexto si está suspendido (requiere interacción previa del usuario)
            if (_fallbackAudioCtx.state === 'suspended') {
                _fallbackAudioCtx.resume().catch(() => {});
            }

            _fallbackOscillator = _fallbackAudioCtx.createOscillator();
            const gainNode = _fallbackAudioCtx.createGain();

            _fallbackOscillator.type = 'square';
            gainNode.gain.setValueAtTime(0.5, _fallbackAudioCtx.currentTime);

            _fallbackOscillator.connect(gainNode);
            gainNode.connect(_fallbackAudioCtx.destination);

            // Programar efecto sirena: oscila 400Hz ↔ 800Hz cada 0.5s durante 120s
            const now = _fallbackAudioCtx.currentTime;
            for (let i = 0; i < 120; i++) {
                _fallbackOscillator.frequency.setValueAtTime(400, now + i);
                _fallbackOscillator.frequency.linearRampToValueAtTime(800, now + i + 0.5);
                _fallbackOscillator.frequency.linearRampToValueAtTime(400, now + i + 1.0);
            }

            _fallbackOscillator.start();

            // Safety: auto-detener después de 120 segundos
            _sirenInterval = setTimeout(() => {
                console.log('🚨 SOS ALARM: ⏱️ Auto-stop después de 120s');
                _stopWebAudioSiren();
            }, 120000);

            console.log('🚨 SOS ALARM: 🔊✅ Sirena Web Audio API ACTIVADA (400-800Hz)');
        } catch (e) {
            console.error('🚨 SOS ALARM: ❌ Web Audio API falló:', e.name, e.message);
        }
    }

    function _stopWebAudioSiren() {
        if (_sirenInterval) {
            clearTimeout(_sirenInterval);
            _sirenInterval = null;
        }
        if (_fallbackOscillator) {
            try {
                _fallbackOscillator.stop();
                _fallbackOscillator.disconnect();
            } catch (e) { /* ignorar */ }
            _fallbackOscillator = null;
        }
        if (_fallbackAudioCtx) {
            try {
                _fallbackAudioCtx.close();
            } catch (e) { /* ignorar */ }
            _fallbackAudioCtx = null;
        }
    }

    function _stopAlarm() {
        // Parar vibración
        _stopVibration();
        // Parar Web Audio API siren (PRIMARIA)
        _stopWebAudioSiren();
        // Parar HTML5 Audio (SECUNDARIA)
        if (_sosAlarm) {
            try {
                _sosAlarm.pause();
                _sosAlarm.currentTime = 0;
            } catch (e) { /* ignorar */ }
        }
        console.log('🚨 SOS ALARM: 🔇 Alarma detenida (siren + vibración)');
    }

    // =============================================
    // VIBRACIÓN NATIVA (Vibration API — mobile)
    // =============================================
    function _startVibration() {
        if (!navigator.vibrate) {
            console.log('🚨 SOS VIBRATE: Vibration API no soportada');
            return;
        }
        // Patrón: vibrar 1s, pausa 0.5s, vibrar 1s, pausa 0.5s, vibrar 1s
        const pattern = [1000, 500, 1000, 500, 1000];
        navigator.vibrate(pattern);
        // navigator.vibrate no repite — usamos interval para loop
        _vibrationInterval = setInterval(() => {
            try { navigator.vibrate(pattern); } catch(e) { /* ignorar */ }
        }, 5500); // 1000+500+1000+500+1000 = 4000ms + 1500ms pausa
        console.log('🚨 SOS VIBRATE: 📳 Vibración activada (loop)');
    }

    function _stopVibration() {
        if (_vibrationInterval) {
            clearInterval(_vibrationInterval);
            _vibrationInterval = null;
        }
        if (navigator.vibrate) {
            try { navigator.vibrate(0); } catch(e) { /* ignorar */ }
        }
        console.log('🚨 SOS VIBRATE: 📳 Vibración detenida');
    }

    // =============================================
    // PASO 1: Obtener posición del tracker GPS IoT
    // =============================================
    async function _getTrackerPosition(vehicleId) {
        console.log('🚨 SOS [Paso 2]: Buscando GPS IoT para vehículo:', vehicleId);
        try {
            if (!vehicleId) {
                console.warn('🚨 SOS [Paso 2]: No hay vehicleId, saltando tracker');
                return null;
            }
            const snap = await Promise.race([
                firebaseDB.ref(`gps_tracker/${vehicleId}/last_position`).once('value'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tracker timeout (3s)')), 3000))
            ]);
            const data = snap.val();
            if (data && data.lat && data.lng) {
                console.log('🚨 SOS [Paso 2]: ✅ Posición tracker obtenida:', data.lat, data.lng);
                return { lat: data.lat, lng: data.lng, source: 'tracker' };
            }
            console.log('🚨 SOS [Paso 2]: Tracker sin datos de posición (nulo)');
            return null;
        } catch (e) {
            console.warn('🚨 SOS [Paso 2]: Tracker no disponible —', e.message);
            return null;
        }
    }

    // =============================================
    // PASO 2: Fallback GPS del celular
    // =============================================
    function _getMobilePosition() {
        console.log('🚨 SOS [Paso 3]: Intentando GPS del celular (timeout 4s)...');

        // Promesa interna del Geolocation API
        const geoPromise = new Promise((resolve) => {
            if (!navigator.geolocation) {
                console.warn('🚨 SOS [Paso 3]: ❌ Geolocation API no soportada');
                resolve(null);
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    console.log('🚨 SOS [Paso 3]: ✅ GPS celular obtenido:', pos.coords.latitude, pos.coords.longitude);
                    resolve({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        source: 'mobile'
                    });
                },
                (err) => {
                    let reason = 'Error desconocido';
                    if (err.code === 1) reason = 'PERMISO DENEGADO por el usuario';
                    if (err.code === 2) reason = 'Posición no disponible (sin HTTPS o GPS apagado)';
                    if (err.code === 3) reason = 'Timeout nativo';
                    console.warn('🚨 SOS [Paso 3]: ❌ GPS celular falló —', reason);
                    if (err.code === 1) {
                        Components.showToast('⚠️ GPS denegado — el SOS se enviará sin ubicación', 'warning');
                    }
                    resolve(null);
                },
                { enableHighAccuracy: true, timeout: 3500, maximumAge: 10000 }
            );
        });

        // ⚡ TIMEOUT DURO de 4 segundos — si el GPS no responde, seguimos SIN él
        const hardTimeout = new Promise((resolve) => {
            setTimeout(() => {
                console.warn('🚨 SOS [Paso 3]: ⏱️ HARD TIMEOUT 4s — GPS no respondió, continuando sin ubicación');
                resolve(null);
            }, 4000);
        });

        return Promise.race([geoPromise, hardTimeout]);
    }

    // =============================================
    // PASO PRINCIPAL: Botón SOS presionado
    // SOLO abre el modal de selección de motivo
    // =============================================
    let _pendingSOSContext = null; // { shiftId, vehicleId, vehicleName }

    function triggerSOS(shiftId, vehicleId, vehicleName) {
        console.log('🚨 ========================');
        console.log('🚨 SOS [Paso 1]: BOTÓN SOS PRESIONADO — abriendo selector de motivo');
        console.log('🚨 SOS [Paso 1]: shiftId:', shiftId, '| vehicleId:', vehicleId, '| vehicleName:', vehicleName);
        console.log('🚨 ========================');

        // Session guard
        if (!Auth.isLoggedIn()) {
            console.error('🚨 SOS: ❌ Sesión no encontrada');
            alert('Error: Sesión no encontrada. Por favor iniciá sesión nuevamente.');
            Router.navigate('login');
            return;
        }

        // Guardar contexto para cuando el usuario confirme
        _pendingSOSContext = { shiftId, vehicleId, vehicleName };
        _isSendingSOS = true;

        // Mostrar modal de selección de emergencia (sin GPS ni Firebase todavía)
        _showEmergencyModal();
    }

    // =============================================
    // Modal de tipo de emergencia (PRIMER PASO)
    // =============================================
    function _showEmergencyModal() {
        const buttonsHTML = EMERGENCY_TYPES.map(t => `
            <button class="sos-type-btn" onclick="SOSModule.submitSOSDetails('${t.key}')">
                <span class="sos-type-icon">${t.icon}</span>
                <span class="sos-type-label">${t.label}</span>
            </button>
        `).join('');

        const bodyHTML = `
            <div class="sos-modal-content">
                <div class="sos-modal-header-icon">🚨</div>
                <p style="text-align:center; color:var(--text-secondary); margin-bottom:var(--space-4);">
                    <strong>¿Cuál es la emergencia?</strong><br>
                    Seleccioná el tipo y presioná "Enviar Alerta"
                </p>
                <div class="sos-type-grid">
                    ${buttonsHTML}
                </div>
                <div class="form-group" style="margin-top:var(--space-4);">
                    <label class="form-label">Detalles adicionales (opcional)</label>
                    <textarea class="form-input" id="sosDetails" rows="2" 
                        placeholder="Describí brevemente la situación..."
                        spellcheck="true" lang="es" autocorrect="on"
                        style="resize:none;"></textarea>
                </div>
            </div>
        `;

        const footerHTML = `
            <button class="btn btn-ghost" onclick="SOSModule.cancelSOS()">Cancelar</button>
        `;

        Components.showModal('🚨 ¿Cuál es la emergencia?', bodyHTML, footerHTML);
    }

    // =============================================
    // Cancelar SOS (desde modal)
    // =============================================
    function cancelSOS() {
        _pendingSOSContext = null;
        _isSendingSOS = false;
        Components.closeModal();
        console.log('🚨 SOS: Cancelado por el usuario');
    }

    // =============================================
    // CONFIRMAR emergencia: obtener GPS + enviar a Firebase
    // Se ejecuta SOLO al seleccionar el tipo de emergencia
    // =============================================
    async function submitSOSDetails(type) {
        if (!_pendingSOSContext) {
            console.warn('🚨 SOS: No hay contexto pendiente');
            return;
        }

        const { shiftId, vehicleId, vehicleName } = _pendingSOSContext;
        const details = document.getElementById('sosDetails')?.value?.trim() || '';
        const emergencyDef = EMERGENCY_TYPES.find(t => t.key === type);

        // Cerrar modal y mostrar feedback inmediato
        Components.closeModal();
        Components.showToast('🚨 Enviando alerta SOS...', 'warning');

        try {
            // --- PASO 2: Obtener GPS (máx 7s total: 3s tracker + 4s celular) ---
            console.log('🚨 SOS [Paso 2]: Obteniendo ubicación (no bloquea el envío)...');

            let position = null;
            try {
                position = await _getTrackerPosition(vehicleId);
            } catch (e) {
                console.warn('🚨 SOS [Paso 2]: Tracker falló —', e.message);
            }

            if (!position) {
                Components.showToast('📱 Intentando GPS del celular...', 'info');
                try {
                    position = await _getMobilePosition();
                } catch (e) {
                    console.warn('🚨 SOS [Paso 3]: GPS celular falló —', e.message);
                }
            }

            // ⚡ FALLBACK SEGURO: Si NO hay GPS, el SOS se envía IGUAL
            const locationAvailable = !!(position && position.lat && position.lng);
            if (!locationAvailable) {
                console.warn('🚨 SOS [Paso 3]: ⚠️ SIN COORDENADAS — enviando SOS sin ubicación (NUNCA se bloquea)');
                position = { lat: null, lng: null, source: 'unavailable' };
            }

            console.log('🚨 SOS [Paso 3]: Coordenadas:', position.lat, position.lng, '| Fuente:', position.source, '| Disponible:', locationAvailable);

            const mapsUrl = locationAvailable
                ? `https://www.google.com/maps?q=${position.lat},${position.lng}`
                : '';

            // --- PASO 3: Escribir alerta DIRECTAMENTE (sin pre-check de conexión) ---
            // El pre-check de .info/connected agregaba 6s+ en redes lentas
            // Firebase RTDB tiene retry interno — mejor intentar escribir directo
            console.log('🚨 SOS [Paso 4]: Guardando alerta en Firebase CON motivo:', type);
            const fleetId = Auth.getFleetId();
            const alertRef = firebaseDB.ref('sos_alerts').push();
            const alertData = {
                id: alertRef.key,
                driverId: Auth.getUserId() || Auth.getUserName(),
                driverName: Auth.getUserName(),
                fleetId: fleetId || 'unknown',
                shiftId: shiftId || '',
                vehicleId: vehicleId || '',
                vehicleName: vehicleName || '',
                lat: position.lat,
                lng: position.lng,
                gpsSource: position.source,
                locationAvailable: locationAvailable,
                locationText: locationAvailable ? `${position.lat}, ${position.lng}` : 'No disponible (Error GPS/Permisos)',
                mapsUrl: mapsUrl,
                status: 'active',
                emergencyType: type,
                emergencyTypeLabel: emergencyDef ? `${emergencyDef.icon} ${emergencyDef.label}` : type,
                emergencyDetails: details || null,
                created_at: new Date().toISOString(),
                resolved_at: null
            };

            console.log('🚨 SOS [Paso 4]: Payload:', JSON.stringify(alertData));

            // 🔥 FIRE-AND-FORGET: No esperar confirmación del servidor
            // Firebase RTDB tiene caché local — set() escribe localmente de inmediato
            // y sincroniza con el servidor cuando la conexión esté disponible.
            // En 4G lento, el await bloqueaba 15s+ y mostraba error de timeout.
            alertRef.set(alertData).then(() => {
                console.log('🚨 SOS [Paso 4]: ✅ Confirmado por servidor — ID:', alertRef.key);
            }).catch(err => {
                console.error('🚨 SOS [Paso 4]: ⚠️ Error de escritura (el dato se sincronizará luego):', err.message);
                // NO mostrar error al usuario — Firebase reintentará automáticamente
            });

            // 🔔 PASO 5: Disparar FCM Push Notifications via backend
            // FIRE-AND-FORGET: El backend envía pushes a conductores en background
            // Esto NO bloquea ni afecta el flujo de foreground existente
            try {
                _triggerFCMNotification(alertData);
            } catch (fcmErr) {
                console.warn('🚨 SOS [Paso 5]: ⚠️ FCM trigger falló (no crítico):', fcmErr.message);
            }

            // Mostrar éxito INMEDIATAMENTE (no depende de la red)
            console.log('🚨 SOS [Paso 4]: 📤 Alerta despachada (fire-and-forget) — ID:', alertRef.key);
            Components.showToast(`${emergencyDef?.icon || '🚨'} ¡ALERTA SOS ENVIADA! — ${emergencyDef?.label || type}`, 'danger');

            _pendingSOSContext = null;
            _currentAlertId = null;
            _isSendingSOS = false;

        } catch (e) {
            console.error('🚨 SOS: ❌❌❌ ERROR CRÍTICO:', e);
            console.error('🚨 SOS: Stack:', e.stack);
            // Aún con error, intentar escribir de todos modos
            try {
                const fleetId = Auth.getFleetId();
                const emergencyRef = firebaseDB.ref('sos_alerts').push();
                emergencyRef.set({
                    id: emergencyRef.key,
                    driverId: Auth.getUserId() || Auth.getUserName(),
                    driverName: Auth.getUserName(),
                    fleetId: fleetId || 'unknown',
                    shiftId: shiftId || '',
                    vehicleId: vehicleId || '',
                    vehicleName: vehicleName || '',
                    lat: null, lng: null, gpsSource: 'error',
                    locationAvailable: false,
                    locationText: 'Error en envío SOS',
                    mapsUrl: '',
                    status: 'active',
                    emergencyType: type,
                    emergencyTypeLabel: emergencyDef ? `${emergencyDef.icon} ${emergencyDef.label}` : type,
                    emergencyDetails: `[ERROR CATCH] ${e.message}`,
                    created_at: new Date().toISOString(),
                    resolved_at: null
                });
                Components.showToast('🚨 SOS enviado (modo emergencia)', 'warning');
                console.log('🚨 SOS: ✅ Alerta de emergencia enviada desde catch');
            } catch (e2) {
                console.error('🚨 SOS: ❌ Incluso el envío de emergencia falló:', e2);
                alert('🚨 EMERGENCIA: No se pudo enviar el SOS.\n\nLlamá al 911 o contactá a tu dueño por WhatsApp.');
            }
            _isSendingSOS = false;
        }
    }

    // =============================================
    // 🔔 FCM: Disparar push notification via backend
    // FIRE-AND-FORGET — nunca bloquea el flujo SOS
    // =============================================
    function _triggerFCMNotification(alertData) {
        // Auto-detectar URL del backend (mismo origen que la app)
        const baseUrl = window.location.origin;
        const url = `${baseUrl}/api/sos/notify`;

        console.log('🔔 SOS FCM: 📤 Enviando a backend:', url);

        // Fire-and-forget fetch — NO usar await, NO bloquear
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                alertId: alertData.id,
                driverName: alertData.driverName,
                driverId: alertData.driverId,
                vehicleName: alertData.vehicleName,
                fleetId: alertData.fleetId,
                lat: alertData.lat,
                lng: alertData.lng,
                mapsUrl: alertData.mapsUrl,
                emergencyType: alertData.emergencyType,
                emergencyTypeLabel: alertData.emergencyTypeLabel,
                emergencyDetails: alertData.emergencyDetails,
                created_at: alertData.created_at
            })
        }).then(res => {
            if (res.ok) {
                console.log('🔔 SOS FCM: ✅ Backend procesó la notificación push');
            } else {
                console.warn('🔔 SOS FCM: ⚠️ Backend respondió con status:', res.status);
            }
        }).catch(err => {
            // No es crítico — el SOS ya se guardó en Firebase RTDB
            console.warn('🔔 SOS FCM: ⚠️ Error contactando backend (SOS ya enviado):', err.message);
        });
    }

    // =============================================
    // HAVERSINE — distancia en km entre dos coordenadas
    // =============================================
    function _haversineKm(lat1, lng1, lat2, lng2) {
        const R = 6371; // Radio de la Tierra en km
        const toRad = (deg) => deg * Math.PI / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a = Math.sin(dLat / 2) ** 2 +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                  Math.sin(dLng / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // =============================================
    // TRACKING DE POSICIÓN DEL CONDUCTOR
    // =============================================
    function _startPositionTracking() {
        const userId = Auth.getUserId() || Auth.getUserName();
        if (!userId || !navigator.geolocation) {
            console.warn('🚨 SOS POSITION: Sin geolocation o userId');
            return;
        }

        console.log('🚨 SOS POSITION: Iniciando tracking para', userId);

        // Guardar posición inmediatamente
        _savePosition(userId);

        // Actualizar cada 60 segundos
        _positionInterval = setInterval(() => _savePosition(userId), 60000);

        // Watch para actualización continua en memoria
        try {
            _positionWatchId = navigator.geolocation.watchPosition(
                (pos) => {
                    _myLastPosition = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude
                    };
                },
                (err) => {
                    console.warn('🚨 SOS POSITION: watchPosition error:', err.message);
                },
                { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
            );
        } catch (e) {
            console.warn('🚨 SOS POSITION: watchPosition no disponible:', e);
        }
    }

    async function _savePosition(userId) {
        try {
            const pos = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
                    (e) => reject(e),
                    { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 }
                );
            });
            _myLastPosition = pos;
            await firebaseDB.ref(`driver_positions/${userId}`).set({
                lat: pos.lat,
                lng: pos.lng,
                updated_at: new Date().toISOString()
            });
            console.log('🚨 SOS POSITION: ✅ Guardada:', pos.lat.toFixed(4), pos.lng.toFixed(4));
        } catch (e) {
            console.warn('🚨 SOS POSITION: Error guardando posición:', e.message || e);
        }
    }

    function _stopPositionTracking() {
        if (_positionWatchId !== null) {
            navigator.geolocation.clearWatch(_positionWatchId);
            _positionWatchId = null;
        }
        if (_positionInterval) {
            clearInterval(_positionInterval);
            _positionInterval = null;
        }
        console.log('🚨 SOS POSITION: Tracking detenido');
    }

    // =============================================
    // LISTENER DUAL — Dueños (siempre) + Conductores (radar 50km)
    // =============================================
    // ⚠️ BYPASS TEMPORAL: Radio aumentado a 1000km para diagnóstico
    // TODO: Restaurar a 50km una vez confirmado que los eventos llegan correctamente
    const SOS_RADIUS_KM = 1000;

    // =============================================
    // NOTIFICACIÓN NATIVA DEL OS (Web Notification API)
    // OBLIGATORIA para conductores — sin permisos no hay alerta en background
    // =============================================
    let _permissionRetryTimer = null;

    function _requestNotificationPermission() {
        if (!('Notification' in window)) {
            console.log('🚨 SOS NOTIFY: Notification API no soportada');
            return;
        }
        if (Notification.permission === 'granted') {
            console.log('🚨 SOS NOTIFY: ✅ Permisos ya otorgados');
            return;
        }
        if (Notification.permission === 'denied') {
            console.warn('🚨 SOS NOTIFY: ❌ Permisos denegados — mostrando aviso persistente');
            Components.showToast('⚠️ Notificaciones SOS bloqueadas. Andá a Configuración del navegador y activá las notificaciones para recibir alertas de emergencia.', 'danger');
            return;
        }
        // Pedir permiso (estado: 'default')
        Notification.requestPermission().then(permission => {
            console.log('🚨 SOS NOTIFY: Permiso:', permission);
            if (permission === 'granted') {
                Components.showToast('🔔 Notificaciones SOS activadas — recibirás alertas en segundo plano', 'success');
                if (_permissionRetryTimer) {
                    clearInterval(_permissionRetryTimer);
                    _permissionRetryTimer = null;
                }
            } else {
                Components.showToast('⚠️ Sin notificaciones no recibirás alertas SOS en segundo plano', 'warning');
            }
        });
    }

    // Para conductores: solicitar permisos de forma persistente
    function _requestMandatoryNotificationPermission() {
        _requestNotificationPermission();

        // Si no estamos granted, reintentar cada 30s con toast
        if ('Notification' in window && Notification.permission === 'default') {
            _permissionRetryTimer = setInterval(() => {
                if (Notification.permission === 'granted') {
                    clearInterval(_permissionRetryTimer);
                    _permissionRetryTimer = null;
                    return;
                }
                if (Notification.permission === 'default') {
                    Components.showToast('🔔 Activá las notificaciones para recibir alertas SOS de emergencia', 'warning');
                    _requestNotificationPermission();
                }
            }, 30000);
        }
    }

    // =============================================
    // 📨 BRIDGE: Enviar alerta SOS al Service Worker
    // Para que dispare notificación en background
    // =============================================
    async function _postMessageToSW(alertData) {
        try {
            const registration = await navigator.serviceWorker?.getRegistration();
            if (registration && registration.active) {
                registration.active.postMessage({
                    type: 'SOS_ALERT',
                    alertData: {
                        id: alertData.id,
                        driverName: alertData.driverName,
                        vehicleName: alertData.vehicleName,
                        emergencyType: alertData.emergencyType,
                        emergencyTypeLabel: alertData.emergencyTypeLabel,
                        emergencyDetails: alertData.emergencyDetails,
                        mapsUrl: alertData.mapsUrl,
                        created_at: alertData.created_at
                    }
                });
                console.log('🚨 SOS NOTIFY: 📨 postMessage enviado al Service Worker');
            } else {
                console.warn('🚨 SOS NOTIFY: Service Worker no activo, usando fallback');
            }
        } catch (e) {
            console.warn('🚨 SOS NOTIFY: Error en postMessage:', e);
        }
    }

    async function _sendNativeNotification(alertData, distKm) {
        if (!('Notification' in window) || Notification.permission !== 'granted') {
            console.log('🚨 SOS NOTIFY: Sin permisos, saltando notificación nativa');
            return;
        }

        const typeLabel = alertData.emergencyTypeLabel || alertData.emergencyType || 'Emergencia';
        const title = '🚨 ¡ALERTA SOS!';
        const body = `${alertData.driverName || 'Conductor'} — ${typeLabel}\n🚗 ${alertData.vehicleName || 'Vehículo'}${distKm != null ? ` (${distKm.toFixed(1)} km)` : ''}`;

        try {
            // Usar Service Worker para notificaciones persistentes (funcionan en background)
            const registration = await navigator.serviceWorker?.getRegistration();
            if (registration) {
                await registration.showNotification(title, {
                    body: body,
                    icon: './assets/icon-192.png',
                    badge: './assets/icon-192.png',
                    tag: 'sos-alert-' + (alertData.id || Date.now()),
                    requireInteraction: true, // No se descarta sola
                    vibrate: [1000, 500, 1000, 500, 1000],
                    data: {
                        url: self.location?.origin || '/',
                        alertId: alertData.id,
                        mapsUrl: alertData.mapsUrl
                    },
                    actions: alertData.mapsUrl ? [
                        { action: 'open-map', title: '📍 Ver Mapa' },
                        { action: 'open-app', title: '🚨 Abrir App' }
                    ] : [
                        { action: 'open-app', title: '🚨 Abrir App' }
                    ]
                });
                console.log('🚨 SOS NOTIFY: ✅ Notificación nativa enviada via Service Worker');
            } else {
                // Fallback: Notification API directa (no persiste en background)
                new Notification(title, {
                    body: body,
                    icon: './assets/icon-192.png',
                    tag: 'sos-alert-' + (alertData.id || Date.now()),
                    requireInteraction: true
                });
                console.log('🚨 SOS NOTIFY: ✅ Notificación nativa enviada (fallback)');
            }
        } catch (e) {
            console.error('🚨 SOS NOTIFY: Error enviando notificación:', e);
        }
    }

    function startListening() {
        const fleetId = Auth.getFleetId();
        const isOwner = Auth.isOwner();
        const role = Auth.getRole();
        const myUserId = Auth.getUserId() || Auth.getUserName();
        console.log('🚨 SOS LISTENER: Activando. rol:', role, '| isOwner:', isOwner, '| fleetId:', fleetId, '| myUserId:', myUserId);

        // Pedir permisos de notificación nativa
        // OBLIGATORIO para conductores — persistente hasta que acepten
        try {
            if (!isOwner) {
                _requestMandatoryNotificationPermission();
            } else {
                _requestNotificationPermission();
            }
        } catch(e) { /* ignorar */ }

        // Limpiar listener anterior si existe
        stopListening();

        // Si es conductor, iniciar tracking de posición
        if (!isOwner) {
            _startPositionTracking();
        }

        _sosListenerRef = firebaseDB.ref('sos_alerts');
        // Usar timestamp con 30s de tolerancia para reconexiones
        const _listenerStartTime = Date.now() - 30000;
        console.log('🚨 SOS LISTENER: Start time (con 30s tolerancia):', new Date(_listenerStartTime).toISOString());

        _sosListenerRef.on('child_added', (snap) => {
            const alertData = snap.val();
            console.log('🚨 SOS LISTENER: 📩 child_added disparado — key:', snap.key, '| data:', alertData ? 'OK' : 'NULL');
            if (!alertData) return;

            // Guard: si estoy enviando un SOS, no mostrar notificaciones que sobreescriban el modal
            if (_isSendingSOS) {
                console.log('🚨 SOS LISTENER: ⏩ Ignorando (estoy en flujo de envío SOS)');
                return;
            }

            console.log('🚨 SOS LISTENER: child_added:', snap.key, '| status:', alertData.status);

            // Filtrar: solo alertas activas
            if (alertData.status !== 'active') return;

            // Filtrar: solo alertas recientes (con tolerancia de 30s)
            const alertTime = new Date(alertData.created_at).getTime();
            if (alertTime < _listenerStartTime) {
                console.log('🚨 SOS LISTENER: ⏩ Alerta vieja, ignorando. AlertTime:', new Date(alertTime).toISOString());
                return;
            }

            // ====================================
            // 👑 DUEÑO: SIEMPRE recibe alertas de su flota
            // ====================================
            if (isOwner) {
                // Filtrar por flota
                if (fleetId && alertData.fleetId && alertData.fleetId !== fleetId && alertData.fleetId !== 'unknown') {
                    console.log('🚨 SOS LISTENER: ⏩ FleetId no coincide (owner)');
                    return;
                }
                console.log('🚨 SOS LISTENER (OWNER): ✅ ¡ALERTA RECIBIDA! Mostrando alarma + modal...');
                _startAlarm();
                _showOwnerSOSNotification(alertData);
                // Push notification AISLADA — no puede bloquear alarma/modal
                try { _sendNativeNotification(alertData, null).catch(e => console.warn('🚨 SOS PUSH Error:', e)); } catch(e) { /* ignorar */ }
                // 📨 Si la pestaña no es visible, notificar via SW también
                if (document.visibilityState !== 'visible') {
                    try { _postMessageToSW(alertData); } catch(e) { /* ignorar */ }
                }
                return;
            }

            // ====================================
            // 🚗 CONDUCTOR: Solo si está dentro del RADAR
            // ====================================
            console.log('🚨 SOS LISTENER (DRIVER): 🔍 Evaluando alerta para conductor. myUserId:', myUserId, '| alertData.driverId:', alertData.driverId, '| alertData.driverName:', alertData.driverName);

            // CRÍTICO: No mostrar mi propia alerta SOS (evitar bucle infinito)
            if (alertData.driverId === myUserId || alertData.driverName === Auth.getUserName()) {
                console.log('🚨 SOS LISTENER (DRIVER): ⏩ Es mi propia alerta, ignorando (driverId o driverName coinciden)');
                return;
            }

            // Filtrar por flota (si tenemos fleetId)
            if (fleetId && alertData.fleetId && alertData.fleetId !== fleetId && alertData.fleetId !== 'unknown') {
                console.log('🚨 SOS LISTENER (DRIVER): ⏩ FleetId no coincide, ignorando');
                return;
            }

            // Intentar filtro por distancia — BEST EFFORT
            // ⚠️ BYPASS TEMPORAL: radio = 1000km para diagnóstico
            let distKm = null;
            let canCalculateDistance = false;

            console.log('🚨 SOS LISTENER (DRIVER): 📍 Mi posición:', _myLastPosition ? `${_myLastPosition.lat}, ${_myLastPosition.lng}` : 'NULL');
            console.log('🚨 SOS LISTENER (DRIVER): 📍 Posición SOS:', alertData.lat, alertData.lng);

            if (alertData.lat && alertData.lng && _myLastPosition && _myLastPosition.lat && _myLastPosition.lng) {
                canCalculateDistance = true;
                distKm = _haversineKm(
                    _myLastPosition.lat, _myLastPosition.lng,
                    alertData.lat, alertData.lng
                );
                console.log(`🚨 SOS LISTENER (DRIVER): Distancia al SOS: ${distKm.toFixed(1)} km (radio: ${SOS_RADIUS_KM} km)`);

                // bypass distance check — temporalmente radio = 1000km
                if (distKm > SOS_RADIUS_KM) {
                    console.log('🚨 SOS LISTENER (DRIVER): ⏩ Fuera de radio, ignorando');
                    return;
                }
                console.log('🚨 SOS LISTENER (DRIVER): ✅ ¡DENTRO DEL RADAR! Mostrando alerta + alarma...');
            } else {
                // NO podemos calcular distancia — mostrar alerta de todos modos por seguridad
                const reason = !_myLastPosition ? 'sin posición propia' : 'alerta sin coordenadas';
                console.log(`🚨 SOS LISTENER (DRIVER): ⚠️ ${reason} — mostrando alerta por seguridad (sin filtro radar)`);
            }

            console.log('🚨 SOS LISTENER (DRIVER): 🚀🚀🚀 DISPARANDO ALARMA + MODAL INVASIVO');
            _startAlarm();
            _showDriverSOSAlert(alertData, canCalculateDistance ? distKm : null);
            // Push notification AISLADA — no puede bloquear alarma/modal
            try { _sendNativeNotification(alertData, canCalculateDistance ? distKm : null).catch(e => console.warn('🚨 SOS PUSH Error:', e)); } catch(e) { /* ignorar */ }
            // 📨 Si la pestaña no es visible, notificar via SW también
            if (document.visibilityState !== 'visible') {
                try { _postMessageToSW(alertData); } catch(e) { /* ignorar */ }
            }
        });

        // =============================================
        // 🔄 KEEPALIVE: Ping Firebase cada 45s para mantener conexión en móvil
        // Los browsers en 4G/LTE matan conexiones WebSocket idle
        // =============================================
        if (_keepaliveInterval) clearInterval(_keepaliveInterval);
        _keepaliveInterval = setInterval(() => {
            try {
                firebaseDB.ref('.info/connected').once('value').then(snap => {
                    const connected = snap.val();
                    if (!connected) {
                        console.warn('🚨 SOS KEEPALIVE: ❌ Firebase desconectado — forzando reconexión');
                        try { firebase.database().goOffline(); } catch(e) {}
                        setTimeout(() => { try { firebase.database().goOnline(); } catch(e) {} }, 500);
                    }
                }).catch(() => {
                    console.warn('🚨 SOS KEEPALIVE: Error en ping');
                });
            } catch(e) { /* ignorar */ }
        }, 45000);

        console.log(`🚨 SOS LISTENER: ✅ Activado para ${isOwner ? 'DUEÑO' : 'CONDUCTOR (radar ' + SOS_RADIUS_KM + 'km)'} + keepalive 45s`);
    }

    // Variable para keepalive interval
    let _keepaliveInterval = null;

    function stopListening() {
        if (_sosListenerRef) {
            _sosListenerRef.off('child_added');
            _sosListenerRef = null;
            console.log('🚨 SOS LISTENER: Desactivado');
        }
        if (_keepaliveInterval) {
            clearInterval(_keepaliveInterval);
            _keepaliveInterval = null;
        }
        if (_permissionRetryTimer) {
            clearInterval(_permissionRetryTimer);
            _permissionRetryTimer = null;
        }
        _stopPositionTracking();
    }

    // =============================================
    // Notificación SOS — DUEÑO (modal estándar)
    // =============================================
    function _showOwnerSOSNotification(alert, distKm) {
        console.log('🚨 SOS DUEÑO: Mostrando modal de alerta para:', alert.driverName);

        const gpsUnavailable = alert.locationAvailable === false || (!alert.lat && !alert.lng);
        const mapsLink = (!gpsUnavailable && alert.mapsUrl)
            ? `<a href="${alert.mapsUrl}" target="_blank" style="color:var(--color-primary); font-weight:700;">📍 Ver en Google Maps</a>`
            : '<span style="color:#ef4444; font-weight:700;">⚠️ Ubicación GPS no disponible</span>';

        const distInfo = (distKm !== undefined && distKm !== null && !gpsUnavailable)
            ? `<br/>📡 A ${distKm.toFixed(1)} km de tu ubicación`
            : '';

        const bodyHTML = `
            <div style="text-align:center; margin-bottom:var(--space-4);">
                <div style="font-size:3rem; animation: pulse 1s infinite;">🚨</div>
            </div>
            <div class="card" style="background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.3); padding:var(--space-4);">
                <div style="font-weight:700; font-size:var(--font-size-lg); margin-bottom:var(--space-2);">
                    ${alert.driverName || 'Conductor'} pide AUXILIO
                </div>
                <div style="font-size:var(--font-size-sm); color:var(--text-secondary); margin-bottom:var(--space-2);">
                    🚗 ${alert.vehicleName || 'Vehículo'}<br/>
                    📡 Fuente GPS: ${gpsUnavailable ? '<span style="color:#ef4444;">No disponible</span>' : (alert.gpsSource === 'tracker' ? 'Rastreador IoT' : alert.gpsSource === 'mobile' ? 'Celular' : 'No disponible')}<br/>
                    🕐 ${new Date(alert.created_at).toLocaleString()}${distInfo}
                </div>
                <div style="margin-top:var(--space-3);">
                    ${mapsLink}
                </div>
                ${alert.emergencyType ? `
                    <div style="margin-top:var(--space-3); padding-top:var(--space-3); border-top:1px solid var(--border-color);">
                        <strong>Tipo:</strong> ${alert.emergencyTypeLabel || alert.emergencyType}
                        ${alert.emergencyDetails ? `<br/><strong>Detalles:</strong> ${alert.emergencyDetails}` : ''}
                    </div>
                ` : ''}
            </div>
        `;

        const footerHTML = `
            <button class="btn btn-secondary" onclick="SOSModule.silenceAlarm(); Components.closeModal()">Cerrar</button>
            ${alert.mapsUrl ? `<a href="${alert.mapsUrl}" target="_blank" class="btn btn-danger" onclick="SOSModule.silenceAlarm()">📍 Abrir Mapa</a>` : ''}
            <button class="btn btn-primary" onclick="SOSModule.resolveAlert('${alert.id}')">✅ Marcar Resuelta</button>
        `;

        Components.showModal('🚨 ¡ALERTA SOS RECIBIDA!', bodyHTML, footerHTML);
    }

    // =============================================
    // 🚨 ALERTA INVASIVA FULLSCREEN — CONDUCTOR
    // Modal a pantalla completa con animación pulsante
    // =============================================
    function _showDriverSOSAlert(alertData, distKm) {
        console.log('🚨 SOS DRIVER ALERT: 🔴 Disparando alerta invasiva fullscreen para:', alertData.driverName);

        // Remover overlay anterior si existe
        const existing = document.getElementById('sos-driver-fullscreen-overlay');
        if (existing) existing.remove();

        const typeLabel = alertData.emergencyTypeLabel || alertData.emergencyType || '⚠️ Emergencia';
        const driverGpsUnavailable = alertData.locationAvailable === false || (!alertData.lat && !alertData.lng);
        const distText = (distKm !== null && distKm !== undefined && !driverGpsUnavailable) ? `📡 A ${distKm.toFixed(1)} km de tu ubicación` : '';
        const mapsBtn = (!driverGpsUnavailable && alertData.mapsUrl)
            ? `<a href="${alertData.mapsUrl}" target="_blank" 
                  style="display:inline-block; margin-top:16px; padding:14px 32px; 
                         background:#fff; color:#dc2626; font-weight:800; font-size:1.1rem;
                         border-radius:12px; text-decoration:none; 
                         box-shadow:0 4px 20px rgba(0,0,0,0.3);"
                  onclick="SOSModule.silenceAlarm()">
                  📍 VER UBICACIÓN EN MAPA
               </a>`
            : `<div style="margin-top:16px; padding:10px 20px; background:rgba(0,0,0,0.2); 
                          border-radius:8px; font-weight:700; color:#fca5a5;">
                  ⚠️ Ubicación GPS no disponible
               </div>`;

        const overlay = document.createElement('div');
        overlay.id = 'sos-driver-fullscreen-overlay';
        overlay.innerHTML = `
            <style>
                @keyframes sosPulse {
                    0%   { background: rgba(220, 38, 38, 0.95); }
                    50%  { background: rgba(185, 28, 28, 1); }
                    100% { background: rgba(220, 38, 38, 0.95); }
                }
                @keyframes sosIconBounce {
                    0%, 100% { transform: scale(1); }
                    50%      { transform: scale(1.3); }
                }
                #sos-driver-fullscreen-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 999999;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    animation: sosPulse 1.5s ease-in-out infinite;
                    color: #fff;
                    text-align: center;
                    padding: 24px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .sos-fullscreen-icon {
                    font-size: 5rem;
                    animation: sosIconBounce 1s ease-in-out infinite;
                    margin-bottom: 16px;
                    text-shadow: 0 0 30px rgba(255,255,255,0.5);
                }
                .sos-fullscreen-title {
                    font-size: 2rem;
                    font-weight: 900;
                    text-transform: uppercase;
                    letter-spacing: 2px;
                    margin-bottom: 12px;
                    text-shadow: 0 2px 10px rgba(0,0,0,0.3);
                }
                .sos-fullscreen-driver {
                    font-size: 1.4rem;
                    font-weight: 700;
                    margin-bottom: 8px;
                }
                .sos-fullscreen-type {
                    font-size: 1.2rem;
                    font-weight: 600;
                    background: rgba(0,0,0,0.2);
                    padding: 8px 20px;
                    border-radius: 30px;
                    margin-bottom: 8px;
                }
                .sos-fullscreen-details {
                    font-size: 0.95rem;
                    opacity: 0.9;
                    margin-bottom: 4px;
                }
                .sos-fullscreen-dismiss {
                    margin-top: 24px;
                    padding: 16px 48px;
                    background: rgba(255,255,255,0.15);
                    color: #fff;
                    font-weight: 800;
                    font-size: 1.1rem;
                    border: 2px solid rgba(255,255,255,0.5);
                    border-radius: 12px;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .sos-fullscreen-dismiss:hover {
                    background: rgba(255,255,255,0.3);
                }
            </style>
            <div class="sos-fullscreen-icon">🚨</div>
            <div class="sos-fullscreen-title">¡ALERTA SOS!</div>
            <div class="sos-fullscreen-driver">${alertData.driverName || 'Un conductor'} pide AUXILIO</div>
            <div class="sos-fullscreen-type">${typeLabel}</div>
            <div class="sos-fullscreen-details">🚗 ${alertData.vehicleName || 'Vehículo'}</div>
            ${alertData.emergencyDetails ? `<div class="sos-fullscreen-details">📝 ${alertData.emergencyDetails}</div>` : ''}
            ${distText ? `<div class="sos-fullscreen-details">${distText}</div>` : ''}
            <div class="sos-fullscreen-details">🕐 ${new Date(alertData.created_at).toLocaleString()}</div>
            ${mapsBtn}
            <button class="sos-fullscreen-dismiss" onclick="SOSModule.dismissDriverAlert()">✅ ENTENDIDO</button>
        `;

        document.body.appendChild(overlay);
    }

    // Cerrar alerta invasiva del conductor
    function _dismissDriverAlert() {
        _stopAlarm();
        const overlay = document.getElementById('sos-driver-fullscreen-overlay');
        if (overlay) overlay.remove();
        console.log('🚨 SOS DRIVER ALERT: Modal invasivo cerrado por el conductor');
    }

    // =============================================
    // Resolver alerta
    // =============================================
    async function resolveAlert(alertId) {
        _stopAlarm();
        try {
            await firebaseDB.ref(`sos_alerts/${alertId}`).update({
                status: 'resolved',
                resolved_at: new Date().toISOString(),
                resolved_by: Auth.getUserName()
            });
            Components.closeModal();
            Components.showToast('✅ Alerta SOS marcada como resuelta', 'success');
            console.log('🚨 SOS: Alerta', alertId, 'resuelta');
        } catch (e) {
            Components.showToast('Error: ' + e.message, 'danger');
        }
    }

    // =============================================
    // Botón SOS para turno activo (desktop)
    // =============================================
    function renderSOSButton(shiftId, vehicleId, vehicleName) {
        const safeVehicleName = (vehicleName || '').replace(/'/g, "\\'");
        return `
            <div class="sos-button-container">
                <button class="sos-button" onclick="SOSModule.triggerSOS('${shiftId}', '${vehicleId}', '${safeVehicleName}')">
                    <span class="sos-button-icon">🆘</span>
                    <span class="sos-button-text">SOS EMERGENCIA</span>
                </button>
                <p class="sos-hint">Presioná en caso de robo, accidente o emergencia</p>
            </div>
        `;
    }

    return {
        triggerSOS, submitSOSDetails, cancelSOS, startListening, stopListening,
        resolveAlert, renderSOSButton, silenceAlarm: _stopAlarm,
        unlockAudio: _manualUnlockAudio, renderAudioActivationBanner,
        isAudioUnlocked: () => _audioUnlocked,
        dismissDriverAlert: _dismissDriverAlert
    };
})();
