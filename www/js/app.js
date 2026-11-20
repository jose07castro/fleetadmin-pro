// ==========================================
// 🛡️ AJUSTE ANTIGRAVITY - MODO WEB & AUDIO UNLOCK
// ==========================================

// Variable global blindada para reanudación de sesión
window._lastResumeTime = window._lastResumeTime || 0;

/**
 * Desbloquea y reanuda el AudioContext global y el canal de síntesis de voz en Web (PC y Móvil).
 * Llamado al hacer clic en cualquier parte de la pantalla o en el botón 'Probar'.
 */
window.unlockGlobalAudio = function() {
    try {
        const AudioClass = window.AudioContext || window.webkitAudioContext;
        if (AudioClass) {
            if (!window._sharedAudioContext) {
                window._sharedAudioContext = new AudioClass();
            }
            if (window._sharedAudioContext.state === 'suspended') {
                window._sharedAudioContext.resume().then(() => {
                    console.log('🔊 [AUDIO] AudioContext global reanudado con éxito');
                }).catch(e => console.warn('🔊 [AUDIO] Error al resumir AudioContext:', e));
            }
        }

        // Reanudar SpeechSynthesis si el navegador lo suspendió
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            if (window.speechSynthesis.paused) {
                try { window.speechSynthesis.resume(); } catch (_) {}
            }
        }

        // Ocultar banner de desbloqueo si existía
        const banner = document.getElementById('audio-unlock-banner');
        if (banner) {
            banner.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            banner.style.opacity = '0';
            banner.style.transform = 'translate(-50%, 20px)';
            setTimeout(() => { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 300);
        }
    } catch (e) {
        console.warn('🔊 [AUDIO] Error en unlockGlobalAudio:', e);
    }
};

// Escuchar interacciones del usuario en cualquier parte de la pantalla para desbloqueo automático
if (typeof document !== 'undefined') {
    const _autoUnlockEvents = ['click', 'pointerdown', 'touchstart', 'keydown'];
    _autoUnlockEvents.forEach(evt => {
        document.addEventListener(evt, () => {
            window.unlockGlobalAudio();
        }, { capture: true, passive: true });
    });
}

/**
 * Muestra un banner flotante visible cuando 'Audio.play()' es rechazado por la política de autoplay
 * requiriendo una interacción simple del usuario para desbloquear el canal de sonido de alertas.
 */
