const admin = require('firebase-admin');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const serviceAccount = require('../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'fleetadmin-pro.firebasestorage.app'
    });
}

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const audioModels = [
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent'
];

async function callGeminiAudio(audioBuffer, mimeType) {
    if (!GEMINI_KEY || !audioBuffer) return null;

    const audioB64 = audioBuffer.toString('base64');
    const prompt = `Sos un asistente de seguridad vial para taxistas de Rosario, Argentina.
Escuchá este audio de un grupo de WhatsApp y respondé SOLO con JSON válido (sin markdown).

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

    const cleanMimeType = (mimeType || 'audio/ogg').split(';')[0].trim();

    for (const url of audioModels) {
        try {
            console.log(`Sending to ${url}...`);
            const res = await axios.post(`${url}?key=${GEMINI_KEY}`, {
                contents: [{
                    parts: [
                        { inlineData: { mimeType: cleanMimeType, data: audioB64 } },
                        { text: prompt }
                    ]
                }]
            }, { timeout: 25000 });

            console.log('HTTP Status:', res.status);
            console.log('Response body:', JSON.stringify(res.data, null, 2));

            const rawText = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
            if (rawText) {
                try {
                    const clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                    const parsed = JSON.parse(clean);
                    return parsed;
                } catch (parseErr) {
                    console.warn('⚠️ No se pudo parsear JSON:', rawText);
                    return { error: 'parse_error', rawText };
                }
            }
        } catch (e) {
            console.warn(`⚠️ Failed on ${url}:`, e.response?.data?.error || e.message);
        }
    }
    return null;
}

async function run() {
    const fileName = 'audio/wsp_AC7C262A1E46D66B0A8BE208FEAF85C4.ogg';
    console.log('Downloading audio from Firebase Storage:', fileName);
    try {
        const bucket = admin.storage().bucket();
        const file = bucket.file(fileName);
        const [buffer] = await file.download();
        console.log(`Downloaded ${buffer.length} bytes.`);
        
        fs.writeFileSync(path.join(__dirname, 'temp_downloaded.ogg'), buffer);
        console.log('Saved temp_downloaded.ogg');

        const result = await callGeminiAudio(buffer, 'audio/ogg');
        console.log('Final Result:', result);
    } catch (err) {
        console.error('Error in download or test:', err.message);
    }
}

run();
