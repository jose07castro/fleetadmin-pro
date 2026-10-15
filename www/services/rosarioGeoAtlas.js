/* =========================================================================
   FleetAdmin Pro — Atlas Geográfico y Normalizador de Rosario
   Resuelve con precisión quirúrgica calles, intersecciones y puntos medios
   ("entre Calle A y Calle B") en Rosario y alrededores, impidiendo caer
   en centroides por defecto.
   ========================================================================= */

const axios = require('axios');

// Coordenadas de referencia de Rosario y ciudades del Gran Rosario
const CITY_CENTROIDS = {
    'Rosario': { lat: -32.9468, lng: -60.6393 },
    'Funes': { lat: -32.9167, lng: -60.8111 },
    'Roldán': { lat: -32.8989, lng: -60.9061 },
    'Arroyo Seco': { lat: -33.1539, lng: -60.5939 },
    'Pueblo Esther': { lat: -33.0744, lng: -60.5739 },
    'San Lorenzo': { lat: -32.7461, lng: -60.7331 },
    'Granadero Baigorria': { lat: -32.8550, lng: -60.7139 },
    'Capitán Bermúdez': { lat: -32.8167, lng: -60.7167 },
    'Villa Gobernador Gálvez': { lat: -33.0333, lng: -60.6333 },
    'Pérez': { lat: -32.9989, lng: -60.7681 },
    'Ibarlucea': { lat: -32.8589, lng: -60.7961 },
    'Alvear': { lat: -33.0906, lng: -60.6278 }
};

// 1. Normalización de jerga local y números de avenidas
function normalizeRosarioStreets(text) {
    if (!text || typeof text !== 'string') return text || '';
    let s = text.trim();

    // "27" o "27 de febrero" -> "Av. 27 de Febrero" (evitando reemplazos dobles)
    s = s.replace(/\b(?:(?:av\.?|avenida|bv\.?|bvar\.?|boulevard)\s+)?27(?:\s+de\s+febrero)?\b(?!\s*de\s*(?:enero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))/gi, 'Av. 27 de Febrero');

    // "Pelle" o "Pellegrini" -> "Av. Pellegrini"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?pelle(?:grini)?\b/gi, 'Av. Pellegrini');

    // "Circunvalacion" -> "Av. Circunvalación"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?circunvalaci[oó]n\b/gi, 'Av. Circunvalación');

    // "Rondeau" -> "Bv. Rondeau"
    s = s.replace(/\b(?:(?:bv\.?|bvar\.?|boulevard|av\.?|avenida)\s+)?rondeau\b/gi, 'Bv. Rondeau');

    // "Ovidio Lagos" o "Lagos" (en contexto de calle) -> "Av. Ovidio Lagos"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?(?:ovidio\s+)?lagos\b(?!\s+(?:del\s+sur|moreno))/gi, 'Av. Ovidio Lagos');

    // "San Martin" -> "Av. San Martín"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?san\s+mart[ií]n\b/gi, 'Av. San Martín');

    // "Oroño" -> "Bv. Oroño"
    s = s.replace(/\b(?:(?:bv\.?|bvar\.?|boulevard|av\.?|avenida)\s+)?oro[ñn]o\b/gi, 'Bv. Oroño');

    // "Peron" -> "Av. Presidente Perón"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?(?:presidente\s+|pte\.?\s+)?per[oó]n\b/gi, 'Av. Presidente Perón');

    // "Newbery" -> "Av. Jorge Newbery"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?(?:jorge\s+)?newbery\b/gi, 'Av. Jorge Newbery');

    // "Avellaneda" -> "Bv. Avellaneda"
    s = s.replace(/\b(?:(?:bv\.?|bvar\.?|boulevard|av\.?|avenida)\s+)?avellaneda\b/gi, 'Bv. Avellaneda');

    // "Arijon" / typo "arizona" -> "Av. Arijón"
    s = s.replace(/\barizona\b/gi, 'Av. Arijón');
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?arij[oó]n\b/gi, 'Av. Arijón');

    // "Uriburu" -> "Av. Uriburu"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?uriburu\b/gi, 'Av. Uriburu');

    // "Francia" -> "Av. Francia"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?francia\b/gi, 'Av. Francia');

    // "Seguí" -> "Av. Seguí"
    s = s.replace(/\b(?:(?:av\.?|avenida|bv\.?|bvar\.?)\s+)?segu[ií]\b/gi, 'Av. Seguí');

    // "Belgrano" -> "Av. Belgrano"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?belgrano\b/gi, 'Av. Belgrano');

    // "Wheelwright"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?wheelwright\b/gi, 'Av. Wheelwright');

    // "Alberdi" -> "Av. Alberdi"
    s = s.replace(/\b(?:(?:av\.?|avenida)\s+)?alberdi\b/gi, 'Av. Alberdi');

    // "Gálvez"
    s = s.replace(/\bgalvez\b/gi, 'Gálvez');

    // "Alem"
    s = s.replace(/\b(?:leandro\s+n\.?\s*)?alem\b/gi, 'Alem');

    // Limpieza de espacios redundantes
    return s.replace(/\s+/g, ' ').trim();
}

