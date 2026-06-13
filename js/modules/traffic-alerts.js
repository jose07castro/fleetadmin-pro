/* ============================================
   FleetAdmin Pro — Módulo de Detección de Alertas (v120)
   Detección de "lunfardo rosarino" y geocodificación
   de operativos en tiempo real.
   ============================================ */

    const TrafficAlerts = (() => {
    // Diccionario de lunfardo y palabras clave
    const KEYWORDS = [
        'gorra', 'operativo', 'control', 'zorros', 'palo', 
        'chanchos', 'parando', 'evitar zona', 'transito',
        'radar', 'camara', 'cámara', 'fotomulta', 'foto multa', 'radar móvil', 'radar movil'
    ];

    const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
    const DEFAULT_BOUNDS = ''; // Se define dinámicamente o se deja abierto para internacionalización
    
    let _geocodeCache = {}; // { query: { lat, lng, timestamp } }
    let _isProcessing = false;
    let _initialized = false;
    let _activeFleetId = null;
    let _activeVoiceRef = null;
    let _activeVoiceCallback = null;

    /**
     * Procesa un mensaje de comunidad para detectar alertas.
     * @param {object} post - El objeto del post de Firebase.
     */
    async function processPost(post) {
        if (!post || !post.content) return;
        
        const content = post.content.toLowerCase();
        
        // 1. Detección de palabras clave
        const hasKeyword = KEYWORDS.some(k => content.includes(k));
        if (!hasKeyword) return;

        console.log('🚨 TrafficAlerts: Posible alerta detectada:', post.content);

        // 2. Extraer intersección (regex para Rosario: "Calle y Calle")
        const intersection = _extractIntersection(post.content);
        if (!intersection) {
            console.log('🚨 TrafficAlerts: No se pudo extraer una ubicación clara.');
            return;
        }

        // 3. Geocodificar (con cache y rate limiting)
        const coords = await geocodeIntersection(intersection);
        if (coords) {
            console.log('🚨 TrafficAlerts: Alerta geocodificada en:', coords);
            await _publishAlert(post, intersection, coords);
        }
    }

    /**
     * Extrae nombres de calles de un texto (formato "Calle y Calle" o "Calle esq Calle")
     */
    function _extractIntersection(text) {
        // Regex mejorada para capturar intersecciones rosarinas comunes
        // Captura: "Pellegrini y Belgrano", "Av Peron esq San Martin", "Cafferata e/ Cordoba"
        const regex = /([A-Záéíóúñ0-9.\s]{3,})\s+(y|esq|esquina|entre|e\/)\s+([A-Záéíóúñ0-9.\s]{3,})/i;
        const match = text.match(regex);
        
        if (match) {
            const calle1 = match[1].trim();
            const calle3 = match[3].trim();
            // Limpiar posibles ruidos al final (puntos, comas, etc)
            return `${calle1} y ${calle3}`;
        }
        return null;
    }

    /**
     * Convierte una dirección/intersección en coordenadas usando Nominatim.
     */
    async function geocodeIntersection(query) {
        try {
            const url = `${NOMINATIM_BASE}?format=json&q=${encodeURIComponent(query)}&${DEFAULT_BOUNDS}`;
            const response = await fetch(url, {
                headers: { 'Accept-Language': 'es' }
            });
            const data = await response.json();
            _isProcessing = false;

            if (data && data.length > 0) {
                const result = {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon)
                };
                _geocodeCache[query] = { coords: result, timestamp: Date.now() };
                return result;
            }
        } catch (e) {
            console.warn('🚨 TrafficAlerts: Error en geocoding:', e);
            _isProcessing = false;
        }
        return null;
    }

    /**
     * Publica la alerta en el nodo global de Firebase.
     */
    async function _publishAlert(post, location, coords) {
        if (typeof firebaseDB === 'undefined' || typeof Auth === 'undefined') return;

        const fleetId = Auth.getFleetId();
        if (!fleetId) return;

        const alertId = `alert_${Date.now()}`;
        const alertData = {
            id: alertId,
            type: _getAlertType(post.content),
            location: location,
            lat: coords.lat,
            lng: coords.lng,
            timestamp: Date.now(),
            expiresAt: Date.now() + (60 * 60 * 1000), // 60 minutos
            authorName: post.author_name || 'Comunidad',
            originalPostId: post.id || null,
            confirmations: 0,
            status: 'active'
        };

        try {
            await firebaseDB.ref(`fleets/${fleetId}/traffic_alerts/${alertId}`).set(alertData);
            console.log('✅ TrafficAlerts: Alerta compartida con la flota.');
            
            // Notificar localmente si estamos en la app
            if (typeof Components !== 'undefined' && Components.showToast) {
                Components.showToast(`🚨 Alerta detectada: ${location}`, 'danger');
            }
        } catch (e) {
            console.error('🚨 TrafficAlerts: Error publicando alerta:', e);
        }
    }

    function _getAlertType(text) {
        const t = text.toLowerCase();
        const policeKeywords = ['gorra', 'chanchos', 'policia', 'policía', 'cana', 'ratis', 'patrulla'];
        if (policeKeywords.some(k => t.includes(k))) return 'police';
        const checkpointKeywords = ['operativo', 'control', 'zorros'];
        if (checkpointKeywords.some(k => t.includes(k))) return 'checkpoint';
        const radarKeywords = ['radar', 'camara', 'cámara', 'fotomulta', 'foto multa', 'radar móvil', 'radar movil'];
        if (radarKeywords.some(k => t.includes(k))) return 'radar';
        return 'warning';
    }

    // Registra el milisegundo en que inició la aplicación (con 3s de tolerancia)
    // para ignorar alertas viejas y cantar únicamente lo que sea de este segundo en adelante.
    const _appStartTime = Date.now() - 3000;

    /**
     * Anuncia la alerta por voz usando Web Speech API de manera GLOBAL.
     * Funciona con mapa abierto, cerrado y con la app corriendo de fondo.
     */
    function speakAlert(type, location, originalText = '') {
        const isVoiceEnabled = localStorage.getItem('radarVoice') !== 'off';
        if (!isVoiceEnabled) return;

        const voiceMessages = {
            police:     'Atención. Control de policía',
            checkpoint: 'Atención. Operativo o control en la zona',
            radar:      'Cuidado. Radar de velocidad',
            helicopter: 'Alerta. Helicóptero sanitario en zona',
            ambulance:  'Precaución. Ambulancia en la vía',
            firetruck:  'Atención. Bomberos en la vía',
            municipal:  'Cuidado. Control municipal de tránsito',
            accident:   'Atención. Accidente vial reportado',
            traffic:    'Aviso. Tráfico lento reportado',
            warning:    'Atención. Alerta de tráfico',
        };

        const msg = voiceMessages[type] || voiceMessages.warning;
        const loc = location ? location.replace(' (ubicación aprox.)', '').replace(' y ', ' esquina ') : '';
        
        let fullText = '';
        // Si hay texto original de WhatsApp, usarlo para cantar TODO tal cual llegó
        if (originalText && originalText !== '[REPORTE_DE_VOZ]') {
            let cleanText = originalText
                .replace(/https?:\/\/\S+/gi, '') // Quitar enlaces HTTP
                .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ ]/g, ' ') // Dejar ÚNICAMENTE letras, acentos, números y espacios. Elimina markdown, emojis y puntuación ruidosa.
                .replace(/\s+/g, ' ') // Normalizar espacios múltiples a uno solo
                .trim();

            // Censurar palabras prohibidas para la síntesis de voz (KITT Voice)
            const forbidden = [
                'boludo', 'boluda', 'puto', 'puta', 'conchudo', 'conchuda', 'concha', 'tarado', 'tarada',
                'hijo de puta', 'hija de puta', 'hdp', 'forro', 'forra', 'pelotudo', 'pelotuda', 'orto',
                'pajero', 'pajera', 'cagon', 'cagona', 'culiao', 'culiada', 'pija', 'chota', 'mierda',
                'trola', 'trolo'
            ];
            forbidden.forEach(word => {
                const regex = new RegExp(`\\b${word}\\b`, 'gi');
                cleanText = cleanText.replace(regex, '***');
            });
            
            // Si tras la limpieza quedó algo inteligible, lo cantamos. Si no, usamos el fallback genérico.
            if (cleanText.length > 2) {
                fullText = `Atención: ${cleanText}.`;
            } else {
                fullText = loc ? `${msg} en ${loc}. Precaución.` : `${msg}. Precaución.`;
            }
        } else {
            fullText = loc ? `${msg} en ${loc}. Precaución.` : `${msg}. Precaución.`;
        }

        // Repetir el aviso para asegurar la recepción del chofer
        fullText = `${fullText} Repito. ${fullText}`;

        // === VOZ PREMIUM KITT (con fallback automático a voz local) ===
        if (typeof KittVoice !== 'undefined') {
            KittVoice.speak(fullText, true);
        } else {
            // Fallback directo si KittVoice no cargó
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
                const utter = new SpeechSynthesisUtterance(fullText);
                utter.lang = 'es-AR';
                utter.rate = 0.9;
                window.speechSynthesis.speak(utter);
            }
        }
        console.log(`🔊 [GLOBAL VOZ] "${fullText}"`);
    }

    /**
     * Inicia la escucha de alertas de tráfico para anuncios globales por voz.
     * Escucha el nodo GLOBAL — funciona para TODOS los celulares con la app,
     * independientemente de si el usuario está logueado o a qué flota pertenece.
     */
    function startGlobalVoiceListener() {
        if (typeof firebaseDB === 'undefined') return;

        // Si ya estamos escuchando el nodo global, no hacer nada
        if (_activeFleetId === '__GLOBAL__') {
            console.log(`📡 [VOZ-GLOBAL] Ya escuchando nodo global_traffic_alerts`);
            return;
        }

        // Si estábamos escuchando otro nodo, apagar el listener anterior
        if (_activeVoiceRef && _activeVoiceCallback) {
            console.log(`📡 [VOZ-GLOBAL] Cambiando a nodo global. Apagando listener anterior...`);
            try {
                _activeVoiceRef.off('child_added', _activeVoiceCallback);
            } catch(e) {
                console.warn('Error apagando listener anterior:', e);
            }
        }

        console.log(`📡 [VOZ-GLOBAL] Conectado a global_traffic_alerts. Todos los alertas llegarán a este dispositivo.`);
        const alertRef = firebaseDB.ref(`global_traffic_alerts`);
        _activeFleetId = '__GLOBAL__';
        _activeVoiceRef = alertRef;

        _activeVoiceCallback = (snap) => {
            const alert = snap.val();
            if (!alert || alert.status !== 'active') return;

            // FILTRO 1: Solo cantar alertas NUEVAS (posteriores al arranque de la app)
            const isVeryRecent = alert.timestamp && (Date.now() - alert.timestamp) < 30000;
            if (alert.timestamp && alert.timestamp < _appStartTime && !isVeryRecent) {
                console.log('📡 [VOZ-GLOBAL] Alerta histórica ignorada (antigua al arranque). ts:', alert.timestamp, 'start:', _appStartTime);
                return; 
            }

            // FILTRO 2: Si la alerta ya expiró, silenciarla.
            if (alert.expiresAt && alert.expiresAt < Date.now()) {
                console.log('📡 [VOZ-GLOBAL] Alerta expirada, silenciada.');
                return;
            }

            console.log('🔊 [GLOBAL VOICE] Nueva alerta en vivo:', alert.type, alert.location, alert.audioUrl ? '(audio original)' : '(voz sintetizada)');

            // Si la alerta tiene un audio original de WhatsApp, reproducirlo tal cual (sin TTS)
            if (alert.audioUrl) {
                const serverUrl = (window.location.hostname === 'localhost' || 
                                   window.location.hostname === '127.0.0.1' ||
                                   window.location.protocol === 'file:') 
                                   ? 'https://fleetadmin-web-nueva.onrender.com' 
                                   : window.location.origin;
                const fullAudioUrl = alert.audioUrl.startsWith('http') 
                    ? alert.audioUrl 
                    : `${serverUrl}${alert.audioUrl}`;
                console.log(`🎵 [AUDIO-ORIGINAL] Intentando reproducir audio de WhatsApp: ${fullAudioUrl}`);
                
                let audioPlayed = false;
                try {
                    const audio = new Audio(fullAudioUrl);
                    audio.volume = 1.0;
                    audio.preload = 'auto';

                    let repeated = false;
                    audio.onended = () => {
                        if (!repeated) {
                            repeated = true;
                            console.log('🎵 [AUDIO-ORIGINAL] Finalizado, iniciando repetición...');
                            if (typeof KittVoice !== 'undefined') {
                                KittVoice.speak('Repito', true).then(() => {
                                    const repeatPromise = (typeof window.playAudioWithBoost === 'function')
                                        ? window.playAudioWithBoost(audio, 3.0)
                                        : audio.play();
                                    repeatPromise.catch(e => console.error('Error al repetir audio:', e));
                                });
                            } else if (window.speechSynthesis) {
                                const utter = new SpeechSynthesisUtterance('Repito');
                                utter.lang = 'es-AR';
                                utter.onend = () => {
                                    const repeatPromise = (typeof window.playAudioWithBoost === 'function')
                                        ? window.playAudioWithBoost(audio, 3.0)
                                        : audio.play();
                                    repeatPromise.catch(e => console.error('Error al repetir audio:', e));
                                };
                                window.speechSynthesis.speak(utter);
                            }
                        }
                    };

                    // Intentar reproducir directamente
                    const playPromise = (typeof window.playAudioWithBoost === 'function')
                        ? window.playAudioWithBoost(audio, 3.0)
                        : audio.play();

                    playPromise
                        .then(() => {
                            audioPlayed = true;
                            console.log('🎵 [AUDIO-ORIGINAL] Reproducción iniciada directamente.');
                        })
                        .catch(audioErr => {
                            console.warn('⚠️ [AUDIO-ORIGINAL] Play directo falló, esperando evento canplay...', audioErr.message);
                        });

                    // Evento canplay para móviles
                    audio.addEventListener('canplay', () => {
                        if (!audioPlayed) {
                            const canPlayPromise = (typeof window.playAudioWithBoost === 'function')
                                ? window.playAudioWithBoost(audio, 3.0)
                                : audio.play();

                            canPlayPromise
                                .then(() => {
                                    audioPlayed = true;
                                    console.log('🎵 [AUDIO-ORIGINAL] Reproducción iniciada en evento canplay.');
                                })
                                .catch(err => {
                                    console.error('❌ [AUDIO-ORIGINAL] Error en canplay:', err.message);
                                });
                        }
                    });

                    // Loguear resguardo si no reproduce tras 10s
                    setTimeout(() => {
                        if (!audioPlayed) {
                            console.warn('⚠️ [AUDIO-ORIGINAL] No se detectó reproducción tras 10s (posible bloqueo de autoplay o red lenta).');
                        }
                    }, 10000);

                } catch (audioEx) {
                    console.error('❌ [AUDIO-ORIGINAL] Error al instanciar o reproducir audio:', audioEx.message);
                }
            } else {
                speakAlert(alert.type, alert.location, alert.originalText);
            }
        };

        // Escucha en tiempo real del nodo global
        alertRef.on('child_added', _activeVoiceCallback);
    }

    /**
     * Listener para monitorear nuevos posts de comunidad.
     */
    function init() {
        if (_initialized) {
            // Si ya se inicializó, solo aseguramos que el listener de voz esté activo/actualizado
            startGlobalVoiceListener();
            return;
        }
        _initialized = true;

        console.log('📡 TrafficAlerts: Iniciando monitoreo de comunidad y voz global...');
        
        if (typeof firebaseDB === 'undefined') return;

        // 1. Escuchar nuevos posts de comunidad (existente)
        const postsRef = firebaseDB.ref('community_posts').limitToLast(5);
        postsRef.on('child_added', (snapshot) => {
            const post = snapshot.val();
            if (!post) return;

            const postTime = post.created_at ? new Date(post.created_at).getTime() : Date.now();
            if (Date.now() - postTime > 600000) return;

            processPost({ ...post, id: snapshot.key });
        });

        // 2. Escuchar alertas de tráfico de la flota para voz global
        startGlobalVoiceListener();
    }

    return { init, processPost, geocodeIntersection, speakAlert, startGlobalVoiceListener };
})();
