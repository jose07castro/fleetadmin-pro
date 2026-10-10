/* =========================================================================
   FleetAdmin Pro — Agente Centinela IA (Google Gemini 2.5 Flash)
   Procesa, clasifica y despacha alertas viales en tiempo real usando el SDK oficial @google/genai.
   ========================================================================= */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');

let _aiClient = null;

function getGeminiKey() {
    return process.env.GEMINI_API_KEY || null;
}

function getGeminiClient() {
    const key = getGeminiKey();
    if (!key) {
        console.warn('⚠️ [GEMINI-AGENT] GEMINI_API_KEY no configurada en entorno.');
        return null;
    }
    if (!_aiClient) {
        _aiClient = new GoogleGenAI({ apiKey: key });
    }
    return _aiClient;
}

// Coordenadas de referencia en Argentina (Rosario y alrededores)
const CITY_COORDINATES = {
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

/**
 * 1. Clasifica un reporte de texto o transcripción con Gemini 2.5 Flash
 * Responde con JSON estricto (responseMimeType: 'application/json').
 * @param {string} reportText
 * @param {object} options { groupName, senderName, city }
 * @returns {Promise<{esAlerta: boolean, tipo: string, ubicacion: string|null, vigenciaMinutos: number, descripcion: string, esLevantado: boolean, confianza: number}>}
 */
async function classifyTrafficReport(reportText, options = {}) {
    const text = String(reportText || '').trim();
    if (!text) {
        return {
            esAlerta: false,
            tipo: 'warning',
            ubicacion: null,
            vigenciaMinutos: 0,
            descripcion: 'Texto vacío',
            esLevantado: false,
            confianza: 0
        };
    }

    const ai = getGeminiClient();
    const groupName = options.groupName || 'Reporte de flota';
    const city = options.city || 'Rosario';

    if (ai) {
        try {
            const prompt = `Sos el Agente Centinela de Tránsito de FleetAdmin Pro para taxistas y choferes de apps en ${city}, Santa Fe, Argentina.
Tu misión es procesar este reporte y clasificarlo con precisión quirúrgica.

Texto recibido: "${text}"
Contexto de origen: "${groupName}"

REGLAS DE EVALUACIÓN:
1. esAlerta (boolean):
   - true si reporta un control policial, inspector municipal, operativo de tránsito, radar, accidente, choque, corte de calle o si se levantó/limpió un control vial.
   - true si el mensaje dentro de un grupo de choferes/operativos menciona una intersección de calles (ej: "Rioja entre Mitre y Entre Ríos", "San Lorenzo y Alsina", "Pellegrini y Corrientes").
   - false si es un saludo ("buen día", "hola"), agradecimiento ("gracias viejo"), consulta/pregunta ("¿hay algo en la ruta?"), o charla personal/anécdota ajena.
2. tipo (string):
   - "municipal": inspectores municipales, "zorros", "chanchos", "fiscalización", "fisca", "grúa", "carretón", control de motos, alcoholemia municipal.
   - "police": policía, patrullas, comando, "gorra", "ratis", "cana".
   - "checkpoint": operativo o control genérico de tránsito.
   - "radar": radares móviles, fotomultas, cámaras.
   - "accident": accidentes, choques, colisiones.
   - "traffic": congestión pesada, cortes, calles anegadas.
   - "warning": precaución general.
3. ubicacion (string o null):
   - Intersección de calles o dirección exacta mencionada en el texto (ej: "San Lorenzo y Alsina", "Rioja y Mitre", "Pellegrini al 1500").
   - Si no se menciona ninguna calle o cruce, pon null. No inventes direcciones.
4. vigenciaMinutos (number):
   - Estimación de tiempo de validez del evento:
     * Si el operativo fue levantado o ya está limpio: 30 minutos.
     * Operativo / Control / Policía activo: 60 a 90 minutos.
     * Accidente o corte de calle: 45 a 60 minutos.
     * Radar móvil: 120 minutos.
5. descripcion (string):
   - Resumen ultra-breve (máximo 8 palabras) en español, sin emojis, optimizado para ser leído por el motor de voz (TTS) de la app mientras el chofer conduce.
6. esLevantado (boolean):
   - true si el reporte avisa afirmativamente que el control se fue, se levantó o "ya está limpio".
7. confianza (number):
   - Valor entre 0.0 y 1.0 según la certeza del reporte.

Responde ÚNICAMENTE con JSON válido (responseMimeType application/json) con las claves:
esAlerta, tipo, ubicacion, vigenciaMinutos, descripcion, esLevantado, confianza`;

            const res = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json'
                }
            });

            if (res && res.text) {
                const parsed = JSON.parse(res.text.trim());
                console.log(`🤖 [CENTINELA-GEMINI] Alerta=${parsed.esAlerta} | Tipo=${parsed.tipo} | Ubicación="${parsed.ubicacion}" | Vigencia=${parsed.vigenciaMinutos}m | "${parsed.descripcion}"`);
                return {
                    esAlerta: Boolean(parsed.esAlerta),
                    tipo: String(parsed.tipo || 'checkpoint'),
                    ubicacion: parsed.ubicacion || null,
                    vigenciaMinutos: Number(parsed.vigenciaMinutos) || 60,
                    descripcion: String(parsed.descripcion || text.substring(0, 60)),
                    esLevantado: Boolean(parsed.esLevantado),
                    confianza: Number(parsed.confianza) || 0.85
                };
            }
        } catch (err) {
            console.warn(`⚠️ [CENTINELA-GEMINI] Falló consulta SDK @google/genai: ${err.message}. Aplicando fallback heurístico.`);
        }
    }

    // Fallback heurístico en caso de que la API Key o la red fallen
    return fallbackHeuristicClassifier(text, groupName);
}

