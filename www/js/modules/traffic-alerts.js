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

    /**
     * Anuncia la alerta por voz usando el motor nativo del dispositivo (Android TTS o Web Speech).
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

        if (localStorage.getItem('radarVoice') === 'off') {
            console.log('🔇 [GLOBAL VOZ] Silenciado por preferencia del usuario.');
            return;
        }

        // Personalización con el primer nombre del usuario
        let firstName = '';
        try {
            if (typeof UserOnboarding !== 'undefined' && typeof UserOnboarding.getUserFirstName === 'function') {
                firstName = UserOnboarding.getUserFirstName();
            }
        } catch (e) {}

        if (firstName && !fullText.toLowerCase().startsWith(firstName.toLowerCase())) {
            fullText = `${firstName}, ${fullText}`;
        }

        console.log(`🔊 [GLOBAL VOZ] Hablando (Voz nativa): "${fullText}"`);

        // === VOZ NATIVA DIRECTA (Android TTS / Web Speech Blindada) ===
        let spoken = false;
        if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
            spoken = AndroidServices.speak(fullText);
        }
        if (!spoken && window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
            try { window.NativeServiceBridge.speak(fullText); spoken = true; } catch(e) {}
        }
        if (!spoken && typeof AndroidServices !== 'undefined' && typeof AndroidServices.speakWithAntiCutoff === 'function') {
            spoken = AndroidServices.speakWithAntiCutoff(fullText);
        }
        if (!spoken && typeof window !== 'undefined' && window.speechSynthesis) {
            try {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                window.speechSynthesis.cancel();
                setTimeout(() => {
                    const utter = new SpeechSynthesisUtterance(fullText);
                    utter.lang = 'es-AR';
                    utter.rate = 1.0;
                    const volPercent = parseInt(localStorage.getItem('radarVolumePercent') || '85', 10);
                    utter.volume = Math.max(0.1, Math.min(1.0, volPercent / 100.0));
                    window.speechSynthesis.speak(utter);
                }, 50);
            } catch(e) {
                console.warn('SpeechSynthesis error:', e);
            }
        }
    }

    const _spokenAlertIds = new Set();
    const _spokenLocationHistory = new Map(); // key -> { count, lastTime }

    function _isAlertAlreadySpoken(id, locationText = '') {
        if (!id) return false;
        if (_spokenAlertIds.has(id)) return true;
        try {
            const storedLocal = JSON.parse(localStorage.getItem('fa_spoken_alerts') || '[]');
            if (storedLocal.includes(id)) {
                _spokenAlertIds.add(id);
                return true;
            }
        } catch(e) {}

        // LÍMITE ESTRICTO DE 2 REPETICIONES POR MENSAJE / UBICACIÓN:
        if (locationText) {
            const locKey = locationText.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            if (locKey) {
                const hist = _spokenLocationHistory.get(locKey);
                const now = Date.now();
                if (hist && (now - hist.lastTime) < 15 * 60 * 1000) { // 15 minutos
                    if (hist.count >= 2) {
                        console.log(`🔇 [VOZ-GLOBAL] Límite de 2 repeticiones alcanzado para "${locationText}". Silenciado.`);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function _markAlertAsSpoken(id, locationText = '') {
        if (!id) return;
        _spokenAlertIds.add(id);
        try {
            const stored = JSON.parse(localStorage.getItem('fa_spoken_alerts') || '[]');
            if (!stored.includes(id)) {
                stored.push(id);
                if (stored.length > 200) stored.shift();
                localStorage.setItem('fa_spoken_alerts', JSON.stringify(stored));
                sessionStorage.setItem('fa_spoken_alerts', JSON.stringify(stored));
            }
        } catch(e) {}

        if (locationText) {
            const locKey = locationText.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
            if (locKey) {
                const hist = _spokenLocationHistory.get(locKey) || { count: 0, lastTime: 0 };
                hist.count += 1;
                hist.lastTime = Date.now();
                _spokenLocationHistory.set(locKey, hist);
                console.log(`🔊 [VOZ-GLOBAL] Conteo de repetición para "${locationText}": ${hist.count}/2`);
            }
        }
    }

    // Escuchar comando de silencio de emergencia desde el panel /qr
    if (typeof firebaseDB !== 'undefined') {
        try {
            firebaseDB.ref('system_commands/silence').on('value', (snap) => {
                const val = snap.val();
                if (val && (Date.now() - val) < 30000) {
                    console.log('🛑 [EMERGENCIA] Comando de silencio recibido desde panel admin. Deteniendo voz.');
                    if (typeof window !== 'undefined' && window.speechSynthesis) {
                        window.speechSynthesis.cancel();
                    }
                }
            });
        } catch(e) {}
    }

    /**
     * Calcula la distancia geodésica en metros entre dos coordenadas (Fórmula de Haversine con R=6371e3 m).
     * Prohíbe comparaciones directas de grados decimales para radios de proximidad.
     */
    function getDistanceInMeters(lat1, lon1, lat2, lon2) {
        if (typeof window !== 'undefined' && typeof window.getDistanceInMeters === 'function') {
            return window.getDistanceInMeters(lat1, lon1, lat2, lon2);
        }
        if (lat1 === null || lon1 === null || lat2 === null || lon2 === null ||
            isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
            return Infinity;
        }
        const R = 6371e3;
        const toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad;
        const dLon = (lon2 - lon1) * toRad;
        const phi1 = lat1 * toRad;
        const phi2 = lat2 * toRad;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
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

        console.log(`📡 [VOZ-GLOBAL] Conectado a global_traffic_alerts. Todos los alertas llegarán a este dispositivo.`);
        const alertRef = firebaseDB.ref(`global_traffic_alerts`);
        _activeFleetId = '__GLOBAL__';
        _activeVoiceRef = alertRef;

        _activeVoiceCallback = (snap) => {
            const alert = snap.val();
            if (!alert || alert.status !== 'active') return;

            const alertId = alert.id || snap.key;
            const locDesc = alert.location || alert.description || alert.originalText || '';

            // Notificar a los callbacks registrados de UI (mapas, listas de alerta)
            _newAlertCallbacks.forEach(cb => {
                try { cb(alert); } catch(e) { console.error('Error en callback de nueva alerta:', e); }
            });

            // FILTRO DE AUTOR: Si el conductor actual es quien envió la alerta, no auto-repetírsela
            try {
                const currentUser = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
                if (currentUser && alert.authorName && currentUser.name) {
                    if (alert.authorName.trim().toLowerCase() === currentUser.name.trim().toLowerCase()) {
                        console.log(`🔇 [VOZ-GLOBAL] Alerta propia creada por el usuario (${alert.authorName}). Omitiendo.`);
                        if (alertId) _markAlertAsSpoken(alertId, locDesc);
                        return;
                    }
                }
            } catch (e) {}

            // FILTRO 1: Evitar recitar el historial acumulado. Solo evaluar alertas muy recientes
            const timeDiff = alert.timestamp ? Math.abs(Date.now() - alert.timestamp) : 0;
            const isVeryRecent = alert.timestamp && (timeDiff < 180000 || alert.timestamp >= _appStartTime - 10000);
            if (alert.timestamp && alert.timestamp < _appStartTime && !isVeryRecent) {
                if (alertId) _markAlertAsSpoken(alertId, locDesc);
                return; 
            }

            // FILTRO 2: Si por algún desfase horario la alerta ya expiró, silenciarla.
            if (alert.expiresAt && alert.expiresAt < Date.now()) {
                if (alertId) _markAlertAsSpoken(alertId, locDesc);
                return;
            }

            // FILTRO 3: COBERTURA TOTAL DEPARTAMENTO ROSARIO Y LOCALIDADES VECINAS (50 KM)
            // Permite a los choferes conocer TODOS los operativos de la región en tiempo real
            // para decidir estratégicamente si aceptar o rechazar ofertas de viajes en Uber/DiDi.
            const isOwner = (typeof Auth !== 'undefined' && typeof Auth.isOwner === 'function' && Auth.isOwner());
            const isWebDesktop = (typeof window !== 'undefined' && (window.innerWidth > 768 || !window.Capacitor?.isNativePlatform?.()));

            // Si el chofer cuenta con posición GPS, validar que el evento esté dentro del área del Departamento Rosario (50 km)
            if (curPos && curPos.lat && curPos.lng) {
                const alertLat = parseFloat(alert.lat);
                const alertLng = parseFloat(alert.lng);
                if (!isNaN(alertLat) && !isNaN(alertLng)) {
                    const distDept = getDistanceInMeters(curPos.lat, curPos.lng, alertLat, alertLng);
                    // 50.000 metros (50 km) cubre todo el departamento Rosario y ciudades vecinas:
                    // Rosario, Funes, Roldán, San Lorenzo, Capitán Bermúdez, Granadero Baigorria, Pérez, VGG, Alvear, Pueblo Esther, Arroyo Seco.
                    if (distDept > 50000 && !isOwner && !isWebDesktop) {
                        console.log(`📍 [VOZ-GLOBAL] Alerta fuera del Departamento Rosario (${Math.round(distDept)}m > 50km). Lugar: ${locDesc}`);
                        return;
                    }
                    console.log(`📢 [VOZ-GLOBAL] Alerta en radio Departamento Rosario (${Math.round(distDept)}m <= 50km): ${locDesc}`);
                }
            } else {
                console.log(`📢 [VOZ-GLOBAL] Alerta recibida (sin GPS preciso o modo base/escritorio): ${locDesc}`);
            }

            // FILTRO 4: COOLDOWN Y DESDUPLICACIÓN (15 minutos)
            if (alertId && _isAlertAlreadySpoken(alertId, locDesc)) {
                console.log(`🔇 [VOZ-GLOBAL] Alerta ya reproducida en cooldown (${alertId} / "${locDesc}"). Omitiendo.`);
                return;
            }

            if (alertId) {
                _markAlertAsSpoken(alertId, locDesc);
            }

            // FILTRO DE SILENCIO: Si el usuario silenció las alertas (radarVoice=off)
            if (localStorage.getItem('radarVoice') === 'off') {
                console.log('🔇 [VOZ-GLOBAL] Alerta recibida pero silenciada por el usuario (radarVoice=off).');
                return;
            }

            console.log(`🔊 [GLOBAL VOICE] Alerta confirmada dentro de rango (${Math.round(dist)}m <= ${radioAlerta}m):`, alert.type, alert.location);

            // Si la alerta tiene un audio original de WhatsApp o audio generado, reproducirlo tal cual (sin TTS)
            if (alert.audioUrl) {
                const serverUrl = 'https://fleetadmin-web-nueva.onrender.com';
                const fullAudioUrl = (alert.audioUrl.startsWith('http') || alert.audioUrl.startsWith('data:'))
                    ? alert.audioUrl 
                    : `${serverUrl}${alert.audioUrl.startsWith('/') ? '' : '/'}${alert.audioUrl}`;
                console.log(`🎵 [AUDIO-ORIGINAL] Intentando reproducir audio de alerta: ${fullAudioUrl}`);
                
                const fallbackText = alert.originalText || alert.location || 'Alerta de tránsito';

                // Prioridad 1: Delegar al servicio Android nativo (soporta segundo plano y audio focus de navegación)
                if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.playAudio === 'function') {
                    try {
                        AndroidServices.playAudio(fullAudioUrl, fallbackText);
                        console.log('🎵 [AUDIO-ORIGINAL] Delegado con éxito a AndroidServices.playAudio nativo');
                        return;
                    } catch(e) {
                        console.warn('⚠️ Error delegando a AndroidServices.playAudio:', e);
                    }
                }
                if (window.NativeServiceBridge && typeof window.NativeServiceBridge.playAudio === 'function') {
                    try {
                        window.NativeServiceBridge.playAudio(fullAudioUrl, fallbackText);
                        console.log('🎵 [AUDIO-ORIGINAL] Delegado con éxito a NativeServiceBridge.playAudio nativo');
                        return;
                    } catch(e) {
                        console.warn('⚠️ Error delegando a NativeServiceBridge.playAudio:', e);
                    }
                }

                let audioPlayed = false;
                let fallbackTriggered = false;

                const audio = new Audio();
                const volPercent = parseInt(localStorage.getItem('radarVolumePercent') || '85', 10);
                audio.volume = Math.max(0.1, Math.min(1.0, volPercent / 100.0));

                const triggerFallback = () => {
                    if (fallbackTriggered) return;
                    fallbackTriggered = true;
                    console.warn('⚠️ [AUDIO-FALLBACK] El audio de la alerta falló o fue bloqueado. Usando Text-To-Speech local.');
                    try {
                        audio.pause();
                        audio.src = '';
                    } catch (e) {}
                    speakAlert(alert.type, alert.location, alert.originalText);
                };

                // Si no se reproduce tras 4 segundos, activar fallback de voz
                const fallbackTimeout = setTimeout(() => {
                    if (!audioPlayed) {
                        triggerFallback();
                    }
                }, 4000);

                try {
                    audio.crossOrigin = 'anonymous'; // Necesario para boost
                    audio.src = fullAudioUrl;
                    audio.preload = 'auto';

                    audio.onplay = () => {
                        audioPlayed = true;
                        clearTimeout(fallbackTimeout);
                    };

                    audio.onerror = (err) => {
                        console.error('❌ [AUDIO-ORIGINAL] Error cargando el archivo de audio:', err);
                        clearTimeout(fallbackTimeout);
                        triggerFallback();
                    };

                    audio.onended = () => {
                        console.log('🎵 [AUDIO-ORIGINAL] Reproducción finalizada exitosamente.');
                    };

                    const playPromise = (typeof window.playAudioWithBoost === 'function')
                        ? window.playAudioWithBoost(audio, 3.0)
                        : audio.play();

                    // Intentar reproducir directamente
                    playPromise
                        .then(() => {
                            audioPlayed = true;
                            clearTimeout(fallbackTimeout);
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
                                    clearTimeout(fallbackTimeout);
                                    console.log('🎵 [AUDIO-ORIGINAL] Reproducción iniciada en evento canplay.');
                                })
                                .catch(err => {
                                    console.error('❌ [AUDIO-ORIGINAL] Error en canplay:', err.message);
                                });
                        }
                    });

                } catch (audioEx) {
                    console.error('❌ [AUDIO-ORIGINAL] Error al instanciar o reproducir audio:', audioEx.message);
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

        // Escucha absoluta basada en Timestamps en tiempo real (100% libre de Race Conditions)
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
