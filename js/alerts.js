/* ============================================
   FleetAdmin Pro — Sistema de Alertas de Mantenimiento
   Correa de distribución: alerta roja cada 60,000 KM
   Alerta preventiva 5,000 KM antes
   ============================================ */

const Alerts = (() => {

    // Calcular el estado de la correa de distribución para un vehículo
    async function getBeltStatus(vehicle) {
        const beltChanges = await DB.getAllByIndex('beltChanges', 'vehicleId', vehicle.id);
        const interval = Units.getBeltIntervalKm(); // 60,000 KM
        const warning = Units.getBeltWarningKm();   // 5,000 KM

        // Último cambio de correa (en KM)
        let lastChangeKm = 0;
        if (beltChanges.length > 0) {
            const sorted = beltChanges.sort((a, b) => b.odometer - a.odometer);
            lastChangeKm = sorted[0].odometer;
        }

        // KM actuales del vehículo
        const currentKm = vehicle.currentOdometer || 0;

        // Próximo cambio
        const nextChangeKm = lastChangeKm + interval;

        // KM restantes hasta el próximo cambio
        const remainingKm = nextChangeKm - currentKm;

        // Determinar nivel de alerta
        let level = 'ok'; // verde
        if (remainingKm <= 0) {
            level = 'danger'; // rojo — cambio necesario
        } else if (remainingKm <= warning) {
            level = 'warning'; // amarillo — preventiva
        }

        return {
            level,
            currentKm,
            lastChangeKm,
            nextChangeKm,
            remainingKm,
            interval,
            percentage: Math.min(100, ((currentKm - lastChangeKm) / interval) * 100)
        };
    }

    // Obtener todas las alertas de todos los vehículos
    async function getAllAlerts() {
        const vehicles = await DB.getAll('vehicles');
        const alerts = [];

        for (const vehicle of vehicles) {
            const belt = await getBeltStatus(vehicle);
            if (belt.level === 'danger') {
                alerts.push({
                    type: 'belt_danger',
                    vehicle,
                    data: belt,
                    message: I18n.t('alert_belt_danger', {
                        current: Units.formatDistance(belt.currentKm),
                        limit: Units.formatDistance(belt.nextChangeKm)
                    })
                });
            } else if (belt.level === 'warning') {
                alerts.push({
                    type: 'belt_warning',
                    vehicle,
                    data: belt,
                    message: I18n.t('alert_belt_warning', {
                        remaining: Units.formatDistance(belt.remainingKm),
                        unit: Units.distanceLabel()
                    })
                });
            }
        }

        // Alertas de licencia de conducir
        const licenseAlerts = await getLicenseAlerts();
        alerts.push(...licenseAlerts);

        return alerts;
    }

    // Calcular alertas de vencimiento de licencia
    async function getLicenseAlerts() {
        const users = await DB.getAll('users');
        const drivers = users.filter(u => u.role === 'driver' && u.licenseExpiryDate);
        const alerts = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const driver of drivers) {
            const expiryDate = new Date(driver.licenseExpiryDate + 'T00:00:00');
            const diffMs = expiryDate - today;
            const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            const dateStr = expiryDate.toLocaleDateString();

            if (daysLeft < 0) {
                // Licencia vencida
                alerts.push({
                    type: 'license_expired',
                    driver,
                    daysLeft,
                    message: I18n.t('license_alert_expired_admin', {
                        driver: driver.name,
                        date: dateStr
                    })
                });
            } else if (daysLeft <= 60) {
                // Licencia por vencer (60 días)
                alerts.push({
                    type: 'license_warning',
                    driver,
                    daysLeft,
                    message: I18n.t('license_alert_admin', {
                        driver: driver.name,
                        date: dateStr,
                        days: daysLeft
                    })
                });
            }
        }

        return alerts;
    }

    // Helper: obtener estado de licencia de un conductor
    function getLicenseStatus(driver) {
        if (!driver.licenseExpiryDate) return { level: 'unknown', daysLeft: null };
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiryDate = new Date(driver.licenseExpiryDate + 'T00:00:00');
        const daysLeft = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

        if (daysLeft < 0) return { level: 'danger', daysLeft };
        if (daysLeft <= 60) return { level: 'warning', daysLeft };
        return { level: 'ok', daysLeft };
    }

    // Renderizar banner de alerta
    function renderAlertBanner(alert) {
        const isDanger = alert.type.includes('danger') || alert.type.includes('expired');
        const cssClass = isDanger ? 'alert-banner-danger' : 'alert-banner-warning';
        const icon = isDanger ? '🔴' : '🟡';

        let title = '';
        if (alert.vehicle) {
            title = `${alert.vehicle.name} — ${alert.vehicle.plate}`;
        } else if (alert.driver) {
            title = `${alert.driver.name} — ${I18n.t('license_title')}`;
        }

        return `
            <div class="alert-banner ${cssClass}">
                <span class="alert-icon">${icon}</span>
                <div class="alert-content">
                    <div class="alert-title">${title}</div>
                    <div>${alert.message}</div>
                </div>
            </div>
        `;
    }

    return { getBeltStatus, getAllAlerts, getLicenseAlerts, getLicenseStatus, renderAlertBanner };
})();