/**
 * 2. Transcribe y clasifica un audio con Gemini 2.5 Flash multimodal
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 * @param {object} options
 */
async function transcribeAndClassifyAudio(audioBuffer, mimeType = 'audio/ogg', options = {}) {
    if (!audioBuffer) return null;
    const ai = getGeminiClient();
    const cleanMimeType = (mimeType || 'audio/ogg').split(';')[0].trim();
    const groupName = options.groupName || 'Audio de grupo';
    const city = options.city || 'Rosario';

    if (ai) {
        try {
            const audioB64 = audioBuffer.toString('base64');
            const prompt = `Sos el Agente Centinela de Tránsito de FleetAdmin Pro para choferes en ${city}, Argentina.
Escuchá este audio y responde ÚNICAMENTE en JSON válido (responseMimeType: application/json).

MODERACIÓN: Si el audio dice insultos (puto, puta, concha, pija, culo, verga, boludo, pelotudo, forro, etc.), ELIMINÁ esas palabras y transcribí solo el resto del reporte vial limpio.

Clasifica:
1. esAlerta (boolean): true si reporta control, operativo, accidente, radar o control levantado/limpio. false si es charla común.
2. tipo (string): police, checkpoint, municipal, radar, accident, traffic, warning.
3. ubicacion (string o null): intersección de calles deducida o null.
4. vigenciaMinutos (number): minutos de vigencia estimados (30 para levantado, 60 a 90 para control activo, 45 para accidente).
5. descripcion (string): resumen ultra-breve (máx 8 palabras) sin insultos ni emojis.
6. transcripcion (string): lo que dice el audio de forma limpia.
7. esLevantado (boolean): true si avisa que el operativo se fue o está limpio.
8. confianza (number): 0.0 a 1.0.

JSON esperado: {"esAlerta":true,"tipo":"checkpoint","ubicacion":"Pellegrini y Corrientes","vigenciaMinutos":60,"descripcion":"Control vehicular en Pellegrini y Corrientes","transcripcion":"...","esLevantado":false,"confianza":0.9}`;

            const res = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [
                    { inlineData: { mimeType: cleanMimeType, data: audioB64 } },
                    { text: prompt }
                ],
                config: {
                    responseMimeType: 'application/json'
                }
            });

            if (res && res.text) {
                const parsed = JSON.parse(res.text.trim());
                console.log(`🎙️ [CENTINELA-AUDIO] Alerta=${parsed.esAlerta} | Tipo=${parsed.tipo} | Ubicacion="${parsed.ubicacion}" | Vigencia=${parsed.vigenciaMinutos}m`);
                return {
                    esAlerta: Boolean(parsed.esAlerta),
                    tipo: String(parsed.tipo || 'checkpoint'),
                    ubicacion: parsed.ubicacion || null,
                    vigenciaMinutos: Number(parsed.vigenciaMinutos) || 60,
                    descripcion: String(parsed.descripcion || 'Reporte de voz'),
                    transcripcion: String(parsed.transcripcion || ''),
                    esLevantado: Boolean(parsed.esLevantado),
                    confianza: Number(parsed.confianza) || 0.85
                };
            }
        } catch (err) {
            console.warn(`⚠️ [CENTINELA-AUDIO] Falló análisis de audio con Gemini: ${err.message}`);
        }
    }
    return null;
}

/**
 * Fallback heurístico en caso de desconexión temporal de IA
 */
