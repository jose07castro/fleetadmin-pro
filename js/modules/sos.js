/* ============================================
   FleetAdmin Pro — Módulo SOS
   Botón de emergencia con GPS tracker + fallback
   Alertas en tiempo real vía Firebase
   v46 — Alarma sonora al recibir SOS
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

    // =============================================
    // ALARMA SONORA (loop hasta que el dueño reaccione)
    // =============================================
    let _sosAlarm = null;

    function _initAlarm() {
        if (_sosAlarm) return;
        try {
            _sosAlarm = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');
            _sosAlarm.loop = true;
            _sosAlarm.volume = 1.0;
            _sosAlarm.preload = 'auto';
            console.log('🚨 SOS ALARM: Audio inicializado');
        } catch (e) {
            console.warn('🚨 SOS ALARM: No se pudo crear Audio:', e);
        }
    }

    function _startAlarm() {
        _initAlarm();
        if (!_sosAlarm) return;
        try {
            _sosAlarm.currentTime = 0;
            const playPromise = _sosAlarm.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.warn('🚨 SOS ALARM: Autoplay bloqueado por el navegador:', err.message);
                    // El modal visual se muestra de todas formas
                });
            }
            console.log('🚨 SOS ALARM: 🔊 Sirena activada');
        } catch (e) {
            console.warn('🚨 SOS ALARM: Error al reproducir:', e);
        }
    }

    function _stopAlarm() {
        if (!_sosAlarm) return;
        try {
            _sosAlarm.pause();
            _sosAlarm.currentTime = 0;
            console.log('🚨 SOS ALARM: 🔇 Sirena detenida');
        } catch (e) { /* ignorar */ }
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
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tracker timeout (5s)')), 5000))
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
        console.log('🚨 SOS [Paso 3]: Intentando GPS del celular...');
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                console.warn('🚨 SOS [Paso 3]: ❌ Geolocation API no soportada en este navegador');
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
                    if (err.code === 3) reason = 'Timeout (5s)';
                    console.warn('🚨 SOS [Paso 3]: ❌ GPS celular falló —', reason, err.message);
                    if (err.code === 1) {
                        Components.showToast('⚠️ Permiso de GPS denegado. Activá la ubicación en tu celular.', 'warning');
                    }
                    // FALLBACK: SOS se envía SIN GPS de todas formas
                    resolve(null);
                },
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        });
    }

    // =============================================
    // PASO PRINCIPAL: Disparar SOS
    // =============================================
    async function triggerSOS(shiftId, vehicleId, vehicleName) {
        console.log('🚨 ========================');
        console.log('🚨 SOS [Paso 1]: BOTÓN SOS PRESIONADO');
        console.log('🚨 SOS [Paso 1]: shiftId:', shiftId, '| vehicleId:', vehicleId, '| vehicleName:', vehicleName);
        console.log('🚨 SOS [Paso 1]: Usuario:', Auth.getUserName(), '| Rol:', Auth.getRole(), '| FleetId:', Auth.getFleetId());
        console.log('🚨 ========================');

        try {
            // Session guard
            if (!Auth.isLoggedIn()) {
                console.error('🚨 SOS: ❌ Sesión no encontrada');
                alert('Error: Sesión no encontrada. Por favor iniciá sesión nuevamente.');
                Router.navigate('login');
                return;
            }

            // Double confirmation
            if (!confirm('🚨 ¿ESTÁS SEGURO DE ENVIAR UNA ALERTA SOS?\n\nEsto notificará inmediatamente al propietario de tu flota.')) {
                console.log('🚨 SOS: Cancelado por el usuario');
                return;
            }

            Components.showToast('🚨 Obteniendo ubicación...', 'warning');

            // Step 1: Try tracker GPS
            let position = await _getTrackerPosition(vehicleId);

            // Step 2: Fallback to mobile GPS
            if (!position) {
                Components.showToast('📱 Usando GPS del celular...', 'info');
                position = await _getMobilePosition();
            }

            // Step 3: No GPS at all — still send alert
            if (!position) {
                console.warn('🚨 SOS [Paso 4]: ⚠️ Sin coordenadas — enviando alerta sin ubicación');
                position = { lat: null, lng: null, source: 'unavailable' };
                Components.showToast('⚠️ Sin ubicación — enviando alerta de todas formas', 'warning');
            }

            console.log('🚨 SOS [Paso 4]: Coordenadas finales:', position.lat, position.lng, '| Fuente:', position.source);

            // Build Google Maps URL
            const mapsUrl = position.lat
                ? `https://www.google.com/maps?q=${position.lat},${position.lng}`
                : '';

            // Step 4: Verify Firebase connectivity BEFORE writing
            console.log('🚨 SOS [Paso 5]: Verificando conexión con Firebase...');
            const fleetId = Auth.getFleetId();
            console.log('🚨 SOS [Paso 5]: FleetId que se guardará:', fleetId);

            // Connectivity check — try to read a tiny ref with timeout
            try {
                await Promise.race([
                    firebaseDB.ref('.info/connected').once('value'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase connection timeout')), 6000))
                ]);
                console.log('🚨 SOS [Paso 5]: ✅ Firebase conectado');
            } catch (connErr) {
                console.error('🚨 SOS [Paso 5]: ❌ Sin conexión a Firebase:', connErr.message);
                alert('🚨 ERROR: Sin conexión con la central.\n\nVerificá tu conexión a internet e intentá de nuevo.');
                Components.showToast('❌ Sin conexión — no se pudo enviar la alerta SOS', 'danger');
                return;
            }

            console.log('🚨 SOS [Paso 5]: Guardando alerta en Firebase...');
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
                locationText: position.lat ? `${position.lat}, ${position.lng}` : 'No disponible (Error GPS/Permisos)',
                mapsUrl: mapsUrl,
                status: 'active',
                emergencyType: null,
                emergencyDetails: null,
                created_at: new Date().toISOString(),
                resolved_at: null
            };

            console.log('🚨 SOS [Paso 5]: Payload:', JSON.stringify(alertData));

            // Write with timeout to prevent silent hangs
            await Promise.race([
                alertRef.set(alertData),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Firebase write timeout (10s)')), 10000))
            ]);
            _currentAlertId = alertRef.key;

            console.log('🚨 SOS [Paso 5]: ✅ Alerta guardada con ID:', alertRef.key);
            Components.showToast('🚨 ¡ALERTA SOS ENVIADA! El propietario fue notificado.', 'danger');

            // Step 5: Open emergency type modal
            _showEmergencyModal();

        } catch (e) {
            console.error('🚨 SOS: ❌❌❌ ERROR CRÍTICO:', e);
            console.error('🚨 SOS: Stack:', e.stack);
            alert('Error al enviar alerta SOS: ' + e.message + '\n\nVerificá tu conexión a internet y permisos de ubicación.');
            Components.showToast('❌ Error crítico en SOS: ' + e.message, 'danger');
        }
    }

    // =============================================
    // Modal de tipo de emergencia
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
                    Tu alerta fue enviada. <strong>Seleccioná el tipo de emergencia:</strong>
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
            <button class="btn btn-ghost" onclick="Components.closeModal()">Cerrar</button>
        `;

        Components.showModal('🚨 ¿Cuál es la emergencia?', bodyHTML, footerHTML);
    }

    // =============================================
    // Enviar detalles de la emergencia
    // =============================================
    async function submitSOSDetails(type) {
        if (!_currentAlertId) {
            console.warn('🚨 SOS: No hay alerta activa para actualizar');
            return;
        }

        const details = document.getElementById('sosDetails')?.value?.trim() || '';
        const emergencyDef = EMERGENCY_TYPES.find(t => t.key === type);

        try {
            console.log('🚨 SOS: Actualizando alerta', _currentAlertId, 'con tipo:', type);
            await firebaseDB.ref(`sos_alerts/${_currentAlertId}`).update({
                emergencyType: type,
                emergencyTypeLabel: emergencyDef ? `${emergencyDef.icon} ${emergencyDef.label}` : type,
                emergencyDetails: details,
                updated_at: new Date().toISOString()
            });

            Components.closeModal();
            Components.showToast(`${emergencyDef?.icon || '🚨'} Tipo de emergencia registrado: ${emergencyDef?.label || type}`, 'success');
            console.log('🚨 SOS: ✅ Detalles actualizados');
            _currentAlertId = null;
        } catch (e) {
            console.error('🚨 SOS: Error actualizando alerta:', e);
            Components.showToast('Error al actualizar: ' + e.message, 'danger');
        }
    }

    // =============================================
    // LISTENER DEL DUEÑO — escucha alertas SOS en tiempo real
    // =============================================
    function startListening() {
        const fleetId = Auth.getFleetId();
        const isOwner = Auth.isOwner();
        console.log('🚨 SOS LISTENER: Intentando activar. isOwner:', isOwner, '| fleetId:', fleetId);

        if (!isOwner) {
            console.log('🚨 SOS LISTENER: No es dueño, no se activa');
            return;
        }

        // Limpiar listener anterior si existe
        if (_sosListenerRef) {
            console.log('🚨 SOS LISTENER: Limpiando listener anterior');
            _sosListenerRef.off('child_added');
        }

        // Escuchar TODOS los sos_alerts nuevos (sin filtro orderByChild para evitar problemas de índice)
        _sosListenerRef = firebaseDB.ref('sos_alerts');
        
        // Usar limitToLast(1) + on('child_added') para solo captar nuevas alertas
        // Primero, registrar la marca de tiempo actual para ignorar alertas viejas
        const _listenerStartTime = Date.now();
        console.log('🚨 SOS LISTENER: Start time:', new Date(_listenerStartTime).toISOString());

        _sosListenerRef.on('child_added', (snap) => {
            const alertData = snap.val();
            if (!alertData) {
                console.log('🚨 SOS LISTENER: Snap sin datos, ignorando');
                return;
            }

            console.log('🚨 SOS LISTENER: child_added recibido:', snap.key);
            console.log('🚨 SOS LISTENER: alertData.fleetId:', alertData.fleetId, '| mi fleetId:', fleetId);
            console.log('🚨 SOS LISTENER: alertData.status:', alertData.status);
            console.log('🚨 SOS LISTENER: alertData.created_at:', alertData.created_at);

            // Filtrar: solo alertas activas
            if (alertData.status !== 'active') {
                console.log('🚨 SOS LISTENER: ⏩ Estado no es "active", ignorando');
                return;
            }

            // Filtrar: solo de mi flota (si tenemos fleetId, sino mostrar todas)
            if (fleetId && alertData.fleetId && alertData.fleetId !== fleetId && alertData.fleetId !== 'unknown') {
                console.log('🚨 SOS LISTENER: ⏩ FleetId no coincide, ignorando');
                return;
            }

            // Filtrar: solo alertas creadas DESPUÉS de que empezamos a escuchar
            const alertTime = new Date(alertData.created_at).getTime();
            if (alertTime < _listenerStartTime - 5000) { // 5s de gracia
                console.log('🚨 SOS LISTENER: ⏩ Alerta vieja (antes del listener), ignorando');
                return;
            }

            console.log('🚨 SOS LISTENER: ✅✅✅ ¡ALERTA VÁLIDA RECIBIDA! Mostrando notificación + alarma...');
            _startAlarm();
            _showOwnerSOSNotification(alertData);
        });

        console.log('🚨 SOS LISTENER: ✅ Listener activado para dueño en sos_alerts/');
    }

    function stopListening() {
        if (_sosListenerRef) {
            _sosListenerRef.off('child_added');
            _sosListenerRef = null;
            console.log('🚨 SOS LISTENER: Desactivado');
        }
    }

    // =============================================
    // Notificación al dueño
    // =============================================
    function _showOwnerSOSNotification(alert) {
        console.log('🚨 SOS OWNER: Mostrando modal de alerta para:', alert.driverName);

        const mapsLink = alert.mapsUrl
            ? `<a href="${alert.mapsUrl}" target="_blank" style="color:var(--color-primary); font-weight:700;">📍 Ver en Google Maps</a>`
            : '<span style="color:var(--text-tertiary);">📍 Ubicación no disponible</span>';

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
                    📡 Fuente GPS: ${alert.gpsSource === 'tracker' ? 'Rastreador IoT' : alert.gpsSource === 'mobile' ? 'Celular' : 'No disponible'}<br/>
                    🕐 ${new Date(alert.created_at).toLocaleString()}
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
        triggerSOS, submitSOSDetails, startListening, stopListening,
        resolveAlert, renderSOSButton, silenceAlarm: _stopAlarm
    };
})();
