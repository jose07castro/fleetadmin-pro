/* ==========================================================================
   FleetAdmin Pro — Copiloto GPS de Radares y Fotomultas (v2.0 Rosario)
   Base de datos oficial de 80 cámaras de videocontrol + APSV Circunvalación
   HUD visual prominente para choferes, doble chime Web Audio y voz nativa
   ========================================================================== */

const CopilotModule = (() => {
    // Configuración de proximidad, evaluación dinámica de velocidad y auto-cierre
    const WARNING_DISTANCE_METERS = 300;      // 300m radio estándar para fotomultas urbanas
    const HIGHWAY_WARNING_METERS = 500;       // 500m para autopistas / avenidas rápidas (>= 80 km/h)
    const TRAFFIC_WARNING_METERS = 400;       // 400m para operativos dinámicos de tránsito
    const CROSSING_DELTA_METERS = 10;         // Auto-cierre inmediato si distanciaActual > distanciaAnterior + 10
    const PASSING_DISTANCE_METERS = 18;       // Distancia inmediata al punto de cámara
    const EXIT_HYSTERESIS_METERS = 580;       // Margen máximo de limpieza de estado (> 580m)
    const OVERSPEED_COOLDOWN_MS = 10000;      // Intervalo entre avisos hablados de exceso de velocidad
    const OVERSPEED_BEEP_INTERVAL_MS = 3500;  // Intervalo de pulso sonoro mientras persista el exceso
    const OVERSPEED_ALERT_TEXT = "Reduce la velocidad, vas muy rápido";
    const COOLDOWN_MS = 15 * 60 * 1000;       // 15 minutos de enfriamiento para alertas dinámicas de tránsito

    // Mapa global persistente fuera del ciclo de eventos indexado por radar.id:
    // radarTrackingState[radar.id] = {
    //   initialAlertFired: true, initialAlertDone: true, distanciaAnterior: 300,
    //   dismissedByUser: false, safeSpeedBeepsPlayed: false, isOverspeedActive: false, ...
    // }
    const radarTrackingState = (typeof window !== 'undefined' && window.radarTrackingState && typeof window.radarTrackingState === 'object')
        ? window.radarTrackingState
        : {};
    if (typeof window !== 'undefined') {
        window.radarTrackingState = radarTrackingState;
    }

    // Cooldown post-cruce para no re-disparar la misma cámara mientras el vehículo se aleja dentro del radio
    const _passedCooldownMap = {};            // { radarId: { closedDistance, timestamp, entryRadius } }
    const _trafficTrackingState = {};         // { alertId: { distanciaAnterior, dismissedByUser } }
    let _pendingOverspeedTimer = null;

    // Estado del módulo
    let _isEnabled = localStorage.getItem('copilotRadar') !== 'off';
    let _isVoiceEnabled = localStorage.getItem('radarVoice') !== 'off';
    let _alertVolumePercent = parseInt(localStorage.getItem('radarVolumePercent') || '85', 10);
    let _lastAlertTime = {};              // { trafficAlertId: timestamp }
    let _activeHudRadarId = null;         // ID del radar actualmente mostrado en el HUD
    let _currentHudTarget = null;         // Objeto radar/alerta actualmente renderizado en el HUD
    let _lastPosition = null;             // { lat, lng, time, speed, bearing }
    let _audioCtx = null;
    let _hudTimer = null;
    let _liveTrafficAlerts = [];          // Alertas activas de tránsito en tiempo real (Firebase)
    let _warnedTrafficApproaches = new Set(); // IDs de alertas ya cantadas en la aproximación actual
    let _firebaseAlertsListening = false;

    function _stopAllAudio() {
        if (_pendingOverspeedTimer) {
            clearTimeout(_pendingOverspeedTimer);
            _pendingOverspeedTimer = null;
        }
        console.log('⏹️ [COPILOTO] _stopAllAudio() ejecutado');
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            try { window.speechSynthesis.cancel(); } catch (_) {}
        }
        if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.stopAudio === 'function') {
            try { AndroidServices.stopAudio(); } catch (_) {}
        }
        if (window.NativeServiceBridge && typeof window.NativeServiceBridge.stopAudio === 'function') {
            try { window.NativeServiceBridge.stopAudio(); } catch (_) {}
        }
    }

    let _previewDebounce = null;
    function _playVolumePreview(percent) {
        if (!_isVoiceEnabled) return;
        if (_previewDebounce) clearTimeout(_previewDebounce);
        _previewDebounce = setTimeout(() => {
            try {
                const ctx = _getAudioContext();
                if (!ctx) return;
                const playTone = () => {
                    try {
                        const now = ctx.currentTime;
                        const masterGain = ctx.createGain();
                        const volumeFactor = Math.max(0.05, Math.min(1.0, (percent || 85) / 100.0));
                        masterGain.gain.setValueAtTime(volumeFactor * 0.45, now);
                        masterGain.connect(ctx.destination);

                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(1046.5, now); // C6 nota agradable de confirmación
                        gain.gain.setValueAtTime(0.4, now);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                        osc.connect(gain);
                        gain.connect(masterGain);
                        osc.start(now);
                        osc.stop(now + 0.13);
                    } catch (_) {}
                };
                if (ctx.state === 'suspended') {
                    ctx.resume().then(playTone).catch(() => {});
                } else {
                    playTone();
                }
            } catch (_) {}
        }, 120);
    }

    function _setAlertVolume(percent, playPreview = true) {
        const val = Math.max(10, Math.min(100, parseInt(percent, 10) || 85));
        _alertVolumePercent = val;
        localStorage.setItem('radarVolumePercent', String(val));
        if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setAlertVolume === 'function') {
            try { AndroidServices.setAlertVolume(val); } catch (_) {}
        }
        if (window.NativeServiceBridge && typeof window.NativeServiceBridge.setAlertVolume === 'function') {
            try { window.NativeServiceBridge.setAlertVolume(val); } catch (_) {}
        }

        // Sincronizar todos los sliders y labels activos en la interfaz
        const sliders = ['radarVolSlider', 'copilotHudVolSlider', 'shiftsVolSlider', 'shiftsActiveVolSlider', 'settingsVolSlider'];
        sliders.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value != val) el.value = val;
        });
        const labels = ['radarVolLabel', 'copilotHudVolLabel', 'shiftsVolLabel', 'shiftsActiveVolLabel', 'settingsVolPercentDisplay'];
        labels.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = val + '%';
        });

        if (playPreview) {
            _playVolumePreview(val);
        }

        console.log(`🔊 [COPILOTO] Volumen independiente ajustado a ${val}%`);
    }

    // Base de Datos Oficial Rosario (80 Radares y Cámaras de Videocontrol con Coordenadas Exactas WGS84)
    const STATIC_RADARS = [
    {
        "id": "radar_rosario_1",
        "name": "España y San Lorenzo",
        "lat": -32.942635,
        "lng": -60.645948,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "ESPAÑA Y SAN LORENZO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_2",
        "name": "Mendoza y Av. Provincias Unidas",
        "lat": -32.940218,
        "lng": -60.712617,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "MENDOZA Y PROVINCIAS UNIDAS",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_3",
        "name": "Laprida 850",
        "lat": -32.947905,
        "lng": -60.634233,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "LAPRIDA FRANCISCO NARCISO 850",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_4",
        "name": "Necochea 2650",
        "lat": -32.970673,
        "lng": -60.629809,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "NECOCHEA GRAL. MARIANO 2650",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_5",
        "name": "Ayacucho y Av. Arijón",
        "lat": -33.002625,
        "lng": -60.636058,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "AYACUCHO BATALLA DE Y ARIJON MANUEL",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_6",
        "name": "Maipú y Mendoza",
        "lat": -32.952,
        "lng": -60.63655,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "MAIPU Y MENDOZA",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_7",
        "name": "Córdoba y Av. Ovidio Lagos",
        "lat": -32.942251,
        "lng": -60.661437,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "CORDOBA Y LAGOS OVIDIO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_8",
        "name": "Santa Fe y Pueyrredón",
        "lat": -32.941639,
        "lng": -60.657014,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "SANTA FE Y PUEYRREDON JUAN MARTIN DE",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_9",
        "name": "Santa Fe 1750",
        "lat": -32.943309,
        "lng": -60.64682,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "SANTA FE 1750",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_10",
        "name": "Laprida y 3 de Febrero",
        "lat": -32.953483,
        "lng": -60.635702,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "LAPRIDA FRANCISCO NARCISO Y TRES DE FEBRERO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_11",
        "name": "San Lorenzo 1550",
        "lat": -32.94287,
        "lng": -60.643818,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "SAN LORENZO 1550",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_12",
        "name": "Colombres 1071",
        "lat": -32.902573,
        "lng": -60.681992,
        "limit": 50,
        "desc": "Totem disuasorio.",
        "address": "COLOMBRES DR. CARLOS G 1071",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_13",
        "name": "Colombres 930",
        "lat": -32.903665,
        "lng": -60.679356,
        "limit": 50,
        "desc": "Tótem disuasorio de velocidad",
        "address": "COLOMBRES DR. CARLOS G 930",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_14",
        "name": "Frondizi 260",
        "lat": -32.91085,
        "lng": -60.676757,
        "limit": 50,
        "desc": "Exceso de velocidad.",
        "address": "FRONDIZI ARTURO 260",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_15",
        "name": "Bv. Rondeau y Baigorria",
        "lat": -32.891534,
        "lng": -60.693321,
        "limit": 50,
        "desc": "Cruce en rojo",
        "address": "RONDEAU GRAL. JOSE Y BAIGORRIA JUAN BAUTISTA",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_16",
        "name": "Mendoza y Bv. Avellaneda",
        "lat": -32.944206,
        "lng": -60.680413,
        "limit": 50,
        "desc": "Cruce en rojo",
        "address": "MENDOZA Y AVELLANEDA NICOLAS",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_17",
        "name": "Cafferata 850",
        "lat": -32.941091,
        "lng": -60.671253,
        "limit": 50,
        "desc": "Invasión ciclovía",
        "address": "CAFFERATA JUAN MANUEL 850",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_18",
        "name": "Mendoza 5350",
        "lat": -32.941184,
        "lng": -60.69654,
        "limit": 50,
        "desc": "Invasión ciclovía",
        "address": "MENDOZA 5350",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_19",
        "name": "Colombres 1451",
        "lat": -32.89803,
        "lng": -60.684388,
        "limit": 50,
        "desc": "Invasión de ciclovía",
        "address": "COLOMBRES DR. CARLOS G 1451",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_20",
        "name": "Córdoba 3050",
        "lat": -32.941517,
        "lng": -60.664756,
        "limit": 50,
        "desc": "Invación carril exclusivo",
        "address": "CORDOBA 3050",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_21",
        "name": "Santa Fe 2850",
        "lat": -32.94065,
        "lng": -60.661745,
        "limit": 50,
        "desc": "Invasión carril exclusivo",
        "address": "SANTA FE 2850",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_22",
        "name": "Av. Arijón 750",
        "lat": -33.002789,
        "lng": -60.645956,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "ARIJON MANUEL 750",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_23",
        "name": "Av. Belgrano 2131 - Sur-Norte",
        "lat": -32.96665,
        "lng": -60.621018,
        "limit": 60,
        "desc": "Exceso de velocidad",
        "address": "BELGRANO GRAL. MANUEL 2131",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_24",
        "name": "Casiano Casas y Sorrento",
        "lat": -32.907258,
        "lng": -60.695756,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "CASAS CASIANO Y SORRENTO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_26",
        "name": "Av. Estanislao López y Av. Francia",
        "lat": -32.925269,
        "lng": -60.66138,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "LOPEZ ESTANISLAO Y FRANCIA",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_27",
        "name": "Juan José Paso y Cullen",
        "lat": -32.920183,
        "lng": -60.709713,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PASO JUAN JOSE Y CULLEN DOMINGO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_28",
        "name": "Av. Pellegrini y Gutenberg",
        "lat": -32.948475,
        "lng": -60.690025,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y GUTENBERG JUAN",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_29",
        "name": "Av. Provincias Unidas y Av. Pellegrini",
        "lat": -32.948576,
        "lng": -60.712266,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PROVINCIAS UNIDAS Y PELLEGRINI CARLOS",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_30",
        "name": "Av. Pellegrini y Av. Ovidio Lagos",
        "lat": -32.953098,
        "lng": -60.66419,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y LAGOS OVIDIO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_31",
        "name": "Bv. Oroño y Bv. Seguí",
        "lat": -32.97636,
        "lng": -60.661512,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "OROÑO NICASIO Y SEGUI JUAN FRANCISCO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_32",
        "name": "Av. Pellegrini y Rouillón",
        "lat": -32.948301,
        "lng": -60.70193,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y ROUILLON ALFREDO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_33",
        "name": "Av. Presidente Perón y Rouillón",
        "lat": -32.962875,
        "lng": -60.701377,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PERON PTE. JUAN DOMINGO Y ROUILLON ALFREDO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_34",
        "name": "Av. Travesía (Sabin) y Bv. Avellaneda",
        "lat": -32.928855,
        "lng": -60.676595,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "SABIN ALBERT Y AVELLANEDA NICOLAS",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_35",
        "name": "Av. Uriburu y Bv. Avellaneda",
        "lat": -32.991941,
        "lng": -60.688768,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "URIBURU PTE. JOSE EVARISTO Y AVELLANEDA NICOLAS",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_36",
        "name": "Bv. Rondeau 1250",
        "lat": -32.90174,
        "lng": -60.689834,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "RONDEAU GRAL. JOSE 1250",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_37",
        "name": "Av. Pellegrini 1551",
        "lat": -32.956361,
        "lng": -60.647227,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "PELLEGRINI CARLOS 1551",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_38",
        "name": "Av. Provincias Unidas 750",
        "lat": -32.936316,
        "lng": -60.713057,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "PROVINCIAS UNIDAS 750",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_39",
        "name": "Av. Provincias Unidas 2550",
        "lat": -32.958707,
        "lng": -60.712083,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "PROVINCIAS UNIDAS 2550",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_40",
        "name": "Bv. Oroño 2170",
        "lat": -32.960032,
        "lng": -60.657712,
        "limit": 60,
        "desc": "Tótem disuasorio de velocidad",
        "address": "OROÑO NICASIO 2170",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_41",
        "name": "Av. Estanislao López 2530",
        "lat": -32.928495,
        "lng": -60.65454,
        "limit": 60,
        "desc": "Tótem disuasorio de velocidad",
        "address": "LOPEZ ESTANISLAO 2530",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_42",
        "name": "Av. Belgrano 181 Bis",
        "lat": -32.957185,
        "lng": -60.622465,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "BELGRANO GRAL. MANUEL 181 BIS",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_43",
        "name": "Av. Estanislao López 2531",
        "lat": -32.928745,
        "lng": -60.654986,
        "limit": 60,
        "desc": "Exceso de velocidad",
        "address": "LOPEZ ESTANISLAO 2531",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_44",
        "name": "Av. Uriburu 1185",
        "lat": -32.991,
        "lng": -60.650593,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "URIBURU PTE. JOSE EVARISTO 1185",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_45",
        "name": "Sorrento 6431",
        "lat": -32.908015,
        "lng": -60.710811,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "SORRENTO 6431",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_46",
        "name": "Av. 27 de Febrero y Matienzo",
        "lat": -32.958746,
        "lng": -60.693969,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "VEINTISIETE DE FEBRERO Y MATIENZO CAPITAN BENJAMIN",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_47",
        "name": "Av. Jorge Newbery 7915",
        "lat": -32.908616,
        "lng": -60.733412,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "NEWBERY JORGE 7915",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_48",
        "name": "ILLIA PTE. ARTURO U. 1402",
        "lat": -32.937028,
        "lng": -60.639938,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "ILLIA PTE. ARTURO U. 1402",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_49",
        "name": "Bv. Seguí 3820",
        "lat": -32.97219,
        "lng": -60.683506,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "SEGUI JUAN FRANCISCO 3820",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_50",
        "name": "Bv. Avellaneda 2951",
        "lat": -32.964331,
        "lng": -60.685223,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "AVELLANEDA NICOLAS 2951",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_51",
        "name": "Sorrento y Circunvalación (Colectora)",
        "lat": -32.908234,
        "lng": -60.722652,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "SORRENTO Y JUAN PABLO II",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_52",
        "name": "Av. Ovidio Lagos y Av. Arijón",
        "lat": -33.003837,
        "lng": -60.676165,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "LAGOS OVIDIO Y ARIJON MANUEL",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_53",
        "name": "Av. 27 de Febrero y Av. Francia",
        "lat": -32.962699,
        "lng": -60.670855,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "VEINTISIETE DE FEBRERO Y FRANCIA",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_54",
        "name": "Bv. Avellaneda y Av. Carballo",
        "lat": -32.921979,
        "lng": -60.674815,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "AVELLANEDA NICOLAS Y CARBALLO LUIS CANDIDO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_55",
        "name": "Av. Belgrano y Raúl Domínguez",
        "lat": -32.949759,
        "lng": -60.628175,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "BELGRANO GRAL. MANUEL Y DOMINGUEZ, RAUL",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_56",
        "name": "Av. Francia y Av. Presidente Perón",
        "lat": -32.955902,
        "lng": -60.669142,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "FRANCIA Y PERON PTE. JUAN DOMINGO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_57",
        "name": "Av. Pellegrini y Corrientes",
        "lat": -32.956531,
        "lng": -60.645082,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y CORRIENTES",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_58",
        "name": "Bv. Oroño y Av. Uriburu",
        "lat": -32.991421,
        "lng": -60.6654,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "OROÑO NICASIO Y URIBURU PTE. JOSE EVARISTO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_59",
        "name": "Av. Presidente Perón y Av. Provincias Unidas",
        "lat": -32.967948,
        "lng": -60.711484,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PERON PTE. JUAN DOMINGO Y PROVINCIAS UNIDAS",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_60",
        "name": "Av. San Martín y Av. Uriburu",
        "lat": -32.990667,
        "lng": -60.64669,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "SAN MARTIN GRAL. JOSE Y URIBURU PTE. JOSE EVARISTO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_61",
        "name": "Av. Ovidio Lagos 3550",
        "lat": -32.97429,
        "lng": -60.669492,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "LAGOS OVIDIO 3550",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_62",
        "name": "Av. Belgrano 180 Bis",
        "lat": -32.95702,
        "lng": -60.622071,
        "limit": 60,
        "desc": "Tótem disuasorio de velocidad",
        "address": "BELGRANO GRAL. MANUEL 180 BIS",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_63",
        "name": "Callao y Salta",
        "lat": -32.935521,
        "lng": -60.658315,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "SALTA Y CALLAO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_64",
        "name": "Bv. Rondeau 3860",
        "lat": -32.879559,
        "lng": -60.696588,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "RONDEAU GRAL. JOSE 3860",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_65",
        "name": "Bv. Rondeau 2941",
        "lat": -32.886461,
        "lng": -60.695243,
        "limit": 60,
        "desc": "Control de Exceso de Velocidad",
        "address": "RONDEAU GRAL. JOSE 2941",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_66",
        "name": "Av. Uriburu 3555 Oeste-Este",
        "lat": -32.992058,
        "lng": -60.684454,
        "limit": 60,
        "desc": "Control de Exceso de Velocidad",
        "address": "URIBURU PTE. JOSE EVARISTO 3555",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_67",
        "name": "Bv. Avellaneda y Santa Fe",
        "lat": -32.937731,
        "lng": -60.678776,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "AVELLANEDA NICOLAS Y SANTA FE",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_68",
        "name": "Bv. Avellaneda y Av. Presidente Perón",
        "lat": -32.957605,
        "lng": -60.683796,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "AVELLANEDA NICOLAS Y PERON PTE. JUAN DOMINGO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_69",
        "name": "Av. San Martín y Garibaldi",
        "lat": -32.986372,
        "lng": -60.645762,
        "limit": 60,
        "desc": "Giro Indebido",
        "address": "SAN MARTIN GRAL. JOSE Y GARIBALDI JOSE",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_70",
        "name": "Carrasco 3394",
        "lat": -32.883611,
        "lng": -60.687809,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "CARRASCO EUDORO 3394",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_71",
        "name": "Bv. Oroño y Av. 27 de Febrero",
        "lat": -32.964881,
        "lng": -60.658643,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "OROÑO NICASIO Y VEINTISIETE DE FEBRERO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_72",
        "name": "Bv. Bv. Avellaneda y Bv. Seguí",
        "lat": -32.971724,
        "lng": -60.68736,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "AVELLANEDA NICOLAS Y SEGUI JUAN FRANCISCO",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_73",
        "name": "Av. Pellegrini y Bv. Avellaneda",
        "lat": -32.949941,
        "lng": -60.68186,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y AVELLANEDA NICOLAS",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_74",
        "name": "Bv. Oroño y Batlle y Ordóñez",
        "lat": -33.009436,
        "lng": -60.664703,
        "limit": 70,
        "desc": "Cruce en rojo",
        "address": "OROÑO NICASIO Y BATLLE Y ORDOÑEZ JOSE",
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rosario_segui_francia",
        "name": "Bv. Seguí entre Vera Mujica y Av. Francia",
        "lat": -32.97412,
        "lng": -60.67444,
        "limit": 60,
        "desc": "Control de velocidad / Cruce semafórico",
        "address": "BOULEVARD SEGUÍ ENTRE VERA MUJICA Y AV. FRANCIA",
        "validHeadings": [
            45,
            225
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_circ_1",
        "name": "Av. Circunvalación y Av. Pellegrini",
        "address": "Av. Circunvalación (RN A008) y Av. Pellegrini, Rosario",
        "lat": -32.949277,
        "lng": -60.722014,
        "limit": 100,
        "desc": "Radar de velocidad fija Circunvalación",
        "type": "speed_camera",
        "validHeadings": [
            177,
            357
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_circ_ovidio_lagos",
        "name": "Av. Circunvalación y Av. Ovidio Lagos",
        "address": "Av. Circunvalación (RN A008) y Av. Ovidio Lagos, Rosario",
        "lat": -33.007862,
        "lng": -60.677186,
        "limit": 100,
        "desc": "Radar de velocidad fija Circunvalación",
        "type": "speed_camera",
        "validHeadings": [
            124,
            304
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_circ_3",
        "name": "Av. Circunvalación y Av. Uriburu",
        "address": "Av. Circunvalación (RN A008) y Av. Uriburu, Rosario",
        "lat": -32.992051,
        "lng": -60.701986,
        "limit": 100,
        "desc": "Radar de velocidad fija Circunvalación",
        "type": "speed_camera",
        "validHeadings": [
            140,
            320
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_circ_5",
        "name": "Av. Circunvalación y Baigorria",
        "address": "Av. Circunvalación (RN A008) y Baigorria, Rosario",
        "lat": -32.889165,
        "lng": -60.716124,
        "limit": 100,
        "desc": "Radar de velocidad fija Circunvalación",
        "type": "speed_camera",
        "validHeadings": [
            36,
            216
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_circ_6",
        "name": "Autopista Rosario - Bs As (Ingreso Av. Circunvalación)",
        "address": "Autopista RN 9 ingreso Rosario / Av. Circunvalación",
        "lat": -33.031992,
        "lng": -60.663541,
        "limit": 70,
        "desc": "Radar ingreso a Rosario",
        "type": "speed_camera",
        "validHeadings": [
            178,
            358
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn174_islas_9",
        "name": "RN 174 km 9 (Puente Rosario - Victoria)",
        "address": "Ruta Nacional 174 km 9, Conexión Vial Rosario - Victoria",
        "lat": -32.856231,
        "lng": -60.612764,
        "limit": 80,
        "desc": "Fotomulta fija oficial ANSV / Vialidad Nacional",
        "type": "speed_camera",
        "validHeadings": [
            60,
            240
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn174_islas_20",
        "name": "RN 174 km 20 (Zona Islas Rosario - Victoria)",
        "address": "Ruta Nacional 174 km 20, Islas de Victoria, Entre Ríos",
        "lat": -32.805299,
        "lng": -60.512105,
        "limit": 80,
        "desc": "Fotomulta fija oficial ANSV / Vialidad Nacional",
        "type": "speed_camera",
        "validHeadings": [
            62,
            242
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn174_victoria_57",
        "name": "RN 174 km 57 (Acceso Victoria)",
        "address": "Ruta Nacional 174 km 57, Acceso Victoria, Entre Ríos",
        "lat": -32.619004,
        "lng": -60.188734,
        "limit": 80,
        "desc": "Fotomulta fija oficial ANSV / Vialidad Nacional",
        "type": "speed_camera",
        "validHeadings": [
            44,
            224
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rp21_pesther_279",
        "name": "RP 21 km 279 (Pueblo Esther)",
        "address": "Ruta Provincial 21 km 279, Pueblo Esther, Santa Fe",
        "lat": -33.083596,
        "lng": -60.570855,
        "limit": 60,
        "desc": "Cinemómetro comunal cuestionado / habilitación objetada",
        "type": "speed_camera",
        "validHeadings": [
            144,
            324
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rp21_alvear_284",
        "name": "RP 21 km 284 (Alvear)",
        "address": "Ruta Provincial 21 (Av. San Martín), Alvear, Santa Fe",
        "lat": -33.053735,
        "lng": -60.600964,
        "limit": 60,
        "desc": "Cinemómetro comunal en travesía RP 21 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            142,
            322
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_pesther_0",
        "name": "RN A012 km 0 (Empalme RP 21 / Pueblo Esther)",
        "address": "Empalme RN A012 / RP 16 y RP 21, Pueblo Esther, Santa Fe",
        "lat": -33.085781,
        "lng": -60.569851,
        "limit": 60,
        "desc": "Control comunal en acceso a corredor A012 / RP 21 sin aval ANSV",
        "type": "speed_camera",
        "validHeadings": [
            98,
            278
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_alvear_2",
        "name": "RN A012 km 5 (Alvear / Cruce AU 9)",
        "address": "Ruta Nacional A012 km 5, Alvear, Santa Fe",
        "lat": -33.087177,
        "lng": -60.627311,
        "limit": 60,
        "desc": "Cinemómetro comunal en ruta nacional A012 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            68,
            248
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_pinero_10",
        "name": "RN A012 km 11 (Cruce RP 18 / Cuatro Esquinas)",
        "address": "Ruta Nacional A012 y Ruta Provincial 18, Piñero / Acebal",
        "lat": -33.089671,
        "lng": -60.699958,
        "limit": 60,
        "desc": "Control móvil/fijo comunal sobre RN A012 sin aval ANSV",
        "type": "speed_camera",
        "validHeadings": [
            89,
            269
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_pinero_15",
        "name": "RN A012 km 18 (Piñero / Cruce RP 14)",
        "address": "Ruta Nacional A012 km 18 y RP 14, Piñero, Santa Fe",
        "lat": -33.092031,
        "lng": -60.790868,
        "limit": 60,
        "desc": "Cinemómetro comunal en cruce RN A012 y RP 14 sin aval Nación",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rp14_soldini_4",
        "name": "RP 14 km 4 (Soldini / Acceso Piñero)",
        "address": "Ruta Provincial 14 km 4, Soldini, Santa Fe",
        "lat": -33.035069,
        "lng": -60.75923,
        "limit": 60,
        "desc": "Cinemómetro comunal en corredor RP 14 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            7,
            187
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_zavalla_26",
        "name": "RN A012 km 26 (Zavalla / Cruce RN 33)",
        "address": "Ruta Nacional A012 km 26 y RN 33, Zavalla, Santa Fe",
        "lat": -33.018395,
        "lng": -60.905409,
        "limit": 60,
        "desc": "Control comunal sobre cruce de rutas nacionales A012 y RN 33",
        "type": "speed_camera",
        "validHeadings": [
            1,
            181
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_roldan_39",
        "name": "RN A012 km 39.1 (Roldán Sur / Cruce AU 9)",
        "address": "Ruta Nacional A012 km 39.1, Roldán, Santa Fe",
        "lat": -32.931752,
        "lng": -60.901264,
        "limit": 60,
        "desc": "Cinemómetro municipal sobre traza nacional RN A012 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            12,
            192
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_roldan_44",
        "name": "RN A012 km 44.9 (Roldán / Cruce RN 9)",
        "address": "Ruta Nacional A012 km 44.9 y RN 9, Roldán, Santa Fe",
        "lat": -32.908011,
        "lng": -60.894901,
        "limit": 60,
        "desc": "Cinemómetro sobre traza nacional RN A012 en litigio jurisdiccional",
        "type": "speed_camera",
        "validHeadings": [
            12,
            192
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_roldan_47",
        "name": "RN A012 km 47.5 (Roldán Norte)",
        "address": "Ruta Nacional A012 km 47.5, Roldán, Santa Fe",
        "lat": -32.882706,
        "lng": -60.889026,
        "limit": 60,
        "desc": "Cinemómetro sobre traza nacional RN A012 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            12,
            192
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_ricardone_56",
        "name": "RN A012 km 56 (Cruce RN 34 / Acceso Ricardone)",
        "address": "Ruta Nacional A012 km 56 y RN 34, Luis Palacios / Ricardone",
        "lat": -32.820901,
        "lng": -60.841079,
        "limit": 60,
        "desc": "Control comunal sobre cruce RN A012 y RN 34 sin aval Nación",
        "type": "speed_camera",
        "validHeadings": [
            35,
            215
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_ricardone_60",
        "name": "RN A012 km 60.4 (Ricardone Urbano)",
        "address": "Ruta Nacional A012 km 60.4, Ricardone, Santa Fe",
        "lat": -32.776596,
        "lng": -60.794394,
        "limit": 60,
        "desc": "Cinemómetro comunal en RN A012 intimado por Vialidad Nacional",
        "type": "speed_camera",
        "validHeadings": [
            56,
            236
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_ricardone_63",
        "name": "RN A012 km 62.6 (Ricardone Este)",
        "address": "Ruta Nacional A012 km 62.6, Ricardone, Santa Fe",
        "lat": -32.764943,
        "lng": -60.773255,
        "limit": 60,
        "desc": "Cinemómetro comunal en RN A012 sin autorización ANSV / VN",
        "type": "speed_camera",
        "validHeadings": [
            57,
            237
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rna012_slorenzo_64",
        "name": "RN A012 km 66 (San Lorenzo Acceso Sur)",
        "address": "Ruta Nacional A012 km 66, San Lorenzo, Santa Fe",
        "lat": -32.764702,
        "lng": -60.753652,
        "limit": 60,
        "desc": "Control municipal sobre traza nacional RN A012 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn9_campana_75",
        "name": "RN 9 km 75 (Campana)",
        "address": "Autopista RN 9 km 75, Campana, Bs As",
        "lat": -34.184612,
        "lng": -58.948588,
        "limit": 100,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            144,
            324
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_zarate_84",
        "name": "RN 9 km 85 (Zárate)",
        "address": "Autopista RN 9 km 85, Zárate, Bs As",
        "lat": -34.128212,
        "lng": -59.07676,
        "limit": 100,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            117,
            297
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_zarate_95",
        "name": "RN 9 km 95 (Zárate Oeste)",
        "address": "Autopista RN 9 km 95, Zárate, Bs As",
        "lat": -34.104338,
        "lng": -59.141248,
        "limit": 120,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            113,
            293
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_baradero_142",
        "name": "RN 9 km 144.8 (Baradero)",
        "address": "Autopista RN 9 km 144.8, Baradero, Bs As",
        "lat": -33.855475,
        "lng": -59.543205,
        "limit": 120,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            126,
            306
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_baradero_152",
        "name": "RN 9 km 152 (Acceso Baradero)",
        "address": "Autopista RN 9 km 152, Baradero, Bs As",
        "lat": -33.815706,
        "lng": -59.595733,
        "limit": 120,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            131,
            311
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_sanpedro_154",
        "name": "RN 9 km 154 (Río Tala / San Pedro)",
        "address": "Autopista RN 9 km 154, Río Tala, Bs As",
        "lat": -33.777934,
        "lng": -59.649237,
        "limit": 120,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            135,
            315
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_sanpedro_160",
        "name": "RN 9 km 162 (Acceso San Pedro)",
        "address": "Autopista RN 9 km 162, San Pedro, Bs As",
        "lat": -33.76677,
        "lng": -59.704813,
        "limit": 120,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            106,
            286
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_ramallo_205",
        "name": "RN 9 km 205 (Ramallo Sur)",
        "address": "Autopista RN 9 km 205, Ramallo, Bs As",
        "lat": -33.570339,
        "lng": -60.064406,
        "limit": 120,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            134,
            314
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_ramallo_215",
        "name": "RN 9 km 215 (Villa Ramallo)",
        "address": "Autopista RN 9 km 215, Villa Ramallo, Bs As",
        "lat": -33.490221,
        "lng": -60.150452,
        "limit": 120,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            166,
            346
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_sannicolas_228",
        "name": "RN 9 km 228 (San Nicolás)",
        "address": "Autopista RN 9 km 228, San Nicolás, Bs As",
        "lat": -33.388948,
        "lng": -60.221062,
        "limit": 100,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            131,
            311
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_sannicolas_232",
        "name": "RN 9 km 234 (San Nicolás Norte)",
        "address": "Autopista RN 9 km 234, San Nicolás, Bs As",
        "lat": -33.36052,
        "lng": -60.259991,
        "limit": 120,
        "desc": "Fotomulta fija homologada Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            132,
            312
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_theobald_246",
        "name": "RN 9 km 246 (Theobald / Límite Santa Fe)",
        "address": "Autopista RN 9 km 246, Theobald, Santa Fe",
        "lat": -33.319469,
        "lng": -60.319954,
        "limit": 120,
        "desc": "Fotomulta fija Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            132,
            312
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_villaconst_250",
        "name": "RN 9 km 250 (Villa Constitución)",
        "address": "Autopista RN 9 km 250, Villa Constitución, Santa Fe",
        "lat": -33.272539,
        "lng": -60.398641,
        "limit": 120,
        "desc": "Fotomulta fija Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            132,
            312
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_figheira_262",
        "name": "RN 9 km 262 (Fighiera)",
        "address": "Autopista RN 9 km 262, Fighiera, Santa Fe",
        "lat": -33.207365,
        "lng": -60.488253,
        "limit": 120,
        "desc": "Fotomulta fija Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            139,
            319
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_arroyoseco_268",
        "name": "RN 9 km 271 (Arroyo Seco)",
        "address": "Autopista RN 9 km 271, Arroyo Seco, Santa Fe",
        "lat": -33.170719,
        "lng": -60.527392,
        "limit": 120,
        "desc": "Fotomulta fija Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            135,
            315
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_glagos_272",
        "name": "RN 9 km 276 (General Lagos)",
        "address": "Autopista RN 9 km 276, General Lagos, Santa Fe",
        "lat": -33.12581,
        "lng": -60.581654,
        "limit": 120,
        "desc": "Fotomulta fija Autopista RN 9",
        "type": "speed_camera",
        "validHeadings": [
            134,
            314
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_alvear_282",
        "name": "RN 9 km 282 (Alvear)",
        "address": "Autopista RN 9 km 282, Alvear, Santa Fe",
        "lat": -33.07062,
        "lng": -60.644056,
        "limit": 100,
        "desc": "Fotomulta fija Autopista RN 9 (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            147,
            327
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_au9_roldan_314",
        "name": "AU 9 km 312 (Roldán / Acceso A012)",
        "address": "Autopista Rosario - Córdoba km 312, Roldán, Santa Fe",
        "lat": -32.927651,
        "lng": -60.894603,
        "limit": 130,
        "desc": "Fotomulta oficial Autopista Rosario - Córdoba (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            98,
            278
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_au9_carcarana_339",
        "name": "AU 9 km 339 (Carcarañá)",
        "address": "Autopista Rosario - Córdoba km 339, Carcarañá, Santa Fe",
        "lat": -32.881268,
        "lng": -61.143199,
        "limit": 130,
        "desc": "Cinemómetro fijo homologado APSV / Espiras magnéticas",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_au9_cdegomez_361",
        "name": "AU 9 km 361 (Cañada de Gómez)",
        "address": "Autopista Rosario - Córdoba km 361, Cañada de Gómez, Santa Fe",
        "lat": -32.845869,
        "lng": -61.395213,
        "limit": 130,
        "desc": "Cinemómetro fijo homologado APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_au9_tortugas_408",
        "name": "AU 9 km 408 (Tortugas)",
        "address": "Autopista Rosario - Córdoba km 408, Tortugas, Santa Fe",
        "lat": -32.778438,
        "lng": -61.785693,
        "limit": 130,
        "desc": "Cinemómetro fijo homologado APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_funes_travesia",
        "name": "RN 9 travesía Funes (Garita 9)",
        "address": "Ruta Nacional 9 (RN 1V09) Garita 9, Funes, Santa Fe",
        "lat": -32.921138,
        "lng": -60.813157,
        "limit": 60,
        "desc": "Control municipal sobre travesía RN 9 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn9_roldan_travesia",
        "name": "RN 9 travesía Roldán (km 322)",
        "address": "Ruta Nacional 9 (RN 1V09) km 322, Roldán, Santa Fe",
        "lat": -32.905573,
        "lng": -60.908651,
        "limit": 60,
        "desc": "Cinemómetro municipal en travesía RN 9 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn9_sanjeronimo_340",
        "name": "RN 9 km 333 (San Jerónimo Sud)",
        "address": "Ruta Nacional 9 (RN 1V09) km 333, San Jerónimo Sud, Santa Fe",
        "lat": -32.884888,
        "lng": -61.024531,
        "limit": 60,
        "desc": "Cinemómetro comunal en travesía RN 9 sin aval ANSV",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn9_carcarana_361",
        "name": "RN 9 km 345 (Carcarañá)",
        "address": "Ruta Nacional 9 (RN 1V09) km 345, Carcarañá, Santa Fe",
        "lat": -32.862033,
        "lng": -61.153113,
        "limit": 60,
        "desc": "Cinemómetro municipal sobre traza RN 9 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn9_correa_352",
        "name": "RN 9 km 356 (Correa)",
        "address": "Ruta Nacional 9 (RN 1V09) km 356, Correa, Santa Fe",
        "lat": -32.852703,
        "lng": -61.252723,
        "limit": 60,
        "desc": "Cinemómetro comunal sobre traza RN 9 sin aval Nación",
        "type": "speed_camera",
        "validHeadings": [
            99,
            279
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn9_cdegomez_379",
        "name": "RN 9 km 372 (Cañada de Gómez)",
        "address": "Ruta Nacional 9 (RN 1V09) km 372, Cañada de Gómez, Santa Fe",
        "lat": -32.811513,
        "lng": -61.387627,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Cañada de Gómez (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_armstrong_396",
        "name": "RN 9 km 393 (Armstrong)",
        "address": "Ruta Nacional 9 (RN 1V09) km 393, Armstrong, Santa Fe",
        "lat": -32.774288,
        "lng": -61.603355,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_tortugas_420",
        "name": "RN 9 km 415 (Tortugas)",
        "address": "Ruta Nacional 9 (RN 1V09) km 415, Tortugas, Santa Fe",
        "lat": -32.738106,
        "lng": -61.813818,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            101,
            281
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_mjuarez_440",
        "name": "RN 9 km 442 (Marcos Juárez)",
        "address": "Ruta Nacional 9 km 442, Marcos Juárez, Córdoba",
        "lat": -32.687318,
        "lng": -62.102728,
        "limit": 60,
        "desc": "Control travesía urbana RN 9 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            101,
            281
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_leones_465",
        "name": "RN 9 km 462 (Leones)",
        "address": "Ruta Nacional 9 km 462, Leones, Córdoba",
        "lat": -32.65305,
        "lng": -62.295914,
        "limit": 60,
        "desc": "Control travesía urbana RN 9 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            110,
            290
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_bellville_500",
        "name": "RN 9 km 500 (Bell Ville)",
        "address": "Ruta Nacional 9 km 500, Bell Ville, Córdoba",
        "lat": -32.610244,
        "lng": -62.692691,
        "limit": 60,
        "desc": "Control travesía urbana RN 9 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            81,
            261
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn9_vmaria_560",
        "name": "RN 9 km 560 (Villa María)",
        "address": "Ruta Nacional 9 km 560, Villa María, Córdoba",
        "lat": -32.407917,
        "lng": -63.239318,
        "limit": 60,
        "desc": "Control travesía urbana RN 9 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            143,
            323
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_ibarlucea_5",
        "name": "RN 34 km 4.7 (Ibarlucea Sur)",
        "address": "Ruta Nacional 34 km 4.7, Ibarlucea, Santa Fe",
        "lat": -32.867726,
        "lng": -60.762894,
        "limit": 60,
        "desc": "Cinemómetro comunal en traza nacional RN 34 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            125,
            305
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn34_ibarlucea_13",
        "name": "RN 34 km 8.2 (Ibarlucea Urbano)",
        "address": "Ruta Nacional 34 km 8.2, Ibarlucea, Santa Fe",
        "lat": -32.847693,
        "lng": -60.790578,
        "limit": 60,
        "desc": "Cinemómetro comunal en traza nacional RN 34 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            95,
            275
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn34_lpalacios_20",
        "name": "RN 34 km 20.5 (Luis Palacios Sur)",
        "address": "Ruta Nacional 34 km 20.5, Luis Palacios, Santa Fe",
        "lat": -32.786163,
        "lng": -60.898121,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 homologada APSV / INTI",
        "type": "speed_camera",
        "validHeadings": [
            138,
            318
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_lpalacios_22",
        "name": "RN 34 km 22.2 (Luis Palacios Urbano)",
        "address": "Ruta Nacional 34 km 22.2, Luis Palacios, Santa Fe",
        "lat": -32.775063,
        "lng": -60.906934,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 homologada APSV / INTI",
        "type": "speed_camera",
        "validHeadings": [
            147,
            327
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_saltogrande_42",
        "name": "RN 34 km 42 (Salto Grande)",
        "address": "Ruta Nacional 34 km 42, Salto Grande, Santa Fe",
        "lat": -32.675062,
        "lng": -61.085263,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            98,
            278
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_totoras_54",
        "name": "RN 34 km 56 (Totoras)",
        "address": "Ruta Nacional 34 km 56, Totoras, Santa Fe",
        "lat": -32.595047,
        "lng": -61.178726,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            133,
            313
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_clason_68",
        "name": "RN 34 km 68 (Clason)",
        "address": "Ruta Nacional 34 km 68, Clason, Santa Fe",
        "lat": -32.531312,
        "lng": -61.235608,
        "limit": 60,
        "desc": "Control comunal sobre RN 34 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            147,
            327
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn34_sangenaro_86",
        "name": "RN 34 km 86 (San Genaro)",
        "address": "Ruta Nacional 34 km 86, San Genaro, Santa Fe",
        "lat": -32.377273,
        "lng": -61.36615,
        "limit": 60,
        "desc": "Fotomulta fija RN 34 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            132,
            312
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_centeno_98",
        "name": "RN 34 km 98 (Centeno)",
        "address": "Ruta Nacional 34 km 98, Centeno, Santa Fe",
        "lat": -32.295035,
        "lng": -61.418684,
        "limit": 60,
        "desc": "Cinemómetro comunal en travesía RN 34 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            5,
            185
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn34_casas_112",
        "name": "RN 34 km 112 (Casas)",
        "address": "Ruta Nacional 34 km 112, Casas, Santa Fe",
        "lat": -32.1337,
        "lng": -61.542175,
        "limit": 60,
        "desc": "Cinemómetro comunal en travesía RN 34 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn34_crosquin_129",
        "name": "RN 34 km 129 (Cañada Rosquín)",
        "address": "Ruta Nacional 34 km 129, Cañada Rosquín, Santa Fe",
        "lat": -32.049151,
        "lng": -61.591044,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            151,
            331
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_smescobas_152",
        "name": "RN 34 km 152 (San Martín de las Escobas)",
        "address": "Ruta Nacional 34 km 152, San Martín de las Escobas, Santa Fe",
        "lat": -31.855466,
        "lng": -61.583818,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            11,
            191
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_bandurrias_168",
        "name": "RN 34 km 164 (Las Bandurrias)",
        "address": "Ruta Nacional 34 km 164, Las Bandurrias, Santa Fe",
        "lat": -31.818135,
        "lng": -61.57477,
        "limit": 60,
        "desc": "Fotomulta fija RN 34 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            19,
            199
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_svicente_178",
        "name": "RN 34 km 178 (San Vicente)",
        "address": "Ruta Nacional 34 km 178, San Vicente, Santa Fe",
        "lat": -31.701296,
        "lng": -61.554397,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            11,
            191
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_angelica_192",
        "name": "RN 34 km 187 (Angélica / Cruce RN 19)",
        "address": "Ruta Nacional 34 km 187 y RN 19, Angélica, Santa Fe",
        "lat": -31.532615,
        "lng": -61.52705,
        "limit": 60,
        "desc": "Fotomulta cruce RN 34 y RN 19 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            12,
            192
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_rafaela_220",
        "name": "RN 34 km 220 (Rafaela)",
        "address": "Ruta Nacional 34 km 220, Rafaela, Santa Fe",
        "lat": -31.243843,
        "lng": -61.531463,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Rafaela homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            15,
            195
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_lehmann_237",
        "name": "RN 34 km 233 (Lehmann)",
        "address": "Ruta Nacional 34 km 233, Lehmann, Santa Fe",
        "lat": -31.159578,
        "lng": -61.481861,
        "limit": 110,
        "desc": "Fotomulta fija RN 34 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            11,
            191
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_ataliva_248",
        "name": "RN 34 km 248 (Ataliva)",
        "address": "Ruta Nacional 34 km 248, Ataliva, Santa Fe",
        "lat": -31.018192,
        "lng": -61.462393,
        "limit": 60,
        "desc": "Control travesía RN 34",
        "type": "speed_camera",
        "validHeadings": [
            140,
            320
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_sunchales_258",
        "name": "RN 34 km 258 (Sunchales)",
        "address": "Ruta Nacional 34 km 258, Sunchales, Santa Fe",
        "lat": -30.940862,
        "lng": -61.541995,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Sunchales homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            173,
            353
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_tacural_276",
        "name": "RN 34 km 273 (Tacural)",
        "address": "Ruta Nacional 34 km 273, Tacural, Santa Fe",
        "lat": -30.842194,
        "lng": -61.584155,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            150,
            330
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_arrufo_342",
        "name": "RN 34 km 340 (Arrufó)",
        "address": "Ruta Nacional 34 km 340, Arrufó, Santa Fe",
        "lat": -30.231877,
        "lng": -61.725856,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            159,
            339
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_hersilia_368",
        "name": "RN 34 km 368 (Hersilia)",
        "address": "Ruta Nacional 34 km 368, Hersilia, Santa Fe",
        "lat": -30.004243,
        "lng": -61.831108,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34 (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            2,
            182
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn34_ceres_388",
        "name": "RN 34 km 388 (Ceres)",
        "address": "Ruta Nacional 34 km 388, Ceres, Santa Fe",
        "lat": -29.876081,
        "lng": -61.937896,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Ceres homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            140,
            320
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_perez_782",
        "name": "RN 33 km 783 (Pérez Este)",
        "address": "Ruta Nacional 33 km 783, Pérez, Santa Fe",
        "lat": -32.993303,
        "lng": -60.761082,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Pérez homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            60,
            240
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_perez_786",
        "name": "RN 33 km 786.6 (Pérez Oeste)",
        "address": "Ruta Nacional 33 km 786.6, Pérez, Santa Fe",
        "lat": -33.006723,
        "lng": -60.78883,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Pérez homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            59,
            239
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_zavalla_775",
        "name": "RN 33 km 775 (Zavalla)",
        "address": "Ruta Nacional 33 km 775, Zavalla, Santa Fe",
        "lat": -33.019032,
        "lng": -60.878871,
        "limit": 60,
        "desc": "Cinemómetro comunal en travesía RN 33 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            91,
            271
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn33_pujato_755",
        "name": "RN 33 km 755.5 (Pujato Este)",
        "address": "Ruta Nacional 33 km 755.5, Pujato, Santa Fe",
        "lat": -33.016904,
        "lng": -61.030129,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Pujato homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            85,
            265
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_pujato_756",
        "name": "RN 33 km 757 (Pujato Oeste)",
        "address": "Ruta Nacional 33 km 757, Pujato, Santa Fe",
        "lat": -33.016906,
        "lng": -61.048721,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Pujato homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            111,
            291
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_casilda_741",
        "name": "RN 33 km 741 (Casilda)",
        "address": "Ruta Nacional 33 y Bv. Lisandro de la Torre, Casilda, Santa Fe",
        "lat": -33.053378,
        "lng": -61.157734,
        "limit": 60,
        "desc": "Cinemómetro municipal sobre traza nacional RN 33 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            61,
            241
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn33_sanford_726",
        "name": "RN 33 km 726 (Sanford)",
        "address": "Ruta Nacional 33 km 726, Sanford, Santa Fe",
        "lat": -33.145165,
        "lng": -61.278824,
        "limit": 60,
        "desc": "Cinemómetro comunal en travesía RN 33 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            33,
            213
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn33_chabas_715",
        "name": "RN 33 km 715 (Chabás)",
        "address": "Ruta Nacional 33 km 715, Chabás, Santa Fe",
        "lat": -33.241162,
        "lng": -61.355947,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Chabás homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            34,
            214
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_villada_705",
        "name": "RN 33 km 705 (Villada)",
        "address": "Ruta Nacional 33 km 705, Villada, Santa Fe",
        "lat": -33.349708,
        "lng": -61.445046,
        "limit": 60,
        "desc": "Control comunal en travesía RN 33 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            34,
            214
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn33_firmat_694",
        "name": "RN 33 km 690 (Firmat)",
        "address": "Ruta Nacional 33 km 690, Firmat, Santa Fe",
        "lat": -33.455085,
        "lng": -61.500755,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Firmat homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            57,
            237
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_cucle_680",
        "name": "RN 33 km 676 (Cañada del Ucle)",
        "address": "Ruta Nacional 33 km 676, Cañada del Ucle, Santa Fe",
        "lat": -33.481738,
        "lng": -61.550037,
        "limit": 60,
        "desc": "Control travesía urbana RN 33",
        "type": "speed_camera",
        "validHeadings": [
            57,
            237
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn33_chovet_667",
        "name": "RN 33 km 667 (Acceso Chovet)",
        "address": "Ruta Nacional 33 km 667, Chovet, Santa Fe",
        "lat": -33.539891,
        "lng": -61.652644,
        "limit": 60,
        "desc": "Control cruce RN 33",
        "type": "speed_camera",
        "validHeadings": [
            57,
            237
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_murphy_648",
        "name": "RN 33 km 648 (Murphy)",
        "address": "Ruta Nacional 33 km 648, Murphy, Santa Fe",
        "lat": -33.645151,
        "lng": -61.851852,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Murphy homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            87,
            267
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_vtuerto_634",
        "name": "RN 33 km 636 (Venado Tuerto)",
        "address": "Ruta Nacional 33 km 636, Venado Tuerto, Santa Fe",
        "lat": -33.712135,
        "lng": -61.977653,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Venado Tuerto homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            57,
            237
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_sspiritu_575",
        "name": "RN 33 km 595 (Sancti Spíritu)",
        "address": "Ruta Nacional 33 km 595, Sancti Spíritu, Santa Fe",
        "lat": -34.004191,
        "lng": -62.270147,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            12,
            192
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_amenabar_567",
        "name": "RN 33 km 575 (Amenábar / Lazzarino)",
        "address": "Ruta Nacional 33 km 575, Amenábar, Santa Fe",
        "lat": -34.126445,
        "lng": -62.425986,
        "limit": 60,
        "desc": "Fotomulta fija RN 33 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            62,
            242
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn33_rufino_540",
        "name": "RN 33 km 540 (Rufino)",
        "address": "Ruta Nacional 33 km 540, Rufino, Santa Fe",
        "lat": -34.266904,
        "lng": -62.687271,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Rufino (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            26,
            206
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_gbaigorria_315",
        "name": "RN 11 km 315 (Granadero Baigorria Sur)",
        "address": "Ruta Nacional 11 (Av. San Martín) km 315, Granadero Baigorria",
        "lat": -32.863562,
        "lng": -60.701799,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Granadero Baigorria (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            166,
            346
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_gbaigorria_318",
        "name": "RN 11 km 318.4 (Granadero Baigorria Norte)",
        "address": "Ruta Nacional 11 (Av. San Martín) km 318.4, Granadero Baigorria",
        "lat": -32.842438,
        "lng": -60.708213,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Granadero Baigorria (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            166,
            346
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_cbermudez_324",
        "name": "RN 11 km 323 (Capitán Bermúdez)",
        "address": "Ruta Nacional 11 km 323, Capitán Bermúdez, Santa Fe",
        "lat": -32.816565,
        "lng": -60.716214,
        "limit": 60,
        "desc": "Cinemómetro municipal en traza nacional RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            165,
            345
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_flbeltran_328",
        "name": "RN 11 km 327 (Fray Luis Beltrán)",
        "address": "Ruta Nacional 11 km 327, Fray Luis Beltrán, Santa Fe",
        "lat": -32.786424,
        "lng": -60.725304,
        "limit": 60,
        "desc": "Cinemómetro municipal en traza nacional RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            164,
            344
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_slorenzo_335",
        "name": "RN 11 km 332 (San Lorenzo)",
        "address": "Ruta Nacional 11 km 332, San Lorenzo, Santa Fe",
        "lat": -32.745651,
        "lng": -60.734082,
        "limit": 60,
        "desc": "Control municipal sobre traza nacional RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            1,
            181
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_pgsm_340",
        "name": "RN 11 km 337 (Puerto Gral. San Martín)",
        "address": "Ruta Nacional 11 km 337, Puerto Gral. San Martín, Santa Fe",
        "lat": -32.720702,
        "lng": -60.751441,
        "limit": 60,
        "desc": "Control municipal sobre traza nacional RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            148,
            328
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_timbues_348",
        "name": "RN 11 km 345 (Timbúes)",
        "address": "Ruta Nacional 11 km 345, Timbúes, Santa Fe",
        "lat": -32.666169,
        "lng": -60.793416,
        "limit": 60,
        "desc": "Cinemómetro comunal en traza nacional RN 11 sin aval Nación",
        "type": "speed_camera",
        "validHeadings": [
            147,
            327
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_oliveros_360",
        "name": "RN 11 km 356 (Oliveros)",
        "address": "Ruta Nacional 11 km 356, Oliveros, Santa Fe",
        "lat": -32.573306,
        "lng": -60.851288,
        "limit": 60,
        "desc": "Cinemómetro comunal en traza nacional RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            162,
            342
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_maciel_370",
        "name": "RN 11 km 368 (Maciel)",
        "address": "Ruta Nacional 11 km 368, Maciel, Santa Fe",
        "lat": -32.456362,
        "lng": -60.889147,
        "limit": 60,
        "desc": "Cinemómetro comunal en traza nacional RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            170,
            350
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_monje_382",
        "name": "RN 11 km 380 (Monje)",
        "address": "Ruta Nacional 11 km 380, Monje, Santa Fe",
        "lat": -32.359439,
        "lng": -60.939848,
        "limit": 60,
        "desc": "Control comunal en acceso RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            162,
            342
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_barrancas_395",
        "name": "RN 11 km 394 (Barrancas)",
        "address": "Ruta Nacional 11 km 394, Barrancas, Santa Fe",
        "lat": -32.234183,
        "lng": -60.980287,
        "limit": 60,
        "desc": "Cinemómetro comunal en traza nacional RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            0,
            180
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_arocena_410",
        "name": "RN 11 km 408 (Arocena)",
        "address": "Ruta Nacional 11 km 408, Arocena, Santa Fe",
        "lat": -32.079203,
        "lng": -60.974837,
        "limit": 60,
        "desc": "Cinemómetro comunal en traza nacional RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            24,
            204
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_coronda_428",
        "name": "RN 11 km 425 (Coronda)",
        "address": "Ruta Nacional 11 km 425, Coronda, Santa Fe",
        "lat": -31.972815,
        "lng": -60.926793,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Coronda (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            10,
            190
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_sauceviejo_460",
        "name": "RN 11 km 456 (Sauce Viejo)",
        "address": "Ruta Nacional 11 km 456, Sauce Viejo, Santa Fe",
        "lat": -31.729457,
        "lng": -60.814187,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Sauce Viejo homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            18,
            198
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_stotome_470",
        "name": "RN 11 km 465 (Santo Tomé)",
        "address": "Ruta Nacional 11 km 465, Santo Tomé, Santa Fe",
        "lat": -31.666759,
        "lng": -60.762409,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Santo Tomé (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            98,
            278
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_recreo_485",
        "name": "RN 11 km 482 (Recreo)",
        "address": "Ruta Nacional 11 km 482, Recreo, Santa Fe",
        "lat": -31.497005,
        "lng": -60.75237,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Recreo homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            170,
            350
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_candioti_495",
        "name": "RN 11 km 495 (Candioti)",
        "address": "Ruta Nacional 11 km 495, Candioti, Santa Fe",
        "lat": -31.401318,
        "lng": -60.747142,
        "limit": 60,
        "desc": "Cinemómetro comunal en travesía RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            176,
            356
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_nelson_515",
        "name": "RN 11 km 509 (Nelson)",
        "address": "Ruta Nacional 11 km 509, Nelson, Santa Fe",
        "lat": -31.267908,
        "lng": -60.759145,
        "limit": 60,
        "desc": "Cinemómetro comunal en travesía RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            10,
            190
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_llambi_530",
        "name": "RN 11 km 523 (Llambi Campbell)",
        "address": "Ruta Nacional 11 km 523, Llambi Campbell, Santa Fe",
        "lat": -31.184914,
        "lng": -60.742738,
        "limit": 60,
        "desc": "Cinemómetro comunal en travesía RN 11 cuestionado",
        "type": "speed_camera",
        "validHeadings": [
            9,
            189
        ],
        "tipoHomologacion": "COMUNAL_CUESTIONADO"
    },
    {
        "id": "radar_rn11_sjusto_568",
        "name": "RN 11 km 565 (San Justo)",
        "address": "Ruta Nacional 11 km 565, San Justo, Santa Fe",
        "lat": -30.787966,
        "lng": -60.600166,
        "limit": 60,
        "desc": "Fotomulta travesía urbana San Justo homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            11,
            191
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_gcrespo_625",
        "name": "RN 11 km 618 (Gobernador Crespo)",
        "address": "Ruta Nacional 11 km 618, Gobernador Crespo, Santa Fe",
        "lat": -30.363369,
        "lng": -60.397058,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11 (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            9,
            189
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_calchaqui_670",
        "name": "RN 11 km 672 (Calchaquí)",
        "address": "Ruta Nacional 11 km 672, Calchaquí, Santa Fe",
        "lat": -29.888335,
        "lng": -60.279883,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Calchaquí homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            9,
            189
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_vera_722",
        "name": "RN 11 km 722 (Vera)",
        "address": "Ruta Nacional 11 km 722, Vera, Santa Fe",
        "lat": -29.470493,
        "lng": -60.201296,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Vera homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            45,
            225
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_malabrigo_750",
        "name": "RN 11 km 748 (Malabrigo)",
        "address": "Ruta Nacional 11 km 748, Malabrigo, Santa Fe",
        "lat": -29.357157,
        "lng": -59.965232,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Malabrigo (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            63,
            243
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_reconquista_789",
        "name": "RN 11 km 788 (Reconquista)",
        "address": "Ruta Nacional 11 km 788, Reconquista, Santa Fe",
        "lat": -29.142993,
        "lng": -59.656,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Reconquista homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            7,
            187
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn11_avellaneda_794",
        "name": "RN 11 km 795 (Avellaneda Norte)",
        "address": "Ruta Nacional 11 km 795, Avellaneda, Santa Fe",
        "lat": -29.072037,
        "lng": -59.620158,
        "limit": 60,
        "desc": "Fotomulta fija RN 11 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            8,
            188
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_gbaigorria_0",
        "name": "AP 01 km 0 (Granadero Baigorria)",
        "address": "Autopista Rosario - Santa Fe km 0, Granadero Baigorria",
        "lat": -32.870832,
        "lng": -60.721057,
        "limit": 80,
        "desc": "Fotomulta ingreso Autopista Rosario - Santa Fe (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            131,
            311
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_slorenzo_14",
        "name": "AP 01 km 14 (San Lorenzo Sur)",
        "address": "Autopista Rosario - Santa Fe km 14, San Lorenzo",
        "lat": -32.761587,
        "lng": -60.75353,
        "limit": 130,
        "desc": "Fotomulta fija Autopista AP 01 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            161,
            341
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_slorenzo_22",
        "name": "AP 01 km 22 (San Lorenzo Norte)",
        "address": "Autopista Rosario - Santa Fe km 22, San Lorenzo",
        "lat": -32.707349,
        "lng": -60.779384,
        "limit": 130,
        "desc": "Fotomulta fija Autopista AP 01 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            148,
            328
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_timbues_28",
        "name": "AP 01 km 28 (Timbúes)",
        "address": "Autopista Rosario - Santa Fe km 28, Timbúes",
        "lat": -32.664996,
        "lng": -60.815158,
        "limit": 130,
        "desc": "Fotomulta fija Autopista AP 01 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            151,
            331
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_monje_58",
        "name": "AP 01 km 58 (Monje)",
        "address": "Autopista Rosario - Santa Fe km 58, Monje",
        "lat": -32.414016,
        "lng": -60.93187,
        "limit": 130,
        "desc": "Fotomulta fija Autopista AP 01 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            160,
            340
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_arocena_90",
        "name": "AP 01 km 90 (Arocena)",
        "address": "Autopista Rosario - Santa Fe km 90, Arocena",
        "lat": -32.144976,
        "lng": -60.995653,
        "limit": 130,
        "desc": "Fotomulta fija Autopista AP 01 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            2,
            182
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_coronda_110",
        "name": "AP 01 km 110 (Coronda)",
        "address": "Autopista Rosario - Santa Fe km 110, Coronda",
        "lat": -31.980249,
        "lng": -60.97113,
        "limit": 130,
        "desc": "Fotomulta fija Autopista AP 01 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            42,
            222
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_sauceviejo_141",
        "name": "AP 01 km 141 (Sauce Viejo)",
        "address": "Autopista Rosario - Santa Fe km 141, Sauce Viejo",
        "lat": -31.745918,
        "lng": -60.83109,
        "limit": 110,
        "desc": "Fotomulta fija Autopista AP 01 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            15,
            195
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_stotome_153",
        "name": "AP 01 km 153 (Santo Tomé)",
        "address": "Autopista Rosario - Santa Fe km 153, Santo Tomé",
        "lat": -31.662996,
        "lng": -60.797288,
        "limit": 100,
        "desc": "Fotomulta fija Autopista AP 01 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            26,
            206
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_ap01_stafe_156",
        "name": "AP 01 km 156 (Acceso Santa Fe Capital)",
        "address": "Autopista Rosario - Santa Fe km 156, Santa Fe Capital",
        "lat": -31.627867,
        "lng": -60.731473,
        "limit": 60,
        "desc": "Fotomulta acceso Santa Fe Capital (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            113,
            293
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_sjose_8",
        "name": "RN 19 km 8 (Colonia San José)",
        "address": "Autovía RN 19 km 8, Colonia San José, Santa Fe",
        "lat": -31.672794,
        "lng": -60.769043,
        "limit": 110,
        "desc": "Fotomulta fija Autovía RN 19 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            108,
            288
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_sagustin_20",
        "name": "RN 19 km 20 (Acceso San Agustín)",
        "address": "Autovía RN 19 km 20, San Agustín, Santa Fe",
        "lat": -31.642043,
        "lng": -60.941981,
        "limit": 110,
        "desc": "Fotomulta fija Autovía RN 19 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            101,
            281
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_franck_30",
        "name": "RN 19 km 30 (Acceso Franck)",
        "address": "Autovía RN 19 km 30, Franck, Santa Fe",
        "lat": -31.625023,
        "lng": -61.055767,
        "limit": 110,
        "desc": "Fotomulta fija Autovía RN 19 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            87,
            267
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_sjsauce_37",
        "name": "RN 19 km 37 (San Jerónimo del Sauce)",
        "address": "Autovía RN 19 km 37, San Jerónimo del Sauce, Santa Fe",
        "lat": -31.618478,
        "lng": -61.144443,
        "limit": 80,
        "desc": "Fotomulta travesía RN 19 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            107,
            287
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_sapereira_62",
        "name": "RN 19 km 62 (Sa Pereira)",
        "address": "Autovía RN 19 km 62, Sa Pereira, Santa Fe",
        "lat": -31.578111,
        "lng": -61.378675,
        "limit": 80,
        "desc": "Fotomulta RN 19 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            103,
            283
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_josefina_118",
        "name": "RN 19 km 121 (Acceso Josefina)",
        "address": "Ruta Nacional 19 km 121, Josefina, Santa Fe",
        "lat": -31.433849,
        "lng": -61.998549,
        "limit": 60,
        "desc": "Fotomulta RN 19 homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            101,
            281
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_frontera_127",
        "name": "RN 19 km 127 (Frontera / San Francisco)",
        "address": "Ruta Nacional 19 km 127, Frontera / San Francisco",
        "lat": -31.423164,
        "lng": -62.055992,
        "limit": 60,
        "desc": "Fotomulta límite interprovincial Santa Fe - Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            119,
            299
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_devoto_160",
        "name": "RN 19 km 148 (Devoto)",
        "address": "Ruta Nacional 19 km 148, Devoto, Córdoba",
        "lat": -31.4077,
        "lng": -62.306102,
        "limit": 60,
        "desc": "Control travesía urbana RN 19 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            91,
            271
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_lafrancia_185",
        "name": "RN 19 km 180 (La Francia)",
        "address": "Ruta Nacional 19 km 180, La Francia, Córdoba",
        "lat": -31.404625,
        "lng": -62.633179,
        "limit": 60,
        "desc": "Control travesía urbana RN 19 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            91,
            271
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_arroyito_225",
        "name": "RN 19 km 225 (Arroyito)",
        "address": "Ruta Nacional 19 km 225, Arroyito, Córdoba",
        "lat": -31.423473,
        "lng": -63.049529,
        "limit": 60,
        "desc": "Control travesía urbana RN 19 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            74,
            254
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn19_rioprimero_280",
        "name": "RN 19 km 280 (Río Primero)",
        "address": "Ruta Nacional 19 km 280, Río Primero, Córdoba",
        "lat": -31.333556,
        "lng": -63.618327,
        "limit": 60,
        "desc": "Control travesía urbana RN 19 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            120,
            300
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_ecruz_75",
        "name": "RN 8 km 73 (Parada Robles / Exaltación de la Cruz)",
        "address": "Autopista RN 8 km 73, Exaltación de la Cruz, Bs As",
        "lat": -34.391553,
        "lng": -59.028053,
        "limit": 80,
        "desc": "Fotomulta fija homologada Autopista RN 8",
        "type": "speed_camera",
        "validHeadings": [
            116,
            296
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_sareco_112",
        "name": "RN 8 km 112 (San Antonio de Areco)",
        "address": "Ruta Nacional 8 km 112, San Antonio de Areco, Bs As",
        "lat": -34.244511,
        "lng": -59.437731,
        "limit": 60,
        "desc": "Fotomulta cruce RN 8 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            120,
            300
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_csarmiento_145",
        "name": "RN 8 km 145 (Capitán Sarmiento)",
        "address": "Ruta Nacional 8 km 145, Capitán Sarmiento, Bs As",
        "lat": -34.152938,
        "lng": -59.794633,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera",
        "validHeadings": [
            87,
            267
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_arrecifes_175",
        "name": "RN 8 km 175 (Arrecifes)",
        "address": "Ruta Nacional 8 km 175, Arrecifes, Bs As",
        "lat": -34.039478,
        "lng": -60.097628,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Arrecifes",
        "type": "speed_camera",
        "validHeadings": [
            108,
            288
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_todd_184",
        "name": "RN 8 km 184 (Todd)",
        "address": "Ruta Nacional 8 km 184, Todd, Bs As",
        "lat": -34.024633,
        "lng": -60.151953,
        "limit": 60,
        "desc": "Fotomulta travesía RN 8",
        "type": "speed_camera",
        "validHeadings": [
            108,
            288
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_vina_198",
        "name": "RN 8 km 198 (Viña)",
        "address": "Ruta Nacional 8 km 198, Viña, Bs As",
        "lat": -33.997458,
        "lng": -60.232573,
        "limit": 60,
        "desc": "Fotomulta travesía RN 8",
        "type": "speed_camera",
        "validHeadings": [
            128,
            308
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_pergamino_222",
        "name": "RN 8 km 224 (Pergamino)",
        "address": "Ruta Nacional 8 km 224, Pergamino, Bs As",
        "lat": -33.919178,
        "lng": -60.549527,
        "limit": 60,
        "desc": "Fotomulta fija RN 8 Pergamino homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            43,
            223
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_colon_276",
        "name": "RN 8 km 276 (Colón)",
        "address": "Ruta Nacional 8 km 276, Colón, Bs As",
        "lat": -33.905834,
        "lng": -61.109942,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Colón",
        "type": "speed_camera",
        "validHeadings": [
            135,
            315
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_wheelwright_302",
        "name": "RN 8 km 296 (Acceso Wheelwright)",
        "address": "Ruta Nacional 8 km 296, Wheelwright, Santa Fe",
        "lat": -33.814466,
        "lng": -61.248665,
        "limit": 80,
        "desc": "Fotomulta fija RN 8 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            115,
            295
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_hughes_320",
        "name": "RN 8 km 312 (Hughes)",
        "address": "Ruta Nacional 8 km 312, Hughes, Santa Fe",
        "lat": -33.807149,
        "lng": -61.336677,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Hughes (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            100,
            280
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_sisabel_342",
        "name": "RN 8 km 340 (Santa Isabel)",
        "address": "Ruta Nacional 8 km 340, Santa Isabel, Santa Fe",
        "lat": -33.848607,
        "lng": -61.68558,
        "limit": 60,
        "desc": "Fotomulta cruce RN 8 Santa Isabel (APSV)",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_vtuerto_365",
        "name": "RN 8 km 368 (Venado Tuerto)",
        "address": "Ruta Nacional 8 km 368, Venado Tuerto, Santa Fe",
        "lat": -33.750475,
        "lng": -61.977608,
        "limit": 60,
        "desc": "Fotomulta travesía Venado Tuerto homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            147,
            327
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_maggiolo_392",
        "name": "RN 8 km 395 (Maggiolo)",
        "address": "Ruta Nacional 8 km 395, Maggiolo, Santa Fe",
        "lat": -33.667392,
        "lng": -62.232339,
        "limit": 60,
        "desc": "Control acceso Maggiolo RN 8",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_arias_410",
        "name": "RN 8 km 412 (Arias)",
        "address": "Ruta Nacional 8 km 412, Arias, Córdoba",
        "lat": -33.626433,
        "lng": -62.400116,
        "limit": 60,
        "desc": "Control travesía RN 8 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            101,
            281
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_canals_445",
        "name": "RN 8 km 452 (Canals)",
        "address": "Ruta Nacional 8 km 452, Canals, Córdoba",
        "lat": -33.531332,
        "lng": -62.876704,
        "limit": 60,
        "desc": "Control travesía RN 8 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            103,
            283
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn8_lacarlota_500",
        "name": "RN 8 km 500 (La Carlota)",
        "address": "Ruta Nacional 8 km 500, La Carlota, Córdoba",
        "lat": -33.395791,
        "lng": -63.28961,
        "limit": 60,
        "desc": "Control travesía RN 8 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            98,
            278
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn7_lujan_68",
        "name": "RN 7 km 68 (Luján)",
        "address": "Autopista RN 7 km 68, Luján, Bs As",
        "lat": -34.546539,
        "lng": -59.164546,
        "limit": 80,
        "desc": "Fotomulta fija homologada Autopista RN 7",
        "type": "speed_camera",
        "validHeadings": [
            66,
            246
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn7_giles_98",
        "name": "RN 7 km 102 (San Andrés de Giles)",
        "address": "Autopista RN 7 km 102, San Andrés de Giles, Bs As",
        "lat": -34.465514,
        "lng": -59.444368,
        "limit": 100,
        "desc": "Fotomulta fija homologada Autopista RN 7",
        "type": "speed_camera",
        "validHeadings": [
            84,
            264
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn7_careco_140",
        "name": "RN 7 km 141 (Carmen de Areco)",
        "address": "Ruta Nacional 7 km 141, Carmen de Areco, Bs As",
        "lat": -34.414855,
        "lng": -59.853415,
        "limit": 60,
        "desc": "Fotomulta cruce RN 7 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            51,
            231
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn7_chacabuco_208",
        "name": "RN 7 km 204 (Chacabuco)",
        "address": "Autopista RN 7 km 204, Chacabuco, Bs As",
        "lat": -34.623276,
        "lng": -60.422077,
        "limit": 80,
        "desc": "Fotomulta fija RN 7 Chacabuco homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            81,
            261
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn7_junin_260",
        "name": "RN 7 km 260 (Junín)",
        "address": "Ruta Nacional 7 km 260, Junín, Bs As",
        "lat": -34.609356,
        "lng": -60.959747,
        "limit": 60,
        "desc": "Fotomulta fija travesía Junín homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            134,
            314
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn7_vedia_312",
        "name": "RN 7 km 314 (Vedia)",
        "address": "Ruta Nacional 7 km 314, Vedia, Bs As",
        "lat": -34.504796,
        "lng": -61.559134,
        "limit": 60,
        "desc": "Fotomulta fija RN 7 Vedia homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            98,
            278
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn7_dalvear_395",
        "name": "RN 7 km 368 (Diego de Alvear)",
        "address": "Ruta Nacional 7 km 368, Diego de Alvear, Santa Fe",
        "lat": -34.397033,
        "lng": -62.13454,
        "limit": 60,
        "desc": "Control acceso RN 7 Santa Fe",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn7_rufino_425",
        "name": "RN 7 km 425 (Rufino)",
        "address": "Ruta Nacional 7 km 425, Rufino, Santa Fe",
        "lat": -34.280085,
        "lng": -62.716729,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Rufino homologada APSV",
        "type": "speed_camera",
        "validHeadings": [
            102,
            282
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn7_laboulaye_490",
        "name": "RN 7 km 490 (Laboulaye)",
        "address": "Ruta Nacional 7 km 490, Laboulaye, Córdoba",
        "lat": -34.145474,
        "lng": -63.39416,
        "limit": 60,
        "desc": "Control travesía RN 7 Córdoba",
        "type": "speed_camera",
        "validHeadings": [
            100,
            280
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn12_zarate_85",
        "name": "RN 12 km 85 (Complejo Zárate - Brazo Largo)",
        "address": "Ruta Nacional 12 km 85, Zárate, Bs As",
        "lat": -34.121406,
        "lng": -59.017986,
        "limit": 80,
        "desc": "Fotomulta fija acceso Complejo Zárate - Brazo Largo (ANSV)",
        "type": "speed_camera",
        "validHeadings": [
            77,
            257
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn12_blargo_115",
        "name": "RN 12 km 108 (Isla Talavera / Brazo Largo)",
        "address": "Autovía RN 12 km 108, Islas del Ibicuy, Entre Ríos",
        "lat": -33.952182,
        "lng": -58.953512,
        "limit": 120,
        "desc": "Fotomulta fija Autovía RN 12 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            30,
            210
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn12_ceibas_158",
        "name": "RN 12 km 152 (Ceibas Sur)",
        "address": "Autovía RN 12 km 152, Ceibas, Entre Ríos",
        "lat": -33.583222,
        "lng": -58.797908,
        "limit": 80,
        "desc": "Fotomulta fija Autovía RN 12 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            9,
            189
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn14_ceibas_0",
        "name": "RN 14 km 2 (Empalme Ceibas)",
        "address": "Autovía RN 14 km 2, Ceibas, Entre Ríos",
        "lat": -33.500137,
        "lng": -58.80069,
        "limit": 120,
        "desc": "Fotomulta fija Autovía RN 14 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            157,
            337
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn14_gualeguaychu_58",
        "name": "RN 14 km 56 (Gualeguaychú)",
        "address": "Autovía RN 14 km 56, Gualeguaychú, Entre Ríos",
        "lat": -33.053665,
        "lng": -58.624145,
        "limit": 120,
        "desc": "Fotomulta fija Autovía RN 14 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            19,
            199
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn14_curuguay_125",
        "name": "RN 14 km 126 (Concepción del Uruguay)",
        "address": "Autovía RN 14 km 126, Concepción del Uruguay, Entre Ríos",
        "lat": -32.47119,
        "lng": -58.302651,
        "limit": 100,
        "desc": "Fotomulta fija Autovía RN 14 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            21,
            201
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn14_colon_152",
        "name": "RN 14 km 152 (Acceso Colón)",
        "address": "Autovía RN 14 km 152, Colón, Entre Ríos",
        "lat": -32.228976,
        "lng": -58.234657,
        "limit": 100,
        "desc": "Fotomulta fija Autovía RN 14 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            174,
            354
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn14_concordia_250",
        "name": "RN 14 km 250 (Concordia)",
        "address": "Autovía RN 14 km 250, Concordia, Entre Ríos",
        "lat": -31.389407,
        "lng": -58.099694,
        "limit": 100,
        "desc": "Fotomulta fija Autovía RN 14 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            7,
            187
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn14_chajari_325",
        "name": "RN 14 km 325 (Chajarí)",
        "address": "Autovía RN 14 km 325, Chajarí, Entre Ríos",
        "lat": -30.754485,
        "lng": -58.018918,
        "limit": 100,
        "desc": "Fotomulta fija Autovía RN 14 homologada ANSV",
        "type": "speed_camera",
        "validHeadings": [
            11,
            191
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn168_laguardia_3",
        "name": "RN 168 km 3 (Viaducto Oroño / La Guardia)",
        "address": "Autovía RN 168 km 3, Santa Fe Capital",
        "lat": -31.639993,
        "lng": -60.658,
        "limit": 100,
        "desc": "Fotomulta fija Autovía RN 168 homologada APSV / ANSV",
        "type": "speed_camera",
        "validHeadings": [
            89,
            269
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn168_peaje_11",
        "name": "RN 168 km 18 (Cabecera Santa Fe Túnel Subfluvial)",
        "address": "Autovía RN 168 Cabecera Túnel Subfluvial, Santa Fe",
        "lat": -31.686747,
        "lng": -60.528641,
        "limit": 60,
        "desc": "Fotomulta acceso Túnel Subfluvial Uranga - Sylvestre Begnis",
        "type": "speed_camera",
        "validHeadings": [
            96,
            276
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn168_tunel_14",
        "name": "RN 168 Boca Paraná (Túnel Subfluvial)",
        "address": "Ruta Nacional 168 Cabecera Túnel Subfluvial, Paraná, Entre Ríos",
        "lat": -31.711985,
        "lng": -60.501889,
        "limit": 60,
        "desc": "Fotomulta acceso Túnel Subfluvial Paraná",
        "type": "speed_camera",
        "validHeadings": [
            171,
            351
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    },
    {
        "id": "radar_rn168_parana_18",
        "name": "RN 168 Acceso Paraná",
        "address": "Acceso Norte / RN 168 ingreso Paraná, Entre Ríos",
        "lat": -31.727728,
        "lng": -60.496737,
        "limit": 60,
        "desc": "Fotomulta acceso ciudad de Paraná",
        "type": "speed_camera",
        "validHeadings": [
            119,
            299
        ],
        "tipoHomologacion": "OFICIAL_NACIONAL_PROVINCIAL"
    }
];

    // Normalizar speedLimit / maxSpeed / limit (km/h) e indexar todos los radares por ID en diccionario O(1)
    const _radarByIdMap = {};
    STATIC_RADARS.forEach(r => {
        const normalizedLimit = Number(r.speedLimit ?? r.maxSpeed ?? r.limit ?? 60) || 60;
        r.speedLimit = normalizedLimit;
        r.maxSpeed = normalizedLimit;
        r.limit = normalizedLimit;
        _radarByIdMap[r.id] = r;
    });

    /**
     * Calcula la distancia geodésica en metros entre dos coordenadas (Fórmula de Haversine con R=6371e3 m).
     * Prohíbe comparaciones directas de grados decimales para radios de proximidad.
     */
    function getDistanceInMeters(lat1, lon1, lat2, lon2) {
        if (lat1 === null || lon1 === null || lat2 === null || lon2 === null ||
            isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
            return Infinity;
        }
        const R = 6371e3; // Radio medio terrestre = 6.371.000 metros (WGS84 estándar)
        const toRad = Math.PI / 180;
        const dLat = (lat2 - lat1) * toRad;
        const dLon = (lon2 - lon1) * toRad;
        const phi1 = lat1 * toRad;
        const phi2 = lat2 * toRad;

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(phi1) * Math.cos(phi2) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    const _getDistance = getDistanceInMeters;
    if (typeof window !== 'undefined') {
        window.getDistanceInMeters = getDistanceInMeters;
    }

    // ============ SINCRONIZACIÓN DE ALERTAS DE TRÁNSITO EN VIVO ============
    function _initLiveTrafficListener() {
        if (_firebaseAlertsListening) return;
        if (typeof firebaseDB === 'undefined') {
            setTimeout(_initLiveTrafficListener, 2000);
            return;
        }

        try {
            _firebaseAlertsListening = true;
            console.log('📡 [COPILOTO] Conectando escucha en vivo de global_traffic_alerts...');
            const ref = firebaseDB.ref('global_traffic_alerts');
            ref.on('value', (snap) => {
                const val = snap.val() || {};
                const now = Date.now();
                const alerts = [];

                for (const id in val) {
                    const a = val[id];
                    if (!a) continue;
                    const lat = parseFloat(a.lat);
                    const lng = parseFloat(a.lng);
                    const isActive = (a.status === 'active' || !a.status);
                    const notExpired = (!a.expiresAt || a.expiresAt > now);

                    if (!isNaN(lat) && !isNaN(lng) && isActive && notExpired) {
                        const alertType = a.type || 'warning';
                        const typeLabels = {
                            police:     'Control Policial',
                            checkpoint: 'Operativo de Tránsito',
                            municipal:  'Inspector Municipal',
                            radar:      'Radar Móvil',
                            helicopter: 'Helicóptero Sanitario',
                            ambulance:  'Ambulancia en la vía',
                            firetruck:  'Bomberos en la vía',
                            accident:   'Accidente de Tránsito',
                            traffic:    'Tránsito Lento',
                            warning:    'Alerta de Tránsito'
                        };
                        const label = typeLabels[alertType] || 'Alerta de Tránsito';
                        const locName = a.location ? a.location.replace(/ \(reporte.*$/i, '').trim() : label;

                        alerts.push({
                            id: a.id || id,
                            name: locName,
                            lat: lat,
                            lng: lng,
                            type: alertType,
                            limit: null,
                            desc: a.originalText || a.description || label,
                            isTrafficAlert: true,
                            audioUrl: a.audioUrl || null
                        });
                    }
                }

                _liveTrafficAlerts = alerts;
                console.log(`📡 [COPILOTO] ✅ Alertas de tránsito en vivo cargadas: ${alerts.length}`);
            }, (err) => {
                console.warn('⚠️ [COPILOTO] Error escuchando global_traffic_alerts:', err);
                _firebaseAlertsListening = false;
            });
        } catch(e) {
            console.warn('⚠️ [COPILOTO] Error conectando a Firebase:', e);
            _firebaseAlertsListening = false;
        }
    }

    if (typeof window !== 'undefined') {
        setTimeout(_initLiveTrafficListener, 1200);
    }

    /**
     * Inicializa / desbloquea el sintetizador de sonido Web Audio API.
     */
    function _getAudioContext() {
        if (!window._sharedAudioContext) {
            const AudioClass = window.AudioContext || window.webkitAudioContext;
            if (AudioClass) {
                window._sharedAudioContext = new AudioClass();
            }
        }
        _audioCtx = window._sharedAudioContext;
        if (_audioCtx && _audioCtx.state === 'suspended') {
            _audioCtx.resume().catch(() => {});
        }
        return _audioCtx;
    }

    // Desbloquear AudioContext en el primer toque del usuario
    if (typeof window !== 'undefined') {
        const unlockAudio = () => {
            _getAudioContext();
            window.removeEventListener('touchstart', unlockAudio);
            window.removeEventListener('click', unlockAudio);
        };
        window.addEventListener('touchstart', unlockAudio, { passive: true });
        window.addEventListener('click', unlockAudio, { passive: true });
    }

    /**
     * Reproduce un chime de advertencia potente usando Web Audio API.
     * @param {boolean} isUrgent - Si requiere tono de urgencia
     */
    function _playWarningChime(isUrgent = false) {
        if (!_isVoiceEnabled) return;
        try {
            const ctx = _getAudioContext();
            if (!ctx) return;

            const playTones = () => {
                try {
                    const now = ctx.currentTime;
                    const masterGain = ctx.createGain();
                    const volFactor = Math.max(0.05, Math.min(1.0, (_alertVolumePercent || 85) / 100.0));
                    masterGain.gain.setValueAtTime(volFactor * 0.75, now);
                    masterGain.connect(ctx.destination);

                    if (isUrgent) {
                        // Tono de urgencia: 3 beeps rápidos y agudos
                        [0, 0.13, 0.26].forEach((delay, idx) => {
                            const osc = ctx.createOscillator();
                            const gain = ctx.createGain();
                            osc.type = 'sawtooth';
                            osc.frequency.setValueAtTime(1080 + (idx * 60), now + delay);
                            gain.gain.setValueAtTime(0.5, now + delay);
                            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.10);
                            osc.connect(gain);
                            gain.connect(masterGain);
                            osc.start(now + delay);
                            osc.stop(now + delay + 0.11);
                        });
                    } else {
                        // Chime agradable de dos tonos: 880 Hz (La) -> 1320 Hz (Mi)
                        const osc1 = ctx.createOscillator();
                        const gain1 = ctx.createGain();
                        osc1.type = 'sine';
                        osc1.frequency.setValueAtTime(880, now);
                        gain1.gain.setValueAtTime(0.35, now);
                        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
                        osc1.connect(gain1);
                        gain1.connect(masterGain);
                        osc1.start(now);
                        osc1.stop(now + 0.2);

                        const osc2 = ctx.createOscillator();
                        const gain2 = ctx.createGain();
                        osc2.type = 'sine';
                        osc2.frequency.setValueAtTime(1320, now + 0.14);
                        gain2.gain.setValueAtTime(0.45, now + 0.14);
                        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
                        osc2.connect(gain2);
                        gain2.connect(masterGain);
                        osc2.start(now + 0.14);
                        osc2.stop(now + 0.5);
                    }
                } catch (toneErr) {
                    console.warn('[COPILOTO] Error en oscilador:', toneErr);
                }
            };

            if (ctx.state === 'suspended') {
                ctx.resume().then(playTones).catch(playTones);
            } else {
                playTones();
            }
        } catch (e) {
            console.warn('[COPILOTO] Error sintetizando chime Web Audio:', e);
        }
    }

    /**
     * Pitidos de proximidad cada 30 metros con volumen y tono ascendente.
     * Alerta obligatoria y prioritaria (sin opción de silencio total para fotomultas).
     * @param {number} distanceMeters - Distancia aproximada (120, 90, 60 o 30)
     */
    function _playProximityBeep(distanceMeters) {
        try {
            const ctx = _getAudioContext();
            if (!ctx) return;

            const playTone = () => {
                try {
                    const now = ctx.currentTime;
                    // Volumen predeterminado del sistema operativo (máxima claridad)
                    const baseVol = 1.0;

                    let freq = 820;
                    let beeps = 1;
                    let volScale = 0.55;

                    if (distanceMeters <= 35) {
                        freq = 1350; // Agudo intenso llegando a la cámara
                        beeps = 3;
                        volScale = 1.0;
                    } else if (distanceMeters <= 65) {
                        freq = 1150;
                        beeps = 2;
                        volScale = 0.85;
                    } else if (distanceMeters <= 95) {
                        freq = 960;
                        beeps = 2;
                        volScale = 0.70;
                    } else { // 120m
                        freq = 820;
                        beeps = 1;
                        volScale = 0.55;
                    }

                    const masterGain = ctx.createGain();
                    masterGain.gain.setValueAtTime(baseVol * volScale * 0.75, now);
                    masterGain.connect(ctx.destination);

                    for (let i = 0; i < beeps; i++) {
                        const delay = i * 0.10;
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.setValueAtTime(freq, now + delay);
                        gain.gain.setValueAtTime(0.45, now + delay);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.075);
                        osc.connect(gain);
                        gain.connect(masterGain);
                        osc.start(now + delay);
                        osc.stop(now + delay + 0.08);
                    }
                } catch (_) {}
            };

            if (ctx.state === 'suspended') {
                ctx.resume().then(playTone).catch(() => {});
            } else {
                playTone();
            }
        } catch (_) {}
    }

    /**
     * Reproduce 2 bips cortos y suaves de confirmación de "velocidad segura" (<= speedLimit).
     */
    function _playSafeSpeedBeeps() {
        try {
            const ctx = _getAudioContext();
            if (!ctx) return;

            const playSoftBeeps = () => {
                try {
                    const now = ctx.currentTime;
                    const volFactor = Math.max(0.08, Math.min(1.0, (_alertVolumePercent || 85) / 100.0));
                    const masterGain = ctx.createGain();
                    masterGain.gain.setValueAtTime(volFactor * 0.22, now);
                    masterGain.connect(ctx.destination);

                    // Bip 1 corto y suave (G5 - 784 Hz, 60ms)
                    const osc1 = ctx.createOscillator();
                    const gain1 = ctx.createGain();
                    osc1.type = 'sine';
                    osc1.frequency.setValueAtTime(784, now);
                    gain1.gain.setValueAtTime(0.35, now);
                    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
                    osc1.connect(gain1);
                    gain1.connect(masterGain);
                    osc1.start(now);
                    osc1.stop(now + 0.07);

                    // Bip 2 corto y suave (C6 - 1046.5 Hz, 70ms)
                    const osc2 = ctx.createOscillator();
                    const gain2 = ctx.createGain();
                    osc2.type = 'sine';
                    osc2.frequency.setValueAtTime(1046.5, now + 0.125);
                    gain2.gain.setValueAtTime(0.38, now + 0.125);
                    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.195);
                    osc2.connect(gain2);
                    gain2.connect(masterGain);
                    osc2.start(now + 0.125);
                    osc2.stop(now + 0.205);
                } catch (_) {}
            };

            if (ctx.state === 'suspended') {
                ctx.resume().then(playSoftBeeps).catch(() => {});
            } else {
                playSoftBeeps();
            }
        } catch (_) {}
    }

    /**
     * Pulso sonoro de advertencia activa mientras persista exceso de velocidad (> speedLimit).
     */
    function _playOverspeedBeep() {
        try {
            const ctx = _getAudioContext();
            if (!ctx) return;

            const playAlertPulse = () => {
                try {
                    const now = ctx.currentTime;
                    const volFactor = Math.max(0.15, Math.min(1.0, (_alertVolumePercent || 85) / 100.0));
                    const masterGain = ctx.createGain();
                    masterGain.gain.setValueAtTime(volFactor * 0.55, now);
                    masterGain.connect(ctx.destination);

                    [0, 0.12].forEach((delay, idx) => {
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(idx === 0 ? 988 : 1175, now + delay);
                        gain.gain.setValueAtTime(0.45, now + delay);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.09);
                        osc.connect(gain);
                        gain.connect(masterGain);
                        osc.start(now + delay);
                        osc.stop(now + delay + 0.10);
                    });
                } catch (_) {}
            };

            if (ctx.state === 'suspended') {
                ctx.resume().then(playAlertPulse).catch(() => {});
            } else {
                playAlertPulse();
            }
        } catch (_) {}
    }

    /**
     * Tono armónico agradable cuando se supera la cámara con éxito.
     * Alerta obligatoria de confirmación al volumen predeterminado del SO.
     */
    function _playPassedChime() {
        try {
            const ctx = _getAudioContext();
            if (!ctx) return;

            const playPassed = () => {
                try {
                    const now = ctx.currentTime;
                    const baseVol = 1.0;
                    const masterGain = ctx.createGain();
                    masterGain.gain.setValueAtTime(baseVol * 0.45, now);
                    masterGain.connect(ctx.destination);

                    const osc1 = ctx.createOscillator();
                    const gain1 = ctx.createGain();
                    osc1.type = 'sine';
                    osc1.frequency.setValueAtTime(1046.5, now); // C6
                    gain1.gain.setValueAtTime(0.3, now);
                    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                    osc1.connect(gain1);
                    gain1.connect(masterGain);
                    osc1.start(now);
                    osc1.stop(now + 0.16);

                    const osc2 = ctx.createOscillator();
                    const gain2 = ctx.createGain();
                    osc2.type = 'sine';
                    osc2.frequency.setValueAtTime(783.99, now + 0.11); // G5
                    gain2.gain.setValueAtTime(0.35, now + 0.11);
                    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
                    osc2.connect(gain2);
                    gain2.connect(masterGain);
                    osc2.start(now + 0.11);
                    osc2.stop(now + 0.40);
                } catch (_) {}
            };

            if (ctx.state === 'suspended') {
                ctx.resume().then(playPassed).catch(() => {});
            } else {
                playPassed();
            }
        } catch (_) {}
    }

    /**
     * Dispara vibración háptica en dispositivos móviles.
     */
    function _triggerVibration(isSpeeding) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
                if (isSpeeding) {
                    navigator.vibrate([300, 100, 300, 100, 500]);
                } else {
                    navigator.vibrate([200, 100, 200]);
                }
            } catch (_) {}
        }
    }

    /**
     * Extrae el primer nombre del chofer logueado para personalizar la voz de forma natural.
     */
    /**
     * Extrae el primer nombre del chofer logueado para personalizar la voz de forma natural.
     */
    function _getDriverFirstName() {
        try {
            if (typeof Auth !== 'undefined' && typeof Auth.getUser === 'function') {
                const u = Auth.getUser();
                const full = (u && (u.name || u.displayName)) || '';
                if (full) {
                    const first = full.trim().split(/\s+/)[0];
                    if (first && first.length > 1 && !first.toLowerCase().includes('chofer') && !first.toLowerCase().includes('usuario')) {
                        return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
                    }
                }
            }
            const saved = localStorage.getItem('fleetadmin_user');
            if (saved) {
                const u = JSON.parse(saved);
                const full = (u && (u.name || u.displayName)) || '';
                if (full) {
                    const first = full.trim().split(/\s+/)[0];
                    if (first && first.length > 1 && !first.toLowerCase().includes('chofer') && !first.toLowerCase().includes('usuario')) {
                        return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
                    }
                }
            }
            if (typeof UserOnboarding !== 'undefined' && typeof UserOnboarding.getUserFirstName === 'function') {
                const obFirst = UserOnboarding.getUserFirstName();
                if (obFirst) return obFirst;
            }
        } catch (_) {}
        return '';
    }

    /**
     * Calcula el rumbo geodésico (bearing) en grados (0° - 360°) entre dos puntos.
     */
    function _calculateBearing(lat1, lon1, lat2, lon2) {
        const toRad = Math.PI / 180;
        const phi1 = lat1 * toRad;
        const phi2 = lat2 * toRad;
        const deltaLam = (lon2 - lon1) * toRad;
        const y = Math.sin(deltaLam) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLam);
        const brng = Math.atan2(y, x) * (180 / Math.PI);
        return (brng + 360) % 360;
    }

    /**
     * Diferencia angular más corta entre dos rumbos en grados (0° a 180°).
     */
    function _getAngleDifference(b1, b2) {
        const diff = Math.abs(b1 - b2) % 360;
        return diff > 180 ? 360 - diff : diff;
    }

    // Historial circular de posiciones para calcular rumbo de trayectoria inmune al ruido GPS
    const _gpsHistory = [];

    /**
     * Obtiene el rumbo real de desplazamiento vehicular.
     * Lee la orientación real del GPS o la calcula geodésicamente de los puntos recientes.
     */
    function _getReliableTrajectoryHeading(currentLat, currentLng, rawBearing, speedKmh) {
        const now = Date.now();
        _gpsHistory.push({ lat: currentLat, lng: currentLng, time: now, speed: speedKmh });
        while (_gpsHistory.length > 8 || (_gpsHistory.length > 1 && (now - _gpsHistory[0].time) > 15000)) {
            _gpsHistory.shift();
        }

        // 1. Si el sensor o GPS nativo reporta rumbo válido y velocidad de marcha (>= 4 km/h)
        if (typeof rawBearing === 'number' && !isNaN(rawBearing) && rawBearing >= 0 && speedKmh !== null && speedKmh >= 4) {
            return rawBearing;
        }

        // 2. Vector geodésico entre el punto actual y un punto anterior con separación suficiente (8m a 350m, cubre hasta 130 km/h)
        for (let i = _gpsHistory.length - 2; i >= 0; i--) {
            const prev = _gpsHistory[i];
            const dist = _getDistance(prev.lat, prev.lng, currentLat, currentLng);
            const timeDiff = (now - prev.time) / 1000;
            if (dist >= 8 && dist <= 350 && timeDiff <= 15) {
                return _calculateBearing(prev.lat, prev.lng, currentLat, currentLng);
            }
        }

        return null;
    }

    /**
     * Algoritmo de vector de avance y corredor estricto para fotomultas:
     * a) Rumbo de avance (Heading): orientación real del vehículo
     * b) Ángulo hacia la cámara (Bearing): cono frontal < 30°
     * c) Desviación lateral (Cross-Track Distance): descarte absoluto si > 35m (calles paralelas)
     * d) Distancia frontal (Along-Track Distance): proyección en línea de marcha
     * e) Sentido de circulación: rechazo absoluto a vehículos en sentido contrario o perpendiculares
     *
     * @param {number} carLat
     * @param {number} carLng
     * @param {number|null} carHeading
     * @param {number} camLat
     * @param {number} camLng
     * @param {number} distance
     * @returns {{aligned: boolean, angleDiff: number, crossTrack: number, alongTrack: number}}
     */

    function _getCircunvalacionHeadings(lat, lng) {
        // Sector Sur-Este (Ovidio Lagos, Uriburu, Ayacucho): orientación NW-SE (~135° / 315°)
        if (lat < -32.990) {
            return [135, 315];
        }
        // Sector Sur-Oeste (Pellegrini, 27 de Febrero): orientación WSW-ENE (~65° / 245°)
        if (lat >= -32.990 && lat < -32.960 && lng < -60.700) {
            return [65, 245];
        }
        // Sector Oeste (Eva Perón / Córdoba): orientación NNW-SSE (~340° / 160°)
        if (lat >= -32.960 && lat < -32.920 && lng < -60.710) {
            return [340, 160];
        }
        // Sector Norte (Baigorria): orientación N-S (~175° / 355°)
        return [175, 355];
    }

    function _isVehicleOnRadarStreet(carHeading, radar) {
        if (!radar || carHeading === null || isNaN(carHeading)) return true;

        // A) Rumbos explícitos asignados al radar (ej: Circunvalación en Ovidio Lagos/Uriburu, Bv. Seguí)
        if (Array.isArray(radar.validHeadings) && radar.validHeadings.length > 0) {
            return radar.validHeadings.some(h => {
                let diff = Math.abs(carHeading - h) % 360;
                if (diff > 180) diff = 360 - diff;
                return diff <= 35;
            });
        }

        // B) Si el nombre o descripción menciona Circunvalación pero no tenía validHeadings explícito:
        if (radar.name.includes('Circunvalación') || (radar.desc && radar.desc.includes('Circunvalación'))) {
            const circHeadings = _getCircunvalacionHeadings(radar.lat, radar.lng);
            return circHeadings.some(h => {
                let diff = Math.abs(carHeading - h) % 360;
                if (diff > 180) diff = 360 - diff;
                return diff <= 35;
            });
        }

        return true;
    }

    function _evaluateCorridor(carLat, carLng, carHeading, camLat, camLng, distance, radar = null) {
        if (carHeading === null || isNaN(carHeading)) {
            return { aligned: false, angleDiff: 180, crossTrack: 999, alongTrack: -999 };
        }

        // 1. REGLA ESTRICTA DE CORREDOR / CALZADA DEL RADAR:
        // Si el radar está en Circunvalación o tiene calzada específica (validHeadings),
        // SOLO alertar si el vehículo circula en el rumbo de esa arteria.
        // Descarta totalmente a vehículos en calles transversales como Ovidio Lagos o Uriburu.
        if (radar && !_isVehicleOnRadarStreet(carHeading, radar)) {
            return { aligned: false, angleDiff: 180, crossTrack: 999, alongTrack: -999 };
        }

        // b) Ángulo hacia la cámara (Bearing)
        const targetBearing = _calculateBearing(carLat, carLng, camLat, camLng);
        const angleDiff = _getAngleDifference(carHeading, targetBearing);

        // b & e) Sentido de circulación y aproximación frontal:
        // La alerta inicial SOLO se activa dentro del cono frontal (< 35°).
        // Descarta mano contraria (dif > 145°) y calles transversales.
        if (angleDiff >= 35.0) {
            return { aligned: false, angleDiff, crossTrack: 999, alongTrack: -999 };
        }

        const rad = angleDiff * (Math.PI / 180);

        // c) Desviación lateral (Cross-Track Distance): perpendicular al vector de marcha.
        // Estricto (<= 38m) en proximidad urbana (<= 180m) para descartar cuadras paralelas,
        // y margen progresivo hasta 85m a 500m para tolerar curvas viales y ruido de brújula GPS (±9°).
        const crossTrack = distance * Math.abs(Math.sin(rad));
        const maxCrossTrack = (distance <= 180) ? 38.0 : Math.min(85.0, 38.0 + (distance - 180) * 0.15);
        if (crossTrack > maxCrossTrack) {
            return { aligned: false, angleDiff, crossTrack, alongTrack: -999 };
        }

        // d) Distancia frontal (Along-Track Distance): proyectada a lo largo del rumbo de marcha
        const alongTrack = distance * Math.cos(rad);

        return {
            aligned: true,
            angleDiff,
            crossTrack,
            alongTrack
        };
    }

    function _isCorridorAligned(carLat, carLng, carHeading, camLat, camLng, distance, speedLimit = 40) {
        const cr = _evaluateCorridor(carLat, carLng, carHeading, camLat, camLng, distance);
        return cr.aligned;
    }

    /**
     * Envia texto a síntesis de voz nativa / Web Speech de forma confiable.
     * @param {string} text
     * @param {boolean} [isMandatory=false] - Si es true, ignora muteo y usa volumen total del SO
     */
    let _lastDirectSpeechTime = 0;
    let _lastDirectSpeechText = '';

    function _speakTextDirect(text, isMandatory = false, enqueue = false) {
        if (!text) return;
        const now = Date.now();
        if (!enqueue && text.trim().toLowerCase() === _lastDirectSpeechText.trim().toLowerCase() && (now - _lastDirectSpeechTime < 4000)) {
            return;
        }
        _lastDirectSpeechTime = now;
        _lastDirectSpeechText = text;
        let spoken = false;
        const targetVol = isMandatory ? 1.0 : Math.max(0.1, Math.min(1.0, _alertVolumePercent / 100.0));

        // 1. Priorizar canal nativo obligatorio si existe
        if (isMandatory && window.NativeServiceBridge && typeof window.NativeServiceBridge.speakMandatory === 'function') {
            try { window.NativeServiceBridge.speakMandatory(text, !!enqueue); spoken = true; } catch (_) {}
        }
        if (!spoken && typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
            spoken = AndroidServices.speak(text, { volume: targetVol, mandatory: isMandatory, enqueue: !!enqueue });
        }
        if (!spoken && window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
            try { window.NativeServiceBridge.speak(text); spoken = true; } catch (_) {}
        }
        if (!spoken && typeof AndroidServices !== 'undefined' && typeof AndroidServices.speakWithAntiCutoff === 'function') {
            spoken = AndroidServices.speakWithAntiCutoff(text, { volume: targetVol, mandatory: isMandatory, enqueue: !!enqueue });
        }
        if (!spoken && typeof window !== 'undefined' && window.speechSynthesis) {
            try {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                if (!enqueue) {
                    window.speechSynthesis.cancel();
                }
                const utter = new SpeechSynthesisUtterance(text);
                utter.lang = 'es-AR';
                utter.rate = 1.05;
                utter.pitch = 1.0;
                // Para avisos obligatorios de fotomulta: volumen predeterminado completo del SO (1.0)
                utter.volume = targetVol;

                const voices = (typeof window.speechSynthesis.getVoices === 'function') ? window.speechSynthesis.getVoices() : [];
                if (voices && voices.length > 0) {
                    const esVoice = voices.find(v => v.lang && (v.lang.includes('es-AR') || v.lang.includes('es_AR'))) ||
                                    voices.find(v => v.lang && v.lang.startsWith('es'));
                    if (esVoice) utter.voice = esVoice;
                }

                window.speechSynthesis.speak(utter);
            } catch (e) {
                console.warn('[COPILOTO] Error en SpeechSynthesis:', e);
            }
        }
    }

    /**
     * Locución concisa y personalizada para fotomultas (a 300m y a 150m).
     * Obligatoria y prioritaria al volumen del SO (sin opción de silencio total).
     */

    function _formatRadarSpeechName(name) {
        if (!name) return 'cruce con cámara';
        return name
            .replace(/\bBv\.\s*/gi, 'Bulevar ')
            .replace(/\bAv\.\s*/gi, 'Avenida ')
            .replace(/\bRN\s*/gi, 'Ruta ')
            .replace(/\bRP\s*/gi, 'Ruta ')
            .replace(/\bAU\s*/gi, 'Autopista ')
            .replace(/\bkm\s*/gi, 'kilómetro ')
            .replace(/\s*-\s*(Sur-Norte|Norte-Sur|Este-Oeste|Oeste-Este)/gi, '')
            .replace(/\s*\([^)]*\)/g, '')
            .trim();
    }

    let _lastAlertAudioTarget = null;
    let _lastAlertAudioDistance = 300;
    let _lastAlertAudioSpeed = 0;
    let _userDismissedTargetId = null;
    let _userDismissedAt = 0;

    function _getRadarSpeechText(target, distanceStage) {
        const firstName = _getDriverFirstName();
        const prefix = firstName ? `${firstName}, ` : '';
        const limit = target.speedLimit ?? target.maxSpeed ?? target.limit ?? 60;
        const rawDist = Number(distanceStage) || 300;
        const distRound = Math.max(20, Math.round(rawDist / 10) * 10);
        const locationName = _formatRadarSpeechName(target.name);
        return `${prefix}foto multa en ${locationName} a ${distRound} metros, máxima ${limit}.`;
    }

    function _getTrafficSpeechText(target, dist) {
        const distRound = Math.round(dist / 10) * 10;
        const nameClean = (target.name || '').replace(/\s+y\s+/gi, ' esquina ');
        const firstName = _getDriverFirstName();
        const prefix = firstName ? `${firstName}, ` : '';
        if (target.isTrafficAlert) {
            const distPhrase = (distRound <= 30) ? 'en el lugar.' : `a ${distRound} metros.`;
            let text = `${prefix}atención, ${nameClean} ${distPhrase}`;
            if (target.desc && target.desc !== target.name && target.desc.length < 80) {
                text += ` ${target.desc}`;
            }
            return text;
        } else {
            const limit = target.speedLimit ?? target.maxSpeed ?? target.limit ?? 60;
            return `${prefix}foto multa a ${distRound} metros, máxima ${limit}.`;
        }
    }

    function repeatAlertAudio() {
        if (!_lastAlertAudioTarget) return;
        console.log('🔊 [COPILOTO] Repitiendo audio de alerta para:', _lastAlertAudioTarget.name);
        const isTraffic = !!_lastAlertAudioTarget.isTrafficAlert;
        if (isTraffic) {
            _playWarningChime(false);
            const text = _getTrafficSpeechText(_lastAlertAudioTarget, _lastAlertAudioDistance);
            _speakTextDirect(text, true);
        } else {
            _speakRadarConcise(_lastAlertAudioTarget, _lastAlertAudioDistance || 300);
        }
        if (window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
            const msg = isTraffic
                ? _getTrafficSpeechText(_lastAlertAudioTarget, _lastAlertAudioDistance)
                : _getRadarSpeechText(_lastAlertAudioTarget, _lastAlertAudioDistance || 300);
            try { window.NativeServiceBridge.speak(msg); } catch(_) {}
        }
    }

    function _speakRadarConcise(target, distanceStage) {
        const text = _getRadarSpeechText(target, distanceStage);
        console.log(`🔊 [COPILOTO-MANDATORY] Locución concisa: "${text}"`);
        _speakTextDirect(text, true);
    }


    /**
     * Locución para alertas de tránsito en tiempo real (policía, operativos, accidentes).
     */
    function _speakWarning(target, dist, currentSpeed) {
        if (!_isVoiceEnabled) return;
        const text = _getTrafficSpeechText(target, dist);
        _speakTextDirect(text);
    }

    /**
     * Inyecta los estilos CSS del banner píldora minimalista y transparente en la parte superior
     * (no obstruye el mapa de navegación GPS / Uber / DiDi).
     */
    function _ensureHUDStyles() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('copilotHUDStyles')) return;
        const target = document.head || document.body;
        if (!target) return;
        const style = document.createElement('style');
        style.id = 'copilotHUDStyles';
        style.textContent = `
            #radarCopilotHUD {
                position: fixed;
                top: calc(env(safe-area-inset-top, 0px) + 8px);
                left: 50%;
                transform: translateX(-50%) translateY(-150%);
                width: auto;
                max-width: calc(100vw - 16px);
                background: transparent !important;
                border: none;
                box-shadow: none;
                z-index: 2147483647;
                box-sizing: border-box;
                transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
                opacity: 0;
                pointer-events: none;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            #radarCopilotHUD.hud-active {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
            }
            .copilot-hud-card {
                pointer-events: auto;
                position: relative;
                background: rgba(0, 0, 0, 0.2);
                border: 1.5px solid rgba(255, 255, 255, 0.28);
                border-radius: 999px;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                padding: 4px 8px 4px 5px;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                color: #ffffff;
                box-sizing: border-box;
                max-width: calc(100vw - 16px);
            }
            .copilot-hud-card.hud-speeding {
                background: rgba(220, 38, 38, 0.25);
                border-color: rgba(239, 68, 68, 0.9);
                animation: copilotBorderPulse 0.95s infinite alternate;
            }
            @keyframes copilotBorderPulse {
                0% { box-shadow: 0 2px 10px rgba(239, 68, 68, 0.35); }
                100% { box-shadow: 0 2px 18px rgba(239, 68, 68, 0.8), 0 0 0 3px rgba(239, 68, 68, 0.28); }
            }
            .copilot-traffic-sign {
                flex-shrink: 0;
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: #ffffff;
                border: 3.5px solid #dc2626;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
                box-sizing: border-box;
            }
            .copilot-traffic-sign .speed-num {
                font-size: 15px;
                font-weight: 900;
                line-height: 1;
                color: #0f172a;
                letter-spacing: -0.6px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            .copilot-traffic-sign.is-traffic {
                background: rgba(15, 23, 42, 0.75);
                border-width: 2.5px;
            }
            .copilot-traffic-sign.is-traffic .traffic-icon {
                font-size: 18px;
                line-height: 1;
            }
            .copilot-hud-main {
                display: flex;
                flex-direction: column;
                justify-content: center;
                min-width: 0;
                gap: 1px;
            }
            .copilot-hud-pill-row {
                display: flex;
                align-items: center;
                gap: 6px;
                white-space: nowrap;
            }
            .copilot-hud-pill-dist {
                color: #ffffff;
                font-size: 15px;
                font-weight: 900;
                line-height: 1.1;
                letter-spacing: -0.2px;
                text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 6px rgba(0, 0, 0, 0.75);
            }
            .copilot-hud-speed-gauge {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                font-size: 12px;
                font-weight: 800;
                line-height: 1.1;
                padding: 2px 7px;
                border-radius: 999px;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
            }
            .copilot-speed-over {
                background: rgba(239, 68, 68, 0.45);
                color: #fecaca;
                border: 1px solid rgba(252, 165, 165, 0.7);
                font-weight: 900;
            }
            .copilot-speed-ok {
                background: rgba(16, 185, 129, 0.25);
                color: #a7f3d0;
                border: 1px solid rgba(110, 231, 183, 0.45);
            }
            .copilot-speed-neutral {
                background: rgba(15, 23, 42, 0.25);
                color: #f1f5f9;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .copilot-hud-name {
                font-size: 10.5px;
                font-weight: 700;
                color: rgba(248, 250, 252, 0.95);
                line-height: 1.15;
                max-width: 165px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 5px rgba(0, 0, 0, 0.75);
            }
            .copilot-close-btn {
                flex-shrink: 0;
                width: 26px;
                height: 26px;
                border-radius: 50%;
                background: rgba(0, 0, 0, 0.28);
                border: 1px solid rgba(255, 255, 255, 0.32);
                color: #ffffff;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 0;
                margin-left: 2px;
                font-size: 13px;
                font-weight: 900;
                line-height: 1;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
                transition: transform 0.12s ease, background 0.15s ease;
                user-select: none;
                -webkit-user-select: none;
            }
            .copilot-close-btn:active {
                transform: scale(0.9);
                background: rgba(239, 68, 68, 0.45);
            }
        `;
        document.head.appendChild(style);
    }

    // Variables de estabilización de UI y velocímetro
    let _smoothedSpeed = null;
    let _lastSpeedSamplePos = null;
    let _lastUIThrottleTime = 0;
    let _lastDisplayedSpeed = 0;

    /**
     * Muestra o actualiza la píldora compacta y transparente en la parte superior.
     * Muestra límite de velocidad, metros restantes, velocidad actual y botón 'X' sin obstruir el mapa.
     */
    function _showRadarHUD(target, dist, currentSpeed) {
        if (typeof document === 'undefined' || !target) return;
        _ensureHUDStyles();

        const now = Date.now();
        let hud = document.getElementById('radarCopilotHUD');

        _activeHudRadarId = target.id || null;
        _currentHudTarget = target;

        const isTraffic = !!target.isTrafficAlert;
        const speedLimit = Number(target.speedLimit ?? target.maxSpeed ?? target.limit ?? 0);
        const numericSpeed = (currentSpeed !== null && !isNaN(currentSpeed) && currentSpeed > 0) ? Math.round(currentSpeed) : 0;
        const isSpeeding = (!isTraffic && speedLimit > 0 && numericSpeed > speedLimit);
        const distMeters = Math.max(0, Math.round(dist));
        const distLabel = (distMeters <= PASSING_DISTANCE_METERS)
            ? (isTraffic ? 'En zona' : `${distMeters} m`)
            : `${distMeters} m`;

        // Registrar datos para repetición de audio si se toca el signo
        _lastAlertAudioTarget = target;
        _lastAlertAudioDistance = distMeters;
        _lastAlertAudioSpeed = numericSpeed;

        // Actualizar velocidad mostrada con respuesta inmediata ante exceso
        if (isSpeeding || (now - _lastUIThrottleTime >= 500) || _lastDisplayedSpeed === 0) {
            _lastUIThrottleTime = now;
            _lastDisplayedSpeed = numericSpeed;
        }

        let speedBadgeHtml = '';
        if (!isTraffic && speedLimit > 0) {
            if (_lastDisplayedSpeed > speedLimit) {
                speedBadgeHtml = `<span class="copilot-hud-speed-gauge copilot-speed-over" id="copilotHudSpeedGauge">⚠️ ${_lastDisplayedSpeed} km/h</span>`;
            } else if (_lastDisplayedSpeed > 0) {
                speedBadgeHtml = `<span class="copilot-hud-speed-gauge copilot-speed-ok" id="copilotHudSpeedGauge">${_lastDisplayedSpeed} km/h</span>`;
            } else {
                speedBadgeHtml = `<span class="copilot-hud-speed-gauge copilot-speed-neutral" id="copilotHudSpeedGauge">Máx ${speedLimit}</span>`;
            }
        } else {
            speedBadgeHtml = `<span class="copilot-hud-speed-gauge copilot-speed-neutral" id="copilotHudSpeedGauge">${_lastDisplayedSpeed > 0 ? `${_lastDisplayedSpeed} km/h` : 'Precaución'}</span>`;
        }

        let signHtml = '';
        let cardBorderColor = 'rgba(255, 255, 255, 0.28)';

        if (isTraffic) {
            const alertIcons = {
                police:     { icon: '🚔', color: '#3b82f6' },
                checkpoint: { icon: '🚧', color: '#2563eb' },
                municipal:  { icon: '🦊', color: '#10b981' },
                radar:      { icon: '📷', color: '#f59e0b' },
                helicopter: { icon: '🚁', color: '#10b981' },
                ambulance:  { icon: '🚑', color: '#ef4444' },
                firetruck:  { icon: '🚒', color: '#b91c1c' },
                accident:   { icon: '💥', color: '#ef4444' },
                traffic:    { icon: '🚗', color: '#f97316' },
                warning:    { icon: '⚠️', color: '#f59e0b' }
            };
            const meta = alertIcons[target.type] || alertIcons.warning;
            cardBorderColor = 'rgba(255, 255, 255, 0.32)';
            signHtml = `
                <div class="copilot-traffic-sign is-traffic" style="border-color:${meta.color};">
                    <span class="traffic-icon">${meta.icon}</span>
                </div>
            `;
        } else {
            const isCuestionado = target.tipoHomologacion === 'COMUNAL_CUESTIONADO';
            cardBorderColor = isSpeeding
                ? 'rgba(239, 68, 68, 0.92)'
                : (isCuestionado ? 'rgba(245, 158, 11, 0.55)' : 'rgba(255, 255, 255, 0.28)');
            const signBorderStyle = isCuestionado ? ' style="border-color:#d97706;"' : '';
            signHtml = `
                <div class="copilot-traffic-sign"${signBorderStyle} title="Tocar para repetir aviso">
                    <span class="speed-num">${speedLimit || 60}</span>
                </div>
            `;
        }

        const cardClass = isSpeeding ? 'copilot-hud-card hud-speeding' : 'copilot-hud-card';

        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'radarCopilotHUD';
            hud.setAttribute('role', 'alert');
            hud.setAttribute('aria-live', 'polite');
            hud.innerHTML = `
                <div class="${cardClass}" id="copilotHudCard" style="border-color:${cardBorderColor};">
                    <div id="copilotHudSignWrap" style="cursor:pointer;">${signHtml}</div>
                    <div class="copilot-hud-main">
                        <div class="copilot-hud-pill-row">
                            <span class="copilot-hud-pill-dist" id="copilotHudDist">${distLabel}</span>
                            <span id="copilotHudBottomRow">${speedBadgeHtml}</span>
                        </div>
                        <div class="copilot-hud-name" id="copilotHudName" title="${target.name || ''}">${target.name || ''}</div>
                    </div>
                    <button class="copilot-close-btn" id="copilotCloseBtn" type="button" aria-label="Cerrar alerta" title="Cerrar aviso">✕</button>
                </div>
            `;
            document.body.appendChild(hud);

            const signTap = document.getElementById('copilotHudSignWrap');
            if (signTap) {
                signTap.onclick = (e) => {
                    e.stopPropagation();
                    repeatAlertAudio();
                };
            }

            const closeBtn = document.getElementById('copilotCloseBtn');
            if (closeBtn) {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    _stopAllAudio();
                    const activeTarget = _currentHudTarget || target;
                    const nowDismiss = Date.now();
                    if (activeTarget && activeTarget.id) {
                        _userDismissedTargetId = activeTarget.id;
                        _userDismissedAt = nowDismiss;
                        if (activeTarget.isTrafficAlert) {
                            if (!_trafficTrackingState[activeTarget.id]) {
                                _trafficTrackingState[activeTarget.id] = { distanciaAnterior: distMeters };
                            }
                            _trafficTrackingState[activeTarget.id].dismissedByUser = true;
                        } else if (radarTrackingState[activeTarget.id]) {
                            radarTrackingState[activeTarget.id].dismissedByUser = true;
                            radarTrackingState[activeTarget.id].dismissedAt = nowDismiss;
                            _syncStateToNative(activeTarget.id, radarTrackingState[activeTarget.id], false);
                        }
                    }
                    _hideRadarHUD(true);
                    if (window.NativeServiceBridge && typeof window.NativeServiceBridge.hideOverlayAlert === 'function') {
                        try { window.NativeServiceBridge.hideOverlayAlert(); } catch(_) {}
                    }
                };
            }
        } else {
            const distEl = document.getElementById('copilotHudDist');
            if (distEl) distEl.textContent = distLabel;

            const nameEl = document.getElementById('copilotHudName');
            if (nameEl && nameEl.textContent !== (target.name || '')) {
                nameEl.textContent = target.name || '';
                nameEl.title = target.name || '';
            }

            const signWrap = document.getElementById('copilotHudSignWrap');
            if (signWrap) signWrap.innerHTML = signHtml;

            const card = document.getElementById('copilotHudCard');
            if (card) {
                card.className = cardClass;
                card.style.borderColor = cardBorderColor;
            }

            const bottomRow = document.getElementById('copilotHudBottomRow');
            if (bottomRow) {
                bottomRow.innerHTML = speedBadgeHtml;
            }
        }

        const raf = (typeof window !== 'undefined' && window.requestAnimationFrame) ? window.requestAnimationFrame : setTimeout;
        raf(() => {
            if (hud && hud.classList) hud.classList.add('hud-active');
        }, 16);

        // Despachar a cartel flotante nativo de Android únicamente si la app está en segundo plano (document.hidden)
        if (document.hidden && window.NativeServiceBridge && typeof window.NativeServiceBridge.showOverlayAlert === 'function') {
            try {
                const audioMsg = !isTraffic ? _getRadarSpeechText(target, distMeters) : _getTrafficSpeechText(target, distMeters);
                const overlayType = isTraffic
                    ? (target.type || 'traffic')
                    : (target.tipoHomologacion === 'COMUNAL_CUESTIONADO' ? 'radar_cuestionado' : 'radar');
                window.NativeServiceBridge.showOverlayAlert(
                    overlayType,
                    target.name,
                    target.desc || (isTraffic ? 'Reporte en vía' : 'Fotomulta municipal'),
                    speedLimit,
                    _lastDisplayedSpeed,
                    distMeters,
                    audioMsg
                );
            } catch (_) {}
        }

        if (_hudTimer) {
            clearTimeout(_hudTimer);
            _hudTimer = null;
        }
    }

    /**
     * Oculta el banner HUD (inmediatamente al cruzar cámara o cerrar con 'X', o con transición suave).
     */
    function _hideRadarHUD(immediate = false) {
        _activeHudRadarId = null;
        _currentHudTarget = null;
        const hud = document.getElementById('radarCopilotHUD');
        if (hud) {
            hud.classList.remove('hud-active');
            if (immediate) {
                hud.remove();
            } else {
                setTimeout(() => {
                    if (hud && !hud.classList.contains('hud-active')) {
                        hud.remove();
                    }
                }, 260);
            }
        }
        if (_hudTimer) {
            clearTimeout(_hudTimer);
            _hudTimer = null;
        }
    }

    /**
     * Sincroniza el estado del radar hacia el servicio nativo de Android si está presente.
     */
    function _syncStateToNative(radarId, state, remove = false) {
        if (!window.NativeServiceBridge) return;
        const fired = state ? !!(state.initialAlertFired || state.initialAlertDone) : false;
        const lastOver = state ? (state.lastOverspeedAlertTime || 0) : 0;
        const dismissed = state ? !!state.dismissedByUser : false;
        const safeBeeps = state ? !!state.safeSpeedBeepsPlayed : false;
        const prevDist = (state && typeof state.distanciaAnterior === 'number' && isFinite(state.distanciaAnterior))
            ? state.distanciaAnterior
            : 9999;

        if (typeof window.NativeServiceBridge.syncRadarTrackingStateFull === 'function') {
            try {
                window.NativeServiceBridge.syncRadarTrackingStateFull(
                    radarId,
                    fired,
                    lastOver,
                    dismissed,
                    safeBeeps,
                    prevDist,
                    !!remove
                );
                return;
            } catch (_) {}
        }
        if (typeof window.NativeServiceBridge.syncRadarTrackingState === 'function') {
            try {
                window.NativeServiceBridge.syncRadarTrackingState(
                    radarId,
                    fired,
                    lastOver,
                    dismissed,
                    !!remove
                );
            } catch (_) {}
        }
    }

    /**
     * Recibe sincronización de estado desde el servicio en segundo plano de Android al volver a primer plano.
     */
    function syncStateFromNative(nativeMap) {
        if (!nativeMap || typeof nativeMap !== 'object') return;
        Object.keys(nativeMap).forEach(rId => {
            const ns = nativeMap[rId];
            if (!ns) return;
            const existing = radarTrackingState[rId] || {};
            radarTrackingState[rId] = Object.assign(existing, {
                initialAlertFired: !!ns.initialAlertFired,
                initialAlertDone: !!ns.initialAlertFired,
                lastOverspeedAlertTime: ns.lastOverspeedAlertTime || existing.lastOverspeedAlertTime || 0,
                dismissedByUser: !!(ns.dismissedByUser || existing.dismissedByUser),
                safeSpeedBeepsPlayed: !!(ns.safeSpeedBeepsPlayed || existing.safeSpeedBeepsPlayed),
                distanciaAnterior: (typeof ns.distanciaAnterior === 'number' && ns.distanciaAnterior > 0)
                    ? Math.min(existing.distanciaAnterior || Infinity, ns.distanciaAnterior)
                    : (existing.distanciaAnterior || 300),
                initialAlertTime: existing.initialAlertTime || (Date.now() - 4000)
            });
        });
    }

    /**
     * Estabilización y cálculo de velocidad del vehículo:
     * a) Si speedUnit === 'ms', convierte obligatoriamente: Math.round((rawSpeed || 0) * 3.6).
     * b) Si speedUnit === 'kmh', usa Math.round(rawSpeed).
     * c) Umbral de reposo: Si < 3.0 km/h, fijar en 0 km/h para descartar oscilaciones de reposo.
     * d) Fallback Haversine solo si rawSpeed no es provisto por el sensor.
     * e) Sin retardo EMA para garantizar detección instantánea de exceso de velocidad.
     */
    function _calculateSpeed(lat, lng, rawSpeed = null, accuracy = null, speedUnit = 'kmh') {
        let speedKmh = null;

        // a) Priorizar valor provisto por sensor GPS
        if (typeof rawSpeed === 'number' && !isNaN(rawSpeed) && rawSpeed >= 0) {
            let converted = 0;
            if (speedUnit === 'ms') {
                converted = Math.round(rawSpeed * 3.6);
            } else {
                converted = Math.round(rawSpeed);
            }

            if (converted < 3.0) {
                _smoothedSpeed = 0;
                speedKmh = 0;
            } else if (converted <= 220) {
                _smoothedSpeed = converted;
                speedKmh = converted;
            }
        } else {
            // b) Fallback Haversine con delta de 1.0s a 15s y descarte si accuracy > 20m
            const now = Date.now();
            const isAccuracyValid = (accuracy === null || isNaN(accuracy) || accuracy <= 20);

            if (_lastSpeedSamplePos && _lastSpeedSamplePos.time && isAccuracyValid) {
                const timeDeltaSec = (now - _lastSpeedSamplePos.time) / 1000;
                if (timeDeltaSec >= 1.0 && timeDeltaSec <= 15) {
                    const distMeters = _getDistance(_lastSpeedSamplePos.lat, _lastSpeedSamplePos.lng, lat, lng);
                    if (distMeters < 3.0) {
                        _smoothedSpeed = 0;
                        speedKmh = 0;
                    } else {
                        const calcKmh = Math.round((distMeters / timeDeltaSec) * 3.6);
                        if (calcKmh <= 220) {
                            _smoothedSpeed = calcKmh;
                            speedKmh = calcKmh;
                        }
                    }
                }
            }
        }

        const now = Date.now();
        if (!_lastSpeedSamplePos || (now - _lastSpeedSamplePos.time >= 1500)) {
            _lastSpeedSamplePos = { lat, lng, time: now };
        }

        if (_smoothedSpeed !== null && _smoothedSpeed < 3.0) {
            _smoothedSpeed = 0;
        }

        return _smoothedSpeed;
    }

    /**
     * Chequea la posición actual respecto a radares fijos y alertas de tránsito en tiempo real.
     * Implementa paridad estricta Web / Android:
     * 1) Detección inicial (300m urbano / 500m autopista) con aviso sonoro/visual único (`initialAlertFired = true`).
     * 2) Evaluación dinámica post-aviso en cada ciclo GPS:
     *    - `speedKmh <= camera.speedLimit`: silencia alarma continua, emite 2 bips cortos/suaves de confirmación
     *      una única vez, y respeta cierre manual con 'X' (`dismissedByUser`).
     *    - `speedKmh > camera.speedLimit`: mantiene activa la advertencia visual y sonora hasta desacelerar.
     * 3) Auto-cierre inmediato al cruzar la cámara (`distanciaActual > distanciaAnterior + 10`).
     */
    function checkProximity(currentLat, currentLng, rawSpeed = null, rawBearing = null, accuracy = null, speedUnit = 'kmh', customRadars = null) {
        if (!_isEnabled) return;
        if (!currentLat || !currentLng || isNaN(currentLat) || isNaN(currentLng)) return;

        // FILTRO DE PRECISIÓN GPS: descartar fijaciones con error excesivo (> 50m)
        if (accuracy !== null && !isNaN(accuracy) && accuracy > 50) {
            console.warn(`📡 [COPILOTO] Lectura descartada por imprecisión GPS (${Math.round(accuracy)}m > 50m)`);
            return;
        }

        const now = Date.now();
        const calculatedSpeed = _calculateSpeed(currentLat, currentLng, rawSpeed, accuracy, speedUnit);
        const speedKmh = (calculatedSpeed !== null && calculatedSpeed >= 0) ? calculatedSpeed : 0;

        // Determinar rumbo (bearing) confiable de trayectoria vehicular
        const reliableBearing = _getReliableTrajectoryHeading(currentLat, currentLng, rawBearing, calculatedSpeed);

        // Guardar última posición confirmada con timestamp y accuracy
        _lastPosition = { lat: currentLat, lng: currentLng, time: now, speed: speedKmh, bearing: reliableBearing, accuracy: accuracy };
        if (typeof window !== 'undefined') {
            window._cachedGpsPosition = _lastPosition;
        }

        const radarsSource = (Array.isArray(customRadars) && customRadars.length > 0) ? customRadars : STATIC_RADARS;

        // Limpiar cooldowns post-cruce expirados o fuera de radio
        for (const cId of Object.keys(_passedCooldownMap)) {
            const cd = _passedCooldownMap[cId];
            const cam = _radarByIdMap[cId] || radarsSource.find(r => r && r.id === cId);
            if (!cd || !cam) {
                delete _passedCooldownMap[cId];
                continue;
            }
            const distCd = getDistanceInMeters(currentLat, currentLng, cam.lat, cam.lng);
            const maxRadius = (cd.entryRadius || WARNING_DISTANCE_METERS) + 40;
            if (distCd > maxRadius || (now - cd.timestamp > 120000) || distCd < (cd.closedDistance - 25)) {
                delete _passedCooldownMap[cId];
            }
        }

        // =========================================================================
        // 1. EVALUAR RADARES ACTIVOS EN SEGUIMIENTO (`initialAlertFired = true`)
        // =========================================================================
        const trackedIds = Object.keys(radarTrackingState);
        let activeTrackedRadarInZone = null;
        let minTrackedDist = Infinity;

        for (const rId of trackedIds) {
            const state = radarTrackingState[rId];
            if (!state || (!state.initialAlertFired && !state.initialAlertDone)) {
                delete radarTrackingState[rId];
                continue;
            }

            const camera = _radarByIdMap[rId] || radarsSource.find(r => r && r.id === rId);
            if (!camera) {
                delete radarTrackingState[rId];
                _syncStateToNative(rId, null, true);
                continue;
            }

            const distanciaActual = getDistanceInMeters(currentLat, currentLng, camera.lat, camera.lng);
            const speedLimit = Number(camera.speedLimit ?? camera.maxSpeed ?? camera.limit ?? 60);

            if (typeof state.distanciaAnterior !== 'number' || !isFinite(state.distanciaAnterior)) {
                state.distanciaAnterior = distanciaActual;
            }

            // 📍 REGLA 3: AUTO-CIERRE INMEDIATO AL CRUZAR LA CÁMARA (distanciaActual > distanciaAnterior + 10)
            if (distanciaActual > state.distanciaAnterior + CROSSING_DELTA_METERS) {
                console.log(`📍 [COPILOTO] Auto-cierre al cruzar cámara ${camera.name}: ${Math.round(distanciaActual)}m > ${Math.round(state.distanciaAnterior)}m + 10m`);

                if ((state.maxSpeedRecorded || 0) > speedLimit && state.distanciaAnterior <= 45) {
                    console.warn(`🚨 [COPILOTO] Infracción registrada en ${camera.name}: ${state.maxSpeedRecorded} km/h (máx ${speedLimit})`);
                    _reportSpeedInfractionToServer(camera, state.maxSpeedRecorded);
                }

                _passedCooldownMap[rId] = {
                    closedDistance: distanciaActual,
                    timestamp: now,
                    entryRadius: state.entryRadius || WARNING_DISTANCE_METERS
                };

                delete radarTrackingState[rId];
                _syncStateToNative(rId, null, true);
                _stopAllAudio();
                if (_activeHudRadarId === rId || !_activeHudRadarId) {
                    _hideRadarHUD(true);
                }
                if (window.NativeServiceBridge && typeof window.NativeServiceBridge.hideOverlayAlert === 'function') {
                    try { window.NativeServiceBridge.hideOverlayAlert(); } catch (_) {}
                }
                continue;
            }

            // Limpieza por margen máximo de seguridad (> 580m)
            if (distanciaActual > EXIT_HYSTERESIS_METERS) {
                delete radarTrackingState[rId];
                _syncStateToNative(rId, null, true);
                if (_activeHudRadarId === rId) {
                    _hideRadarHUD(true);
                }
                continue;
            }

            // Actualizar distancia mínima alcanzada para comparar alejamiento neto (> +10m)
            if (distanciaActual < state.distanciaAnterior) {
                state.distanciaAnterior = distanciaActual;
            }
            state.maxSpeedRecorded = Math.max(state.maxSpeedRecorded || 0, speedKmh);

            const entryRadius = state.entryRadius || ((speedLimit >= 80) ? HIGHWAY_WARNING_METERS : WARNING_DISTANCE_METERS);
            if (distanciaActual <= entryRadius + 25 && distanciaActual < minTrackedDist) {
                minTrackedDist = distanciaActual;
                activeTrackedRadarInZone = { camera, state, distanciaActual, speedLimit };
            }
        }

        // 🧠 REGLA 2: EVALUACIÓN DINÁMICA DE VELOCIDAD EN CICLOS POST-AVISO
        if (activeTrackedRadarInZone) {
            const { camera, state, distanciaActual, speedLimit } = activeTrackedRadarInZone;

            if (speedKmh <= speedLimit) {
                // a) Silenciar inmediatamente cualquier alarma continua de exceso de velocidad
                if (state.isOverspeedActive) {
                    state.isOverspeedActive = false;
                    _stopAllAudio();
                }

                // b) Permitir únicamente 2 bips cortos/suaves de confirmación de "velocidad segura"
                const initialVoiceFinished = (now - (state.initialAlertTime || 0)) >= 3200;
                if (!state.safeSpeedBeepsPlayed && (state.wasOverspeeding || (initialVoiceFinished && speedKmh >= 5))) {
                    state.safeSpeedBeepsPlayed = true;
                    _playSafeSpeedBeeps();
                    _syncStateToNative(camera.id, state, false);
                }

                // c) Si el usuario cerró el cartel con la 'X', NO volver a mostrarlo
                if (state.dismissedByUser) {
                    if (_activeHudRadarId === camera.id) {
                        _hideRadarHUD(true);
                    }
                } else {
                    _showRadarHUD(camera, distanciaActual, speedKmh);
                }
            } else {
                // speedKmh > camera.speedLimit: mantener advertencia de exceso activa hasta desacelerar
                state.isOverspeedActive = true;
                state.wasOverspeeding = true;
                state.safeSpeedBeepsPlayed = false;

                const recentlyDismissed = state.dismissedByUser && (now - (state.dismissedAt || 0) < 5000);
                if (!recentlyDismissed) {
                    _showRadarHUD(camera, distanciaActual, speedKmh);
                }

                const afterInitialSpeech = (now - (state.initialAlertTime || 0)) >= 2800;
                if (afterInitialSpeech && (now - (state.lastOverspeedBeepTime || 0) >= OVERSPEED_BEEP_INTERVAL_MS)) {
                    state.lastOverspeedBeepTime = now;
                    _playOverspeedBeep();
                }

                if (now - (state.lastOverspeedAlertTime || 0) >= OVERSPEED_COOLDOWN_MS) {
                    state.lastOverspeedAlertTime = now;
                    _syncStateToNative(camera.id, state, false);
                    const enqueueWarning = !afterInitialSpeech;
                    console.warn(`🚨 [COPILOTO-EXCESO] ${speedKmh} km/h > máx ${speedLimit} km/h: ${OVERSPEED_ALERT_TEXT}`);
                    _speakTextDirect(OVERSPEED_ALERT_TEXT, true, enqueueWarning);
                    _triggerVibration(true);
                }
            }

            return;
        }

        // =========================================================================
        // 2. BUSCAR NUEVA DETECCIÓN DE CÁMARA DENTRO DEL RADIO (300m / 500m)
        // =========================================================================
        let bestRadar = null;
        let bestRadarDist = Infinity;
        let bestRadarRadio = WARNING_DISTANCE_METERS;

        for (const radar of radarsSource) {
            if (!radar || !radar.id) continue;
            if (radarTrackingState[radar.id] || _passedCooldownMap[radar.id]) continue;

            const dist = getDistanceInMeters(currentLat, currentLng, radar.lat, radar.lng);
            const speedLimit = Number(radar.speedLimit ?? radar.maxSpeed ?? radar.limit ?? 60);
            const radioAlerta = (speedLimit >= 80 || speedKmh > 75) ? HIGHWAY_WARNING_METERS : WARNING_DISTANCE_METERS;

            if (dist <= radioAlerta) {
                let isValidApproach = false;
                if (reliableBearing !== null) {
                    const cr = _evaluateCorridor(currentLat, currentLng, reliableBearing, radar.lat, radar.lng, dist, radar);
                    isValidApproach = cr.aligned && cr.alongTrack >= 12 && cr.alongTrack <= radioAlerta;
                } else if (speedKmh >= 4 || customRadars !== null) {
                    isValidApproach = true;
                }

                if (isValidApproach && dist < bestRadarDist) {
                    bestRadarDist = dist;
                    bestRadar = radar;
                    bestRadarRadio = radioAlerta;
                }
            }
        }

        if (bestRadar) {
            const bestSpeedLimit = Number(bestRadar.speedLimit ?? bestRadar.maxSpeed ?? bestRadar.limit ?? 60);
            const isInitiallyOverspeed = speedKmh > bestSpeedLimit;

            // Registrar `initialAlertFired = true` para emitir el aviso inicial una única vez
            radarTrackingState[bestRadar.id] = {
                initialAlertFired: true,
                initialAlertDone: true,
                initialAlertTime: now,
                distanciaAnterior: bestRadarDist,
                dismissedByUser: false,
                dismissedAt: 0,
                safeSpeedBeepsPlayed: false,
                isOverspeedActive: isInitiallyOverspeed,
                wasOverspeeding: isInitiallyOverspeed,
                lastOverspeedAlertTime: isInitiallyOverspeed ? now : 0,
                lastOverspeedBeepTime: isInitiallyOverspeed ? now : 0,
                maxSpeedRecorded: speedKmh,
                entryRadius: bestRadarRadio
            };

            _syncStateToNative(bestRadar.id, radarTrackingState[bestRadar.id], false);
            _showRadarHUD(bestRadar, bestRadarDist, speedKmh);
            _triggerVibration(isInitiallyOverspeed);

            console.log(`🔊 [COPILOTO-PROXIMITY] Primer aviso único radar ${bestRadar.name} a ${Math.round(bestRadarDist)}m (límite ${bestSpeedLimit} km/h)`);
            _speakRadarConcise(bestRadar, bestRadarDist);

            if (isInitiallyOverspeed) {
                if (_pendingOverspeedTimer) clearTimeout(_pendingOverspeedTimer);
                const targetId = bestRadar.id;
                _pendingOverspeedTimer = setTimeout(() => {
                    _pendingOverspeedTimer = null;
                    const st = radarTrackingState[targetId];
                    if (st && st.isOverspeedActive) {
                        _speakTextDirect(OVERSPEED_ALERT_TEXT, true, true);
                        _triggerVibration(true);
                    }
                }, 1800);
            }
            return;
        }

        // =========================================================================
        // 3. ALERTAS DE TRÁNSITO DINÁMICAS EN TIEMPO REAL (Policía, operativos)
        // =========================================================================
        let nearestTraffic = null;
        let minTrafficDist = Infinity;
        const defaultTrafficRadio = (speedKmh > 60) ? 500 : 300;

        for (const tr of _liveTrafficAlerts) {
            const dist = getDistanceInMeters(currentLat, currentLng, tr.lat, tr.lng);
            if (dist < minTrafficDist) {
                minTrafficDist = dist;
                nearestTraffic = tr;
            }
        }

        if (nearestTraffic) {
            if (minTrafficDist > 1000 && _warnedTrafficApproaches.has(nearestTraffic.id)) {
                _warnedTrafficApproaches.delete(nearestTraffic.id);
                delete _trafficTrackingState[nearestTraffic.id];
            }

            if (minTrafficDist <= defaultTrafficRadio) {
                let trState = _trafficTrackingState[nearestTraffic.id];
                if (!trState) {
                    trState = { distanciaAnterior: minTrafficDist, dismissedByUser: false };
                    _trafficTrackingState[nearestTraffic.id] = trState;
                }

                // Auto-cierre al cruzar alerta dinámica (> distanciaAnterior + 10m)
                if (minTrafficDist > trState.distanciaAnterior + CROSSING_DELTA_METERS) {
                    delete _trafficTrackingState[nearestTraffic.id];
                    if (_activeHudRadarId === nearestTraffic.id) {
                        _hideRadarHUD(true);
                    }
                    return;
                }
                if (minTrafficDist < trState.distanciaAnterior) {
                    trState.distanciaAnterior = minTrafficDist;
                }

                const isStationaryAtAlert = (speedKmh < 7 && minTrafficDist < 70);
                const driverFirst = _getDriverFirstName();
                const isOwnAlert = nearestTraffic.authorName && driverFirst &&
                    nearestTraffic.authorName.trim().toLowerCase() === driverFirst.trim().toLowerCase();

                const alreadyWarned = _warnedTrafficApproaches.has(nearestTraffic.id);
                const lastAlert = _lastAlertTime[nearestTraffic.id] || 0;
                const inCooldown = (now - lastAlert < COOLDOWN_MS);

                if (!isStationaryAtAlert && !isOwnAlert && !alreadyWarned && !inCooldown) {
                    _warnedTrafficApproaches.add(nearestTraffic.id);
                    _lastAlertTime[nearestTraffic.id] = now;
                    trState.dismissedByUser = false;
                    _showRadarHUD(nearestTraffic, minTrafficDist, speedKmh);
                    _playWarningChime(false);
                    _speakWarning(nearestTraffic, minTrafficDist, speedKmh);
                    _triggerVibration(false);
                } else if (!isOwnAlert && !trState.dismissedByUser && alreadyWarned) {
                    _showRadarHUD(nearestTraffic, minTrafficDist, speedKmh);
                }
            }
        }
    }

    /**
     * Prueba inmediata de alerta (Píldora transparente compacta, locución inicial única y 2 bips suaves).
     * @param {'fotomulta'|'transito'|string} typeOrRadarId
     */
    function testAlert(typeOrRadarId = 'fotomulta') {
        if (typeof window.unlockGlobalAudio === 'function') window.unlockGlobalAudio();
        if (!_isVoiceEnabled) {
            _isVoiceEnabled = true;
            localStorage.setItem('radarVoice', 'on');
            console.log('📡 [COPILOTO] Voz activada automáticamente para el test.');
        }

        let target = null;
        let testDist = 300;
        let testSpeed = 48;

        if (typeOrRadarId === 'transito' || typeOrRadarId === 'traffic') {
            target = (_liveTrafficAlerts && _liveTrafficAlerts.length > 0) ? _liveTrafficAlerts[0] : {
                id: 'test_traffic_alert',
                name: 'Av. Pellegrini y Corrientes',
                lat: -32.9515,
                lng: -60.6550,
                type: 'police',
                limit: null,
                desc: 'Control policial e inspectores de tránsito',
                isTrafficAlert: true
            };
            testDist = 250;
            testSpeed = 35;
            _playWarningChime(false);
            _speakWarning(target, testDist, testSpeed);
            _showRadarHUD(target, testDist, testSpeed);
        } else {
            const foundRadar = STATIC_RADARS.find(r => r.id === typeOrRadarId);
            target = foundRadar || STATIC_RADARS[0];
            testDist = 300;
            const limit = target.speedLimit ?? target.maxSpeed ?? target.limit ?? 60;
            testSpeed = Math.max(20, limit - 8);

            console.log('📡 [COPILOTO] Ejecutando TEST compacto para:', target.name);

            _showRadarHUD(target, testDist, testSpeed);
            _speakRadarConcise(target, testDist);
            _triggerVibration(false);

            // Confirmación suave de velocidad segura tras locución inicial
            setTimeout(() => {
                if (_activeHudRadarId === target.id) {
                    _playSafeSpeedBeeps();
                }
            }, 3200);
        }

        if (typeof Components !== 'undefined' && Components.showToast) {
            Components.showToast(`🔔 Test: ${target.name} (${target.isTrafficAlert ? 'Tránsito' : 'Fotomulta'})`, 'info');
        }
    }

    function setEnabled(enabled) {
        _isEnabled = !!enabled;
        localStorage.setItem('copilotRadar', _isEnabled ? 'on' : 'off');
        if (!_isEnabled) {
            _hideRadarHUD();
        }
        console.log(`📡 [COPILOTO] Radar copiloto ${_isEnabled ? 'ACTIVADO' : 'DESACTIVADO'}`);
    }

    function isEnabled() {
        return _isEnabled;
    }

    function setVoiceEnabled(enabled) {
        _isVoiceEnabled = !!enabled;
        localStorage.setItem('radarVoice', _isVoiceEnabled ? 'on' : 'off');
        if (!_isVoiceEnabled) {
            _stopAllAudio();
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setVoiceMuted === 'function') {
                AndroidServices.setVoiceMuted(true);
            }
        } else {
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setVoiceMuted === 'function') {
                AndroidServices.setVoiceMuted(false);
            }
        }
    }

    function isVoiceEnabled() {
        return _isVoiceEnabled;
    }

    function getAllRadars() {
        return STATIC_RADARS;
    }

    function getLiveTrafficAlerts() {
        return _liveTrafficAlerts;
    }

    function getRadarById(id) {
        return STATIC_RADARS.find(r => r.id === id) || null;
    }

    /**
     * Notifica al servidor cuando el vehículo pasa por una cámara superando la velocidad máxima
     */
    function _reportSpeedInfractionToServer(radar, speed) {
        try {
            const userId = (typeof Auth !== 'undefined') ? (Auth.getUserId() || Auth.getUserName()) : null;
            const userName = (typeof Auth !== 'undefined') ? Auth.getUserName() : null;
            if (!userId) return;

            const serverUrl = (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.includes('file://'))
                ? window.location.origin
                : 'https://fleetadmin-web-nueva.onrender.com';

            fetch(`${serverUrl}/api/driver/speed-infraction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    driver_id: userId,
                    driverName: userName,
                    radarId: radar.id,
                    radarName: radar.name,
                    radarAddress: radar.address,
                    radarLimit: radar.maxSpeed ?? radar.limit,
                    speed: speed,
                    timestamp: Date.now()
                })
            }).then(r => r.json()).then(res => {
                console.log('📡 [COPILOTO] Infracción reportada al servidor:', res);
            }).catch(err => {
                console.warn('⚠️ [COPILOTO] Error enviando infracción:', err.message);
            });
        } catch (e) {
            console.warn('⚠️ [COPILOTO] Error en _reportSpeedInfractionToServer:', e);
        }
    }

    function dismissHUD() {
        _stopAllAudio();
        const activeTarget = _currentHudTarget;
        const nowDismiss = Date.now();
        if (activeTarget && activeTarget.id) {
            _userDismissedTargetId = activeTarget.id;
            _userDismissedAt = nowDismiss;
            if (activeTarget.isTrafficAlert) {
                if (!_trafficTrackingState[activeTarget.id]) {
                    _trafficTrackingState[activeTarget.id] = { distanciaAnterior: _lastAlertAudioDistance || 300 };
                }
                _trafficTrackingState[activeTarget.id].dismissedByUser = true;
            } else if (radarTrackingState[activeTarget.id]) {
                radarTrackingState[activeTarget.id].dismissedByUser = true;
                radarTrackingState[activeTarget.id].dismissedAt = nowDismiss;
                _syncStateToNative(activeTarget.id, radarTrackingState[activeTarget.id], false);
            }
        }
        _hideRadarHUD(true);
        if (window.NativeServiceBridge && typeof window.NativeServiceBridge.hideOverlayAlert === 'function') {
            try { window.NativeServiceBridge.hideOverlayAlert(); } catch (_) {}
        }
    }

    /**
     * Evalúa la posición actual del GPS frente a los radares activos.
     * Garantiza paridad estricta entre la lógica Web y el servicio nativo de Android:
     * - Convierte velocidad: `const speedKmh = (position.coords.speed || 0) * 3.6;`
     * - Emite aviso inicial único (`initialAlertFired = true`), evalúa velocidad dinámica y auto-cierra al cruzar (`distanciaActual > distanciaAnterior + 10`).
     */
    function processRadarProximityAndSpeed(position, activeRadars) {
        if (!position || !position.coords) return;
        const coords = position.coords;
        const speedKmh = Math.max(0, (coords.speed || 0) * 3.6);

        checkProximity(
            coords.latitude,
            coords.longitude,
            speedKmh,
            (typeof coords.heading === 'number' && !isNaN(coords.heading)) ? coords.heading : null,
            (typeof coords.accuracy === 'number' && !isNaN(coords.accuracy)) ? coords.accuracy : null,
            'kmh',
            Array.isArray(activeRadars) && activeRadars.length > 0 ? activeRadars : null
        );
    }

    return {
        checkProximity,
        processRadarProximityAndSpeed,
        syncStateFromNative,
        setEnabled,
        isEnabled,
        setVoiceEnabled,
        isVoiceEnabled,
        setVolume: _setAlertVolume,
        getVolume: () => _alertVolumePercent,
        stopAudio: _stopAllAudio,
        getAllRadars,
        getLiveTrafficAlerts,
        getRadarById,
        getTrackingState: () => radarTrackingState,
        getLastPosition: () => _lastPosition,
        getDistanceInMeters: getDistanceInMeters,
        dismissHUD,
        testAlert
    };
})();
