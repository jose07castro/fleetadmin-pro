/* ============================================
   FleetAdmin Pro — Módulo del Mecánico
   Registro de reparaciones con privacidad blindada
   NO muestra datos financieros ni ganancias
   ============================================ */

const MechanicModule = (() => {

    async function render() {
        const vehicles = await DB.getAll('vehicles');
        const repairs = await DB.getAll('repairs');
        const role = Auth.getRole();
        const userId = Auth.getUserId();

        // Si es mecánico, solo ver sus reparaciones
        const filteredRepairs = role === 'mechanic'
            ? repairs.filter(r => r.mechanicId === userId)
            : repairs;

        filteredRepairs.sort((a, b) => new Date(b.date) - new Date(a.date));

        const totalCost = filteredRepairs.reduce((sum, r) => sum + (r.cost || 0), 0);

        return `
            <div class="mechanic-header">
                <div>
                    <h2 style="font-size:var(--font-size-2xl); font-weight:700;">🛠️ ${I18n.t('mech_title')}</h2>
                    <p style="color:var(--text-secondary);">${I18n.t('mech_history')}</p>
                </div>
                <button class="btn btn-primary" onclick="MechanicModule.showRepairForm()">
                    ➕ ${I18n.t('mech_add_repair')}
                </button>
            </div>

            <!-- Estadísticas (sin datos financieros de ganancias) -->
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon warning">🔧</div>
                    <div>
                        <div class="stat-value">${filteredRepairs.length}</div>
                        <div class="stat-label">${I18n.t('maint_repairs')}</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon danger">💸</div>
                    <div>
                        <div class="stat-value">${I18n.t('unit_currency')}${totalCost.toLocaleString()}</div>
                        <div class="stat-label">${I18n.t('mech_total_cost')}</div>
                    </div>
                </div>
            </div>

            <!-- Historial de reparaciones -->
            <div class="dashboard-section" style="margin-top:var(--space-6);">
                <div class="dashboard-section-title">📋 ${I18n.t('mech_history')}</div>
                ${filteredRepairs.length > 0 ? renderRepairTable(filteredRepairs, vehicles) :
                Components.renderEmptyState('🔧', I18n.t('mech_no_history'))}
            </div>
        `;
    }

    function renderRepairTable(repairs, vehicles) {
        return `
            <div class="data-table-wrapper">
                <table class="data-table data-table-responsive">
                    <thead>
                        <tr>
                            <th>${I18n.t('date')}</th>
                            <th>${I18n.t('mech_vehicle')}</th>
                            <th>${I18n.t('mech_repair_desc')}</th>
                            <th>${I18n.t('veh_odometer')}</th>
                            <th>${I18n.t('mech_cost')}</th>
                            <th>${I18n.t('photo')}</th>
                            ${Auth.isOwner() ? `<th>${I18n.t('actions')}</th>` : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${repairs.map(r => {
            const vehicle = vehicles.find(v => v.id === r.vehicleId);
            return `
                            <tr>
                                <td data-label="${I18n.t('date')}">${new Date(r.date).toLocaleDateString()}</td>
                                <td data-label="${I18n.t('mech_vehicle')}">${vehicle?.name || ''} ${vehicle?.plate || ''}</td>
                                <td data-label="${I18n.t('mech_repair_desc')}">${r.description || '-'}</td>
                                <td data-label="${I18n.t('veh_odometer')}">${Units.formatDistance(r.odometer || 0)}</td>
                                <td data-label="${I18n.t('mech_cost')}">${I18n.t('unit_currency')}${(r.cost || 0).toLocaleString()}</td>
                                <td data-label="${I18n.t('photo')}">
                                    ${r.photo ? `<img src="${r.photo}" class="table-photo" onclick="Components.showModal('${I18n.t('photo')}', '<img src=\\'${r.photo}\\' style=\\'width:100%;border-radius:8px;\\'>')">` : '-'}
                                </td>
                                ${Auth.isOwner() ? `
                                    <td data-label="${I18n.t('actions')}">
                                        <button class="btn btn-ghost btn-sm" onclick="MechanicModule.editRepair('${r.id}')">✏️</button>
                                        <button class="btn btn-ghost btn-sm" onclick="MechanicModule.deleteRepair('${r.id}')">🗑️</button>
                                    </td>
                                ` : ''}
                            </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function showRepairForm(repair = null) {
        DB.getAll('vehicles').then(vehicles => {
            Components.showModal(
                repair ? I18n.t('edit') : I18n.t('mech_add_repair'),
                `
                    <div class="form-group">
                        <label class="form-label">${I18n.t('mech_vehicle')}</label>
                        <select class="form-select" id="repairVehicle">
                            ${vehicles.map(v =>
                    `<option value="${v.id}" ${repair?.vehicleId === v.id ? 'selected' : ''}>
                                    ${v.name} — ${v.plate}
                                </option>`
                ).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('mech_repair_desc')}</label>
                        <textarea class="form-textarea" id="repairDesc" placeholder="${I18n.t('mech_repair_desc')}">${repair?.description || ''}</textarea>
                    </div>
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label">${I18n.t('mech_odometer')} (${Units.distanceLabel()})</label>
                            <input type="number" class="form-input" id="repairOdometer"
                                value="${repair ? Units.displayDistance(repair.odometer || 0) : ''}"
                                inputmode="numeric">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${I18n.t('mech_cost')} (${I18n.t('unit_currency')})</label>
                            <input type="number" class="form-input" id="repairCost"
                                value="${repair?.cost || ''}" step="0.01" inputmode="decimal">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${I18n.t('date')}</label>
                            <input type="date" class="form-input" id="repairDate"
                                value="${repair?.date ? new Date(repair.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}">
                        </div>
                    </div>
                    ${Components.renderPhotoCapture('repairPhoto', I18n.t('mech_photos'))}
                `,
                `
                    <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                    <button class="btn btn-primary" onclick="MechanicModule.saveRepair('${repair?.id || ''}')">${I18n.t('save')}</button>
                `
            );
        });
    }

    async function saveRepair(repairId) {
        const vehicleId = document.getElementById('repairVehicle')?.value;
        const description = document.getElementById('repairDesc')?.value;
        const odometer = parseFloat(document.getElementById('repairOdometer')?.value) || 0;
        const cost = parseFloat(document.getElementById('repairCost')?.value) || 0;
        const date = document.getElementById('repairDate')?.value;
        const photo = Components.getPhotoData('repairPhoto');

        if (!vehicleId || vehicleId === '' || !description) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        const odometerKm = Units.toKm(odometer);

        const data = {
            vehicleId,
            mechanicId: Auth.getUserId(),
            description,
            odometer: odometerKm,
            cost,
            date: date || new Date().toISOString(),
            photo
        };

        if (repairId && repairId !== '' && repairId !== 'null') {
            data.id = repairId;
            await DB.put('repairs', data);
        } else {
            await DB.add('repairs', data);
        }

        // Actualizar odómetro si es mayor
        const vehicle = await DB.get('vehicles', vehicleId);
        if (vehicle && odometerKm > (vehicle.currentOdometer || 0)) {
            vehicle.currentOdometer = odometerKm;
            await DB.put('vehicles', vehicle);
        }

        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        Router.navigate('mechanic');
    }

    async function editRepair(id) {
        const repair = await DB.get('repairs', id);
        if (repair) showRepairForm(repair);
    }

    function deleteRepair(id) {
        Components.confirm(
            I18n.t('veh_delete_confirm'),
            async () => {
                await DB.remove('repairs', id);
                Components.showToast(I18n.t('success'), 'success');
                Router.navigate('mechanic');
            }
        );
    }

    return { render, showRepairForm, saveRepair, editRepair, deleteRepair };
})();
