// Módulo de Android anulado temporalmente para que la Web arranque sin errores:
// import { BackgroundMode } from '@anuradev/capacitor-background-mode';

async function activarEscudoAntigravity() {
    try {
        console.log("🛡 ESCUDO ANTIGRAVITY: En pausa para la versión Web.");
        
        /* --- TODO ESTE BLOQUE QUEDA APAGADO EN LA WEB ---
        // 1. Prendemos el escudo protector
        await BackgroundMode.enable();

        // 2. Configuramos la notificación pegajosa tipo Radarbot
        await BackgroundMode.setSettings({
            title: "FleetAdmin Pro",
            text: "Radar y S.O.S. escuchando en segundo plano",
            resume: true,
            hidden: false,
            bigText: true
        });

        // 3. Le pedimos a Android permiso para ignorar el ahorro de batería
        await BackgroundMode.requestDisableBatteryOptimizations();

        console.log("🛡 ESCUDO ANTIGRAVITY ACTIVO: La app ya no se va a dormir.");
        --------------------------------------------------- */
        
    } catch (error) {
        console.log("Error activando el escudo:", error);
    }
}

// Arrancamos el escudo apenas abre la app
activarEscudoAntigravity();