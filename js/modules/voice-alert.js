/* ============================================
   Punto Alertas — Módulo de Alertas de Voz (v1.2.161)
   Permite al chofer grabar un audio de 15s desde la app,
   subirlo a Firebase Storage y publicarlo como alerta GPS.
   ============================================ */

const VoiceAlertModule = (() => {
    let _mediaRecorder = null;
    let _audioChunks = [];
    let _activeStream = null;
    let _timerInterval = null;
    let _seconds = 0;
    let _selectedType = 'checkpoint';
    let _selectedMime = '';
    
    const MAX_RECORDING_SECONDS = 15;

    // Formatos de audio ordenados por prioridad de soporte
    const MIME_TYPES = [
        'audio/ogg; codecs=opus',
        'audio/webm; codecs=opus',
        'audio/webm',
        'audio/ogg',
        'audio/wav',
        'audio/mp4'
    ];

    /**
     * Muestra el modal de grabación e inicia el proceso.
     */
    function showRecordModal() {
        if (!Auth.isDriver()) {
            Components.showToast('⚠️ Solo los conductores pueden reportar alertas', 'warning');
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            Components.showToast('🎙️ Grabación de voz no soportada en este navegador', 'danger');
            return;
        }

        _selectedType = 'checkpoint'; // Reset por defecto
        _audioChunks = [];
        _seconds = 0;

        // Detectar tipo MIME compatible
        _selectedMime = '';
        for (const mime of MIME_TYPES) {
            if (MediaRecorder.isTypeSupported(mime)) {
                _selectedMime = mime;
                break;
            }
        }
        console.log(`🎙️ MIME Type seleccionado para grabación: ${_selectedMime || 'predeterminado'}`);

        const bodyHTML = `
            <div style="text-align:center; padding:var(--space-2);">
                <div class="voice-alert-record-container">
                    <div class="voice-alert-pulse-ring" id="voice-pulse-ring"></div>
                    <div class="voice-alert-record-icon" id="voice-record-icon">🎤</div>
                </div>
                
                <div style="font-size:1.8rem; font-weight:800; margin-bottom:var(--space-1); font-family:var(--font-family);" id="voice-timer">
                    0:00
                </div>
                <div style="font-size:var(--font-size-xs); color:var(--text-secondary); margin-bottom:var(--space-4);" id="voice-alert-status">
                    Grabando... Máx 15 segundos
                </div>

                <div style="font-weight:700; margin-bottom:var(--space-2); font-size:var(--font-size-sm); color:var(--text-primary); text-align:left;">
                    Seleccioná el tipo de alerta:
                </div>
                <div class="voice-alert-badge-grid">
                    <button class="voice-badge active" data-type="checkpoint" onclick="VoiceAlertModule.selectType('checkpoint', this)">
                        🚧 Control
                    </button>
                    <button class="voice-badge" data-type="police" onclick="VoiceAlertModule.selectType('police', this)">
                        🚔 Policía
                    </button>
                    <button class="voice-badge" data-type="municipal" onclick="VoiceAlertModule.selectType('municipal', this)">
                        🦊 Inspector
                    </button>
                    <button class="voice-badge" data-type="warning" onclick="VoiceAlertModule.selectType('warning', this)">
                        ⚠️ Peligro
                    </button>
                </div>
            </div>
        `;

        const footerHTML = `
            <button class="btn btn-secondary" onclick="VoiceAlertModule.cancelRecording()" style="font-weight:600; flex:1;">
                ❌ Cancelar
            </button>
            <button class="btn btn-primary" onclick="VoiceAlertModule.stopAndSend()" id="btn-voice-send" style="font-weight:700; flex:1; background:linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); border:none;">
                🚀 Enviar Alerta
            </button>
        `;

        // Backdrop estático para que no se cierre sin querer
        Components.showModal('🎙️ Reportar Alerta de Voz', bodyHTML, footerHTML, {
            staticBackdrop: true,
            onClose: function() {
                VoiceAlertModule.cancelRecording();
            }
        });

        // Iniciar la grabación inmediatamente
        _startRecordingProcess();
    }

    /**
     * Inicia captura y temporizador.
     */
    async function _startRecordingProcess() {
        try {
            _activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            const options = _selectedMime ? { mimeType: _selectedMime } : undefined;
            _mediaRecorder = new MediaRecorder(_activeStream, options);
            
            _mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    _audioChunks.push(e.data);
                }
            };

            _mediaRecorder.onstop = async () => {
                // Detener todas las pistas de audio para cerrar el micrófono de forma garantizada
                if (_activeStream) {
                    _activeStream.getTracks().forEach(track => {
                        track.enabled = false;
                        track.stop();
                    });
                    _activeStream = null;
                }
                await _processRecordedAudio();
            };

            _mediaRecorder.start();
            
            // Iniciar animación y temporizador
            const pulse = document.getElementById('voice-pulse-ring');
            if (pulse) pulse.classList.add('recording');

            _timerInterval = setInterval(() => {
                _seconds++;
                
                const displaySeconds = _seconds < 10 ? `0${_seconds}` : _seconds;
                const timerEl = document.getElementById('voice-timer');
                if (timerEl) {
                    timerEl.innerText = `0:${displaySeconds}`;
                }

                if (_seconds >= MAX_RECORDING_SECONDS) {
                    console.log('🎙️ Límite de 15s alcanzado. Deteniendo grabación...');
                    stopAndSend();
                }
            }, 1000);

        } catch (err) {
            console.error('❌ Error al acceder al micrófono:', err);
            Components.showToast('⚠️ No se pudo acceder al micrófono. Otorgá los permisos necesarios.', 'danger');
            Components.closeModal();
        }
    }

    /**
     * Selecciona el tipo de alerta.
     */
    function selectType(type, element) {
        _selectedType = type;
        
        // Quitar active de todos los botones en el modal
        const badges = document.querySelectorAll('.voice-badge');
        badges.forEach(b => b.classList.remove('active'));
        
        // Agregar active al seleccionado
        if (element) element.classList.add('active');
    }

    /**
     * Detiene la grabación y dispara el envío automático.
     */
    function stopAndSend() {
        if (_timerInterval) {
            clearInterval(_timerInterval);
            _timerInterval = null;
        }

        const pulse = document.getElementById('voice-pulse-ring');
        if (pulse) pulse.classList.remove('recording');

        // Deshabilitar botón enviar para evitar doble click
        const sendBtn = document.getElementById('btn-voice-send');
        if (sendBtn) sendBtn.disabled = true;

        const statusEl = document.getElementById('voice-alert-status');
        if (statusEl) statusEl.innerText = 'Procesando audio...';

        if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
            _mediaRecorder.stop();
        }
    }

    /**
     * Cancela la grabación descartando todo.
     */
    function cancelRecording() {
        if (_timerInterval) {
            clearInterval(_timerInterval);
            _timerInterval = null;
        }

        if (_mediaRecorder) {
            _mediaRecorder.onstop = null; // Evitar que se gatille el envío al detener
            if (_mediaRecorder.state !== 'inactive') {
                _mediaRecorder.stop();
            }
        }

        if (_activeStream) {
            _activeStream.getTracks().forEach(track => {
                track.enabled = false;
                track.stop();
            });
            _activeStream = null;
        }

        _audioChunks = [];
        Components.closeModal();
        console.log('🎙️ Grabación cancelada por el usuario');
    }

    /**
     * Procesa, sube y publica la alerta con geolocalización.
     */
    async function _processRecordedAudio() {
        if (_audioChunks.length === 0) {
            Components.showToast('⚠️ Audio vacío o corrupto', 'danger');
            Components.closeModal();
            return;
        }

        const statusEl = document.getElementById('voice-alert-status');
        if (statusEl) statusEl.innerText = 'Obteniendo ubicación GPS...';

        // Obtener geolocalización de alta precisión
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                try {
                    if (statusEl) statusEl.innerText = 'Subiendo audio al servidor...';

                    // Generar extensión adecuada
                    let ext = 'webm';
                    if (_selectedMime.includes('ogg')) ext = 'ogg';
                    else if (_selectedMime.includes('mp4')) ext = 'mp4';
                    else if (_selectedMime.includes('wav')) ext = 'wav';

                    const blob = new Blob(_audioChunks, { type: _selectedMime || 'audio/webm' });
                    
                    // Subir a Firebase Storage
                    const fleetId = Auth.getFleetId();
                    const timestamp = Date.now();
                    const path = `audio_alertas/${fleetId}/alert_${timestamp}.${ext}`;
                    
                    const storageRef = firebaseStorage.ref(path);
                    const snapshot = await storageRef.put(blob, { contentType: blob.type });
                    const audioUrl = await snapshot.ref.getDownloadURL();

                    if (statusEl) statusEl.innerText = 'Publicando alerta en tiempo real...';

                    const alertId = `alert_voice_${timestamp}`;
                    
                    // Nombres legibles para la ubicación
                    let locationLabel = 'Alerta de Tránsito';
                    if (_selectedType === 'police') locationLabel = 'Operativo Policial';
                    else if (_selectedType === 'checkpoint') locationLabel = 'Control de Tránsito';
                    else if (_selectedType === 'municipal') locationLabel = 'Inspector Municipal';
                    else if (_selectedType === 'warning') locationLabel = 'Peligro Vial';

                    const author = Auth.getUserName() || 'Chofer';

                    const alertData = {
                        id: alertId,
                        type: _selectedType,
                        location: `${locationLabel} (reporte de ${author})`,
                        lat: lat,
                        lng: lng,
                        timestamp: timestamp,
                        expiresAt: timestamp + (60 * 60 * 1000), // Expiración: 60 minutos
                        authorName: author,
                        status: 'active',
                        audioUrl: audioUrl,
                        originalText: '[REPORTE_DE_VOZ]',
                        description: `Alerta de voz reportada por ${author}`
                    };

                    // Publicar en la Base de Datos en Tiempo Real
                    await firebaseDB.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(alertData);

                    console.log(`✅ [VOICE-ALERT] Publicada con éxito: ${alertId} (${_selectedType})`);
                    Components.closeModal();
                    Components.showToast('🚨 Alerta de voz compartida con éxito', 'success');

                } catch (err) {
                    console.error('❌ Error subiendo/publicando alerta de voz:', err);
                    if (statusEl) statusEl.innerText = 'Error al enviar.';
                    Components.showToast(`❌ Error: ${err.message || 'Error desconocido'}`, 'danger');
                    Components.closeModal();
                }
            },
            (geoErr) => {
                console.error('❌ Error de Geolocalización:', geoErr);
                Components.showToast('⚠️ No se pudo obtener tu ubicación GPS. Activá el GPS e intentalo nuevamente.', 'danger');
                Components.closeModal();
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    return {
        showRecordModal,
        selectType,
        stopAndSend,
        cancelRecording
    };
})();
