/* ============================================
   FleetAdmin Pro — WhatsApp Bot Worker (v201 - Baileys Fix)
   Escucha grupos de Rosario, detecta operativos y sincroniza con Firebase.
   Usa Baileys (ultra-liviano, sin navegador).
   ============================================ */

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
// Logger completamente silencioso para Baileys (evita spam de llaves criptográficas)
const P = () => ({
    level: 'silent',
    trace: () => {}, debug: () => {}, info: () => {},
    warn: () => {}, error: () => {}, fatal: () => {},
    child: () => P()
});
try {
    require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
} catch (e) {
    try { require('dotenv').config(); } catch (err) {}
}

const axios = require('axios');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Gemini via HTTP directo (sin SDK, evita problemas de versiones)
let _dynamicGeminiKey = null;

function getGeminiKey() {
    return process.env.GEMINI_API_KEY || _dynamicGeminiKey || null;
}
const GEMINI_KEY = getGeminiKey();

// Modelos estables actuales y validados de Google AI Studio para esta Key
const GEMINI_MODELS = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent'
];
let GEMINI_URL = null; // Se inicializa al primer uso exitoso
let GEMINI_AUDIO_URL = null; // Se inicializa al primer uso de audio exitoso


async function callGemini(prompt) {
    const key = getGeminiKey();
    if (!key) return null;
    const urls = GEMINI_URL ? [GEMINI_URL] : GEMINI_MODELS;
    for (const url of urls) {
        try {
            const res = await axios.post(`${url}?key=${key}`, {
                contents: [{ parts: [{ text: prompt }] }]
            }, { timeout: 8000 });
            const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (text) {
                if (!GEMINI_URL) { GEMINI_URL = url; console.log(`✅ Gemini activo: ${url.split('/models/')[1].split(':')[0]}`); }
                return text;
            }
        } catch (e) {
            console.warn(`⚠️ [GEMINI] ${url.split('/models/')[1]?.split(':')[0]} falló: ${e.response?.data?.error?.message || e.message}`);
        }
    }
    return null;
}

/**
 * Analiza el CONTENIDO de un audio con Gemini multimodal.
 * Transcribe el audio y determina si es una alerta de tránsito real.
 * @returns {Promise<{isTrafficAlert: boolean, transcription: string, type: string, address: string|null, reason: string}|null>}
 */
async function callGeminiAudio(audioBuffer, mimeType, groupName = '') {
    const key = getGeminiKey();
    if (!key || !audioBuffer) {
        if (db) {
            try {
                await db.ref('bot_debug_logs').push({
                    event: 'gemini_audio_skipped',
                    reason: !key ? 'missing_key' : 'missing_buffer',
                    timestamp: Date.now()
                });
            } catch (dbErr) {}
        }
        return null;
    }

    const audioB64 = audioBuffer.toString('base64');
    // Limite seguro: ~10MB en base64. Las notas de voz de WhatsApp son << 1MB normalmente.
    if (audioB64.length > 12 * 1024 * 1024) {
        console.warn('⚠️ [GEMINI-AUDIO] Audio demasiado grande para análisis inline, saltando.');
        if (db) {
            try {
                await db.ref('bot_debug_logs').push({
                    event: 'gemini_audio_skipped',
                    reason: 'size_limit_exceeded',
                    size: audioBuffer.length,
                    timestamp: Date.now()
                });
            } catch (dbErr) {}
        }
        return null;
    }

    const prompt = `Sos un asistente de seguridad vial para taxistas en Argentina.
Escuchá este audio de un grupo de WhatsApp y respondé SOLO con JSON válido (sin markdown).

CONTEXTO GEOGRÁFICO DE ORIGEN:
- Nombre del Grupo de WhatsApp: "${groupName}"

REGLA DE DEDUCCIÓN ESPACIAL (CRÍTICA):
Los conductores raramente dicen la ciudad completa en el audio. Debes DEDUCIR e INFERIR la ubicación basándote fuertemente en el NOMBRE DEL GRUPO o en palabras clave que escuches.
- Ciudades comunes en la región: "Rosario", "Arroyo Seco", "Pueblo Esther", "Funes", "Roldán", "San Lorenzo", "Granadero Baigorria", "Capitán Bermúdez", "Villa Constitución", "Pérez", "Ibarlucea", "Alvear", "Villa Gobernador Gálvez" (VGG).
- Si el nombre del grupo menciona una de estas ciudades (ej: "Operativos Arroyo Seco"), asume ese contexto geográfico y agrégalo explícitamente a la dirección que devuelvas (por ejemplo, si dicen "están en la entrada" en el grupo de Arroyo Seco, pon "Acceso, Arroyo Seco").

Determiná:
1. Si el audio reporta alguna situación de tránsito activa: operativo policial, control de tránsito, radar/fotomulta, accidente, corte de calle, embotellamiento, camión volcado, etc.
2. La transcripción exacta de lo que dice el audio
3. El tipo de alerta: police / checkpoint / radar / accident / traffic / warning
4. La dirección o intersección mencionada (null si no hay ninguna)

REGLA DE EXCLUSIÓN DE PREGUNTAS Y CONSULTAS (CRÍTICA):
- Si el audio es una pregunta, consulta, duda o pedido de información (por ejemplo: "¿hay algo de arroyo a pavón?", "¿está limpio tal lugar?", "¿alguien sabe si están los zorros en Pellegrini?", "¿cómo está la autopista?", "algo de arroyo a pavón?", "algo de arroyo a pavón"), responde ESTRICTAMENTE con "isTrafficAlert": false.
- Solo debes marcar "isTrafficAlert": true para reportes AFIRMATIVOS, CONFIRMADOS y CONCRETOS de incidentes o controles activos (por ejemplo: "hay operativo de arroyo a pavón", "están parando los zorros en Pellegrini").

Si el audio es: conversación personal, música, tutorial, broma, saludos, venta de productos, noticias generales, o cualquier cosa NO relacionada con el tránsito activo en las calles → "isTrafficAlert": false.

Respuesta EXACTAMENTE en este formato:
{"isTrafficAlert":true,"transcription":"texto del audio","type":"checkpoint","address":"Bv Oroño y Corrientes","reason":"menciona control policial en intersección"}`;

    // Los modelos Flash soportan audio inline.
    const audioModels = GEMINI_AUDIO_URL ? [GEMINI_AUDIO_URL] : [
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent'
    ];

    const cleanMimeType = (mimeType || 'audio/ogg').split(';')[0].trim();

    for (const url of audioModels) {
        try {
            const res = await axios.post(`${url}?key=${key}`, {
                contents: [{
                    parts: [
                        { inlineData: { mimeType: cleanMimeType, data: audioB64 } },
                        { text: prompt }
                    ]
                }]
            }, { timeout: 25000 });

            const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (rawText) {
                try {
                    const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                    const parsed = JSON.parse(clean);
                    console.log(`🤖 [GEMINI-AUDIO] isAlert=${parsed.isTrafficAlert} | Tipo=${parsed.type} | Razón="${parsed.reason}" | Transcripción="${(parsed.transcription||'').substring(0,60)}"`);
                    
                    if (!GEMINI_AUDIO_URL) {
                        GEMINI_AUDIO_URL = url;
                        console.log(`✅ [GEMINI-AUDIO] Modelo de audio activo y memorizado: ${url.split('/models/')[1]?.split(':')[0]}`);
                    }

                    if (db) {
                        try {
                            await db.ref('bot_debug_logs').push({
                                event: 'gemini_audio_success',
                                url: url.split('/models/')[1]?.split(':')[0],
                                mimeType: cleanMimeType,
                                size: audioBuffer.length,
                                result: parsed,
                                timestamp: Date.now()
                            });
                        } catch (dbErr) {}
                    }
                    return parsed;
                } catch (parseErr) {
                    console.warn('⚠️ [GEMINI-AUDIO] No se pudo parsear JSON de respuesta:', rawText.substring(0, 150));
                    
                    if (db) {
                        try {
                            await db.ref('bot_debug_logs').push({
                                event: 'gemini_audio_parse_error',
                                url: url.split('/models/')[1]?.split(':')[0],
                                mimeType: cleanMimeType,
                                size: audioBuffer.length,
                                rawText: rawText,
                                error: parseErr.message,
                                timestamp: Date.now()
                            });
                        } catch (dbErr) {}
                    }

                    const isAlert = /isTrafficAlert.*true/i.test(rawText);
                    return { isTrafficAlert: isAlert, transcription: rawText.substring(0, 200), type: 'checkpoint', address: null, reason: 'parse_fallback' };
                }
            }
        } catch (e) {
            const errMsg = e.response?.data?.error?.message || e.message;
            console.warn(`⚠️ [GEMINI-AUDIO] ${url.split('/models/')[1]?.split(':')[0]} falló: ${errMsg}`);
            
            // Si el modelo cacheado falló, invalidarlo para intentar la lista completa en la siguiente ejecución
            if (GEMINI_AUDIO_URL && url === GEMINI_AUDIO_URL) {
                console.log(`❌ [GEMINI-AUDIO] Modelo memorizado falló. Invalidando caché de modelo de audio.`);
                GEMINI_AUDIO_URL = null;
            }

            if (db) {
                try {
                    await db.ref('bot_debug_logs').push({
                        event: 'gemini_audio_model_error',
                        url: url.split('/models/')[1]?.split(':')[0],
                        mimeType: cleanMimeType,
                        size: audioBuffer.length,
                        error: errMsg,
                        status: e.response?.status || null,
                        timestamp: Date.now()
                    });
                } catch (dbErr) {}
            }
        }
    }

    if (db) {
        try {
            await db.ref('bot_debug_logs').push({
                event: 'gemini_audio_failed_all_models',
                mimeType: cleanMimeType,
                size: audioBuffer.length,
                hasKey: !!GEMINI_KEY,
                keySnippet: GEMINI_KEY ? `${GEMINI_KEY.substring(0, 5)}...${GEMINI_KEY.substring(GEMINI_KEY.length - 5)}` : 'none',
                timestamp: Date.now()
            });
        } catch (dbErr) {}
    }
    return null;
}


/**
 * Analiza el CONTENIDO de una imagen con Gemini multimodal.
 * Determina si la imagen muestra una alerta de tránsito real (por ejemplo, grúas, zorros, patrullas,
 * operativo, control de tránsito, cartel de fiscalización, conos de control, etc.).
 * @returns {Promise<{isTrafficAlert: boolean, description: string, type: string, address: string|null, reason: string}|null>}
 */
async function callGeminiImage(imageBuffer, mimeType) {
    if (!GEMINI_KEY || !imageBuffer) return null;

    const imageB64 = imageBuffer.toString('base64');
    if (imageB64.length > 12 * 1024 * 1024) {
        console.warn('⚠️ [GEMINI-IMAGE] Imagen demasiado grande para análisis inline, saltando.');
        return null;
    }

    const prompt = `Sos un asistente de seguridad vial para taxistas de Rosario, Argentina.
Analizá esta imagen enviada en un grupo de WhatsApp y respondé SOLO con un objeto JSON válido (sin markdown ni bloques de código).

Determiná:
1. Si la imagen reporta o muestra una situación de tránsito activa: control de tránsito, inspectores municipales ("zorros" o "chanchos"), grúas ("carretón"), operativos policiales, patrullas de policía, conos de tránsito bloqueando carriles, carteles de "Fiscalización de Transporte", radares de fotomulta, accidentes de tránsito, cortes de calle, bomberos o ambulancias en escena.
2. Si la imagen contiene texto escrito (carteles, folletos informativos, capturas de pantalla con texto sobre controles), leelo y extraelo.
3. El tipo de alerta: police / checkpoint / radar / accident / traffic / municipal / warning
4. La dirección o intersección mencionada en el texto dentro de la imagen (null si no hay ninguna).
5. Un resumen muy breve de lo que se ve en la imagen (máximo 8 palabras) en español.

Si la imagen es una foto común y corriente (paisaje, selfie, comida, meme genérico, foto de un auto circulando normal, saludo, publicidad) o cualquier cosa NO relacionada con un operativo de control o incidente vial activo → isTrafficAlert: false.

Respuesta EXACTAMENTE en este formato JSON:
{"isTrafficAlert":true,"description":"Operativo de fiscalización con conos y patrulla","type":"municipal","address":null,"reason":"Muestra vehículo de fiscalización y texto de operativo urgente"}`;

    const imageModels = [
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent'
    ];

    const cleanMimeType = (mimeType || 'image/jpeg').split(';')[0].trim();

    for (const url of imageModels) {
        try {
            const res = await axios.post(`${url}?key=${GEMINI_KEY}`, {
                contents: [{
                    parts: [
                        { inlineData: { mimeType: cleanMimeType, data: imageB64 } },
                        { text: prompt }
                    ]
                }]
            }, { timeout: 25000 });

            const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (rawText) {
                try {
                    const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                    const parsed = JSON.parse(clean);
                    console.log(`🤖 [GEMINI-IMAGE] isAlert=${parsed.isTrafficAlert} | Tipo=${parsed.type} | Razón="${parsed.reason}" | Desc="${parsed.description}"`);
                    return parsed;
                } catch (parseErr) {
                    console.warn('⚠️ [GEMINI-IMAGE] No se pudo parsear JSON de respuesta:', rawText.substring(0, 150));
                    const isAlert = /isTrafficAlert.*true/i.test(rawText);
                    return { isTrafficAlert: isAlert, description: 'Imagen de tránsito', type: 'checkpoint', address: null, reason: 'parse_fallback' };
                }
            }
        } catch (e) {
            console.warn(`⚠️ [GEMINI-IMAGE] ${url.split('/models/')[1]?.split(':')[0]} falló: ${e.response?.data?.error?.message || e.message}`);
        }
    }
    return null;
}

/**
 * Analiza un comprobante de pago, transferencia bancaria, factura o ticket con Gemini multimodal.
 * Extrae tipo (Ingreso/Egreso), monto, fecha, emisor/receptor/comercio y concepto.
 * @returns {Promise<{isReceipt: boolean, type: string, amount: number, party: string, concept: string, date: string}|null>}
 */
async function callGeminiReceipt(imageBuffer, mimeType) {
    const key = getGeminiKey();
    if (!key || !imageBuffer) return null;

    const imageB64 = imageBuffer.toString('base64');
    if (imageB64.length > 12 * 1024 * 1024) return null;

    const prompt = `Sos un asistente contable para flotas de transporte, taxis y remises en Argentina.
Analizá esta imagen de un comprobante de pago, transferencia bancaria, billetera digital, factura comercial o ticket de compra (ej: MercadoPago, Cuenta DNI, BNA+, Santander, Galicia, Brubank, Ualá, Lemon, NaranjaX, YPF, Shell, Axion, AFIP, ticket de taller/repuestos, peaje, gnc, etc.) y respondé SOLO con un objeto JSON válido (sin formato markdown ni bloques de código).

Determiná:
1. Si la imagen es un comprobante válido de transferencia bancaria, pago digital, recibo de dinero o factura/ticket de gasto -> "isReceipt": true.
2. Si es una transferencia/pago recibido (cobro, recaudación de chofer) -> "type": "Ingreso".
   Si es un gasto, factura, compra de combustible, repuesto, peaje, multa o pago realizado -> "type": "Egreso".
3. El monto numérico total (solo el número decimal con punto, sin el símbolo $, ej: 15450.50) -> "amount".
4. El emisor, receptor o comercio (nombre de la persona, banco, estación de servicio o comercio) -> "party".
5. El concepto o motivo (ej: "Carga de combustible YPF", "Recaudación de turno", "Transferencia recibida", "Reparación mecánica", "Alquiler") -> "concept".
6. La fecha del comprobante en formato ISO (AAAA-MM-DDTHH:mm:ss) o AAAA-MM-DD -> "date".

Si la imagen NO es ningún comprobante de transferencia, pago, factura ni ticket -> "isReceipt": false.

Respuesta EXACTAMENTE en este formato JSON:
{"isReceipt":true,"type":"Ingreso","amount":15450.00,"party":"MercadoPago - Juan Pérez","concept":"Recaudación de turno","date":"2026-09-09T14:30:00.000Z"}`;

    const models = [
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    ];

    const cleanMimeType = (mimeType || 'image/jpeg').split(';')[0].trim();

    for (const url of models) {
        try {
            const res = await axios.post(`${url}?key=${key}`, {
                contents: [{
                    parts: [
                        { inlineData: { mimeType: cleanMimeType, data: imageB64 } },
                        { text: prompt }
                    ]
                }]
            }, { timeout: 25000 });

            const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (rawText) {
                try {
                    const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                    const parsed = JSON.parse(clean);
                    console.log(`🧾 [GEMINI-RECEIPT] isReceipt=${parsed.isReceipt} | Tipo=${parsed.type} | Monto=$${parsed.amount} | Emisor=${parsed.party}`);
                    return parsed;
                } catch (parseErr) {
                    console.warn('⚠️ [GEMINI-RECEIPT] JSON parse falló:', rawText.substring(0, 150));
                }
            }
        } catch (e) {
            console.warn(`⚠️ [GEMINI-RECEIPT] ${url.split('/models/')[1]?.split(':')[0]} falló: ${e.message}`);
        }
    }
    return null;
}

/**
 * Analiza un mensaje de texto para detectar avisos de transferencias o pagos de choferes.
 * @param {string} text
 * @param {string} senderName
 * @returns {Promise<{isReceipt: boolean, type: string, amount: number, party: string, concept: string, date: string}|null>}
 */
async function callGeminiTextReceipt(text, senderName = 'Chofer') {
    if (!text || text.length < 5) return null;
    const key = getGeminiKey();
    if (!key) return null;

    const lower = text.toLowerCase();
    const hasTransferKw = /(transfer[ií]|transferencia|transferido|te pase|te pasé|deposito|depósito|comprobante|pago|pagado|cbu|alias|mp|mercadopago|recaudaci[oó]n|turno|seña)/i.test(lower);
    const hasAmount = /[\$]?\s*\d+([.,]\d+)?/.test(lower);

    if (!hasTransferKw || !hasAmount) return null;

    const prompt = `Sos un asistente contable para flotas de transporte en Argentina.
Analizá este mensaje de WhatsApp enviado por "${senderName}":
"${text}"

Determiná si este mensaje informa una transferencia de dinero, pago de recaudación, entrega de dinero o gasto operativo de la flota.
Respondé ÚNICAMENTE en formato JSON:
1. Si informa una transferencia/pago/gasto real: "isReceipt": true. De lo contrario: "isReceipt": false.
2. "type": "Ingreso" (si es recaudación, transferencia recibida o pago de chofer) o "Egreso" (si es gasto de nafta, taller, etc.).
3. "amount": número decimal con el monto transferido/pagado (solo el número, sin $).
4. "party": nombre o alias del emisor o chofer ("${senderName}").
5. "concept": breve descripción ("Recaudación de turno", "Pago combustible", etc.).
6. "date": fecha en formato ISO.

Ejemplo JSON:
{"isReceipt":true,"type":"Ingreso","amount":15000,"party":"${senderName}","concept":"Recaudación de turno","date":"${new Date().toISOString()}"}`;

    const models = [
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    ];

    for (const url of models) {
        try {
            const res = await axios.post(`${url}?key=${key}`, {
                contents: [{ parts: [{ text: prompt }] }]
            }, { timeout: 12000 });

            const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (rawText) {
                const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                const parsed = JSON.parse(clean);
                if (parsed.isReceipt && parsed.amount > 0) {
                    console.log(`💬 [TEXT-RECEIPT] Transferencia detectada en texto: $${parsed.amount} (${parsed.concept})`);
                    return parsed;
                }
            }
        } catch (e) {
            console.warn(`⚠️ [GEMINI-TEXT-RECEIPT] Falló modelo: ${e.message}`);
        }
    }
    return null;
}

/**
 * Analiza un mensaje de texto para detectar avisos o promesas de entrega de efectivo.
 * @param {string} text
 * @param {string} senderName
 * @returns {Promise<{isCash: boolean, amount: number, party: string, concept: string, date: string}|null>}
 */
async function callGeminiCashReceipt(text, senderName = 'Chofer') {
    if (!text || text.length < 5) return null;
    const key = getGeminiKey();
    if (!key) return null;

    const prompt = `Sos un asistente contable para flotas de transporte y taxis en Argentina.
Analizá este mensaje enviado por un chofer ("${senderName}"):
"${text}"

Determiná si el chofer informa una ENTREGA DE EFECTIVO (recaudación en mano, pago de turno en billetes, entrega de plata, etc.).
Respondé ÚNICAMENTE en formato JSON:
1. Si informa una entrega o pago en efectivo: "isCash": true. De lo contrario: "isCash": false.
2. "amount": número decimal con el monto total en pesos (ej: si dice 40 mil, pon 40000; si dice 35.000 pon 35000).
3. "party": nombre o alias del chofer ("${senderName}").
4. "concept": breve descripción ("Entrega de efectivo", "Recaudación en mano", etc.).
5. "date": fecha en formato ISO.

Ejemplo JSON:
{"isCash":true,"amount":40000,"party":"${senderName}","concept":"Recaudación de turno en efectivo","date":"${new Date().toISOString()}"}`;

    const models = [
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    ];

    for (const url of models) {
        try {
            const res = await axios.post(`${url}?key=${key}`, {
                contents: [{ parts: [{ text: prompt }] }]
            }, { timeout: 12000 });

            const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (rawText) {
                const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                const parsed = JSON.parse(clean);
                if (parsed.isCash && parsed.amount > 0) {
                    console.log(`💵 [CASH-REPORT] Entrega de efectivo detectada: $${parsed.amount} (${parsed.concept})`);
                    return parsed;
                }
            }
        } catch(e) {
            console.warn(`⚠️ [GEMINI-CASH] Falló modelo: ${e.message}`);
        }
    }
    return null;
}



// 1. Inicialización de Firebase Admin

let db = null;