function fallbackHeuristicClassifier(text, groupName = '') {
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Descartar charlas obvias y preguntas
    if (t.includes('?') || /\b(?:alguien\s+sabe|saben\s+si|info|que\s+onda|pasa\s+algo|gracias|buen\s+dia|hola|ok)\b/i.test(t)) {
        return { esAlerta: false, tipo: 'warning', ubicacion: null, vigenciaMinutos: 0, descripcion: 'Consulta o charla', esLevantado: false, confianza: 0.9 };
    }

    const isLifting = /\b(?:limpio|limpiaron|ya\s+no\s+estan|se\s+fueron|levantaron|todo\s+libre|via\s+libre|esta\s+libre)\b/i.test(t);
    let tipo = 'checkpoint';
    if (/municipal|zorros|chanchos|inspectores|carreton|grua|motos|fiscalizacion|fisca/.test(t)) tipo = 'municipal';
    else if (/gorra|ratis|cana|policia|patrulla|comando/.test(t)) tipo = 'police';
    else if (/radar|fotomulta|camara/.test(t)) tipo = 'radar';
    else if (/accidente|choque/.test(t)) tipo = 'accident';
    else if (/corte|trafico|bache|inundacion/.test(t)) tipo = 'traffic';

    // Extracción de calles
    const match = text.match(/([a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]+?)\s+[yYeE]\s+([a-zA-Z0-9áéíóúñÁÉÍÓÚÑ\s]+)/i);
    const ubicacion = match ? `${match[1].trim()} y ${match[2].trim()}` : null;

    const hasKeywords = /operativo|control|policia|zorros|fiscalizacion|fisca|accidente|radar|chanchos/.test(t);
    const esAlerta = hasKeywords || !!ubicacion;

    return {
        esAlerta,
        tipo,
        ubicacion,
        vigenciaMinutos: isLifting ? 30 : 60,
        descripcion: isLifting ? `Operativo levantado en ${ubicacion || 'la zona'}` : `Alerta vial en ${ubicacion || 'la zona'}`,
        esLevantado: isLifting,
        confianza: 0.7
    };
}

/**
 * 3. Geocodificación inteligente (Google Geocode con fallback de alta precisión Photon)
 * @param {string} ubicacion
 * @param {string} city
 * @returns {Promise<{lat: number, lng: number, approximate: boolean, formattedAddress: string}>}
 */
async function geocodeLocation(ubicacion, city = 'Rosario') {
    const cityCoords = CITY_COORDINATES[city] || CITY_COORDINATES['Rosario'];
    let lat = cityCoords.lat;
    let lng = cityCoords.lng;
    let approximate = true;
    let formattedAddress = ubicacion || city;

    if (!ubicacion || ubicacion === 'null') {
        return { lat, lng, approximate: true, formattedAddress: city };
    }

    // 1. Google Maps Geocoding API
    const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyATwi1CCdw5q-8nYXTsTn8VCKoP13jbHBE';
    if (googleApiKey) {
        try {
            const queryAddress = `${ubicacion}, ${city}, Santa Fe, Argentina`;
            const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(queryAddress)}&language=es&region=AR&key=${googleApiKey}`;
            const gResponse = await axios.get(gUrl, { timeout: 5000 });

            if (gResponse.data?.status === 'OK' && gResponse.data.results?.length > 0) {
                const loc = gResponse.data.results[0].geometry.location;
                const tempLat = parseFloat(loc.lat);
                const tempLng = parseFloat(loc.lng);
                const distKm = Math.hypot((tempLat - cityCoords.lat) * 111, (tempLng - cityCoords.lng) * 111 * Math.cos(cityCoords.lat * Math.PI / 180));

                if (distKm <= 60) {
                    lat = tempLat;
                    lng = tempLng;
                    approximate = false;
                    formattedAddress = gResponse.data.results[0].formatted_address || ubicacion;
                    return { lat, lng, approximate, formattedAddress };
                }
            }
        } catch (e) {}
    }

    // 2. Photon Geocoding Fallback
    try {
        const cleanAddressForGeo = ubicacion.replace(/\s+[yY]\s+/gi, ', ');
        const fullAddress = `${cleanAddressForGeo}, ${city}, Argentina`;
        const pUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(fullAddress)}&limit=1&lat=${cityCoords.lat}&lon=${cityCoords.lng}`;
        const pResponse = await axios.get(pUrl, { timeout: 6000 });

        if (pResponse.data?.features?.length > 0) {
            const coords = pResponse.data.features[0].geometry.coordinates;
            const tempLng = parseFloat(coords[0]);
            const tempLat = parseFloat(coords[1]);
            const distKm = Math.hypot((tempLat - cityCoords.lat) * 111, (tempLng - cityCoords.lng) * 111 * Math.cos(cityCoords.lat * Math.PI / 180));

            if (distKm <= 60) {
                lat = tempLat;
                lng = tempLng;
                approximate = false;
                formattedAddress = pResponse.data.features[0].properties?.name ? `${pResponse.data.features[0].properties.name}, ${city}` : ubicacion;
            }
        }
    } catch (e) {
        console.warn(`⚠️ [CENTINELA-GEO] Error en Photon: ${e.message}`);
    }

    return { lat, lng, approximate, formattedAddress };
}

