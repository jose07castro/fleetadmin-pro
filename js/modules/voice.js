/* ============================================
   FleetAdmin Pro — Módulo de Voz IA (v120)
   Hands-free: Comando "ALERTA" -> Conversación -> Registro GPS
   ============================================ */

const VoiceModule = (() => {
    let _recognition = null;
    let _isListeningWakeWord = false;
    let _isConversing = false;
    let _voiceEnabled = false;
    let _voiceProfile = null;
    
    // Audio buffering for biometrics
    let _audioCtx = null;
    let _rollingBuffer = []; // Array of Float32Array (chunks)
    let _stream = null;
    let _processor = null;
    const BUFFER_MAX_SIZE = 44100 * 2; // 2 segundos a 44.1kHz

    // Configuración de palabras clave
    const WAKE_WORD = 'alerta';
    const ALERTS_MAP = {
        'policial': 'police',
        'policía': 'police',
        'operativo': 'police',
        'tránsito': 'warning',
        'control': 'police',
        'vía': 'warning',
        'corte': 'warning',
        'siniestro': 'warning',
        'choque': 'warning',
        'accidente': 'warning'
    };

    /**
     * Inicializa el motor de reconocimiento de voz.
     */
    function init() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.warn('🎙️ VoiceModule: Reconocimiento de voz no soportado en este navegador.');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        _recognition = new SpeechRecognition();
        _recognition.lang = 'es-ES';
        _recognition.continuous = true;
        _recognition.interimResults = false;

        _recognition.onresult = (event) => {
            if (_isConversing) return; // Procesado por el flujo conversacional

            const result = event.results[event.results.length - 1][0].transcript.toLowerCase();
            console.log('🎙️ Reconocido:', result);

            if (result.includes(WAKE_WORD)) {
                _verifyAndStartConversation();
            }
        };

        _recognition.onend = () => {
            if (_voiceEnabled && !_isConversing) {
                _recognition.start(); // Reiniciar escucha de wake-word
            }
        };

        _recognition.onerror = (e) => {
            console.error('🎙️ Error de voz:', e.error);
            if (e.error === 'not-allowed') _voiceEnabled = false;
        };

        // Cargar perfil de voz (Biometría)
        _loadVoiceProfile();

        // Cargar preferencia del usuario
        _voiceEnabled = localStorage.getItem('fleetadmin_voice_enabled') === 'true';
        if (_voiceEnabled) {
            start();
        }
    }

    async function _loadVoiceProfile() {
        const userId = Auth.getUserId();
        if (!userId) return;

        // 1. Intentar local
        const local = localStorage.getItem(`voice_profile_${userId}`);
        if (local) {
            _voiceProfile = JSON.parse(local);
            console.log('🛡️ Biometría: Perfil local cargado.');
        }

        // 2. Intentar Firebase (sincro)
        const fleetId = Auth.getFleetId();
        if (fleetId) {
            try {
                const snap = await firebaseDB.ref(`fleets/${fleetId}/users/${userId}/voiceProfile`).once('value');
                if (snap.exists()) {
                    _voiceProfile = snap.val();
                    localStorage.setItem(`voice_profile_${userId}`, JSON.stringify(_voiceProfile));
                    console.log('🛡️ Biometría: Perfil sincronizado desde Firebase.');
                }
            } catch (e) {
                console.warn('🛡️ Biometría: Error cargando perfil remoto:', e);
            }
        }
    }

    function start() {
        _voiceEnabled = true;
        localStorage.setItem('fleetadmin_voice_enabled', 'true');
        try {
            _recognition.start();
            _startRollingBuffer(); // Iniciar captura para biometría
            _isListeningWakeWord = true;
            console.log('🎙️ Wake-word "ALERTA" activado');
            if (typeof Components !== 'undefined') Components.showToast('🎙️ Modo Manos Libres activado', 'info');
        } catch (e) {}
    }

    function stop() {
        _voiceEnabled = false;
        localStorage.setItem('fleetadmin_voice_enabled', 'false');
        _recognition.stop();
        _isListeningWakeWord = false;
        console.log('🎙️ Voz desactivada');
    }

    /**
     * Flujo Conversacional: ALERTA -> PREGUNTA -> RESPUESTA -> REGISTRO
     */
    async function _startConversation() {
        if (_isConversing) return;
        _isConversing = true;
        
        // 1. Feedback sonoro
        _playBeep(880, 0.1);

        // 2. Preguntar
        await _speak('¿Qué tipo de alerta querés registrar?');

        // 3. Escuchar respuesta específica
        _listenForResponse();
    }

    function _listenForResponse() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const respRec = new SpeechRecognition();
        respRec.lang = 'es-ES';
        respRec.interimResults = false;
        respRec.maxAlternatives = 1;

        respRec.onresult = async (event) => {
            const transcript = event.results[0][0].transcript.toLowerCase();
            console.log('🎙️ Respuesta detectada:', transcript);

            let detectedType = null;
            for (const [key, value] of Object.entries(ALERTS_MAP)) {
                if (transcript.includes(key)) {
                    detectedType = { label: key, type: value };
                    break;
                }
            }

            if (detectedType) {
                await _registerAlert(detectedType);
            } else {
                await _speak('No entendí el tipo de alerta. Por favor, repetila.');
                _isConversing = false; // Permitir reintento por wake-word
            }
        };

        respRec.onend = () => {
            if (_isConversing) _isConversing = false;
        };

        respRec.start();
    }

    async function _registerAlert(alertInfo) {
        // 1. Obtener ubicación actual
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            const fleetId = Auth.getFleetId();
            if (!fleetId) return;

            const alertId = `voice_${Date.now()}`;
            const alertData = {
                id: alertId,
                type: alertInfo.type,
                location: `Reporte por voz: ${alertInfo.label}`,
                lat: latitude,
                lng: longitude,
                timestamp: Date.now(),
                expiresAt: Date.now() + (60 * 60 * 1000),
                authorName: Auth.getUserName() || 'Chofer',
                confirmations: 1,
                status: 'active',
                source: 'voice'
            };

            await firebaseDB.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(alertData);
            
            // 2. Confirmación final
            await _speak('Alerta registrada, gracias Jose');
            _isConversing = false;
        }, (err) => {
            _speak('Error al obtener tu ubicación. No se pudo registrar.');
            _isConversing = false;
        });
    }

    // --- Manejo del Rolling Buffer para Biometría ---

    async function _startRollingBuffer() {
        try {
            if (_audioCtx) return;
            
            _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const source = _audioCtx.createMediaStreamSource(_stream);
            
            // Usar ScriptProcessor para capturar buffers en tiempo real
            _processor = _audioCtx.createScriptProcessor(4096, 1, 1);
            
            source.connect(_processor);
            _processor.connect(_audioCtx.destination);
            
            _processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                // Guardar una copia
                _rollingBuffer.push(new Float32Array(inputData));
                
                // Mantener solo los últimos ~2-3 segundos
                const totalSamples = _rollingBuffer.length * 4096;
                if (totalSamples > BUFFER_MAX_SIZE * 1.5) {
                    _rollingBuffer.shift();
                }
            };
        } catch (e) {
            console.warn('🛡️ Biometría: No se pudo iniciar el buffer continuo:', e);
        }
    }

    async function _verifyAndStartConversation() {
        if (_isConversing) return;

        // 1. Si no hay perfil, permitir pero avisar
        if (!_voiceProfile) {
            console.log('🛡️ Biometría: Sin perfil. Permitiendo por defecto.');
            _startConversation();
            return;
        }

        // 2. Extraer buffer actual (últimos 2 segundos)
        const totalSamples = _rollingBuffer.length * 4096;
        const mergedBuffer = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of _rollingBuffer) {
            mergedBuffer.set(chunk, offset);
            offset += chunk.length;
        }

        // Crear un AudioBuffer para Biometrics
        const audioBuffer = _audioCtx.createBuffer(1, mergedBuffer.length, _audioCtx.sampleRate);
        audioBuffer.copyToChannel(mergedBuffer, 0);

        // 3. Verificar Identidad
        const isAuthorized = await Biometrics.verifySpeaker(audioBuffer, _voiceProfile);

        if (isAuthorized) {
            console.log('✅ Biometría: Chofer autorizado.');
            _startConversation();
        } else {
            console.warn('🚫 Biometría: Intento no autorizado detectado. Ignorando.');
            // Opcional: Feedback visual discreto
        }
    }

    // --- Helpers de Audio ---

    function _speak(text) {
        return new Promise((resolve) => {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'es-ES';
            utterance.onend = () => resolve();
            window.speechSynthesis.speak(utterance);
        });
    }

    function _playBeep(freq, duration) {
        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const osc = context.createOscillator();
            const gain = context.createGain();
            osc.connect(gain);
            gain.connect(context.destination);
            osc.frequency.value = freq;
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.00001, context.currentTime + duration);
            osc.stop(context.currentTime + duration);
        } catch (e) {}
    }

    function isEnabled() { return _voiceEnabled; }

    return { init, start, stop, isEnabled };
})();
