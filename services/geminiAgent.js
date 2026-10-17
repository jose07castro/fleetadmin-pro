/* =========================================================================
   FleetAdmin Pro — Agente Centinela IA (Google Gemini 2.5 Flash)
   Procesa, clasifica y despacha alertas viales en tiempo real usando el SDK oficial @google/genai.
   ========================================================================= */

require('dotenv').config();
const admin = require('firebase-admin');
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const rosarioGeoAtlas = require('./rosarioGeoAtlas');

let _aiClient = null;
let _dynamicKey = null;

let _agentConfig = {
    sentinelEnabled: true,
    maxRepeats: 2,
    trafficKeywords: [],
    forbiddenWords: []
};

function updateAgentConfig(cfg) {
    if (cfg && typeof cfg === 'object') {
        _agentConfig = { ..._agentConfig, ...cfg };
        console.log(`🧠 [GEMINI-AGENT] Configuración de Centinela actualizada: centinela=${_agentConfig.sentinelEnabled ? 'ACTIVO' : 'PAUSADO'}`);
    }
}

function getAgentConfig() {
    return _agentConfig;
}

function setGeminiKey(key) {
    if (key && key !== _dynamicKey) {
        _dynamicKey = key;
        _aiClient = new GoogleGenAI({ apiKey: key });
        console.log('🧠 [GEMINI-AGENT] Clave API configurada dinámicamente con éxito ✅');
    }
}

function getGeminiKey() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
    if (_dynamicKey) return _dynamicKey;
    try {
        const wb = require('../js/bot/whatsapp-bot');
        if (wb && typeof wb.getGeminiKey === 'function') {
            const k = wb.getGeminiKey();
            if (k) {
                _dynamicKey = k;
                return k;
            }
        }
    } catch(e) {}
    return null;
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

