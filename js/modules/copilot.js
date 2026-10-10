/* ==========================================================================
   FleetAdmin Pro — Copiloto GPS de Radares y Fotomultas (v2.0 Rosario)
   Base de datos oficial de 80 cámaras de videocontrol + APSV Circunvalación
   HUD visual prominente para choferes, doble chime Web Audio y voz nativa
   ========================================================================== */

const CopilotModule = (() => {
    // Configuración de proximidad y alertas
    const WARNING_DISTANCE_METERS = 315;  // 300m para fotomultas (con margen de tolerancia GPS)
    const TRAFFIC_WARNING_METERS = 500;   // 500m para operativos dinámicos de tránsito
    const PASSING_DISTANCE_METERS = 20;   // Distancia mínima para considerar cámara superada
    const COOLDOWN_MS = 3 * 60 * 1000;    // 3 minutos de enfriamiento por cámara

    // Estado del módulo
    let _isEnabled = localStorage.getItem('copilotRadar') !== 'off';
    let _isVoiceEnabled = localStorage.getItem('radarVoice') !== 'off';
    let _alertVolumePercent = parseInt(localStorage.getItem('radarVolumePercent') || '85', 10);
    let _lastAlertTime = {};              // { radarId: timestamp }
    let _activeApproach = null;           // { radarId, target, stage, minDistance, startedAt }
    let _lastPosition = null;             // { lat, lng, time, speed, bearing }
    let _audioCtx = null;
    let _hudTimer = null;
    let _liveTrafficAlerts = [];          // Alertas activas de tránsito en tiempo real (Firebase)
    let _warnedTrafficApproaches = new Set(); // IDs de alertas ya cantadas en la aproximación actual
    let _firebaseAlertsListening = false;

    function _stopAllAudio() {
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
        "address": "ESPAÑA Y SAN LORENZO"
    },
    {
        "id": "radar_rosario_2",
        "name": "Mendoza y Av. Provincias Unidas",
        "lat": -32.940218,
        "lng": -60.712617,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "MENDOZA Y PROVINCIAS UNIDAS"
    },
    {
        "id": "radar_rosario_3",
        "name": "Laprida 850",
        "lat": -32.947905,
        "lng": -60.634233,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "LAPRIDA FRANCISCO NARCISO 850"
    },
    {
        "id": "radar_rosario_4",
        "name": "Necochea 2650",
        "lat": -32.970673,
        "lng": -60.629809,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "NECOCHEA GRAL. MARIANO 2650"
    },
    {
        "id": "radar_rosario_5",
        "name": "Ayacucho y Av. Arijón",
        "lat": -33.002625,
        "lng": -60.636058,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "AYACUCHO BATALLA DE Y ARIJON MANUEL"
    },
    {
        "id": "radar_rosario_6",
        "name": "Maipú y Mendoza",
        "lat": -32.952,
        "lng": -60.63655,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "MAIPU Y MENDOZA"
    },
    {
        "id": "radar_rosario_7",
        "name": "Córdoba y Av. Ovidio Lagos",
        "lat": -32.942251,
        "lng": -60.661437,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "CORDOBA Y LAGOS OVIDIO"
    },
    {
        "id": "radar_rosario_8",
        "name": "Santa Fe y Pueyrredón",
        "lat": -32.941639,
        "lng": -60.657014,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "SANTA FE Y PUEYRREDON JUAN MARTIN DE"
    },
    {
        "id": "radar_rosario_9",
        "name": "Santa Fe 1750",
        "lat": -32.943309,
        "lng": -60.64682,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "SANTA FE 1750"
    },
    {
        "id": "radar_rosario_10",
        "name": "Laprida y 3 de Febrero",
        "lat": -32.953483,
        "lng": -60.635702,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "LAPRIDA FRANCISCO NARCISO Y TRES DE FEBRERO"
    },
    {
        "id": "radar_rosario_11",
        "name": "San Lorenzo 1550",
        "lat": -32.94287,
        "lng": -60.643818,
        "limit": 40,
        "desc": "Cruce en rojo / Senda peatonal",
        "address": "SAN LORENZO 1550"
    },
    {
        "id": "radar_rosario_12",
        "name": "Colombres 1071",
        "lat": -32.902573,
        "lng": -60.681992,
        "limit": 50,
        "desc": "Totem disuasorio.",
        "address": "COLOMBRES DR. CARLOS G 1071"
    },
    {
        "id": "radar_rosario_13",
        "name": "Colombres 930",
        "lat": -32.903665,
        "lng": -60.679356,
        "limit": 50,
        "desc": "Tótem disuasorio de velocidad",
        "address": "COLOMBRES DR. CARLOS G 930"
    },
    {
        "id": "radar_rosario_14",
        "name": "Frondizi 260",
        "lat": -32.91085,
        "lng": -60.676757,
        "limit": 50,
        "desc": "Exceso de velocidad.",
        "address": "FRONDIZI ARTURO 260"
    },
    {
        "id": "radar_rosario_15",
        "name": "Bv. Rondeau y Baigorria",
        "lat": -32.891534,
        "lng": -60.693321,
        "limit": 50,
        "desc": "Cruce en rojo",
        "address": "RONDEAU GRAL. JOSE Y BAIGORRIA JUAN BAUTISTA"
    },
    {
        "id": "radar_rosario_16",
        "name": "Mendoza y Bv. Avellaneda",
        "lat": -32.944206,
        "lng": -60.680413,
        "limit": 50,
        "desc": "Cruce en rojo",
        "address": "MENDOZA Y AVELLANEDA NICOLAS"
    },
    {
        "id": "radar_rosario_17",
        "name": "Cafferata 850",
        "lat": -32.941091,
        "lng": -60.671253,
        "limit": 50,
        "desc": "Invasión ciclovía",
        "address": "CAFFERATA JUAN MANUEL 850"
    },
    {
        "id": "radar_rosario_18",
        "name": "Mendoza 5350",
        "lat": -32.941184,
        "lng": -60.69654,
        "limit": 50,
        "desc": "Invasión ciclovía",
        "address": "MENDOZA 5350"
    },
    {
        "id": "radar_rosario_19",
        "name": "Colombres 1451",
        "lat": -32.89803,
        "lng": -60.684388,
        "limit": 50,
        "desc": "Invasión de ciclovía",
        "address": "COLOMBRES DR. CARLOS G 1451"
    },
    {
        "id": "radar_rosario_20",
        "name": "Córdoba 3050",
        "lat": -32.941517,
        "lng": -60.664756,
        "limit": 50,
        "desc": "Invación carril exclusivo",
        "address": "CORDOBA 3050"
    },
    {
        "id": "radar_rosario_21",
        "name": "Santa Fe 2850",
        "lat": -32.94065,
        "lng": -60.661745,
        "limit": 50,
        "desc": "Invasión carril exclusivo",
        "address": "SANTA FE 2850"
    },
    {
        "id": "radar_rosario_22",
        "name": "Av. Arijón 750",
        "lat": -33.002789,
        "lng": -60.645956,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "ARIJON MANUEL 750"
    },
    {
        "id": "radar_rosario_23",
        "name": "Av. Belgrano 2131 - Sur-Norte",
        "lat": -32.96665,
        "lng": -60.621018,
        "limit": 60,
        "desc": "Exceso de velocidad",
        "address": "BELGRANO GRAL. MANUEL 2131"
    },
    {
        "id": "radar_rosario_24",
        "name": "Casiano Casas y Sorrento",
        "lat": -32.907258,
        "lng": -60.695756,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "CASAS CASIANO Y SORRENTO"
    },
    {
        "id": "radar_rosario_25",
        "name": "Av. Eva Perón y Circunvalación (Colectora)",
        "lat": -32.931398,
        "lng": -60.721774,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PERON EVA Y JUAN PABLO II"
    },
    {
        "id": "radar_rosario_26",
        "name": "Av. Estanislao López y Av. Francia",
        "lat": -32.925269,
        "lng": -60.66138,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "LOPEZ ESTANISLAO Y FRANCIA"
    },
    {
        "id": "radar_rosario_27",
        "name": "Juan José Paso y Cullen",
        "lat": -32.920183,
        "lng": -60.709713,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PASO JUAN JOSE Y CULLEN DOMINGO"
    },
    {
        "id": "radar_rosario_28",
        "name": "Av. Pellegrini y Gutenberg",
        "lat": -32.948475,
        "lng": -60.690025,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y GUTENBERG JUAN"
    },
    {
        "id": "radar_rosario_29",
        "name": "Av. Provincias Unidas y Av. Pellegrini",
        "lat": -32.948576,
        "lng": -60.712266,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PROVINCIAS UNIDAS Y PELLEGRINI CARLOS"
    },
    {
        "id": "radar_rosario_30",
        "name": "Av. Pellegrini y Av. Ovidio Lagos",
        "lat": -32.953098,
        "lng": -60.66419,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y LAGOS OVIDIO"
    },
    {
        "id": "radar_rosario_31",
        "name": "Bv. Oroño y Bv. Seguí",
        "lat": -32.97636,
        "lng": -60.661512,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "OROÑO NICASIO Y SEGUI JUAN FRANCISCO"
    },
    {
        "id": "radar_rosario_32",
        "name": "Av. Pellegrini y Rouillón",
        "lat": -32.948301,
        "lng": -60.70193,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y ROUILLON ALFREDO"
    },
    {
        "id": "radar_rosario_33",
        "name": "Av. Presidente Perón y Rouillón",
        "lat": -32.962875,
        "lng": -60.701377,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PERON PTE. JUAN DOMINGO Y ROUILLON ALFREDO"
    },
    {
        "id": "radar_rosario_34",
        "name": "Av. Travesía (Sabin) y Bv. Avellaneda",
        "lat": -32.928855,
        "lng": -60.676595,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "SABIN ALBERT Y AVELLANEDA NICOLAS"
    },
    {
        "id": "radar_rosario_35",
        "name": "Av. Uriburu y Bv. Avellaneda",
        "lat": -32.991941,
        "lng": -60.688768,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "URIBURU PTE. JOSE EVARISTO Y AVELLANEDA NICOLAS"
    },
    {
        "id": "radar_rosario_36",
        "name": "Bv. Rondeau 1250",
        "lat": -32.90174,
        "lng": -60.689834,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "RONDEAU GRAL. JOSE 1250"
    },
    {
        "id": "radar_rosario_37",
        "name": "Av. Pellegrini 1551",
        "lat": -32.956361,
        "lng": -60.647227,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "PELLEGRINI CARLOS 1551"
    },
    {
        "id": "radar_rosario_38",
        "name": "Av. Provincias Unidas 750",
        "lat": -32.936316,
        "lng": -60.713057,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "PROVINCIAS UNIDAS 750"
    },
    {
        "id": "radar_rosario_39",
        "name": "Av. Provincias Unidas 2550",
        "lat": -32.958707,
        "lng": -60.712083,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "PROVINCIAS UNIDAS 2550"
    },
    {
        "id": "radar_rosario_40",
        "name": "Bv. Oroño 2170",
        "lat": -32.960032,
        "lng": -60.657712,
        "limit": 60,
        "desc": "Tótem disuasorio de velocidad",
        "address": "OROÑO NICASIO 2170"
    },
    {
        "id": "radar_rosario_41",
        "name": "Av. Estanislao López 2530",
        "lat": -32.928495,
        "lng": -60.65454,
        "limit": 60,
        "desc": "Tótem disuasorio de velocidad",
        "address": "LOPEZ ESTANISLAO 2530"
    },
    {
        "id": "radar_rosario_42",
        "name": "Av. Belgrano 181 Bis",
        "lat": -32.957185,
        "lng": -60.622465,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "BELGRANO GRAL. MANUEL 181 BIS"
    },
    {
        "id": "radar_rosario_43",
        "name": "Av. Estanislao López 2531",
        "lat": -32.928745,
        "lng": -60.654986,
        "limit": 60,
        "desc": "Exceso de velocidad",
        "address": "LOPEZ ESTANISLAO 2531"
    },
    {
        "id": "radar_rosario_44",
        "name": "Av. Uriburu 1185",
        "lat": -32.991,
        "lng": -60.650593,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "URIBURU PTE. JOSE EVARISTO 1185"
    },
    {
        "id": "radar_rosario_45",
        "name": "Sorrento 6431",
        "lat": -32.908015,
        "lng": -60.710811,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "SORRENTO 6431"
    },
    {
        "id": "radar_rosario_46",
        "name": "Av. 27 de Febrero y Matienzo",
        "lat": -32.958746,
        "lng": -60.693969,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "VEINTISIETE DE FEBRERO Y MATIENZO CAPITAN BENJAMIN"
    },
    {
        "id": "radar_rosario_47",
        "name": "Av. Jorge Newbery 7915",
        "lat": -32.908616,
        "lng": -60.733412,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "NEWBERY JORGE 7915"
    },
    {
        "id": "radar_rosario_48",
        "name": "ILLIA PTE. ARTURO U. 1402",
        "lat": -32.937028,
        "lng": -60.639938,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "ILLIA PTE. ARTURO U. 1402"
    },
    {
        "id": "radar_rosario_49",
        "name": "Bv. Seguí 3820",
        "lat": -32.97219,
        "lng": -60.683506,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "SEGUI JUAN FRANCISCO 3820"
    },
    {
        "id": "radar_rosario_50",
        "name": "Bv. Avellaneda 2951",
        "lat": -32.964331,
        "lng": -60.685223,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "AVELLANEDA NICOLAS 2951"
    },
    {
        "id": "radar_rosario_51",
        "name": "Sorrento y Circunvalación (Colectora)",
        "lat": -32.908234,
        "lng": -60.722652,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "SORRENTO Y JUAN PABLO II"
    },
    {
        "id": "radar_rosario_52",
        "name": "Av. Ovidio Lagos y Av. Arijón",
        "lat": -33.003837,
        "lng": -60.676165,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "LAGOS OVIDIO Y ARIJON MANUEL"
    },
    {
        "id": "radar_rosario_53",
        "name": "Av. 27 de Febrero y Av. Francia",
        "lat": -32.962699,
        "lng": -60.670855,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "VEINTISIETE DE FEBRERO Y FRANCIA"
    },
    {
        "id": "radar_rosario_54",
        "name": "Bv. Avellaneda y Av. Carballo",
        "lat": -32.921979,
        "lng": -60.674815,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "AVELLANEDA NICOLAS Y CARBALLO LUIS CANDIDO"
    },
    {
        "id": "radar_rosario_55",
        "name": "Av. Belgrano y Raúl Domínguez",
        "lat": -32.949759,
        "lng": -60.628175,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "BELGRANO GRAL. MANUEL Y DOMINGUEZ, RAUL"
    },
    {
        "id": "radar_rosario_56",
        "name": "Av. Francia y Av. Presidente Perón",
        "lat": -32.955902,
        "lng": -60.669142,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "FRANCIA Y PERON PTE. JUAN DOMINGO"
    },
    {
        "id": "radar_rosario_57",
        "name": "Av. Pellegrini y Corrientes",
        "lat": -32.956531,
        "lng": -60.645082,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y CORRIENTES"
    },
    {
        "id": "radar_rosario_58",
        "name": "Bv. Oroño y Av. Uriburu",
        "lat": -32.991421,
        "lng": -60.6654,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "OROÑO NICASIO Y URIBURU PTE. JOSE EVARISTO"
    },
    {
        "id": "radar_rosario_59",
        "name": "Av. Presidente Perón y Av. Provincias Unidas",
        "lat": -32.967948,
        "lng": -60.711484,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PERON PTE. JUAN DOMINGO Y PROVINCIAS UNIDAS"
    },
    {
        "id": "radar_rosario_60",
        "name": "Av. San Martín y Av. Uriburu",
        "lat": -32.990667,
        "lng": -60.64669,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "SAN MARTIN GRAL. JOSE Y URIBURU PTE. JOSE EVARISTO"
    },
    {
        "id": "radar_rosario_61",
        "name": "Av. Ovidio Lagos 3550",
        "lat": -32.97429,
        "lng": -60.669492,
        "limit": 60,
        "desc": "Invasión ciclovía",
        "address": "LAGOS OVIDIO 3550"
    },
    {
        "id": "radar_rosario_62",
        "name": "Av. Belgrano 180 Bis",
        "lat": -32.95702,
        "lng": -60.622071,
        "limit": 60,
        "desc": "Tótem disuasorio de velocidad",
        "address": "BELGRANO GRAL. MANUEL 180 BIS"
    },
    {
        "id": "radar_rosario_63",
        "name": "Callao y Salta",
        "lat": -32.935521,
        "lng": -60.658315,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "SALTA Y CALLAO"
    },
    {
        "id": "radar_rosario_64",
        "name": "Bv. Rondeau 3860",
        "lat": -32.879559,
        "lng": -60.696588,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "RONDEAU GRAL. JOSE 3860"
    },
    {
        "id": "radar_rosario_65",
        "name": "Bv. Rondeau 2941",
        "lat": -32.886461,
        "lng": -60.695243,
        "limit": 60,
        "desc": "Control de Exceso de Velocidad",
        "address": "RONDEAU GRAL. JOSE 2941"
    },
    {
        "id": "radar_rosario_66",
        "name": "Av. Uriburu 3555 Oeste-Este",
        "lat": -32.992058,
        "lng": -60.684454,
        "limit": 60,
        "desc": "Control de Exceso de Velocidad",
        "address": "URIBURU PTE. JOSE EVARISTO 3555"
    },
    {
        "id": "radar_rosario_67",
        "name": "Bv. Avellaneda y Santa Fe",
        "lat": -32.937731,
        "lng": -60.678776,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "AVELLANEDA NICOLAS Y SANTA FE"
    },
    {
        "id": "radar_rosario_68",
        "name": "Bv. Avellaneda y Av. Presidente Perón",
        "lat": -32.957605,
        "lng": -60.683796,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "AVELLANEDA NICOLAS Y PERON PTE. JUAN DOMINGO"
    },
    {
        "id": "radar_rosario_69",
        "name": "Av. San Martín y Garibaldi",
        "lat": -32.986372,
        "lng": -60.645762,
        "limit": 60,
        "desc": "Giro Indebido",
        "address": "SAN MARTIN GRAL. JOSE Y GARIBALDI JOSE"
    },
    {
        "id": "radar_rosario_70",
        "name": "Carrasco 3394",
        "lat": -32.883611,
        "lng": -60.687809,
        "limit": 60,
        "desc": "Exceso de velocidad.",
        "address": "CARRASCO EUDORO 3394"
    },
    {
        "id": "radar_rosario_71",
        "name": "Bv. Oroño y Av. 27 de Febrero",
        "lat": -32.964881,
        "lng": -60.658643,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "OROÑO NICASIO Y VEINTISIETE DE FEBRERO"
    },
    {
        "id": "radar_rosario_72",
        "name": "Bv. Bv. Avellaneda y Bv. Seguí",
        "lat": -32.971724,
        "lng": -60.68736,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "AVELLANEDA NICOLAS Y SEGUI JUAN FRANCISCO"
    },
    {
        "id": "radar_rosario_73",
        "name": "Av. Pellegrini y Bv. Avellaneda",
        "lat": -32.949941,
        "lng": -60.68186,
        "limit": 60,
        "desc": "Cruce en rojo",
        "address": "PELLEGRINI CARLOS Y AVELLANEDA NICOLAS"
    },
    {
        "id": "radar_rosario_74",
        "name": "Bv. Oroño y Batlle y Ordóñez",
        "lat": -33.009436,
        "lng": -60.664703,
        "limit": 70,
        "desc": "Cruce en rojo",
        "address": "OROÑO NICASIO Y BATLLE Y ORDOÑEZ JOSE"
    },
    {
        "id": "radar_circ_1",
        "name": "Av. Circunvalación y Av. Pellegrini",
        "lat": -32.9696,
        "lng": -60.7105,
        "limit": 100,
        "desc": "Radar de velocidad fija Circunvalación",
        "address": "Av. Circunvalación (A008) y Av. Pellegrini"
    },
    {
        "id": "radar_circ_2",
        "name": "Av. Circunvalación y Av. Eva Perón (Córdoba)",
        "lat": -32.9367,
        "lng": -60.7228,
        "limit": 100,
        "desc": "Radar de velocidad fija Circunvalación",
        "address": "Av. Circunvalación (A008) y Av. Eva Perón"
    },
    {
        "id": "radar_circ_3",
        "name": "Av. Circunvalación y Av. Uriburu",
        "lat": -33.0031,
        "lng": -60.6729,
        "limit": 100,
        "desc": "Radar de velocidad fija Circunvalación",
        "address": "Av. Circunvalación (A008) y Av. Uriburu"
    },
    {
        "id": "radar_circ_4",
        "name": "Av. Circunvalación y Ayacucho (Acceso Sur)",
        "lat": -33.0118,
        "lng": -60.6385,
        "limit": 100,
        "desc": "Radar de velocidad fija Circunvalación",
        "address": "Av. Circunvalación (A008) y Ayacucho"
    },
    {
        "id": "radar_circ_5",
        "name": "Av. Circunvalación y Baigorria",
        "lat": -32.8943,
        "lng": -60.7077,
        "limit": 100,
        "desc": "Radar de velocidad fija Circunvalación",
        "address": "Av. Circunvalación (A008) y Baigorria"
    },
    {
        "id": "radar_circ_6",
        "name": "Autopista Rosario - Bs As (Ingreso Av. Circunvalación)",
        "lat": -33.0315,
        "lng": -60.6482,
        "limit": 70,
        "desc": "Radar ingreso a Rosario",
        "address": "Autopista Bs As altura Arroyo Seco / Ingreso Rosario"
    },
    {
        "id": "radar_rn9_campana_75",
        "name": "RN 9 km 75 (Campana)",
        "address": "Ruta Nacional 9 km 75, Campana, Bs As",
        "lat": -34.195,
        "lng": -58.932,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_zarate_84",
        "name": "RN 9 km 83.8 (Zárate)",
        "address": "Ruta Nacional 9 km 83.8, Zárate, Bs As",
        "lat": -34.135,
        "lng": -59.043,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_zarate_95",
        "name": "RN 9 km 95 (Zárate Oeste)",
        "address": "Ruta Nacional 9 km 95, Zárate, Bs As",
        "lat": -34.092,
        "lng": -59.135,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_baradero_142",
        "name": "RN 9 km 142 (Baradero)",
        "address": "Ruta Nacional 9 km 142, Baradero, Bs As",
        "lat": -33.847,
        "lng": -59.508,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_baradero_152",
        "name": "RN 9 km 152 (Acceso Baradero)",
        "address": "Ruta Nacional 9 km 152, Baradero, Bs As",
        "lat": -33.785,
        "lng": -59.578,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_sanpedro_154",
        "name": "RN 9 km 154 (Río Tala / San Pedro)",
        "address": "Ruta Nacional 9 km 154, Río Tala, Bs As",
        "lat": -33.771,
        "lng": -59.605,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_sanpedro_160",
        "name": "RN 9 km 160 (Acceso San Pedro)",
        "address": "Ruta Nacional 9 km 160, San Pedro, Bs As",
        "lat": -33.738,
        "lng": -59.663,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_ramallo_205",
        "name": "RN 9 km 205 (Ramallo Sur)",
        "address": "Ruta Nacional 9 km 205, Ramallo, Bs As",
        "lat": -33.513,
        "lng": -60.005,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_ramallo_215",
        "name": "RN 9 km 215 (Ramallo Norte)",
        "address": "Ruta Nacional 9 km 215, Ramallo, Bs As",
        "lat": -33.468,
        "lng": -60.088,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_sannicolas_228",
        "name": "RN 9 km 228 (San Nicolás)",
        "address": "Ruta Nacional 9 km 228, San Nicolás, Bs As",
        "lat": -33.398,
        "lng": -60.198,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_sannicolas_232",
        "name": "RN 9 km 232 (San Nicolás Norte)",
        "address": "Ruta Nacional 9 km 232, San Nicolás, Bs As",
        "lat": -33.368,
        "lng": -60.235,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_theobald_246",
        "name": "RN 9 km 246 (Theobald / Límite Santa Fe)",
        "address": "Ruta Nacional 9 km 246, Theobald, Santa Fe",
        "lat": -33.272,
        "lng": -60.334,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_villaconst_250",
        "name": "RN 9 km 250 (Villa Constitución)",
        "address": "Ruta Nacional 9 km 250, Villa Constitución, Santa Fe",
        "lat": -33.245,
        "lng": -60.365,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_figheira_262",
        "name": "RN 9 km 262 (Fighiera)",
        "address": "Ruta Nacional 9 km 262, Fighiera, Santa Fe",
        "lat": -33.175,
        "lng": -60.442,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_arroyoseco_268",
        "name": "RN 9 km 268 (Arroyo Seco)",
        "address": "Ruta Nacional 9 km 268, Arroyo Seco, Santa Fe",
        "lat": -33.142,
        "lng": -60.485,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_glagos_272",
        "name": "RN 9 km 272 (General Lagos)",
        "address": "Ruta Nacional 9 km 272, General Lagos, Santa Fe",
        "lat": -33.118,
        "lng": -60.528,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_alvear_282",
        "name": "RN 9 km 282 (Alvear)",
        "address": "Ruta Nacional 9 km 282, Alvear, Santa Fe",
        "lat": -33.065,
        "lng": -60.621,
        "limit": 100,
        "desc": "Fotomulta fija autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_funes_travesia",
        "name": "RN 9 travesía Funes (Garita 9)",
        "address": "Ruta Nacional 9 y Bv. Mitre (Garita 9), Funes",
        "lat": -32.922,
        "lng": -60.812,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_au9_roldan_314",
        "name": "AU 9 km 314 (Roldán Este)",
        "address": "Autopista Rosario - Córdoba km 314, Roldán",
        "lat": -32.915,
        "lng": -60.895,
        "limit": 120,
        "desc": "Fotomulta autopista RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_roldan_travesia",
        "name": "RN 9 travesía Roldán (km 325)",
        "address": "Ruta Nacional 9 km 325, Roldán",
        "lat": -32.898,
        "lng": -60.91,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_sanjeronimo_340",
        "name": "RN 9 km 340 (San Jerónimo Sud)",
        "address": "Ruta Nacional 9 km 340, San Jerónimo Sud",
        "lat": -32.905,
        "lng": -61.025,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_correa_352",
        "name": "RN 9 km 352 (Correa)",
        "address": "Ruta Nacional 9 km 352, Correa",
        "lat": -32.855,
        "lng": -61.245,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_carcarana_361",
        "name": "RN 9 km 361 (Carcarañá)",
        "address": "Ruta Nacional 9 km 361, Carcarañá",
        "lat": -32.862,
        "lng": -61.155,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_cdegomez_379",
        "name": "RN 9 km 379 (Cañada de Gómez)",
        "address": "Ruta Nacional 9 km 379, Cañada de Gómez",
        "lat": -32.822,
        "lng": -61.395,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_armstrong_396",
        "name": "RN 9 km 396 (Armstrong)",
        "address": "Ruta Nacional 9 km 396, Armstrong",
        "lat": -32.785,
        "lng": -61.605,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_tortugas_420",
        "name": "RN 9 km 420 (Tortugas)",
        "address": "Ruta Nacional 9 km 420, Tortugas",
        "lat": -32.745,
        "lng": -61.825,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_mjuarez_440",
        "name": "RN 9 km 440 (Marcos Juárez)",
        "address": "Ruta Nacional 9 km 440, Marcos Juárez, Córdoba",
        "lat": -32.695,
        "lng": -62.105,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_leones_465",
        "name": "RN 9 km 465 (Leones)",
        "address": "Ruta Nacional 9 km 465, Leones, Córdoba",
        "lat": -32.662,
        "lng": -62.302,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_bellville_500",
        "name": "RN 9 km 500 (Bell Ville)",
        "address": "Ruta Nacional 9 km 500, Bell Ville, Córdoba",
        "lat": -32.625,
        "lng": -62.685,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn9_vmaria_560",
        "name": "RN 9 km 560 (Villa María)",
        "address": "Ruta Nacional 9 km 560, Villa María, Córdoba",
        "lat": -32.415,
        "lng": -63.245,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_ibarlucea_13",
        "name": "RN 34 km 13.5 (Ibarlucea)",
        "address": "Ruta Nacional 34 km 13.5, Ibarlucea",
        "lat": -32.862,
        "lng": -60.785,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_lpalacios_22",
        "name": "RN 34 km 22.5 (Luis Palacios)",
        "address": "Ruta Nacional 34 km 22.5, Luis Palacios",
        "lat": -32.795,
        "lng": -60.852,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_saltogrande_42",
        "name": "RN 34 km 42 (Salto Grande)",
        "address": "Ruta Nacional 34 km 42, Salto Grande",
        "lat": -32.658,
        "lng": -60.985,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_totoras_54",
        "name": "RN 34 km 54 (Totoras)",
        "address": "Ruta Nacional 34 km 54, Totoras",
        "lat": -32.585,
        "lng": -61.055,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_clason_68",
        "name": "RN 34 km 68 (Clason)",
        "address": "Ruta Nacional 34 km 68, Clason",
        "lat": -32.485,
        "lng": -61.135,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_sangenaro_86",
        "name": "RN 34 km 86 (San Genaro)",
        "address": "Ruta Nacional 34 km 86, San Genaro",
        "lat": -32.365,
        "lng": -61.225,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_centeno_98",
        "name": "RN 34 km 98 (Centeno)",
        "address": "Ruta Nacional 34 km 98, Centeno",
        "lat": -32.285,
        "lng": -61.325,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_casas_112",
        "name": "RN 34 km 112 (Casas)",
        "address": "Ruta Nacional 34 km 112, Casas",
        "lat": -32.195,
        "lng": -61.425,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_crosquin_129",
        "name": "RN 34 km 129 (Cañada Rosquín)",
        "address": "Ruta Nacional 34 km 129, Cañada Rosquín",
        "lat": -32.055,
        "lng": -61.602,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_smescobas_152",
        "name": "RN 34 km 152 (San Martín de las Escobas)",
        "address": "Ruta Nacional 34 km 152, San Martín de las Escobas",
        "lat": -31.895,
        "lng": -61.685,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_bandurrias_168",
        "name": "RN 34 km 168 (Las Bandurrias)",
        "address": "Ruta Nacional 34 km 168, Las Bandurrias",
        "lat": -31.785,
        "lng": -61.725,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_svicente_178",
        "name": "RN 34 km 178 (San Vicente)",
        "address": "Ruta Nacional 34 km 178, San Vicente",
        "lat": -31.705,
        "lng": -61.755,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_angelica_192",
        "name": "RN 34 km 192 (Angélica / Cruce RN 19)",
        "address": "Ruta Nacional 34 km 192, Angélica",
        "lat": -31.605,
        "lng": -61.785,
        "limit": 60,
        "desc": "Fotomulta cruce RN 34 y RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_rafaela_220",
        "name": "RN 34 km 220 (Rafaela / Av. Salva)",
        "address": "Ruta Nacional 34 km 220, Rafaela",
        "lat": -31.252,
        "lng": -61.505,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Rafaela",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_lehmann_237",
        "name": "RN 34 km 237 (Lehmann)",
        "address": "Ruta Nacional 34 km 237, Lehmann",
        "lat": -31.125,
        "lng": -61.525,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_ataliva_248",
        "name": "RN 34 km 248 (Ataliva)",
        "address": "Ruta Nacional 34 km 248, Ataliva",
        "lat": -31.025,
        "lng": -61.555,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_sunchales_258",
        "name": "RN 34 km 258 (Sunchales)",
        "address": "Ruta Nacional 34 km 258, Sunchales",
        "lat": -30.945,
        "lng": -61.565,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_tacural_276",
        "name": "RN 34 km 276 (Tacural)",
        "address": "Ruta Nacional 34 km 276, Tacural",
        "lat": -30.815,
        "lng": -61.605,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_arrufo_342",
        "name": "RN 34 km 342 (Arrufó)",
        "address": "Ruta Nacional 34 km 342, Arrufó",
        "lat": -30.345,
        "lng": -61.725,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_hersilia_368",
        "name": "RN 34 km 368 (Hersilia)",
        "address": "Ruta Nacional 34 km 368, Hersilia",
        "lat": -30.015,
        "lng": -61.825,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn34_ceres_388",
        "name": "RN 34 km 388 (Ceres)",
        "address": "Ruta Nacional 34 km 388, Ceres",
        "lat": -29.885,
        "lng": -61.945,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 34",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_perez_782",
        "name": "RN 33 km 782 (Pérez)",
        "address": "Ruta Nacional 33 km 782, Pérez",
        "lat": -32.998,
        "lng": -60.768,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_zavalla_775",
        "name": "RN 33 km 775 (Zavalla)",
        "address": "Ruta Nacional 33 km 775, Zavalla",
        "lat": -33.025,
        "lng": -60.885,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_pujato_756",
        "name": "RN 33 km 756 (Pujato)",
        "address": "Ruta Nacional 33 km 756, Pujato",
        "lat": -33.022,
        "lng": -61.035,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_casilda_741",
        "name": "RN 33 km 741 (Casilda)",
        "address": "Ruta Nacional 33 y Bv. Lisandro de la Torre, Casilda",
        "lat": -33.045,
        "lng": -61.165,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Casilda",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_sanford_726",
        "name": "RN 33 km 726 (Sanford)",
        "address": "Ruta Nacional 33 km 726, Sanford",
        "lat": -33.155,
        "lng": -61.275,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_chabas_715",
        "name": "RN 33 km 715 (Chabás)",
        "address": "Ruta Nacional 33 km 715, Chabás",
        "lat": -33.245,
        "lng": -61.365,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_villada_705",
        "name": "RN 33 km 705 (Villada)",
        "address": "Ruta Nacional 33 km 705, Villada",
        "lat": -33.335,
        "lng": -61.455,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_firmat_694",
        "name": "RN 33 km 694 (Firmat)",
        "address": "Ruta Nacional 33 km 694, Firmat",
        "lat": -33.455,
        "lng": -61.485,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Firmat",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_cucle_680",
        "name": "RN 33 km 680 (Cañada del Ucle)",
        "address": "Ruta Nacional 33 km 680, Cañada del Ucle",
        "lat": -33.565,
        "lng": -61.595,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_chovet_667",
        "name": "RN 33 km 667 (Chovet)",
        "address": "Ruta Nacional 33 km 667, Chovet",
        "lat": -33.645,
        "lng": -61.685,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_murphy_648",
        "name": "RN 33 km 648 (Murphy)",
        "address": "Ruta Nacional 33 km 648, Murphy",
        "lat": -33.695,
        "lng": -61.835,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_vtuerto_634",
        "name": "RN 33 km 634 (Venado Tuerto)",
        "address": "Ruta Nacional 33 y Av. Santa Fe, Venado Tuerto",
        "lat": -33.745,
        "lng": -61.965,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Venado Tuerto",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_sspiritu_575",
        "name": "RN 33 km 575 (Sancti Spíritu)",
        "address": "Ruta Nacional 33 km 575, Sancti Spíritu",
        "lat": -34.025,
        "lng": -62.335,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn33_rufino_540",
        "name": "RN 33 km 540 (Rufino)",
        "address": "Ruta Nacional 33 km 540, Rufino",
        "lat": -34.265,
        "lng": -62.715,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Rufino",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_cbermudez_324",
        "name": "RN 11 km 324 (Capitán Bermúdez)",
        "address": "Ruta Nacional 11 km 324, Capitán Bermúdez",
        "lat": -32.818,
        "lng": -60.718,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_flbeltran_328",
        "name": "RN 11 km 328 (Fray Luis Beltrán)",
        "address": "Ruta Nacional 11 km 328, Fray Luis Beltrán",
        "lat": -32.788,
        "lng": -60.728,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_slorenzo_335",
        "name": "RN 11 km 335 (San Lorenzo)",
        "address": "Ruta Nacional 11 km 335, San Lorenzo",
        "lat": -32.745,
        "lng": -60.735,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_pgsm_340",
        "name": "RN 11 km 340 (Puerto Gral San Martín)",
        "address": "Ruta Nacional 11 km 340, Puerto Gral San Martín",
        "lat": -32.715,
        "lng": -60.738,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_timbues_348",
        "name": "RN 11 km 348 (Timbúes)",
        "address": "Ruta Nacional 11 km 348, Timbúes",
        "lat": -32.665,
        "lng": -60.755,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_oliveros_360",
        "name": "RN 11 km 360 (Oliveros)",
        "address": "Ruta Nacional 11 km 360, Oliveros",
        "lat": -32.575,
        "lng": -60.855,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_maciel_370",
        "name": "RN 11 km 370 (Maciel)",
        "address": "Ruta Nacional 11 km 370, Maciel",
        "lat": -32.465,
        "lng": -60.895,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_monje_382",
        "name": "RN 11 km 382 (Monje)",
        "address": "Ruta Nacional 11 km 382, Monje",
        "lat": -32.355,
        "lng": -60.945,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_barrancas_395",
        "name": "RN 11 km 395 (Barrancas)",
        "address": "Ruta Nacional 11 km 395, Barrancas",
        "lat": -32.235,
        "lng": -60.975,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_arocena_410",
        "name": "RN 11 km 410 (Arocena)",
        "address": "Ruta Nacional 11 km 410, Arocena",
        "lat": -32.125,
        "lng": -61.015,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_coronda_428",
        "name": "RN 11 km 428 (Coronda)",
        "address": "Ruta Nacional 11 km 428, Coronda",
        "lat": -31.975,
        "lng": -60.925,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Coronda",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_sauceviejo_460",
        "name": "RN 11 km 460 (Sauce Viejo)",
        "address": "Ruta Nacional 11 km 460, Sauce Viejo",
        "lat": -31.775,
        "lng": -60.835,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_stotome_470",
        "name": "RN 11 km 470 (Santo Tomé)",
        "address": "Ruta Nacional 11 km 470, Santo Tomé",
        "lat": -31.675,
        "lng": -60.775,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Santo Tomé",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_recreo_485",
        "name": "RN 11 km 485 (Recreo)",
        "address": "Ruta Nacional 11 km 485, Recreo",
        "lat": -31.495,
        "lng": -60.735,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_candioti_495",
        "name": "RN 11 km 495 (Candioti)",
        "address": "Ruta Nacional 11 km 495, Candioti",
        "lat": -31.405,
        "lng": -60.745,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_nelson_515",
        "name": "RN 11 km 515 (Nelson)",
        "address": "Ruta Nacional 11 km 515, Nelson",
        "lat": -31.265,
        "lng": -60.765,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_llambi_530",
        "name": "RN 11 km 530 (Llambi Campbell)",
        "address": "Ruta Nacional 11 km 530, Llambi Campbell",
        "lat": -31.145,
        "lng": -60.755,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_sjusto_568",
        "name": "RN 11 km 568 (San Justo)",
        "address": "Ruta Nacional 11 km 568, San Justo",
        "lat": -30.785,
        "lng": -60.595,
        "limit": 60,
        "desc": "Fotomulta travesía urbana San Justo",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_gcrespo_625",
        "name": "RN 11 km 625 (Gobernador Crespo)",
        "address": "Ruta Nacional 11 km 625, Gobernador Crespo",
        "lat": -30.365,
        "lng": -60.365,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_calchaqui_670",
        "name": "RN 11 km 670 (Calchaquí)",
        "address": "Ruta Nacional 11 km 670, Calchaquí",
        "lat": -29.885,
        "lng": -60.305,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Calchaquí",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_vera_722",
        "name": "RN 11 km 722 (Vera)",
        "address": "Ruta Nacional 11 km 722, Vera",
        "lat": -29.465,
        "lng": -60.215,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Vera",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_malabrigo_750",
        "name": "RN 11 km 750 (Malabrigo)",
        "address": "Ruta Nacional 11 km 750, Malabrigo",
        "lat": -29.345,
        "lng": -59.975,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 11",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_reconquista_789",
        "name": "RN 11 km 789 (Reconquista)",
        "address": "Ruta Nacional 11 km 789, Reconquista",
        "lat": -29.145,
        "lng": -59.645,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Reconquista",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn11_avellaneda_794",
        "name": "RN 11 km 794 (Avellaneda)",
        "address": "Ruta Nacional 11 km 794, Avellaneda",
        "lat": -29.115,
        "lng": -59.655,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Avellaneda",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_sjose_8",
        "name": "RN 19 km 8 (Colonia San José)",
        "address": "Ruta Nacional 19 km 8, Colonia San José",
        "lat": -31.662,
        "lng": -60.825,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_sagustin_20",
        "name": "RN 19 km 20 (San Agustín)",
        "address": "Autovía 19 km 20, San Agustín",
        "lat": -31.655,
        "lng": -60.945,
        "limit": 110,
        "desc": "Fotomulta autovía RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_franck_30",
        "name": "RN 19 km 30 (Franck)",
        "address": "Autovía 19 km 30, Franck",
        "lat": -31.652,
        "lng": -61.055,
        "limit": 110,
        "desc": "Fotomulta autovía RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_sjsauce_37",
        "name": "RN 19 km 37 (San Jerónimo del Sauce)",
        "address": "Ruta Nacional 19 km 37, San Jerónimo del Sauce",
        "lat": -31.65,
        "lng": -61.125,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_sapereira_62",
        "name": "RN 19 km 62 (Sa Pereira)",
        "address": "Ruta Nacional 19 km 62, Sa Pereira",
        "lat": -31.642,
        "lng": -61.375,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_josefina_118",
        "name": "RN 19 km 118 (Josefina)",
        "address": "Ruta Nacional 19 km 118, Josefina",
        "lat": -31.472,
        "lng": -61.955,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_frontera_127",
        "name": "RN 19 km 127 (Frontera / San Francisco)",
        "address": "Ruta Nacional 19 km 127, Frontera / San Francisco",
        "lat": -31.435,
        "lng": -62.085,
        "limit": 60,
        "desc": "Fotomulta límite Santa Fe - Córdoba",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_devoto_160",
        "name": "RN 19 km 160 (Devoto)",
        "address": "Ruta Nacional 19 km 160, Devoto, Córdoba",
        "lat": -31.405,
        "lng": -62.305,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_lafrancia_185",
        "name": "RN 19 km 185 (La Francia)",
        "address": "Ruta Nacional 19 km 185, La Francia, Córdoba",
        "lat": -31.402,
        "lng": -62.635,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_arroyito_225",
        "name": "RN 19 km 225 (Arroyito)",
        "address": "Ruta Nacional 19 km 225, Arroyito, Córdoba",
        "lat": -31.422,
        "lng": -63.055,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn19_rioprimero_280",
        "name": "RN 19 km 280 (Río Primero)",
        "address": "Ruta Nacional 19 km 280, Río Primero, Córdoba",
        "lat": -31.332,
        "lng": -63.625,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 19",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_ecruz_75",
        "name": "RN 8 km 75 (Exaltación de la Cruz)",
        "address": "Ruta Nacional 8 km 75, Exaltación de la Cruz, Bs As",
        "lat": -34.345,
        "lng": -59.185,
        "limit": 100,
        "desc": "Fotomulta autopista RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_sareco_112",
        "name": "RN 8 km 112 (San Antonio de Areco)",
        "address": "Ruta Nacional 8 km 112, San Antonio de Areco",
        "lat": -34.255,
        "lng": -59.475,
        "limit": 80,
        "desc": "Fotomulta cruce RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_csarmiento_145",
        "name": "RN 8 km 145 (Capitán Sarmiento)",
        "address": "Ruta Nacional 8 km 145, Capitán Sarmiento",
        "lat": -34.175,
        "lng": -59.785,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_arrecifes_175",
        "name": "RN 8 km 175 (Arrecifes)",
        "address": "Ruta Nacional 8 km 175, Arrecifes",
        "lat": -34.065,
        "lng": -60.105,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Arrecifes",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_todd_184",
        "name": "RN 8 km 184 (Todd)",
        "address": "Ruta Nacional 8 km 184, Todd",
        "lat": -34.025,
        "lng": -60.175,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_vina_198",
        "name": "RN 8 km 198 (Viña)",
        "address": "Ruta Nacional 8 km 198, Viña",
        "lat": -33.975,
        "lng": -60.295,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_pergamino_222",
        "name": "RN 8 km 222 (Pergamino)",
        "address": "Ruta Nacional 8 km 222, Pergamino",
        "lat": -33.895,
        "lng": -60.575,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Pergamino",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_colon_276",
        "name": "RN 8 km 276 (Colón)",
        "address": "Ruta Nacional 8 km 276, Colón, Bs As",
        "lat": -33.898,
        "lng": -61.095,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Colón",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_wheelwright_302",
        "name": "RN 8 km 302 (Wheelwright)",
        "address": "Ruta Nacional 8 km 302, Wheelwright, Santa Fe",
        "lat": -33.795,
        "lng": -61.355,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_hughes_320",
        "name": "RN 8 km 320 (Hughes)",
        "address": "Ruta Nacional 8 km 320, Hughes, Santa Fe",
        "lat": -33.802,
        "lng": -61.545,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_sisabel_342",
        "name": "RN 8 km 342 (Santa Isabel)",
        "address": "Ruta Nacional 8 km 342, Santa Isabel, Santa Fe",
        "lat": -33.785,
        "lng": -61.735,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_vtuerto_365",
        "name": "RN 8 km 365 (Venado Tuerto)",
        "address": "Ruta Nacional 8 y Av. Casey, Venado Tuerto",
        "lat": -33.755,
        "lng": -61.965,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Venado Tuerto",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_maggiolo_392",
        "name": "RN 8 km 392 (Maggiolo)",
        "address": "Ruta Nacional 8 km 392, Maggiolo, Santa Fe",
        "lat": -33.725,
        "lng": -62.245,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_arias_410",
        "name": "RN 8 km 410 (Arias)",
        "address": "Ruta Nacional 8 km 410, Arias, Córdoba",
        "lat": -33.645,
        "lng": -62.405,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_canals_445",
        "name": "RN 8 km 445 (Canals)",
        "address": "Ruta Nacional 8 km 445, Canals, Córdoba",
        "lat": -33.565,
        "lng": -62.885,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn8_lacarlota_500",
        "name": "RN 8 km 500 (La Carlota)",
        "address": "Ruta Nacional 8 km 500, La Carlota, Córdoba",
        "lat": -33.425,
        "lng": -63.295,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 8",
        "type": "speed_camera"
    },
    {
        "id": "radar_rna012_alvear_2",
        "name": "RN A012 km 2 (Alvear / RP 21)",
        "address": "Ruta Nacional A012 km 2, Alvear",
        "lat": -33.065,
        "lng": -60.598,
        "limit": 60,
        "desc": "Fotomulta cruce RN A012 y RP 21",
        "type": "speed_camera"
    },
    {
        "id": "radar_rna012_pinero_15",
        "name": "RN A012 km 15 (Piñero / RP 14)",
        "address": "Ruta Nacional A012 km 15, Piñero",
        "lat": -33.055,
        "lng": -60.745,
        "limit": 60,
        "desc": "Fotomulta cruce RN A012 y RP 14",
        "type": "speed_camera"
    },
    {
        "id": "radar_rna012_zavalla_26",
        "name": "RN A012 km 26 (Zavalla / RN 33)",
        "address": "Ruta Nacional A012 km 26, Zavalla",
        "lat": -33.032,
        "lng": -60.855,
        "limit": 60,
        "desc": "Fotomulta cruce RN A012 y RN 33",
        "type": "speed_camera"
    },
    {
        "id": "radar_rna012_roldan_44",
        "name": "RN A012 km 44 (Roldán / RN 9)",
        "address": "Ruta Nacional A012 km 44, Roldán",
        "lat": -32.898,
        "lng": -60.902,
        "limit": 60,
        "desc": "Fotomulta cruce RN A012 y RN 9",
        "type": "speed_camera"
    },
    {
        "id": "radar_rna012_ricardone_56",
        "name": "RN A012 km 56 (Ricardone / RP 10)",
        "address": "Ruta Nacional A012 km 56, Ricardone",
        "lat": -32.785,
        "lng": -60.785,
        "limit": 60,
        "desc": "Fotomulta cruce RN A012 y RP 10",
        "type": "speed_camera"
    },
    {
        "id": "radar_rna012_slorenzo_64",
        "name": "RN A012 km 64 (San Lorenzo Acceso)",
        "address": "Ruta Nacional A012 km 64, San Lorenzo",
        "lat": -32.752,
        "lng": -60.755,
        "limit": 60,
        "desc": "Fotomulta acceso San Lorenzo",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn7_lujan_68",
        "name": "RN 7 km 68 (Luján)",
        "address": "Autopista Luján - Junín RN 7 km 68, Luján",
        "lat": -34.565,
        "lng": -59.125,
        "limit": 100,
        "desc": "Fotomulta autopista RN 7",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn7_giles_98",
        "name": "RN 7 km 98 (San Andrés de Giles)",
        "address": "Ruta Nacional 7 km 98, San Andrés de Giles",
        "lat": -34.455,
        "lng": -59.455,
        "limit": 100,
        "desc": "Fotomulta autopista RN 7",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn7_careco_140",
        "name": "RN 7 km 140 (Carmen de Areco)",
        "address": "Ruta Nacional 7 km 140, Carmen de Areco",
        "lat": -34.385,
        "lng": -59.825,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 7",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn7_chacabuco_208",
        "name": "RN 7 km 208 (Chacabuco)",
        "address": "Ruta Nacional 7 km 208, Chacabuco",
        "lat": -34.645,
        "lng": -60.475,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Chacabuco",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn7_junin_260",
        "name": "RN 7 km 260 (Junín)",
        "address": "Ruta Nacional 7 km 260, Junín",
        "lat": -34.595,
        "lng": -60.945,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Junín",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn7_vedia_312",
        "name": "RN 7 km 312 (Vedia)",
        "address": "Ruta Nacional 7 km 312, Vedia",
        "lat": -34.495,
        "lng": -61.545,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 7",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn7_dalvear_395",
        "name": "RN 7 km 395 (Diego de Alvear)",
        "address": "Ruta Nacional 7 km 395, Diego de Alvear, Santa Fe",
        "lat": -34.375,
        "lng": -62.135,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 7",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn7_rufino_425",
        "name": "RN 7 km 425 (Rufino)",
        "address": "Ruta Nacional 7 km 425, Rufino, Santa Fe",
        "lat": -34.275,
        "lng": -62.705,
        "limit": 60,
        "desc": "Fotomulta travesía urbana Rufino",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn7_laboulaye_490",
        "name": "RN 7 km 490 (Laboulaye)",
        "address": "Ruta Nacional 7 km 490, Laboulaye, Córdoba",
        "lat": -34.135,
        "lng": -63.395,
        "limit": 60,
        "desc": "Fotomulta travesía urbana RN 7",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn12_zarate_85",
        "name": "RN 12 km 85 (Zárate / Acceso Zárate Brazo Largo)",
        "address": "Ruta Nacional 12 km 85, Zárate, Bs As",
        "lat": -34.095,
        "lng": -59.015,
        "limit": 80,
        "desc": "Fotomulta acceso Complejo Zárate Brazo Largo",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn12_blargo_115",
        "name": "RN 12 km 115 (Brazo Largo)",
        "address": "Ruta Nacional 12 km 115, Brazo Largo, Entre Ríos",
        "lat": -33.865,
        "lng": -58.855,
        "limit": 100,
        "desc": "Fotomulta autovía RN 12",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn12_ceibas_158",
        "name": "RN 12 km 158 (Ceibas)",
        "address": "Ruta Nacional 12 km 158, Ceibas, Entre Ríos",
        "lat": -33.515,
        "lng": -58.745,
        "limit": 80,
        "desc": "Fotomulta empalme RN 12 y RN 14",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn14_ceibas_0",
        "name": "RN 14 km 0 (Empalme Ceibas)",
        "address": "Autovía RN 14 km 0, Ceibas, Entre Ríos",
        "lat": -33.485,
        "lng": -58.725,
        "limit": 120,
        "desc": "Fotomulta autovía RN 14",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn14_gualeguaychu_58",
        "name": "RN 14 km 58 (Gualeguaychú)",
        "address": "Autovía RN 14 km 58, Gualeguaychú, Entre Ríos",
        "lat": -33.025,
        "lng": -58.545,
        "limit": 100,
        "desc": "Fotomulta autovía RN 14",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn14_curuguay_125",
        "name": "RN 14 km 125 (Concepción del Uruguay)",
        "address": "Autovía RN 14 km 125, Concepción del Uruguay, Entre Ríos",
        "lat": -32.485,
        "lng": -58.295,
        "limit": 100,
        "desc": "Fotomulta autovía RN 14",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn14_colon_152",
        "name": "RN 14 km 152 (Colón)",
        "address": "Autovía RN 14 km 152, Colón, Entre Ríos",
        "lat": -32.225,
        "lng": -58.225,
        "limit": 100,
        "desc": "Fotomulta autovía RN 14",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn14_concordia_250",
        "name": "RN 14 km 250 (Concordia)",
        "address": "Autovía RN 14 km 250, Concordia, Entre Ríos",
        "lat": -31.395,
        "lng": -58.055,
        "limit": 100,
        "desc": "Fotomulta autovía RN 14",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn14_chajari_325",
        "name": "RN 14 km 325 (Chajarí)",
        "address": "Autovía RN 14 km 325, Chajarí, Entre Ríos",
        "lat": -30.745,
        "lng": -57.985,
        "limit": 100,
        "desc": "Fotomulta autovía RN 14",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn168_laguardia_3",
        "name": "RN 168 km 3 (La Guardia / Santa Fe)",
        "address": "Ruta Nacional 168 km 3, La Guardia, Santa Fe",
        "lat": -31.645,
        "lng": -60.625,
        "limit": 80,
        "desc": "Fotomulta autovía RN 168",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn168_peaje_11",
        "name": "RN 168 km 11 (Peaje Túnel Subfluvial)",
        "address": "Ruta Nacional 168 km 11, Peaje Túnel, Santa Fe",
        "lat": -31.698,
        "lng": -60.525,
        "limit": 60,
        "desc": "Fotomulta cabina peaje Túnel Subfluvial",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn168_tunel_14",
        "name": "RN 168 Boca Paraná (Túnel Subfluvial)",
        "address": "Ruta Nacional 168 cabecera Túnel Subfluvial, Paraná",
        "lat": -31.712,
        "lng": -60.498,
        "limit": 60,
        "desc": "Fotomulta acceso Túnel Subfluvial Paraná",
        "type": "speed_camera"
    },
    {
        "id": "radar_rn168_parana_18",
        "name": "RN 168 Acceso Paraná",
        "address": "Ruta Nacional 168 ingreso Paraná, Entre Ríos",
        "lat": -31.725,
        "lng": -60.485,
        "limit": 60,
        "desc": "Fotomulta acceso ciudad de Paraná",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_gbaigorria_0",
        "name": "AP 01 km 0 (Granadero Baigorria)",
        "address": "Autopista Rosario - Santa Fe km 0, Granadero Baigorria",
        "lat": -32.868,
        "lng": -60.718,
        "limit": 80,
        "desc": "Fotomulta ingreso Autopista Rosario - Santa Fe",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_slorenzo_14",
        "name": "AP 01 km 14 (San Lorenzo Sur)",
        "address": "Autopista Rosario - Santa Fe km 14, San Lorenzo",
        "lat": -32.765,
        "lng": -60.755,
        "limit": 130,
        "desc": "Fotomulta autopista AP 01",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_slorenzo_22",
        "name": "AP 01 km 22 (San Lorenzo Norte)",
        "address": "Autopista Rosario - Santa Fe km 22, San Lorenzo",
        "lat": -32.705,
        "lng": -60.765,
        "limit": 130,
        "desc": "Fotomulta autopista AP 01",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_timbues_28",
        "name": "AP 01 km 28 (Timbúes)",
        "address": "Autopista Rosario - Santa Fe km 28, Timbúes",
        "lat": -32.655,
        "lng": -60.785,
        "limit": 130,
        "desc": "Fotomulta autopista AP 01",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_monje_58",
        "name": "AP 01 km 58 (Monje)",
        "address": "Autopista Rosario - Santa Fe km 58, Monje",
        "lat": -32.415,
        "lng": -60.915,
        "limit": 130,
        "desc": "Fotomulta autopista AP 01",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_arocena_90",
        "name": "AP 01 km 90 (Arocena)",
        "address": "Autopista Rosario - Santa Fe km 90, Arocena",
        "lat": -32.145,
        "lng": -60.985,
        "limit": 130,
        "desc": "Fotomulta autopista AP 01",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_coronda_110",
        "name": "AP 01 km 110 (Coronda)",
        "address": "Autopista Rosario - Santa Fe km 110, Coronda",
        "lat": -31.985,
        "lng": -60.955,
        "limit": 130,
        "desc": "Fotomulta autopista AP 01",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_sauceviejo_141",
        "name": "AP 01 km 141 (Sauce Viejo)",
        "address": "Autopista Rosario - Santa Fe km 141, Sauce Viejo",
        "lat": -31.745,
        "lng": -60.815,
        "limit": 100,
        "desc": "Fotomulta autopista AP 01",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_stotome_153",
        "name": "AP 01 km 153 (Santo Tomé)",
        "address": "Autopista Rosario - Santa Fe km 153, Santo Tomé",
        "lat": -31.668,
        "lng": -60.755,
        "limit": 100,
        "desc": "Fotomulta autopista AP 01",
        "type": "speed_camera"
    },
    {
        "id": "radar_ap01_stafe_156",
        "name": "AP 01 km 156 (Acceso Santa Fe Capital)",
        "address": "Autopista Rosario - Santa Fe km 156, Santa Fe Capital",
        "lat": -31.645,
        "lng": -60.725,
        "limit": 60,
        "desc": "Fotomulta acceso Santa Fe Capital",
        "type": "speed_camera"
    }
];

    /**
     * Calcula la distancia geodésica en metros entre dos coordenadas (Haversine).
     */
    function _getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Radio terrestre en metros
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
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
        if (!_audioCtx) {
            const AudioClass = window.AudioContext || window.webkitAudioContext;
            if (AudioClass) {
                _audioCtx = new AudioClass();
            }
        }
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
     * @param {number} distanceMeters - Distancia aproximada (120, 90, 60 o 30)
     */
    function _playProximityBeep(distanceMeters) {
        if (!_isVoiceEnabled) return;
        try {
            const ctx = _getAudioContext();
            if (!ctx) return;

            const playTone = () => {
                try {
                    const now = ctx.currentTime;
                    const baseVol = Math.max(0.1, Math.min(1.0, (_alertVolumePercent || 85) / 100.0));

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
     * Tono armónico agradable cuando se supera la cámara con éxito.
     */
    function _playPassedChime() {
        if (!_isVoiceEnabled) return;
        try {
            const ctx = _getAudioContext();
            if (!ctx) return;

            const playPassed = () => {
                try {
                    const now = ctx.currentTime;
                    const baseVol = Math.max(0.1, Math.min(1.0, (_alertVolumePercent || 85) / 100.0));
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
     * Si no hay sensor nativo o la velocidad es baja, calcula el vector contra un punto previo (10m - 75m).
     */
    function _getReliableTrajectoryHeading(currentLat, currentLng, rawBearing, speedKmh) {
        const now = Date.now();
        _gpsHistory.push({ lat: currentLat, lng: currentLng, time: now, speed: speedKmh });
        while (_gpsHistory.length > 8 || (_gpsHistory.length > 1 && (now - _gpsHistory[0].time) > 15000)) {
            _gpsHistory.shift();
        }

        // 1. Si el sensor o GPS nativo reporta rumbo válido y velocidad de marcha
        if (typeof rawBearing === 'number' && !isNaN(rawBearing) && rawBearing > 0 && speedKmh !== null && speedKmh >= 8) {
            return rawBearing;
        }

        // 2. Vector geodésico entre el punto actual y un punto anterior con separación suficiente (10m a 75m)
        for (let i = _gpsHistory.length - 2; i >= 0; i--) {
            const prev = _gpsHistory[i];
            const dist = _getDistance(prev.lat, prev.lng, currentLat, currentLng);
            const timeDiff = (now - prev.time) / 1000;
            if (dist >= 10 && dist <= 75 && timeDiff <= 15) {
                return _calculateBearing(prev.lat, prev.lng, currentLat, currentLng);
            }
        }

        return null;
    }

    /**
     * Verifica con rigor geométrico si el vehículo circula por la misma calle que la cámara.
     * Descarta calles paralelas (en Rosario siempre separadas por 90m a 125m) y perpendiculares.
     * @param {number} carLat
     * @param {number} carLng
     * @param {number|null} carHeading - Rumbo de trayectoria confirmado
     * @param {number} camLat
     * @param {number} camLng
     * @param {number} distance - Distancia en metros
     * @param {number} [speedLimit=40]
     * @returns {boolean}
     */
    function _isCorridorAligned(carLat, carLng, carHeading, camLat, camLng, distance, speedLimit = 40) {
        // En cuadrícula urbana, si el vehículo no se desplaza o no hay rumbo seguro:
        // A más de 35 metros NUNCA alertar para evitar falsos positivos de calles paralelas
        if (carHeading === null || isNaN(carHeading)) {
            return distance <= 35;
        }

        const targetBearing = _calculateBearing(carLat, carLng, camLat, camLng);
        const angleDiff = _getAngleDifference(carHeading, targetBearing);

        // 1. Cono frontal hacia la cámara:
        // En una paralela a 100m, a 200m el desvío es de 26.5°. Exigir cono estrecho:
        const maxAngle = (speedLimit >= 70) ? 18 : 22;
        if (angleDiff > maxAngle) {
            return false;
        }

        // 2. Corredor transversal (Cross-track distance):
        // Distancia perpendicular lateral desde la trayectoria del vehículo hasta la cámara.
        // En Rosario, las calles paralelas están a >= 90m. En la misma calle la cámara está a <= 15m.
        // Tolerancia máxima: 20m para calles urbanas, 28m para autopistas.
        const crossTrack = distance * Math.sin(angleDiff * (Math.PI / 180));
        const maxLateral = (speedLimit >= 70) ? 28 : 20;

        if (crossTrack > maxLateral) {
            return false; // Calle paralela descartada
        }

        return true;
    }

    /**
     * Envia texto a síntesis de voz nativa / Web Speech de forma confiable.
     */
    function _speakTextDirect(text) {
        let spoken = false;
        if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
            spoken = AndroidServices.speak(text);
        }
        if (!spoken && window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
            try { window.NativeServiceBridge.speak(text); spoken = true; } catch (_) {}
        }
        if (!spoken && typeof window !== 'undefined' && window.speechSynthesis) {
            try {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                window.speechSynthesis.cancel();
                const utter = new SpeechSynthesisUtterance(text);
                utter.lang = 'es-AR';
                utter.rate = 1.05;
                utter.pitch = 1.0;
                utter.volume = Math.max(0.1, Math.min(1.0, _alertVolumePercent / 100.0));

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
     * Estructura exacta: "(nombre chofer) foto multa a 300 metros, máxima 60"
     */
    function _speakRadarConcise(target, distanceStage) {
        if (!_isVoiceEnabled) return;
        const firstName = _getDriverFirstName();
        const prefix = firstName ? `${firstName}, ` : '';
        const limit = target.limit || 60;
        const distText = distanceStage === 150 ? '150' : '300';
        const text = `${prefix}foto multa a ${distText} metros, máxima ${limit}.`;

        console.log(`🔊 [COPILOTO] Locución concisa (${distText}m): "${text}"`);
        _speakTextDirect(text);
    }

    /**
     * Locución para alertas de tránsito en tiempo real (policía, operativos, accidentes).
     */
    function _speakWarning(target, dist, currentSpeed) {
        if (!_isVoiceEnabled) return;

        const distRound = Math.round(dist / 10) * 10;
        const nameClean = (target.name || '').replace(/\s+y\s+/gi, ' esquina ');
        const firstName = _getDriverFirstName();
        const prefix = firstName ? `${firstName}, ` : '';

        let text = '';
        if (target.isTrafficAlert) {
            const distPhrase = (distRound <= 30) ? 'en el lugar.' : `a ${distRound} metros.`;
            text = `${prefix}atención, ${nameClean} ${distPhrase}`;
            if (target.desc && target.desc !== target.name && target.desc.length < 80) {
                text += ` ${target.desc}`;
            }
        } else {
            text = `${prefix}foto multa a ${distRound} metros, máxima ${target.limit || 60}.`;
        }

        _speakTextDirect(text);
    }

    /**
     * Inyecta los estilos CSS necesarios para el HUD de alta visibilidad.
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
                top: 10px;
                left: 50%;
                transform: translateX(-50%) translateY(-120%);
                width: calc(100% - 24px);
                max-width: 440px;
                z-index: 9999999;
                box-sizing: border-box;
                transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease;
                opacity: 0;
                pointer-events: auto;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            #radarCopilotHUD.hud-active {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
            }
            .copilot-hud-card {
                position: relative;
                background: linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(26, 17, 24, 0.98) 100%);
                border: 2px solid #ef4444;
                border-radius: 16px;
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.75), 0 0 20px rgba(239, 68, 68, 0.35);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                padding: 10px 12px;
                display: flex;
                align-items: center;
                gap: 10px;
                color: #ffffff;
            }
            .copilot-hud-card.hud-speeding {
                border-color: #ef4444;
                animation: copilotBorderPulse 1.2s infinite alternate;
            }
            @keyframes copilotBorderPulse {
                0% { box-shadow: 0 0 15px rgba(239, 68, 68, 0.4); }
                100% { box-shadow: 0 0 35px rgba(239, 68, 68, 0.9), 0 0 0 4px rgba(239, 68, 68, 0.3); }
            }
            .copilot-traffic-sign {
                flex-shrink: 0;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                background: #ffffff;
                border: 4px solid #dc2626;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
            }
            .copilot-traffic-sign .speed-num {
                font-size: 21px;
                font-weight: 900;
                line-height: 1;
                color: #0f172a;
                letter-spacing: -0.5px;
            }
            .copilot-traffic-sign .speed-unit {
                font-size: 7px;
                font-weight: 900;
                color: #dc2626;
                margin-top: 1px;
            }
            .copilot-hud-main {
                flex: 1;
                min-width: 0;
            }
            .copilot-hud-pill-row {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 3px;
                flex-wrap: wrap;
            }
            .copilot-hud-pill-badge {
                background: #dc2626;
                color: #ffffff;
                font-size: 10px;
                font-weight: 900;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                padding: 2px 7px;
                border-radius: 12px;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .copilot-hud-pill-dist {
                background: rgba(56, 189, 248, 0.15);
                color: #38bdf8;
                font-size: 11px;
                font-weight: 800;
                padding: 2px 8px;
                border-radius: 12px;
                border: 1px solid rgba(56, 189, 248, 0.4);
            }
            .copilot-hud-name {
                font-size: 15px;
                font-weight: 800;
                color: #f8fafc;
                line-height: 1.25;
                margin: 2px 0 3px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .copilot-hud-desc {
                font-size: 11px;
                color: #94a3b8;
                margin-bottom: 4px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .copilot-hud-speed-gauge {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                font-weight: 800;
                padding: 3px 8px;
                border-radius: 8px;
            }
            .copilot-speed-over {
                background: rgba(239, 68, 68, 0.25);
                color: #fca5a5;
                border: 1px solid rgba(239, 68, 68, 0.5);
            }
            .copilot-speed-ok {
                background: rgba(16, 185, 129, 0.2);
                color: #6ee7b7;
                border: 1px solid rgba(16, 185, 129, 0.4);
            }
            .copilot-speed-neutral {
                background: rgba(148, 163, 184, 0.15);
                color: #cbd5e1;
            }
            .copilot-hud-actions {
                display: flex;
                flex-direction: column;
                gap: 6px;
                align-self: center;
            }
            .copilot-hud-btn {
                background: rgba(255, 255, 255, 0.12);
                border: 1px solid rgba(255, 255, 255, 0.2);
                color: #ffffff;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 14px;
                transition: background 0.15s, transform 0.1s;
            }
            .copilot-hud-btn:active {
                transform: scale(0.92);
            }
            .copilot-hud-btn.is-muted {
                background: rgba(239, 68, 68, 0.45) !important;
                border-color: #ef4444 !important;
                box-shadow: 0 0 10px rgba(239, 68, 68, 0.6);
            }
            .copilot-hud-bottom-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                flex-wrap: wrap;
                margin-top: 3px;
            }
            .copilot-hud-vol-control {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                background: rgba(0, 0, 0, 0.45);
                padding: 2px 7px;
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.15);
            }
            .copilot-hud-vol-icon {
                font-size: 11px;
                cursor: pointer;
                user-select: none;
            }
            .copilot-hud-slider {
                width: 58px;
                height: 4px;
                accent-color: #38bdf8;
                cursor: pointer;
                outline: none;
                margin: 0;
            }
            .copilot-hud-vol-label {
                font-size: 10px;
                font-weight: 800;
                color: #38bdf8;
                min-width: 26px;
                text-align: right;
                user-select: none;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Muestra o actualiza el banner HUD de gran visibilidad en la pantalla.
     * Soporta tanto cámaras fijas (Fotomultas) como alertas de tránsito en vivo.
     */
    function _showRadarHUD(target, dist, currentSpeed) {
        if (typeof document === 'undefined') return;
        _ensureHUDStyles();

        let hud = document.getElementById('radarCopilotHUD');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'radarCopilotHUD';
            hud.setAttribute('role', 'alert');
            hud.setAttribute('aria-live', 'assertive');
            document.body.appendChild(hud);
        }

        const isTraffic = !!target.isTrafficAlert;
        const isSpeeding = (!isTraffic && target.limit && currentSpeed !== null && currentSpeed > target.limit);
        const distMeters = Math.round(dist);
        let distLabel = `📍 A ${distMeters}m`;
        if (distMeters <= PASSING_DISTANCE_METERS) {
            distLabel = isTraffic ? '📍 ¡EN EL LUGAR!' : '📍 ¡PASANDO CÁMARA!';
        }

        let speedBadgeHtml = '';
        if (!isTraffic) {
            if (currentSpeed !== null && currentSpeed > 0) {
                const speedKmh = Math.round(currentSpeed);
                if (isSpeeding) {
                    speedBadgeHtml = `<div class="copilot-hud-speed-gauge copilot-speed-over">⚠️ EXCESO: ${speedKmh} km/h (MÁX ${target.limit})</div>`;
                } else {
                    speedBadgeHtml = `<div class="copilot-hud-speed-gauge copilot-speed-ok">✅ Velocidad OK: ${speedKmh} km/h</div>`;
                }
            } else {
                speedBadgeHtml = `<div class="copilot-hud-speed-gauge copilot-speed-neutral">⏱️ Respete el límite indicado (${target.limit} km/h)</div>`;
            }
        } else {
            speedBadgeHtml = `<div class="copilot-hud-speed-gauge copilot-speed-neutral">⚠️ Conduzca con precaución en la zona</div>`;
        }

        // Icono y distintivo
        let signHtml = '';
        let badgeHtml = '';
        let cardBorderColor = '#ef4444';

        if (isTraffic) {
            const alertIcons = {
                police:     { icon: '🚔', badge: 'POLICÍA', color: '#3b82f6' },
                checkpoint: { icon: '🚧', badge: 'CONTROL', color: '#2563eb' },
                municipal:  { icon: '🦊', badge: 'INSPECTOR', color: '#10b981' },
                radar:      { icon: '📷', badge: 'RADAR MÓVIL', color: '#f59e0b' },
                helicopter: { icon: '🚁', badge: 'HELICÓPTERO', color: '#10b981' },
                ambulance:  { icon: '🚑', badge: 'AMBULANCIA', color: '#ef4444' },
                firetruck:  { icon: '🚒', badge: 'BOMBEROS', color: '#b91c1c' },
                accident:   { icon: '💥', badge: 'ACCIDENTE', color: '#ef4444' },
                traffic:    { icon: '🚗', badge: 'TRÁNSITO', color: '#f97316' },
                warning:    { icon: '⚠️', badge: 'ALERTA', color: '#f59e0b' }
            };
            const meta = alertIcons[target.type] || alertIcons.warning;
            cardBorderColor = meta.color;
            signHtml = `
                <div class="copilot-traffic-sign" style="border-color:${meta.color}; background:#0f172a; color:#fff;">
                    <span style="font-size:24px;">${meta.icon}</span>
                    <span class="speed-unit" style="color:${meta.color}; font-size:7px;">ALERTA</span>
                </div>
            `;
            badgeHtml = `<span class="copilot-hud-pill-badge" style="background:${meta.color};">${meta.icon} ${meta.badge}</span>`;
        } else {
            signHtml = `
                <div class="copilot-traffic-sign">
                    <span class="speed-num">${target.limit}</span>
                    <span class="speed-unit">MÁX KM/H</span>
                </div>
            `;
            badgeHtml = `<span class="copilot-hud-pill-badge">📷 FOTOMULTA</span>`;
        }

        const cardClass = isSpeeding ? 'copilot-hud-card hud-speeding' : 'copilot-hud-card';

        hud.innerHTML = `
            <div class="${cardClass}" style="border-color:${cardBorderColor};">
                ${signHtml}
                <div class="copilot-hud-main">
                    <div class="copilot-hud-pill-row">
                        ${badgeHtml}
                        <span class="copilot-hud-pill-dist" id="copilotHudDist">${distLabel}</span>
                    </div>
                    <div class="copilot-hud-name" title="${target.name}">${target.name}</div>
                    <div class="copilot-hud-desc">${target.desc || (isTraffic ? 'Reporte activo en la vía' : 'Videocontrol municipal de tránsito')}</div>
                    <div class="copilot-hud-bottom-row">
                        ${speedBadgeHtml}
                        <div class="copilot-hud-vol-control" title="Volumen independiente de la voz">
                            <span class="copilot-hud-vol-icon" id="copilotHudVolIcon">${_isVoiceEnabled ? '🔊' : '🔇'}</span>
                            <input type="range" min="10" max="100" step="5" value="${_alertVolumePercent}" id="copilotHudVolSlider" class="copilot-hud-slider" title="Ajustar volumen" />
                            <span class="copilot-hud-vol-label" id="copilotHudVolLabel">${_alertVolumePercent}%</span>
                        </div>
                    </div>
                </div>
                <div class="copilot-hud-actions">
                    <button class="copilot-hud-btn ${_isVoiceEnabled ? '' : 'is-muted'}" id="copilotVoiceToggleBtn" title="Silenciar / Activar voz">
                        ${_isVoiceEnabled ? '🔊' : '🔇'}
                    </button>
                    <button class="copilot-hud-btn" id="copilotCloseBtn" title="Cerrar aviso y silenciar">✕</button>
                </div>
            </div>
        `;

        // Eventos de botones
        const closeBtn = document.getElementById('copilotCloseBtn');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                _stopAllAudio();
                _hideRadarHUD();
            };
        }
        const voiceBtn = document.getElementById('copilotVoiceToggleBtn');
        if (voiceBtn) {
            voiceBtn.onclick = (e) => {
                e.stopPropagation();
                _isVoiceEnabled = !_isVoiceEnabled;
                localStorage.setItem('radarVoice', _isVoiceEnabled ? 'on' : 'off');
                voiceBtn.textContent = _isVoiceEnabled ? '🔊' : '🔇';
                voiceBtn.classList.toggle('is-muted', !_isVoiceEnabled);
                
                const volIcon = document.getElementById('copilotHudVolIcon');
                if (volIcon) volIcon.textContent = _isVoiceEnabled ? '🔊' : '🔇';

                if (!_isVoiceEnabled) {
                    _stopAllAudio();
                    if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setVoiceMuted === 'function') {
                        AndroidServices.setVoiceMuted(true);
                    }
                    if (window.NativeServiceBridge && typeof window.NativeServiceBridge.setVoiceMuted === 'function') {
                        try { window.NativeServiceBridge.setVoiceMuted(true); } catch (_) {}
                    }
                    if (typeof Components !== 'undefined' && Components.showToast) {
                        Components.showToast('🔇 Alerta silenciada', 'info');
                    }
                } else {
                    if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setVoiceMuted === 'function') {
                        AndroidServices.setVoiceMuted(false);
                    }
                    if (window.NativeServiceBridge && typeof window.NativeServiceBridge.setVoiceMuted === 'function') {
                        try { window.NativeServiceBridge.setVoiceMuted(false); } catch (_) {}
                    }
                    if (typeof Components !== 'undefined' && Components.showToast) {
                        Components.showToast('🔊 Alertas de voz activadas', 'success');
                    }
                }
            };
        }

        const volSlider = document.getElementById('copilotHudVolSlider');
        if (volSlider) {
            volSlider.oninput = (e) => {
                e.stopPropagation();
                const newVol = parseInt(volSlider.value, 10);
                _setAlertVolume(newVol);
                const label = document.getElementById('copilotHudVolLabel');
                if (label) label.textContent = newVol + '%';
            };
            volSlider.onclick = (e) => e.stopPropagation();
            volSlider.ontouchstart = (e) => e.stopPropagation();
        }

        const volIconBtn = document.getElementById('copilotHudVolIcon');
        if (volIconBtn) {
            volIconBtn.onclick = (e) => {
                e.stopPropagation();
                if (voiceBtn) voiceBtn.click();
            };
        }

        // Activar transición visible
        const raf = (typeof window !== 'undefined' && window.requestAnimationFrame) ? window.requestAnimationFrame : setTimeout;
        raf(() => {
            if (hud && hud.classList) hud.classList.add('hud-active');
        }, 16);

        // Reset timer de cierre automático por seguridad (25 segundos)
        if (_hudTimer) clearTimeout(_hudTimer);
        _hudTimer = setTimeout(() => {
            _hideRadarHUD();
        }, 25000);
    }

    /**
     * Oculta el banner HUD con animación fluida.
     */
    function _hideRadarHUD() {
        const hud = document.getElementById('radarCopilotHUD');
        if (hud) {
            hud.classList.remove('hud-active');
            setTimeout(() => {
                if (hud && !hud.classList.contains('hud-active')) {
                    hud.remove();
                }
            }, 450);
        }
        if (_hudTimer) {
            clearTimeout(_hudTimer);
            _hudTimer = null;
        }
    }

    /**
     * Procesa la velocidad provista o la calcula geodésicamente.
     */
    function _calculateSpeed(lat, lng, rawSpeed) {
        // 1. Si el GPS provee velocidad directa
        if (typeof rawSpeed === 'number' && !isNaN(rawSpeed) && rawSpeed >= 0) {
            return rawSpeed > 45 ? rawSpeed : (rawSpeed * 3.6);
        }

        // 2. Si no hay velocidad, estimarla por delta de coordenadas y tiempo
        const now = Date.now();
        if (_lastPosition && _lastPosition.time) {
            const timeDeltaSec = (now - _lastPosition.time) / 1000;
            if (timeDeltaSec >= 2 && timeDeltaSec <= 35) {
                const distMeters = _getDistance(_lastPosition.lat, _lastPosition.lng, lat, lng);
                const speedKmh = (distMeters / timeDeltaSec) * 3.6;
                if (speedKmh <= 180) {
                    return speedKmh;
                }
            }
        }
        return null;
    }

    /**
     * Chequea la posición actual respecto a radares fijos Y alertas de tránsito en tiempo real.
     * Incorpora filtro direccional de carril/calle (elimina falsos positivos de calles paralelas),
     * aviso conciso a 300m, repetición a 150m y pitidos ascendentes cada 30m.
     * @param {number} currentLat - Latitud WGS84
     * @param {number} currentLng - Longitud WGS84
     * @param {number} [rawSpeed] - Velocidad actual en m/s o km/h
     * @param {number} [rawBearing] - Rumbo/dirección actual en grados (0-360)
     */
    function checkProximity(currentLat, currentLng, rawSpeed = null, rawBearing = null) {
        if (!_isEnabled) return;
        if (!currentLat || !currentLng || isNaN(currentLat) || isNaN(currentLng)) return;

        const now = Date.now();
        const currentSpeed = _calculateSpeed(currentLat, currentLng, rawSpeed);

        // Determinar rumbo (bearing) confiable de trayectoria vehicular
        const reliableBearing = _getReliableTrajectoryHeading(currentLat, currentLng, rawBearing, currentSpeed);

        // Guardar última posición
        _lastPosition = { lat: currentLat, lng: currentLng, time: now, speed: currentSpeed, bearing: reliableBearing };

        // --- 1. PROCESAR RADAR ACTIVO EN SEGUIMIENTO ---
        if (_activeApproach) {
            const radar = _activeApproach.target;
            const dist = _getDistance(currentLat, currentLng, radar.lat, radar.lng);

            // A) Superó la cámara (pasó a menos de 18m o la distancia aumentó tras estar muy cerca)
            if (dist <= 18 || (_activeApproach.minDistance < 35 && dist > _activeApproach.minDistance + 10)) {
                console.log(`📡 [COPILOTO] 🏁 Cámara superada: ${radar.name}`);
                _playPassedChime();
                _lastAlertTime[radar.id] = now;
                _hideRadarHUD();
                _activeApproach = null;
                return;
            }

            // B) Vehículo dobló, se alejó o se desvió de la calle (cancelar inmediatamente sin seguir pitando)
            const stillAligned = _isCorridorAligned(currentLat, currentLng, reliableBearing, radar.lat, radar.lng, dist, radar.limit);
            const isMovingAway = dist > _activeApproach.lastDistance + 9;

            if (isMovingAway || (!stillAligned && dist > 35)) {
                console.log(`📡 [COPILOTO] ↪️ Vehículo dobló o se alejó, cancelando aproximación a: ${radar.name}`);
                _hideRadarHUD();
                _activeApproach = null;
                return;
            }

            // Actualizar distancias
            if (dist < _activeApproach.minDistance) {
                _activeApproach.minDistance = dist;
            }
            _activeApproach.lastDistance = dist;

            // Actualizar HUD con distancia viva
            _showRadarHUD(radar, dist, currentSpeed);

            // C) ETAPAS DE APROXIMACIÓN:
            // Etapa 150 metros (Repetición concisa de voz)
            if (_activeApproach.stage === 300 && dist <= 165 && dist >= 130) {
                _activeApproach.stage = 150;
                _speakRadarConcise(radar, 150);
                return;
            }

            // Pitidos cada 30 metros (120m, 90m, 60m, 30m) con frecuencia y volumen ascendente
            if (_activeApproach.stage <= 150 && dist <= 125 && dist > 98 && _activeApproach.stage !== 120) {
                _activeApproach.stage = 120;
                _playProximityBeep(120);
                return;
            }
            if (_activeApproach.stage <= 120 && dist <= 98 && dist > 68 && _activeApproach.stage !== 90) {
                _activeApproach.stage = 90;
                _playProximityBeep(90);
                return;
            }
            if (_activeApproach.stage <= 90 && dist <= 68 && dist > 38 && _activeApproach.stage !== 60) {
                _activeApproach.stage = 60;
                _playProximityBeep(60);
                return;
            }
            if (_activeApproach.stage <= 60 && dist <= 38 && dist > 18 && _activeApproach.stage !== 30) {
                _activeApproach.stage = 30;
                _playProximityBeep(30);
                return;
            }

            return;
        }

        // --- 2. BUSCAR NUEVA FOTOMULTA OFICIAL DENTRO DE 315 METROS ---
        // Filtrar candidatos dentro del radio que estén estrictamente alineados con la calle de circulación
        let bestRadar = null;
        let bestRadarDist = Infinity;

        for (const radar of STATIC_RADARS) {
            const dist = _getDistance(currentLat, currentLng, radar.lat, radar.lng);
            if (dist <= WARNING_DISTANCE_METERS) {
                const lastAlert = _lastAlertTime[radar.id] || 0;
                if (now - lastAlert > COOLDOWN_MS) {
                    if (_isCorridorAligned(currentLat, currentLng, reliableBearing, radar.lat, radar.lng, dist, radar.limit)) {
                        if (dist < bestRadarDist) {
                            bestRadarDist = dist;
                            bestRadar = radar;
                        }
                    }
                }
            }
        }

        if (bestRadar) {
            _activeApproach = {
                radarId: bestRadar.id,
                target: bestRadar,
                stage: 300,
                minDistance: bestRadarDist,
                lastDistance: bestRadarDist,
                startedAt: now
            };

            _showRadarHUD(bestRadar, bestRadarDist, currentSpeed);
            _triggerVibration(false);
            // Locución concisa y personalizada a 300m:
            _speakRadarConcise(bestRadar, 300);
            return;
        }

        // B) Alertas de tránsito en tiempo real (policía, operativos, accidentes)
        let nearestTraffic = null;
        let minTrafficDist = Infinity;
        for (const tr of _liveTrafficAlerts) {
            const dist = _getDistance(currentLat, currentLng, tr.lat, tr.lng);
            if (dist < minTrafficDist) {
                minTrafficDist = dist;
                nearestTraffic = tr;
            }
        }

        if (nearestTraffic) {
            // Si el chofer se aleja a más de 1000m, resetear para permitir un nuevo aviso si vuelve en otro viaje
            if (minTrafficDist > 1000 && _warnedTrafficApproaches.has(nearestTraffic.id)) {
                _warnedTrafficApproaches.delete(nearestTraffic.id);
            }

            if (minTrafficDist <= TRAFFIC_WARNING_METERS) {
                // 1. Si está detenido o a paso de hombre (< 7 km/h) y muy cerca (< 70m), NO disparar voz en bucle
                const isStationaryAtAlert = ((currentSpeed === null || currentSpeed < 7) && minTrafficDist < 70);

                // 2. Si el conductor actual es el creador de la alerta, silenciarla
                const driverFirst = _getDriverFirstName();
                const isOwnAlert = nearestTraffic.authorName && driverFirst &&
                    nearestTraffic.authorName.trim().toLowerCase() === driverFirst.trim().toLowerCase();

                // 3. Ya advertido en esta aproximación o en cooldown de 30 min
                const alreadyWarned = _warnedTrafficApproaches.has(nearestTraffic.id);
                const lastAlert = _lastAlertTime[nearestTraffic.id] || 0;
                const inCooldown = (now - lastAlert < 30 * 60 * 1000); // 30 min cooldown

                if (!isStationaryAtAlert && !isOwnAlert && !alreadyWarned && !inCooldown) {
                    _warnedTrafficApproaches.add(nearestTraffic.id);
                    _lastAlertTime[nearestTraffic.id] = now;
                    _showRadarHUD(nearestTraffic, minTrafficDist, currentSpeed);
                    _playWarningChime(false);
                    _speakWarning(nearestTraffic, minTrafficDist, currentSpeed);
                    _triggerVibration(false);
                } else if (!isOwnAlert) {
                    // Actualizar el HUD visual sin repetir la locución de voz
                    _showRadarHUD(nearestTraffic, minTrafficDist, currentSpeed);
                }
            }
        }
    }

    /**
     * Prueba inmediata de alerta (HUD, Locución concisa y Pitidos de proximidad).
     * @param {'fotomulta'|'transito'|string} typeOrRadarId
     */
    function testAlert(typeOrRadarId = 'fotomulta') {
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
            testSpeed = target.limit || 60;

            console.log('📡 [COPILOTO] Ejecutando TEST conciso para:', target.name);

            _showRadarHUD(target, testDist, testSpeed);
            _speakRadarConcise(target, 300);
            _triggerVibration(false);

            // Simulación de pitidos ascendentes cada 30 metros de muestra
            setTimeout(() => _playProximityBeep(120), 2200);
            setTimeout(() => _playProximityBeep(90), 3200);
            setTimeout(() => _playProximityBeep(60), 4200);
            setTimeout(() => _playProximityBeep(30), 5200);
            setTimeout(() => _playPassedChime(), 6400);
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

    function dismissHUD() {
        _stopAllAudio();
        _hideRadarHUD();
    }

    return {
        checkProximity,
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
        dismissHUD,
        testAlert
    };
})();
