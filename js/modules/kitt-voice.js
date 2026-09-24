/* ============================================
   FleetAdmin Pro — Motor de Voz KITT (v1.1)
   Sintetizador Premium con Fallback Inteligente Ultra-Rápido
   
   Usa ElevenLabs (voz clonada de KITT) cuando está
   disponible, y cae instantáneamente al TTS nativo del
   celular (Android) o navegador si el servidor no responde.
   ============================================ */

const KittVoice = (() => {
    let _isKittEnabled = localStorage.getItem('kittVoiceActive') !== 'false'; // ON por defecto
    let _isSpeaking = false;
    let _audioQueue = [];  // Cola de frases pendientes
    let _currentAudio = null;
    let _elevenLabsLastFailTime = 0; // Si falló en los últimos 5 min, evitar esperar timeout de red

    /**
     * Habla un texto usando la voz premium de KITT (ElevenLabs) si está
     * disponible, o cae al sintetizador nativo del celular/navegador.
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

        try {
            // 1. Si estamos en Android Nativo (Capacitor/Java), priorizar la voz nativa del dispositivo
            // para máxima velocidad, volumen y confiabilidad instantánea en ruta.
            const isNative = (typeof window.NativeServiceBridge !== 'undefined' && typeof window.NativeServiceBridge.speak === 'function') ||
                             (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function');

            // Intentar KITT Premium por streaming solo si está habilitado y no hubo fallos recientes
            const isElevenLabsCoolingDown = (Date.now() - _elevenLabsLastFailTime) < 30000; // 30s cooldown si falló (era 5 min)
            if (_isKittEnabled && !isElevenLabsCoolingDown && !isNative) {
                const success = await _speakWithElevenLabs(text);
                if (success) {
                    return;
                }
                _elevenLabsLastFailTime = Date.now();
                console.warn('🎙️ [KITT] ElevenLabs no disponible, cambiando a voz del sistema...');
            }

            // Fallback directo: Voz nativa de Android o Web Speech API
            await _speakWithLocalTTS(text);
        } catch (e) {
            console.error('🎙️ [KITT] Error inesperado en speak():', e);
        } finally {
            _isSpeaking = false;
            _processQueue();
        }
    }

    function _getApiBaseUrl() {
        const isLocalOrNative = window.location.hostname === 'localhost' || 
                               window.location.hostname === '127.0.0.1' ||
                               window.location.protocol === 'file:';
        return isLocalOrNative ? 'https://fleetadmin-web-nueva.onrender.com' : window.location.origin;
    }

    /**
     * Intenta reproducir el texto usando ElevenLabs via el proxy del servidor.
     * Timeout defensivo ultra-rápido de 2.5s para no demorar al conductor.
     * @returns {Promise<boolean>} true si el audio se reprodujo correctamente.
     */
    function _speakWithElevenLabs(text) {
        return new Promise((resolve) => {
            try {
                const encodedText = encodeURIComponent(text);
                const baseUrl = _getApiBaseUrl();
                const url = `${baseUrl}/api/voice/tts?text=${encodedText}`;

                const audio = new Audio();
                _currentAudio = audio;

                let finished = false;
                const done = (ok) => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timeout);
                    if (_currentAudio === audio) _currentAudio = null;
                    resolve(ok);
                };

                audio.onended = () => done(true);
                audio.onerror = () => {
                    console.warn('🎙️ [KITT] Error de audio ElevenLabs → fallback TTS');
                    done(false);
                };

                // Timeout de 4 segundos: si Render no responde, pasar a TTS local
                // (aumentado de 2.5s para tolerar el cold-start de Render)
                const timeout = setTimeout(() => {
                    console.warn('🎙️ [KITT] Timeout ElevenLabs → fallback TTS');
                    try { audio.pause(); audio.src = ''; } catch (e) {}
                    done(false);
                }, 4000);

                // Cuando el audio empieza a reproducirse, cancelar el timeout de conexión
                audio.onplay = () => clearTimeout(timeout);

                audio.src = url;

                // Intentar reproducir usando boost si está disponible
                const playFn = (typeof window.playAudioWithBoost === 'function')
                    ? () => window.playAudioWithBoost(audio, 3.0)
                    : () => audio.play();

                const tryPlay = () => {
                    const p = playFn();
                    if (p && typeof p.catch === 'function') {
                        p.catch(err => {
                            // En Android WebView, autoplay puede ser bloqueado
                            // En ese caso, intentar audio.play() directamente como último recurso
                            console.warn('🎙️ [KITT] play() rechazado por autoplay policy:', err && err.message);
                            audio.play().catch(() => done(false));
                        });
                    }
                };

                // En Android, esperar el evento 'canplay' para asegurarse que el audio está listo
                audio.addEventListener('canplay', () => {
                    if (!finished) tryPlay();
                }, { once: true });

                // También intentar reproducir de inmediato
                tryPlay();

            } catch (e) {
                console.error('🎙️ [KITT] Error inesperado en _speakWithElevenLabs:', e);
                resolve(false);
            }
        });
    }

    /**
     * Fallback: Voz nativa de Android (vía NativeServiceBridge) o Web Speech API.
     */
    function _speakWithLocalTTS(text) {
        return new Promise((resolve) => {
            // 1. Android Nativo via NativeServiceBridge
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
                if (AndroidServices.speak(text)) {
                    console.log('🔊 [KITT] Hablando mediante AndroidServices.speak');
                    resolve();
                    return;
                }
            }
            if (window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
                try {
                    window.NativeServiceBridge.speak(text);
                    console.log('🔊 [KITT] Hablando mediante NativeServiceBridge.speak');
                    resolve();
                    return;
                } catch (e) {
                    console.warn('⚠️ Error invocando NativeServiceBridge.speak:', e);
                }
            }

            // 2. Navegador Web (Web Speech API)
            if (!window.speechSynthesis) {
                console.warn('🔇 [KITT] TTS no soportado en este entorno');
                resolve();
                return;
            }

            try {
                // Prevenir bloqueo en Chromium
                if (window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                }
                window.speechSynthesis.cancel();

                // Breve pausa para que Chromium libere el sintetizador
                setTimeout(() => {
                    try {
                        const utter = new SpeechSynthesisUtterance(text);
                        utter.lang = 'es-AR';
                        utter.rate = 0.95; 
                        utter.pitch = 0.90;
                        utter.volume = 1.0;

                        const voices = window.speechSynthesis.getVoices() || [];
                        let esVoice = voices.find(v => v.lang && v.lang.startsWith('es') && 
                            (v.name.toLowerCase().includes('male') || 
                             v.name.toLowerCase().includes('hombre') || 
                             v.name.toLowerCase().includes('masculino') || 
                             v.name.toLowerCase().includes('mexico') || 
                             v.name.toLowerCase().includes('googlees'))); 
                        
                        if (!esVoice) esVoice = voices.find(v => v.lang && v.lang.startsWith('es'));
                        if (esVoice) utter.voice = esVoice;

                        let resolved = false;
                        const complete = () => {
                            if (!resolved) {
                                resolved = true;
                                resolve();
                            }
                        };

                        utter.onend = complete;
                        utter.onerror = complete;

                        // Timeout de seguridad en caso de que onend no se invoque en Chrome
                        setTimeout(complete, 8000);

                        window.speechSynthesis.speak(utter);
                    } catch (e) {
                        resolve();
                    }
                }, 50);
            } catch (err) {
                resolve();
            }
        });
    }

    function _stopCurrent() {
        if (_currentAudio) {
            try {
                _currentAudio.pause();
                _currentAudio.src = '';
            } catch (e) {}
            _currentAudio = null;
        }
        if (window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch (e) {}
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
        speak('Atención. Sistemas de alerta de tránsito activos en tiempo real. Buen viaje.', true);
    }

    return {
        speak,
        setKittEnabled,
        isKittEnabled,
        demo
    };
})();
