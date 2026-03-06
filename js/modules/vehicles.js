/* ============================================
   FleetAdmin Pro — Módulo de Vehículos
   CRUD de vehículos con odómetro y estado
   ============================================ */

const VehiclesModule = (() => {

    async function render() {
        const vehicles = await DB.getAll('vehicles');

        return `
            <div class="mechanic-header">
                <div>
                    <h2 style="font-size:var(--font-size-2xl); font-weight:700;">🚗 ${I18n.t('nav_vehicles')}</h2>
                </div>
                ${Auth.isOwner() ? `
                    <button class="btn btn-primary" onclick="VehiclesModule.showForm()">
                        ➕ ${I18n.t('veh_add')}
                    </button>
                ` : ''}
            </div>

            ${vehicles.length > 0 ? `
                <div class="vehicle-cards">
                    ${await renderVehicleCards(vehicles)}
                </div>
            ` : Components.renderEmptyState(
            '🚗',
            I18n.t('veh_no_vehicles'),
            I18n.t('veh_add_first'),
            Auth.isOwner() ? `<button class="btn btn-primary" onclick="VehiclesModule.showForm()">➕ ${I18n.t('veh_add')}</button>` : ''
        )}
        `;
    }

    async function renderVehicleCards(vehicles) {
        let html = '';
        for (const v of vehicles) {
            const belt = await Alerts.getBeltStatus(v);
            const shifts = await DB.getAllByIndex('shifts', 'vehicleId', v.id);
            const completedShifts = shifts.filter(s => s.status === 'completed');
            const totalKm = completedShifts.reduce((sum, s) => sum + ((s.endOdometer || 0) - (s.startOdometer || 0)), 0);

            html += `
                <div class="vehicle-card">
                    <div class="vehicle-card-header">
                        <span class="vehicle-name">🚗 ${v.name}</span>
                        <span class="vehicle-plate">${v.plate || '-'}</span>
                    </div>

                    ${belt.level !== 'ok' ? `
                        <div style="margin-bottom:var(--space-3);">
                            <span class="badge badge-${belt.level === 'danger' ? 'danger' : 'warning'}">
                                ${belt.level === 'danger' ? '🔴' : '🟡'} ${I18n.t('maint_timing_belt')}
                            </span>
                        </div>
                    ` : ''}

                    <div class="vehicle-stats">
                        <div class="vehicle-stat">
                            <div class="vehicle-stat-value">${Units.formatDistance(v.currentOdometer || 0)}</div>
                            <div class="vehicle-stat-label">${I18n.t('veh_odometer')}</div>
                        </div>
                        <div class="vehicle-stat">
                            <div class="vehicle-stat-value">${v.year || '-'}</div>
                            <div class="vehicle-stat-label">${I18n.t('veh_year')}</div>
                        </div>
                        <div class="vehicle-stat">
                            <div class="vehicle-stat-value">${Units.formatDistance(totalKm)}</div>
                            <div class="vehicle-stat-label">${I18n.t('shift_total_km')}</div>
                        </div>
                        <div class="vehicle-stat">
                            <div class="vehicle-stat-value">
                                <span class="badge ${v.status === 'active' ? 'badge-success' : 'badge-warning'}">
                                    ${v.status === 'active' ? I18n.t('veh_active') : I18n.t('veh_inactive')}
                                </span>
                            </div>
                            <div class="vehicle-stat-label">${I18n.t('veh_status')}</div>
                        </div>
                    </div>

                    ${Auth.isOwner() ? `
                        <div style="display:flex; gap:var(--space-2); margin-top:var(--space-4);">
                            <button class="btn btn-ghost btn-sm" onclick="VehiclesModule.showForm('${v.id}')">
                                ✏️ ${I18n.t('edit')}
                            </button>
                            <button class="btn btn-ghost btn-sm" onclick="VehiclesModule.deleteVehicle('${v.id}')">
                                🗑️ ${I18n.t('delete')}
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }
        return html;
    }

    async function showForm(vehicleId = null) {
        let vehicle = null;
        if (vehicleId) {
            vehicle = await DB.get('vehicles', vehicleId);
        }

        Components.showModal(
            vehicle ? I18n.t('veh_edit') : I18n.t('veh_add'),
            `
                <div class="form-group">
                    <label class="form-label">${I18n.t('veh_name')} *</label>
                    <input type="text" class="form-input" id="vehName"
                        value="${vehicle?.name || ''}" placeholder="Toyota Corolla 2020">
                </div>
                <div class="repair-form-grid">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('veh_plate')}</label>
                        <input type="text" class="form-input" id="vehPlate"
                            value="${vehicle?.plate || ''}" placeholder="ABC-1234" style="text-transform:uppercase;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('veh_year')}</label>
                        <input type="number" class="form-input" id="vehYear"
                            value="${vehicle?.year || ''}" placeholder="2020" inputmode="numeric">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('veh_odometer')} (${Units.distanceLabel()})</label>
                    <input type="number" class="form-input" id="vehOdometer"
                        value="${vehicle ? Units.displayDistance(vehicle.currentOdometer || 0) : ''}"
                        inputmode="numeric">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('veh_status')}</label>
                    <select class="form-select" id="vehStatus">
                        <option value="active" ${vehicle?.status === 'active' ? 'selected' : ''}>${I18n.t('veh_active')}</option>
                        <option value="inactive" ${vehicle?.status === 'inactive' ? 'selected' : ''}>${I18n.t('veh_inactive')}</option>
                    </select>
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="VehiclesModule.saveVehicle('${vehicleId || ''}')">${I18n.t('save')}</button>
            `
        );
    }

    async function saveVehicle(vehicleId) {
        const name = document.getElementById('vehName')?.value.trim();
        const plate = document.getElementById('vehPlate')?.value.trim().toUpperCase();
        const year = parseInt(document.getElementById('vehYear')?.value) || null;
        const odometer = parseFloat(document.getElementById('vehOdometer')?.value) || 0;
        const status = document.getElementById('vehStatus')?.value || 'active';

        if (!name) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        const odometerKm = Units.toKm(odometer);

        const data = {
            name, plate, year,
            currentOdometer: odometerKm,
            status
        };

        if (vehicleId && vehicleId !== '' && vehicleId !== 'null') {
            data.id = vehicleId;
            await DB.put('vehicles', data);
        } else {
            await DB.add('vehicles', data);
        }

        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        Router.navigate('vehicles');
    }

    function deleteVehicle(id) {
        Components.confirm(
            I18n.t('veh_delete_confirm'),
            async () => {
                await DB.remove('vehicles', id);
                Components.showToast(I18n.t('success'), 'success');
                Router.navigate('vehicles');
            }
        );
    }

    return { render, showForm, saveVehicle, deleteVehicle };
})();
