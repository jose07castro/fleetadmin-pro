/* ============================================
   FleetAdmin Pro — Módulo de Vehículos
   CRUD de vehículos con odómetro, estado y RTO/VTV
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

    // Helper: estado de RTO/VTV
    function getVtvStatus(vehicle) {
        if (!vehicle.vtvExpiryDate) return { level: 'unknown', daysLeft: null };
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expiryDate = new Date(vehicle.vtvExpiryDate + 'T00:00:00');
        const daysLeft = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

        if (daysLeft < 0) return { level: 'danger', daysLeft };
        if (daysLeft <= 60) return { level: 'warning', daysLeft };
        return { level: 'ok', daysLeft };
    }

    async function renderVehicleCards(vehicles) {
        let html = '';
        for (const v of vehicles) {
            const belt = await Alerts.getBeltStatus(v);
            const shifts = await DB.getAllByIndex('shifts', 'vehicleId', v.id);
            const completedShifts = shifts.filter(s => s.status === 'completed');
            const totalKm = completedShifts.reduce((sum, s) => sum + ((s.endOdometer || 0) - (s.startOdometer || 0)), 0);

            // Badge RTO/VTV
            const vtv = getVtvStatus(v);
            let vtvBadge = '';
            if (vtv.level === 'danger') {
                vtvBadge = `<span class="badge badge-danger" style="font-size:0.7rem;">🔴 ${I18n.t('vtv_title')}: ${I18n.t('vtv_expired')}</span>`;
            } else if (vtv.level === 'warning') {
                vtvBadge = `<span class="badge badge-warning" style="font-size:0.7rem;">🟡 ${I18n.t('vtv_title')}: ${vtv.daysLeft}d</span>`;
            } else if (vtv.level === 'ok') {
                vtvBadge = `<span class="badge badge-success" style="font-size:0.7rem;">🟢 ${I18n.t('vtv_title')}: ${vtv.daysLeft}d</span>`;
            } else {
                vtvBadge = `<span class="badge" style="font-size:0.7rem; background:var(--bg-tertiary); color:var(--text-secondary);">⚪ ${I18n.t('vtv_title')}: ${I18n.t('vtv_not_loaded')}</span>`;
            }

            html += `
                <div class="vehicle-card">
                    <div class="vehicle-card-header">
                        <span class="vehicle-name">🚗 ${v.name}</span>
                        <span class="vehicle-plate">${v.plate || '-'}</span>
                    </div>

                    <div style="display:flex; flex-wrap:wrap; gap:var(--space-2); margin-bottom:var(--space-3);">
                        ${belt.level !== 'ok' ? `
                            <span class="badge badge-${belt.level === 'danger' ? 'danger' : 'warning'}">
                                ${belt.level === 'danger' ? '🔴' : '🟡'} ${I18n.t('maint_timing_belt')}
                            </span>
                        ` : ''}
                        ${vtvBadge}
                        ${v.zonaBaseLabel ? `<span class="badge" style="font-size:0.7rem; background:var(--bg-tertiary); color:var(--text-secondary);">📍 ${v.zonaBaseLabel}</span>` : ''}
                    </div>

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
                            <button class="btn btn-ghost btn-sm" onclick="VehiclesModule.showVtvEditor('${v.id}')">
                                🔧 ${I18n.t('vtv_title')}
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

                <!-- RTO/VTV -->
                <div style="border-top:1px solid var(--border-color); padding-top:var(--space-4); margin-top:var(--space-2);">
                    <div style="font-weight:600; margin-bottom:var(--space-3); color:var(--color-primary);">
                        🔧 ${I18n.t('vtv_title')}
                    </div>
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label">${I18n.t('vtv_issue_date')}</label>
                            <input type="date" class="form-input" id="vehVtvIssue"
                                value="${vehicle?.vtvIssueDate || ''}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${I18n.t('vtv_expiry_date')}</label>
                            <input type="date" class="form-input" id="vehVtvExpiry"
                                value="${vehicle?.vtvExpiryDate || ''}">
                        </div>
                    </div>
                </div>

                <!-- Zona Base (GPS Geofencing) -->
                <div style="border-top:1px solid var(--border-color); padding-top:var(--space-4); margin-top:var(--space-2);">
                    <div style="font-weight:600; margin-bottom:var(--space-3); color:var(--color-primary);">
                        📍 Zona Base (Geofencing)
                    </div>
                    <div class="form-group">
                        <label class="form-label">Etiqueta de la zona</label>
                        <input type="text" class="form-input" id="vehZonaBaseLabel"
                            value="${vehicle?.zonaBaseLabel || ''}" placeholder="Domicilio Chofer - V.G. Gálvez"
                            style="background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                    </div>
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label">Latitud</label>
                            <input type="number" class="form-input" id="vehZonaBaseLat"
                                value="${vehicle?.zonaBaseLat || ''}" step="0.0001" placeholder="-33.0232"
                                style="background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Longitud</label>
                            <input type="number" class="form-input" id="vehZonaBaseLng"
                                value="${vehicle?.zonaBaseLng || ''}" step="0.0001" placeholder="-60.6389"
                                style="background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Radio (metros)</label>
                        <input type="number" class="form-input" id="vehZonaBaseRadius"
                            value="${vehicle?.zonaBaseRadiusM || 200}" placeholder="200"
                            style="background:#ffffff !important; color:#000000 !important; font-size:14px !important; font-weight:700 !important; border:2px solid #000000 !important;">
                    </div>
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
        const vtvIssueDate = document.getElementById('vehVtvIssue')?.value || null;
        const vtvExpiryDate = document.getElementById('vehVtvExpiry')?.value || null;

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

        // Zona Base (GPS Geofencing)
        const zonaBaseLabel = document.getElementById('vehZonaBaseLabel')?.value.trim();
        const zonaBaseLat = parseFloat(document.getElementById('vehZonaBaseLat')?.value);
        const zonaBaseLng = parseFloat(document.getElementById('vehZonaBaseLng')?.value);
        const zonaBaseRadiusM = parseInt(document.getElementById('vehZonaBaseRadius')?.value) || 200;

        if (zonaBaseLabel) data.zonaBaseLabel = zonaBaseLabel;
        if (!isNaN(zonaBaseLat)) data.zonaBaseLat = zonaBaseLat;
        if (!isNaN(zonaBaseLng)) data.zonaBaseLng = zonaBaseLng;
        data.zonaBaseRadiusM = zonaBaseRadiusM;

        if (vtvIssueDate) data.vtvIssueDate = vtvIssueDate;
        if (vtvExpiryDate) data.vtvExpiryDate = vtvExpiryDate;

        if (vehicleId && vehicleId !== '' && vehicleId !== 'null') {
            // Preservar datos existentes que no están en el form
            const existing = await DB.get('vehicles', vehicleId);
            if (existing) {
                if (!vtvIssueDate && existing.vtvIssueDate) data.vtvIssueDate = existing.vtvIssueDate;
                if (!vtvExpiryDate && existing.vtvExpiryDate) data.vtvExpiryDate = existing.vtvExpiryDate;
                // Preservar zona base si no se proporcionó
                if (!zonaBaseLabel && existing.zonaBaseLabel) data.zonaBaseLabel = existing.zonaBaseLabel;
                if (isNaN(zonaBaseLat) && existing.zonaBaseLat) data.zonaBaseLat = existing.zonaBaseLat;
                if (isNaN(zonaBaseLng) && existing.zonaBaseLng) data.zonaBaseLng = existing.zonaBaseLng;
                if (!data.zonaBaseRadiusM && existing.zonaBaseRadiusM) data.zonaBaseRadiusM = existing.zonaBaseRadiusM;
            }
            data.id = vehicleId;
            await DB.put('vehicles', data);
        } else {
            await DB.add('vehicles', data);
        }

        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        Router.navigate('vehicles');
    }

    // --- Editor RTO/VTV para vehículos existentes ---
    async function showVtvEditor(vehicleId) {
        const vehicle = await DB.get('vehicles', vehicleId);
        if (!vehicle) return;

        Components.showModal(
            `🔧 ${I18n.t('vtv_title')} — ${vehicle.name}`,
            `
                <div class="form-group">
                    <label class="form-label">${I18n.t('vtv_issue_date')} *</label>
                    <input type="date" class="form-input" id="editVtvIssue"
                        value="${vehicle.vtvIssueDate || ''}">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('vtv_expiry_date')} *</label>
                    <input type="date" class="form-input" id="editVtvExpiry"
                        value="${vehicle.vtvExpiryDate || ''}">
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="VehiclesModule.saveVtv('${vehicleId}')">${I18n.t('save')}</button>
            `
        );
    }

    async function saveVtv(vehicleId) {
        const issueDate = document.getElementById('editVtvIssue')?.value;
        const expiryDate = document.getElementById('editVtvExpiry')?.value;

        if (!issueDate || !expiryDate) {
            Components.showToast(I18n.t('vtv_required'), 'danger');
            return;
        }

        const vehicle = await DB.get('vehicles', vehicleId);
        if (!vehicle) return;

        vehicle.vtvIssueDate = issueDate;
        vehicle.vtvExpiryDate = expiryDate;

        await DB.put('vehicles', vehicle);
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

    return { render, showForm, saveVehicle, deleteVehicle, showVtvEditor, saveVtv, getVtvStatus };
})();