// Modelos priorizados: gemini-2.5-flash como principal, gemini-flash-lite-latest y gemini-3.5-flash-lite de respaldo
const CENTINELA_MODELS = [
    'gemini-2.5-flash',
    'gemini-flash-lite-latest',
    'gemini-3.5-flash-lite'
];

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

    if (_agentConfig && _agentConfig.sentinelEnabled === false) {
        return {
            esAlerta: false,
            tipo: 'warning',
            ubicacion: null,
            vigenciaMinutos: 0,
            descripcion: 'Centinela IA en pausa',
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
   - true si el mensaje dentro de un grupo de choferes/operativos menciona una intersección de calles (ej: "Alem entre 27 de Febrero y Gálvez", "Rioja entre Mitre y Entre Ríos", "San Lorenzo y Alsina", "Pellegrini y Corrientes").
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
   - Normalizar SIEMPRE la jerga rosarina a su nombre formal:
     * "27" o "27 de febrero" -> "Av. 27 de Febrero"
     * "Pelle" o "Pellegrini" -> "Av. Pellegrini"
     * "Circunvalacion" -> "Av. Circunvalación"
     * "Rondeau" -> "Bv. Rondeau"
     * "Ovidio Lagos" o "lagos" -> "Av. Ovidio Lagos"
     * "San Martin" -> "Av. San Martín"
     * "Oroño" -> "Bv. Oroño"
     * "Peron" -> "Av. Presidente Perón"
     * "Newbery" -> "Av. Jorge Newbery"
     * "Avellaneda" -> "Bv. Avellaneda"
     * "Segui" -> "Av. Seguí"
     * "Uriburu" -> "Av. Uriburu"
     * "Arijon" / "Arizona" -> "Av. Arijón"
   - Si dice "entre calle A y calle B" (ej: "Alem entre 27 de Febrero y Gálvez"), normalizar a ese formato exacto: "Alem entre Av. 27 de Febrero y Gálvez".
   - Si no se menciona ninguna calle o cruce, pon null. No inventes direcciones.
4. vigenciaMinutos (number):
   - Estimación de tiempo de validez del evento:
     * Si el operativo fue levantado o ya está limpio: 30 minutos.
     * Operativo / Control / Policía activo: 60 a 90 minutos.
     * Accidente o corte de calle: 45 a 60 minutos.
     * Radar móvil: 120 minutos.
5. descripcion (string):
   - Resumen situacional claro y COMPLETO (entre 12 y 25 palabras, NO recortar a 8 palabras).
   - Debe redactarse en español argentino neutral para ser leído por voz TTS al chofer mientras conduce.
   - Debe CONSERVAR TODO EL CONTEXTO: tipo de control, calles/altura, mano o sentido de circulación (ej: mano al centro o mano al sur), y detalles clave como motos (si paran motos), conos (si hay conos puestos), grúa (si hay grúa/carretón remolcando), o alcoholemia.
6. esLevantado (boolean):
   - true si el reporte avisa afirmativamente que el control se fue, se levantó o "ya está limpio".
7. confianza (number):
   - Valor entre 0.0 y 1.0 según la certeza del reporte.

Responde ÚNICAMENTE con JSON válido (responseMimeType application/json) con las claves:
esAlerta, tipo, ubicacion, vigenciaMinutos, descripcion, esLevantado, confianza`;

            let res = null;
            for (const mName of CENTINELA_MODELS) {
                try {
                    res = await ai.models.generateContent({
                        model: mName,
                        contents: prompt,
                        config: {
                            responseMimeType: 'application/json'
                        }
                    });
                    if (res && res.text) break;
                } catch(mErr) {
                    console.warn(`⚠️ [CENTINELA-GEMINI] Modelo ${mName} no disponible (${mErr.status || mErr.message}), intentando fallback...`);
                }
            }

            if (res && res.text) {
                const parsed = JSON.parse(res.text.trim());
                const cleanUbicacion = parsed.ubicacion ? rosarioGeoAtlas.normalizeRosarioStreets(parsed.ubicacion) : null;
                console.log(`🤖 [CENTINELA-GEMINI] Alerta=${parsed.esAlerta} | Tipo=${parsed.tipo} | Ubicación="${cleanUbicacion}" | Vigencia=${parsed.vigenciaMinutos}m | "${parsed.descripcion}"`);
                return {
                    esAlerta: Boolean(parsed.esAlerta),
                    tipo: String(parsed.tipo || 'checkpoint'),
                    ubicacion: cleanUbicacion,
                    vigenciaMinutos: Number(parsed.vigenciaMinutos) || 60,
                    descripcion: String(parsed.descripcion || text.substring(0, 120)),
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
Escuchá este audio atentamente y responde ÚNICAMENTE en JSON válido (responseMimeType: application/json).

MODERACIÓN: Si el audio dice insultos (puto, puta, concha, pija, culo, verga, boludo, pelotudo, forro, etc.), ELIMINÁ esas palabras y transcribí el resto del mensaje vial informativo de manera limpia y completa.

REGLAS DE EXTRACCIÓN (CONSERVAR CONTEXTO COMPLETO SIN MUTILAR):
1. transcripcion (string): Transcripción fiel, completa y de principio a fin de todo lo que se dice en el audio, sin cortar oraciones ni resumir.
2. descripcion (string): Frase informativa y completa para locución TTS (entre 12 y 25 palabras, sin recorte artificial a 8 palabras). Debe conservar TODO el contexto operativo:
   - Si advierten sobre motos ("están parando solo motos" / "cuidado las motos")
   - Si hay conos en el asfalto ("con conos puestos")
   - Si hay grúa o carretón ("con grúa levantando autos")
   - Mano de circulación o sentido ("mano hacia el centro", "mano al sur", "carril rápido")
   - Documentación o alcoholemia ("piden seguro y tarjeta verde", "alcoholemia")
3. ubicacion (string o null): Normalizar jerga rosarina a su nombre formal:
   - "27" -> "Av. 27 de Febrero", "Pelle" -> "Av. Pellegrini", "Circunvalacion" -> "Av. Circunvalación", "Rondeau" -> "Bv. Rondeau", "Ovidio Lagos" -> "Av. Ovidio Lagos", "San Martin" -> "Av. San Martín", "Oroño" -> "Bv. Oroño", "Peron" -> "Av. Presidente Perón".
   - Si dice "entre calle A y calle B" (ej: "Alem entre 27 de Febrero y Gálvez"), normalizar a ese formato exacto: "Alem entre Av. 27 de Febrero y Gálvez".
4. esAlerta (boolean): true si reporta control, operativo, accidente, radar o control levantado/limpio. false si es charla común o consulta ("¿hay algo en...?").
5. tipo (string): municipal, police, checkpoint, radar, accident, traffic, warning.
6. vigenciaMinutos (number): minutos de vigencia estimados (30 para levantado, 60 a 90 para control activo, 45 para accidente).
7. esLevantado (boolean): true si avisa que el operativo se fue o está limpio.
8. confianza (number): 0.0 a 1.0.

JSON esperado: {"esAlerta":true,"tipo":"municipal","ubicacion":"Alem entre Av. 27 de Febrero y Gálvez","vigenciaMinutos":60,"descripcion":"Control municipal con conos y grúa en Alem entre 27 de Febrero y Gálvez, mano al centro parando motos","transcripcion":"...","esLevantado":false,"confianza":0.9}`;

            let res = null;
            for (const mName of CENTINELA_MODELS) {
                try {
                    res = await ai.models.generateContent({
                        model: mName,
                        contents: [{
                            role: 'user',
                            parts: [
                                { inlineData: { mimeType: cleanMimeType, data: audioB64 } },
                                { text: prompt }
                            ]
                        }],
                        config: {
                            responseMimeType: 'application/json'
                        }
                    });
                    if (res && res.text) break;
                } catch (mErr) {
                    console.warn(`⚠️ [CENTINELA-AUDIO] Modelo ${mName} no disponible (${mErr.status || mErr.message}), intentando fallback...`);
                }
            }

            if (res && res.text) {
                const parsed = JSON.parse(res.text.trim());
                const cleanUbicacion = parsed.ubicacion ? rosarioGeoAtlas.normalizeRosarioStreets(parsed.ubicacion) : null;
                console.log(`🎙️ [CENTINELA-AUDIO] Alerta=${parsed.esAlerta} | Tipo=${parsed.tipo} | Ubicacion="${cleanUbicacion}" | Vigencia=${parsed.vigenciaMinutos}m`);
                return {
                    esAlerta: Boolean(parsed.esAlerta),
                    tipo: String(parsed.tipo || 'checkpoint'),
                    ubicacion: cleanUbicacion,
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

    // Extracción de calles: entre calle A y calle B, o calle y calle
    let ubicacion = null;
    const entreMatch = text.match(/([a-zA-Z0-9áéíóúñÁÉÍÓÚÑ.\s]+?)\s+(?:entre|e\/)\s+([a-zA-Z0-9áéíóúñÁÉÍÓÚÑ.\s]+?)\s+[yYeE]\s+([a-zA-Z0-9áéíóúñÁÉÍÓÚÑ.\s]+)/i);
    if (entreMatch) {
        ubicacion = rosarioGeoAtlas.normalizeRosarioStreets(`${entreMatch[1].trim()} entre ${entreMatch[2].trim()} y ${entreMatch[3].trim()}`);
    } else {
        const match = text.match(/([a-zA-Z0-9áéíóúñÁÉÍÓÚÑ.\s]+?)\s+[yYeE]\s+([a-zA-Z0-9áéíóúñÁÉÍÓÚÑ.\s]+)/i);
        ubicacion = match ? rosarioGeoAtlas.normalizeRosarioStreets(`${match[1].trim()} y ${match[2].trim()}`) : null;
    }

    const hasKeywords = /operativo|control|policia|zorros|fiscalizacion|fisca|accidente|radar|chanchos|motos|grua|conos/.test(t);
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
 * 3. Geocodificación inteligente (Rosario Geo Atlas + Fallback Photon)
 * Resuelve con precisión puntos medios "entre Calle A y Calle B" y prohíbe caer en el centroide de Rosario.
 * @param {string} ubicacion
 * @param {string} city
 * @returns {Promise<{lat: number, lng: number, approximate: boolean, formattedAddress: string}>}
 */
async function geocodeLocation(ubicacion, city = 'Rosario') {
    return await rosarioGeoAtlas.geocodeRosarioLocation(ubicacion, city);
}

/**
 * 4. Despacha y publica la alerta en tiempo real en Firebase (global y flotas)
 * @param {object} classification { esAlerta, tipo, ubicacion, vigenciaMinutos, descripcion, esLevantado }
 * @param {object} options { authorName, groupName, fleetId, messageId, originalText, audioUrl, source }
 * @param {object} db Firebase Admin Database
 * @returns {Promise<{dispatched: boolean, alertId: string|null, alertData: object|null}>}
 */
async function dispatchAlert(classification, options = {}, db) {
    if (_agentConfig && _agentConfig.sentinelEnabled === false) {
        console.log('⏸️ [CENTINELA-DESPACHO] Omitido: Centinela IA está pausado por el usuario.');
        return { dispatched: false, alertId: null, alertData: null, reason: 'sentinel_paused' };
    }

    if (!classification || !classification.esAlerta) {
        return { dispatched: false, alertId: null, alertData: null, reason: 'not_an_alert' };
    }

    if (!db) {
        console.error('❌ [CENTINELA-DESPACHO] Error: Firebase db no proporcionada.');
        return { dispatched: false, alertId: null, alertData: null, reason: 'database_unavailable' };
    }

    const city = options.city || 'Rosario';
    const rawLoc = classification.ubicacion || options.originalText || '';
    const cleanUbicacion = (rosarioGeoAtlas && typeof rosarioGeoAtlas.cleanAddressForGeocoding === 'function')
        ? rosarioGeoAtlas.cleanAddressForGeocoding(rawLoc, city)
        : rawLoc;

    let geo = null;
    try {
        geo = await geocodeLocation(cleanUbicacion, city);
    } catch (gErr) {
        console.warn(`⚠️ [CENTINELA-DESPACHO] Error en geocodeLocation: ${gErr.message}`);
    }

    const cityCoords = (rosarioGeoAtlas && typeof rosarioGeoAtlas.getCityCentroid === 'function')
        ? rosarioGeoAtlas.getCityCentroid(city)
        : { lat: -32.9468, lng: -60.6393 };

    let finalLat = (geo && typeof geo.lat === 'number' && !isNaN(geo.lat)) ? geo.lat : cityCoords.lat;
    let finalLng = (geo && typeof geo.lng === 'number' && !isNaN(geo.lng)) ? geo.lng : cityCoords.lng;
    let isApprox = geo ? Boolean(geo.approximate) : true;

    // Sanitización de seguridad previa a construir el objeto
    if (typeof finalLat !== 'number' || isNaN(finalLat) || typeof finalLng !== 'number' || isNaN(finalLng)) {
        finalLat = -32.9468;
        finalLng = -60.6393;
        isApprox = true;
        console.warn(`⚠️ [CENTINELA-DESPACHO] Fallback de seguridad a centroide de Rosario (-32.9468, -60.6393)`);
    }

    const safeMsgId = options.messageId ? `wsp_${options.messageId.replace(/[^a-zA-Z0-9_]/g, '_')}` : `ia_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const alertId = safeMsgId;
    const author = options.authorName || options.groupName || 'Agente Centinela IA';
    const vigenciaMs = (classification.vigenciaMinutos || 60) * 60 * 1000;

    const alertData = {
        id: alertId,
        type: classification.tipo || 'checkpoint',
        location: cleanUbicacion || (geo && geo.formattedAddress) || 'Ubicación identificada',
        lat: finalLat,
        lng: finalLng,
        timestamp: Date.now(),
        expiresAt: Date.now() + vigenciaMs,
        authorName: author,
        originalText: options.originalText || classification.descripcion || '',
        description: classification.descripcion || options.originalText || '',
        confirmations: 1,
        status: 'active',
        source: options.source || 'gemini_agent',
        approximate: isApprox,
        isLifting: Boolean(classification.esLevantado),
        vigenciaMinutos: classification.vigenciaMinutos || 60,
        confianza: classification.confianza || 0.85
    };

    if (options.audioUrl) {
        alertData.audioUrl = options.audioUrl;
    } else {
        // Conversión automática de alerta de texto a audio MP3
        try {
            const ttsService = require('./ttsService');
            const alertTypeNames = {
                police: 'Control de Policía',
                checkpoint: 'Operativo de control',
                radar: 'Radar de velocidad',
                municipal: 'Fiscalización Municipal',
                traffic: 'Alerta de Tráfico',
                accident: 'Accidente en la vía',
                warning: 'Alerta de Tránsito'
            };
            const label = alertTypeNames[alertData.type] || 'Alerta de Tránsito';
            const alertText = classification.descripcion || cleanUbicacion || options.originalText || 'Alerta de tránsito';
            const speechText = `Atención: ${label}. ${alertText}`;
            const generatedUrl = await ttsService.generateAlertAudio(speechText, alertId);
            if (generatedUrl) {
                alertData.audioUrl = generatedUrl;
                console.log(`🎙️ [CENTINELA-AUDIO] Audio generado y asignado para alerta de texto: ${generatedUrl}`);
            }
        } catch(ttsErr) {
            console.warn(`⚠️ [CENTINELA-AUDIO] Error generando audio para alerta de texto:`, ttsErr.message);
        }
    }

    // SANITIZACIÓN ESTRICTA PREVIA A FIREBASE:
    // Eliminar cualquier propiedad undefined que rompa Firebase Realtime Database
    Object.keys(alertData).forEach(k => {
        if (alertData[k] === undefined) delete alertData[k];
    });

    if (typeof alertData.lat !== 'number' || isNaN(alertData.lat) || typeof alertData.lng !== 'number' || isNaN(alertData.lng)) {
        console.error(`🚨 [CENTINELA-DESPACHO] ABORTANDO guardado en Firebase: Coordenadas inválidas en alerta ${alertId}`);
        return { dispatched: false, alertId: null, alertData: null, reason: 'invalid_coordinates' };
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
            const tokens = Object.values(tokensVal).map(t => typeof t === 'object' ? t.token : t).filter(t => typeof t === 'string' && t.length > 10);

            if (tokens.length > 0) {
                const message = {
                    notification: { title, body },
                    data: {
                        alertId: alertId,
                        type: alertData.type || 'checkpoint',
                        location: alertData.location || '',
                        description: alertData.description || ''
                    },
                    android: {
                        priority: 'high',
                        notification: {
                            sound: 'default',
                            channelId: 'traffic_alerts'
                        }
                    },
                    tokens: tokens
                };
                admin.messaging().sendEachForMulticast(message).catch((err) => {
                    console.warn('⚠️ [CENTINELA-PUSH] Error en sendEachForMulticast:', err.message);
                });
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
    setGeminiKey,
    getGeminiClient,
    classifyTrafficReport,
    transcribeAndClassifyAudio,
    geocodeLocation,
    dispatchAlert,
    updateAgentConfig,
    getAgentConfig
};