if (!admin.apps.length) {
    try {
        let credential = null;

        // MÉTODO 0 (LOCAL FALLBACK): Archivo físico en el servidor (JSON o Base64)
        let possiblePaths = [
            path.join(__dirname, '../../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json'),
            path.join(__dirname, '../../../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json'),
            path.join(__dirname, './fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json')
        ];

        let jsonPath = null;
        let base64Path = null;

        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                jsonPath = p;
                break;
            }
            if (fs.existsSync(p + '.base64')) {
                base64Path = p + '.base64';
                break;
            }
        }

        if (jsonPath) {
            console.log('🔑 Usando archivo físico de credenciales Firebase JSON...');
            try {
                const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                credential = admin.credential.cert(json);
                console.log(`📡 Config (local): project=${json.project_id}, email=${json.client_email?.substring(0,20)}...`);
            } catch (jsonErr) {
                console.warn('⚠️ Error parsing local JSON credentials:', jsonErr.message);
            }
        } else if (base64Path) {
            console.log('🔑 Usando archivo físico de credenciales Firebase Base64...');
            try {
                const base64Str = fs.readFileSync(base64Path, 'utf8').trim();
                const json = JSON.parse(Buffer.from(base64Str, 'base64').toString('utf8'));
                credential = admin.credential.cert(json);
                console.log(`📡 Config (local base64): project=${json.project_id}, email=${json.client_email?.substring(0,20)}...`);
            } catch (jsonErr) {
                console.warn('⚠️ Error parsing local Base64 credentials:', jsonErr.message);
            }
        }

        if (!credential) {
            // MÉTODO 1 (RECOMENDADO): JSON completo en base64
            if (process.env.FIREBASE_SERVICE_ACCOUNT) {
                console.log('🔑 Usando FIREBASE_SERVICE_ACCOUNT (JSON base64)...');
                const json = JSON.parse(
                    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8')
                );
                credential = admin.credential.cert(json);
                console.log(`📡 Config: project=${json.project_id}, email=${json.client_email?.substring(0,20)}...`);
            } 
            // MÉTODO 2 (FALLBACK): Variables individuales
            else {
                console.log('🔑 Usando variables individuales (PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY)...');
                const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim().replace(/^"|"$/g, '');
                const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim().replace(/^"|"$/g, '');
                let privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').trim().replace(/^"|"$/g, '');
                
                if (privateKey) {
                    // Render guarda \n como texto literal
                    privateKey = privateKey.replace(/\\n/g, '\n');
                }

                console.log(`📡 Config: ID=${projectId?.substring(0, 5)}..., KeyLength=${privateKey.length}`);

                if (!projectId || !clientEmail || privateKey.length < 100) {
                    throw new Error('Variables de Firebase incompletas o inválidas.');
                }

                credential = admin.credential.cert({ projectId, clientEmail, privateKey });
            }
        }

        admin.initializeApp({
            credential,
            databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${process.env.FIREBASE_PROJECT_ID || 'fleetadmin-pro'}-default-rtdb.firebaseio.com`,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID || 'fleetadmin-pro'}.firebasestorage.app`
        });
        
        db = admin.database();
        console.log('✅ Firebase Admin: ¡Inicializado con éxito!');
    } catch (e) {
        console.error('❌ Firebase Admin:', e.message);
    }
}

/**
 * Módulo de Lógica del Bot (Baileys v201 - Conexión Robusta)
 */
