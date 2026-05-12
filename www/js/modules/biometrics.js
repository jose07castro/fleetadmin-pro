/* ============================================
   FleetAdmin Pro — Módulo Biometría de Voz (v120)
   Basado en Meyda.js (MFCC + Similitud de Coseno)
   Asegura que solo el chofer titular active la voz.
   ============================================ */

const Biometrics = (() => {
    let _audioCtx = null;
    let _userFingerprint = null;

    /**
     * Extrae el vector MFCC representativo de un buffer de audio.
     * @param {AudioBuffer} audioBuffer - Buffer capturado del mic.
     */
    function extractFingerprint(audioBuffer) {
        if (typeof Meyda === 'undefined') {
            console.error('❌ Meyda no está cargado');
            return null;
        }

        const rawData = audioBuffer.getChannelData(0);
        const bufferSize = 512;
        const mfccResults = [];

        // Dividir el audio en ventanas y extraer MFCC
        for (let i = 0; i < rawData.length; i += bufferSize) {
            const frame = rawData.slice(i, i + bufferSize);
            if (frame.length < bufferSize) continue;

            const features = Meyda.extract('mfcc', frame);
            if (features) mfccResults.push(features);
        }

        if (mfccResults.length === 0) return null;

        // Promediar los coeficientes para obtener un vector único (fingerprint)
        const numCoeffs = mfccResults[0].length;
        const averagedFingerprint = new Array(numCoeffs).fill(0);

        for (const frameResult of mfccResults) {
            for (let j = 0; j < numCoeffs; j++) {
                averagedFingerprint[j] += frameResult[j];
            }
        }

        return averagedFingerprint.map(val => val / mfccResults.length);
    }

    /**
     * Calcula la Similitud de Coseno entre dos vectores.
     * Resultado: 1.0 (idénticos) a -1.0 (opuestos).
     */
    function compare(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);

        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (normA * normB);
    }

    /**
     * Promedia múltiples muestras capturadas durante el enrolamiento.
     */
    function averageFingerprints(fingerprints) {
        if (!fingerprints || fingerprints.length === 0) return null;
        const numCoeffs = fingerprints[0].length;
        const result = new Array(numCoeffs).fill(0);

        for (const fp of fingerprints) {
            for (let i = 0; i < numCoeffs; i++) {
                result[i] += fp[i];
            }
        }

        return result.map(val => val / fingerprints.length);
    }

    /**
     * Verifica si una muestra de audio coincide con el perfil del usuario.
     */
    async function verifySpeaker(audioBuffer, baselineProfile) {
        if (!baselineProfile) return true; // Si no hay perfil, permitir (fallback)

        const liveFingerprint = extractFingerprint(audioBuffer);
        const score = compare(liveFingerprint, baselineProfile);
        
        console.log(`🎙️ Biometría: Score de similitud: ${score.toFixed(4)}`);
        
        // Threshold recomendado: 0.85
        return score >= 0.85;
    }

    return { 
        extractFingerprint, 
        compare, 
        averageFingerprints,
        verifySpeaker 
    };
})();
