/* ============================================
   FleetAdmin Pro — Motor de Voz Nativo
   TTS directo del dispositivo (Android TTS / Web Speech)
   ============================================ */

const KittVoice = (() => {
    function speak(text) {
        if (!text) return Promise.resolve();
        try {
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.speak === 'function') {
                AndroidServices.speak(text);
            } else if (window.NativeServiceBridge && typeof window.NativeServiceBridge.speak === 'function') {
                try { window.NativeServiceBridge.speak(text); } catch(e) {}
            } else if (window.speechSynthesis) {
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
