/* ============================================
   FleetAdmin Pro — Motor de Voz KITT (v1.0)
   Sintetizador Premium con Fallback Inteligente
   
   Usa ElevenLabs (voz clonada de KITT Latino) cuando
   está disponible, y cae automáticamente al TTS del
   celular si el servidor no responde.
   ============================================ */

const KittVoice = (() => {
    let _isKittEnabled = localStorage.getItem('kittVoiceActive') !== 'false'; // ON por defecto
    let _isSpeaking = false;
    let _audioQueue = [];  // Cola de frases pendientes
    let _currentAudio = null;

    /**
     * Habla un texto usando la voz premium de KITT (ElevenLabs) si está
     * disponible, o cae al sintetizador genérico del navegador/celular.
     * 
     * @param {string} text - El texto a vocalizar.
     * @param {boolean} priority - Si es true, cancela lo que esté sonando e interrumpe.
     * @returns {Promise<void>}
     */
    async function speak(text, priority = false) {
        if (!text) return;

        const isVoiceEnabled = localStorage.getItem('radarVoice') !== 'off';
        if (!isVoiceEnabled) return;

        if (priority) {
            // Cortar todo lo que esté en cola/sonando
            _audioQueue = [];
            _stopCurrent();
        }

        if (_isSpeaking && !priority) {
            // Encolar si ya está hablando
            _audioQueue.push(text);
            return;
        }

        _isSpeaking = true;

        // Intentar KITT Premium
        if (_isKittEnabled) {
            const success = await _speakWithElevenLabs(text);
            if (success) {
                _isSpeaking = false;
                _processQueue();
                return;
            }
            // Si falló, cae al fallback local silenciosamente
            console.warn('🎙️ [KITT] ElevenLabs no disponible, usando voz local...');
        }

        // Fallback: Voz local del celular/navegador
        await _speakWithLocalTTS(text);
        _isSpeaking = false;
        _processQueue();
    }

    function _getApiBaseUrl() {
        const isLocalOrNative = window.location.hostname === 'localhost' || 
                               window.location.hostname === '127.0.0.1' ||
                               window.location.protocol === 'file:';
        return isLocalOrNative ? 'https://fleetadmin-pro-1.onrender.com' : window.location.origin;
    }

    /**
     * Intenta reproducir el texto usando ElevenLabs via el proxy del servidor.
     * @returns {Promise<boolean>} true si el audio se reprodujo correctamente.
     */
    function _speakWithElevenLabs(text) {
        return new Promise((resolve) => {
            try {
                const encodedText = encodeURIComponent(text);
                const baseUrl = _getApiBaseUrl();
                const url = `${baseUrl}/api/voice/tts?text=${encodedText}`;

                const audio = new Audio(url);
                _currentAudio = audio;

                audio.onended = () => {
                    _currentAudio = null;
                    resolve(true);
                };

                audio.onerror = () => {
                    console.warn('🎙️ [KITT] Error cargando audio ElevenLabs');
                    _currentAudio = null;
                    resolve(false);
                };

                // Timeout de seguridad: si en 12 segundos no arrancó, usar fallback
                const timeout = setTimeout(() => {
                    if (_currentAudio === audio) {
                        audio.pause();
                        audio.src = '';
                        _currentAudio = null;
                        resolve(false);
                    }
                }, 12000);

                audio.onplay = () => clearTimeout(timeout);

                audio.play().catch(() => {
                    clearTimeout(timeout);
                    _currentAudio = null;
                    resolve(false);
                });
            } catch (e) {
                resolve(false);
            }
        });
    }

    /**
     * Fallback: Voz del sistema operativo (SpeechSynthesis).
     */
    function _speakWithLocalTTS(text) {
        return new Promise((resolve) => {
            if (!window.speechSynthesis) {
                resolve();
                return;
            }

            window.speechSynthesis.cancel();

            const utter = new SpeechSynthesisUtterance(text);
            utter.lang = 'es-AR';
            utter.rate = 0.95; 
            utter.pitch = 0.85; // Tono más grave y masculino/robótico al estilo KITT
            utter.volume = 1.0;

            const voices = window.speechSynthesis.getVoices();
            // Priorizar una voz en español que contenga indicios de ser masculina en el sistema
            let esVoice = voices.find(v => v.lang.startsWith('es') && 
                (v.name.toLowerCase().includes('male') || 
                 v.name.toLowerCase().includes('hombre') || 
                 v.name.toLowerCase().includes('masculino') || 
                 v.name.toLowerCase().includes('mexico') || 
                 v.name.toLowerCase().includes('googlees'))); 
            
            if (!esVoice) esVoice = voices.find(v => v.lang.startsWith('es'));
            if (esVoice) utter.voice = esVoice;

            utter.onend = () => resolve();
            utter.onerror = () => resolve();

            window.speechSynthesis.speak(utter);
        });
    }

    function _stopCurrent() {
        if (_currentAudio) {
            _currentAudio.pause();
            _currentAudio.src = '';
            _currentAudio = null;
        }
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }
        _isSpeaking = false;
    }

    function _processQueue() {
        if (_audioQueue.length > 0) {
            const next = _audioQueue.shift();
            speak(next);
        }
    }

    function setKittEnabled(enabled) {
        _isKittEnabled = enabled;
        localStorage.setItem('kittVoiceActive', enabled ? 'true' : 'false');
        console.log(`🎙️ [KITT] Voz Premium ${_isKittEnabled ? 'ACTIVADA 🏎️' : 'DESACTIVADA'}`);
    }

    function isKittEnabled() {
        return _isKittEnabled;
    }

    /**
     * Test rápido: reproduce una frase de demostración.
     */
    function demo() {
        speak('Atención José. Sistemas de copiloto activados. Fotomulta a trescientos metros en Avenida Pellegrini esquina Ovidio Lagos. Velocidad máxima sesenta kilómetros por hora.', true);
    }

    return {
        speak,
        setKittEnabled,
        isKittEnabled,
        demo
    };
})();
