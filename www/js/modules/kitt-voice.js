/* ============================================
   FleetAdmin Pro — Motor de Voz Nativo
   TTS directo del dispositivo (Android TTS / Web Speech)
   ============================================ */

const KittVoice = (() => {
    function speak(text) {
        if (!text) return Promise.resolve();
        try {
            let spoken = false;
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
                spoken = AndroidServices.speak(text);
            }
            if (!spoken && window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
                try { window.NativeServiceBridge.speak(text); spoken = true; } catch(e) {}
            }
            if (!spoken && typeof window !== 'undefined' && window.speechSynthesis) {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                window.speechSynthesis.cancel();
                const utter = new SpeechSynthesisUtterance(text);
                utter.lang = 'es-AR';
                utter.rate = 1.0;
                window.speechSynthesis.speak(utter);
            }
        } catch(e) {
            console.warn('Native speech error:', e);
        }
        return Promise.resolve();
    }

    return {
        speak,
        stop: () => {
            try {
                if (window.speechSynthesis) window.speechSynthesis.cancel();
            } catch(e) {}
        },
        setKittEnabled: () => {},
        isKittEnabled: () => false
    };
})();

// Soporte global
window.KittVoice = KittVoice;
