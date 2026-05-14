/* ============================================
   FleetAdmin Pro — Copiloto GPS de Radares (v1.0)
   Cálculo de proximidad y alertas de voz inteligentes
   ============================================ */

const CopilotModule = (() => {
    const WARNING_DISTANCE_METERS = 300; // Distancia de alerta (300 metros)
    const COOLDOWN_MS = 3 * 60 * 1000;   // 3 minutos de enfriamiento para no volver loco al chofer
    
    let _lastAlertTime = {}; // { radarId: timestamp }
    let _isEnabled = localStorage.getItem('copilotRadar') !== 'off'; // ON por defecto

    // Base de Datos de Fotomultas Estáticas de Rosario (Coordenadas Google Maps 100% precisas)
    const STATIC_RADARS = [
        { id: 'r1', name: 'Av. Pellegrini y Ovidio Lagos', lat: -32.953073, lng: -60.6641808, limit: 60, desc: 'Fotomulta' },
        { id: 'r2', name: 'Bv. Oroño y Bv. Seguí', lat: -32.9762823, lng: -60.6615883, limit: 60, desc: 'Fotomulta' },
        { id: 'r3', name: 'Bv. Avellaneda y Santa Fe', lat: -32.9377207, lng: -60.6788408, limit: 60, desc: 'Fotomulta' },
        { id: 'r4', name: 'Av. Pellegrini y Corrientes', lat: -32.9565944, lng: -60.6450774, limit: 60, desc: 'Semáforo y Senda' },
        { id: 'r5', name: 'Bv. Oroño y Batlle y Ordóñez', lat: -33.009247, lng: -60.66443, limit: 60, desc: 'Fotomulta' },
        { id: 'r6', name: 'Av. Córdoba y Ovidio Lagos', lat: -32.9422646, lng: -60.661423, limit: 60, desc: 'Fotomulta' },
        { id: 'r7', name: 'Av. Provincias Unidas y Av. Pellegrini', lat: -32.9485519, lng: -60.7122135, limit: 60, desc: 'Fotomulta' }
    ];

    /**
     * Calcula la distancia geodésica en metros entre dos puntos usando Haversine formula.
     */
    function _getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Radio terrestre en metros
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // Retorna distancia en metros
    }

    /**
     * Chequea si la posición actual está cerca de algún radar conocido.
     * Invocado dinámicamente desde la tubería de GPS en segundo plano.
     */
    function checkProximity(currentLat, currentLng) {
        if (!_isEnabled) return;

        const now = Date.now();
        
        for (const radar of STATIC_RADARS) {
            const dist = _getDistance(currentLat, currentLng, radar.lat, radar.lng);
            
            // ¿Entró en el radio de 300 metros?
            if (dist <= WARNING_DISTANCE_METERS) {
                const lastAlert = _lastAlertTime[radar.id] || 0;
                
                // Validar que haya pasado el tiempo de enfriamiento
                if (now - lastAlert > COOLDOWN_MS) {
                    _lastAlertTime[radar.id] = now;
                    
                    // Disparar aviso
                    _speakWarning(radar, dist);
                    console.log(`📡 [COPILOTO] 📸 RADAR DETECTADO: ${radar.name} a ${dist.toFixed(0)}m. Avisando por voz...`);
                    
                    // Para este ciclo, ya avisamos del radar más cercano, cortar loop.
                    break; 
                }
            }
        }
    }

    /**
     * Vocaliza el aviso usando la síntesis de voz nativa del navegador/móvil.
     */
    function _speakWarning(radar, distance) {
        const isVoiceEnabled = localStorage.getItem('radarVoice') !== 'off';
        if (!window.speechSynthesis || !isVoiceEnabled) return;

        // Texto amigable para locución
        const radarName = radar.name.replace(' y ', ' esquina ');
        const text = `Atención. Fotomulta a 300 metros en ${radarName}. Velocidad máxima ${radar.limit} kilómetros por hora.`;
        
        try {
            // Cancelar cualquier locución en cola para priorizar la fotomulta de inmediato
            window.speechSynthesis.cancel();

            const utter = new SpeechSynthesisUtterance(text);
            utter.lang = 'es-AR';
            utter.rate = 0.95; // Ligeramente pausado para máxima comprensión
            utter.pitch = 1.0;
            utter.volume = 1.0;

            // Intentar setear voz en español si estuviera disponible en el SO
            const voices = window.speechSynthesis.getVoices();
            const esVoice = voices.find(v => v.lang.startsWith('es'));
            if (esVoice) utter.voice = esVoice;

            window.speechSynthesis.speak(utter);
        } catch (e) {
            console.error('Error vocalizando advertencia de copiloto:', e);
        }
        
        // Alerta visual local (Toast)
        if (typeof Components !== 'undefined' && Components.showToast) {
            Components.showToast(`📸 Fotomulta a 300m: ${radar.name}`, 'danger');
        }
    }

    function setEnabled(enabled) {
        _isEnabled = enabled;
        localStorage.setItem('copilotRadar', enabled ? 'on' : 'off');
        console.log(`📡 [COPILOTO] Modo copiloto ${_isEnabled ? 'ENCENDIDO' : 'APAGADO'}`);
    }

    function isEnabled() {
        return _isEnabled;
    }

    return {
        checkProximity,
        setEnabled,
        isEnabled
    };
})();