window.showAudioUnlockBanner = function() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('audio-unlock-banner')) return; // Ya en pantalla

    const banner = document.createElement('div');
    banner.id = 'audio-unlock-banner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 999999;
        background: linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(30, 41, 59, 0.98) 100%);
        color: #f8fafc;
        border: 2px solid #38bdf8;
        border-radius: 16px;
        padding: 14px 22px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65), 0 0 25px rgba(56, 189, 248, 0.35);
        display: flex;
        align-items: center;
        gap: 16px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 0.92rem;
        max-width: calc(100vw - 32px);
        width: max-content;
        cursor: pointer;
        animation: audioBannerPop 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
    `;

    banner.innerHTML = `
        <div style="font-size: 1.8rem; animation: audioIconPulse 1.2s infinite ease-in-out;">🔊</div>
        <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-weight: 700; color: #38bdf8; font-size: 0.95rem;">Sonido silenciado por el navegador</span>
            <span style="font-size: 0.82rem; color: #cbd5e1;">Hacé clic aquí para activar las alertas de voz y pitidos de radares</span>
        </div>
        <button type="button" style="
            background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
            color: #ffffff;
            border: none;
            border-radius: 10px;
            padding: 8px 16px;
            font-size: 0.86rem;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
            white-space: nowrap;
        ">Activar Sonido</button>
    `;

    if (!document.getElementById('audio-unlock-style')) {
        const style = document.createElement('style');
        style.id = 'audio-unlock-style';
        style.textContent = `
            @keyframes audioBannerPop {
                from { opacity: 0; transform: translate(-50%, 25px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
            @keyframes audioIconPulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.18); }
            }
        `;
        document.head.appendChild(style);
    }

    const activate = (e) => {
        if (e) e.stopPropagation();
        window.unlockGlobalAudio();
        // Feedback sonoro suave de confirmación
        try {
            if (window._sharedAudioContext && window._sharedAudioContext.state === 'running') {
                const now = window._sharedAudioContext.currentTime;
                const osc = window._sharedAudioContext.createOscillator();
                const gain = window._sharedAudioContext.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(659.25, now);
                osc.frequency.setValueAtTime(880.00, now + 0.1);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.connect(gain);
                gain.connect(window._sharedAudioContext.destination);
                osc.start(now);
                osc.stop(now + 0.3);
            }
        } catch (_) {}
    };

    banner.addEventListener('click', activate);
    document.body.appendChild(banner);
};

window.playAudioWithBoost = function(audioElement, multiplier = 3.0) {
    // Detectar si estamos en entorno nativo / móvil
    const isNative = window.location.hostname === 'localhost' || 
                     window.location.hostname === '127.0.0.1' ||
                     window.location.protocol === 'file:' ||
                     window.Capacitor || 
                     (window.location.origin && window.location.origin.includes('localhost'));

    // Si es nativo y el origen del audio es externo, evitar Web Audio API
    // para prevenir bloqueos de CORS silenciosos que dejan el audio mudo.
    const audioSrc = audioElement.src || '';
    const isCrossOrigin = audioSrc.startsWith('http') && !audioSrc.includes(window.location.host);

    // Evitar boost en audios cross-origin (ej. Firebase Storage) tanto en web como nativo para prevenir errores o silenciamiento por falta de CORS en GET
    if (isCrossOrigin) {
        console.log('🎵 [AUDIO-BOOST] Detectado audio cross-origin (' + audioSrc.substring(0, 45) + '...). Reproduciendo directo sin boost.');
        audioElement.volume = 1.0;
        const p = audioElement.play();
        if (p !== undefined) {
            p.catch(err => {
                if (err && (err.name === 'NotAllowedError' || err.name === 'NotSupportedError')) {
                    if (typeof window.showAudioUnlockBanner === 'function') {
                        window.showAudioUnlockBanner();
                    }
                }
            });
        }
        return p;
    }

    if (!window.AudioContext && !window.webkitAudioContext) {
        const p = audioElement.play();
        if (p !== undefined) {
            p.catch(err => {
                if (err && (err.name === 'NotAllowedError' || err.name === 'NotSupportedError')) {
                    window.showAudioUnlockBanner();
                }
            });
        }
        return p;
    }
    try {
        if (!window._sharedAudioContext) {
            window._sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = window._sharedAudioContext;
        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
        
        // Evitar doble conexión si se recicla el elemento
        if (!audioElement._isBoosted) {
            audioElement.crossOrigin = 'anonymous'; 
            const source = ctx.createMediaElementSource(audioElement);
            const gainNode = ctx.createGain();
            gainNode.gain.value = multiplier; // 300% de volumen original
            source.connect(gainNode);
            gainNode.connect(ctx.destination);
            audioElement._isBoosted = true;
        }
        const p = audioElement.play();
        if (p !== undefined) {
            p.catch(err => {
                console.warn('🎵 [AUDIO-BOOST] Autoplay bloqueado por el navegador:', err);
                if (err && (err.name === 'NotAllowedError' || err.name === 'NotSupportedError')) {
                    window.showAudioUnlockBanner();
                }
            });
        }
        return p;
    } catch(e) {
        console.warn('Audio boost falló, usando volumen normal', e);
        const p = audioElement.play();
        if (p !== undefined) {
            p.catch(err => {
                if (err && (err.name === 'NotAllowedError' || err.name === 'NotSupportedError')) {
                    window.showAudioUnlockBanner();
                }
            });
        }
        return p;
    }
};
// import { BackgroundMode } from '@anuradev/capacitor-background-mode';

// Interceptor global de fetch para móviles (redirige rutas relativas a la URL de producción)
if (window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' || 
    window.location.protocol === 'file:') {
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        if (typeof input === 'string' && input.startsWith('/api/')) {
            input = 'https://fleetadmin-web-nueva.onrender.com' + input;
        }
        return originalFetch(input, init);
    };
}

/* ============================================
   FleetAdmin Pro — Archivo Principal
   Inicialización de la aplicación PWA
   con sincronización Firebase en tiempo real
   ============================================ */

const App = (() => {
    const LOCAL_APP_VERSION = '1.2.247';
    window.APP_VERSION = LOCAL_APP_VERSION;

    let _lastResumeTime = 0; // Top-level App IIFE

    // Listener refs para limpieza
    let realtimeListenersActive = false;
    let _shiftHeartbeatInterval = null;
    let _lastShiftLockModalTs = 0;
    let _popstateGuardRegistered = false;

    // Force Update (Control de Versión Remoto en Tiempo Real)
    let _versionControlListenerActive = false;
    let _latestVersionControlData = null;
    let _pendingUpdateWatcher = null;
    let _forcedUpdateActive = false;
    let _lastUpdateSoundKey = '';
    let _forcedUpdateTargetUrl = 'https://play.google.com/store/apps/details?id=com.fleetadminpro.app';
    let _forcedUpdateMinVersion = LOCAL_APP_VERSION;
    let _forcedUpdateIsPreview = false;
    let _forcedUpdateGuardsInstalled = false;

    // ============================================================
    // BLOQUEO DE SALIDA Y HEARTBEAT DE TURNO ACTIVO ('IN_PROGRESS')
    // ============================================================
    function isDriverShiftLocked() {
        try {
            if (typeof Auth === 'undefined' || !Auth.isLoggedIn()) return false;
            const canDrive = Auth.isDriver() || (typeof Auth.hasDriverCapability === 'function' && Auth.hasDriverCapability());
            if (!canDrive) return false;
            return localStorage.getItem('active_shift_state') === 'true' || Boolean(localStorage.getItem('active_shift_id'));
        } catch (e) {
            return false;
        }
    }

    function showShiftExitBlockedModal() {
        const now = Date.now();
        if (now - _lastShiftLockModalTs < 600) return;
        _lastShiftLockModalTs = now;

        if (typeof Components === 'undefined' || typeof Components.showModal !== 'function') {
            alert('Turno activo en curso: Debes finalizar el turno formalmente para salir');
            return;
        }

        const bodyHTML = `
            <div data-shift-lock="true" style="text-align:center; padding:12px 6px;">
                <div style="font-size:3.2rem; margin-bottom:12px;">🔒</div>
                <div style="font-size:1.08rem; font-weight:800; color:#f87171; line-height:1.45; margin-bottom:12px;">
                    Turno activo en curso: Debes finalizar el turno formalmente para salir
                </div>
                <p style="font-size:0.88rem; color:var(--text-secondary); line-height:1.5; margin:0;">
                    Mientras tengas un turno iniciado, el cierre de sesión y el retroceso de salida están deshabilitados. Podés minimizar con Inicio (Home) o cambiar normalmente a Uber, DiDi o Maps.
                </p>
            </div>
        `;
        const footerHTML = `
            <div style="display:flex; gap:10px; width:100%;">
                <button class="btn btn-secondary" style="flex:1;" onclick="Components.closeModal()">Entendido</button>
                <button class="btn btn-danger" style="flex:1; font-weight:700;" onclick="Components.closeModal(); if (typeof Router !== 'undefined' && Router.getCurrentRoute() !== 'shifts') { Router.navigate('shifts'); }">
                    ⏹️ Ir a Turnos
                </button>
            </div>
        `;
        Components.showModal('🔒 Turno Activo en Curso', bodyHTML, footerHTML);
    }

    function armShiftBackLock() {
        _registerShiftNavigationGuards();
        if (!isDriverShiftLocked()) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        try {
            if (!window.history.state || !window.history.state.fleetShiftLock) {
                window.history.pushState({ fleetShiftLock: true }, '', window.location.href);
            }
        } catch (e) {
            console.warn('⚠️ No se pudo armar history state de turno activo:', e);
        }
    }

    function _registerShiftNavigationGuards() {
        if (_popstateGuardRegistered || typeof window === 'undefined') return;
        _popstateGuardRegistered = true;

        window.showActiveShiftExitLockModal = showShiftExitBlockedModal;
        window.isDriverShiftLocked = isDriverShiftLocked;

        // Interceptar popstate ÚNICAMENTE mientras FleetAdmin esté en primer plano
        window.addEventListener('popstate', () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            if (!isDriverShiftLocked()) return;

            try {
                window.history.pushState({ fleetShiftLock: true }, '', window.location.href);
            } catch (_) {}
            showShiftExitBlockedModal();
        });

        // Protección adicional en navegador Web contra cierre accidental de pestaña durante turno activo
        window.addEventListener('beforeunload', (e) => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            if (typeof AndroidServices !== 'undefined' && AndroidServices.isNativeAndroid()) return;
            if (!isDriverShiftLocked()) return;
            e.preventDefault();
            e.returnValue = 'Turno activo en curso: Debes finalizar el turno formalmente para salir';
            return e.returnValue;
        });
    }

    async function sendShiftHeartbeat() {
        if (!isDriverShiftLocked()) {
            stopShiftHeartbeat();
            return;
        }
        if (typeof firebaseDB === 'undefined' || typeof Auth === 'undefined') return;

        const userId = Auth.getUserId();
        if (!userId) return;

        const now = Date.now();
        let batteryLevel = null;
        if (typeof navigator !== 'undefined' && navigator.getBattery) {
            try {
                const b = await navigator.getBattery();
                batteryLevel = Math.round(b.level * 100);
            } catch (_) {}
        }

        let appVersion = 'v' + LOCAL_APP_VERSION;
        try {
            if (typeof window.NativeServiceBridge !== 'undefined' && window.NativeServiceBridge.getAppVersionName) {
                appVersion = 'v' + window.NativeServiceBridge.getAppVersionName();
            }
        } catch (_) {}

        const hbPayload = {
            last_heartbeat: now,
            updated_at: new Date(now).toISOString(),
            status: 'active',
            shift_status: 'IN_PROGRESS',
            last_heartbeat_gap: null,
            driverName: Auth.getUserName() || 'Chofer',
            appVersion: appVersion
        };

        const fleetId = Auth.getFleetId();
        const shiftId = localStorage.getItem('active_shift_id');
        if (fleetId) hbPayload.fleetId = fleetId;
        if (shiftId) hbPayload.shiftId = shiftId;
        if (batteryLevel !== null) hbPayload.battery = batteryLevel;

        // En Web/PWA o en Android cuando el servicio nativo lleve >15s sin reportar GPS, adjuntar coordenadas frescas
        const isNative = typeof AndroidServices !== 'undefined' && AndroidServices.isNativeAndroid();
        const isNativeGpsAlive = typeof AndroidServices !== 'undefined' && typeof AndroidServices.isNativeGPSAlive === 'function' && AndroidServices.isNativeGPSAlive();
        if (!isNative || !isNativeGpsAlive) {
            let cachedPos = window._cachedGpsPosition;
            let fixAge = cachedPos ? (now - (cachedPos.time || 0)) : Infinity;

            // Si no hay fix reciente (< 20s), solicitar uno fresco de alta precisión antes de enviar el latido
            if ((!cachedPos || !cachedPos.lat || !cachedPos.lng || fixAge >= 20000) && typeof navigator !== 'undefined' && navigator.geolocation) {
                try {
                    const freshCoords = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(
                            (p) => resolve(p.coords),
                            (err) => reject(err),
                            { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
                        );
                    });
                    if (freshCoords && freshCoords.latitude && freshCoords.longitude) {
                        const spdKmh = (typeof freshCoords.speed === 'number' && !isNaN(freshCoords.speed) && freshCoords.speed >= 0)
                            ? Math.round(freshCoords.speed * 3.6)
                            : 0;
                        window._cachedGpsPosition = {
                            lat: freshCoords.latitude,
                            lng: freshCoords.longitude,
                            speed: spdKmh,
                            heading: (typeof freshCoords.heading === 'number' && !isNaN(freshCoords.heading)) ? freshCoords.heading : 0,
                            accuracy: freshCoords.accuracy,
                            time: Date.now()
                        };
                        cachedPos = window._cachedGpsPosition;
                        fixAge = 0;
                    }
                } catch (_geoErr) {}
            }

            if (cachedPos && cachedPos.lat && cachedPos.lng && fixAge < 120000) {
                hbPayload.lat = cachedPos.lat;
                hbPayload.lng = cachedPos.lng;
                hbPayload.lat_raw = cachedPos.lat;
                hbPayload.lng_raw = cachedPos.lng;
                hbPayload.speed = Math.round(Number(cachedPos.speed) || 0);
                hbPayload.heading = (typeof cachedPos.heading === 'number' && !isNaN(cachedPos.heading)) ? cachedPos.heading : 0;
                hbPayload.gps_status = 'active';
                hbPayload._source = 'shift_heartbeat_gps';
            }
        }

        try {
            await firebaseDB.ref(`driver_positions/${userId}`).update(hbPayload);
            console.log('💓 [HEARTBEAT-60S] Latido de turno IN_PROGRESS enviado a Firebase');
        } catch (e) {
            console.warn('⚠️ [HEARTBEAT-60S] Error enviando latido a Firebase:', e.message);
        }
    }

    function startShiftHeartbeat() {
        _registerShiftNavigationGuards();
        if (_shiftHeartbeatInterval) {
            clearInterval(_shiftHeartbeatInterval);
            _shiftHeartbeatInterval = null;
        }
        sendShiftHeartbeat();
        _shiftHeartbeatInterval = setInterval(sendShiftHeartbeat, 60000);
    }

    function stopShiftHeartbeat() {
        if (_shiftHeartbeatInterval) {
            clearInterval(_shiftHeartbeatInterval);
            _shiftHeartbeatInterval = null;
        }
    }

    // Auto-despertar servidor (Keep-Alive) para evitar que Render duerma el servicio
    
    // 25s keepalive loop for Firebase background stability
    setInterval(() => {
        try {
            if (typeof firebase !== 'undefined' && firebase.database) {
                firebase.database().goOnline();
            }
        } catch (_) {}
    }, 25000);

    function startWebHeartbeat() {
        const heartbeat = () => {
            fetch('/api/bot/status')
                .then(r => console.log('🏓 Keep-alive ping enviado'))
                .catch(e => console.warn('⚠️ Falló keep-alive:', e));
        };
        heartbeat(); // Ejecutar inmediatamente al cargar
        setInterval(heartbeat, 5 * 60 * 1000); // cada 5 minutos
    }

    let _remoteRestartSubscribedKeys = new Set();
    let _remoteRestartBootTs = Date.now();
    function _initRemoteRestartListener() {
        if (typeof firebaseDB === 'undefined' || typeof Auth === 'undefined') return;
        const currentUser = (typeof Auth.getUser === 'function') ? Auth.getUser() : null;
        const myId = (typeof Auth.getUserId === 'function') ? Auth.getUserId() : null;
        const isOwnerUser = (typeof Auth.isOwner === 'function') && Auth.isOwner();
        const myIds = Array.from(new Set([myId, currentUser?.id, currentUser?.globalId].filter(Boolean).map(String)));
        if (myIds.length === 0) return; // No escuchar si aún no hay sesión identificada

        const handleRestartSnapshot = async (snap) => {
            const cmd = snap.val();
            if (!cmd || !cmd.timestamp) return;
            const cmdTs = Number(cmd.timestamp);
            const lastHandled = parseInt(localStorage.getItem('last_remote_restart_ts') || '0', 10);
            if (cmdTs <= _remoteRestartBootTs || cmdTs <= lastHandled) return;

            const rawTarget = cmd.targetDriverId ? String(cmd.targetDriverId).trim() : '';
            if (!rawTarget) return;
            if (rawTarget === 'all' && isOwnerUser) return; // Nunca reiniciar al Administrador por comando grupal
            if (rawTarget !== 'all') {
                const myIdSet = new Set(myIds);
                const cmdTargets = [cmd.targetDriverId, cmd.targetFleetUserId].filter(Boolean).map(String);
                const myName = ((currentUser?.name || (typeof Auth.getUserName === 'function' ? Auth.getUserName() : '')) || '').trim().toLowerCase();
                const targetName = (cmd.targetDriverName || '').trim().toLowerCase();
                const idMatched = cmdTargets.some(tid => myIdSet.has(tid));
                const nameMatched = Boolean(myName && targetName && myName === targetName);
                if (!idMatched && !nameMatched) return;
            }

            try { localStorage.setItem('last_remote_restart_ts', String(cmdTs)); } catch (_) {}
            console.log('🔄 [REMOTE-RESTART] Comando remoto dirigido a este usuario. Reiniciando GPS y recargando app...');

            try {
                if (typeof syncActiveShiftGPS === 'function') {
                    await syncActiveShiftGPS();
                }
            } catch (_) {}

            try {
                if (window.NativeServiceBridge && typeof window.NativeServiceBridge.restartGpsEngine === 'function') {
                    window.NativeServiceBridge.restartGpsEngine();
                }
            } catch (_) {}

            try {
                if ('caches' in window) {
                    const names = await caches.keys();
                    await Promise.all(names.map(n => caches.delete(n)));
                }
            } catch (_) {}

            if (typeof Components !== 'undefined' && typeof Components.showToast === 'function') {
                Components.showToast('🔄 Actualizando sistema por orden del Administrador...', 'info');
            }
            setTimeout(() => {
                window.location.reload(true);
            }, 400);
        };

        try {
            const keysToListen = [...myIds];
            if (!isOwnerUser) {
                keysToListen.push('all');
            }
            keysToListen.forEach((key) => {
                if (_remoteRestartSubscribedKeys.has(key)) return;
                _remoteRestartSubscribedKeys.add(key);
                firebaseDB.ref(`system_commands/restart_by_user/${key}`).on('value', handleRestartSnapshot);
            });
        } catch (e) {
            console.warn('⚠️ [REMOTE-RESTART] Error instalando listener aislado:', e);
        }
    }

    // Inicializar la aplicación
    async function init() {
        try {
            _registerShiftNavigationGuards();

            // 0. Verificar versión de la app (In-App forced update check)
            const versionOk = await checkAppVersion();
            if (!versionOk) return; // Detener inicio de la app

            // 0. Iniciar keep-alive del bot (Modo Web)
            startWebHeartbeat();

            // 0.5. Configurar Pull-To-Refresh visual (v122)
            setupPullToRefresh();

            // 1. Inicializar sistema de idiomas
            I18n.init();

            // 1.5. Inicializar panel de personalización UI (v110)
            if (typeof UISettings !== 'undefined') {
                UISettings.init();
            }

            // 2. Conectar a Firebase (con timeout defensivo)
            try {
                const splashStatus = document.getElementById('splashStatus');
                if (splashStatus) splashStatus.innerText = 'Conectando con la base de datos...';
                await DB.open();
                // 2.5 Activar detección de alertas de tráfico (WhatsApp) de forma global e incondicional
                if (typeof TrafficAlerts !== 'undefined') {
                    TrafficAlerts.init();
                }
                // 2.6 Activar receptor de reinicio/actualización remota de apps y Force Update en tiempo real
                _initRemoteRestartListener();
                _initVersionControlListener();
            } catch (dbErr) {
                console.warn('⚠️ Firebase open() falló, continuando:', dbErr);
            }

            // 3. Seed (no-op en multi-tenencia, migración en login)
            try {
                await DB.seed();
            } catch (seedErr) {
                console.warn('⚠️ DB seed() falló, continuando:', seedErr);
            }

            // 3.5. Activar manejo de reconexión (móvil)
            setupReconnectionHandler();

            // 3.8. Sincronizar nombre registrado con el servicio de fondo Android
            try {
                if (typeof UserOnboarding !== 'undefined') {
                    const p = UserOnboarding.getProfile();
                    if (p && p.name && typeof AndroidServices !== 'undefined' && typeof AndroidServices.setDriverName === 'function') {
                        AndroidServices.setDriverName(p.name);
                    }
                }
            } catch (e) {}

            // 4. Navegar a la ruta correcta
            // USAR isLoggedInAsync() para recuperar sesión desde IndexedDB si Android mató el proceso
            setTimeout(async () => {
                try {
                    const splashStatus = document.getElementById('splashStatus');
                    if (splashStatus) splashStatus.innerText = 'Verificando seguridad...';
                    
                    const loggedIn = await Auth.isLoggedInAsync();
                    if (loggedIn) {
                        console.log('🔐 Sesión activa confirmada (incluyendo recovery IndexedDB)');
                        if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setUserRole === 'function') {
                            AndroidServices.setUserRole(Auth.getRole());
                        }
                        
                        // 4.5 Cargar tema del usuario y sincronizar capacidades duales
                        const currentUserId = Auth.getUserId();
                        if (currentUserId) {
                            await applyUserTheme(currentUserId);
                        }
                        if (typeof Auth.syncUserCapabilitiesFromFleet === 'function') {
                            Auth.syncUserCapabilitiesFromFleet().catch(() => {});
                        }
                        _initRemoteRestartListener();

                        // Reportar versión al servidor al recuperar sesión
                        reportAppVersionToServer();

                        // Registrar/actualizar estado de instalación en Firebase
                        const currentUser = Auth.getUser();
                        if (currentUserId && currentUser) {
                            trackAppInstallation(currentUserId, currentUser);
                        }

                        // Bloqueo de perfil incompleto al restaurar sesión (no bloquear al admin/dual-role)
                        if (Auth.isDriver() && !(typeof Auth.hasAdminCapability === 'function' && Auth.hasAdminCapability())) {
                            try {
                                const profileOk = await Auth.isProfileComplete();
                                if (!profileOk) {
                                    _hideSplash();
                                    Router.navigate('complete-profile');
                                    startRealtimeSync();
                                    return;
                                }
                            } catch (profileErr) {
                                // Error de red verificando perfil — NO bloquear, dejar pasar
                                console.warn('📱 Error verificando perfil (red), continuando:', profileErr);
                            }
                        }
                        
                        // Sincronizar turno activo/GPS al iniciar la app (incluye Admin con esChofer: true)
                        if (Auth.isDriver() || (typeof Auth.hasDriverCapability === 'function' && Auth.hasDriverCapability())) {
                            await syncActiveShiftGPS();
                        } else {
                            if (typeof AndroidServices !== 'undefined') {
                                try {
                                    AndroidServices.enableForegroundService(null, 'Modo Administrador (Alertas activas)');
                                } catch (e) {
                                    console.warn('Error enabling foreground service para admin:', e);
                                }
                            }
                        }
                        
                        _hideSplash();
                        Router.navigate(Router.getDefaultRoute());
                        // 6. Activar sincronización en tiempo real
                        startRealtimeSync();
                        // 7. Iniciar checker de notificaciones locales
                        if (typeof Notifications !== 'undefined') {
                            Notifications.init();
                        }
                        // 8. Activar listener SOS para TODOS (dueños y conductores)
                        if (typeof SOSModule !== 'undefined') {
                            SOSModule.startListening();
                        }
                        // 8.6 Activar copiloto de radares y tránsito para TODOS (dueños y choferes)
                        if (typeof GPSPermissions !== 'undefined') {
                            try { GPSPermissions.initCopilotForAll(); } catch(e) { console.warn('Copilot init error:', e); }
                            // Pedir permiso GPS al dueño también si todavía no lo otorgó
                            GPSPermissions.checkPermission().then(state => {
                                if (state === 'granted') {
                                    GPSPermissions.initCopilotForAll();
                                } else if (state !== 'denied') {
                                    // Pedir permiso con explicación amigable
                                    setTimeout(() => GPSPermissions.requestWithDialog(), 3000);
                                }
                            });
                        }
                        // 8.7 Activar comandos de voz (Manos Libres)
                        if (typeof VoiceModule !== 'undefined') {
                            VoiceModule.init();
                        }
                        // 9. Mostrar banner PWA de instalación (solo drivers móviles)
                        if (typeof PWAInstall !== 'undefined') {
                            setTimeout(() => PWAInstall.showBanner(), 2000);
                        }
                    } else {
                        if (typeof AndroidServices !== 'undefined') {
                            try {
                                AndroidServices.disableForegroundService();
                            } catch (e) {
                                console.warn('Error disabling foreground service:', e);
                            }
                        }
                        _hideSplash();
                        Router.navigate('login');
                        if (typeof UserOnboarding !== 'undefined' && !UserOnboarding.isProfileComplete()) {
                            setTimeout(() => UserOnboarding.showModal(), 800);
                        }
                    }
                } catch (navError) {
                    console.error('🔴 Error en navegación post-init:', navError);
                    _hideSplash();
                    _showConnectionError(navError);
                }
            }, 800);

        } catch (error) {
            console.error('Error al inicializar la aplicación:', error);
            _hideSplash();
            _showConnectionError(error);
        }
    }

    // --- Helper: ocultar splash screen ---
    function _hideSplash() {
        const splash = document.getElementById('splash-screen');
        if (splash) splash.classList.add('hidden');
    }

    // --- Helper: mostrar pantalla de error de conexión (NUNCA dejar blanco) ---
    function _showConnectionError(error) {
        document.getElementById('app').innerHTML = `
            <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; background:rgba(15,23,42,0.95);">
                <div style="text-align:center; padding:2rem; max-width:400px;">
                    <div style="font-size:3rem; margin-bottom:1rem;">📡</div>
                    <h2 style="color:#f1f5f9; margin-bottom:0.5rem;">Conectando...</h2>
                    <p style="color:#94a3b8; margin-bottom:0.5rem; font-size:0.9rem;">
                        Error al conectar con el servidor. Verificá tu conexión a internet.
                    </p>
                    <p style="color:#64748b; margin-bottom:1.5rem; font-size:0.75rem;">
                        ${error?.message || 'Error desconocido'}
                    </p>
                    <button onclick="location.reload()" style="background:linear-gradient(135deg,#6366f1,#06b6d4); color:white; border:none; padding:12px 32px; border-radius:12px; font-size:1rem; font-weight:600; cursor:pointer;">
                        🔄 Reintentar
                    </button>
                </div>
            </div>`;
    }

    // --- Sincronización en tiempo real ---
    let syncRefreshTimer = null;

    function _isUserEditingForm() {
        const ae = document.activeElement;
        if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return true;

        // Modal genérico abierto (carga de reparación, correas, neumáticos, aceite modal, editar turno, comprobante emitido, etc.)
        if (document.getElementById('activeModal') || document.querySelector('.modal-overlay.active, #modalOverlay.active')) {
            return true;
        }

        // Formulario de turno, facturación ARCA o mantenimiento con datos cargados sin guardar
        const draftInputIds = [
            'shiftOdometerStart', 'shiftOdometerEnd', 'shiftEarnings', 'editShiftEarnings',
            'invReceptorCuit', 'invReceptorRazonSocial', 'invRecorrido', 'invImporteTotal',
            'oilOdometer', 'oilType', 'oilNextChangeKm',
            'repairOdometer', 'repairLaborCost', 'repairDescription', 'repairPartsCost',
            'beltOdometer', 'tireOdometer'
        ];
        for (const id of draftInputIds) {
            const el = document.getElementById(id);
            if (el && el.value && String(el.value).trim() !== '') return true;
        }

        // Fotos capturadas en inicio o cierre de turno
        if (typeof Components !== 'undefined' && typeof Components.getPhotoData === 'function') {
            if (Components.getPhotoData('shiftOdoStart') || Components.getPhotoData('shiftOdoEnd') || Components.getPhotoData('shiftEarningsPhoto')) {
                return true;
            }
        }

        return false;
    }

    function _isActiveOperationInProgress() {
        return _isUserEditingForm();
    }

    function startRealtimeSync() {
        if (realtimeListenersActive) return;
        realtimeListenersActive = true;

        const isDriverRole = typeof Auth !== 'undefined' && Auth.isDriver() && !(typeof Auth.hasAdminCapability === 'function' && Auth.hasAdminCapability());
        const stores = isDriverRole
            ? ['vehicles', 'shifts']
            : ['users', 'vehicles', 'shifts', 'oilLogs', 'repairs', 'beltChanges'];
        let initialLoad = {};
        let lastShiftsWithoutPulse = null;

        stores.forEach(store => {
            initialLoad[store] = true;
            DB.onChanges(store, (items) => {
                // Ignorar la primera carga (ya se renderizó)
                if (initialLoad[store]) {
                    initialLoad[store] = false;
                    if (store === 'shifts' && Array.isArray(items)) {
                        try {
                            lastShiftsWithoutPulse = JSON.stringify(items.map(s => { const c = { ...s }; delete c.remoteRefreshTs; return c; }));
                        } catch (_) {}
                    }
                    return;
                }

                // Ignorar cambios que únicamente modificaron remoteRefreshTs en turnos (evita refrescar la UI del Administrador)
                if (store === 'shifts' && !isDriverRole && Array.isArray(items)) {
                    try {
                        const strippedNow = JSON.stringify(items.map(s => { const c = { ...s }; delete c.remoteRefreshTs; return c; }));
                        if (lastShiftsWithoutPulse !== null && strippedNow === lastShiftsWithoutPulse) {
                            return;
                        }
                        lastShiftsWithoutPulse = strippedNow;
                    } catch (_) {}
                }

                console.log(`🔄 Sync: ${store} actualizado (${items.length} items)`);

                // Sincronizar turno activo/GPS si cambian los turnos
                if (store === 'shifts' && typeof Auth !== 'undefined' && (Auth.isDriver() || (typeof Auth.hasDriverCapability === 'function' && Auth.hasDriverCapability()))) {
                    syncActiveShiftGPS();
                }

                // Refrescar la vista actual con debounce y sin destruir mapa GPS ni formularios activos
                const currentRoute = Router.getCurrentRoute();
                if (!currentRoute || currentRoute === 'login' || currentRoute === 'gps') {
                    return;
                }
                if (isDriverRole && store !== 'shifts' && currentRoute === 'shifts') {
                    return;
                }
                if (_isUserEditingForm()) {
                    return;
                }

                if (syncRefreshTimer) clearTimeout(syncRefreshTimer);
                syncRefreshTimer = setTimeout(() => {
                    syncRefreshTimer = null;
                    const routeNow = Router.getCurrentRoute();
                    if (!routeNow || routeNow === 'login' || routeNow === 'gps' || _isUserEditingForm()) {
                        return;
                    }
                    Router.navigate(routeNow);
                }, 800);
            });
        });

        // ☠️ v107: migrateShiftPhotos() EXTIRPADA del código
        // La función fue eliminada permanentemente de DB.

        console.log('📡 Sincronización en tiempo real activada');
    }

    // --- Detener sincronización ---
    function stopRealtimeSync() {
        if (syncRefreshTimer) {
            clearTimeout(syncRefreshTimer);
            syncRefreshTimer = null;
        }
        if (!realtimeListenersActive) return;

        const stores = ['users', 'vehicles', 'shifts', 'oilLogs', 'repairs', 'beltChanges'];
        stores.forEach(store => {
            DB.offChanges(store);
        });

        realtimeListenersActive = false;
        console.log('📡 Sincronización en tiempo real desactivada');
    }

    // Cerrar sesión (completo: limpia listeners, Firebase Auth, storage)
    async function logout() {
        // BLOQUEO ESTRICTO: Un chofer con turno activo ('IN_PROGRESS') no puede cerrar sesión ni salir
        if (isDriverShiftLocked()) {
            showShiftExitBlockedModal();
            return;
        }

        // Confirmación para evitar toques accidentales
        const confirmed = confirm('¿Cerrar sesión?\nSe desconectará de esta cuenta.');
        if (!confirmed) return;

        stopShiftHeartbeat();

        // Si es chofer, registramos la desconexión voluntaria en el servidor ANTES de limpiar nada
        if (typeof Auth !== 'undefined' && Auth.isDriver()) {
            let toastId = null;
            if (typeof Components !== 'undefined' && typeof Components.showToast === 'function') {
                toastId = Components.showToast('Registrando desconexión en el servidor...', 'info');
            }

            const driverId = Auth.getUserId();
            const fleetId = Auth.getFleetId();
            const baseUrl = (window.location.hostname === 'localhost' || 
                             window.location.hostname === '127.0.0.1' ||
                             window.location.protocol === 'file:') 
                             ? 'https://fleetadmin-web-nueva.onrender.com' 
                             : window.location.origin;

            try {
                const response = await fetch(`${baseUrl}/api/auth/logout-voluntario`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        driver_id: driverId,
                        fleetId: fleetId,
                        timestamp: Date.now(),
                        driverName: Auth.getUserName()
                    })
                });

                if (!response.ok) {
                    throw new Error('El servidor retornó código de error: ' + response.status);
                }
                console.log('✅ Desconexión voluntaria confirmada por el servidor');
            } catch (e) {
                // Error no crítico: el logout local igual procede
                console.warn('⚠️ No se pudo registrar desconexión en el servidor (el logout local continuará):', e.message);
            }
        }

        try {
            // Detener el Foreground Service de rastreo GPS en Android
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.disableForegroundService === 'function') {
                try {
                    await AndroidServices.disableForegroundService();
                } catch (e) {
                    console.warn('Error desactivando foreground service:', e);
                }
            }
            // 1. Detener sincronización en tiempo real (Firebase listeners)
            stopRealtimeSync();

            // 2. Detener SOS listener si está activo
            if (typeof SOSModule !== 'undefined' && typeof SOSModule.stopListening === 'function') {
                try { SOSModule.stopListening(); } catch (e) { /* ignorar */ }
            }

            // 3. Detener notifications checker si está activo
            if (typeof Notifications !== 'undefined' && typeof Notifications.stop === 'function') {
                try { Notifications.stop(); } catch (e) { /* ignorar */ }
            }

            // 4. Cerrar sesión en Firebase Auth
            try {
                await firebase.auth().signOut();
                console.log('🔒 Firebase Auth: sesión cerrada');
            } catch (e) {
                console.warn('Firebase Auth signOut error (no crítico):', e);
            }

            // 5. Desconectar Firebase Realtime Database — v167: No apagar para seguir recibiendo alertas de tráfico
            // try {
            //     firebase.database().goOffline();
            // } catch (e) { /* ignorar */ }

            // 6. Limpiar estado de Auth (localStorage, sessionStorage, currentUser)
            Auth.logout();
            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setUserRole === 'function') {
                AndroidServices.setUserRole('guest');
            }

            // 6.5 Restablecer listener global de voz al default (jose07) — v167: forzar re-suscripción
            if (typeof TrafficAlerts !== 'undefined') {
                TrafficAlerts.startGlobalVoiceListener(true);
            }

            // 7. Redirigir forzosamente a login
            Router.navigate('login');

            console.log('🚪 Sesión cerrada correctamente');
        } catch (error) {
            console.error('Error durante logout:', error);
            // Forzar limpieza y navegación aunque haya error
            Auth.logout();
            if (typeof TrafficAlerts !== 'undefined') {
                TrafficAlerts.startGlobalVoiceListener(true);
            }
            Router.navigate('login');
        }
    }

    // Cambiar idioma y refrescar la vista actual
    function setLanguage(lang) {
        I18n.setLanguage(lang);
        Router.navigate(Router.getCurrentRoute() || 'login');
    }

    // Cambiar unidad de distancia y refrescar
    function setDistanceUnit(unit) {
        Units.setDistanceUnit(unit);
        Router.navigate(Router.getCurrentRoute());
    }

    // Cambiar unidad de volumen y refrescar
    function setVolumeUnit(unit) {
        Units.setVolumeUnit(unit);
        Router.navigate(Router.getCurrentRoute());
    }

    // Toggle sidebar en móvil
    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar) {
            sidebar.classList.toggle('open');
            if (overlay) overlay.classList.toggle('active');
        }
    }

    // Aplicar tema guardado por el usuario
    async function applyUserTheme(userId) {
        if (!userId) return;
        try {
            const prefs = await DB.getUserPreferences(userId);
            const isAndroid = /Android/i.test(navigator.userAgent);
            const layoutKey = isAndroid ? 'config_android' : 'config_web';
            const theme = prefs[layoutKey]?.theme;
            
            if (theme) {
                if (theme.primary) document.documentElement.style.setProperty('--color-primary', theme.primary);
                if (theme.bg) {
                    document.documentElement.style.setProperty('--bg-primary', theme.bg);
                    document.body.style.backgroundImage = 'none';
                }
                if (theme.font) document.documentElement.style.setProperty('--font-size-base', theme.font);
            }
        } catch (e) {
            console.warn('⚠️ Error aplicando tema:', e);
        }
    }

    // --- Reconexión al volver del segundo plano (móvil) ---

    function setupReconnectionHandler() {
        // Al volver a la pestaña (después de que el SO la mató o puso en background)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                console.log('📱 App volvió al primer plano');
                if (typeof window.unlockGlobalAudio === 'function') window.unlockGlobalAudio();
                _restoreSessionOnResume();
            } else {
                // Al ir a background: hacer un ping a Firebase para mantener conexión
                try {
                    firebaseDB.ref('.info/connected').once('value');
                    console.log('📱 App en background — ping Firebase enviado');
                } catch(e) { /* ignorar */ }
            }
        });

        // Algunos mobile browsers disparan pageshow en lugar de visibilitychange
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                console.log('📱 Página restaurada desde bfcache');
                _restoreSessionOnResume();
            }
        });

        // Al recuperar conexión WiFi/datos
        window.addEventListener('online', () => {
            console.log('🌐 Conexión recuperada');
            // Forzar reconexión de Firebase
            try { firebase.database().goOnline(); } catch(e) {}
            if (Auth.isLoggedIn()) {
                // Reiniciar SOS listener (se muere en cambios WiFi↔4G)
                if (typeof SOSModule !== 'undefined') {
                    console.log('🌐 Reiniciando SOS listener después de reconexión...');
                    try { SOSModule.stopListening(); } catch(e) {}
                    try { SOSModule.startListening(); } catch(e) {
                        console.error('🌐 Error reiniciando SOS listener:', e);
                    }
                }
                // Refrescar vista actual
                const currentRoute = Router.getCurrentRoute();
                if (currentRoute && currentRoute !== 'login') {
                    Router.navigate(currentRoute);
                }
            }
        });

        // Al perder conexión
        window.addEventListener('offline', () => {
            console.warn('📱 Sin conexión — modo offline');
        });
    }

    // Restaurar sesión y refrescar vista si estamos logueados
    // REGLA DE ORO: NUNCA redirigir a login por un error de red.
    // _lastResumeTime inicializado al inicio de App
    async function _restoreSessionOnResume() {
        // Debounce: no restaurar más de 1 vez cada 3 segundos 
        const now = Date.now();
        if (now - _lastResumeTime < 3000) return;
        _lastResumeTime = now;
        window._lastResumeTime = now;
        if (typeof window.unlockGlobalAudio === 'function') window.unlockGlobalAudio();
        // Activar WebWakeLock hack para PWA
        if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.enableWebWakeLockHack === 'function') {
            AndroidServices.enableWebWakeLockHack();
        }

        try {
            // 1. Recuperar sesión con cascada completa (localStorage > sessionStorage > IndexedDB)
            const user = await Auth.recoverSession();
            if (!user) {
                // Las 3 capas de almacenamiento están vacías — esto SÍ es un logout real
                console.warn('📱 No hay sesión en ninguna capa de almacenamiento — redirigir a login');
                Router.navigate('login');
                return;
            }

            console.log('📱 Sesión encontrada:', user.name, '| Rol:', user.role, '| Fleet:', user.fleetId);

            // 2. Asegurar que el fleetId está configurado
            if (user.fleetId) {
                DB.setFleet(user.fleetId);
            }

            // 2.5. Cargar tema de usuario
            if (user.id) {
                await applyUserTheme(user.id);
            }

            // 3. Reconectar Firebase Realtime Database (no bloqueante)
            try {
                firebase.database().goOnline();
                console.log('📱 Firebase DB reconectada');
            } catch (e) {
                console.warn('📱 No se pudo reconectar Firebase (no crítico):', e);
            }

            // 4. Re-verificar conectividad con Firebase — timeout corto, NO bloquear
            try {
                await Promise.race([
                    DB.open(),
                    new Promise(resolve => setTimeout(resolve, 3000)) // 3s max
                ]);
            } catch (dbErr) {
                // Error de red — NO hacer logout, continuar con datos en caché
                console.warn('📱 Firebase no responde (continuando offline):', dbErr);
            }

            // 5. Reiniciar realtime sync si no está activa
            if (!realtimeListenersActive) {
                startRealtimeSync();
            }

            // 5.5. CRÍTICO: Reiniciar SOS listener (se muere en background móvil)
            if (typeof SOSModule !== 'undefined') {
                console.log('📱 Reiniciando SOS listener después de resume...');
                try { SOSModule.stopListening(); } catch(e) { /* ignorar */ }
                try { SOSModule.startListening(); } catch(e) {
                    console.error('📱 Error reiniciando SOS listener:', e);
                }
            }

            // 5.6. Reiniciar voz global de operativos (se puede perder en background)
            if (typeof TrafficAlerts !== 'undefined' && typeof TrafficAlerts.startGlobalVoiceListener === 'function') {
                try { TrafficAlerts.startGlobalVoiceListener(); } catch(e) { /* no crítico */ }
            }

            // 5.7. Reiniciar copiloto de radares si se desconectó
            if (typeof GPSPermissions !== 'undefined') {
                try { GPSPermissions.initCopilotForAll(); } catch(e) { /* no crítico */ }
            }

            // Sincronizar turno activo/GPS al volver del background
            await syncActiveShiftGPS();

            // 6. SHIFT HYDRATION: Si es conductor, verificar turno activo ANTES de refrescar
            if (Auth.isDriver() && typeof ShiftsModule !== 'undefined') {
                console.log('📱 Conductor detectado — verificando turno activo (hydration)...');
                try {
                    const hadActiveShift = await ShiftsModule.hydrateActiveShift();
                    if (hadActiveShift) {
                        console.log('📱 ✅ Turno activo restaurado correctamente');
                        return; // hydrateActiveShift ya navegó a 'shifts'
                    }
                    console.log('📱 No hay turno activo — continuando navegación normal');
                } catch (shiftErr) {
                    // Error de red consultando turnos — NO bloquear, continuar
                    console.warn('📱 Error en shift hydration (no crítico):', shiftErr);
                }
            }

            // 7. Refrescar la vista actual (esto re-obtiene datos del DB)
            const currentRoute = Router.getCurrentRoute();
            if (currentRoute && currentRoute !== 'login') {
                console.log(`📱 Restaurando vista: ${currentRoute}`);
                Router.navigate(currentRoute);
            }

            // Mostrar banner PWA si aplica (driver que vuelve del background)
            if (typeof PWAInstall !== 'undefined') {
                setTimeout(() => PWAInstall.showBanner(), 1500);
            }
        } catch (e) {
            console.warn('📱 Error al restaurar sesión:', e);
            // REGLA DE ORO: NUNCA hacer logout por un error acá.
            // El usuario puede seguir trabajando con datos cacheados.
            // Solo mostrar un aviso si hay UI disponible.
            if (typeof Components !== 'undefined' && Components.showToast) {
                Components.showToast('📡 Reconectando al servidor...', 'warning');
            }
        }
    }

    // --- Pull To Refresh Web Simulation (v122) ---
    function setupPullToRefresh() {
        let startY = 0;
        let currentY = 0;
        let pulling = false;
        const THRESHOLD = 80; // Distancia mínima para gatillar
        const RESISTANCE = 0.4;

        // Crear contenedor e inyectar en Body
        let container = document.getElementById('pull-refresh-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'pull-refresh-container';
            container.innerHTML = `
                <div id="pull-refresh-circle" style="width:42px; height:42px; background:#ffffff; border-radius:50%; box-shadow:0 4px 12px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; transition: transform 0.1s ease, opacity 0.1s ease; transform: translateY(-40px) scale(0); opacity:0; transform-origin: center; pointer-events: none;">
                    <svg viewBox="0 0 24 24" style="width:22px; height:22px; fill:none; stroke:#6366f1; stroke-width:3.5; stroke-linecap:round; transition: transform 0.1s linear;" id="pull-refresh-svg">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l.73-.73"/>
                    </svg>
                </div>
            `;
            Object.assign(container.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: '999999',
                paddingTop: '12px'
            });
            document.body.appendChild(container);
        }

        const circle = document.getElementById('pull-refresh-circle');
        const svg = document.getElementById('pull-refresh-svg');

        window.addEventListener('touchstart', (e) => {
            // v122: Mejorar detección de scroll al tope para pull-to-refresh
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
            
            if (scrollTop <= 1) { // Pequeño margen para compensar redondeos
                startY = e.touches[0].clientY;
                pulling = true;
            } else {
                pulling = false;
            }
        }, { passive: true });

        window.addEventListener('touchmove', (e) => {
            if (!pulling) return;
            currentY = e.touches[0].clientY;
            const diff = currentY - startY;

            if (diff > 0) {
                // Calculamos distancia con factor de amortiguación
                const pullDist = Math.min(diff * RESISTANCE, 120);
                
                circle.style.transform = `translateY(${pullDist}px) scale(${Math.min(pullDist / 50, 1)})`;
                circle.style.opacity = `${Math.min(pullDist / 35, 1)}`;
                
                // Rotamos dinámicamente el icono
                svg.style.transform = `rotate(${pullDist * 3.5}deg)`;
                
                // Modificar el color del borde cuando se supera el límite de activación
                if (pullDist >= THRESHOLD) {
                    svg.style.stroke = '#10b981'; // Verde éxito
                    circle.style.background = '#ffffff';
                } else {
                    svg.style.stroke = '#6366f1'; // Violeta estándar
                }
            }
        }, { passive: true });

        window.addEventListener('touchend', (e) => {
            if (!pulling) return;
            const diff = currentY - startY;
            const pullDist = diff * RESISTANCE;

            if (pullDist >= THRESHOLD) {
                // Gatillar refresco
                circle.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
                circle.style.transform = `translateY(${THRESHOLD}px) scale(1)`;
                svg.style.animation = 'pullSpinFast 0.7s linear infinite';
                
                // CSS in-line para la animación del spinner
                if (!document.getElementById('pull-spin-style')) {
                    const style = document.createElement('style');
                    style.id = 'pull-spin-style';
                    style.textContent = `@keyframes pullSpinFast { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
                    document.head.appendChild(style);
                }

                // Breve delay para feedback visual, luego refrescar vista o recarga total
                setTimeout(() => {
                    const currentRoute = (typeof Router !== 'undefined') ? Router.getCurrentRoute() : null;
                    if (currentRoute && currentRoute !== 'login') {
                        console.log('🔄 Pull-To-Refresh: Recargando ruta ' + currentRoute);
                        Router.navigate(currentRoute);
                        if (typeof Components !== 'undefined' && Components.showToast) {
                            Components.showToast('🔄 Datos actualizados', 'success');
                        }
                    } else {
                        console.log('🔄 Pull-To-Refresh: Forzando reload de página completo.');
                        window.location.reload();
                    }
                    
                    // Contraer y ocultar después de completar
                    setTimeout(() => {
                        circle.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
                        circle.style.transform = `translateY(-40px) scale(0)`;
                        circle.style.opacity = '0';
                        setTimeout(() => {
                            svg.style.animation = 'none';
                            circle.style.transition = 'none';
                        }, 450);
                    }, 400);
                }, 600);
            } else {
                // Cancelado, colapsar inmediatamente
                circle.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
                circle.style.transform = `translateY(-40px) scale(0)`;
                circle.style.opacity = '0';
                setTimeout(() => {
                    circle.style.transition = 'none';
                }, 300);
            }

            pulling = false;
            startY = 0;
            currentY = 0;
        });
    }

    // --- In-App Updates System (Actualizaciones Obligatorias en Tiempo Real — Web & Android) ---
    function _compareSemver(v1, v2) {
        const parse = (v) => String(v || '0.0.0').replace(/^v/i, '').trim().split('.').map(n => parseInt(n, 10) || 0);
        const a = parse(v1);
        const b = parse(v2);
        const len = Math.max(a.length, b.length, 3);
        for (let i = 0; i < len; i++) {
            const na = a[i] || 0;
            const nb = b[i] || 0;
            if (na < nb) return -1;
            if (na > nb) return 1;
        }
        return 0;
    }

    function _isNativeAndroidEnv() {
        return typeof window.NativeServiceBridge !== 'undefined';
    }

    function _getLocalAppVersion() {
        if (_isNativeAndroidEnv()) {
            try {
                const nativeVer = window.NativeServiceBridge.getAppVersionName();
                if (nativeVer && String(nativeVer).trim()) {
                    return String(nativeVer).replace(/^v/i, '').trim();
                }
            } catch (_) {}
        }
        return LOCAL_APP_VERSION;
    }

    function _saveVersionControlCache(vcData) {
        if (!vcData || typeof vcData !== 'object') return;
        try {
            localStorage.setItem('app_config_version_control', JSON.stringify(vcData));
            if (vcData.min_version_android) localStorage.setItem('min_required_version_name', String(vcData.min_version_android));
            if (vcData.android_update_url) localStorage.setItem('play_store_url', String(vcData.android_update_url));
        } catch (_) {}
    }

    function _readVersionControlCache() {
        try {
            const raw = localStorage.getItem('app_config_version_control');
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function _playForceUpdateSound(updateMessage, targetUrl, isPreview = false) {
        // 1. Alerta sonora Web Audio API (funciona en Web/PWA y WebView)
        try {
            const AudioClass = window.AudioContext || window.webkitAudioContext;
            if (AudioClass) {
                if (!window._sharedAudioContext) {
                    window._sharedAudioContext = new AudioClass();
                }
                const ctx = window._sharedAudioContext;
                const playSequence = () => {
                    const base = ctx.currentTime + 0.03;
                    const freqs = [587.33, 783.99, 1046.50, 587.33, 783.99, 1046.50];
                    freqs.forEach((freq, idx) => {
                        const start = base + idx * 0.14;
                        const osc = ctx.createOscillator();
                        const gain = ctx.createGain();
                        osc.type = 'triangle';
                        osc.frequency.setValueAtTime(freq, start);
                        gain.gain.setValueAtTime(0.001, start);
                        gain.gain.linearRampToValueAtTime(0.32, start + 0.02);
                        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
                        osc.connect(gain);
                        gain.connect(ctx.destination);
                        osc.start(start);
                        osc.stop(start + 0.13);
                    });
                };

                if (ctx.state === 'suspended') {
                    ctx.resume().then(playSequence).catch(() => {
                        const oncePlay = () => {
                            try { ctx.resume().then(playSequence).catch(() => {}); } catch (_) {}
                            document.removeEventListener('pointerdown', oncePlay, true);
                        };
                        document.addEventListener('pointerdown', oncePlay, true);
                    });
                } else {
                    playSequence();
                }
            }
        } catch (e) {
            console.warn('🔊 [FORCE-UPDATE] Error en Web Audio API:', e);
        }

        // 2. Vibración táctil si el dispositivo la soporta
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([400, 150, 400, 150, 600]);
            }
        } catch (_) {}

        // 3. Tono y locución nativa en Android + bloqueo del botón físico Atrás
        if (!isPreview && _isNativeAndroidEnv() && typeof window.NativeServiceBridge.setForceUpdateLocked === 'function') {
            try {
                window.NativeServiceBridge.setForceUpdateLocked(true, String(updateMessage || ''), String(targetUrl || ''));
            } catch (e) {
                console.warn('🔊 [FORCE-UPDATE] Error llamando NativeServiceBridge.setForceUpdateLocked:', e);
            }
        }
    }

    function _showPendingUpdateBanner(minVersion) {
        if (typeof document === 'undefined' || !document.body) return;
        let bar = document.getElementById('pending-update-top-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'pending-update-top-bar';
            bar.setAttribute('role', 'status');
            bar.style.cssText = [
                'position:fixed',
                'top:0',
                'left:0',
                'right:0',
                'z-index:2147483000',
                'background:linear-gradient(90deg, #facc15, #eab308)',
                'color:#1e293b',
                'padding:10px 16px',
                'font-family:Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                'font-size:13px',
                'font-weight:800',
                'text-align:center',
                'box-shadow:0 4px 14px rgba(234,179,8,0.45)',
                'border-bottom:2px solid #a16207',
                'display:flex',
                'align-items:center',
                'justify-content:center',
                'gap:8px',
                'pointer-events:none'
            ].join(';');
            document.body.appendChild(bar);
        }
        bar.innerHTML = `<span>⚠️ Actualización disponible (v${minVersion}): se aplicará automáticamente al finalizar este registro</span>`;

        // Watcher para activar el bloqueo inmediatamente apenas se guarde o cierre el registro activo
        if (!_pendingUpdateWatcher) {
            _pendingUpdateWatcher = setInterval(() => {
                checkPendingUpdateAfterSave();
            }, 1000);
        }
    }

    function _removePendingUpdateBanner() {
        const bar = document.getElementById('pending-update-top-bar');
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
        if (_pendingUpdateWatcher) {
            clearInterval(_pendingUpdateWatcher);
            _pendingUpdateWatcher = null;
        }
    }

    function _removeForcedUpdateOverlay() {
        const overlay = document.getElementById('forced-update-overlay');
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        _forcedUpdateActive = false;
        _forcedUpdateIsPreview = false;
        _lastUpdateSoundKey = '';
        if (_isNativeAndroidEnv() && typeof window.NativeServiceBridge.setForceUpdateLocked === 'function') {
            try { window.NativeServiceBridge.setForceUpdateLocked(false, '', ''); } catch (_) {}
        }
    }

    function _installForcedUpdateGuards() {
        if (_forcedUpdateGuardsInstalled || typeof window === 'undefined') return;
        _forcedUpdateGuardsInstalled = true;

        window.addEventListener('popstate', () => {
            if (_forcedUpdateActive && !_forcedUpdateIsPreview) {
                try { window.history.pushState({ fleetForceUpdateLock: true }, '', window.location.href); } catch (_) {}
            }
        });

        window.addEventListener('keydown', (e) => {
            if (_forcedUpdateActive && !_forcedUpdateIsPreview && e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        // Reevaluar operaciones pendientes al salir de inputs o navegar entre vistas
        document.addEventListener('focusout', () => {
            if (_latestVersionControlData) {
                setTimeout(() => checkPendingUpdateAfterSave(), 250);
            }
        }, true);
        window.addEventListener('hashchange', () => {
            if (_latestVersionControlData) {
                setTimeout(() => checkPendingUpdateAfterSave(), 250);
            }
        });
    }

    function _evaluateVersionControl(vcData) {
        if (!vcData || typeof vcData !== 'object') return false;
        _latestVersionControlData = vcData;
        _saveVersionControlCache(vcData);

        if (vcData.force_update === false) {
            _removePendingUpdateBanner();
            if (!_forcedUpdateIsPreview) {
                _removeForcedUpdateOverlay();
            }
            return false;
        }

        const isNative = _isNativeAndroidEnv();
        const localVer = _getLocalAppVersion();
        const targetMinVer = String(
            (isNative ? (vcData.min_version_android || vcData.minVersionName) : (vcData.min_version_web || vcData.minVersionName)) || ''
        ).replace(/^v/i, '').trim();

        if (!targetMinVer) return false;

        const targetUrl = String(
            vcData.android_update_url || vcData.playStoreUrl || 'https://play.google.com/store/apps/details?id=com.fleetadminpro.app'
        ).trim();
        const updateMsg = String(
            vcData.update_message || 'Hay una nueva versión obligatoria con mejoras importantes de rendimiento y GPS. Actualizá ahora para continuar trabajando.'
        ).trim();

        const needsUpdate = _compareSemver(localVer, targetMinVer) < 0;
        if (!needsUpdate) {
            _removePendingUpdateBanner();
            if (!_forcedUpdateIsPreview) {
                _removeForcedUpdateOverlay();
            }
            return false;
        }

        // Protección de operación/viaje/cobro en curso: NO interrumpir al chofer mientras carga datos
        if (_isActiveOperationInProgress() && !_forcedUpdateActive) {
            _showPendingUpdateBanner(targetMinVer);
            return true; // Requiere update pero diferido hasta finalizar la carga actual
        }

        // Sin operación en curso (o acaba de guardar): activar pantalla bloqueante + alerta sonora de inmediato
        _removePendingUpdateBanner();
        showForcedUpdateScreen(localVer, targetMinVer, targetUrl, updateMsg, vcData, false);
        return true;
    }

    function checkPendingUpdateAfterSave() {
        if (_latestVersionControlData && document.getElementById('pending-update-top-bar')) {
            if (!_isActiveOperationInProgress()) {
                _evaluateVersionControl(_latestVersionControlData);
            }
        }
    }

    function _initVersionControlListener() {
        _installForcedUpdateGuards();
        if (_versionControlListenerActive || typeof firebaseDB === 'undefined') return;
        _versionControlListenerActive = true;

        // Evaluar caché local primero si existe
        const cached = _readVersionControlCache();
        if (cached) {
            _evaluateVersionControl(cached);
        }

        try {
            firebaseDB.ref('app_config/version_control').on('value', (snap) => {
                const val = snap.val();
                if (val) {
                    _evaluateVersionControl(val);
                } else if (_latestVersionControlData) {
                    _latestVersionControlData = null;
                    _removePendingUpdateBanner();
                    if (!_forcedUpdateIsPreview) _removeForcedUpdateOverlay();
                }
            }, (err) => {
                console.warn('⚠️ [FORCE-UPDATE] Error en listener Firebase:', err?.message || err);
            });
        } catch (e) {
            console.warn('⚠️ [FORCE-UPDATE] No se pudo registrar listener en tiempo real:', e);
        }
    }

    async function checkAppVersion() {
        _installForcedUpdateGuards();
        try {
            const cached = _readVersionControlCache();
            if (cached && cached.force_update !== false) {
                const isNative = _isNativeAndroidEnv();
                const localVer = _getLocalAppVersion();
                const minVer = isNative ? cached.min_version_android : cached.min_version_web;
                if (minVer && _compareSemver(localVer, minVer) < 0) {
                    _evaluateVersionControl(cached);
                    return false;
                }
            }

            const serverUrl = (window.location.hostname === 'localhost' ||
                               window.location.hostname === '127.0.0.1' ||
                               window.location.protocol === 'file:')
                               ? 'https://fleetadmin-web-nueva.onrender.com'
                               : window.location.origin;

            const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), 3500) : null;
            const response = await fetch(`${serverUrl}/api/version-check`, controller ? { signal: controller.signal } : undefined);
            if (timer) clearTimeout(timer);

            if (response.ok) {
                const data = await response.json();
                const vcData = {
                    min_version_web: data.min_version_web || data.min_required_version_name || LOCAL_APP_VERSION,
                    min_version_android: data.min_version_android || data.min_required_version_name || LOCAL_APP_VERSION,
                    update_message: data.update_message || 'Actualización obligatoria requerida para continuar trabajando.',
                    android_update_url: data.android_update_url || data.play_store_url || 'https://play.google.com/store/apps/details?id=com.fleetadminpro.app',
                    force_update: data.force_update !== false
                };

                _saveVersionControlCache(vcData);
                const isNative = _isNativeAndroidEnv();
                const localVer = _getLocalAppVersion();
                const minTarget = isNative ? vcData.min_version_android : vcData.min_version_web;
                if (vcData.force_update && minTarget && _compareSemver(localVer, minTarget) < 0) {
                    _evaluateVersionControl(vcData);
                    return false;
                }
            }
        } catch (e) {
            console.warn('⚠️ Error al verificar versión al iniciar (continuando con listener en vivo):', e?.message || e);
        }
        return true;
    }

    function showForcedUpdateScreen(currentVersion, minVersion, playStoreUrl, updateMessage, vcData, isPreview = false) {
        _hideSplash();
        _installForcedUpdateGuards();
        _removePendingUpdateBanner();

        if (!document.body) return;

        _forcedUpdateActive = true;
        _forcedUpdateIsPreview = !!isPreview;
        _forcedUpdateTargetUrl = String(playStoreUrl || 'https://play.google.com/store/apps/details?id=com.fleetadminpro.app');
        _forcedUpdateMinVersion = String(minVersion || LOCAL_APP_VERSION);

        const safeMsg = (updateMessage || 'Hay una nueva versión obligatoria disponible con mejoras importantes para la flota.')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

        const styleId = 'forced-update-styles';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                @keyframes fuScaleIn {
                    from { opacity: 0; transform: scale(0.92); }
                    to { opacity: 1; transform: scale(1); }
                }
                @keyframes fuPulseBtn {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0.55), 0 14px 28px rgba(0, 0, 0, 0.45); transform: scale(1); }
                    50% { box-shadow: 0 0 0 12px rgba(250, 204, 21, 0), 0 18px 34px rgba(0, 0, 0, 0.55); transform: scale(1.02); }
                }
                @keyframes fuFloat {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-8px); }
                }
            `;
            document.head.appendChild(style);
        }

        if (!isPreview) {
            try { window.history.pushState({ fleetForceUpdateLock: true }, '', window.location.href); } catch (_) {}
        }

        const isOwnerUser = (typeof Auth !== 'undefined' && typeof Auth.isOwner === 'function' && Auth.isOwner());
        const isNative = _isNativeAndroidEnv();

        let overlay = document.getElementById('forced-update-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'forced-update-overlay';
            document.body.appendChild(overlay);
        }

        overlay.style.cssText = 'position:fixed; inset:0; z-index:2147483647; background:rgba(2, 6, 23, 0.97); backdrop-filter:blur(10px); display:flex; align-items:center; justify-content:center; padding:20px; font-family:Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color:#f8fafc; overflow-y:auto;';

        overlay.innerHTML = `
            <div role="dialog" aria-modal="true" style="max-width:440px; width:100%; text-align:center; padding:34px 26px; background:linear-gradient(160deg, #0f172a 0%, #1e1b4b 100%); border:2px solid #facc15; border-radius:24px; box-shadow:0 28px 60px rgba(0,0,0,0.85), 0 0 40px rgba(250,204,21,0.22); animation:fuScaleIn 0.32s cubic-bezier(0.16, 1, 0.3, 1);">
                <div style="font-size:60px; margin-bottom:14px; animation:fuFloat 2.8s ease-in-out infinite; display:inline-block;">🚨</div>
                <div style="display:inline-block; background:#facc15; color:#0f172a; font-size:11px; font-weight:900; letter-spacing:1.2px; padding:4px 12px; border-radius:999px; text-transform:uppercase; margin-bottom:14px;">
                    ${isNative ? 'ANDROID • ACTUALIZACIÓN REQUERIDA' : 'WEB / PWA • ACTUALIZACIÓN REQUERIDA'}
                </div>
                <h2 style="font-size:25px; font-weight:900; margin:0 0 12px 0; color:#ffffff; letter-spacing:-0.4px;">Actualización Obligatoria</h2>
                <div style="background:rgba(15, 23, 42, 0.85); border:1px solid rgba(250, 204, 21, 0.35); border-radius:14px; padding:14px 16px; margin-bottom:22px; text-align:left;">
                    <div style="font-size:12px; font-weight:800; color:#fde047; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">📋 Novedades de esta versión:</div>
                    <div style="font-size:14.5px; line-height:1.55; color:#f1f5f9; font-weight:500;">${safeMsg}</div>
                </div>
                <div style="display:flex; justify-content:center; gap:10px; margin-bottom:24px; font-size:12.5px; font-weight:700;">
                    <span style="background:rgba(239,68,68,0.18); color:#fca5a5; border:1px solid rgba(239,68,68,0.4); padding:6px 12px; border-radius:10px;">Tu versión: v${currentVersion}</span>
                    <span style="background:rgba(34,197,94,0.18); color:#86efac; border:1px solid rgba(34,197,94,0.4); padding:6px 12px; border-radius:10px;">Requerida: v${minVersion}</span>
                </div>
                <button id="btnForceUpdateNow" type="button" onclick="App.executeForcedUpdate()" style="display:flex; align-items:center; justify-content:center; gap:10px; width:100%; padding:18px 20px; background:linear-gradient(135deg, #facc15 0%, #f59e0b 100%); color:#0f172a; border-radius:16px; font-weight:900; font-size:17px; letter-spacing:0.4px; border:none; outline:none; cursor:pointer; animation:fuPulseBtn 2s infinite;">
                    🚀 ACTUALIZAR AHORA
                </button>
                <div id="forceUpdateProgressNote" style="margin-top:14px; font-size:12px; color:#cbd5e1; line-height:1.45;">
                    ${isNative
                        ? 'Tocá "ACTUALIZAR AHORA" para abrir la descarga oficial e instalar la última versión. La pantalla permanecerá bloqueada hasta ingresar actualizado.'
                        : 'Tocá "ACTUALIZAR AHORA" para limpiar la caché y descargar la nueva versión al instante.'}
                </div>
                ${isPreview ? `
                    <button type="button" onclick="if(typeof App!=='undefined'&&App.dismissPreviewForceUpdateModal)App.dismissPreviewForceUpdateModal();" style="margin-top:16px; background:rgba(255,255,255,0.12); color:#e2e8f0; border:1px solid rgba(255,255,255,0.25); border-radius:10px; padding:8px 16px; font-size:12px; font-weight:700; cursor:pointer;">
                        👁️ Cerrar Vista Previa (Solo Prueba)
                    </button>
                ` : (isOwnerUser ? `
                    <div style="margin-top:16px;">
                        <button type="button" onclick="if(typeof firebaseDB!=='undefined' && confirm('¿Desactivar Force Update en Firebase desde tu sesión de Administrador?')){ firebaseDB.ref('app_config/version_control/force_update').set(false); }" style="background:none; border:none; color:#64748b; font-size:11px; text-decoration:underline; cursor:pointer;">
                            ⚙️ Admin: Pausar Force Update en Firebase
                        </button>
                    </div>
                ` : '')}
            </div>
        `;

        const soundKey = `${minVersion}|${isPreview ? 'prev' : 'live'}`;
        if (_lastUpdateSoundKey !== soundKey || isPreview) {
            _lastUpdateSoundKey = soundKey;
            _playForceUpdateSound(updateMessage, _forcedUpdateTargetUrl, isPreview);
        }
    }

    async function executeForcedUpdate() {
        if (_forcedUpdateIsPreview) {
            const ov = document.getElementById('forced-update-overlay');
            if (ov) ov.remove();
            _forcedUpdateActive = false;
            _forcedUpdateIsPreview = false;
            if (typeof Components !== 'undefined') Components.showToast('✅ Simulación de botón ACTUALIZAR AHORA ejecutada', 'info');
            return;
        }

        const btn = document.getElementById('btnForceUpdateNow');
        const note = document.getElementById('forceUpdateProgressNote');

        if (_isNativeAndroidEnv()) {
            const url = _forcedUpdateTargetUrl || 'https://play.google.com/store/apps/details?id=com.fleetadminpro.app';
            if (note) note.textContent = '📲 Abriendo enlace oficial de actualización... El bloqueo seguirá activo hasta instalar la nueva versión.';
            if (typeof window.NativeServiceBridge.openForceUpdateUrl === 'function') {
                window.NativeServiceBridge.openForceUpdateUrl(url);
            } else {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
            return;
        }

        // Web / PWA: desregistrar todos los Service Workers, vaciar caches y recargar desde red
        if (btn) {
            btn.disabled = true;
            btn.textContent = '⏳ Limpiando caché y actualizando...';
        }
        if (note) note.textContent = '🔄 Desregistrando Service Workers y borrando cachés antiguas...';

        try {
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            }
        } catch (swErr) {
            console.warn('⚠️ Error desregistrando Service Workers:', swErr);
        }

        try {
            if ('caches' in window) {
                const cacheKeys = await caches.keys();
                await Promise.all(cacheKeys.map(k => caches.delete(k)));
            }
        } catch (cacheErr) {
            console.warn('⚠️ Error borrando caches:', cacheErr);
        }

        try {
            window.location.reload(true);
        } catch (_) {
            window.location.reload();
        }
    }

    function previewForceUpdateModal(opts = {}) {
        const localVer = _getLocalAppVersion();
        const sampleMin = opts.minVersion || _bumpSemverPatch(localVer);
        const sampleMsg = opts.message || 'Vista previa del cartel obligatorio: incluye sonido de alerta, bloqueo total de pantalla y protección si el chofer está cargando un viaje o cobro.';
        const sampleUrl = opts.url || 'https://play.google.com/store/apps/details?id=com.fleetadminpro.app';
        showForcedUpdateScreen(localVer, sampleMin, sampleUrl, sampleMsg, null, true);
    }

    function dismissPreviewForceUpdateModal() {
        if (!_forcedUpdateIsPreview) return;
        _removeForcedUpdateOverlay();
    }

    function _bumpSemverPatch(v) {
        const parts = String(v || LOCAL_APP_VERSION).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
        return `${parts[0] || 1}.${parts[1] || 2}.${(parts[2] || 0) + 1}`;
    }

    async function syncActiveShiftGPS() {
        const canActAsDriver = typeof Auth !== 'undefined' && (Auth.isDriver() || (typeof Auth.hasDriverCapability === 'function' && Auth.hasDriverCapability()));
        if (!canActAsDriver) return;
        try {
            const userId = Auth.getUserId();
            if (!userId) return;

            if (typeof AndroidServices !== 'undefined' && typeof AndroidServices.setUserRole === 'function') {
                AndroidServices.setUserRole(Auth.getRole() || 'driver');
            }

            const wasLocked = localStorage.getItem('active_shift_state') === 'true';
            const cachedShiftId = localStorage.getItem('active_shift_id');

            // Lectura directa puntual (<100ms) si ya conocemos active_shift_id
            let activeShift = null;
            let directShift = null;
            if (cachedShiftId) {
                directShift = await DB.get('shifts', cachedShiftId);
                if (directShift && String(directShift.driverId) === String(userId) && directShift.status === 'active') {
                    activeShift = directShift;
                }
            }

            if (!activeShift) {
                const activeShifts = await DB.getActiveShifts();
                activeShift = activeShifts.find(s => String(s.driverId) === String(userId)) || null;

                // NUNCA cerrar turno ni borrar active_shift_id por timeout de red o modo offline
                if (!activeShift && (activeShifts?._isErrorFallback || navigator.onLine === false) && (wasLocked || cachedShiftId)) {
                    console.warn('⚠️ [GPS] Timeout/offline en syncActiveShiftGPS — se preserva el turno activo local.');
                    return;
                }
                // Si la consulta de activos no encontró nada pero tampoco confirmó cierre de cachedShiftId por error de red
                if (!activeShift && cachedShiftId && directShift === undefined && navigator.onLine === false) {
                    return;
                }
            }

            if (activeShift) {
                localStorage.setItem('active_shift_id', activeShift.id);
                localStorage.setItem('active_shift_state', 'true');
                localStorage.setItem('active_shift_status', 'IN_PROGRESS');
                try { localStorage.setItem(`fleetadmin_cache_shifts_${activeShift.id}`, JSON.stringify(activeShift)); } catch (ce) { /* quota */ }
                console.log('✅ [GPS] Sincronización: Turno activo detectado (IN_PROGRESS) → GPS + Heartbeat 60s activados:', activeShift.id);

                armShiftBackLock();
                startShiftHeartbeat();

                if (typeof AndroidServices !== 'undefined') {
                    try {
                        const vehicleData = await DB.getVehicle(activeShift.vehicleId);
                        AndroidServices.enableForegroundService(activeShift.id, vehicleData?.plate || 'Vehículo en uso');
                        if (typeof AndroidServices.setShiftActive === 'function') AndroidServices.setShiftActive(true);
                    } catch (e) {
                        console.warn('Error enabling foreground service:', e);
                    }
                }
            } else {
                localStorage.removeItem('active_shift_id');
                localStorage.setItem('active_shift_state', 'false');
                localStorage.setItem('active_shift_status', 'FINALIZADO_TURNO');
                stopShiftHeartbeat();
                console.log('⏹️ [GPS] Sincronización: No hay turno activo → Heartbeat de turno detenido (background alerts continúan)');
                
                // MANTENEMOS EL FOREGROUND SERVICE VIVO para las alertas en segundo plano
                if (typeof AndroidServices !== 'undefined') {
                    try {
                        const fgLabel = Auth.isOwner() ? 'Modo Administrador (Alertas activas)' : 'Modo Copiloto (Alertas activas)';
                        AndroidServices.enableForegroundService(null, fgLabel);
                        if (typeof AndroidServices.setShiftActive === 'function') AndroidServices.setShiftActive(false);
                    } catch (e) {
                        console.warn('Error updating foreground service:', e);
                    }
                }

                // Si antes estaba bloqueado y ahora se liberó (ej. cierre remoto por admin), refrescar barra de navegación
                if (wasLocked && typeof Router !== 'undefined') {
                    const cur = Router.getCurrentRoute();
                    if (cur && cur !== 'login') {
                        Router.navigate(cur);
                    }
                }
            }
        } catch (e) {
            console.warn('⚠️ [GPS] Error en syncActiveShiftGPS:', e);
        }
    }

    async function reportAppVersionToServer() {
        const user = Auth.getUser();
        const isEligible = user && (typeof Auth.isUserDriverEligible === 'function' ? Auth.isUserDriverEligible(user) : user.role === 'driver');
        if (!isEligible) return; // Reportar para conductores y admins con esChofer

        let version = 'v' + LOCAL_APP_VERSION; // default
        if (typeof window.NativeServiceBridge !== 'undefined') {
            version = 'v' + window.NativeServiceBridge.getAppVersionName();
        }

        const versionKey = `${user.id}:${version}`;
        if (localStorage.getItem('last_reported_app_version') === versionKey) {
            return;
        }

        try {
            const serverUrl = (window.location.hostname === 'localhost' || 
                               window.location.hostname === '127.0.0.1' ||
                               window.location.protocol === 'file:') 
                               ? 'https://fleetadmin-web-nueva.onrender.com' 
                               : window.location.origin;

            const resp = await fetch(`${serverUrl}/api/driver/report-version`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    driver_id: user.id,
                    fleetId: user.fleetId,
                    version: version
                })
            });
            if (resp && resp.ok) {
                try { localStorage.setItem('last_reported_app_version', versionKey); } catch (e) {}
            }
            console.log(`📱 App version reported to server: ${version}`);
        } catch (e) {
            console.warn('⚠️ Error al reportar versión al servidor:', e);
        }
    }

    async function trackAppInstallation(userId, user) {
        if (!userId || !user || typeof firebaseDB === 'undefined') return;
        try {
            const installRef = firebaseDB.ref(`app_installations/${userId}`);
            const snap = await installRef.once('value');
            const current = snap.val();
            
            const ua = navigator.userAgent || '';
            let platform = 'web';
            if (/android/i.test(ua)) platform = 'android';
            else if (/iPad|iPhone|iPod/.test(ua)) platform = 'ios';
            else if (/Windows/.test(ua)) platform = 'windows';
            else if (/Mac/.test(ua)) platform = 'mac';

            const now = Date.now();
            const payload = {
                userId: userId,
                userName: user.name || '',
                role: user.role || 'unknown',
                fleetId: user.fleetId || 'unknown',
                installedAt: current?.installedAt || now,
                lastActive: now,
                platform: platform,
                status: 'installed',
                uninstalledAt: null,
                deviceInfo: ua.substring(0, 150)
            };
            
            await installRef.set(payload);
            console.log(`📊 [TELEMETRY] Installation tracked/updated for ${userId}`);
        } catch (e) {
            console.warn('⚠️ [TELEMETRY] Error tracking app installation:', e.message);
        }
    }

    return {
        init,
        logout,
        setLanguage,
        setDistanceUnit,
        setVolumeUnit,
        toggleSidebar,
        startRealtimeSync,
        applyUserTheme,
        reportAppVersionToServer,
        syncActiveShiftGPS,
        trackAppInstallation,
        isDriverShiftLocked,
        showShiftExitBlockedModal,
        armShiftBackLock,
        startShiftHeartbeat,
        stopShiftHeartbeat,
        sendShiftHeartbeat,
        executeForcedUpdate,
        previewForceUpdateModal,
        dismissPreviewForceUpdateModal,
        showForcedUpdateScreen,
        checkPendingUpdateAfterSave
    };
})();

// --- Iniciar la aplicación cuando cargue la página ---
document.addEventListener('DOMContentLoaded', App.init);
