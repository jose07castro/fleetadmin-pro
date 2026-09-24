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
    let _newAlertCallbacks = []; // Callbacks para alertas recibidas en tiempo real

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
        const regex = /([A-Záéíóúñ0-9.\s]{3,})\s+(y|e|esq|esquina|entre|e\/)\s+([A-Záéíóúñ0-9.\s]{3,})/i;
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
            await firebaseDB.ref(`global_traffic_alerts/${alertId}`).set(alertData);
            console.log('✅ TrafficAlerts: Alerta compartida con la flota y nodo global.');
            
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

    // Registra el milisegundo en que inició la aplicación
    // para ignorar alertas viejas y cantar únicamente lo que sea de este segundo en adelante.
    const _appStartTime = Date.now() - 3000;

    function playScannerSound() {
        try {
            const serverUrl = (window.location.hostname === 'localhost' || 
                               window.location.hostname === '127.0.0.1' ||
                               window.location.protocol === 'file:') 
                               ? 'https://fleetadmin-web-nueva.onrender.com' 
                               : window.location.origin;
            
            const scannerUrl = (window.location.protocol === 'file:' || window.Capacitor)
                ? 'woosh-woosh.mp3'
                : `${serverUrl}/woosh-woosh.mp3`;
            
            console.log(`🎵 [SCANNER-SOUND] Reproduciendo sonido del escáner KITT: ${scannerUrl}`);
            const scannerAudio = new Audio(scannerUrl);
            scannerAudio.volume = 0.8;
            
            if (typeof window.playAudioWithBoost === 'function') {
                window.playAudioWithBoost(scannerAudio, 2.0).catch(e => console.warn('Boost de escáner falló:', e));
            } else {
                scannerAudio.play().catch(e => console.warn('Play de escáner falló:', e));
            }
        } catch (e) {
            console.error('Error al reproducir sonido del escáner:', e);
        }
    }

    /**
     * Anuncia la alerta por voz usando Web Speech API de manera GLOBAL.
     * Funciona con mapa abierto, cerrado y con la app corriendo de fondo.
     */
    function speakAlert(type, location, originalText = '') {
        const isVoiceEnabled = localStorage.getItem('radarVoice') !== 'off';
        if (!isVoiceEnabled) return;

        let fullText = '';
        const isPlaceholder = !originalText || originalText.startsWith('[') || originalText.trim().length === 0;

        if (!isPlaceholder) {
            // Limpiar texto de emojis y formato markdown para una lectura limpia
            fullText = originalText
                .replace(/[*_~`#]/g, '') // Quitar markdown
                .replace(/[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '') // Quitar emojis
                .replace(/\.+/g, '.') // Normalizar puntos suspensivos
                .replace(/-+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        } else {
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
            const loc = location
                ? location
                    .replace(' (ubicación aprox.)', '')
                    .replace(/ \(reporte de [^)]+\)/gi, '')
                    .replace(/ - .*$/, '')
                    .replace(' y ', ' esquina ')
                    .trim()
                : '';

            fullText = (loc && loc !== 'Ubicación desconocida') ? `${msg} en ${loc}.` : `${msg}.`;
        }

        console.log(`🔊 [GLOBAL VOZ] Hablando: "${fullText}"`);

        // === VOZ PREMIUM KITT / NATIVO / FALLBACK ===
        if (typeof KittVoice !== 'undefined') {
            KittVoice.speak(fullText, true).then(() => {
                playScannerSound();
            });
        } else if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
            AndroidServices.speak(fullText);
            playScannerSound();
        } else if (window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
            try { window.NativeServiceBridge.speak(fullText); } catch(e) {}
            playScannerSound();
        } else {
            // Fallback directo si KittVoice no cargó
            if (window.speechSynthesis) {
                try {
                    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                    window.speechSynthesis.cancel();
                    setTimeout(() => {
                        const utter = new SpeechSynthesisUtterance(fullText);
                        utter.lang = 'es-AR';
                        utter.rate = 0.95;
                        utter.onend = () => playScannerSound();
                        window.speechSynthesis.speak(utter);
                    }, 50);
                } catch(e) {
                    playScannerSound();
                }
            } else {
                playScannerSound();
            }
        }
    }

    /**
     * Inicia la escucha de alertas de tráfico para anuncios globales por voz.
     * Escucha el nodo GLOBAL — funciona para TODOS los celulares con la app,
     * independientemente de si el usuario está logueado o a qué flota pertenece.
     */
    function startGlobalVoiceListener(force = false) {
        if (typeof firebaseDB === 'undefined') return;

        // Asegurar que la base de datos está online (por si venimos de un estado offline)
        try {
            firebase.database().goOnline();
            console.log('📡 [VOZ-GLOBAL] goOnline() llamado para asegurar conexión.');
        } catch (e) {
            console.warn('📡 [VOZ-GLOBAL] Error en goOnline():', e);
        }

        // Si ya estamos escuchando el nodo global y no forzamos re-registro, no hacer nada
        if (_activeFleetId === '__GLOBAL__' && !force) {
            console.log(`📡 [VOZ-GLOBAL] Ya escuchando nodo global_traffic_alerts y goOnline ejecutado`);
            return;
        }

        // Si estábamos escuchando, apagar el listener anterior
        if (_activeVoiceRef && _activeVoiceCallback) {
            console.log(`📡 [VOZ-GLOBAL] Restableciendo listener. Apagando anterior...`);
            try {
                _activeVoiceRef.off('child_added', _activeVoiceCallback);
            } catch(e) {
                console.warn('Error apagando listener anterior:', e);
            }
        }

        // Marca de tiempo JUSTO ANTES de abrir el listener para ignorar entradas preexistentes
        // Se usa como startAt para que Firebase solo entregue alertas con timestamp >= _listenerOpenedAt
        const _listenerOpenedAt = Date.now() - 2000; // -2s de margen para desfase de reloj Android
        console.log(`📡 [VOZ-GLOBAL] Conectado a global_traffic_alerts (desde ts=${_listenerOpenedAt}).`);

        _activeFleetId = '__GLOBAL__';

        _activeVoiceCallback = (snap) => {
            const alert = snap.val();
            if (!alert || alert.status !== 'active') return;

            // FILTRO DE TIEMPO: Solo alertas nuevas (posteriores al momento en que abrimos el listener)
            // v193: Ahora se filtra por orderByChild+startAt en Firebase, pero mantenemos
            // un filtro local de respaldo para tolerancia de reloj.
            const timeDiff = alert.timestamp ? (Date.now() - alert.timestamp) : 0;
            if (alert.timestamp && alert.timestamp < (_listenerOpenedAt - 5000)) {
                // La alerta es claramente anterior a cuando abrimos el listener → ignorar
                console.log('📡 [VOZ-GLOBAL] Alerta preexistente ignorada. ts:', alert.timestamp, 'listenerAt:', _listenerOpenedAt);
                return;
            }

            // FILTRO DE EXPIRACIÓN: Si la alerta ya venció, silenciarla
            if (alert.expiresAt && alert.expiresAt < Date.now()) {
                console.log('📡 [VOZ-GLOBAL] Alerta expirada, silenciada.');
                return;
            }

            console.log('🔊 [GLOBAL VOICE] Nueva alerta en vivo:', alert.type, alert.location, alert.audioUrl ? '(audio original)' : '(voz sintetizada)');

            // Si la alerta tiene un audio de KITT generado, reproducirlo tal cual (sin TTS)
            if (alert.audioUrl) {
                const serverUrl = (window.location.hostname === 'localhost' || 
                                   window.location.hostname === '127.0.0.1' ||
                                   window.location.protocol === 'file:') 
                                   ? 'https://fleetadmin-web-nueva.onrender.com' 
                                   : window.location.origin;
                const fullAudioUrl = alert.audioUrl.startsWith('http') 
                    ? alert.audioUrl 
                    : `${serverUrl}${alert.audioUrl}`;
                console.log(`🎵 [AUDIO-ORIGINAL] Intentando reproducir: ${fullAudioUrl}`);
                
                let audioPlayed = false;
                let fallbackTriggered = false;

                const audio = new Audio();

                const triggerFallback = () => {
                    if (fallbackTriggered) return;
                    fallbackTriggered = true;
                    console.warn('⚠️ [AUDIO-FALLBACK] Audio bloqueado → usando TTS local.');
                    try { audio.pause(); audio.src = ''; } catch (e) {}
                    speakAlert(alert.type, alert.location, alert.originalText);
                };

                // Si no se reproduce tras 4 segundos, activar fallback de voz
                const fallbackTimeout = setTimeout(() => {
                    if (!audioPlayed) triggerFallback();
                }, 4000);

                try {
                    audio.crossOrigin = 'anonymous';
                    audio.src = fullAudioUrl;
                    audio.volume = 1.0;
                    audio.preload = 'auto';

                    audio.onerror = (err) => {
                        console.error('❌ [AUDIO-ORIGINAL] Error cargando audio:', err);
                        clearTimeout(fallbackTimeout);
                        triggerFallback();
                    };

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
                                    repeatPromise.catch(e => {
                                        console.error('Error al repetir audio:', e);
                                        playScannerSound();
                                    });
                                });
                            } else if (window.speechSynthesis) {
                                const utter = new SpeechSynthesisUtterance('Repito');
                                utter.lang = 'es-AR';
                                utter.onend = () => {
                                    const repeatPromise = (typeof window.playAudioWithBoost === 'function')
                                        ? window.playAudioWithBoost(audio, 3.0)
                                        : audio.play();
                                    repeatPromise.catch(e => {
                                        console.error('Error al repetir audio:', e);
                                        playScannerSound();
                                    });
                                };
                                window.speechSynthesis.speak(utter);
                            }
                        } else {
                            console.log('🎵 [AUDIO-ORIGINAL] Repetición finalizada, sonido de escáner KITT...');
                            playScannerSound();
                        }
                    };

                    const tryPlayAudio = () => {
                        const playFn = (typeof window.playAudioWithBoost === 'function')
                            ? () => window.playAudioWithBoost(audio, 3.0)
                            : () => audio.play();

                        const p = playFn();
                        if (p && typeof p.then === 'function') {
                            p.then(() => {
                                audioPlayed = true;
                                clearTimeout(fallbackTimeout);
                                console.log('🎵 [AUDIO-ORIGINAL] Reproducción iniciada.');
                            }).catch(err => {
                                console.warn('⚠️ [AUDIO-ORIGINAL] Play falló (autoplay?):', err && err.message);
                                // Último intento: audio.play() nativo
                                audio.play().then(() => {
                                    audioPlayed = true;
                                    clearTimeout(fallbackTimeout);
                                }).catch(() => triggerFallback());
                            });
                        }
                    };

                    audio.addEventListener('canplay', () => {
                        if (!audioPlayed) tryPlayAudio();
                    }, { once: true });

                    tryPlayAudio();

                } catch (audioEx) {
                    console.error('❌ [AUDIO-ORIGINAL] Error al instanciar audio:', audioEx.message);
                    clearTimeout(fallbackTimeout);
                    triggerFallback();
                }
            } else {
                speakAlert(alert.type, alert.location, alert.originalText);
            }

            // Notificar a los callbacks registrados
            _newAlertCallbacks.forEach(cb => {
                try { cb(alert); } catch(e) { console.error('Error en callback de nueva alerta:', e); }
            });
        };

        // v193: Ordenar por timestamp y comenzar DESDE el momento actual
        // Esto garantiza que Firebase solo entregue child_added para NUEVAS alertas
        const alertRef = firebaseDB.ref('global_traffic_alerts')
            .orderByChild('timestamp')
            .startAt(_listenerOpenedAt);
        _activeVoiceRef = alertRef;

        alertRef.on('child_added', _activeVoiceCallback, (error) => {
            console.error('❌ [VOZ-GLOBAL] Error en listener de Firebase global_traffic_alerts:', error);
        });
    }

    /**
     * Listener para monitorear nuevos posts de comunidad.
     */
    function init() {
        if (_initialized) {
            // Si ya se inicializó, solo aseguramos que el listener de voz esté activo/actualizado
            startGlobalVoiceListener(true);
            return;
        }
        _initialized = true;

        console.log('📡 TrafficAlerts: Iniciando monitoreo de comunidad y voz global...');
        
        if (typeof firebaseDB === 'undefined') return;

        // Asegurar base de datos online
        try {
            firebase.database().goOnline();
        } catch(e) {}

        // 1. Escuchar nuevos posts de comunidad (existente)
        const postsRef = firebaseDB.ref('community_posts').limitToLast(5);
        postsRef.on('child_added', (snapshot) => {
            const post = snapshot.val();
            if (!post) return;

            const postTime = post.created_at ? new Date(post.created_at).getTime() : Date.now();
            if (Date.now() - postTime > 600000) return;

            processPost({ ...post, id: snapshot.key });
        }, (error) => {
            console.warn('⚠️ [TrafficAlerts] Error escuchando community_posts:', error);
        });

        // 2. Escuchar alertas de tráfico de la flota para voz global
        startGlobalVoiceListener(true);
    }

    function onNewAlert(callback) {
        if (typeof callback === 'function') {
            // v192 FIX: Evitar acumulación de callbacks duplicados (memory leak + alertas dobles)
            // Si el mismo callback ya está registrado, no lo agregamos de nuevo
            if (!_newAlertCallbacks.includes(callback)) {
                _newAlertCallbacks.push(callback);
            }
            // Limitar a máximo 10 callbacks para evitar fugas de memoria extremas
            if (_newAlertCallbacks.length > 10) {
                _newAlertCallbacks = _newAlertCallbacks.slice(-10);
            }
        }
    }

    async function getLastAlerts(limit = 3) {
        if (typeof firebaseDB === 'undefined') return [];
        try {
            const snap = await firebaseDB.ref('global_traffic_alerts').limitToLast(limit).once('value');
            const val = snap.val();
            if (!val) return [];
            return Object.values(val).sort((a, b) => b.timestamp - a.timestamp);
        } catch (e) {
            console.warn('Error fetching last alerts:', e);
            return [];
        }
    }

    return { init, processPost, geocodeIntersection, speakAlert, startGlobalVoiceListener, onNewAlert, getLastAlerts };
})();
