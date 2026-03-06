/* ============================================
   FleetAdmin Pro — Módulo de Mantenimiento
   Correa de distribución y control de aceite
   ============================================ */

const MaintenanceModule = (() => {

    async function render() {
        const vehicles = await DB.getAll('vehicles');

        if (vehicles.length === 0) {
            return Components.renderEmptyState(
                '🔧', I18n.t('veh_no_vehicles'), I18n.t('veh_add_first'),
                `<button class="btn btn-primary" onclick="Router.navigate('vehicles')">${I18n.t('veh_add')}</button>`
            );
        }

        let html = `<div class="maintenance-grid">`;

        for (const vehicle of vehicles) {
            const belt = await Alerts.getBeltStatus(vehicle);
            html += renderBeltCard(vehicle, belt);
        }

        html += `</div>`;

        // Historial de cambios de correa
        html += `
            <div class="dashboard-section" style="margin-top:var(--space-8);">
                <div class="dashboard-section-title">📜 ${I18n.t('maint_belt_last_change')}</div>
                ${await renderBeltHistory()}
            </div>
        `;

        return html;
    }

    function renderBeltCard(vehicle, belt) {
        const levelClass = belt.level === 'danger' ? 'danger' : belt.level === 'warning' ? 'warning' : 'success';
        const levelIcon = belt.level === 'danger' ? '🔴' : belt.level === 'warning' ? '🟡' : '🟢';
        const progressClass = belt.level === 'danger' ? 'danger' : belt.level === 'warning' ? 'warning' : '';
        const statusMsg = belt.level === 'danger'
            ? I18n.t('maint_belt_alert')
            : belt.level === 'warning'
                ? I18n.t('maint_belt_warning')
                : I18n.t('maint_belt_ok');

        return `
            <div class="maintenance-card" style="border-color:${belt.level === 'danger' ? 'var(--color-danger)' : belt.level === 'warning' ? 'var(--color-warning)' : 'var(--border-color)'};">
                <div class="maintenance-card-header">
                    <div class="maintenance-card-icon stat-icon ${levelClass}">${levelIcon}</div>
                    <div>
                        <div class="maintenance-card-title">${vehicle.name}</div>
                        <div class="maintenance-card-subtitle">${vehicle.plate} — ${I18n.t('maint_timing_belt')}</div>
                    </div>
                </div>

                ${belt.level !== 'ok' ? `
                    <div class="alert-banner alert-banner-${levelClass}" style="margin-bottom:var(--space-4);">
                        <span class="alert-icon">${levelIcon}</span>
                        <div class="alert-content">${statusMsg}</div>
                    </div>
                ` : ''}

                <div class="belt-visualization">
                    <div class="belt-info">
                        <span class="belt-current">${I18n.t('maint_belt_current')}: ${Units.formatDistance(belt.currentKm)}</span>
                        <span class="belt-next">${I18n.t('maint_belt_next')}: ${Units.formatDistance(belt.nextChangeKm)}</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill ${progressClass}" style="width:${Math.min(100, belt.percentage)}%"></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:var(--space-2); font-size:var(--font-size-xs); color:var(--text-tertiary);">
                        <span>${I18n.t('maint_belt_remaining')}: ${Units.formatDistance(Math.max(0, belt.remainingKm))}</span>
                        <span>${I18n.t('maint_belt_interval')}: ${Units.formatDistance(belt.interval)}</span>
                    </div>
                </div>

                ${Auth.isOwner() ? `
                    <button class="btn btn-primary btn-sm" onclick="MaintenanceModule.registerBeltChange('${vehicle.id}')"
                        style="margin-top:var(--space-3);">
                        🔄 ${I18n.t('maint_belt_register')}
                    </button>
                ` : ''}
            </div>
        `;
    }

    async function renderBeltHistory() {
        const changes = await DB.getAll('beltChanges');
        if (changes.length === 0) {
            return `<p style="color:var(--text-tertiary); font-size:var(--font-size-sm);">${I18n.t('no_data')}</p>`;
        }

        changes.sort((a, b) => new Date(b.date) - new Date(a.date));

        // Resolver nombres de vehículos
        let rows = '';
        for (const c of changes) {
            const vehicle = await DB.get('vehicles', c.vehicleId);
            const vehName = vehicle ? `${vehicle.name} — ${vehicle.plate || ''}` : `#${c.vehicleId}`;
            rows += `
                <tr>
                    <td data-label="${I18n.t('date')}">${new Date(c.date).toLocaleDateString()}</td>
                    <td data-label="${I18n.t('mech_vehicle')}">${vehName}</td>
                    <td data-label="${I18n.t('maint_belt_at')}">${Units.formatDistance(c.odometer)}</td>
                </tr>
            `;
        }

        return `
            <div class="data-table-wrapper">
                <table class="data-table data-table-responsive">
                    <thead>
                        <tr>
                            <th>${I18n.t('date')}</th>
                            <th>${I18n.t('mech_vehicle')}</th>
                            <th>${I18n.t('maint_belt_at')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    }

    function registerBeltChange(vehicleId) {
        Components.showModal(
            I18n.t('maint_belt_register'),
            `
                <div class="form-group">
                    <label class="form-label">${I18n.t('veh_odometer')} (${Units.distanceLabel()})</label>
                    <input type="number" class="form-input" id="beltOdometer" inputmode="numeric"
                        placeholder="${I18n.t('maint_belt_current')}">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('date')}</label>
                    <input type="date" class="form-input" id="beltDate" value="${new Date().toISOString().split('T')[0]}">
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="MaintenanceModule.saveBeltChange('${vehicleId}')">${I18n.t('save')}</button>
            `
        );
    }

    async function saveBeltChange(vehicleId) {
        const odometer = parseFloat(document.getElementById('beltOdometer')?.value);
        const date = document.getElementById('beltDate')?.value;

        if (!odometer) {
            Components.showToast(I18n.t('error'), 'danger');
            return;
        }

        const odometerKm = Units.toKm(odometer);

        await DB.add('beltChanges', {
            vehicleId,
            odometer: odometerKm,
            date: date || new Date().toISOString()
        });

        // Actualizar odómetro del vehículo si es mayor
        const vehicle = await DB.get('vehicles', vehicleId);
        if (vehicle && odometerKm > (vehicle.currentOdometer || 0)) {
            vehicle.currentOdometer = odometerKm;
            await DB.put('vehicles', vehicle);
        }

        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        Router.navigate('maintenance');
    }

    return { render, registerBeltChange, saveBeltChange };
})();

/* ============================================
   FleetAdmin Pro — Módulo de Control de Aceite
   Registro de agregados con fecha, cantidad y foto
   ============================================ */

const OilModule = (() => {

    async function render() {
        const vehicles = await DB.getAll('vehicles');
        const oilLogs = await DB.getAll('oilLogs');
        const role = Auth.getRole();
        const userId = Auth.getUserId();

        // Si es chofer, solo ver sus propios registros
        const filteredLogs = role === 'driver'
            ? oilLogs.filter(l => l.driverId === userId)
            : oilLogs;

        filteredLogs.sort((a, b) => new Date(b.date) - new Date(a.date));

        const totalLiters = filteredLogs.reduce((sum, l) => sum + (l.quantity || 0), 0);

        return `
            <!-- Formulario de registro -->
            <div class="card" style="margin-bottom:var(--space-6);">
                <h3 style="margin-bottom:var(--space-4);">🛢️ ${I18n.t('oil_add')}</h3>

                <div class="repair-form-grid">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('mech_vehicle')}</label>
                        <select class="form-select" id="oilVehicle">
                            ${vehicles.map(v => `<option value="${v.id}">${v.name} — ${v.plate}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('oil_quantity')} (${Units.volumeLabel()})</label>
                        <input type="number" class="form-input" id="oilQuantity"
                            placeholder="0.5" step="0.1" inputmode="decimal">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('date')}</label>
                        <input type="date" class="form-input" id="oilDate" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                </div>

                ${Components.renderPhotoCapture('oilPhoto', I18n.t('photo') + ' (' + I18n.t('optional') + ')')}

                <button class="btn btn-primary btn-lg" onclick="OilModule.saveOilLog()" style="margin-top:var(--space-2);">
                    💾 ${I18n.t('save')}
                </button>
            </div>

            <!-- Estadística -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon warning">🛢️</div>
                    <div>
                        <div class="stat-value">${Units.formatVolume(totalLiters)}</div>
                        <div class="stat-label">${I18n.t('oil_total_added')}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon info">📋</div>
                    <div>
                        <div class="stat-value">${filteredLogs.length}</div>
                        <div class="stat-label">${I18n.t('oil_history')}</div>
                    </div>
                </div>
            </div>

            <!-- Historial -->
            <div class="dashboard-section" style="margin-top:var(--space-6);">
                <div class="dashboard-section-title">📋 ${I18n.t('oil_history')}</div>
                ${filteredLogs.length > 0 ? await renderOilTable(filteredLogs) :
                `<p style="color:var(--text-tertiary);">${I18n.t('oil_no_history')}</p>`}
            </div>
        `;
    }

    async function renderOilTable(logs) {
        // Resolver nombres de vehículos y choferes
        let rows = '';
        for (const l of logs) {
            const vehicle = await DB.get('vehicles', l.vehicleId);
            const driver = l.driverId ? await DB.get('users', l.driverId) : null;
            const vehName = vehicle ? `${vehicle.name} — ${vehicle.plate || ''}` : `#${l.vehicleId}`;
            const driverName = driver?.name || '-';
            rows += `
                <tr>
                    <td data-label="${I18n.t('date')}">${new Date(l.date).toLocaleDateString()}</td>
                    <td data-label="${I18n.t('mech_vehicle')}">${vehName}</td>
                    <td data-label="${I18n.t('oil_quantity')}">${Units.formatVolume(l.quantity)}</td>
                    <td data-label="${I18n.t('oil_added_by')}">${driverName}</td>
                    <td data-label="${I18n.t('photo')}">
                        ${l.photo ? `<img src="${l.photo}" class="table-photo" onclick="Components.showModal('${I18n.t('photo')}', '<img src=\\'${l.photo}\\' style=\\'width:100%;border-radius:8px;\\'>')">` : '-'}
                    </td>
                    ${Auth.isOwner() ? `
                        <td data-label="${I18n.t('actions')}">
                            <button class="btn btn-ghost btn-sm" onclick="OilModule.deleteOilLog('${l.id}')">🗑️</button>
                        </td>
                    ` : ''}
                </tr>
            `;
        }

        return `
            <div class="data-table-wrapper">
                <table class="data-table data-table-responsive">
                    <thead>
                        <tr>
                            <th>${I18n.t('date')}</th>
                            <th>${I18n.t('mech_vehicle')}</th>
                            <th>${I18n.t('oil_quantity')}</th>
                            <th>${I18n.t('oil_added_by')}</th>
                            <th>${I18n.t('photo')}</th>
                            ${Auth.isOwner() ? `<th>${I18n.t('actions')}</th>` : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    }

    async function saveOilLog() {
        const vehicleId = document.getElementById('oilVehicle')?.value;
        const quantity = parseFloat(document.getElementById('oilQuantity')?.value);
        const date = document.getElementById('oilDate')?.value;
        const photo = Components.getPhotoData('oilPhoto');

        if (!vehicleId || vehicleId === '' || !quantity) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        const quantityLiters = Units.toLiters(quantity);

        await DB.add('oilLogs', {
            vehicleId,
            driverId: Auth.getUserId(),
            quantity: quantityLiters,
            date: date || new Date().toISOString(),
            photo
        });

        Components.showToast(I18n.t('success') + ' ✅', 'success');
        Router.navigate('oil');
    }

    function deleteOilLog(id) {
        Components.confirm(
            I18n.t('veh_delete_confirm'),
            async () => {
                await DB.remove('oilLogs', id);
                Components.showToast(I18n.t('success'), 'success');
                Router.navigate('oil');
            }
        );
    }

    return { render, saveOilLog, deleteOilLog };
})();
