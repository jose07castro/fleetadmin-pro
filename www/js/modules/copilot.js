/* ============================================
   FleetAdmin Pro — Copiloto GPS de Radares (v1.0)
   Cálculo de proximidad y alertas de voz inteligentes
   ============================================ */

const CopilotModule = (() => {
    const WARNING_DISTANCE_METERS = 300; // Distancia de alerta (300 metros)
    const COOLDOWN_MS = 3 * 60 * 1000;   // 3 minutos de enfriamiento para no volver loco al chofer
    
    let _lastAlertTime = {}; // { radarId: timestamp }
    let _isEnabled = localStorage.getItem('copilotRadar') !== 'off'; // ON por defecto

    // Base de Datos Maestra de Fotomultas Estáticas de Rosario (Oficial Municipalidad de Rosario)
    const STATIC_RADARS = [
        // --- GRUPO 1: Google Maps High-Precision Coordinates ---
        { id: 'r1', name: 'Av. Pellegrini y Ovidio Lagos', lat: -32.953073, lng: -60.6641808, limit: 60, desc: 'Fotomulta' },
        { id: 'r2', name: 'Bv. Oroño y Bv. Seguí', lat: -32.9762823, lng: -60.6615883, limit: 60, desc: 'Fotomulta' },
        { id: 'r3', name: 'Bv. Avellaneda y Santa Fe', lat: -32.9377207, lng: -60.6788408, limit: 60, desc: 'Fotomulta' },
        { id: 'r4', name: 'Av. Pellegrini y Corrientes', lat: -32.9565944, lng: -60.6450774, limit: 60, desc: 'Semáforo y Senda' },
        { id: 'r5', name: 'Bv. Oroño y Batlle y Ordóñez', lat: -33.009247, lng: -60.66443, limit: 60, desc: 'Fotomulta' },
        { id: 'r6', name: 'Av. Córdoba y Ovidio Lagos', lat: -32.9422646, lng: -60.661423, limit: 60, desc: 'Fotomulta' },
        { id: 'r7', name: 'Av. Provincias Unidas y Av. Pellegrini', lat: -32.9485519, lng: -60.7122135, limit: 60, desc: 'Fotomulta' },

        // --- GRUPO 2: Batch Official Locations (40 km/h) ---
        { id: 'r8', name: "España y San Lorenzo", lat: -32.937777, lng: -60.673427, limit: 40, desc: "Fotomulta" },
        { id: 'r9', name: "Mendoza y Provincias Unidas", lat: -32.9331766, lng: -60.7130478, limit: 40, desc: "Fotomulta" },
        { id: 'r10', name: "Laprida 850", lat: -32.9479229, lng: -60.634104, limit: 40, desc: "Fotomulta" },
        { id: 'r11', name: "Necochea 2650", lat: -32.9707131, lng: -60.6297735, limit: 40, desc: "Fotomulta" },
        { id: 'r12', name: "Ayacucho y Arijón", lat: -33.0023158, lng: -60.636144, limit: 40, desc: "Fotomulta" },
        { id: 'r13', name: "Maipú y Mendoza", lat: -32.9437663, lng: -60.7245282, limit: 40, desc: "Fotomulta" },
        { id: 'r14', name: "Santa Fe y Pueyrredón", lat: -32.9385247, lng: -60.6560857, limit: 40, desc: "Fotomulta" },
        { id: 'r15', name: "Santa Fe 1750", lat: -32.943416, lng: -60.646839, limit: 40, desc: "Fotomulta" },
        { id: 'r16', name: "Laprida y Tres de Febrero", lat: -32.9579382, lng: -60.636709, limit: 40, desc: "Fotomulta" },
        { id: 'r17', name: "San Lorenzo 1550", lat: -32.9429861, lng: -60.6437676, limit: 40, desc: "Fotomulta" },

        // --- GRUPO 3: Batch Official Locations (50 km/h) ---
        { id: 'r18', name: "Ovidio Lagos y Salta", lat: -32.9746345, lng: -60.6691673, limit: 50, desc: "Fotomulta" },
        { id: 'r19', name: "Colombres 1071", lat: -32.9403788, lng: -60.7292394, limit: 50, desc: "Fotomulta" },
        { id: 'r20', name: "Colombres 930", lat: -32.9389998, lng: -60.7295122, limit: 50, desc: "Fotomulta" },
        { id: 'r21', name: "Frondizi 260", lat: -32.9120351, lng: -60.6752153, limit: 50, desc: "Fotomulta" },
        { id: 'r22', name: "Rondeau y Baigorria", lat: -32.8916668, lng: -60.6929855, limit: 50, desc: "Fotomulta" },
        { id: 'r23', name: "Mendoza y Avellaneda", lat: -32.9494181, lng: -60.6815672, limit: 50, desc: "Fotomulta" },
        { id: 'r24', name: "Cafferata 850", lat: -32.9411355, lng: -60.6712209, limit: 50, desc: "Fotomulta" },
        { id: 'r25', name: "Mendoza 5350", lat: -32.9413027, lng: -60.6964825, limit: 50, desc: "Fotomulta" },
        { id: 'r26', name: "Colombres 1451", lat: -32.9455165, lng: -60.7290814, limit: 50, desc: "Fotomulta" },
        { id: 'r27', name: "Rondeau y Nansen", lat: -32.9094881, lng: -60.6876247, limit: 50, desc: "Fotomulta" },
        { id: 'r28', name: "Santa Fe 2850", lat: -32.9407326, lng: -60.6617918, limit: 50, desc: "Fotomulta" },

        // --- GRUPO 4: Batch Official Locations (60 km/h) ---
        { id: 'r29', name: "Av. Avellaneda y Av. Pellegrini", lat: -32.9494181, lng: -60.6815672, limit: 60, desc: "Fotomulta" },
        { id: 'r30', name: "Av. 27 de Febrero y Maipú", lat: -32.9698568, lng: -60.6246702, limit: 60, desc: "Fotomulta" },
        { id: 'r31', name: "Av. 27 de Febrero y Av. Avellaneda", lat: -32.9494181, lng: -60.6815672, limit: 60, desc: "Fotomulta" },
        { id: 'r32', name: "Av. Alberdi y Génova", lat: -32.914874, lng: -60.6858899, limit: 60, desc: "Fotomulta" },
        { id: 'r33', name: "Av. Belgrano y Sargento Cabral", lat: -32.9646074, lng: -60.6216438, limit: 60, desc: "Fotomulta" },
        { id: 'r34', name: "Av. Belgrano y Av. Pellegrini", lat: -32.9483505, lng: -60.7049883, limit: 60, desc: "Fotomulta" },
        { id: 'r35', name: "Bv. Rondeau 1250", lat: -32.9018004, lng: -60.6899192, limit: 60, desc: "Fotomulta" },
        { id: 'r36', name: "Av. San Martín 5860", lat: -32.9461498, lng: -60.6370036, limit: 60, desc: "Fotomulta" },
        { id: 'r37', name: "Av. Uriburu y Av. Avellaneda", lat: -32.9306913, lng: -60.7263697, limit: 60, desc: "Fotomulta" },
        { id: 'r38', name: "Av. Provincias Unidas y Sorrento", lat: -32.9331766, lng: -60.7130478, limit: 60, desc: "Fotomulta" },
        { id: 'r39', name: "Av. Jorge Newbery y Wilde", lat: -32.9088464, lng: -60.7522797, limit: 60, desc: "Fotomulta" },
        { id: 'r40', name: "Bv. Seguí y Av. Ovidio Lagos", lat: -32.9746345, lng: -60.6691673, limit: 60, desc: "Fotomulta" },
        { id: 'r41', name: "Bv. Seguí y Av. Grandoli", lat: -32.9746345, lng: -60.6691673, limit: 60, desc: "Fotomulta" }
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
     * Vocaliza el aviso usando la voz premium KITT (con fallback automático).
     */
    function _speakWarning(radar, distance) {
        const isVoiceEnabled = localStorage.getItem('radarVoice') !== 'off';
        if (!isVoiceEnabled) return;

        // Texto amigable para locución
        const radarName = radar.name.replace(' y ', ' esquina ');
        const text = `Atención. Fotomulta a 300 metros en ${radarName}. Velocidad máxima ${radar.limit} kilómetros por hora.`;
        
        // === VOZ PREMIUM KITT (con fallback automático a voz local) ===
        if (typeof KittVoice !== 'undefined') {
            KittVoice.speak(text, true);
        } else {
            // Fallback directo si KittVoice no cargó
            try {
                if (window.speechSynthesis) {
                    window.speechSynthesis.cancel();
                    const utter = new SpeechSynthesisUtterance(text);
                    utter.lang = 'es-AR';
                    utter.rate = 0.95;
                    window.speechSynthesis.speak(utter);
                }
            } catch (e) {
                console.error('Error vocalizando advertencia de copiloto:', e);
            }
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
