/* ============================================
   FleetAdmin Pro — Módulo SOS
   Botón de emergencia con GPS tracker + fallback
   Alertas en tiempo real vía Firebase
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

    // --- 1. Get position from GPS Tracker (IoT device) ---
    async function _getTrackerPosition(vehicleId) {
        try {
            const snap = await Promise.race([
                firebaseDB.ref(`gps_tracker/${vehicleId}/last_position`).once('value'),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Tracker timeout')), 5000))
            ]);
            const data = snap.val();
            if (data && data.lat && data.lng) {
                console.log('📡 SOS: Posición del tracker obtenida', data.lat, data.lng);
                return { lat: data.lat, lng: data.lng, source: 'tracker' };
            }
            return null;
        } catch (e) {
            console.warn('📡 SOS: Tracker no disponible —', e.message);
            return null;
        }
    }

    // --- 2. Fallback: Get position from mobile device ---
    function _getMobilePosition() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                console.warn('📱 SOS: Geolocation API no soportada');
                resolve(null);
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    console.log('📱 SOS: Posición GPS del celular obtenida');
                    resolve({
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        source: 'mobile'
                    });
                },
                (err) => {
                    console.warn('📱 SOS: Error GPS celular —', err.message);
                    resolve(null);
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
            );
        });
    }

    // --- 3. Main SOS trigger ---
    async function triggerSOS(shiftId, vehicleId, vehicleName) {
        // Session guard
        if (!Auth.isLoggedIn()) {
            alert('Error: Sesión no encontrada. Por favor iniciá sesión nuevamente.');
            Router.navigate('login');
            return;
        }

        // Double confirmation to prevent accidental triggers  
        if (!confirm('🚨 ¿ESTÁS SEGURO DE ENVIAR UNA ALERTA SOS?\n\nEsto notificará inmediatamente al propietario de tu flota.')) {
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

        // Step 3: If no GPS at all, still send alert without coords
        if (!position) {
            position = { lat: null, lng: null, source: 'unavailable' };
            Components.showToast('⚠️ No se pudo obtener ubicación — enviando alerta sin coordenadas', 'warning');
        }

        // Build Google Maps URL
        const mapsUrl = position.lat
            ? `https://www.google.com/maps?q=${position.lat},${position.lng}`
            : '';

        // Step 4: Save alert to Firebase
        try {
            const alertRef = firebaseDB.ref('sos_alerts').push();
            const alertData = {
                id: alertRef.key,
                driverId: Auth.getUserId() || Auth.getUserName(),
                driverName: Auth.getUserName(),
                fleetId: Auth.getFleetId(),
                shiftId: shiftId,
                vehicleId: vehicleId,
                vehicleName: vehicleName || '',
                lat: position.lat,
                lng: position.lng,
                gpsSource: position.source,
                mapsUrl: mapsUrl,
                status: 'active',
                emergencyType: null,
                emergencyDetails: null,
                created_at: new Date().toISOString(),
                resolved_at: null
            };

            await alertRef.set(alertData);
            _currentAlertId = alertRef.key;

            Components.showToast('🚨 ¡ALERTA SOS ENVIADA! El propietario fue notificado.', 'danger');

            // Step 5: Open emergency type modal
            _showEmergencyModal();

        } catch (e) {
            console.error('SOS: Error guardando alerta:', e);
            Components.showToast('❌ Error al enviar SOS: ' + e.message, 'danger');
        }
    }

    // --- 5. Emergency type modal ---
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
                        style="resize:none;"></textarea>
                </div>
            </div>
        `;

        const footerHTML = `
            <button class="btn btn-ghost" onclick="Components.closeModal()">Cerrar</button>
        `;

        Components.showModal('🚨 ¿Cuál es la emergencia?', bodyHTML, footerHTML);
    }

    // --- 6. Submit emergency details ---
    async function submitSOSDetails(type) {
        if (!_currentAlertId) return;

        const details = document.getElementById('sosDetails')?.value?.trim() || '';
        const emergencyDef = EMERGENCY_TYPES.find(t => t.key === type);

        try {
            await firebaseDB.ref(`sos_alerts/${_currentAlertId}`).update({
                emergencyType: type,
                emergencyTypeLabel: emergencyDef ? `${emergencyDef.icon} ${emergencyDef.label}` : type,
                emergencyDetails: details,
                updated_at: new Date().toISOString()
            });

            Components.closeModal();
            Components.showToast(`${emergencyDef?.icon || '🚨'} Tipo de emergencia registrado: ${emergencyDef?.label || type}`, 'success');
            _currentAlertId = null;
        } catch (e) {
            console.error('SOS: Error actualizando alerta:', e);
            Components.showToast('Error al actualizar: ' + e.message, 'danger');
        }
    }

    // --- Owner: Listen for SOS alerts in real-time ---
    let _sosListener = null;

    function startListening() {
        if (_sosListener) return;

        const fleetId = Auth.getFleetId();
        if (!fleetId || !Auth.isOwner()) return;

        _sosListener = firebaseDB.ref('sos_alerts')
            .orderByChild('status')
            .equalTo('active')
            .on('child_added', (snap) => {
                const alert = snap.val();
                if (!alert || alert.fleetId !== fleetId) return;

                // Check if this alert is recent (last 30 seconds) to avoid replaying old alerts
                const age = Date.now() - new Date(alert.created_at).getTime();
                if (age > 30000) return;

                _showOwnerSOSNotification(alert);
            });

        console.log('🚨 SOS listener activado para dueño');
    }

    function stopListening() {
        if (_sosListener) {
            firebaseDB.ref('sos_alerts').off('child_added', _sosListener);
            _sosListener = null;
        }
    }

    function _showOwnerSOSNotification(alert) {
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
            <button class="btn btn-secondary" onclick="Components.closeModal()">Cerrar</button>
            ${alert.mapsUrl ? `<a href="${alert.mapsUrl}" target="_blank" class="btn btn-danger">📍 Abrir Mapa</a>` : ''}
            <button class="btn btn-primary" onclick="SOSModule.resolveAlert('${alert.id}')">✅ Marcar Resuelta</button>
        `;

        Components.showModal('🚨 ¡ALERTA SOS RECIBIDA!', bodyHTML, footerHTML);
    }

    // --- Resolve alert ---
    async function resolveAlert(alertId) {
        try {
            await firebaseDB.ref(`sos_alerts/${alertId}`).update({
                status: 'resolved',
                resolved_at: new Date().toISOString(),
                resolved_by: Auth.getUserName()
            });
            Components.closeModal();
            Components.showToast('✅ Alerta SOS marcada como resuelta', 'success');
        } catch (e) {
            Components.showToast('Error: ' + e.message, 'danger');
        }
    }

    // --- Render SOS button for active shift ---
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
        resolveAlert, renderSOSButton
    };
})();
