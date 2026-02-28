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

        return alerts;
    }

    // Renderizar banner de alerta
    function renderAlertBanner(alert) {
        const cssClass = alert.type.includes('danger') ? 'alert-banner-danger' : 'alert-banner-warning';
        const icon = alert.type.includes('danger') ? '🔴' : '🟡';

        return `
            <div class="alert-banner ${cssClass}">
                <span class="alert-icon">${icon}</span>
                <div class="alert-content">
                    <div class="alert-title">${alert.vehicle.name} — ${alert.vehicle.plate}</div>
                    <div>${alert.message}</div>
                </div>
            </div>
        `;
    }

    return { getBeltStatus, getAllAlerts, renderAlertBanner };
})();