const WhatsappBot = (() => {
    let sock = null;
    let retryCount = 0;
    let isConnecting = false; // Cerrojo (LOCK) anti-clones paralelos
    let _isConnectedState = false; // Rastreador de estado para API
    let _stableTimer = null; // Validador de salud de conexión
    const MAX_RETRIES = 10;
    const AUTH_DIR = './auth_info';
    const groupAddressContext = {}; // key: jid, value: { address: string, timestamp: number }
    const groupNameCache = {}; // key: jid, value: groupName (string)

    function _syncBotStatus() {
        if (db) {
            db.ref('bot_status').set({
                connected: _isConnectedState,
                timestamp: Date.now()
            }).catch(e => console.error('⚠️ [STATUS] Error syncing bot status:', e.message));
        }
    }

    // Diccionario de Slang Rosarino (Sincronizado con el cliente)
    const ALERT_KEYWORDS = ['gorra', 'operativo', 'control', 'zorros', 'chanchos', 'palo', 'parando', 'evitar', 'ratis'];

    // Lista de palabras/insultos prohibidos para censura o rechazo de alertas (Modo Moderación)
    const FORBIDDEN_WORDS = [
        'boludo', 'boluda', 'puto', 'puta', 'conchudo', 'conchuda', 'concha', 'tarado', 'tarada',
        'hijo de puta', 'hija de puta', 'hdp', 'forro', 'forra', 'pelotudo', 'pelotuda', 'orto',
        'pajero', 'pajera', 'cagon', 'cagona', 'culiao', 'culiada', 'pija', 'chota', 'mierda',
        'trola', 'trolo'
    ];

    function _containsForbiddenWords(text) {
        if (!text) return false;
        const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return FORBIDDEN_WORDS.some(word => {
            // Check for substring match to be extra safe and catch variations like "boludoo"
            return normalized.includes(word);
        });
    }

    function _hasTrafficKeywords(text) {
        if (!text) return false;
        const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const keywords = [
            'operativo', 'control', 'zorros', 'policia', 'municipal', 'transito', 
            'chanchos', 'gorra', 'ratis', 'radar', 'movil', 'seguridad', 'camara', 
            'fotomulta', 'evitar', 'cana', 'alertas', 'reporte', 'accidente', 'choque', 
            'ambulancia', 'bomberos', 'heca', 'gendarme', 'gendarmeria', 'federal', 
            'parando', 'palo', 'inspeccion', 'limpio', 'libre', 'corte', 'demora',
            'motos', 'grua', 'carreton', 'fiscalizacion', 'fisca', 'servicios publicos'
        ];
        return keywords.some(kw => t.includes(kw));
    }

    function _isObviousChatter(text) {
        if (!text) return true;
        const t = text.toLowerCase().trim().replace(/[^a-z0-9áéíóúñ\s]/g, '');
        
        // Saludos y agradecimientos ultra-comunes
        const patterns = [
            /^(gracias|muchas gracias|gracias viejo|buenisimo gracias|joya gracias|excelente gracias|de 10 gracias|de diez gracias|gracias crack)$/,
            /^(hola|buen dia|buenos dias|buenas tardes|buenas noches|hola gente|hola grupo|buen dia gente|buen dia grupo)$/,
            /^(ok|okey|dale|listo|joya|espectacular|buenisimo|excelente|entendido|recibido)$/,
            /^(gracias por la info|gracias x la info|gracias por reportar|buenisimo el dato|buen dato)$/
        ];
        
        return patterns.some(p => p.test(t));
    }

    function _isOperativoGroup(groupName) {
        if (!groupName) return false;
        const gn = groupName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const keywords = [
            'operativo', 'control', 'zorros', 'policia', 'municipal', 'transito', 
            'chanchos', 'gorra', 'ratis', 'radar', 'movil', 'seguridad', 'camara', 
            'fotomulta', 'evitar', 'cana', 'alertas', 'reporte',
            'trabajo' // Grupo de pruebas del admin — Gemini filtra el contenido igual
        ];
        return keywords.some(kw => gn.includes(kw));
    }
    // Números de admin/dueño que pueden enviar alertas por chat privado
    // Formato: código de país + código de área + número (sin +)
    const TRUSTED_ADMIN_NUMBERS = [
        '5493415707731', // Número principal del bot/dueño (341-5707731)
        '5493417327248', // Segundo número de prueba/reenvío del admin (341-7327248)
    ];

    function _isTrustedAdmin(jid) {
        if (!jid) return false;
        if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) return false;
        const num = jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^0-9]/g, '');
        if (!num) return false;
        return TRUSTED_ADMIN_NUMBERS.some(t => num.endsWith(t) || t.endsWith(num));
    }

    function _hasTransferKeywords(mRaw) {
        if (!mRaw) return false;
        try {
            const str = typeof mRaw === 'string' ? mRaw.toLowerCase() : JSON.stringify(mRaw).toLowerCase();
            return /(transfer[ií]|transferencia|comprobante|recibo|factura|ticket|pago|pagado|\$|cbu|alias|sube|mercadopago|banco|recaudaci[oó]n|turno|saldo|debito|débito|credito|crédito)/i.test(str);
        } catch(e) {
            return false;
        }
    }

    function _hasCashKeywords(text) {
        if (!text || typeof text !== 'string') return false;
        try {
            const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const hasCashWords = /(efectivo|en mano|en billetes|billetes|te llevo la plata|te llevo el efectivo|te entrego|te paso a dejar|te dejo la plata|te llevo los|te acerco|te pago en mano|te pago en efectivo|recaudacion en mano|rindo la plata|rendicion en mano|te rindo|entrega de plata|entrega de efectivo|te llevo \d|te dejo \d|pago de turno en mano)/i.test(lower);
            const hasAmount = /[\$]?\s*\d+([.,]\d+)?(\s*k|\s*mil)?/i.test(lower);
            return hasCashWords && hasAmount;
        } catch(e) {
            return false;
        }
    }

    /**
     * Registra un pago/entrega pendiente de confirmación y notifica al administrador de flota vía WhatsApp
     */
    async function _createPendingPayment({ fleetId, driverName, driverId, senderNum, amount, method, concept, date, originalMsgId, jid, msg, origin = 'live' }) {
        if (!amount || amount <= 0) return null;
        const targetFleet = fleetId || await _resolveFleetId();

        // Generar código numérico de 4 dígitos para confirmación rápida (1000 - 9999)
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        const pendingId = 'pend_' + Date.now() + '_' + code;

        const senderDisplay = driverName 
            ? `${method} (${driverName})` 
            : (senderNum ? `${method} (+${senderNum})` : `${method}`);

        const pendingData = {
            id: pendingId,
            code: code,
            fleetId: targetFleet,
            type: 'Ingreso',
            amount: Number(amount) || 0,
            method: method || 'Transferencia', // 'Transferencia' | 'Efectivo'
            concept: concept || (method === 'Efectivo' ? 'Entrega de efectivo en mano' : 'Transferencia recibida'),
            party: senderDisplay,
            driverName: driverName || null,
            driverId: driverId || null,
            senderPhone: senderNum || null,
            date: date || new Date().toISOString(),
            status: 'pending', // 'pending' | 'confirmed' | 'rejected'
            createdAt: Date.now(),
            chatJid: jid || null,
            originalMsgId: originalMsgId || null,
            source: method === 'Efectivo' ? 'whatsapp_bot_cash' : 'whatsapp_bot_transfer'
        };

        if (db) {
            try {
                await db.ref(`fleets/${targetFleet}/pending_payments/${pendingId}`).set(pendingData);
                console.log(`⏳ [PENDING-PAYMENT] Pago #${code} registrado como pendiente en flota ${targetFleet} ($${pendingData.amount}, ${method})`);
            } catch(e) {
                console.error(`⚠️ [PENDING-PAYMENT] Error guardando pago pendiente en RTDB:`, e.message);
            }
        }

        const formattedMonto = Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2 });

        // Notificar al Administrador de confianza solicitando confirmación interactiva
        const adminAlert = 
            `🔔 *NUEVO INGRESO PARA CONFIRMAR*\n\n` +
            `👤 *Chofer:* ${driverName ? driverName : 'Chofer'} (+${senderNum || 'Sin número'})\n` +
            `💵 *Monto:* $${formattedMonto}\n` +
            `💳 *Medio:* ${method === 'Efectivo' ? '💵 Efectivo en mano' : '🏦 Transferencia bancaria'}\n` +
            `📝 *Concepto:* ${pendingData.concept}\n` +
            `🔢 *Código de Aprobación:* *${code}*\n\n` +
            `¿Confirmás el ingreso de este dinero al balance de la flota?\n` +
            `👉 Respondé *SI ${code}* para aprobar y acreditar al balance.\n` +
            `👉 Respondé *NO ${code}* para rechazarlo.`;

        if (sock) {
            for (const adminNum of TRUSTED_ADMIN_NUMBERS) {
                try {
                    await sock.sendMessage(`${adminNum}@s.whatsapp.net`, { text: adminAlert });
                    _trackBandwidth(adminAlert, 'out');
                } catch(eAlert) {
                    console.warn(`⚠️ [ADMIN-ALERT] No se pudo enviar alerta al admin (+${adminNum}):`, eAlert.message);
                }
            }
        }

        // Responder al chofer en su chat (si es un mensaje en vivo)
        if (sock && jid && origin === 'live') {
            const driverReply = 
                `👍 *Aviso Recibido*\n\n` +
                `Registramos tu aviso de *${method === 'Efectivo' ? 'entrega de efectivo' : 'transferencia'}* por *$${formattedMonto}*.\n` +
                `⏳ Quedó *pendiente de confirmación* por el administrador.\n` +
                `Una vez verificado y confirmado, se acreditará automáticamente en el balance de la flota. 🚗💰`;
            try {
                await sock.sendMessage(jid, { text: driverReply }, { quoted: msg });
                _trackBandwidth(driverReply, 'out');
            } catch(eReply) {}
        }

        return pendingData;
    }

    /**
     * Confirma un pago pendiente: lo registra en balance, lo sincroniza con Google Sheets y notifica a las partes
     */
    async function _confirmPendingPayment(code = null, targetFleetId = null, confirmedBy = 'whatsapp_admin') {
        if (!db) return { ok: false, message: 'Base de datos no conectada.' };
        const fleetId = targetFleetId || await _resolveFleetId();

        try {
            const snap = await db.ref(`fleets/${fleetId}/pending_payments`).once('value');
            const payments = snap.val() || {};
            
            let targetPayment = null;
            let targetKey = null;

            if (code) {
                const cleanCode = String(code).replace(/[^0-9]/g, '');
                for (const [k, p] of Object.entries(payments)) {
                    if (p.status === 'pending' && String(p.code) === cleanCode) {
                        targetPayment = p;
                        targetKey = k;
                        break;
                    }
                }
            } else {
                // Si no se especificó código, tomar el más reciente que siga pendiente
                const pendingList = Object.entries(payments)
                    .map(([k, p]) => ({ key: k, ...p }))
                    .filter(p => p.status === 'pending')
                    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

                if (pendingList.length > 0) {
                    targetPayment = pendingList[0];
                    targetKey = pendingList[0].key;
                }
            }

            if (!targetPayment) {
                return {
                    ok: false,
                    message: code 
                        ? `⚠️ No se encontró ningún pago pendiente con el código #${code}.` 
                        : `⚠️ No hay pagos pendientes para confirmar en este momento.`
                };
            }

            // Marcar como confirmado en Firebase
            await db.ref(`fleets/${fleetId}/pending_payments/${targetKey}`).update({
                status: 'confirmed',
                confirmedAt: Date.now(),
                confirmedBy: confirmedBy
            });

            // Registrar movimiento en el balance financiero
            const movId = 'mov_' + (targetPayment.id || Date.now());
            const formattedAmount = Number(targetPayment.amount) || 0;
            const newMov = {
                id: movId,
                type: 'Ingreso',
                amount: formattedAmount,
                concept: targetPayment.concept || (targetPayment.method === 'Efectivo' ? 'Cobro en efectivo' : 'Transferencia bancaria'),
                party: targetPayment.party || (targetPayment.driverName ? `${targetPayment.method} (${targetPayment.driverName})` : 'Ingreso Chofer'),
                date: new Date().toISOString(),
                source: targetPayment.source || 'whatsapp_bot_pending',
                senderPhone: targetPayment.senderPhone || null,
                driverName: targetPayment.driverName || null,
                driverId: targetPayment.driverId || null,
                method: targetPayment.method || 'Transferencia',
                pendingPaymentId: targetPayment.id,
                createdAt: Date.now()
            };

            await db.ref(`fleets/${fleetId}/movements/${movId}`).set(newMov);
            console.log(`✅ [PENDING-CONFIRMED] Pago #${targetPayment.code} de $${formattedAmount} confirmado y acreditado en balance de flota ${fleetId}`);

            // Sincronizar con Google Sheets
            try {
                const settingsSnap = await db.ref(`fleets/${fleetId}/settings`).once('value');
                const settings = settingsSnap.val();
                await _syncMovementToSheet(fleetId, settings, newMov);
            } catch(eSheet) {
                console.warn('⚠️ [PENDING-SHEETS] Error sincronizando a Google Sheets:', eSheet.message);
            }

            const montoStr = formattedAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 });

            // Notificar al chofer si tenemos su chat JID
            if (sock && targetPayment.chatJid) {
                const driverMsg = 
                    `🎉 *¡Pago Confirmado y Acreditado!*\n\n` +
                    `Hola ${targetPayment.driverName || 'estimado chofer'},\n` +
                    `El administrador confirmó la recepción de tu ${targetPayment.method?.toLowerCase() || 'pago'}:\n` +
                    `💵 *Monto:* $${montoStr}\n` +
                    `📝 *Concepto:* ${newMov.concept}\n\n` +
                    `✅ El importe ya fue acreditado en el balance de la flota y en Google Sheets. ¡Muchas gracias! 🚗✨`;
                try {
                    await sock.sendMessage(targetPayment.chatJid, { text: driverMsg });
                    _trackBandwidth(driverMsg, 'out');
                } catch(ed) {}
            }

            const replyAdmin = 
                `✅ *Ingreso #${targetPayment.code} Confirmado y Acreditado*\n\n` +
                `💵 *Monto:* $${montoStr}\n` +
                `👤 *Chofer:* ${targetPayment.party}\n` +
                `💳 *Medio:* ${targetPayment.method}\n` +
                `📝 *Concepto:* ${newMov.concept}\n\n` +
                `_Registrado correctamente en el balance de la flota y Google Sheets._ 📊💰`;

            return {
                ok: true,
                message: replyAdmin,
                payment: targetPayment,
                movement: newMov
            };

        } catch(e) {
            console.error('❌ [PENDING-CONFIRM-ERR]', e.message);
            return { ok: false, error: e.message };
        }
    }

    /**
     * Rechaza un pago pendiente
     */
    async function _rejectPendingPayment(code = null, targetFleetId = null, rejectedBy = 'whatsapp_admin') {
        if (!db) return { ok: false, message: 'Base de datos no conectada.' };
        const fleetId = targetFleetId || await _resolveFleetId();

        try {
            const snap = await db.ref(`fleets/${fleetId}/pending_payments`).once('value');
            const payments = snap.val() || {};

            let targetPayment = null;
            let targetKey = null;

            if (code) {
                const cleanCode = String(code).replace(/[^0-9]/g, '');
                for (const [k, p] of Object.entries(payments)) {
                    if (p.status === 'pending' && String(p.code) === cleanCode) {
                        targetPayment = p;
                        targetKey = k;
                        break;
                    }
                }
            } else {
                const pendingList = Object.entries(payments)
                    .map(([k, p]) => ({ key: k, ...p }))
                    .filter(p => p.status === 'pending')
                    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

                if (pendingList.length > 0) {
                    targetPayment = pendingList[0];
                    targetKey = pendingList[0].key;
                }
            }

            if (!targetPayment) {
                return {
                    ok: false,
                    message: code 
                        ? `⚠️ No se encontró ningún pago pendiente con el código #${code}.` 
                        : `⚠️ No hay pagos pendientes para rechazar en este momento.`
                };
            }

            await db.ref(`fleets/${fleetId}/pending_payments/${targetKey}`).update({
                status: 'rejected',
                rejectedAt: Date.now(),
                rejectedBy: rejectedBy
            });

            const montoStr = Number(targetPayment.amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });

            if (sock && targetPayment.chatJid) {
                const driverMsg = 
                    `⚠️ *Aviso sobre tu pago / entrega*\n\n` +
                    `Hola ${targetPayment.driverName || 'estimado chofer'}, el aviso de ${targetPayment.method?.toLowerCase() || 'pago'} por $${montoStr} no pudo ser confirmado o fue descartado por el administrador.\n` +
                    `Por favor comunicate con administración para regularizar el estado.`;
                try {
                    await sock.sendMessage(targetPayment.chatJid, { text: driverMsg });
                    _trackBandwidth(driverMsg, 'out');
                } catch(ed) {}
            }

            const replyAdmin = `❌ *Pago #${targetPayment.code} Rechazado*\n\nEl aviso de $${montoStr} (${targetPayment.party}) fue descartado y NO se ingresó al balance.`;

            return {
                ok: true,
                message: replyAdmin,
                payment: targetPayment
            };

        } catch(e) {
            console.error('❌ [PENDING-REJECT-ERR]', e.message);
            return { ok: false, error: e.message };
        }
    }

    /**
     * Lista pagos pendientes de confirmación
     */
    async function _listPendingPayments(targetFleetId = null) {
        if (!db) return [];
        const fleetId = targetFleetId || await _resolveFleetId();
        try {
            const snap = await db.ref(`fleets/${fleetId}/pending_payments`).once('value');
            const payments = snap.val() || {};
            return Object.entries(payments)
                .map(([k, p]) => ({ key: k, ...p }))
                .filter(p => p.status === 'pending')
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        } catch(e) {
            console.error('❌ [PENDING-LIST-ERR]', e.message);
            return [];
        }
    }

    function _recursiveFindImage(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || depth > 8) return null;
        if (obj.imageMessage && typeof obj.imageMessage === 'object') return obj.imageMessage;
        for (const k of Object.keys(obj)) {
            if (k === 'messageContextInfo' || k === 'contextInfo') continue;
            const val = obj[k];
            if (val && typeof val === 'object' && !Buffer.isBuffer(val)) {
                const found = _recursiveFindImage(val, depth + 1);
                if (found) return found;
            }
        }
        return null;
    }

    const _processedReceiptMsgIds = new Set();
    const _nonReceiptMsgIds = new Set();
    const _recentHistoricalQueue = [];

    function _sanitizeForFirebase(obj, depth = 0) {
        if (!obj || depth > 6) return null;
        if (typeof obj !== 'object') return obj;
        if (Buffer.isBuffer(obj)) return obj.toString('base64');
        if (Array.isArray(obj)) return obj.slice(0, 10).map(i => _sanitizeForFirebase(i, depth + 1));
        const clean = {};
        for (const [k, v] of Object.entries(obj)) {
            if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
            clean[k] = _sanitizeForFirebase(v, depth + 1);
        }
        return clean;
    }

    function _enqueueCandidateMessage(msg) {
        if (!msg || !msg.key || !msg.message) return;
        const msgId = msg.key.id;
        if (!msgId) return;

        const already = _recentHistoricalQueue.some(m => m.key?.id === msgId);
        if (!already) {
            if (_recentHistoricalQueue.length >= 1000) _recentHistoricalQueue.shift();
            _recentHistoricalQueue.push(msg);

            // Persistir mensaje candidato en Firebase RTDB para recuperarlo tras reinicios de Render
            if (db) {
                try {
                    const safeKey = msgId.replace(/[^a-zA-Z0-9_-]/g, '_');
                    const cleanItem = {
                        key: {
                            id: msg.key.id,
                            remoteJid: msg.key.remoteJid,
                            fromMe: !!msg.key.fromMe,
                            participant: msg.key.participant || null
                        },
                        messageTimestamp: msg.messageTimestamp,
                        message: _sanitizeForFirebase(msg.message)
                    };
                    db.ref(`bot_receipt_queue/${safeKey}`).set(cleanItem).catch(() => {});
                } catch(e) {}
            }
        }
    }

    async function _processPotentialReceipt(msg, origin = 'live', targetFleetId = null) {
        if (!msg || !msg.message) return false;
        const msgId = msg.key?.id;
        if (msgId && _nonReceiptMsgIds.has(msgId)) return false;
        if (origin !== 'scan_manual' && msgId && _processedReceiptMsgIds.has(msgId)) return false;

        const m = msg.message;
        const jid = msg.key?.remoteJid;
        if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast')) return false;

        // Detectar si contiene imagen o documento
        const resolvedImageMsg = _recursiveFindImage(m, 0) || m.imageMessage;
        const isImage = !!resolvedImageMsg;

        const docMsg = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
        const isDocReceipt = !!docMsg && (
            docMsg.mimetype?.includes('pdf') || 
            docMsg.mimetype?.includes('image') ||
            (docMsg.fileName && /\.(pdf|jpg|jpeg|png)$/i.test(docMsg.fileName))
        );

        // Extraer texto
        let text = m.conversation ||
                   m.extendedTextMessage?.text ||
                   m.imageMessage?.caption ||
                   resolvedImageMsg?.caption ||
                   docMsg?.caption || '';

        const hasKeywords = _hasTransferKeywords(m) || _hasTransferKeywords(text);
        const hasCashKeywords = _hasCashKeywords(text);

        // Si no es imagen, ni documento, ni tiene palabras de pago/factura/efectivo, no es comprobante
        if (!isImage && !isDocReceipt && !hasKeywords && !hasCashKeywords) return false;

        console.log(`🧾 [CHECK-RECEIPT] Analizando posible comprobante/efectivo de ${jid} (isImage=${isImage}, isDoc=${isDocReceipt}, hasCash=${hasCashKeywords}, origin=${origin})...`);

        // Encolar candidato para persistencia y escaneos futuros
        _enqueueCandidateMessage(msg);

        // Determinar remitente y verificar si es administrador
        const senderJid = msg.key.participant || msg.key.remoteJid || '';
        const isFromTrustedAdmin = msg.key.fromMe || _isTrustedAdmin(senderJid) || _isTrustedAdmin(jid);
        const senderNum = (senderJid || '').replace(/[^0-9]/g, '');

        // Determinar flota correspondiente
        const fleetMatch = await _findFleetForPhone(senderNum);
        const fleetId = targetFleetId || fleetMatch?.fleetId || await _resolveFleetId();

        const movId = 'mov_' + (msgId ? msgId.replace(/[^a-zA-Z0-9_-]/g, '_') : Date.now());

        // Chequeo temprano en Firebase: si ya existe en balance, no gastar descarga ni Gemini
        if (db) {
            try {
                const existsSnap = await db.ref(`fleets/${fleetId}/movements/${movId}`).once('value');
                if (existsSnap.exists()) {
                    console.log(`⏭️ [RECEIPT-DUP] Comprobante ${movId} ya registrado en balance de flota ${fleetId}.`);
                    if (msgId) _processedReceiptMsgIds.add(msgId);
                    return true;
                }
            } catch(eSnap) {}
        }

        // 0. Caso Entrega de Efectivo (aviso en texto por parte del chofer)
        if (hasCashKeywords && text && text.length > 5 && getGeminiKey()) {
            try {
                const senderDisplay = fleetMatch?.driverName || `Chofer (+${senderNum})`;
                const cashAnalysis = await callGeminiCashReceipt(text, senderDisplay);

                if (cashAnalysis && cashAnalysis.isCash && cashAnalysis.amount > 0) {
                    if (msgId) _processedReceiptMsgIds.add(msgId);
                    console.log(`💵 [CASH-INTERCEPT] Chofer ${senderDisplay} avisó entrega de efectivo: $${cashAnalysis.amount} (origin=${origin})`);

                    // Solo solicitar confirmación interactiva si es mensaje en vivo
                    if (origin === 'live' && !isFromTrustedAdmin) {
                        await _createPendingPayment({
                            fleetId,
                            driverName: fleetMatch?.driverName || null,
                            driverId: fleetMatch?.driverId || null,
                            senderNum,
                            amount: cashAnalysis.amount,
                            method: 'Efectivo',
                            concept: cashAnalysis.concept || 'Entrega de efectivo en mano',
                            date: cashAnalysis.date || new Date().toISOString(),
                            originalMsgId: msgId,
                            jid,
                            msg,
                            origin
                        });
                        return true;
                    }

                    // En escaneo manual/histórico o admin, registrar directamente en balance
                    const newMov = {
                        id: movId,
                        type: 'Ingreso',
                        amount: cashAnalysis.amount,
                        concept: cashAnalysis.concept || 'Entrega de efectivo en mano',
                        party: senderDisplay,
                        date: cashAnalysis.date || (msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()),
                        source: 'whatsapp_bot_cash',
                        senderPhone: senderNum,
                        driverName: fleetMatch?.driverName || null,
                        driverId: fleetMatch?.driverId || null,
                        createdAt: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()
                    };

                    if (db) {
                        await db.ref(`fleets/${fleetId}/movements/${movId}`).set(newMov);
                        console.log(`✅ [CASH-SAVED] Efectivo guardado en fleets/${fleetId}/movements/${movId} ($${cashAnalysis.amount})`);
                    }

                    await _syncMovementToSheet(fleetId, fleetMatch?.settings, newMov);

                    if (origin === 'live' && sock) {
                        const replyMsg = `✅ *Entrega de Efectivo Registrada*\n\n` +
                                         `💵 *Monto:* $${cashAnalysis.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
                                         `👤 *Chofer:* ${senderDisplay}\n` +
                                         `📝 *Concepto:* ${newMov.concept}\n` +
                                         `📅 *Fecha:* ${newMov.date.substring(0, 10)}\n\n` +
                                         `_Registrado automáticamente en Balance y Google Sheets_ 🚗💰`;
                        await sock.sendMessage(jid, { text: replyMsg }, { quoted: msg });
                        _trackBandwidth(replyMsg, 'out');
                    }

                    return true;
                }
            } catch(eCash) {
                console.warn('⚠️ [CASH-PARSE] Error analizando posible entrega de efectivo:', eCash.message);
            }
        }

        // 1. Caso Imagen
        if (isImage && getGeminiKey()) {
            try {
                const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                let imageBuffer = null;

                // Intento 1: descarga directa desde msg
                try {
                    imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
                        logger: P({ level: 'silent' }),
                        reuploadRequest: sock?.updateMediaMessage
                    });
                } catch (e1) {
                    // Intento 2: envolviendo en cleanMsg con imageMessage resuelto
                    try {
                        const cleanMsg = {
                            key: msg.key,
                            message: { imageMessage: resolvedImageMsg }
                        };
                        imageBuffer = await downloadMediaMessage(cleanMsg, 'buffer', {}, {
                            logger: P({ level: 'silent' }),
                            reuploadRequest: sock?.updateMediaMessage
                        });
                    } catch (e2) {
                        console.warn(`⚠️ [RECEIPT-DOWNLOAD] No se pudo descargar imagen (${msgId}): ${e2.message}`);
                    }
                }

                if (imageBuffer && imageBuffer.length > 500) {
                    const mimeType = resolvedImageMsg.mimetype || 'image/jpeg';
                    const receiptAnalysis = await callGeminiReceipt(imageBuffer, mimeType);

                    if (receiptAnalysis && receiptAnalysis.isReceipt && receiptAnalysis.amount > 0) {
                        if (msgId) _processedReceiptMsgIds.add(msgId);
                        const formattedAmount = Number(receiptAnalysis.amount) || 0;
                        const senderDisplay = fleetMatch?.driverName 
                            ? `${receiptAnalysis.party || 'Transferencia'} (${fleetMatch.driverName})` 
                            : (receiptAnalysis.party || `Transferencia WhatsApp (+${senderNum})`);

                        // SI ES MENSAJE EN VIVO Y PROVIENE DE UN CONDUCTOR (NO ES ADMIN DIRECTO): Solicitar confirmación interactiva
                        if (origin === 'live' && !isFromTrustedAdmin) {
                            console.log(`⏳ [DRIVER-TRANSFER] Transferencia de chofer detectada en vivo ($${formattedAmount}). Creando pago pendiente...`);
                            await _createPendingPayment({
                                fleetId,
                                driverName: fleetMatch?.driverName || null,
                                driverId: fleetMatch?.driverId || null,
                                senderNum,
                                amount: formattedAmount,
                                method: 'Transferencia',
                                concept: receiptAnalysis.concept || (receiptAnalysis.type === 'Ingreso' ? 'Transferencia bancaria recibida' : 'Comprobante'),
                                date: receiptAnalysis.date || (msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()),
                                originalMsgId: msgId,
                                jid,
                                msg,
                                origin
                            });
                            return true;
                        }

                        // Si proviene directamente del administrador de confianza, se acredita de inmediato
                        const newMov = {
                            id: movId,
                            type: receiptAnalysis.type === 'Ingreso' ? 'Ingreso' : 'Egreso',
                            amount: formattedAmount,
                            concept: receiptAnalysis.concept || (receiptAnalysis.type === 'Ingreso' ? 'Transferencia recibida' : 'Gasto / Factura'),
                            party: senderDisplay,
                            date: receiptAnalysis.date || (msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()),
                            source: 'whatsapp_bot_image',
                            senderPhone: senderNum,
                            driverName: fleetMatch?.driverName || null,
                            driverId: fleetMatch?.driverId || null,
                            createdAt: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()
                        };

                        if (db) {
                            await db.ref(`fleets/${fleetId}/movements/${movId}`).set(newMov);
                            console.log(`✅ [RECEIPT-SAVED] Comprobante guardado en fleets/${fleetId}/movements/${movId} ($${formattedAmount})`);
                        }

                        await _syncMovementToSheet(fleetId, fleetMatch?.settings, newMov);

                        if (origin === 'live' && sock) {
                            const replyMsg = `✅ *Comprobante Procesado Exitosamente*\n\n` +
                                             `📌 *Tipo:* ${newMov.type}\n` +
                                             `💵 *Monto:* $${formattedAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
                                             `👤 *Emisor/Comercio:* ${newMov.party}\n` +
                                             `📝 *Concepto:* ${newMov.concept}\n` +
                                             `📅 *Fecha:* ${newMov.date.substring(0, 10)}\n\n` +
                                             `_Registrado automáticamente en FleetAdmin Pro y Google Sheets_ 🚗💰`;

                            await sock.sendMessage(jid, { text: replyMsg }, { quoted: msg });
                            _trackBandwidth(replyMsg, 'out');
                        }

                        return true;
                    } else if (receiptAnalysis && receiptAnalysis.isReceipt === false) {
                        if (msgId) _nonReceiptMsgIds.add(msgId);
                    }
                }
            } catch(e) {
                console.warn('⚠️ [RECEIPT-PARSE] Error analizando posible comprobante:', e.message);
            }
        }

        // 1b. Caso Documento (Factura PDF o Ticket en imagen adjunta como archivo)
        if (!isImage && isDocReceipt && getGeminiKey()) {
            try {
                const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                let docBuffer = null;
                try {
                    docBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
                        logger: P({ level: 'silent' }),
                        reuploadRequest: sock?.updateMediaMessage
                    });
                } catch(de) {
                    console.warn(`⚠️ [DOC-DOWNLOAD] Error descargando documento (${msgId}):`, de.message);
                }

                if (docBuffer && docBuffer.length > 500) {
                    const mimeType = docMsg.mimetype || 'application/pdf';
                    const receiptAnalysis = await callGeminiReceipt(docBuffer, mimeType);

                    if (receiptAnalysis && receiptAnalysis.isReceipt && receiptAnalysis.amount > 0) {
                        if (msgId) _processedReceiptMsgIds.add(msgId);
                        const formattedAmount = Number(receiptAnalysis.amount) || 0;
                        const senderDisplay = fleetMatch?.driverName 
                            ? `${receiptAnalysis.party || 'Factura/Comprobante'} (${fleetMatch.driverName})` 
                            : (receiptAnalysis.party || `Documento WhatsApp (+${senderNum})`);

                        // SI ES MENSAJE EN VIVO Y PROVIENE DE UN CONDUCTOR (NO ES ADMIN DIRECTO): Solicitar confirmación interactiva
                        if (origin === 'live' && !isFromTrustedAdmin) {
                            console.log(`⏳ [DRIVER-DOC] Documento de chofer detectado en vivo ($${formattedAmount}). Creando pago pendiente...`);
                            await _createPendingPayment({
                                fleetId,
                                driverName: fleetMatch?.driverName || null,
                                driverId: fleetMatch?.driverId || null,
                                senderNum,
                                amount: formattedAmount,
                                method: 'Transferencia',
                                concept: receiptAnalysis.concept || 'Comprobante/Factura en documento',
                                date: receiptAnalysis.date || (msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()),
                                originalMsgId: msgId,
                                jid,
                                msg,
                                origin
                            });
                            return true;
                        }

                        const newMov = {
                            id: movId,
                            type: receiptAnalysis.type === 'Ingreso' ? 'Ingreso' : 'Egreso',
                            amount: formattedAmount,
                            concept: receiptAnalysis.concept || (receiptAnalysis.type === 'Ingreso' ? 'Transferencia recibida' : 'Factura / Gasto'),
                            party: senderDisplay,
                            date: receiptAnalysis.date || (msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()),
                            source: 'whatsapp_bot_doc',
                            senderPhone: senderNum,
                            driverName: fleetMatch?.driverName || null,
                            driverId: fleetMatch?.driverId || null,
                            createdAt: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()
                        };

                        if (db) {
                            await db.ref(`fleets/${fleetId}/movements/${movId}`).set(newMov);
                            console.log(`✅ [DOC-RECEIPT-SAVED] Factura/Comprobante guardado en fleets/${fleetId}/movements/${movId} ($${formattedAmount})`);
                        }

                        await _syncMovementToSheet(fleetId, fleetMatch?.settings, newMov);

                        if (origin === 'live' && sock) {
                            const replyMsg = `✅ *Comprobante/Factura Procesado Exitosamente*\n\n` +
                                             `📌 *Tipo:* ${newMov.type}\n` +
                                             `💵 *Monto:* $${formattedAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
                                             `👤 *Emisor/Comercio:* ${newMov.party}\n` +
                                             `📝 *Concepto:* ${newMov.concept}\n` +
                                             `📅 *Fecha:* ${newMov.date.substring(0, 10)}\n\n` +
                                             `_Registrado automáticamente en FleetAdmin Pro y Google Sheets_ 🚗💰`;

                            await sock.sendMessage(jid, { text: replyMsg }, { quoted: msg });
                            _trackBandwidth(replyMsg, 'out');
                        }

                        return true;
                    } else if (receiptAnalysis && receiptAnalysis.isReceipt === false) {
                        if (msgId) _nonReceiptMsgIds.add(msgId);
                    }
                }
            } catch (docErr) {
                console.warn('⚠️ [DOC-RECEIPT-PARSE] Error analizando documento contable:', docErr.message);
            }
        }

        // 2. Caso Texto
        if (text && text.length > 5 && getGeminiKey() && hasKeywords) {
            try {
                const senderDisplay = fleetMatch?.driverName || `Contacto WhatsApp (+${senderNum})`;
                const textReceipt = await callGeminiTextReceipt(text, senderDisplay);

                if (textReceipt && textReceipt.isReceipt && textReceipt.amount > 0) {
                    if (msgId) _processedReceiptMsgIds.add(msgId);
                    const formattedAmount = Number(textReceipt.amount) || 0;

                    // SI ES MENSAJE EN VIVO Y PROVIENE DE UN CONDUCTOR (NO ES ADMIN DIRECTO): Solicitar confirmación interactiva
                    if (origin === 'live' && !isFromTrustedAdmin) {
                        console.log(`⏳ [DRIVER-TEXT-TRANSFER] Transferencia en texto de chofer detectada en vivo ($${formattedAmount}). Creando pago pendiente...`);
                        await _createPendingPayment({
                            fleetId,
                            driverName: fleetMatch?.driverName || null,
                            driverId: fleetMatch?.driverId || null,
                            senderNum,
                            amount: formattedAmount,
                            method: 'Transferencia',
                            concept: textReceipt.concept || 'Transferencia por WhatsApp',
                            date: textReceipt.date || (msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()),
                            originalMsgId: msgId,
                            jid,
                            msg,
                            origin
                        });
                        return true;
                    }

                    const newMov = {
                        id: movId,
                        type: textReceipt.type === 'Ingreso' ? 'Ingreso' : 'Egreso',
                        amount: formattedAmount,
                        concept: textReceipt.concept || 'Transferencia por WhatsApp',
                        party: fleetMatch?.driverName ? `${textReceipt.party || 'Transferencia'} (${fleetMatch.driverName})` : (textReceipt.party || senderDisplay),
                        date: textReceipt.date || (msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()),
                        source: 'whatsapp_bot_text',
                        senderPhone: senderNum,
                        driverName: fleetMatch?.driverName || null,
                        driverId: fleetMatch?.driverId || null,
                        createdAt: msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()
                    };

                    if (db) {
                        await db.ref(`fleets/${fleetId}/movements/${movId}`).set(newMov);
                        console.log(`✅ [TEXT-RECEIPT-SAVED] Transferencia texto guardada: $${formattedAmount}`);
                    }

                    await _syncMovementToSheet(fleetId, fleetMatch?.settings, newMov);

                    if (origin === 'live' && sock) {
                        const replyMsg = `✅ *Comprobante Registrado Automáticamente*\n\n` +
                                         `📌 *Tipo:* ${newMov.type}\n` +
                                         `💵 *Monto:* $${formattedAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
                                         `👤 *Emisor:* ${newMov.party}\n` +
                                         `📝 *Concepto:* ${newMov.concept}\n` +
                                         `📅 *Fecha:* ${newMov.date.substring(0, 10)}\n\n` +
                                         `_Registrado en Balance y Google Sheets_ 🚗💰`;

                        await sock.sendMessage(jid, { text: replyMsg }, { quoted: msg });
                        _trackBandwidth(replyMsg, 'out');
                    }

                    return true;
                } else if (textReceipt && textReceipt.isReceipt === false) {
                    if (msgId) _nonReceiptMsgIds.add(msgId);
                }
            } catch(e) {
                console.warn('⚠️ [TEXT-RECEIPT-PARSE] Error analizando texto contable:', e.message);
            }
        }

        return false;
    }

    // Fleet ID real (se auto-detecta al iniciar)
    let _resolvedFleetId = null;

    async function _resolveFleetId() {
        if (_resolvedFleetId && _resolvedFleetId !== 'jose07') return _resolvedFleetId;
        
        // Si hay variable de entorno explícita, usarla
        if (process.env.DEFAULT_FLEET_ID) {
            _resolvedFleetId = process.env.DEFAULT_FLEET_ID;
            console.log(`🏢 [FLEET] Usando DEFAULT_FLEET_ID del env: ${_resolvedFleetId}`);
            return _resolvedFleetId;
        }

        // Auto-detectar: buscar la primera flota en Firebase
        if (db) {
            try {
                const snap = await db.ref('fleets').limitToFirst(1).once('value');
                const val = snap.val();
                if (val) {
                    const keys = Object.keys(val);
                    if (keys.length > 0 && keys[0] !== 'jose07') {
                        _resolvedFleetId = keys[0];
                        console.log(`🏢 [FLEET] ✅ Auto-detectada flota: ${_resolvedFleetId}`);
                        return _resolvedFleetId;
                    }
                }
            } catch (e) {
                console.error('🏢 [FLEET] Error buscando flota:', e.message);
            }
        }

        // Fallback seguro a la flota principal de José
        _resolvedFleetId = '-OnPd8HaV1VZWBnYQQX7';
        console.log(`🏢 [FLEET] ⚠️ Usando fallback seguro: ${_resolvedFleetId}`);
        return _resolvedFleetId;
    }

    function _phoneMatches(p1, p2) {
        if (!p1 || !p2) return false;
        const c1 = String(p1).replace(/[^0-9]/g, '');
        const c2 = String(p2).replace(/[^0-9]/g, '');
        if (!c1 || !c2) return false;
        if (c1 === c2) return true;
        if (c1.endsWith(c2) || c2.endsWith(c1)) return true;
        if (c1.length >= 8 && c2.length >= 8 && c1.slice(-8) === c2.slice(-8)) return true;
        return false;
    }

    async function _findFleetForPhone(senderPhone) {
        if (!db) return null;
        const cleanSender = (senderPhone || '').replace(/[^0-9]/g, '');
        try {
            const snap = await db.ref('fleets').once('value');
            const fleets = snap.val() || {};

            // 1. Buscar en configuraciones explícitas de flotas
            for (const [fleetId, fleetData] of Object.entries(fleets)) {
                if (fleetId === 'jose07') continue;
                const settings = fleetData.settings || {};
                const scannerEnabled = settings.whatsapp_scanner_enabled !== false;
                const authPhone = (settings.whatsapp_authorized_phone || '').replace(/[^0-9]/g, '');
                
                if (authPhone && cleanSender && _phoneMatches(authPhone, cleanSender)) {
                    return { fleetId, settings, scannerEnabled, isAuthorizedAdmin: true };
                }

                // 2. Buscar si coincide con algún usuario/chofer registrado en fleetData.users
                const users = fleetData.users || {};
                for (const [userId, user] of Object.entries(users)) {
                    if (user && (user.role === 'driver' || !user.role)) {
                        const uPhone = (user.phone || user.telefono || user.whatsapp || '').replace(/[^0-9]/g, '');
                        if (uPhone && cleanSender && _phoneMatches(uPhone, cleanSender)) {
                            return {
                                fleetId,
                                settings,
                                scannerEnabled,
                                driverName: user.name || user.nombre || 'Chofer Registrado',
                                driverId: userId
                            };
                        }
                    }
                }

                // 3. Buscar si coincide con el teléfono de algún chofer registrado en fleetData.drivers
                const drivers = fleetData.drivers || {};
                for (const [driverId, driver] of Object.entries(drivers)) {
                    if (driver) {
                        const dPhone = (driver.phone || driver.telefono || driver.whatsapp || '').replace(/[^0-9]/g, '');
                        if (dPhone && cleanSender && _phoneMatches(dPhone, cleanSender)) {
                            return {
                                fleetId,
                                settings,
                                scannerEnabled,
                                driverName: driver.name || driver.nombre || 'Chofer Registrado',
                                driverId
                            };
                        }
                    }
                }
            }
            
            // 4. Fallback a la flota activa del sistema
            const defaultFleetId = await _resolveFleetId();
            const defaultFleetSnap = await db.ref(`fleets/${defaultFleetId}/settings`).once('value');
            const defaultSettings = defaultFleetSnap.val() || {};
            const scannerEnabled = defaultSettings.whatsapp_scanner_enabled !== false;
            
            if (scannerEnabled) {
                return { fleetId: defaultFleetId, settings: defaultSettings, scannerEnabled: true };
            }
        } catch (e) {
            console.error('⚠️ [FLEET-FIND] Error buscando flota por teléfono:', e.message);
        }
        return null;
    }

    // ============ GLOBAL ERROR HANDLER ============
    // Los errores MAC ocurren en las internals de Baileys/libsignal
    // y a veces escapan como "unhandledRejection". Los silenciamos aquí.
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', (reason) => {
        const msg = reason?.message || String(reason);
        // Silenciar errores MAC / Decryption tanto en inglés como sus traducciones literales al español de Baileys
        if (msg.includes('MAC') || msg.includes('decrypt') || msg.includes('Bad MAC') || msg.includes('autenticar datos') || msg.includes('Estado no admitido')) {
            console.log('⚠️ [MAC] Mensaje no descifrable o conflicto de sesión (normal después de reinicio/soft-reset), ignorado.');
            return;
        }
        console.error('⚠️ [UNHANDLED]', msg);
    });

    /**
     * Rastreador de ancho de banda (Admin solo)
     */
    async function _trackBandwidth(payload, type) {
        if (!db || !payload) return;
        try {
            let str = typeof payload === 'string' ? payload : '';
            if (!str) {
                try { str = JSON.stringify(payload); } catch(e) { str = String(payload); }
            }
            const bytes = Buffer.byteLength(str, 'utf8');
            const ref = db.ref('stats/consumo_bandwidth');
            
            await ref.child('total_bytes').transaction(current => (current || 0) + bytes);
            await ref.child(`${type}_bytes`).transaction(current => (current || 0) + bytes);
        } catch (e) {
            console.warn('⚠️ [BANDWIDTH] Error guardando consumo:', e.message);
        }
    }

    async function init() {
        console.log('🚀 INICIANDO BOT v236 (BAILEYS + GEMINI HTTP + AUTO-PING)...');
        console.log('📡 Sin navegador - conexión directa a WhatsApp');
        console.log(`🔥 Firebase DB: ${db ? '✅ CONECTADO' : '❌ NULL - LAS ALERTAS NO SE GUARDARÁN'}`);
        
        // Cargar clave dinámica de Gemini y restaurar cola de comprobantes desde Firebase
        if (db) {
            try {
                const keySnap = await db.ref('bot_config/gemini_api_key').once('value');
                if (keySnap.val()) {
                    _dynamicGeminiKey = keySnap.val();
                    console.log('🧠 [GEMINI] Clave de Gemini cargada desde Firebase RTDB ✅');
                }
                db.ref('bot_config/gemini_api_key').on('value', (s) => {
                    if (s.val()) _dynamicGeminiKey = s.val();
                });

                const queueSnap = await db.ref('bot_receipt_queue').limitToLast(500).once('value');
                const savedQueue = queueSnap.val();
                if (savedQueue && typeof savedQueue === 'object') {
                    for (const item of Object.values(savedQueue)) {
                        if (item && item.key && item.message) {
                            _recentHistoricalQueue.push(item);
                        }
                    }
                    console.log(`📦 [QUEUE-RESTORE] Restaurados ${_recentHistoricalQueue.length} mensajes candidatos a comprobantes desde Firebase ✅`);
                }
            } catch(initErr) {
                console.warn('⚠️ [INIT] Error inicializando config/cola desde Firebase:', initErr.message);
            }
        }
        console.log(`🧠 Gemini IA: ${getGeminiKey() ? '✅ ACTIVO' : '❌ NO CONFIGURADO'}`);
        
        // Esperar 50s al inicio para que el proceso anterior de Render muera
        console.log('⏳ Esperando 50s para que el proceso anterior libere la sesión...');
        await new Promise(r => setTimeout(r, 50000));
        console.log('✅ Espera terminada. Conectando a WhatsApp...');
        
        // Auto-ping cada 10 minutos para evitar que Render (free tier) duerma el servicio
        const selfUrl = process.env.RENDER_EXTERNAL_URL || 'https://fleetadmin-web-nueva.onrender.com';
        setInterval(async () => {
            try {
                await axios.get(`${selfUrl}/api/bot/status`, { timeout: 10000 });
                console.log('🏓 [PING] Auto-ping OK — servicio despierto');
            } catch(e) {
                console.warn('⚠️ [PING] Auto-ping falló:', e.message);
            }
        }, 10 * 60 * 1000); // cada 10 minutos
        console.log(`🏓 [PING] Auto-ping activado cada 10min → ${selfUrl}`);
        
        // Auto-detectar fleet ID ANTES de conectar WhatsApp
        await _resolveFleetId();
        
        // Iniciar rutina de limpieza de base de datos en segundo plano
        _startDatabaseCleanup();
        
        await startSocket();
    }

    let _backupInterval = null;

    /**
     * Carga el estado de sesión de Firebase o del sistema de archivos local
     * para que sobrevivan los reinicios de Render (evita el Error MAC Malo)
     */
    async function _firebaseAuthState() {
        let isFreshStart = true;
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        } else if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
            // Si ya existe la carpeta local con credenciales, usamos esas y NO sobrescribimos con Firebase
            // porque las locales siempre son más nuevas que el backup y sobrescribirlas causa MAC Bad / Error 440
            isFreshStart = false;
            console.log('🔑 [AUTH] Sesión local existente detectada. Omitiendo descarga desde Firebase.');
        }

        // 1. Restaurar TODAS las llaves desde Firebase SOLO si es un inicio limpio (contenedor nuevo)
        if (db && isFreshStart) {
            try {
                const snap = await db.ref('bot_auth_backup').once('value');
                const backup = snap.val();
                if (backup) {
                    for (const safeKey in backup) {
                        try {
                            // Decodificar Base64 a nombre real (o fallback si era viejo)
                            const fileName = safeKey.includes('json') ? safeKey : Buffer.from(safeKey, 'base64').toString('utf8');
                            fs.writeFileSync(path.join(AUTH_DIR, fileName), backup[safeKey]);
                        } catch(e) {}
                    }
                    console.log(`🔑 [AUTH] Sesión completa restaurada desde Firebase (${Object.keys(backup).length} archivos) ✅`);
                } else {
                    console.log('🔑 [AUTH] No hay sesión guardada, se necesita QR nuevo');
                }
            } catch (e) {
                console.error('🔑 [AUTH] Error restaurando credenciales:', e.message);
            }
        }

        // 2. Usar el sistema de archivos local (ya restaurado)
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        // Función auxiliar para crear el objeto de backup usando Base64 keys
        const _createBackupObject = () => {
            const files = fs.readdirSync(AUTH_DIR);
            const backup = {};
            for (const file of files) {
                if (file.endsWith('.json')) {
                    // Firebase prohíbe '.', '#', '$', '/', '[', ']'. 
                    // Baileys usa '.us' y '.net' en sus archivos, lo que rompe Firebase.
                    // Solución: codificar el nombre del archivo en Base64
                    const safeKey = Buffer.from(file).toString('base64');
                    backup[safeKey] = fs.readFileSync(path.join(AUTH_DIR, file), 'utf8');
                }
            }
            return backup;
        };

        // 3. Hacer backup a Firebase cada vez que cambien los credenciales, pero con debounce
        let saveTimeout = null;
        const saveCredsToFirebase = async () => {
            await saveCreds(); // Guardar local
            
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                if (db) {
                    try {
                        const backup = _createBackupObject();
                        await db.ref('bot_auth_backup').set(backup);
                        console.log(`🔑 [AUTH] Backup en la nube actualizado (${Object.keys(backup).length} archivos) ✅`);
                    } catch (e) {
                        console.error('🔑 [AUTH] Error guardando backup en Firebase:', e.message);
                    }
                }
            }, 5000); // Esperar 5s para agrupar escrituras
        };

        // 4. Sync activo de llaves (Baileys no llama saveCreds para las session keys)
        if (_backupInterval) clearInterval(_backupInterval);
        _backupInterval = setInterval(async () => {
            if (db && fs.existsSync(AUTH_DIR)) {
                try {
                    const backup = _createBackupObject();
                    await db.ref('bot_auth_backup').set(backup);
                } catch(e) {}
            }
        }, 60000); // Sincronizar cada 60s
        
        return { state, saveCreds: saveCredsToFirebase };
    }

    /**
     * Limpia la carpeta de autenticación para forzar un nuevo pairing
     */
    async function clearAuthInfo() {
        try {
            if (fs.existsSync(AUTH_DIR)) {
                fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                console.log('🗑️ Credenciales locales eliminadas.');
            }
            if (db) {
                await db.ref('bot_auth_backup').remove();
                await db.ref('bot_auth').remove(); // limpiar el viejo también
                console.log('🗑️ Credenciales de Firebase eliminadas.');
            }
        } catch (e) {
            console.error('⚠️ Error limpiando credenciales:', e.message);
        }
    }

    /**
     * Cuidado de emergencia (SOFT RESET): Borra llaves corruptas pero MANTIENE creds.json
     * Esto soluciona el error de "MAC Malo" y "Conflicto 440" sin pedir escanear el QR de vuelta!
     */
    async function softResetAuthInfo() {
        console.log('🔧 [SOFT-RESET] Intentando curación rápida de MAC corrupto (Conservando QR)...');
        try {
            if (fs.existsSync(AUTH_DIR)) {
                const files = fs.readdirSync(AUTH_DIR);
                let removedCount = 0;
                for (const file of files) {
                    // Conservar estrictamente creds.json que contiene el emparejamiento
                    if (file !== 'creds.json') {
                        try {
                            fs.unlinkSync(path.join(AUTH_DIR, file));
                            removedCount++;
                        } catch(e) {}
                    }
                }
                console.log(`🧹 [SOFT-RESET] ${removedCount} archivos efímeros eliminados. creds.json a salvo.`);
            }
            
            if (db) {
                // En Firebase: Bajar backup, dejar solo creds.json y volver a subir
                const snap = await db.ref('bot_auth_backup').once('value');
                const backup = snap.val();
                if (backup) {
                    const cleanBackup = {};
                    const targetKey = Buffer.from('creds.json').toString('base64');
                    
                    if (backup[targetKey]) {
                        cleanBackup[targetKey] = backup[targetKey];
                        await db.ref('bot_auth_backup').set(cleanBackup);
                        console.log('🧹 [SOFT-RESET] Backup en la nube curado, solo conservado creds.json.');
                    } else if (backup['creds.json']) {
                        cleanBackup['creds.json'] = backup['creds.json'];
                        await db.ref('bot_auth_backup').set(cleanBackup);
                        console.log('🧹 [SOFT-RESET] Backup nube curado (legacy mapping).');
                    }
                }
            }
        } catch (e) {
            console.error('⚠️ [SOFT-RESET] Falló autocuración:', e.message);
        }
    }

    const INSTANCE_ID = process.env.RENDER_SERVICE_NAME 
        ? `${process.env.RENDER_SERVICE_NAME}_${(process.env.RENDER_INSTANCE_ID || Math.random().toString(36).substring(2, 7))}`
        : `local_${process.pid}_${Math.random().toString(36).substring(2, 7)}`;
    let _leaderHeartbeatInterval = null;

    async function startSocket() {
        if (isConnecting) {
            console.log('🛡️ [LOCK] Bloqueando intento de conexión duplicado en paralelo.');
            return;
        }
        isConnecting = true;

        // 0. CERROJO DISTRIBUIDO (ANTI-CONFLICTO 440 ENTRE MÚLTIPLES SERVICIOS DE RENDER)
        // Evita que dos servicios en Render (ej: fleetadmin-pro-1 y fleetadmin-web-nueva)
        // peleen por la misma sesión de WhatsApp y se desconecten mutuamente.
        if (db) {
            try {
                const lockSnap = await db.ref('bot_active_leader').once('value');
                const currentLeader = lockSnap.val();
                const now = Date.now();
                const isAnotherLeaderActive = currentLeader && 
                    currentLeader.id !== INSTANCE_ID && 
                    (now - (currentLeader.lastSeen || 0)) < 45000;

                // Si este servicio es fleetadmin-pro-1 y existe fleetadmin-web-nueva activo, ceder de inmediato
                const isLegacyService = (process.env.RENDER_SERVICE_NAME || '').includes('fleetadmin-pro-1');
                if (isLegacyService && currentLeader && currentLeader.id?.includes('web-nueva')) {
                    console.warn(`🛡️ [DISTRIBUTED-LOCK] Instancia legacy (${INSTANCE_ID}) cede el control a la instancia principal (${currentLeader.id}).`);
                    isConnecting = false;
                    return;
                }

                if (isAnotherLeaderActive) {
                    console.warn(`🛡️ [DISTRIBUTED-LOCK] Otra instancia activa detectada: "${currentLeader.id}". Esta instancia (${INSTANCE_ID}) queda en standby sin iniciar WhatsApp para evitar expulsión 440.`);
                    isConnecting = false;
                    setTimeout(() => { if (!_isConnectedState) startSocket(); }, 35000);
                    return;
                }

                // Asumir liderazgo activo
                await db.ref('bot_active_leader').set({
                    id: INSTANCE_ID,
                    serviceName: process.env.RENDER_SERVICE_NAME || 'local',
                    lastSeen: now,
                    startedAt: now
                });

                if (!_leaderHeartbeatInterval) {
                    _leaderHeartbeatInterval = setInterval(async () => {
                        if (_isConnectedState && db) {
                            try {
                                await db.ref('bot_active_leader/lastSeen').set(Date.now());
                            } catch(e) {}
                        }
                    }, 15000);
                }
            } catch(lockErr) {
                console.warn('⚠️ [DISTRIBUTED-LOCK] Error verificando cerrojo en Firebase:', lockErr.message);
            }
        }
        
        // WATCHDOG SANITARIO DE CERROJO: Si tras 90 segundos no hay éxito ni fallo definitivo, 
        // forzamos liberación para evitar congelamiento absoluto en la RAM de Render.
        const lockWatchdog = setTimeout(() => {
            if (isConnecting && !_isConnectedState) {
                console.warn('🚨 [WATCHDOG] Desbloqueando cerrojo por tiempo excedido (90s) para autorrecuperación.');
                isConnecting = false;
            }
        }, 90000);

        // Limpieza estricta de memoria: cerrar socket y limpiar listeners viejos si existen
        if (sock) {
            console.log('🧹 [LOCK] Destruyendo socket fantasma anterior para liberar listeners.');
            try { 
                sock.ev.removeAllListeners(); 
                sock.end(); 
            } catch(e) {}
            sock = null;
        }

        try {
            const { state, saveCreds } = await _firebaseAuthState();
            const { version } = await fetchLatestBaileysVersion();
            
            sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: true,
                logger: P({ level: 'silent' }),
                browser: ['Mac OS', 'Chrome', '14.4.1'],
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 0,
                keepAliveIntervalMs: 25000,
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                syncFullHistory: true,
                shouldSyncHistoryMessage: () => true,
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log(`📱 QR generado: https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=400x400`);
                }

                if (connection === 'close') {
                    clearTimeout(lockWatchdog); // Detener watchdog al finalizar el intento
                    isConnecting = false; // Liberar cerrojo
                    _isConnectedState = false;
                    _syncBotStatus();
                    
                    // Cancelar validador de salud inmediatamente al desconectar
                    if (_stableTimer) { clearTimeout(_stableTimer); _stableTimer = null; }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = DisconnectReason;
                    
                    console.log(`⚠️ Conexión cerrada. Código: ${statusCode}`);
                    
                    // Muy Importante: Borrar listeners del socket muerto para evitar bucles fantasma
                    try { sock?.ev?.removeAllListeners(); } catch(e) {}

                    if (statusCode === reason.loggedOut) {
                        console.log('🔴 Sesión cerrada por el usuario. Limpiando credenciales...');
                        await clearAuthInfo();
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await startSocket();
                    } else if (statusCode === 428) {
                        console.log('⚠️ [428] Precondición fallida. Intentando reset de conexión suave...');
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        await startSocket();
                    } else if (statusCode === 440 || statusCode === 503) {
                        retryCount++;
                        
                        // PROTOCOLO DE SUICIDIO CONTROLADO: Si el conflicto 440 persiste 3 veces, 
                        // matamos el proceso para que Render recicle limpio y elimine clones fantasmas de RAM.
                        // Omitido durante los primeros 5 minutos de arranque (warmup) para evitar fallos de despliegue.
                        if (retryCount >= 3) {
                            if (process.uptime() > 300) {
                                console.error('💥 [LOCK-FATAL] Conflicto 440 persistente. Matando proceso para autocuración completa en Render...');
                                process.exit(1);
                            } else {
                                console.warn('⚠️ [LOCK-WARMUP] Conflicto 440 durante el arranque. Ignorando suicidio por calentamiento (uptime < 5min)...');
                                retryCount = 0; // Resetear para seguir intentando
                            }
                        }

                        // Retardo racional con desincronización aleatoria (Jitter)
                        // Evita que dos clones conecten exactamente al mismo milisegundo
                        const delay440 = 15000 + Math.floor(Math.random() * 15000); 
                        console.log(`⚠️ [${statusCode}] Conflicto de sesión. Intento ${retryCount}. Esperando ${delay440/1000}s (Jitter)...`);
                        
                        if (retryCount >= 2) {
                            await softResetAuthInfo();
                        }

                        await new Promise(resolve => setTimeout(resolve, delay440));
                        await startSocket();
                    } else if (statusCode === reason.restartRequired || statusCode === reason.connectionTimedOut) {
                        console.log('🔄 Reconectando inmediatamente...');
                        await startSocket();
                    } else if (statusCode === 401) {
                        retryCount++;
                        if (retryCount > MAX_RETRIES) {
                            console.log('🔴 Sesión expirada (401). Limpiando sesión...');
                            await clearAuthInfo();
                            retryCount = 0;
                        }
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await startSocket();
                    } else {
                        retryCount++;
                        const delay = Math.min(5000 * retryCount, 30000);
                        console.log(`🔄 Reconectando en ${delay / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        await startSocket();
                    }
                } else if (connection === 'open') {
                    clearTimeout(lockWatchdog); // Éxito total, matar watchdog de cerrojo
                    isConnecting = false; // Liberar cerrojo al conectar con éxito
                    _isConnectedState = true;
                    console.log('✅ ¡Bot de WhatsApp CONECTADO!');
                    _syncBotStatus();

                    // Pre-popular el caché de nombres de grupo
                    try {
                        console.log('📡 [GROUP-CACHE] Solicitando lista de grupos en segundo plano...');
                        sock.groupFetchAllParticipating().then(participatingGroups => {
                            let cachedCount = 0;
                            for (const groupJid of Object.keys(participatingGroups || {})) {
                                const subject = participatingGroups[groupJid]?.subject;
                                if (subject) {
                                    groupNameCache[groupJid] = subject;
                                    cachedCount++;
                                }
                            }
                            console.log(`✅ [GROUP-CACHE] Caché inicializado con ${cachedCount} grupos.`);
                        }).catch(fetchErr => {
                            console.warn(`⚠️ [GROUP-CACHE] Error obteniendo grupos: ${fetchErr.message}`);
                        });
                    } catch (errCache) {
                        console.warn(`⚠️ [GROUP-CACHE] Error de inicio en caché: ${errCache.message}`);
                    }

                    
                    // BLINDAJE SANITARIO: Solo reseteamos el contador si el bot se mantiene VIVO
                    // y estable por lo menos 60 segundos consecutivos. Si muere antes, acumulamos
                    // el reintento para forzar el autokill del proceso fantasma.
                    if (_stableTimer) clearTimeout(_stableTimer);
                    _stableTimer = setTimeout(() => {
                        retryCount = 0;
                        console.log('💚 [HEALTH] Conexión estable por 60s. Contador de reintentos limpiado.');
                        _stableTimer = null;
                    }, 60000);
                }
            });

            sock.ev.on('creds.update', saveCreds);

            // ========================================================
            // SINCRONIZACIÓN DE HISTORIAL COMPLETO DE WHATSAPP
            // Baileys emite 'messaging-history.set' al conectar, entregando
            // todos los mensajes históricos de todos los chats del teléfono.
            // ========================================================
            sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
                const count = messages ? messages.length : 0;
                console.log(`📚 [HISTORY-SYNC] WhatsApp entregó paquete de historial: ${count} mensajes (isLatest=${isLatest})`);
                if (Array.isArray(messages) && messages.length > 0) {
                    let candidatesCount = 0;
                    const fleetId = await _resolveFleetId();
                    for (const histMsg of messages) {
                        try {
                            if (!histMsg || !histMsg.message) continue;
                            const m = histMsg.message;
                            const jid = histMsg.key?.remoteJid;
                            if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast')) continue;

                            const isImage = !!(_recursiveFindImage(m, 0) || m.imageMessage);
                            const docMsg = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
                            const isDoc = !!docMsg && (
                                docMsg.mimetype?.includes('pdf') || 
                                docMsg.mimetype?.includes('image') ||
                                (docMsg.fileName && /\.(pdf|jpg|jpeg|png)$/i.test(docMsg.fileName))
                            );
                            let text = m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || docMsg?.caption || '';
                            const hasKeywords = _hasTransferKeywords(m) || _hasTransferKeywords(text);

                            const hasCashKeywords = _hasCashKeywords(text);
                            if (isImage || isDoc || hasKeywords || hasCashKeywords) {
                                _enqueueCandidateMessage(histMsg);
                                candidatesCount++;
                                _processPotentialReceipt(histMsg, 'history', fleetId).catch(() => {});
                            }
                        } catch (hErr) {}
                    }
                    console.log(`📚 [HISTORY-SYNC] Historial analizado. Candidatos encolados: ${candidatesCount}. Total en cola: ${_recentHistoricalQueue.length}`);
                }
            });

            sock.ev.on('messages.upsert', async ({ messages, type }) => {
                console.log(`📨 [UPSERT] type=${type}, count=${messages.length}`);
                if (type !== 'notify' && type !== 'append') return; // Sincronizar tanto live como pendientes

                for (const msg of messages) {
                    try {
                    const jid = msg.key?.remoteJid;
                    if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast')) continue;

                    // Guardar en cola si es candidato a comprobante
                    _enqueueCandidateMessage(msg);

                    // ========================================================
                    // 1. ESCÁNER UNIVERSAL DE COMPROBANTES Y FACTURAS
                    // Se ejecuta para TODOS los chats (privados, contactos, choferes, grupos)
                    // SIN restricción de antigüedad ni filtros de tránsito.
                    // ========================================================
                    try {
                        const isReceipt = await _processPotentialReceipt(msg, type === 'notify' ? 'live' : 'history');
                        if (isReceipt) {
                            console.log(`🧾 [RECEIPT-PROCESSED] Comprobante procesado en chat: ${jid}.`);
                            continue; // Ya guardado como movimiento financiero en balance, no evaluar como alerta de tránsito
                        }
                    } catch (rErr) {
                        console.warn('⚠️ [RECEIPT-INTERCEPT] Error en detector de comprobante:', rErr.message);
                    }

                    // VALIDACIÓN DE FRESCURA PARA ALERTAS DE TRÁNSITO:
                    // - type='notify': mensajes en vivo → límite de 20 min (1200s)
                    // - type='append': mensajes acumulados mientras el bot estaba offline → límite de 4 horas (14400s)
                    //   Esto permite recuperar alertas perdidas cuando Render se durmió.
                    // IMPORTANTE: Los comprobantes e imágenes NO tienen límite de fecha (escaneo histórico).
                    const mRaw = msg.message;
                    const hasImageMsg = !!(mRaw && (mRaw.imageMessage || (typeof _recursiveFindImage === 'function' && _recursiveFindImage(mRaw, 0))));
                    const hasAudioMsg = !!(mRaw && (mRaw.audioMessage || mRaw.pttMessage));
                    
                    const msgSec = Number(msg.messageTimestamp) || 0;
                    const nowSec = Math.floor(Date.now() / 1000);
                    const ageSec = nowSec - msgSec;
                    
                    // Límite flexible: 4h para mensajes pendientes offline, 20 min para mensajes en vivo
                    const maxAgeSec = (type === 'append') ? 14400 : 1200;
                    
                    if (msgSec > 0 && ageSec > maxAgeSec && !hasImageMsg) {
                        console.log(`⏭️ [SKIP] Mensaje de texto/voz muy antiguo saltado (${ageSec}s de antigüedad, límite=${maxAgeSec}s, type=${type}).`);
                        continue;
                    }


                    const isGroup = jid.endsWith('@g.us');
                    const senderJid = msg.key.participant || msg.key.remoteJid || '';
                    const isFromTrustedAdmin = msg.key.fromMe || _isTrustedAdmin(senderJid) || _isTrustedAdmin(jid);
                    
                    // FILTRADO ESTRICTO DE PRIVACIDAD PARA ALERTAS DE TRÁNSITO: Omitir chats privados que no sean de un Admin de confianza
                    if (!isGroup && !isFromTrustedAdmin) {
                        continue;
                    }

                    if (isFromTrustedAdmin) {
                        console.log(`🐛 [ADMIN-RAW-MSG] ID=${msg.key.id} | HasMessage=${!!msg.message} | Keys=${Object.keys(msg.message || {})}`);
                        console.log(`🐛 [ADMIN-RAW-JSON] ${JSON.stringify(msg)}`);
                    }
                    
                    if (!jid) continue;

                    // --- EXTRAER CONTEXTO DEL GRUPO (con fallback inteligente y cache) ---
                    let groupName = isGroup ? 'Grupo Desconocido' : (isFromTrustedAdmin ? 'Admin Privado' : 'Chat Privado');
                    if (isGroup) {
                        if (groupNameCache[jid]) {
                            groupName = groupNameCache[jid];
                        } else {
                            try {
                                const groupInfo = await sock.groupMetadata(jid);
                                if (groupInfo?.subject) {
                                    groupName = groupInfo.subject;
                                    groupNameCache[jid] = groupName;
                                    console.log(`💾 [GROUP-CACHE] Nombre guardado: ${jid?.substring(0,15)}... -> "${groupName}"`);
                                }
                            } catch(ge) {
                                console.warn(`⚠️ [GROUP] No se pudo obtener metadatos del grupo ${jid?.substring(0,20)}: ${ge.message}`);
                                groupName = 'Grupo Desconocido';
                            }
                        }
                    }

                    // 2. FILTRADO ESTRICTO DE GRUPOS SELECCIONADOS (Solicitado por el usuario)
                    // Escanear grupos de operativos de tránsito y alertas (ej: 🚨ALERTAS2.0/APPS, Operativos Arroyo Seco, etc).
                    // Los chats privados del admin se permiten para diagnósticos.
                    let isTargetGroup = false;
                    if (isGroup) {
                        const cleanedGroupName = groupName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
                        isTargetGroup = cleanedGroupName.includes('operativos arroyo seco') || 
                                        cleanedGroupName.includes('solo operativos de transito') ||
                                        cleanedGroupName.includes('alertas') ||
                                        cleanedGroupName.includes('apps') ||
                                        _isOperativoGroup(groupName);
                        
                        if (!isTargetGroup) {
                            console.log(`⏭️ [SKIP-GROUP] Ignorando grupo no objetivo: "${groupName}"`);
                            continue;
                        }
                    } else {
                        // Si no es grupo pero llegó hasta aquí, es del admin
                        isTargetGroup = true;
                    }

                    const isKnownOperativoGroup = isTargetGroup;
                    console.log(`📱 [MSG] JID=${jid?.substring(0,20)}... | Grupo=${isGroup} | Admin=${isFromTrustedAdmin} | Nombre="${groupName}" | Operativo=${isKnownOperativoGroup}`);


                    // Extraer texto: cubrimos TODOS los formatos de mensaje de WhatsApp
                    let text = '';
                    const m = msg.message;
                    
                    if (m) {
                        text = m.conversation ||
                               m.extendedTextMessage?.text ||
                               m.imageMessage?.caption ||
                               m.videoMessage?.caption ||
                               m.documentMessage?.caption ||
                               m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
                               m.buttonsResponseMessage?.selectedDisplayText ||
                               m.templateButtonReplyMessage?.selectedId ||
                               m.listResponseMessage?.title ||
                               m.ephemeralMessage?.message?.conversation ||
                               m.ephemeralMessage?.message?.extendedTextMessage?.text ||
                               m.viewOnceMessage?.message?.imageMessage?.caption ||
                               m.viewOnceMessageV2?.message?.imageMessage?.caption ||
                               m.editedMessage?.message?.protocolMessage?.editedMessage?.conversation ||
                               m.editedMessage?.message?.protocolMessage?.editedMessage?.extendedTextMessage?.text ||
                               m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
                               '';
                        
                        // Búsqueda profunda si aún vacío: revisar primer nivel del objeto
                        if (!text) {
                            for (const key of Object.keys(m)) {
                                const val = m[key];
                                if (val && typeof val === 'object') {
                                    const t = val.text || val.caption || val.conversation;
                                    if (t && typeof t === 'string') { text = t; break; }
                                    if (val.message) {
                                        const deep = val.message.text || val.message.caption ||
                                                     val.message.conversation || val.message.extendedTextMessage?.text;
                                        if (deep && typeof deep === 'string') { text = deep; break; }
                                    }
                                }
                            }
                        }
                    }

                    // Debug: si el mensaje no tiene texto, loguear las claves para diagnosticar
                    if (!text && (isGroup || isFromTrustedAdmin) && m) {
                        const keys = Object.keys(m).filter(k => k !== 'messageContextInfo');
                        console.log(`🐛 [DEBUG] Mensaje sin texto. Claves: [${keys.join(', ')}]`);
                        // Log extra para admin: mostrar toda la estructura de message
                        if (isFromTrustedAdmin) {
                            try { console.log(`🐛 [DEBUG-ADMIN] Estructura: ${JSON.stringify(m, null, 0).substring(0, 500)}`); } catch(e) {}
                        }
                    }
                    
                    // RESCATE ABSOLUTO DE AUDIO: búsqueda deep recursiva en TODO el árbol del mensaje
                    // Detecta: mensajes directos, reenviados, ephemeral, viewOnce, viewOnceV2, etc.
                    let resolvedAudioMsg = null;
                    function _recursiveFindAudio(obj, depth) {
                        if (!obj || typeof obj !== 'object' || depth > 8) return null;
                        // Chequeo directo en este nivel
                        if (obj.audioMessage && typeof obj.audioMessage === 'object') return obj.audioMessage;
                        // Buscar en TODOS los valores del objeto recursivamente
                        for (const k of Object.keys(obj)) {
                            if (k === 'messageContextInfo' || k === 'contextInfo') continue; // evitar loops
                            const val = obj[k];
                            if (val && typeof val === 'object' && !Buffer.isBuffer(val)) {
                                const found = _recursiveFindAudio(val, depth + 1);
                                if (found) return found;
                            }
                        }
                        return null;
                    }
                    
                    if (m) {
                        resolvedAudioMsg = _recursiveFindAudio(m, 0);
                        // Fallback directo: el mensaje completo tiene audioMessage en raíz
                        if (!resolvedAudioMsg && m.audioMessage) {
                            resolvedAudioMsg = m.audioMessage;
                        }
                    }
                    const isAudio = !!resolvedAudioMsg;
                    const isPTT = !!(resolvedAudioMsg && resolvedAudioMsg.ptt);

                    // RESCATE ABSOLUTO DE IMAGEN: búsqueda deep recursiva en TODO el árbol del mensaje
                    let resolvedImageMsg = null;
                    function _recursiveFindImage(obj, depth) {
                        if (!obj || typeof obj !== 'object' || depth > 8) return null;
                        if (obj.imageMessage && typeof obj.imageMessage === 'object') return obj.imageMessage;
                        for (const k of Object.keys(obj)) {
                            if (k === 'messageContextInfo' || k === 'contextInfo') continue;
                            const val = obj[k];
                            if (val && typeof val === 'object' && !Buffer.isBuffer(val)) {
                                const found = _recursiveFindImage(val, depth + 1);
                                if (found) return found;
                            }
                        }
                        return null;
                    }

                    if (m) {
                        resolvedImageMsg = _recursiveFindImage(m, 0);
                        if (!resolvedImageMsg && m.imageMessage) {
                            resolvedImageMsg = m.imageMessage;
                        }
                    }
                    const isImage = !!resolvedImageMsg;

                    console.log(`📩 [MSG] From=${jid?.substring(0,15)}... | Group=${isGroup} | Audio=${isAudio} | Image=${isImage} | PTT=${isPTT} | Text="${text.substring(0,80)}"`);


                    // 1. PROCESAR AUDIO
                    let audioBuffer = null;
                    let audioUrl = null;
                    let isAudioOnlyAlert = false; // Flag: el mensaje es un audio sin texto

                    if (isAudio) {
                        // Comando especial .test_audio: bypass del filtro de grupo para pruebas del admin
                        const isTestCommand = text.trim().toLowerCase().startsWith('.test_audio');

                        // FILTRO ESTRICTO DE PRIVACIDAD:
                        // Solo procesar audio de:
                        //   1. Grupos conocidos de operativos/tránsito (nombre validado)
                        //   2. Chat privado de un admin de confianza
                        //   3. Comando .test_audio del admin
                        //
                        // NUNCA procesar audios de chats personales, grupos de amigos,
                        // familia u otros grupos que no sean de tránsito.
                        // "Grupo Desconocido" tampoco se procesa: si no pudimos leer el nombre,
                        // es más seguro saltarlo que arriesgar privacidad.
                        const shouldProcessAudio = isTestCommand || isFromTrustedAdmin || isKnownOperativoGroup;

                        if (!shouldProcessAudio) {
                            console.log(`🔒 [PRIVACIDAD] Audio IGNORADO: el chat "${groupName}" no es un grupo de operativos ni un admin de confianza. No se descarga ni procesa.`);
                            if (db) {
                                try {
                                    await db.ref('bot_debug_logs').push({
                                        event: 'audio_ignored_privacy',
                                        groupName: groupName,
                                        isGroup: isGroup,
                                        isFromTrustedAdmin: isFromTrustedAdmin,
                                        isKnownOperativoGroup: isKnownOperativoGroup,
                                        timestamp: Date.now()
                                    });
                                } catch(e) {}
                            }
                            continue;
                        }

                        if (isKnownOperativoGroup) {
                            console.log(`✅ [AUDIO-OK] Grupo "${groupName}" confirmado como operativo. Procesando audio...`);
                        } else if (isFromTrustedAdmin) {
                            console.log(`✅ [AUDIO-OK] Audio del admin de confianza. Procesando...`);
                        }

                        try {
                            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                            const cleanMsg = {
                                key: msg.key,
                                message: { audioMessage: resolvedAudioMsg }
                            };
                            audioBuffer = await downloadMediaMessage(cleanMsg, 'buffer', {}, {
                                logger: P({ level: 'silent' }),
                                reuploadRequest: sock.updateMediaMessage
                            });
                            console.log(`🎙️ [AUDIO] Descargado ${audioBuffer.length} bytes.`);

                            // Determinar la extensión del archivo de audio
                            let extension = 'ogg';
                            const mimeType = (resolvedAudioMsg && resolvedAudioMsg.mimetype) || '';
                            if (mimeType.includes('audio/mpeg') || mimeType.includes('audio/mp3')) {
                                extension = 'mp3';
                            } else if (mimeType.includes('audio/mp4') || mimeType.includes('audio/aac') || mimeType.includes('audio/m4a')) {
                                extension = 'm4a';
                            } else if (mimeType.includes('audio/wav') || mimeType.includes('audio/x-wav')) {
                                extension = 'wav';
                            }

                            const safeMsgIdAudio = msg.key.id.replace(/[^a-zA-Z0-9_-]/g, '_');
                            const audioFileName = `wsp_${safeMsgIdAudio}.${extension}`;

                            // ======================================================
                            // PRIORIDAD 1: Firebase Storage (URL permanente, no depende
                            // del disco efímero de Render que se borra en cada reinicio)
                            // ======================================================
                            let storageUploadOk = false;
                            try {
                                const { getStorage, getDownloadURL } = require('firebase-admin/storage');
                                const bucket = getStorage().bucket();
                                const storageFile = bucket.file(`audio/${audioFileName}`);
                                await storageFile.save(audioBuffer, {
                                    metadata: {
                                        contentType: mimeType || 'audio/ogg',
                                        cacheControl: 'public, max-age=86400'
                                    }
                                });
                                audioUrl = await getDownloadURL(storageFile);
                                storageUploadOk = true;
                                console.log(`☁️ [AUDIO] Subido a Firebase Storage → URL pública: ${audioUrl}`);
                            } catch (storageErr) {
                                console.warn(`⚠️ [AUDIO] Firebase Storage falló (${storageErr.message}), usando disco local como fallback...`);
                            }

                            // ======================================================
                            // FALLBACK: Disco local (solo funciona si el proceso NO
                            // se reinició - el archivo puede no existir luego de restart)
                            // ======================================================
                            if (!storageUploadOk) {
                                const audioDestDir = path.join(__dirname, '../../audio');
                                if (!fs.existsSync(audioDestDir)) {
                                    fs.mkdirSync(audioDestDir, { recursive: true });
                                }
                                const audioPath = path.join(audioDestDir, audioFileName);
                                fs.writeFileSync(audioPath, audioBuffer);
                                audioUrl = `/audio/${audioFileName}`;
                                console.log(`💾 [AUDIO] Guardado en disco local: ${audioPath} → URL relativa: ${audioUrl}`);
                            }

                            // Intentar transcribir usando Whisper si la API Key de OpenAI está configurada
                            if (process.env.OPENAI_API_KEY) {
                                try {
                                    console.log('🎙️ [WHISPER] Intentando transcribir audio en segundo plano...');
                                    const tmpPath = path.join(__dirname, `tmp_${Date.now()}.${extension}`);
                                    fs.writeFileSync(tmpPath, audioBuffer);

                                    const FormData = require('form-data');
                                    const form = new FormData();
                                    form.append('file', fs.createReadStream(tmpPath), { filename: `audio.${extension}`, contentType: mimeType || 'audio/ogg' });
                                    form.append('model', 'whisper-1');
                                    form.append('language', 'es');

                                    const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
                                        headers: { ...form.getHeaders(), 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                                    });

                                    fs.unlinkSync(tmpPath);
                                    if (whisperRes.data?.text) {
                                        text = whisperRes.data.text;
                                        console.log(`🎙️ [WHISPER] Audio transcrito: "${text}"`);
                                    }
                                } catch (whisperErr) {
                                    console.error('❌ [WHISPER] Error transcribiendo audio:', whisperErr.message);
                                }
                            }

                            // ============================================================
                            // FILTRO DE CONTENIDO: Gemini analiza el audio antes de publicar.
                            // Solo se crea alerta si el contenido es realmente de tránsito.
                            // ============================================================
                            if (!text) {
                                console.log('🎙️ [AUDIO-FILTER] Sin transcripción previa. Analizando contenido con Gemini...');
                                const audioAnalysis = await callGeminiAudio(audioBuffer, mimeType, groupName);
                                
                                if (audioAnalysis) {
                                    if (!audioAnalysis.isTrafficAlert) {
                                        // Audio irrelevante: música, tutorial, charla personal, etc.
                                        console.log(`🚫 [AUDIO-FILTER] Audio DESCARTADO — no es tránsito. Razón: "${audioAnalysis.reason}"`);
                                        continue; // Saltar este mensaje completamente
                                    }
                                    // Es alerta de tránsito: usar la transcripción como texto
                                    text = audioAnalysis.transcription || '';
                                    console.log(`✅ [AUDIO-FILTER] Audio APROBADO como alerta de tránsito (${audioAnalysis.type}).`);
                                    // Si Gemini detectó dirección y tipo, crear alerta directamente
                                    isAudioOnlyAlert = false;
                                    await _processAlert(
                                        audioAnalysis.address || null,
                                        text || '[REPORTE_DE_VOZ]',
                                        groupName,
                                        audioAnalysis.type || 'checkpoint',
                                        msg.key.id,
                                        audioUrl,
                                        audioAnalysis.transcription ? audioAnalysis.transcription.substring(0, 100) : 'Reporte por audio de voz',
                                        jid
                                    );
                                    continue;
                                } else {
                                    // Gemini no disponible o falló: publicar como checkpoint genérico (comportamiento anterior)
                                    console.log('⚠️ [AUDIO-FILTER] Gemini no disponible, publicando como alerta genérica.');
                                    isAudioOnlyAlert = true;
                                }
                            }
                        } catch (err) {
                            console.error('❌ Error descargando audio:', err.message);
                            if (db) {
                                try {
                                    await db.ref('bot_debug_logs').push({
                                        event: 'audio_download_failed',
                                        groupName: groupName,
                                        error: err.message,
                                        timestamp: Date.now()
                                    });
                                } catch(e) {}
                            }
                        }
                    }

                    // --- RASTREO DE ANCHO DE BANDA (ENTRANTE) ---
                    _trackBandwidth(msg, 'in');

                    // --- COMANDO ADMIN: .consumo ---
                    if (text.trim().toLowerCase() === '.consumo') {
                        // El usuario indico 549341xxxxxxx, validamos que el emisor real arranque con ese prefijo o sea el mismo celular
                        const sender = msg.key.participant || msg.key.remoteJid;
                        const adminPrefix = process.env.ADMIN_NUMBER || '549341';
                        if (msg.key.fromMe || sender.includes(adminPrefix)) {
                            if (db) {
                                const snap = await db.ref('stats/consumo_bandwidth').once('value');
                                const stats = snap.val() || { total_bytes: 0, in_bytes: 0, out_bytes: 0 };
                                const mbTotal = (stats.total_bytes / (1024 * 1024)).toFixed(3);
                                const mbIn = ((stats.in_bytes || 0) / (1024 * 1024)).toFixed(3);
                                const mbOut = ((stats.out_bytes || 0) / (1024 * 1024)).toFixed(3);
                                
                                const totalGB = 100;
                                const usedGB = stats.total_bytes / (1024 * 1024 * 1024);
                                const percent = ((usedGB / totalGB) * 100).toFixed(6);
                                
                                const resText = `📊 *Consumo de Ancho de Banda (Render)*\n\n` +
                                                `📥 *Entrante:* ${mbIn} MB\n` +
                                                `📤 *Saliente:* ${mbOut} MB\n` +
                                                `🧮 *Total Consumido:* ${mbTotal} MB\n\n` +
                                                `📦 *Plan Total (Hobby):* ${totalGB} GB\n` +
                                                `📈 *Porcentaje de uso:* ${percent}%`;
                                
                                await sock.sendMessage(jid, { text: resText }, { quoted: msg });
                                _trackBandwidth(resText, 'out');
                            }
                            continue;
                        }
                    }

                    // --- COMANDO ADMIN: .test_audio ---
                    // Fuerza el procesamiento del audio adjunto como alerta de prueba desde CUALQUIER grupo
                    if (text.trim().toLowerCase().startsWith('.test_audio') && audioUrl) {
                        const sender = msg.key.participant || msg.key.remoteJid;
                        const adminPrefix = process.env.ADMIN_NUMBER || '549341';
                        if (msg.key.fromMe || sender.includes(adminPrefix)) {
                            console.log(`🧪 [TEST-AUDIO] Procesando audio de prueba del admin desde grupo: "${groupName}"`);
                            await _processAlert(null, '[PRUEBA_DE_VOZ]', `TEST - ${groupName}`, 'checkpoint', msg.key.id, audioUrl, 'Prueba de audio del administrador');
                            if (sock) {
                                await sock.sendMessage(jid, { text: '✅ *Audio de prueba procesado correctamente.*\n\nLa alerta fue publicada en el mapa con el audio adjunto. Verificá en la app.' }, { quoted: msg });
                            }
                            continue;
                        } else {
                            console.log(`⚠️ [TEST-AUDIO] Comando ignorado: el remitente no es admin.`);
                        }
                    }

                    // --- COMANDOS ADMIN: CONFIRMACIÓN Y RECHAZO DE PAGOS / EFECTIVO ---
                    if (isFromTrustedAdmin && text) {
                        const cleanAdminText = text.trim().toLowerCase();
                        const confirmMatch = cleanAdminText.match(/^(si|confirmar|aprobar|ok|recibido)(\s+[0-9]{3,6})?$/i);
                        const rejectMatch = cleanAdminText.match(/^(no|rechazar|cancelar|descartar)(\s+[0-9]{3,6})?$/i);
                        const listPendingMatch = cleanAdminText.match(/^\.(pendientes|pagos|espera)$/i);

                        if (confirmMatch) {
                            const codeMatch = cleanAdminText.match(/\b([0-9]{3,6})\b/);
                            const code = codeMatch ? codeMatch[1] : null;
                            console.log(`👍 [ADMIN-CMD] Aprobación de pago solicitada (código=${code || 'último'})...`);
                            const res = await _confirmPendingPayment(code, null, 'whatsapp_admin');
                            await sock.sendMessage(jid, { text: res.message || (res.ok ? '✅ Pago confirmado y acreditado.' : '⚠️ No se pudo confirmar.') }, { quoted: msg });
                            continue;
                        }

                        if (rejectMatch) {
                            const codeMatch = cleanAdminText.match(/\b([0-9]{3,6})\b/);
                            const code = codeMatch ? codeMatch[1] : null;
                            console.log(`👎 [ADMIN-CMD] Rechazo de pago solicitado (código=${code || 'último'})...`);
                            const res = await _rejectPendingPayment(code, null, 'whatsapp_admin');
                            await sock.sendMessage(jid, { text: res.message || (res.ok ? '❌ Pago rechazado.' : '⚠️ No se pudo rechazar.') }, { quoted: msg });
                            continue;
                        }

                        if (listPendingMatch) {
                            console.log(`📋 [ADMIN-CMD] Listando pagos pendientes...`);
                            const list = await _listPendingPayments();
                            if (list.length === 0) {
                                await sock.sendMessage(jid, { text: '✨ *FleetAdmin Pro:* No tenés pagos ni entregas de efectivo pendientes de confirmación en este momento.' }, { quoted: msg });
                            } else {
                                let msgList = `📋 *PAGOS Y ENTREGAS PENDIENTES (${list.length})*\n\n`;
                                list.forEach((p, idx) => {
                                    const monto = Number(p.amount || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });
                                    msgList += `${idx + 1}. *#${p.code}* - $${monto} (${p.method})\n`;
                                    msgList += `   👤 ${p.party}\n`;
                                    msgList += `   📝 ${p.concept}\n`;
                                    msgList += `   👉 Respondé *SI ${p.code}* para aprobar o *NO ${p.code}* para rechazar\n\n`;
                                });
                                await sock.sendMessage(jid, { text: msgList.trim() }, { quoted: msg });
                            }
                            continue;
                        }
                    }

                    // --- COMANDO ADMIN/USUARIO: .escanear / .scan ---
                    if (text.trim().toLowerCase() === '.escanear' || text.trim().toLowerCase() === '.scan') {
                        const sender = msg.key.participant || msg.key.remoteJid;
                        if (msg.key.fromMe || isFromTrustedAdmin) {
                            console.log(`🔍 [ESCANEAR] Iniciando escaneo de comprobantes por comando para chat: ${jid}`);
                            await sock.sendMessage(jid, { 
                                text: '🔍 *FleetAdmin Pro:* Escaneando comprobantes e imágenes de transferencias...\n\nSincronizando automáticamente con la planilla de Google Sheets 📊' 
                            }, { quoted: msg });

                            try {
                                const senderNum = (sender || '').replace(/[^0-9]/g, '');
                                const fleetMatch = await _findFleetForPhone(senderNum);
                                const fleetId = fleetMatch?.fleetId || await _resolveFleetId();

                                await axios.post(`http://localhost:${process.env.PORT || 10000}/api/bot/scan-historical`, { fleetId }, { timeout: 30000 });
                                
                                const dbInstance = db;
                                let sheetUrl = null;
                                if (dbInstance) {
                                    const snap = await dbInstance.ref(`fleets/${fleetId}/settings/google_sheet_id`).once('value');
                                    sheetUrl = snap.val();
                                }

                                const replyText = `✅ *Escaneo e Integración Completados*\n\n` +
                                                  `📊 *Planilla de Google Sheets:* ${sheetUrl || 'Vinculada'}\n\n` +
                                                  `_Todas las transferencias procesadas han sido enviadas a la planilla de Google Sheets._ 🚗💰`;
                                await sock.sendMessage(jid, { text: replyText }, { quoted: msg });
                            } catch(scanErr) {
                                await sock.sendMessage(jid, { text: '⚠️ Error durante el escaneo: ' + scanErr.message }, { quoted: msg });
                            }
                            continue;
                        }
                    }

                    // --- 2. PROCESAR IMAGEN DE COMPROBANTE DE COMPRA/TRANSFERENCIA / ALERTA ---
                    if (isImage && getGeminiKey()) {
                        try {
                            console.log(`📸 [IMAGE] Descargando imagen para análisis multimodal (Comprobantes / Tránsito)...`);
                            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
                            const cleanMsg = {
                                key: msg.key,
                                message: { imageMessage: resolvedImageMsg }
                            };
                            const imageBuffer = await downloadMediaMessage(cleanMsg, 'buffer', {}, {
                                logger: P({ level: 'silent' }),
                                reuploadRequest: sock.updateMediaMessage
                            });
                            console.log(`📸 [IMAGE] Descargada imagen de ${imageBuffer.length} bytes.`);
                            
                            const mimeType = resolvedImageMsg.mimetype || 'image/jpeg';
                            
                            // 1. Verificar si es un comprobante de pago/transferencia/factura
                            const receiptAnalysis = await callGeminiReceipt(imageBuffer, mimeType);
                            if (receiptAnalysis && receiptAnalysis.isReceipt) {
                                console.log(`🧾 [RECEIPT-MATCH] Comprobante detectado: ${receiptAnalysis.type} de $${receiptAnalysis.amount}`);
                                const senderNum = (msg.key.participant || msg.key.remoteJid || '').replace('@s.whatsapp.net', '').replace('@c.us', '');
                                const fleetMatch = await _findFleetForPhone(senderNum);
                                
                                if (!fleetMatch || !fleetMatch.scannerEnabled) {
                                    console.log(`⚠️ [RECEIPT-REJECT] Escáner no habilitado para la flota.`);
                                    continue;
                                }

                                const movId = 'mov_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                                const formattedAmount = Number(receiptAnalysis.amount) || 0;
                                const senderDisplay = fleetMatch.driverName ? `${receiptAnalysis.party || 'Transferencia'} (${fleetMatch.driverName})` : (receiptAnalysis.party || 'Transferencia WhatsApp');
                                
                                const newMov = {
                                    id: movId,
                                    type: receiptAnalysis.type === 'Ingreso' ? 'Ingreso' : 'Egreso',
                                    amount: formattedAmount,
                                    concept: receiptAnalysis.concept || (receiptAnalysis.type === 'Ingreso' ? 'Transferencia recibida' : 'Gasto/Factura'),
                                    party: senderDisplay,
                                    date: receiptAnalysis.date || new Date().toISOString(),
                                    source: 'whatsapp_bot_image',
                                    senderPhone: senderNum,
                                    driverName: fleetMatch.driverName || null,
                                    driverId: fleetMatch.driverId || null,
                                    createdAt: Date.now()
                                };

                                if (db) {
                                    await db.ref(`fleets/${fleetMatch.fleetId}/movements/${movId}`).set(newMov);
                                    console.log(`✅ [RECEIPT-SAVED] Movimiento guardado en fleets/${fleetMatch.fleetId}/movements/${movId}`);
                                }

                                await _syncMovementToSheet(fleetMatch.fleetId, fleetMatch.settings, newMov);

                                const replyMsg = `✅ *Comprobante Procesado Exitosamente*\n\n` +
                                                 `📌 *Tipo:* ${newMov.type}\n` +
                                                 `💵 *Monto:* $${formattedAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
                                                 `👤 *Emisor/Comercio:* ${newMov.party}\n` +
                                                 `📝 *Concepto:* ${newMov.concept}\n` +
                                                 `📅 *Fecha:* ${newMov.date.substring(0, 10)}\n\n` +
                                                 `_Registrado automáticamente en FleetAdmin Pro y Google Sheets_ 🚗💰`;

                                await sock.sendMessage(jid, { text: replyMsg }, { quoted: msg });
                                _trackBandwidth(replyMsg, 'out');
                                continue;
                            }

                            // 2. Si no es comprobante, continuar con verificación de alertas de tránsito si corresponde
                            const shouldProcessImage = isFromTrustedAdmin || isKnownOperativoGroup;
                            if (shouldProcessImage) {
                                const imageAnalysis = await callGeminiImage(imageBuffer, mimeType);
                                if (imageAnalysis && imageAnalysis.isTrafficAlert) {
                                    console.log(`✅ [IMAGE-FILTER] Imagen aprobada como alerta de tránsito (${imageAnalysis.type}).`);
                                    text = text || imageAnalysis.description || '[REPORTE_DE_IMAGEN]';
                                    await _processAlert(
                                        imageAnalysis.address || null,
                                        text,
                                        groupName,
                                        imageAnalysis.type || 'checkpoint',
                                        msg.key.id,
                                        null,
                                        imageAnalysis.description || 'Reporte por imagen',
                                        jid
                                    );
                                    
                                    if (db) {
                                        await db.ref('bot_alerts').push({
                                            group: groupName,
                                            text: `[IMAGEN] ${text}`,
                                            analysis: { isAlert: true, type: imageAnalysis.type, address: imageAnalysis.address, description: imageAnalysis.description },
                                            timestamp: Date.now()
                                        });
                                    }
                                    continue;
                                }
                            }
                        } catch (imageErr) {
                            console.error('❌ Error procesando imagen con Gemini:', imageErr.message);
                        }
                    }

                    // --- 2.5 DETECCIÓN DE TRANSFERENCIAS / PAGOS EN MENSAJES DE TEXTO ---
                    if (text && !msg.key.fromMe && getGeminiKey()) {
                        try {
                            const senderNum = (msg.key.participant || msg.key.remoteJid || '').replace('@s.whatsapp.net', '').replace('@c.us', '');
                            const fleetMatch = await _findFleetForPhone(senderNum);
                            
                            if (fleetMatch && fleetMatch.scannerEnabled) {
                                const senderDisplay = fleetMatch.driverName || (isGroup ? (msg.pushName || 'Chofer') : 'WhatsApp');
                                const textReceipt = await callGeminiTextReceipt(text, senderDisplay);
                                
                                if (textReceipt && textReceipt.isReceipt && textReceipt.amount > 0) {
                                    console.log(`🧾 [TEXT-RECEIPT-MATCH] Pago/Transferencia detectada en texto: ${textReceipt.type} $${textReceipt.amount}`);
                                    const movId = 'mov_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                                    const formattedAmount = Number(textReceipt.amount) || 0;
                                    const newMov = {
                                        id: movId,
                                        type: textReceipt.type === 'Ingreso' ? 'Ingreso' : 'Egreso',
                                        amount: formattedAmount,
                                        concept: textReceipt.concept || 'Transferencia por WhatsApp',
                                        party: fleetMatch.driverName ? `${textReceipt.party || 'Transferencia'} (${fleetMatch.driverName})` : (textReceipt.party || senderDisplay),
                                        date: textReceipt.date || new Date().toISOString(),
                                        source: 'whatsapp_bot_text',
                                        senderPhone: senderNum,
                                        driverName: fleetMatch.driverName || null,
                                        driverId: fleetMatch.driverId || null,
                                        createdAt: Date.now()
                                    };

                                    if (db) {
                                        await db.ref(`fleets/${fleetMatch.fleetId}/movements/${movId}`).set(newMov);
                                        console.log(`✅ [TEXT-RECEIPT-SAVED] Movimiento guardado en fleets/${fleetMatch.fleetId}/movements/${movId}`);
                                    }

                                    await _syncMovementToSheet(fleetMatch.fleetId, fleetMatch.settings, newMov);

                                    const replyMsg = `✅ *Comprobante Registrado Automáticamente*\n\n` +
                                                     `📌 *Tipo:* ${newMov.type}\n` +
                                                     `💵 *Monto:* $${formattedAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
                                                     `👤 *Emisor:* ${newMov.party}\n` +
                                                     `📝 *Concepto:* ${newMov.concept}\n` +
                                                     `📅 *Fecha:* ${newMov.date.substring(0, 10)}\n\n` +
                                                     `_Registrado en Balance y Google Sheets_ 🚗💰`;

                                    await sock.sendMessage(jid, { text: replyMsg }, { quoted: msg });
                                    _trackBandwidth(replyMsg, 'out');
                                    continue;
                                }
                            }
                        } catch(textRecErr) {
                            console.warn('⚠️ [TEXT-RECEIPT] Error analizando texto contable:', textRecErr.message);
                        }
                    }

                    // --- FILTRO DE PALABRAS PROHIBIDAS / INSULTOS ---
                    if (_containsForbiddenWords(text)) {
                        console.log(`🚫 [CENSOR] Mensaje descartado por contener insultos/palabras prohibidas: "${text}"`);
                        continue;
                    }

                    // Para audios sin texto: crear alerta directamente (ya validado que el grupo es operativo al descargar)
                    if (isAudioOnlyAlert && audioUrl) {
                        console.log(`🎤 [AUDIO-ALERTA] Audio de voz recibido del grupo operativo: "${groupName}". Creando alerta checkpoint.`);
                        await _processAlert(null, '[REPORTE_DE_VOZ]', groupName, 'checkpoint', msg.key.id, audioUrl, 'Reporte por audio de voz', jid);
                        continue; // Saltar análisis de IA — no hay texto
                    }

                    // Si no es audio y no hay texto, saltar
                    if (!text) { console.log('⏭️ [SKIP] Sin texto'); continue; }

                    if (_isObviousChatter(text)) {
                        console.log(`⏭️ [SKIP-CHATTER] Omitiendo charla general/saludo obvio: "${text}"`);
                        continue;
                    }

                    // PRE-FILTRADO DE PALABRAS CLAVE (Optimización de cuota de Gemini)
                    const hasKeywords = _hasTrafficKeywords(text);
                    if (!hasKeywords && !isFromTrustedAdmin) {
                        console.log(`⏭️ [SKIP-NO-KEYWORDS] Omitiendo mensaje porque no contiene palabras clave de tránsito: "${text.substring(0,60)}"`);
                        continue;
                    }

                    console.log(`🧠 [GEMINI] Analizando: "${text.substring(0,60)}..." [Grupo: ${groupName}]`);
                    
                    try {
                        // Pasamos el nombre del grupo como CONTEXTO GEOGRÁFICO a Gemini
                        let analysis = await _analyzeMessageWithAI(text, groupName);
                        
                        // Si Gemini falla, usar detector de palabras clave
                        if (!analysis) {
                            const kw = _keywordDetect(text);
                            if (kw) {
                                // Si no hay dirección de keywords, intentar extraerla del texto
                                const extractedAddr = kw.address || _extractIntersection(text);
                                console.log(`🔑 [KEYWORD] Detectado: ${kw.type} | Dir: ${extractedAddr || 'sin dirección'}`);
                                analysis = { isAlert: true, type: kw.type, address: extractedAddr, description: text.substring(0, 100), confidence: 0.7 };
                            }
                        }
                        
                        if (analysis && analysis.isAlert) {
                            console.log(`🚨 [ALERT] Detectada por IA: type=${analysis.type}, address=${analysis.address}`);

                            // Guardar en Firebase (diagnóstico)
                            if (db) {
                                await db.ref('bot_alerts').push({
                                    group: groupName,
                                    text: text,
                                    analysis: analysis,
                                    timestamp: Date.now()
                                });
                            }

                            // Procesar la alerta pasando el message ID único, audioUrl y description
                            await _processAlert(analysis.address, text, groupName, analysis.type, msg.key.id, audioUrl, analysis.description, jid);
                            
                        } else {
                            // Si no es alerta, ver si es una pregunta directa al bot
                            const botNumber = sock.user?.id?.split(':')[0] || '';
                            const isMentioned = text.toLowerCase().includes(botNumber) || text.toLowerCase().includes('bot');
                            // Responder charlas genéricas o preguntas por privado solo si viene de un admin de confianza y no es un mensaje saliente
                            const isPrivate = !isGroup && isFromTrustedAdmin && !msg.key.fromMe;

                            if ((isPrivate || isMentioned) && !msg.key.fromMe) {
                                console.log(`🧠 [CHAT] Respondiendo consulta...`);
                                const aiResponse = await callGemini(text);
                                if (aiResponse) {
                                    await sock.sendMessage(jid, { text: aiResponse }, { quoted: msg });
                                    _trackBandwidth(aiResponse, 'out');
                                }
                            }
                        }
                    } catch (err) {
                        console.error('❌ Error en el flujo de IA:', err.message);
                    }
                    } catch (outerErr) {
                        // Si es error de MAC, es un mensaje que no se puede descifrar (normal en WhatsApp)
                        // Solo logueamos y continuamos — no reseteamos la sesión
                        if (outerErr.message && (outerErr.message.includes('MAC') || outerErr.message.includes('decrypt'))) {
                            console.log('⚠️ [MAC] Mensaje no descifrable (llave desincronizada), saltando...');
                            continue; // Saltar este mensaje y procesar el siguiente
                        }
                        console.error('💥 [CRASH] Error procesando mensaje:', outerErr.message);
                    }
                }
            });

        } catch (err) {
            clearTimeout(lockWatchdog); // Matar watchdog en caso de error síncrono del constructor
            isConnecting = false; // 🔓 [DESBLOQUEO CRÍTICO] Liberar cerrojo para evitar deadlock permanente en reintentos
            console.error('❌ Error fatal en startSocket:', err.message);
            retryCount++;
            const delay = Math.min(10000 * retryCount, 60000);
            console.log(`🔄 Reintentando en ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            await startSocket();
        }
    }

    /**
     * Detección rápida por palabras clave (FALLBACK si Gemini falla)
     */
    function _keywordDetect(text) {
        const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        // Si indica que ya se limpió, se retiró o no hay nada, ignorar
        if (/\b(?:limpio|limpiaron|ya\s+no\s+estan|se\s+fueron|levantaron|suspendido|todo\s+libre|via\s+libre|esta\s+libre|no\s+hay\s+nada)\b/i.test(t)) {
            return null;
        }
        // Si es una pregunta o consulta (contiene ? o palabras de duda/pregunta), ignorar
        if (t.includes('?') || /\b(?:alguien\s+sabe|saben\s+si|info\b|reporta\s+si|saben\s+algo|hay\s+algo|alguien\s+vio|que\s+onda|pasa\s+algo|alguien\s+que\s+sepa)\b/i.test(t)) {
            return null;
        }
        // Si contiene palabras explícitas del pasado o anécdotas personales/charlas, ignorar
        if (/\b(?:ayer|anoche|anteayer|el\s+otro\s+dia|la\s+otra\s+vez|semana\s+pasada|mes\s+pasado|año\s+pasado)\b/i.test(t)) {
            return null;
        }
        if (/helicoptero|codigo rojo/.test(t)) return { type: 'helicopter', address: 'Pellegrini y Vera Mujica' };
        if (/accidente|choque/.test(t)) return { type: 'accident', address: null };
        if (/ambulancia|samu/.test(t)) return { type: 'ambulance', address: null };
        if (/bomberos|incendio|fuego/.test(t)) return { type: 'firetruck', address: null };
        if (/municipal|zorros|inspectores|carreton|grua|motos|fiscalizacion|fiscalisacion|fizca|fisca|fizcalizacion|fizcalisacion|servicio publico|servicios publicos|control de transito|operativo de transito|operativo transito/.test(t)) return { type: 'municipal', address: null };
        if (/gorra|ratis|chanchos|cana|policia|patrulla/.test(t)) return { type: 'police', address: null };
        if (/operativo|operatico|control/.test(t)) return { type: 'checkpoint', address: null };
        if (/radar|camara|foto multa|multa foto/.test(t)) return { type: 'radar', address: null };
        if (/corte|cortada|trafico|tráfico|transito|bache|inundacion/.test(t)) return { type: 'traffic', address: null };
        return null;
    }

    /**
     * Analiza el mensaje con Gemini (HTTP directo) para detectar alertas.
     */
    async function _analyzeMessageWithAI(text, groupName = '') {
        if (!GEMINI_KEY) return null;
        
        const prompt = `Sos un detector de alertas de tránsito para un grupo de WhatsApp de conductores de flota en Argentina.
Tu ÚNICA misión es detectar si un mensaje reporta un incidente vial ACTIVO Y CONCRETO.

REGLA NÚMERO 1 — EXCLUSIÓN DE MENSAJES SIN REPORTE VIAL (CRÍTICA):
- Si el mensaje es SOLO un nombre propio, apodo, mote o forma de llamar a alguien (ej: "roti", "juanchi", "el gordo", "carlitos", "toto", "el vasco", "tío", "che"), responde ESTRICTAMENTE con {"isAlert":false}. Los apodos NO son alertas de tránsito.
- Si el mensaje es solo un nombre de persona o conjunto de nombres/apodos sin ningún verbo de acción ni ubicación vial, responde ESTRICTAMENTE con {"isAlert":false}.
- Si el mensaje tiene MENOS DE 4 PALABRAS y no contiene explícitamente una palabra clave de tránsito (operativo, control, gorra, radar, accidente, corte, obstrucción), responde ESTRICTAMENTE con {"isAlert":false}.

REGLA DE EXCLUSIÓN DE PREGUNTAS (CRÍTICA):
- Si el mensaje es una pregunta, consulta, duda o pedido de información (ej: "¿Hay operativo en la ruta?", "alguien sabe si hay zorros?", "en kenedy y la ruta hay operativo?", "cómo está tal calle?", "¿está libre Arijón?", "algo de arroyo a pavón?", "algo de arroyo a pavón"), responde ESTRICTAMENTE con {"isAlert":false}. Solo debes reportar como alertas los avisos y reportes afirmativos y concretos de controles o incidentes activos.

REGLAS DE EXCLUSIÓN DE CHARLA GENERAL / AGRADECIMIENTOS (CRÍTICA):
- Si el mensaje es un saludo (ej: "buen día", "hola"), un agradecimiento o respuesta de cortesía (ej: "gracias viejo", "muchas gracias", "buenísimo gracias", "ok gracias", "muchas gracias de verdad"), o una conversación personal/comentario general que no reporta activamente un nuevo incidente (ej: "yo estoy saliendo de arroyo", "está complicado", "qué mala suerte", "quería saber gracias"), responde ESTRICTAMENTE con {"isAlert":false}.

REGLAS DE EXCLUSIÓN DE ANÉCDOTAS, HISTORIAS Y EVENTOS PASADOS (CRÍTICA):
- Si el mensaje describe un evento pasado (ej: "ayer había operativo", "anoche lo pararon", "le pasó a un compañero", "el otro día pasé"), responde ESTRICTAMENTE con {"isAlert":false}.
- Si el mensaje cuenta una historia personal, anécdota, estafa, robo, discusión o situación particular de un chofer (ej: "fue a buscar un pedido y lo esperaba la policía por estafa", "le robaron a uno en tal lado", "me peleé con un inspector"), responde ESTRICTAMENTE con {"isAlert":false}. Las alertas deben ser ÚNICAMENTE avisos de utilidad general para la navegación activa (controles activos ahora, radares, accidentes con obstrucción, cortes de tránsito).

REGLA DE EXCLUSIÓN DE ALERTAS FINALIZADAS / LIMPIAS (CRÍTICA):
- Si el mensaje indica que un control, operativo, accidente o corte ya se limpió, se retiró, se fue, está libre o ya no está (ej: "ya está limpio", "todo limpio", "se fueron los zorros", "ya no hay nada", "ya lo levantaron", "limpio Pellegrini"), responde ESTRICTAMENTE con {"isAlert":false}. No queremos reportar como alertas los controles que ya dejaron de estar activos.

- Solo debes reportar como alertas los reportes AFIRMATIVOS y CONCRETOS de controles, operativos, radares o incidentes viales activos. El campo "confidence" debe reflejar qué tan seguro estás: usa 0.9 si el mensaje es claro y concreto, 0.5 si es ambiguo.
        
CONTEXTO GEOGRÁFICO DE ORIGEN:
- Nombre del Grupo de WhatsApp: "${groupName}"
- Mensaje escrito por el conductor: "${text}"

REGLA DE DEDUCCIÓN ESPACIAL (CRÍTICA):
Los conductores raramente escriben la ciudad completa. Debes DEDUCIR e INFERIR la ubicación basándote fuertemente en el NOMBRE DEL GRUPO o en palabras clave del texto.
- Ciudades comunes en la región: "Rosario", "Arroyo Seco", "Pueblo Esther", "Funes", "Roldán", "San Lorenzo", "Granadero Baigorria", "Capitán Bermúdez", "Villa Constitución", "Pérez", "Ibarlucea", "Alvear", "Villa Gobernador Gálvez" (VGG).
- Si el nombre del grupo menciona una ciudad (ej: "Operativos Arroyo Seco", "Accidentes Pueblo Esther") o el mensaje menciona una de estas ciudades, asume ese contexto geográfico y agrégalo explícitamente a la dirección que devuelvas.
- NUNCA inventes una dirección si el texto no la contiene. Si no hay calle mencionada explícitamente, pon "address": null.

NORMALIZACIÓN DE ABREVIATURAS GLOBALES (IMPORTANTE):
- "av" / "av." = Avenida
- "bv" / "bvard" / "blvd" = Boulevard
- "pte" = Presidente
- "cba" = Córdoba
- "pcia" = Provincia
- "muni" = Municipal
- "cruce" = Intersección o Rotonda
- Corrige errores fonéticos obvios en nombres de calles locales pero JAMÁS alucines con direcciones en otros idiomas o países distantes si no corresponde.

REGLAS DE CLASIFICACIÓN (MUY IMPORTANTE - PRIORIDADES):
1. "CODIGO ROJO" / "HELICOPTERO" → tipo: "helicopter"
2. "ACCIDENTE", "CHOQUE", colisión vial → tipo: "accident"
3. "AMBULANCIA", "SAMU", urgencias médicas → tipo: "ambulance"
4. "BOMBEROS", "INCENDIO", "FUEGO" → tipo: "firetruck"
5. Si el mensaje menciona control "municipal", "grúa", "fiscalización", "fiscalisacion", "fizca", "fisca", "fizcalización", "fizcalisacion", "servicio público", "inspectores", "zorros", "motos" o acarreo de vehículos/motos (ej: "carretón", "llevando motos"), clasifícalo estrictamente como "municipal", incluso si también menciona presencia o apoyo policial.
6. Mensajes que mencionen "policía", "patrulla", "operativo policial", "cuerpo policial", "comando" → tipo: "police" (solo si no califica como municipal).
7. Si menciona "OPERATIVO" (a veces escrito con errores como "operatico") o "CONTROL" genérico sin especificar fuerza → tipo: "checkpoint"
8. "RADAR", "CAMARA", "FOTOMULTA", "MULTA FOTO", "RADAR MOVIL" → tipo: "radar"
9. Cortes de calle, baches, inundaciones, protestas, tráfico pesado, tránsito demorado → tipo: "traffic"

Responde ÚNICAMENTE con un objeto JSON válido sin explicaciones ni formato markdown adicional:
{"isAlert":boolean,"type":"police"|"checkpoint"|"radar"|"helicopter"|"ambulance"|"firetruck"|"municipal"|"accident"|"traffic","address":"dirección completa con ciudad/región inferida o null","description":"un resumen extremadamente breve (máximo 8 palabras o 60 caracteres), limpio y directo en español, optimizado para ser leído por un conductor en pantalla mientras maneja (ejemplos: 'Control policial y de motos', 'Accidente vehicular - demora leve', 'Cruce cortado por bache', 'Inspectores con grúa'). Sin emojis, saludos ni rodeos.","confidence":0.0}
Si NO es una alerta de tránsito u operativo: {"isAlert":false}`;

        try {
            const jsonText = await callGemini(prompt);
            if (!jsonText) return null;
            const clean = jsonText.trim().replace(/```json|```/g, '').trim();
            const analysis = JSON.parse(clean);
            if (analysis.isAlert) {
                // Umbral mínimo de confianza: 0.6. Por debajo, rechazar para evitar falsos positivos.
                const confidence = parseFloat(analysis.confidence || 0);
                if (confidence < 0.6) {
                    console.log(`⚠️ [GEMINI] Alerta descartada por baja confianza (${confidence.toFixed(2)} < 0.6): "${text.substring(0,60)}"`);
                    return null;
                }
                return analysis;
            }
        } catch (e) {
            console.error('❌ [GEMINI] Error parseando respuesta:', e.message);
        }
        return null;
    }

    function _isValidIntersection(street1, street2) {
        const forbiddenWords = [
            'cuando', 'llego', 'hecho', 'pedido', 'buscar', 'companero', 'anoche', 'ayer', 
            'hola', 'gracias', 'viejo', 'bueno', 'malo', 'todo', 'nada', 'cosa', 'estafa', 'policia', 
            'control', 'operativo', 'radar', 'camara', 'fotomulta', 'grua', 'inspector', 'gracias',
            'por', 'para', 'como', 'pero', 'porque', 'donde', 'quien', 'cual', 'este', 'esta', 'estos',
            'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'ellos', 'ellas', 'nosotros',
            'ustedes', 'yo', 'tu', 'el', 'ella', 'lo', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
            'mi', 'tu', 'su', 'mis', 'tus', 'sus', 'nuestro', 'nuestra', 'suspenso', 'sospechoso',
            'hacer', 'hace', 'haciendo', 'hecho', 'tengo', 'tiene', 'tienen', 'tenia', 'tenian',
            'gente', 'paso', 'pasa', 'mandado', 'estaba', 'estaban', 'esperando', 'quien', 'quienes'
        ];
        
        const s1 = street1.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const s2 = street2.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        if (s1.length < 3 || s2.length < 3 || s1.length > 35 || s2.length > 35) return false;
        
        const words = [...s1.split(/\s+/), ...s2.split(/\s+/)];
        for (const w of words) {
            if (forbiddenWords.includes(w)) return false;
        }
        
        return true;
    }

    /**
     * Extrae calles de un texto usando Regex.
     */
    function _extractIntersection(text) {
        // Normalizar texto reemplazando delimitadores de intersección comunes por " y "
        let normalized = text
            .replace(/\b(?:a\s+la\s+altura\s+de|esquina|esq\.?|entre|e\/)\b/gi, ' y ')
            .replace(/\be\b/gi, ' y ') // Normalizar conjunción copulativa 'e' a 'y'
            .replace(/\s+/g, ' ');

        // Regex para "Calle A y Calle B"
        const regex = /([a-z0-9\sáéíóúñ.]+)\sy\s([a-z0-9\sáéíóúñ.]+)/i;
        const match = normalized.match(regex);
        if (match) {
            let street1 = match[1].trim();
            let street2 = match[2].trim();

            // 1. Limpiar street1: tomar la última parte que no tenga puntuación especial o emojis
            let cleanStreet1 = street1;
            let streetParts1 = street1.split(/[^a-zA-Z0-9\sáéíóúñÁÉÍÓÚÑ]/);
            if (streetParts1.length > 0) {
                for (let i = streetParts1.length - 1; i >= 0; i--) {
                    const segment = streetParts1[i].trim();
                    if (segment.length > 0) {
                        cleanStreet1 = segment;
                        break;
                    }
                }
            }

            // Limpiar palabras comunes al inicio de la primera calle
            const noise = ['hay', 'en', 'visto', 'un', 'el', 'una', 'operativo', 'control', 'la', 'los', 'las', 'del', 'de'];
            let words1 = cleanStreet1.split(' ');
            while (words1.length > 0 && noise.includes(words1[0].toLowerCase())) {
                words1.shift();
            }
            if (words1.length > 3) {
                words1 = words1.slice(-3);
            }
            cleanStreet1 = words1.join(' ');

            // 2. Limpiar street2: tomar la primera parte antes de la puntuación especial
            let cleanStreet2 = street2;
            let streetParts2 = street2.split(/[^a-zA-Z0-9\sáéíóúñÁÉÍÓÚÑ]/);
            if (streetParts2.length > 0) {
                for (let i = 0; i < streetParts2.length; i++) {
                    const segment = streetParts2[i].trim();
                    if (segment.length > 0) {
                        cleanStreet2 = segment;
                        break;
                    }
                }
            }

            // Cortar street2 en palabras clave que indican información colateral
            let words2 = cleanStreet2.split(' ');
            let cleanWords2 = [];
            for (let i = 0; i < words2.length; i++) {
                const w = words2[i].trim();
                if (['frente', 'cerca', 'atencion', 'eviten', 'zona', 'llega', 'operativo', 'control', 'en'].includes(w.toLowerCase())) {
                    break;
                }
                cleanWords2.push(w);
            }
            cleanStreet2 = cleanWords2.slice(0, 3).join(' ');

            if (cleanStreet1 && cleanStreet2) {
                if (_isValidIntersection(cleanStreet1, cleanStreet2)) {
                    return `${cleanStreet1} y ${cleanStreet2}`;
                } else {
                    console.log(`🚫 [REGEX-GEO] Intersección descartada por contener palabras no válidas de calle: "${cleanStreet1} y ${cleanStreet2}"`);
                }
            }
        }
        return null;
    }
    /**
     * Diccionario de calles rosarinas: nombre popular → nombre completo
     * Para que Nominatim pueda encontrar "Roca y Corrientes" como "Presidente Roca y Corrientes"
     */
    const ROSARIO_STREET_ALIASES = {
        // Calles principales abreviadas
        'roca': 'Presidente Roca',
        'pellegrini': 'Carlos Pellegrini',
        'lagos': 'Ovidio Lagos',
        'oroño': 'Boulevard Oroño',
        'orono': 'Boulevard Oroño',
        'mitre': 'Bartolomé Mitre',
        'sarmiento': 'Domingo Sarmiento',
        'moreno': 'Mariano Moreno',
        'urquiza': 'Justo José de Urquiza',
        'brown': 'Almirante Brown',
        'belgrano': 'Manuel Belgrano',
        'rivadavia': 'Bernardino Rivadavia',
        'alvear': 'Marcelo T de Alvear',
        'alem': 'Leandro N Alem',
        'illia': 'Arturo Illia',
        'circunvalacion': 'Avenida de Circunvalación',
        'circunbalacion': 'Avenida de Circunvalación',
        'circunva': 'Avenida de Circunvalación',
        'circunbala': 'Avenida de Circunvalación',
        // Avenidas
        'francia': 'Avenida Francia',
        'españa': 'España',
        'alberdi': 'Juan Bautista Alberdi',
        'godoy': 'Avenida Presidente Perón',
        'arijon': 'Arijón',
        'avellaneda': 'Avenida Avellaneda',
        'eva peron': 'Avenida Eva Perón',
        'uriburu': 'Uriburu',
        'necochea': 'Necochea',
        'battle y ordoñez': 'Battle y Ordóñez',
        // Calles del centro
        'cafferata': 'Cafferata',
        'caferata': 'Cafferata',
        'corrientes': 'Corrientes',
        'cordoba': 'Córdoba',
        'cordova': 'Córdoba',
        'mendoza': 'Mendoza',
        'santa fe': 'Santa Fe',
        'san juan': 'San Juan',
        'san luis': 'San Luis',
        'san lorenzo': 'San Lorenzo',
        'san martin': 'San Martín',
        'san nicolas': 'San Nicolás',
        'rioja': 'La Rioja',
        'la rioja': 'La Rioja',
        'entre rios': 'Entre Ríos',
        'tucuman': 'Tucumán',
        'catamarca': 'Catamarca',
        'santiago': 'Santiago',
        'jujuy': 'Jujuy',
        'maipu': 'Maipú',
        'laprida': 'Laprida',
        'balcarce': 'Balcarce',
        'zeballos': 'Zeballos',
        'wheelwright': 'Wheelwright',
        'cochabamba': 'Cochabamba',
        'pasco': 'Pasco',
        'callao': 'Callao',
        'suipacha': 'Suipacha',
        'dorrego': 'Dorrego',
        'virasoro': 'Virasoro',
        'vera mujica': 'Vera Mujica',
        'ayacucho': 'Ayacucho',
        'montevideo': 'Montevideo',
        'ituzaingo': 'Ituzaingó',
        '27': '27 de Febrero',
        '27 de febrero': '27 de Febrero',
        'bv oroño': 'Boulevard Oroño',
        'bv. oroño': 'Boulevard Oroño',
        'bvar oroño': 'Boulevard Oroño',
        'juan jose paso': 'Juan José Paso',
        'jj paso': 'Juan José Paso',
        'peron': 'Avenida Presidente Perón',
        'newbery': 'Jorge Newbery',
        'warnes': 'Warnes',
    };

    /**
     * Expande nombres abreviados de calles rosarinas a sus nombres completos
     */
    function _expandStreetNames(address) {
        if (!address) return address;
        
        // Separar por " y " (intersección) o por " al " (altura)
        let parts;
        let separator;
        
        if (address.toLowerCase().includes(' y ')) {
            parts = address.split(/\s+y\s+/i);
            separator = ' y ';
        } else if (address.toLowerCase().includes(' al ')) {
            parts = address.split(/\s+al\s+/i);
            separator = ' al ';
        } else {
            parts = [address];
            separator = '';
        }

        const expanded = parts.map(part => {
            const trimmed = part.trim().toLowerCase();
            // Buscar coincidencia exacta primero
            if (ROSARIO_STREET_ALIASES[trimmed]) {
                return ROSARIO_STREET_ALIASES[trimmed];
            }
            // Buscar coincidencia parcial (si la calle tiene un número al final, ej: "roca 2000")
            const words = trimmed.split(' ');
            const lastWord = words[words.length - 1];
            const streetPart = words.slice(0, -1).join(' ');
            if (/^\d+$/.test(lastWord) && ROSARIO_STREET_ALIASES[streetPart]) {
                return `${ROSARIO_STREET_ALIASES[streetPart]} ${lastWord}`;
            }
            return part.trim(); // Devolver original si no hay alias
        });

        const result = expanded.join(separator);
        
        // CORRECCIÓN MATEMÁTICA ULTRA-ROBUSTA (HARDENING):
        // Evitamos de raíz que fallos de la IA o typos dejen "Avenida Oroño" o "Arizona"
        let hardened = result;
        
        if (/oroño|orono/i.test(hardened)) {
            // Reemplazar "Avenida Oroño" o "Av. Oroño" por "Boulevard Oroño"
            hardened = hardened.replace(/avenida\s+oro[ñn]o/gi, 'Boulevard Oroño')
                               .replace(/\bav\.?\s+oro[ñn]o/gi, 'Boulevard Oroño');
            
            // Si dice "Oroño" a secas, anteponer "Boulevard " si no tiene prefijo
            if (!/boulevard|bvar|bv\.?/i.test(hardened)) {
                hardened = hardened.replace(/\boro[ñn]o\b/gi, 'Boulevard Oroño');
            }
        }

        // Evitar la alucinación "Arizona" -> "Arijón"
        if (/arizona/i.test(hardened)) {
            hardened = hardened.replace(/\barizona\b/gi, 'Arijón');
        }

        if (hardened.toLowerCase() !== address.toLowerCase()) {
            console.log(`🏷️ [ALIAS] "${address}" -> "${hardened}"`);
        }
        return hardened;
    }

    /**
     * Geocodifica y guarda en Firebase.
     */
    const CITY_COORDINATES = {
        'Rosario': { lat: -32.9468, lng: -60.6393 },
        'Arroyo Seco': { lat: -33.1531, lng: -60.5239 },
        'Pueblo Esther': { lat: -33.0744, lng: -60.5750 },
        'Funes': { lat: -32.9168, lng: -60.8118 },
        'Roldán': { lat: -32.8986, lng: -60.9069 },
        'San Lorenzo': { lat: -32.7456, lng: -60.7335 },
        'Granadero Baigorria': { lat: -32.8533, lng: -60.6974 },
        'Capitán Bermúdez': { lat: -32.8184, lng: -60.7143 },
        'Villa Constitución': { lat: -33.2274, lng: -60.3294 },
        'Carcarañá': { lat: -32.8601, lng: -61.1448 },
        'Pérez': { lat: -32.9986, lng: -60.7709 },
        'Ibarlucea': { lat: -32.8624, lng: -60.7937 },
        'Alvear': { lat: -33.0401, lng: -60.6366 },
        'Villa Gobernador Gálvez': { lat: -32.9922, lng: -60.6300 }
    };

    function _detectCity(text, groupName = '') {
        const fullContent = `${groupName} ${text}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        
        if (/\barroyo(\s+seco)?\b/.test(fullContent)) return 'Arroyo Seco';
        if (/\bpueblo\s+esther\b/.test(fullContent)) return 'Pueblo Esther';
        if (/\bfunes\b/.test(fullContent)) return 'Funes';
        if (/\broldan\b/.test(fullContent)) return 'Roldán';
        if (/\bsan\s+lorenzo\b/.test(fullContent)) return 'San Lorenzo';
        if (/\bbaigorria\b|\bgranadero\s+baigorria\b/.test(fullContent)) return 'Granadero Baigorria';
        if (/\bbermudez\b|\bcapitan\s+bermudez\b/.test(fullContent)) return 'Capitán Bermúdez';
        if (/\bvilla\s+constitucion\b/.test(fullContent)) return 'Villa Constitución';
        if (/\bcarcara[nñ]a\b/.test(fullContent)) return 'Carcarañá';
        if (/\bperez\b/.test(fullContent)) return 'Pérez';
        if (/\bibarlucea\b/.test(fullContent)) return 'Ibarlucea';
        if (/\balvear\b/.test(fullContent)) return 'Alvear';
        if (/\bshangri\b/.test(fullContent)) return 'Pueblo Esther';
        if (/\bvgg\b|\bvilla\s+gobernador\s+galvez\b/.test(fullContent)) return 'Villa Gobernador Gálvez';

        return 'Rosario';
    }

     async function _processAlert(address, originalText, sourceGroup, aiType = null, messageId = null, audioUrl = null, description = null, jid = null) {
        const fleetId = await _resolveFleetId();
        // Generar una clave determinista basada en el ID de WhatsApp si existe.
        // Esto asegura que si se procesa el mismo mensaje 2 veces, se pise el registro en lugar de duplicarse en el mapa.
        const safeMsgId = messageId ? `wsp_${messageId.replace(/[^a-zA-Z0-9_]/g, '_')}` : `bot_${Date.now()}`;
        const alertId = safeMsgId;
        
        // Determinar tipo
        let type = aiType || (/gorra|control|operativo|zorros|chanchos|ratis/i.test(originalText) ? 'police' : 'warning');
        
        // Detectar ciudad
        const city = _detectCity(originalText, sourceGroup);
        const cityCoords = CITY_COORDINATES[city] || CITY_COORDINATES['Rosario'];
        
        let lat = cityCoords.lat;
        let lng = cityCoords.lng;
        let approximate = true;
        
        let expandedAddress = address;
        let isContextFallback = false;

        // Si no hay dirección provista, buscar contexto reciente en el grupo
        if ((!expandedAddress || expandedAddress === 'null' || expandedAddress === '') && jid && groupAddressContext[jid]) {
            const context = groupAddressContext[jid];
            const age = Date.now() - context.timestamp;
            if (age < 15 * 60 * 1000) { // 15 minutos
                expandedAddress = context.address;
                isContextFallback = true;
                console.log(`🎯 [CONTEXT-GEO] Usando dirección del contexto reciente del grupo (${age/1000}s de antigüedad): "${expandedAddress}"`);
            }
        }
        
        try {
            // Caso especial: Helicóptero en Pellegrini y Vera Mujica (HECA)
            if (type === 'helicopter' || /codigo rojo|helicoptero/i.test(originalText)) {
                lat = -32.9515;
                lng = -60.6625;
                approximate = false;
                expandedAddress = "Pellegrini y Vera Mujica";
                console.log('🚁 [HECA] Ubicación forzada para Helicóptero Sanitario');
            } else if (!expandedAddress || expandedAddress === 'null') {
                // Sin dirección: usar ubicación neutra
                console.log(`⚠️ [GEO] Sin dirección exacta. Usando centro de ${city}`);
            } else {
                expandedAddress = _expandStreetNames(address);
                let isResolved = false;
                
                // --- NIVEL 1: GOOGLE MAPS GEOCODING API (Gold Standard) ---
                // Dado que el usuario ya cuenta con facturación vinculada y clave oficial, habilitamos este canal ultrapreciso.
                const googleApiKey = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyATwi1CCdw5q-8nYXTsTn8VCKoP13jbHBE';
                if (googleApiKey) {
                    try {
                        console.log(`🔍 [GEO-GOOGLE] Intentando geocodificación prémium para: "${expandedAddress}" en ciudad: "${city}"`);
                        // Buscamos forzando la región y el idioma en Argentina
                        const queryAddress = `${expandedAddress}, ${city}, Santa Fe, Argentina`;
                        const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(queryAddress)}&language=es&region=AR&key=${googleApiKey}`;
                        const gResponse = await axios.get(gUrl, { timeout: 6000 });
                        
                        if (gResponse.data?.status === 'OK' && gResponse.data.results?.length > 0) {
                            const loc = gResponse.data.results[0].geometry.location;
                            const tempLat = parseFloat(loc.lat);
                            const tempLng = parseFloat(loc.lng);
                            
                            // Validar que el resultado esté dentro de 60km del centro de la ciudad esperada
                            const distKm = Math.sqrt(
                                Math.pow((tempLat - cityCoords.lat) * 111, 2) +
                                Math.pow((tempLng - cityCoords.lng) * 111 * Math.cos(cityCoords.lat * Math.PI / 180), 2)
                            );
                            
                            if (distKm <= 60) {
                                lat = tempLat;
                                lng = tempLng;
                                approximate = false;
                                isResolved = true;
                                console.log(`📍 [GEO-GOOGLE] ✅ ¡Ubicación válida a ${distKm.toFixed(1)}km del centro! Lat=${lat}, Lng=${lng}`);
                            } else {
                                console.warn(`⚠️ [GEO-GOOGLE] Resultado a ${distKm.toFixed(1)}km del centro de ${city} — posible dirección inventada. Descartando, se usará ubicación aproximada.`);
                                // No marcar como isResolved, intentar Photon o fallback
                            }
                        } else {
                            console.warn(`⚠️ [GEO-GOOGLE] Fallo en respuesta (status=${gResponse.data?.status || 'UNKNOWN'}). Procediendo al fallback gratuito...`);
                        }
                    } catch (errG) {
                        console.warn(`⚠️ [GEO-GOOGLE] Error de conexión o autorización: ${errG.message}. Procediendo al fallback gratuito...`);
                    }
                }

                // --- NIVEL 2: PHOTON FALLBACK (En caso de que la API de Google no esté activada en la consola) ---
                if (!isResolved) {
                    // Respetar delay básico para evitar rate limits
                    await new Promise(r => setTimeout(r, 1200));
                    
                    console.log(`🔍 [GEO-PHOTON] Ejecutando consulta gratuita de emergencia para: "${expandedAddress}" en ciudad: "${city}"`);
                    
                    // REPARACIÓN CRÍTICA: Reemplazar " y " por ", " para Photon/OpenStreetMap
                    const cleanAddressForGeo = expandedAddress.replace(/\s+[yY]\s+/gi, ', ');
                    const fullAddress = `${cleanAddressForGeo}, ${city}, Argentina`;
                    
                    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(fullAddress)}&limit=1&lat=${cityCoords.lat}&lon=${cityCoords.lng}`;
                    const response = await axios.get(url, { timeout: 8000 });
                    const features = response.data?.features || [];

                    if (features.length > 0 && features[0].geometry?.coordinates) {
                        const tempLng = parseFloat(features[0].geometry.coordinates[0]);
                        const tempLat = parseFloat(features[0].geometry.coordinates[1]);
                        
                        // Validación de cercanía: el resultado debe estar a ≤ 60km del centro esperado.
                        // Esto evita que Nominatim/Photon devuelva una ciudad en otro país o provincia.
                        const distKm = Math.sqrt(
                            Math.pow((tempLat - cityCoords.lat) * 111, 2) +
                            Math.pow((tempLng - cityCoords.lng) * 111 * Math.cos(cityCoords.lat * Math.PI / 180), 2)
                        );
                        if (distKm <= 60) {
                            lng = tempLng;
                            lat = tempLat;
                            approximate = false;
                            console.log(`📍 [GEO-PHOTON] ✅ Ubicación válida a ${distKm.toFixed(1)}km del centro: ${lat}, ${lng}`);
                        } else {
                            console.warn(`⚠️ [GEO-PHOTON] Resultado a ${distKm.toFixed(1)}km del centro de ${city} — demasiado lejos, descartando. Usando ubicación aproximada de la ciudad.`);
                            // approximate = true ya es el valor por defecto
                        }
                    } else {
                        console.log(`⚠️ [GEO-PHOTON] Sin resultados.`);
                    }
                }
            }
        } catch (err) {
            console.error(`⚠️ [GEO] Error (${err.message}), guardando con ubicación aproximada`);
        }

        // Guardar dirección exitosa en el contexto del grupo
        if (!approximate && jid && !isContextFallback && expandedAddress) {
            groupAddressContext[jid] = {
                address: expandedAddress,
                timestamp: Date.now()
            };
            console.log(`💾 [CONTEXT-GEO] Actualizando contexto geográfico del grupo ${jid} con: "${expandedAddress}"`);
        }

        const alertData = {
            id: alertId,
            type: type,
            location: expandedAddress || "Ubicación desconocida",
            lat: lat,
            lng: lng,
            timestamp: Date.now(),
            expiresAt: Date.now() + (60 * 60 * 1000),
            authorName: sourceGroup,
            originalText: originalText,
            description: description || (originalText ? originalText.substring(0, 60) : ''),
            confirmations: approximate ? 0 : 1,
            status: 'active',
            source: 'whatsapp_bot',
            approximate: approximate
        };
        if (audioUrl) {
            alertData.audioUrl = audioUrl;
        }

        console.log(`💾 [DB] Guardando alerta en nodo GLOBAL y en todas las flotas...`);

        if (db) {
            try {
                // ✅ NODO GLOBAL: Todos los celulares escuchan este nodo sin importar la flota
                await db.ref(`global_traffic_alerts/${alertId}`).set(alertData);
                console.log(`✅ [DB] Alerta publicada en global_traffic_alerts/${alertId}`);

                // Broadcast también a TODAS las flotas existentes (compatibilidad)
                const snap = await db.ref('fleets').once('value');
                const fleets = snap.val() || {};
                
                const updatePromises = Object.keys(fleets).map(fId => {
                    return db.ref(`fleets/${fId}/traffic_alerts/${alertId}`).set(alertData);
                });
                
                await Promise.all(updatePromises);
                console.log(`✅ [DB] ¡¡¡ALERTA PUBLICADA EN ${updatePromises.length} FLOTAS + GLOBAL!!! type=${alertData.type}, lat=${lat}, lng=${lng}, exact=${!approximate}`);

                // Send push notification to admins
                const alertTypeNames = {
                    police: 'Control de Policía 👮',
                    checkpoint: 'Operativo / Control 🚧',
                    radar: 'Radar / Fotomulta 📷',
                    helicopter: 'Helicóptero HECA 🚁',
                    traffic: 'Alerta de Tráfico 🚦',
                    warning: 'Alerta de Tránsito ⚠️'
                };
                const typeName = alertTypeNames[alertData.type] || 'Alerta de Tránsito ⚠️';
                sendPushToAdmins(
                    `🚨 ${typeName}`,
                    `Ubicación: ${alertData.location}. Reportado en el grupo: ${sourceGroup}`,
                    { alertId: alertId, type: alertData.type }
                );
            } catch (e) {
                console.error('❌ [FIREBASE] Error guardando alerta global/flotas:', e.message);
            }
        } else {
            console.error('❌ [DB] Firebase db es NULL - NO SE PUEDE GUARDAR');
        }
    }

    async function sendPushToAdmins(title, body, additionalData = {}) {
        if (!db) {
            console.log('🔔 [PUSH] DB not ready, cannot send push.');
            return;
        }
        try {
            const tokensSnap = await db.ref('fcm_tokens').once('value');
            const tokensVal = tokensSnap.val();
            if (!tokensVal) {
                console.log('🔔 [PUSH] No FCM tokens found in DB.');
                return;
            }

            const adminTokens = [];
            for (const [userId, tData] of Object.entries(tokensVal)) {
                if (tData.token && tData.role === 'admin') {
                    adminTokens.push(tData.token);
                }
            }

            if (adminTokens.length === 0) {
                console.log('🔔 [PUSH] No admin FCM tokens found.');
                return;
            }

            console.log(`🔔 [PUSH] Sending notification to ${adminTokens.length} admin(s): "${title} - ${body}"`);

            const payload = {
                notification: {
                    title: title,
                    body: body
                },
                data: {
                    title: title,
                    body: body,
                    url: '/',
                    ...additionalData
                }
            };

            const response = await admin.messaging().sendEachForMulticast({
                tokens: adminTokens,
                notification: payload.notification,
                data: payload.data
            });

            console.log(`🔔 [PUSH] Multicast sent. Success: ${response.successCount}, Failure: ${response.failureCount}`);

            // Cleanup inactive tokens
            if (response.responses) {
                response.responses.forEach(async (resp, idx) => {
                    if (!resp.success) {
                        const errCode = resp.error?.code;
                        if (errCode === 'messaging/registration-token-not-registered' || errCode === 'messaging/invalid-registration-token') {
                            const tokenToRemove = adminTokens[idx];
                            for (const [uId, tData] of Object.entries(tokensVal)) {
                                if (tData.token === tokenToRemove) {
                                    console.log(`🧹 [PUSH] Removing inactive token for user: ${uId}`);
                                    await db.ref(`fcm_tokens/${uId}`).remove();
                                    break;
                                }
                            }
                        }
                    }
                });
            }
        } catch (e) {
            console.error('❌ [PUSH] Error sending push notification:', e.message);
        }
    }

    async function checkFCMTokensAndDetectUninstalls() {
        if (!db) {
            console.log('📊 [UNINSTALL-SCANNER] DB not ready, skipping check.');
            return;
        }
        try {
            console.log('📊 [UNINSTALL-SCANNER] Starting FCM token verification scan...');
            const tokensSnap = await db.ref('fcm_tokens').once('value');
            const tokensVal = tokensSnap.val();
            if (!tokensVal) {
                console.log('📊 [UNINSTALL-SCANNER] No tokens to verify.');
                return;
            }

            let uninstalledCount = 0;
            let checkedCount = 0;

            for (const [userId, tData] of Object.entries(tokensVal)) {
                if (!tData.token) continue;
                checkedCount++;
                try {
                    // Validate token via dry-run send (it doesn't actually deliver a notification)
                    await admin.messaging().send({
                        token: tData.token,
                        data: { dryRun: 'true' }
                    }, true);
                } catch (error) {
                    const errCode = error.code;
                    if (errCode === 'messaging/registration-token-not-registered' || 
                        errCode === 'messaging/invalid-registration-token') {
                        
                        console.log(`📊 [UNINSTALL-SCANNER] Uninstall detected for user: ${userId} (${tData.userName || 'Unknown'})`);
                        
                        // Mark as uninstalled in app_installations
                        const now = Date.now();
                        await db.ref(`app_installations/${userId}`).update({
                            status: 'uninstalled',
                            uninstalledAt: now,
                            lastActive: now
                        });

                        // Remove the obsolete token from fcm_tokens to stop testing it
                        await db.ref(`fcm_tokens/${userId}`).remove();
                        uninstalledCount++;
                    } else {
                        console.warn(`📊 [UNINSTALL-SCANNER] Other validation error for user ${userId}:`, error.message);
                    }
                }
            }
            console.log(`📊 [UNINSTALL-SCANNER] Scan complete. Checked: ${checkedCount}, Uninstalls detected: ${uninstalledCount}`);
        } catch (err) {
            console.error('❌ [UNINSTALL-SCANNER] Error during FCM scan:', err.message);
        }
    }


    async function resetSession() {
        console.log('🔄 [RESET] Forzando limpieza de sesión COMPLETA (Requiere QR)...');
        if (sock) {
            try { await sock.logout(); } catch(e) { /* ignorar */ }
            sock = null;
        }
        await clearAuthInfo();
        await new Promise(r => setTimeout(r, 3000));
        await startSocket();
        console.log('✅ [RESET] Sesión limpiada, bot reiniciado. Buscá el QR en los logs.');
    }

    async function softResetSession() {
        console.log('🔧 [SOFT-RESET] Aplicando curación manual sin pérdida de emparejamiento...');
        if (sock) {
            try { sock.end(); } catch(e) {}
            sock = null;
        }
        await softResetAuthInfo();
        await new Promise(r => setTimeout(r, 3000));
        retryCount = 0;
        await startSocket();
        console.log('✅ [SOFT-RESET] Autocuración ejecutada, intentando reconexión instantánea.');
    }

    /**
     * Limpieza automática de Base de Datos: elimina alertas expiradas y posiciones viejas.
     * Se ejecuta al iniciar y luego cada 12 horas.
     */
    function _startDatabaseCleanup() {
        if (!db) return;
        console.log('🧹 [CRON] Sistema de auto-limpieza de DB programado (cada 12hs).');
        
        async function runCleanup() {
            try {
                const now = Date.now();
                console.log('🧹 [CRON] Iniciando limpieza automática de DB...');

                // 1. Purgar Traffic Alerts viejas (más de 24hs)
                const cutOffAlerts = now - (24 * 60 * 60 * 1000);
                const fleetsSnap = await db.ref('fleets').once('value');
                const fleets = fleetsSnap.val();
                
                let countAlerts = 0;
                const audioFilesToDelete = new Set();
                if (fleets) {
                    for (const fid in fleets) {
                        const alerts = fleets[fid].traffic_alerts;
                        if (alerts) {
                            for (const aid in alerts) {
                                const a = alerts[aid];
                                // Si tiene timestamp y es más viejo que 24hs, O si expiró explícitamente
                                if ((a.timestamp && a.timestamp < cutOffAlerts) || (a.expiresAt && a.expiresAt < now)) {
                                    if (a.audioUrl) {
                                        audioFilesToDelete.add(a.audioUrl);
                                    }
                                    await db.ref(`fleets/${fid}/traffic_alerts/${aid}`).remove();
                                    countAlerts++;
                                }
                            }
                        }
                    }
                }

                // 1b. Purgar también el nodo GLOBAL de alertas
                const globalAlertsSnap = await db.ref('global_traffic_alerts').once('value');
                const globalAlerts = globalAlertsSnap.val();
                if (globalAlerts) {
                    for (const aid in globalAlerts) {
                        const a = globalAlerts[aid];
                        if ((a.timestamp && a.timestamp < cutOffAlerts) || (a.expiresAt && a.expiresAt < now)) {
                            if (a.audioUrl) audioFilesToDelete.add(a.audioUrl);
                            await db.ref(`global_traffic_alerts/${aid}`).remove();
                            countAlerts++;
                        }
                    }
                }

                // Borrar archivos de audio físicos si expiraron
                if (audioFilesToDelete.size > 0) {
                    const audioDestDir = path.join(__dirname, '../../audio');
                    for (const url of audioFilesToDelete) {
                        try {
                            const filename = path.basename(url);
                            const filepath = path.join(audioDestDir, filename);
                            if (fs.existsSync(filepath)) {
                                fs.unlinkSync(filepath);
                                console.log(`🧹 [CRON] Audio eliminado físicamente: ${filepath}`);
                            }
                        } catch (err) {
                            console.error(`❌ [CRON] Error eliminando audio: ${url}`, err.message);
                        }
                    }
                }

                // 2. Purgar Posiciones GPS fantasma (inactivas más de 12 horas)
                const cutOffGps = now - (12 * 60 * 60 * 1000);
                const positionsSnap = await db.ref('driver_positions').once('value');
                const positions = positionsSnap.val();
                
                let countPositions = 0;
                if (positions) {
                    for (const uid in positions) {
                        const p = positions[uid];
                        // Usar el timestamp o _lastUpdate
                        const ts = p.timestamp || p._lastUpdate || p.lastUpdate;
                        if (ts && ts < cutOffGps) {
                            await db.ref(`driver_positions/${uid}`).remove();
                            countPositions++;
                        }
                    }
                }

                // 3. Verificar desinstalaciones vía tokens de FCM
                await checkFCMTokensAndDetectUninstalls();

                console.log(`✨ [CRON] Limpieza finalizada. Removidas ${countAlerts} alertas viejas y ${countPositions} posiciones fantasma.`);

            } catch (e) {
                console.error('❌ [CRON] Error en rutina de limpieza DB:', e.message);
            }
        }

        // Ejecutar la primera vez después de 2 minutos (para no saturar el arranque del bot)
        setTimeout(runCleanup, 120000);
        // Programar cada 12 horas
        setInterval(runCleanup, 12 * 60 * 60 * 1000);
    }

    /**
     * Sincroniza un movimiento financiero con Google Sheets (Webhook de Apps Script o Endpoint del Servidor)
     */
    async function _syncMovementToSheet(fleetId, settings, newMov) {
        if (!newMov) return false;
        try {
            const sheetId = (settings?.google_sheet_id || '').trim();
            if (!sheetId) {
                try {
                    await axios.post(`http://localhost:${process.env.PORT || 10000}/api/sheets/append`, {
                        fleetId: fleetId,
                        movement: newMov
                    }, { timeout: 8000 });
                    return true;
                } catch(e) {
                    return false;
                }
            }

            if (sheetId.startsWith('https://script.google.com/')) {
                await axios.post(sheetId, JSON.stringify(newMov), {
                    headers: { 'Content-Type': 'application/json' },
                    maxRedirects: 5,
                    timeout: 10000
                });
                console.log(`📊 [RECEIPT-SHEETS] Movimiento $${newMov.amount} sincronizado con Apps Script Webhook ✅`);
                return true;
            } else {
                await axios.post(`http://localhost:${process.env.PORT || 10000}/api/sheets/append`, {
                    google_sheet_id: sheetId,
                    fleetId: fleetId,
                    movement: newMov
                }, { timeout: 12000 });
                console.log(`📊 [RECEIPT-SHEETS] Movimiento $${newMov.amount} sincronizado vía servidor ✅`);
                return true;
            }
        } catch(sErr) {
            console.warn(`⚠️ [RECEIPT-SHEETS] Error sincronizando movimiento a Google Sheets:`, sErr.message);
            return false;
        }
    }

    /**
     * Escanea mensajes recientes en busca de comprobantes y sincroniza el balance con Google Sheets.
     */
    async function scanRecentMessages(limit = 500, targetFleetId = null) {
        let fleetId = targetFleetId;
        if (!fleetId || fleetId === 'jose07' || fleetId === 'default') {
            fleetId = await _resolveFleetId();
        }
        console.log(`🔍 [SCAN-RECENTS] Iniciando escaneo de comprobantes para flota: ${fleetId}...`);
        
        let found = 0;
        let synced = 0;
        let totalMovements = 0;

        try {
            if (!db) return { ok: false, error: 'Base de datos no inicializada' };

            // Si la cola en memoria está vacía, intentar restaurar desde Firebase bot_receipt_queue
            if (_recentHistoricalQueue.length === 0) {
                try {
                    const snap = await db.ref('bot_receipt_queue').limitToLast(500).once('value');
                    const savedQueue = snap.val();
                    if (savedQueue && typeof savedQueue === 'object') {
                        for (const item of Object.values(savedQueue)) {
                            if (item && item.key && item.message) {
                                _recentHistoricalQueue.push(item);
                            }
                        }
                        console.log(`📦 [SCAN-RECENTS] Restaurados ${_recentHistoricalQueue.length} mensajes desde bot_receipt_queue.`);
                    }
                } catch(loadErr) {
                    console.warn('⚠️ [SCAN-RECENTS] Error recargando cola:', loadErr.message);
                }
            }

            // 1. Procesar todos los mensajes candidatos retenidos en _recentHistoricalQueue
            if (_recentHistoricalQueue.length > 0) {
                console.log(`🔍 [SCAN-RECENTS] Analizando ${_recentHistoricalQueue.length} mensajes en cola de WhatsApp para flota ${fleetId}...`);
                for (const msg of _recentHistoricalQueue) {
                    try {
                        const wasReceipt = await _processPotentialReceipt(msg, 'scan_manual', fleetId);
                        if (wasReceipt) found++;
                    } catch(mErr) {
                        // continuar
                    }
                }
            }

            // 2. Obtener settings de la flota
            const fleetSnap = await db.ref(`fleets/${fleetId}/settings`).once('value');
            const settings = fleetSnap.val() || {};
            const sheetUrl = settings.google_sheet_id || null;

            // 3. Obtener movimientos ya existentes en la flota
            const movsSnap = await db.ref(`fleets/${fleetId}/movements`).once('value');
            const existingMovs = movsSnap.val() || {};
            totalMovements = Object.keys(existingMovs).length;

            // 4. Sincronizar todos los movimientos con la hoja de Google Sheets si hay una vinculada
            if (sheetUrl && sheetUrl.startsWith('https://script.google.com/')) {
                console.log(`📊 [SCAN-RECENTS] Sincronizando ${totalMovements} movimientos con Webhook de Google Sheets...`);
                for (const [mId, m] of Object.entries(existingMovs)) {
                    if (!m._syncedToSheet) {
                        const ok = await _syncMovementToSheet(fleetId, settings, m);
                        if (ok) {
                            synced++;
                            await db.ref(`fleets/${fleetId}/movements/${mId}/_syncedToSheet`).set(true);
                        }
                    }
                }
            }

            console.log(`✅ [SCAN-RECENTS] Escaneo finalizado. Total movimientos en balance: ${totalMovements}. Nuevos procesados: ${found}. Sincronizados a Sheets: ${synced}`);
            return {
                ok: true,
                fleetId,
                totalMovements,
                newProcessed: found,
                syncedToSheets: synced,
                sheetUrl
            };
        } catch(e) {
            console.error('❌ [SCAN-RECENTS] Error en escaneo:', e.message);
            return { ok: false, error: e.message };
        }
    }

    // Escuchar señales de terminación del SO (evita colisiones 440 Zombies durante redeploys)
    process.on('SIGTERM', () => {
        console.log('🛑 [SIGTERM] Solicitud de apagado recibida. Cerrando socket WhatsApp y liberando sesión...');
        if (sock) { try { sock.end(); } catch(e) {} }
        setTimeout(() => process.exit(0), 500);
    });
    process.on('SIGINT', () => {
        console.log('🛑 [SIGINT] Cerrando socket y saliendo...');
        if (sock) { try { sock.end(); } catch(e) {} }
        setTimeout(() => process.exit(0), 500);
    });

    function getQueueStatus() {
        return {
            queueSize: _recentHistoricalQueue.length,
            processedReceiptsCount: _processedReceiptMsgIds.size,
            nonReceiptsCount: _nonReceiptMsgIds.size,
            hasGeminiKey: !!getGeminiKey(),
            sample: _recentHistoricalQueue.slice(0, 3).map(m => ({
                id: m.key?.id,
                jid: m.key?.remoteJid?.substring(0, 25),
                timestamp: m.messageTimestamp,
                hasMsg: !!m.message,
                keys: Object.keys(m.message || {}).slice(0, 5)
            }))
        };
    }

    return { 
        init, 
        resetSession,
        softResetSession,
        getFleetId: _resolveFleetId,
        getDb: () => db,
        getGeminiKey,
        isConnected: () => _isConnectedState,
        sendPushToAdmins,
        scanRecentMessages,
        syncMovementToSheet: _syncMovementToSheet,
        getQueueStatus,
        createPendingPayment: _createPendingPayment,
        confirmPendingPayment: _confirmPendingPayment,
        rejectPendingPayment: _rejectPendingPayment,
        listPendingPayments: _listPendingPayments
    };
})();

module.exports = WhatsappBot;
