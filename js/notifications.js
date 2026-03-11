/* ============================================
   FleetAdmin Pro — Notificaciones Locales
   Módulo para programar recordatorios de turnos
   ============================================ */

const Notifications = (() => {
    let checkInterval = null;

    // Configuración de notificaciones
    const SCHEDULE = [
        { time: '06:00', type: 'end_night', title: '🏁 Fin de Turno', body: 'Recuerda finalizar tu turno de noche.' },
        { time: '06:00', type: 'start_day', title: '☀️ Turno de Día', body: 'Recuerda iniciar tu turno de día.' },
        { time: '07:00', type: 'follow_day', title: '📝 ¿Ya iniciaste tu turno?', body: 'Asegúrate de registrar las fotos de inicio de turno.' },
        { time: '18:00', type: 'end_day', title: '🏁 Fin de Turno', body: 'Recuerda finalizar tu turno de día.' },
        { time: '18:00', type: 'start_night', title: '🌙 Turno de Noche', body: 'Recuerda iniciar tu turno de noche.' },
        { time: '19:00', type: 'follow_night', title: '📝 ¿Ya iniciaste tu turno?', body: 'Asegúrate de registrar las fotos de inicio de turno.' }
    ];

    async function init() {
        if (!('Notification' in window)) {
            console.log('Este navegador no soporta notificaciones de escritorio.');
            return;
        }

        // Solicitar permisos si no están otorgados
        if (Notification.permission === 'default') {
            await Notification.requestPermission();
        }

        if (Notification.permission === 'granted') {
            startTimeChecker();
            console.log('⏰ Sistema de notificaciones iniciado.');
        } else {
            console.log('Permiso de notificaciones denegado.');
        }
    }

    function startTimeChecker() {
        if (checkInterval) clearInterval(checkInterval);

        // Revisar cada minuto
        checkInterval = setInterval(checkSchedule, 60000);

        // Revisar inmediatamente al iniciar
        checkSchedule();
    }

    async function checkSchedule() {
        const now = new Date();
        const currentHour = String(now.getHours()).padStart(2, '0');
        const currentMinute = String(now.getMinutes()).padStart(2, '0');
        const currentTime = `${currentHour}:${currentMinute}`;
        const todayStr = now.toISOString().split('T')[0];

        // Obtener estado actual (si hay usuario logueado en este dispositivo)
        let hasActiveShift = false;
        if (Auth.isLoggedIn() && Auth.getRole() === 'driver') {
            const driverId = Auth.getUserId();
            const allShifts = await DB.getAllByIndex('shifts', 'driverId', driverId);
            hasActiveShift = allShifts.some(s => s.status === 'active');
        }

        SCHEDULE.forEach(schedule => {
            if (schedule.time === currentTime) {

                const isStartReminder = ['start_day', 'follow_day', 'start_night', 'follow_night'].includes(schedule.type);
                const isEndReminder = ['end_day', 'end_night'].includes(schedule.type);

                // Si el conductor tiene un turno activo actualmente, NO le enviamos notificaciones de Iniciar Turno
                if (isStartReminder && hasActiveShift) {
                    return;
                }

                // Si el conductor NO tiene un turno activo, NO le enviamos notificaciones de Finalizar Turno
                if (isEndReminder && !hasActiveShift) {
                    return;
                }

                // Evitar notificar dos veces en el mismo minuto
                const storageKey = `notified_${schedule.type}_${todayStr}`;
                if (!localStorage.getItem(storageKey)) {
                    sendNotification(schedule.title, schedule.body);
                    localStorage.setItem(storageKey, 'true');
                }
            }
        });

        // Verificar licencias de conducir una vez al día (a las 09:00)
        if (currentTime === '09:00') {
            await checkLicenseExpiry(todayStr);
        }
    }

    async function checkLicenseExpiry(todayStr) {
        try {
            const licenseAlerts = await Alerts.getLicenseAlerts();
            if (!licenseAlerts || licenseAlerts.length === 0) return;

            for (const alert of licenseAlerts) {
                const daysLeft = alert.daysLeft;
                const driverName = alert.driver.name;

                // Determinar si debemos notificar hoy:
                // - 60 días antes
                // - Luego cada 15 días (45, 30, 15, 0)
                // - Si está vencida, cada 15 días después
                let shouldNotify = false;

                if (daysLeft <= 0) {
                    // Vencida: notificar cada 15 días
                    shouldNotify = (Math.abs(daysLeft) % 15 === 0) || daysLeft === 0;
                } else if (daysLeft === 60 || daysLeft === 45 || daysLeft === 30 || daysLeft === 15 || daysLeft <= 7) {
                    shouldNotify = true;
                }

                if (shouldNotify) {
                    const storageKey = `license_notif_${alert.driver.id}_${todayStr}`;
                    if (!localStorage.getItem(storageKey)) {
                        // Notificar al admin
                        sendNotification(
                            `🪪 ${I18n.t('license_title')}`,
                            alert.message
                        );

                        // Si el conductor logueado es este driver, notificar directamente
                        if (Auth.isDriver() && Auth.getUserId() === alert.driver.id) {
                            const driverMsg = daysLeft < 0
                                ? I18n.t('license_alert_expired_driver', { date: new Date(alert.driver.licenseExpiryDate).toLocaleDateString() })
                                : I18n.t('license_alert_driver', { date: new Date(alert.driver.licenseExpiryDate).toLocaleDateString(), days: daysLeft });
                            sendNotification(`🪪 ${I18n.t('license_title')}`, driverMsg);
                        }

                        localStorage.setItem(storageKey, 'true');
                    }
                }
            }
        } catch (e) {
            console.warn('Error verificando licencias:', e);
        }
    }

    function sendNotification(title, body) {
        if (Notification.permission === 'granted') {
            navigator.serviceWorker.ready.then(registration => {
                registration.showNotification(title, {
                    body: body,
                    icon: './assets/icon-192.png',
                    badge: './assets/icon.svg',
                    vibrate: [200, 100, 200, 100, 200, 100, 200],
                    data: {
                        url: location.origin + location.pathname
                    }
                });
            }).catch(err => {
                // Fallback a Notification API estándar si no hay Service Worker (ej. testing en PC)
                new Notification(title, {
                    body: body,
                    icon: './assets/icon-192.png'
                });
            });
        }
    }

    // Método para forzar la solicitud de permisos desde la UI (ej. botón en configuración)
    async function requestPermission() {
        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                startTimeChecker();
                sendNotification('¡Listo!', 'Recibirás recordatorios para iniciar tu turno.');
            }
            return permission;
        }
        return 'denied';
    }

    return { init, requestPermission };
})();
