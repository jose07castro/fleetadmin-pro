/* =========================================================================
   FleetAdmin Pro — Servicio TTS (Conversión de Alertas de Texto a Audio MP3)
   Convierte reportes viales de texto en archivos de voz MP3 de alta fidelidad,
   asegurando que toda alerta tenga su audioUrl lista para reproducirse en vivo.
   ========================================================================= */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const audioDir = path.join(__dirname, '../audio');
if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
}

/**
 * Divide un texto en fragmentos menores a 160 caracteres en los límites de palabras.
 */
function splitTextIntoChunks(text, maxLength = 160) {
    if (!text || typeof text !== 'string') return [];
    const clean = text
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/[*_~`]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!clean) return [];
    if (clean.length <= maxLength) return [clean];

    const words = clean.split(' ');
    const chunks = [];
    let current = '';

    for (const word of words) {
        if ((current + ' ' + word).trim().length <= maxLength) {
            current = (current + ' ' + word).trim();
        } else {
            if (current) chunks.push(current);
            current = word;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

/**
 * Genera un Buffer de audio MP3 a partir de texto usando Google TTS.
 */
async function generateAudioBuffer(text) {
    const chunks = splitTextIntoChunks(text, 160);
    if (chunks.length === 0) return null;

    const buffers = [];
    for (const chunk of chunks) {
        try {
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=es-ES&client=tw-ob`;
            const res = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            if (res.data && res.data.length > 0) {
                buffers.push(Buffer.from(res.data));
            }
        } catch (err) {
            console.warn(`⚠️ [TTS-SERVICE] Error en fragmento TTS ("${chunk.substring(0, 30)}..."):`, err.message);
        }
    }

    if (buffers.length === 0) return null;
    return Buffer.concat(buffers);
}

/**
 * Genera el audio para una alerta de texto y lo guarda localmente y/o en Firebase Storage.
 * Retorna la URL del audio (/audio/... o https://storage...).
 */
async function generateAlertAudio(text, alertId) {
    if (!text || !alertId) return null;
    try {
        const audioBuffer = await generateAudioBuffer(text);
        if (!audioBuffer) return null;

        const safeId = alertId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `tts_${safeId}.mp3`;
        const localPath = path.join(audioDir, fileName);

        // Guardar siempre en disco local
        fs.writeFileSync(localPath, audioBuffer);
        let audioUrl = `/audio/${fileName}`;
        console.log(`🎙️ [TTS-SERVICE] Audio MP3 generado en disco: ${localPath} (${audioBuffer.length} bytes)`);

        // Intentar subir a Firebase Storage para persistencia permanente
        try {
            const admin = require('firebase-admin');
            if (admin.apps && admin.apps.length > 0) {
                const { getStorage, getDownloadURL } = require('firebase-admin/storage');
                const bucket = getStorage().bucket();
                const storageFile = bucket.file(`audio/${fileName}`);
                await storageFile.save(audioBuffer, {
                    metadata: {
                        contentType: 'audio/mpeg',
                        cacheControl: 'public, max-age=86400'
                    }
                });
                const publicUrl = await getDownloadURL(storageFile);
                if (publicUrl) {
                    audioUrl = publicUrl;
                    console.log(`☁️ [TTS-SERVICE] Audio subido a Firebase Storage: ${audioUrl}`);
                }
            }
        } catch (storageErr) {
            console.log(`ℹ️ [TTS-SERVICE] Firebase Storage omitido (${storageErr.message}), usando ruta local /audio/${fileName}`);
        }

        return audioUrl;
    } catch (e) {
        console.error('❌ [TTS-SERVICE] Error generando audio para alerta:', e.message);
        return null;
    }
}

module.exports = {
    splitTextIntoChunks,
    generateAudioBuffer,
    generateAlertAudio
};