/**
 * 4. Despacha y publica la alerta en tiempo real en Firebase (global y flotas)
 * @param {object} classification { esAlerta, tipo, ubicacion, vigenciaMinutos, descripcion, esLevantado }
 * @param {object} options { authorName, groupName, fleetId, messageId, originalText, audioUrl, source }
 * @param {object} db Firebase Admin Database
 * @returns {Promise<{dispatched: boolean, alertId: string|null, alertData: object|null}>}
 */
async function dispatchAlert(classification, options = {}, db) {
    if (!classification || !classification.esAlerta) {
        return { dispatched: false, alertId: null, alertData: null, reason: 'not_an_alert' };
    }

    if (!db) {
        console.error('❌ [CENTINELA-DESPACHO] Error: Firebase db no proporcionada.');
        return { dispatched: false, alertId: null, alertData: null, reason: 'database_unavailable' };
    }

    const city = options.city || 'Rosario';
    const geo = await geocodeLocation(classification.ubicacion, city);

    const safeMsgId = options.messageId ? `wsp_${options.messageId.replace(/[^a-zA-Z0-9_]/g, '_')}` : `ia_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const alertId = safeMsgId;
    const author = options.authorName || options.groupName || 'Agente Centinela IA';
    const vigenciaMs = (classification.vigenciaMinutos || 60) * 60 * 1000;

    const alertData = {
        id: alertId,
        type: classification.tipo || 'checkpoint',
        location: classification.ubicacion || geo.formattedAddress || 'Ubicación identificada',
        lat: geo.lat,
        lng: geo.lng,
        timestamp: Date.now(),
        expiresAt: Date.now() + vigenciaMs,
        authorName: author,
        originalText: options.originalText || classification.descripcion || '',
        description: classification.descripcion,
        confirmations: geo.approximate ? 0 : 1,
        status: 'active',
        source: options.source || 'gemini_agent',
        approximate: geo.approximate,
        isLifting: Boolean(classification.esLevantado),
        vigenciaMinutos: classification.vigenciaMinutos || 60,
        confianza: classification.confianza || 0.85
    };

    if (options.audioUrl) {
        alertData.audioUrl = options.audioUrl;
    }

    try {
        // Publicación en nodo GLOBAL (escuchado por Android nativo y Web)
        await db.ref(`global_traffic_alerts/${alertId}`).set(alertData);
        console.log(`📡 [CENTINELA-DESPACHO] ✅ Alerta publicada en global_traffic_alerts/${alertId} [${alertData.type}] ${alertData.location}`);

        // Broadcast a todas las flotas registradas
        const fleetsSnap = await db.ref('fleets').once('value');
        const fleets = fleetsSnap.val() || {};
        const fleetPromises = Object.keys(fleets).map(fId => {
            return db.ref(`fleets/${fId}/traffic_alerts/${alertId}`).set(alertData);
        });
        await Promise.all(fleetPromises);

        // Envío de notificación Push a admins/conductores
        try {
            const alertTypeNames = {
                police: 'Control de Policía 👮',
                checkpoint: 'Operativo / Control 🚧',
                radar: 'Radar / Fotomulta 📷',
                municipal: 'Fiscalización Municipal 🏛️',
                traffic: 'Alerta de Tráfico 🚦',
                accident: 'Accidente en la vía 💥',
                warning: 'Alerta de Tránsito ⚠️'
            };
            const title = `🚨 ${alertTypeNames[alertData.type] || 'Alerta de Tránsito'}`;
            const body = `${alertData.description || alertData.location}. Reportado por ${author}`;

            const tokensSnap = await db.ref('fcm_tokens').once('value');
            const tokensVal = tokensSnap.val() || {};
            const tokens = Object.values(tokensVal).map(t => typeof t === 'object' ? t.token : t).filter(Boolean);

            if (tokens.length > 0 && typeof admin !== 'undefined') {
                const message = {
                    notification: { title, body },
                    data: { alertId: alertId, type: alertData.type },
                    tokens: tokens
                };
                admin.messaging().sendMulticast(message).catch(() => {});
            }
        } catch (pushErr) {}

        return { dispatched: true, alertId, alertData };
    } catch (dbErr) {
        console.error(`❌ [CENTINELA-DESPACHO] Error guardando en Firebase: ${dbErr.message}`);
        return { dispatched: false, alertId: null, alertData: null, reason: dbErr.message };
    }
}

module.exports = {
    getGeminiKey,
    getGeminiClient,
    classifyTrafficReport,
    transcribeAndClassifyAudio,
    geocodeLocation,
    dispatchAlert
};