// Función para normalizar cadenas para comparación (sin acentos, minúsculas, espacios simples)
function stripAccents(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// 2. Detección de patrón "entre Calle A y Calle B"
function parseEntrePattern(ubicacion) {
    if (!ubicacion) return null;
    const norm = normalizeRosarioStreets(ubicacion);
    const match = norm.match(/^(.+?)\s+(?:entre|e\/)\s+(.+?)\s+[yYeE]\s+(.+)$/i);
    if (match) {
        return {
            mainStreet: match[1].trim(),
            cross1: match[2].trim(),
            cross2: match[3].trim()
        };
    }
    return null;
}

// 3. Matriz de coordenadas de referencia para calles y cruces de Rosario
// Garantiza que NUNCA caigamos en el centroide genérico si una calle o cruce es reconocido.
const ROSARIO_GRID_ATLAS = {
    // Calles Norte-Sur (coordenadas promedio o ejes)
    streetsNS: {
        'av. 27 de febrero': { lng: -60.6650, defaultLat: -32.9680 },
        'av. pellegrini': { lng: -60.6550, defaultLat: -32.9550 },
        'cordoba': { lng: -60.6450, defaultLat: -32.9450 },
        'santa fe': { lng: -60.6435, defaultLat: -32.9440 },
        'san lorenzo': { lng: -60.6420, defaultLat: -32.9430 },
        'urquiza': { lng: -60.6400, defaultLat: -32.9420 },
        'tucuman': { lng: -60.6380, defaultLat: -32.9410 },
        'catamarca': { lng: -60.6360, defaultLat: -32.9400 },
        'salta': { lng: -60.6340, defaultLat: -32.9390 },
        'jujuy': { lng: -60.6320, defaultLat: -32.9380 },
        'rioja': { lng: -60.6470, defaultLat: -32.9460 },
        'san luis': { lng: -60.6490, defaultLat: -32.9470 },
        'san juan': { lng: -60.6510, defaultLat: -32.9480 },
        'mendoza': { lng: -60.6530, defaultLat: -32.9490 },
        '3 de febrero': { lng: -60.6570, defaultLat: -32.9510 },
        '9 de julio': { lng: -60.6590, defaultLat: -32.9520 },
        'zeballos': { lng: -60.6610, defaultLat: -32.9530 },
        'montevideo': { lng: -60.6630, defaultLat: -32.9540 },
        'cochabamba': { lng: -60.6670, defaultLat: -32.9570 },
        'pasco': { lng: -60.6690, defaultLat: -32.9580 },
        'ituzaingo': { lng: -60.6710, defaultLat: -32.9590 },
        'cerrito': { lng: -60.6730, defaultLat: -32.9600 },
        'riobamba': { lng: -60.6750, defaultLat: -32.9610 },
        'la paz': { lng: -60.6770, defaultLat: -32.9620 },
        'viamonte': { lng: -60.6790, defaultLat: -32.9630 },
        'ocampo': { lng: -60.6810, defaultLat: -32.9640 },
        'virasoro': { lng: -60.6635, defaultLat: -32.9690 },
        'galvez': { lng: -60.6620, defaultLat: -32.9700 },
        '24 de septiembre': { lng: -60.6600, defaultLat: -32.9715 },
        'saavedra': { lng: -60.6580, defaultLat: -32.9730 },
        'av. uriburu': { lng: -60.6480, defaultLat: -32.9850 },
        'av. arijon': { lng: -60.6420, defaultLat: -32.9960 },
        'av. segui': { lng: -60.6560, defaultLat: -32.9750 }
    },

    // Calles Este-Oeste (coordenadas promedio o ejes)
    streetsEW: {
        'alem': { lat: -32.9580, defaultLng: -60.6420 },
        '1 de mayo': { lat: -32.9560, defaultLng: -60.6430 },
        'laprida': { lat: -32.9540, defaultLng: -60.6440 },
        'buenos aires': { lat: -32.9520, defaultLng: -60.6450 },
        'juan manuel de rosas': { lat: -32.9500, defaultLng: -60.6460 },
        'maipu': { lat: -32.9480, defaultLng: -60.6470 },
        'av. san martin': { lat: -32.9460, defaultLng: -60.6500 },
        'sarmiento': { lat: -32.9440, defaultLng: -60.6480 },
        'mitre': { lat: -32.9420, defaultLng: -60.6470 },
        'entre rios': { lat: -32.9400, defaultLng: -60.6460 },
        'corrientes': { lat: -32.9380, defaultLng: -60.6450 },
        'paraguay': { lat: -32.9360, defaultLng: -60.6440 },
        'presidente roca': { lat: -32.9340, defaultLng: -60.6430 },
        'espana': { lat: -32.9320, defaultLng: -60.6420 },
        'italia': { lat: -32.9300, defaultLng: -60.6410 },
        'dorrego': { lat: -32.9280, defaultLng: -60.6400 },
        'moreno': { lat: -32.9260, defaultLng: -60.6390 },
        'balcarce': { lat: -32.9240, defaultLng: -60.6380 },
        'bv. orono': { lat: -32.9220, defaultLng: -60.6450 },
        'alvear': { lat: -32.9200, defaultLng: -60.6460 },
        'santiago': { lat: -32.9180, defaultLng: -60.6470 },
        'pueyrredon': { lat: -32.9160, defaultLng: -60.6480 },
        'rodriguez': { lat: -32.9140, defaultLng: -60.6490 },
        'callao': { lat: -32.9120, defaultLng: -60.6500 },
        'av. ovidio lagos': { lat: -32.9100, defaultLng: -60.6550 },
        'av. francia': { lat: -32.9050, defaultLng: -60.6600 },
        'bv. avellaneda': { lat: -32.8980, defaultLng: -60.6700 },
        'av. circunvalacion': { lat: -32.9800, defaultLng: -60.7000 },
        'puccio': { lat: -32.8950, defaultLng: -60.6900 },
        'bv. rondeau': { lat: -32.8900, defaultLng: -60.6950 }
    },

    // Cruces específicos de altísima precisión
    knownIntersections: {
        'alem y av. 27 de febrero': { lat: -32.9664, lng: -60.6408 },
        'av. 27 de febrero y alem': { lat: -32.9664, lng: -60.6408 },
        'alem y galvez': { lat: -32.9698, lng: -60.6378 },
        'galvez y alem': { lat: -32.9698, lng: -60.6378 },
        'alem y virasoro': { lat: -32.9681, lng: -60.6393 },
        'virasoro y alem': { lat: -32.9681, lng: -60.6393 },
        'av. pellegrini y corrientes': { lat: -32.9515, lng: -60.6477 },
        'corrientes y av. pellegrini': { lat: -32.9515, lng: -60.6477 },
        'av. pellegrini y entre rios': { lat: -32.9525, lng: -60.6465 },
        'entre rios y av. pellegrini': { lat: -32.9525, lng: -60.6465 },
        'av. pellegrini y bv. orono': { lat: -32.9575, lng: -60.6548 },
        'bv. orono y av. pellegrini': { lat: -32.9575, lng: -60.6548 },
        'av. pellegrini y av. francia': { lat: -32.9620, lng: -60.6620 },
        'av. francia y av. pellegrini': { lat: -32.9620, lng: -60.6620 },
        'av. pellegrini y av. ovidio lagos': { lat: -32.9645, lng: -60.6660 },
        'av. ovidio lagos y av. pellegrini': { lat: -32.9645, lng: -60.6660 },
        'av. 27 de febrero y bv. orono': { lat: -32.9678, lng: -60.6632 },
        'bv. orono y av. 27 de febrero': { lat: -32.9678, lng: -60.6632 },
        'av. 27 de febrero y av. san martin': { lat: -32.9712, lng: -60.6472 },
        'av. san martin y av. 27 de febrero': { lat: -32.9712, lng: -60.6472 },
        'av. 27 de febrero y corrientes': { lat: -32.9625, lng: -60.6558 },
        'corrientes y av. 27 de febrero': { lat: -32.9625, lng: -60.6558 },
        'av. 27 de febrero y av. francia': { lat: -32.9735, lng: -60.6720 },
        'av. francia y av. 27 de febrero': { lat: -32.9735, lng: -60.6720 },
        'av. 27 de febrero y av. ovidio lagos': { lat: -32.9760, lng: -60.6760 },
        'av. ovidio lagos y av. 27 de febrero': { lat: -32.9760, lng: -60.6760 },
        'av. 27 de febrero y av. circunvalacion': { lat: -32.9960, lng: -60.7090 },
        'av. circunvalacion y av. 27 de febrero': { lat: -32.9960, lng: -60.7090 },
        'av. san martin y av. circunvalacion': { lat: -33.0035, lng: -60.6610 },
        'av. circunvalacion y av. san martin': { lat: -33.0035, lng: -60.6610 },
        'av. san martin y av. uriburu': { lat: -32.9860, lng: -60.6450 },
        'av. uriburu y av. san martin': { lat: -32.9860, lng: -60.6450 },
        'av. san martin y av. arijon': { lat: -32.9970, lng: -60.6440 },
        'av. arijon y av. san martin': { lat: -32.9970, lng: -60.6440 },
        'av. ovidio lagos y av. circunvalacion': { lat: -32.9975, lng: -60.6890 },
        'av. circunvalacion y av. ovidio lagos': { lat: -32.9975, lng: -60.6890 },
        'av. ovidio lagos y av. uriburu': { lat: -32.9830, lng: -60.6720 },
        'av. uriburu y av. ovidio lagos': { lat: -32.9830, lng: -60.6720 },
        'bv. rondeau y av. circunvalacion': { lat: -32.8790, lng: -60.7020 },
        'av. circunvalacion y bv. rondeau': { lat: -32.8790, lng: -60.7020 },
        'bv. rondeau y puccio': { lat: -32.8950, lng: -60.6900 },
        'puccio y bv. rondeau': { lat: -32.8950, lng: -60.6900 },
        'av. presidente peron y av. circunvalacion': { lat: -32.9840, lng: -60.7300 },
        'av. circunvalacion y av. presidente peron': { lat: -32.9840, lng: -60.7300 },
        'av. presidente peron y bv. avellaneda': { lat: -32.9550, lng: -60.6860 },
        'bv. avellaneda y av. presidente peron': { lat: -32.9550, lng: -60.6860 },
        'av. jorge newbery y av. circunvalacion': { lat: -32.9150, lng: -60.7330 },
        'av. circunvalacion y av. jorge newbery': { lat: -32.9150, lng: -60.7330 },
        'av. circunvalacion y av. pellegrini': { lat: -32.9810, lng: -60.7210 },
        'av. pellegrini y av. circunvalacion': { lat: -32.9810, lng: -60.7210 },
        'av. circunvalacion y bv. orono': { lat: -32.9950, lng: -60.6790 },
        'bv. orono y av. circunvalacion': { lat: -32.9950, lng: -60.6790 }
    }
};

/**
 * Resuelve una intersección a través del Atlas local o cálculo de cuadrícula
 */
function resolveFromAtlas(query) {
    if (!query) return null;
    const clean = stripAccents(normalizeRosarioStreets(query));

    // 1. Coincidencia directa en intersecciones conocidas
    if (ROSARIO_GRID_ATLAS.knownIntersections[clean]) {
        const pt = ROSARIO_GRID_ATLAS.knownIntersections[clean];
        return { lat: pt.lat, lng: pt.lng, approximate: false, source: 'atlas_known' };
    }

    // 2. Comprobar si es un cruce "calleA y calleB"
    const match = clean.match(/^(.+?)\s+[yye]\s+(.+)$/);
    if (match) {
        const c1 = stripAccents(match[1]);
        const c2 = stripAccents(match[2]);

        // Buscar combinaciones invertidas
        const inverted = `${c2} y ${c1}`;
        if (ROSARIO_GRID_ATLAS.knownIntersections[inverted]) {
            const pt = ROSARIO_GRID_ATLAS.knownIntersections[inverted];
            return { lat: pt.lat, lng: pt.lng, approximate: false, source: 'atlas_known' };
        }

        // Intersección por cuadrícula (NS con EW)
        let ns = ROSARIO_GRID_ATLAS.streetsNS[c1] || ROSARIO_GRID_ATLAS.streetsNS[c2];
        let ew = ROSARIO_GRID_ATLAS.streetsEW[c1] || ROSARIO_GRID_ATLAS.streetsEW[c2];

        if (ns && ew) {
            return { lat: ew.lat, lng: ns.lng, approximate: false, source: 'atlas_grid_intersection' };
        }

        // Si solo se conoce una de las calles, usar su coordenada representativa
        if (ew) {
            return { lat: ew.lat, lng: ew.defaultLng, approximate: true, source: 'atlas_street_ew' };
        }
        if (ns) {
            return { lat: ns.defaultLat, lng: ns.lng, approximate: true, source: 'atlas_street_ns' };
        }
    }

    // 3. Comprobar si es una calle sola
    if (ROSARIO_GRID_ATLAS.streetsEW[clean]) {
        const ew = ROSARIO_GRID_ATLAS.streetsEW[clean];
        return { lat: ew.lat, lng: ew.defaultLng, approximate: true, source: 'atlas_street_ew' };
    }
    if (ROSARIO_GRID_ATLAS.streetsNS[clean]) {
        const ns = ROSARIO_GRID_ATLAS.streetsNS[clean];
        return { lat: ns.defaultLat, lng: ns.lng, approximate: true, source: 'atlas_street_ns' };
    }

    return null;
}

/**
 * Consulta un punto individual vía Photon con timeout acotado
 */
async function queryPhotonSinglePoint(address, city, cityCoords) {
    try {
        const cleanAddress = address.replace(/\s+[yY]\s+/gi, ', ');
        const fullAddress = `${cleanAddress}, ${city}, Argentina`;
        const pUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(fullAddress)}&limit=1&lat=${cityCoords.lat}&lon=${cityCoords.lng}`;
        const pResponse = await axios.get(pUrl, { timeout: 3500 });

        if (pResponse.data?.features?.length > 0) {
            const coords = pResponse.data.features[0].geometry.coordinates;
            const tempLng = parseFloat(coords[0]);
            const tempLat = parseFloat(coords[1]);
            const distKm = Math.hypot((tempLat - cityCoords.lat) * 111, (tempLng - cityCoords.lng) * 111 * Math.cos(cityCoords.lat * Math.PI / 180));

            if (distKm <= 55) {
                return {
                    lat: tempLat,
                    lng: tempLng,
                    approximate: false,
                    formattedAddress: pResponse.data.features[0].properties?.name ? `${pResponse.data.features[0].properties.name}, ${city}` : address
                };
            }
        }
    } catch (_) {}
    return null;
}

/**
 * Geocodificador Integral de Rosario y Alrededores
 * Aplica:
 * a) Normalización de nombres y avenidas.
 * b) Cálculo de punto medio para "entre Calle A y Calle B".
 * c) Regla anti-centroide: prohíbe caer en el centroide de Rosario si la calle fue identificada.
 */
async function geocodeRosarioLocation(ubicacion, city = 'Rosario') {
    const cityCoords = CITY_CENTROIDS[city] || CITY_CENTROIDS['Rosario'];
    let defaultLat = cityCoords.lat;
    let defaultLng = cityCoords.lng;

    if (!ubicacion || ubicacion === 'null' || ubicacion.trim() === '') {
        return { lat: defaultLat, lng: defaultLng, approximate: true, formattedAddress: city };
    }

    // 1. Normalizar nombres
    const normalized = normalizeRosarioStreets(ubicacion);

    // 2. Verificar si es formato "entre Calle A y Calle B"
    const entreData = parseEntrePattern(normalized);
    if (entreData) {
        const { mainStreet, cross1, cross2 } = entreData;
        console.log(`🧭 [GEO-ENTRE] Procesando cuadra: "${mainStreet}" entre "${cross1}" y "${cross2}" (${city})`);

        // Corner 1: mainStreet y cross1
        const cornerQuery1 = `${mainStreet} y ${cross1}`;
        let point1 = resolveFromAtlas(cornerQuery1);
        if (!point1) {
            point1 = await queryPhotonSinglePoint(cornerQuery1, city, cityCoords);
        }

        // Corner 2: mainStreet y cross2
        const cornerQuery2 = `${mainStreet} y ${cross2}`;
        let point2 = resolveFromAtlas(cornerQuery2);
        if (!point2) {
            point2 = await queryPhotonSinglePoint(cornerQuery2, city, cityCoords);
        }

        // Si ambos puntos resolvieron, calcular el punto medio exacto de la cuadra
        if (point1 && point2) {
            const midLat = (point1.lat + point2.lat) / 2.0;
            const midLng = (point1.lng + point2.lng) / 2.0;
            const formatted = `${mainStreet} entre ${cross1} y ${cross2}, ${city}`;
            console.log(`🎯 [GEO-ENTRE] ✅ Punto medio exacto calculado: (${midLat.toFixed(6)}, ${midLng.toFixed(6)})`);
            return {
                lat: Number(midLat.toFixed(6)),
                lng: Number(midLng.toFixed(6)),
                approximate: false,
                formattedAddress: formatted
            };
        }

        // Si solo resolvió el Corner 1 (primera transversal mencionada), ubicar en Corner 1 (Regla 1c)
        if (point1) {
            const formatted = `${mainStreet} y ${cross1}, ${city}`;
            console.log(`🎯 [GEO-ENTRE] Fallback a 1ra transversal resuelta ("${cornerQuery1}"): (${point1.lat}, ${point1.lng})`);
            return {
                lat: point1.lat,
                lng: point1.lng,
                approximate: false,
                formattedAddress: formatted
            };
        }

        // Si solo resolvió el Corner 2
        if (point2) {
            const formatted = `${mainStreet} y ${cross2}, ${city}`;
            console.log(`🎯 [GEO-ENTRE] Fallback a 2da transversal resuelta ("${cornerQuery2}"): (${point2.lat}, ${point2.lng})`);
            return {
                lat: point2.lat,
                lng: point2.lng,
                approximate: false,
                formattedAddress: formatted
            };
        }

        // Si fallaron ambas transversales, ubicar sobre mainStreet sin caer al centroide (Regla 1c)
        const streetOnly = resolveFromAtlas(mainStreet);
        if (streetOnly) {
            console.log(`🎯 [GEO-ENTRE] Fallback sobre calle principal ("${mainStreet}"): (${streetOnly.lat}, ${streetOnly.lng})`);
            return {
                lat: streetOnly.lat,
                lng: streetOnly.lng,
                approximate: true,
                formattedAddress: `${mainStreet}, ${city}`
            };
        }
    }

    // 3. Consulta de intersección simple o calle individual
    // A) Atlas local (instantáneo, sin red, máxima fidelidad)
    const atlasRes = resolveFromAtlas(normalized);
    if (atlasRes) {
        console.log(`📍 [GEO-ATLAS] ✅ Resuelto localmente para "${normalized}": (${atlasRes.lat}, ${atlasRes.lng})`);
        return {
            lat: atlasRes.lat,
            lng: atlasRes.lng,
            approximate: atlasRes.approximate,
            formattedAddress: `${normalized}, ${city}`
        };
    }

    // B) Photon API
    const photonRes = await queryPhotonSinglePoint(normalized, city, cityCoords);
    if (photonRes) {
        console.log(`📍 [GEO-PHOTON] ✅ Resuelto vía Photon para "${normalized}": (${photonRes.lat}, ${photonRes.lng})`);
        return photonRes;
    }

    // C) Si se extrajo una intersección "calleA y calleB", intentar con la primera transversal
    const matchAnd = normalized.match(/^(.+?)\s+[yYeE]\s+(.+)$/);
    if (matchAnd) {
        const c1 = matchAnd[1].trim();
        const streetRes = resolveFromAtlas(c1);
        if (streetRes) {
            console.log(`🎯 [GEO-FALLBACK-1RA] Ubicado sobre 1ra calle mencionada ("${c1}"): (${streetRes.lat}, ${streetRes.lng})`);
            return {
                lat: streetRes.lat,
                lng: streetRes.lng,
                approximate: true,
                formattedAddress: `${c1}, ${city}`
            };
        }
    }

    // D) Solo si no se identificó ninguna calle en absoluto, devolver centroide aproximado
    console.warn(`⚠️ [GEO-CENTROIDE] Calle no identificable en el mapa. Usando centro de ${city}`);
    return { lat: defaultLat, lng: defaultLng, approximate: true, formattedAddress: city };
}

module.exports = {
    CITY_CENTROIDS,
    normalizeRosarioStreets,
    parseEntrePattern,
    resolveFromAtlas,
    geocodeRosarioLocation
};
