/* ============================================
   FleetAdmin Pro — Módulo de Detección de Alertas (v120)
   Detección de "lunfardo rosarino" y geocodificación
   de operativos en tiempo real.
   ============================================ */

const TrafficAlerts = (() => {
    // Diccionario de lunfardo y palabras clave
    const KEYWORDS = [
        'gorra', 'operativo', 'control', 'zorros', 'palo', 
        'chanchos', 'parando', 'evitar zona', 'transito'
    ];

    const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
    const ROSARIO_BOUNDS = 'viewbox=-60.7845,-32.8596,-60.5960,-33.0573&bounded=1';
    
    let _geocodeCache = {}; // { query: { lat, lng, timestamp } }
    let _isProcessing = false;

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
        const fullQuery = `${query}, Rosario, Santa Fe, Argentina`;
        
        // Check cache (válido por 24hs para ubicaciones estáticas)
        if (_geocodeCache[fullQuery] && (Date.now() - _geocodeCache[fullQuery].timestamp < 86400000)) {
            return _geocodeCache[fullQuery].coords;
        }

        try {
            // Rate limiting preventivo: esperar 1.5s entre peticiones si se procesan ráfagas
            if (_isProcessing) await new Promise(r => setTimeout(r, 1500));
            _isProcessing = true;

            const url = `${NOMINATIM_BASE}?format=json&q=${encodeURIComponent(fullQuery)}&${ROSARIO_BOUNDS}`;
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
                _geocodeCache[fullQuery] = { coords: result, timestamp: Date.now() };
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
        return 'warning';
    }

    // Registra el milisegundo en que inició la aplicación (con 3s de tolerancia)
    // para ignorar alertas viejas y cantar únicamente lo que sea de este segundo en adelante.
    const _appStartTime = Date.now() - 3000;

    /**
     * Anuncia la alerta por voz usando Web Speech API de manera GLOBAL.
     * Funciona con mapa abierto, cerrado y con la app corriendo de fondo.
     */
    function speakAlert(type, location) {
        const isVoiceEnabled = localStorage.getItem('radarVoice') !== 'off';
        if (!window.speechSynthesis || !isVoiceEnabled) return;

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
        const fullText = loc ? `${msg} en ${loc}. Precaución.` : `${msg}. Precaución.`;

        window.speechSynthesis.cancel();

        const utter = new SpeechSynthesisUtterance(fullText);
        utter.lang = 'es-AR';
        utter.rate = 0.9;
        utter.pitch = 1.0;
        utter.volume = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const esVoice = voices.find(v => v.lang.startsWith('es'));
        if (esVoice) utter.voice = esVoice;

        window.speechSynthesis.speak(utter);
        console.log(`🔊 [GLOBAL VOZ] "${fullText}"`);
    }

    /**
     * Inicia la escucha de alertas de tráfico para anuncios globales por voz
     */
    function startGlobalVoiceListener() {
        if (typeof firebaseDB === 'undefined' || typeof Auth === 'undefined') return;
        const fleetId = Auth.getFleetId();
        
        // AUTO-HEAL: Si la app acaba de arrancar y Firebase Auth no levantó el FleetID, 
        // reintentar automáticamente cada 3 segundos hasta conectarse de por vida.
        if (!fleetId) {
            console.warn('📡 [VOZ-GLOBAL] FleetID ausente en arranque. Reintentando puente de audio en 3s...');
            setTimeout(startGlobalVoiceListener, 3000);
            return;
        }

        console.log(`📡 [VOZ-GLOBAL] Canal de voz conectado para flota: ${fleetId}. Monitoreando alertas...`);
        const alertRef = firebaseDB.ref(`fleets/${fleetId}/traffic_alerts`);

        // Escucha absoluta basada en Timestamps en tiempo real (100% libre de Race Conditions)
        alertRef.on('child_added', (snap) => {
            const alert = snap.val();
            if (!alert || alert.status !== 'active') return;

            // FILTRO 1: Evitar recitar el historial acumulado. Solo cantar cosas NUEVAS
            // que hayan aparecido DESPUÉS de que el conductor abrió esta pestaña/app.
            if (alert.timestamp && alert.timestamp < _appStartTime) {
                return; 
            }

            // FILTRO 2: Si por algún desfase horario la alerta ya expiró, silenciarla.
            if (alert.expiresAt && alert.expiresAt < Date.now()) {
                return;
            }

            console.log('🔊 [GLOBAL VOICE] Cantando nueva alerta en vivo:', alert.type, alert.location);
            speakAlert(alert.type, alert.location);
        });
    }

    /**
     * Listener para monitorear nuevos posts de comunidad.
     */
    function init() {
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

    return { init, processPost, geocodeIntersection, speakAlert };
})();
