/* ==========================================================================
   FleetAdmin Pro — Copiloto GPS de Radares y Fotomultas (v2.0 Rosario)
   Base de datos oficial de 80 cámaras de videocontrol + APSV Circunvalación
   HUD visual prominente para choferes, doble chime Web Audio y voz nativa
   ========================================================================== */

const CopilotModule = (() => {
    // Configuración de proximidad y alertas
    const WARNING_DISTANCE_METERS = 480;  // Radio de alerta temprana (480 metros)
    const PASSING_DISTANCE_METERS = 50;   // Distancia mínima para considerar cámara superada
    const COOLDOWN_MS = 3 * 60 * 1000;    // 3 minutos de enfriamiento por cámara

    // Estado del módulo
    let _isEnabled = localStorage.getItem('copilotRadar') !== 'off';
    let _isVoiceEnabled = localStorage.getItem('radarVoice') !== 'off';
    let _lastAlertTime = {};              // { radarId: timestamp }
    let _activeApproach = null;           // { radarId, minDistance, startedAt }
    let _lastPosition = null;             // { lat, lng, time, speed }
    let _audioCtx = null;
    let _hudTimer = null;

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
     * @param {boolean} isSpeeding - Si el conductor supera la velocidad máxima
     */
    function _playWarningChime(isSpeeding = false) {
        if (!_isVoiceEnabled) return;
        try {
            const ctx = _getAudioContext();
            if (!ctx) return;

            const now = ctx.currentTime;
            const masterGain = ctx.createGain();
            masterGain.gain.setValueAtTime(0.45, now);
            masterGain.connect(ctx.destination);

            if (isSpeeding) {
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
                // Chime de navegación agradable de dos tonos: 880 Hz (La) -> 1320 Hz (Mi)
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
        } catch (e) {
            console.warn('[COPILOTO] Error sintetizando chime Web Audio:', e);
        }
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
     * Vocaliza la advertencia por voz nativa (Android TTS / Web Speech API).
     */
    function _speakWarning(radar, dist, currentSpeed) {
        if (!_isVoiceEnabled) return;

        const distRound = Math.round(dist / 10) * 10;
        const isSpeeding = (currentSpeed !== null && currentSpeed > radar.limit);
        const radarNameClean = radar.name.replace(/\s+y\s+/gi, ' esquina ');

        let text = '';
        if (isSpeeding) {
            text = `¡Atención! Fotomulta a ${distRound} metros en ${radarNameClean}. Reduce tu velocidad. Velocidad máxima ${radar.limit} kilómetros por hora.`;
        } else {
            text = `Fotomulta a ${distRound} metros en ${radarNameClean}. Velocidad máxima ${radar.limit} kilómetros por hora.`;
        }

        // 1. Android Native TTS
        if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
            AndroidServices.speak(text);
            return;
        }

        // 2. Native Bridge (Capacitor/Cordova)
        if (window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
            try {
                window.NativeServiceBridge.speak(text);
                return;
            } catch (_) {}
        }

        // 3. Web Speech API (Navegador móvil o escritorio)
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            try {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                window.speechSynthesis.cancel();
                const utter = new SpeechSynthesisUtterance(text);
                utter.lang = 'es-AR';
                utter.rate = 1.05;
                utter.pitch = 1.0;

                // Seleccionar voz en español si está disponible
                const voices = window.speechSynthesis.getVoices();
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
     * Inyecta los estilos CSS necesarios para el HUD de alta visibilidad.
     */
    function _ensureHUDStyles() {
        if (document.getElementById('copilotHUDStyles')) return;
        const style = document.createElement('style');
        style.id = 'copilotHUDStyles';
        style.textContent = `
            #radarCopilotHUD {
                position: fixed;
                top: 14px;
                left: 50%;
                transform: translateX(-50%) translateY(-120%);
                width: calc(100% - 24px);
                max-width: 520px;
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
                border-radius: 20px;
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75), 0 0 25px rgba(239, 68, 68, 0.4);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                padding: 12px 14px;
                display: flex;
                align-items: center;
                gap: 12px;
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
                width: 62px;
                height: 62px;
                border-radius: 50%;
                background: #ffffff;
                border: 6px solid #dc2626;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                box-shadow: 0 6px 14px rgba(0, 0, 0, 0.5);
            }
            .copilot-traffic-sign .speed-num {
                font-size: 25px;
                font-weight: 900;
                line-height: 1;
                color: #0f172a;
                letter-spacing: -0.5px;
            }
            .copilot-traffic-sign .speed-unit {
                font-size: 8px;
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
        `;
        document.head.appendChild(style);
    }

    /**
     * Muestra o actualiza el banner HUD de gran visibilidad en la pantalla.
     */
    function _showRadarHUD(radar, dist, currentSpeed) {
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

        const isSpeeding = (currentSpeed !== null && currentSpeed > radar.limit);
        const distMeters = Math.round(dist);
        let distLabel = `📍 A ${distMeters}m`;
        if (distMeters <= PASSING_DISTANCE_METERS) {
            distLabel = '📍 ¡PASANDO CÁMARA!';
        }

        let speedBadgeHtml = '';
        if (currentSpeed !== null && currentSpeed > 0) {
            const speedKmh = Math.round(currentSpeed);
            if (isSpeeding) {
                speedBadgeHtml = `<div class="copilot-hud-speed-gauge copilot-speed-over">⚠️ EXCESO: ${speedKmh} km/h (MÁX ${radar.limit})</div>`;
            } else {
                speedBadgeHtml = `<div class="copilot-hud-speed-gauge copilot-speed-ok">✅ Velocidad OK: ${speedKmh} km/h</div>`;
            }
        } else {
            speedBadgeHtml = `<div class="copilot-hud-speed-gauge copilot-speed-neutral">⏱️ Respete el límite indicado</div>`;
        }

        const cardClass = isSpeeding ? 'copilot-hud-card hud-speeding' : 'copilot-hud-card';

        hud.innerHTML = `
            <div class="${cardClass}">
                <div class="copilot-traffic-sign">
                    <span class="speed-num">${radar.limit}</span>
                    <span class="speed-unit">MÁX KM/H</span>
                </div>
                <div class="copilot-hud-main">
                    <div class="copilot-hud-pill-row">
                        <span class="copilot-hud-pill-badge">📷 FOTOMULTA</span>
                        <span class="copilot-hud-pill-dist" id="copilotHudDist">${distLabel}</span>
                    </div>
                    <div class="copilot-hud-name" title="${radar.name}">${radar.name}</div>
                    <div class="copilot-hud-desc">${radar.desc || 'Videocontrol municipal de tránsito'}</div>
                    ${speedBadgeHtml}
                </div>
                <div class="copilot-hud-actions">
                    <button class="copilot-hud-btn" id="copilotVoiceToggleBtn" title="Silenciar / Activar voz">
                        ${_isVoiceEnabled ? '🔊' : '🔇'}
                    </button>
                    <button class="copilot-hud-btn" id="copilotCloseBtn" title="Cerrar aviso">✕</button>
                </div>
            </div>
        `;

        // Eventos de botones
        const closeBtn = document.getElementById('copilotCloseBtn');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
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
            // En API HTML5 Geolocation es m/s; si es mayor a 45 probablemente ya venga en km/h
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
     * Chequea la posición actual respecto a todos los radares de la base.
     * Invocado dinámicamente desde el pipeline de GPS nativo y web.
     * @param {number} currentLat - Latitud WGS84
     * @param {number} currentLng - Longitud WGS84
     * @param {number} [rawSpeed] - Velocidad actual en m/s o km/h
     */
    function checkProximity(currentLat, currentLng, rawSpeed = null) {
        if (!_isEnabled) return;
        if (!currentLat || !currentLng || isNaN(currentLat) || isNaN(currentLng)) return;

        const now = Date.now();
        const currentSpeed = _calculateSpeed(currentLat, currentLng, rawSpeed);

        // Guardar última posición
        _lastPosition = { lat: currentLat, lng: currentLng, time: now, speed: currentSpeed };

        // Buscar el radar más cercano dentro del radio de alerta
        let nearestRadar = null;
        let minDistance = Infinity;

        for (const radar of STATIC_RADARS) {
            const dist = _getDistance(currentLat, currentLng, radar.lat, radar.lng);
            if (dist < minDistance) {
                minDistance = dist;
                nearestRadar = radar;
            }
        }

        // Caso 1: Estamos dentro del radio de advertencia temprana (<= 480m)
        if (nearestRadar && minDistance <= WARNING_DISTANCE_METERS) {
            const lastAlert = _lastAlertTime[nearestRadar.id] || 0;
            const isSpeeding = (currentSpeed !== null && currentSpeed > nearestRadar.limit);

            // Verificar si acabamos de entrar o si expiró el enfriamiento
            if (now - lastAlert > COOLDOWN_MS) {
                _lastAlertTime[nearestRadar.id] = now;
                _activeApproach = {
                    radarId: nearestRadar.id,
                    minDistance: minDistance,
                    startedAt: now
                };

                // Reproducir Chime + Voz + Vibración
                _playWarningChime(isSpeeding);
                _speakWarning(nearestRadar, minDistance, currentSpeed);
                _triggerVibration(isSpeeding);

                console.log(`📡 [COPILOTO] 📸 RADAR DETECTADO: ${nearestRadar.name} a ${minDistance.toFixed(0)}m (Límite: ${nearestRadar.limit} km/h, Velocidad: ${currentSpeed ? currentSpeed.toFixed(0) : 'N/A'} km/h)`);
            }

            // Actualizar el HUD dinámicamente con la distancia en vivo
            _showRadarHUD(nearestRadar, minDistance, currentSpeed);

            // Actualizar seguimiento de aproximación
            if (_activeApproach && _activeApproach.radarId === nearestRadar.id) {
                if (minDistance < _activeApproach.minDistance) {
                    _activeApproach.minDistance = minDistance;
                }
            }
        } else {
            // Caso 2: Estamos fuera de la zona de advertencia (> 480m)
            // Si teníamos un acercamiento activo que ahora se alejó, cerrar HUD
            if (_activeApproach) {
                _hideRadarHUD();
                _activeApproach = null;
            }
        }
    }

    /**
     * Prueba inmediata de alerta (HUD, Chime y Voz) para choferes y administradores.
     * Útil para verificar que el audio y el banner funcionen en el dispositivo.
     */
    function testAlert(radarId = 'radar_rosario_30') {
        const radar = STATIC_RADARS.find(r => r.id === radarId) || STATIC_RADARS[0];
        console.log('📡 [COPILOTO] Ejecutando TEST de alerta para:', radar.name);

        const testDist = 280;
        const testSpeed = radar.limit + 8; // Simula leve exceso para probar chime y alerta visual

        _playWarningChime(true);
        _speakWarning(radar, testDist, testSpeed);
        _triggerVibration(true);
        _showRadarHUD(radar, testDist, testSpeed);

        if (typeof Components !== 'undefined' && Components.showToast) {
            Components.showToast(`🔔 Test de Copiloto: ${radar.name}`, 'info');
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
    }

    function isVoiceEnabled() {
        return _isVoiceEnabled;
    }

    function getAllRadars() {
        return STATIC_RADARS;
    }

    function getRadarById(id) {
        return STATIC_RADARS.find(r => r.id === id) || null;
    }

    function dismissHUD() {
        _hideRadarHUD();
    }

    return {
        checkProximity,
        setEnabled,
        isEnabled,
        setVoiceEnabled,
        isVoiceEnabled,
        getAllRadars,
        getRadarById,
        dismissHUD,
        testAlert
    };
})();
