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

        // Reparaciones Varias (Solo Owner y Mechanic)
        const role = Auth.getRole();
        if (role === 'owner' || role === 'mechanic') {
            const repairs = await DB.getAll('repairs');
            const userId = Auth.getUserId();

            const filteredRepairs = role === 'mechanic'
                ? repairs.filter(r => r.mechanicId === userId)
                : repairs;

            filteredRepairs.sort((a, b) => new Date(b.date) - new Date(a.date));
            const totalCost = filteredRepairs.reduce((sum, r) => sum + (r.cost || 0), 0);

            html += `
                <div class="dashboard-section" style="margin-top:var(--space-8);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-4);">
                        <div class="dashboard-section-title" style="margin-bottom:0;">🛠️ ${I18n.t('maint_repairs')}</div>
                        <button class="btn btn-primary btn-sm" onclick="MaintenanceModule.showRepairForm()">
                            ➕ ${I18n.t('mech_add_repair')}
                        </button>
                    </div>
                    
                    <div class="stats-grid" style="margin-bottom:var(--space-4);">
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

                    ${filteredRepairs.length > 0 ? await renderRepairTable(filteredRepairs, vehicles) :
                    Components.renderEmptyState('🔧', I18n.t('mech_no_history'))}
                </div>
            `;
        }

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

        // Lógica de Vencimiento de Aceite
        const currentOdo = vehicle.currentOdometer || 0;
        const nextOil = vehicle.nextOilChangeKm;
        
        let oilEstadoClase = "";
        let oilBotonTexto = "🛢️ Registrar Cambio de Aceite";
        let oilTextoEstatico = "";
        let oilMensajeResumen = "Faltan:";
        let diffAbs = 0;

        if (nextOil) {
            const kmRestantes = nextOil - currentOdo;
            diffAbs = Math.abs(kmRestantes);
            
            if (kmRestantes <= 0) {
                oilEstadoClase = "estado-critico";
                oilBotonTexto = "⚠️ SERVICE ACEITE VENCIDO";
                oilTextoEstatico = "texto-peligro-estatico";
                oilMensajeResumen = "⚠️ VENCIDO POR:";
            } else if (kmRestantes <= 500) {
                oilEstadoClase = "estado-alerta";
                oilBotonTexto = `⚠️ SERVICE EN ${Units.formatDistance(kmRestantes)}`;
                oilTextoEstatico = "texto-alerta-estatico";
                oilMensajeResumen = "Faltan:";
            } else {
                oilEstadoClase = "estado-ok";
                oilBotonTexto = "🛢️ Registrar Cambio de Aceite";
                oilTextoEstatico = "texto-ok-estatico";
                oilMensajeResumen = "Faltan:";
            }
        }

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
                    <div style="margin-top:var(--space-3);">
                        <button class="btn-mantenimiento btn-correa" onclick="MaintenanceModule.registerBeltChange('${vehicle.id}')">
                            🔄 ${I18n.t('maint_belt_register')}
                        </button>
                        <button class="btn-mantenimiento btn-aceite ${oilEstadoClase}" onclick="OilModule.registerOilChange('${vehicle.id}')">
                            ${oilBotonTexto}
                        </button>
                        
                        ${vehicle.nextOilChangeKm ? `
                        <div class="info-aceite-detalle">
                            <div class="alerta-km ${oilTextoEstatico}">
                                ${oilMensajeResumen} ${Units.formatDistance(diffAbs)}
                            </div>
                            
                            ${vehicle.ultimoAceiteTipo || vehicle.ultimoAceiteLitros ? `
                            <div class="datos-tecnicos">
                                <small>Último: ${vehicle.ultimoAceiteTipo || 'S/D'} (${vehicle.ultimoAceiteLitros}L)</small>
                                <div class="iconos-filtros">
                                    ${vehicle.filtroAceite ? '<span>🛢️ Aceite</span>' : ''}
                                    ${vehicle.filtroAire ? '<span>💨 Aire</span>' : ''}
                                    ${vehicle.filtroHabitaculo ? '<span>❄️ Habitáculo</span>' : ''}
                                </div>
                            </div>
                            ` : ''}
                        </div>
                        ` : ''}
                    </div>
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

        // Validar KM contra odómetro actual del vehículo según ROL
        const role = Auth.getRole();
        if (vehicle && vehicle.currentOdometer && odometerKm < vehicle.currentOdometer) {
            if (role === 'driver') {
                Components.showToast('El kilometraje no puede ser menor al actual. Por favor, verifica el tablero.', 'danger');
                return;
            } else {
                // Modales de confirmación para owner/admin no bloquean la ejecución si usamos promise o callback.
                // Sin embargo `Components.confirm` es asíncrono basado en callback, por lo que el flujo debe dividirse.
                // Refactor to handle Components.confirm cleanly:
                Components.confirm(
                    '¿Deseas que este registro actualice el odómetro actual del auto?',
                    async () => {
                        // Sí: Actualiza odómetro
                        await _finishSaveBeltChange(vehicleId, odometerKm, date, vehicle, true);
                    },
                    async () => {
                        // No: Guarda historial, no actualiza odómetro
                        await _finishSaveBeltChange(vehicleId, odometerKm, date, vehicle, false);
                    }
                );
                return; // Sale de la ejecución síncrona, el callback se encarga del resto
            }
        }

        // Ejecución normal si el KM >= al actual
        await _finishSaveBeltChange(vehicleId, odometerKm, date, vehicle, true);
    }

    async function _finishSaveBeltChange(vehicleId, odometerKm, date, vehicle, updateOdometer) {
        // Warning si es histórico
        if (updateOdometer === false || (vehicle && vehicle.currentOdometer && odometerKm < vehicle.currentOdometer)) {
            Components.showToast('Registrando mantenimiento histórico', 'warning');
        }

        await DB.add('beltChanges', {
            vehicleId,
            odometer: odometerKm,
            date: date || new Date().toISOString()
        });

        // Actualizar odómetro del vehículo si corresponde
        if (updateOdometer && vehicle && odometerKm > (vehicle.currentOdometer || 0)) {
            vehicle.currentOdometer = odometerKm;
            await DB.put('vehicles', vehicle);
        } else if (updateOdometer && vehicle && odometerKm < (vehicle.currentOdometer || 0)) {
            // El dueño puso "Sí" a actualizar un odómetro menor (ej. cambio de tablero)
            vehicle.currentOdometer = odometerKm;
            await DB.put('vehicles', vehicle);
        }

        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        Router.navigate('maintenance');
    }

    // --- Reparaciones Varias ---

    async function renderRepairTable(repairs, vehicles) {
        const users = await DB.getAll('users');
        const isOwner = Auth.isOwner();

        return `
            <div class="data-table-wrapper">
                <table class="data-table data-table-responsive">
                    <thead>
                        <tr>
                            <th>${I18n.t('date')}</th>
                            <th>${I18n.t('mech_vehicle')}</th>
                            ${isOwner ? `<th>${I18n.t('role_mechanic')}</th>` : ''}
                            <th>${I18n.t('mech_repair_desc')}</th>
                            <th>${I18n.t('veh_odometer')}</th>
                            <th>${I18n.t('mech_cost')}</th>
                            <th>${I18n.t('photo')}</th>
                            <th>${I18n.t('actions')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${repairs.map(r => {
            const vehicle = vehicles.find(v => v.id === r.vehicleId);
            const mechanic = users.find(u => u.id === r.mechanicId);
            const mechanicName = mechanic ? mechanic.name : '-';
            return `
                            <tr>
                                <td data-label="${I18n.t('date')}">${new Date(r.date).toLocaleDateString()}</td>
                                <td data-label="${I18n.t('mech_vehicle')}">${vehicle?.name || ''} ${vehicle?.plate || ''}</td>
                                ${isOwner ? `<td data-label="${I18n.t('role_mechanic')}">${mechanicName}</td>` : ''}
                                <td data-label="${I18n.t('mech_repair_desc')}">${r.description || '-'}</td>
                                <td data-label="${I18n.t('veh_odometer')}">${Units.formatDistance(r.odometer || 0)}</td>
                                <td data-label="${I18n.t('mech_cost')}">
                                    <div style="font-weight:600;">${I18n.t('unit_currency')}${(r.cost || 0).toLocaleString()}</div>
                                    ${r.laborCost !== undefined ? `
                                        <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">
                                            ${I18n.t('mech_labor_cost')}: ${I18n.t('unit_currency')}${r.laborCost.toLocaleString()}
                                        </div>
                                    ` : ''}
                                    ${r.parts && r.parts.length > 0 ? `
                                        <div style="font-size:0.75rem; color:var(--text-secondary);">
                                            ${I18n.t('mech_parts')} (${r.parts.length}): ${I18n.t('unit_currency')}${r.parts.reduce((s, p) => s + (p.cost || 0), 0).toLocaleString()}
                                        </div>
                                    ` : ''}
                                </td>
                                <td data-label="${I18n.t('photo')}">
                                    ${r.photo ? `<img src="${r.photo}" class="table-photo" onclick="Components.showModal('${I18n.t('photo')}', '<img src=\\'${r.photo}\\' style=\\'width:100%;border-radius:8px;\\'>')">` : '-'}
                                </td>
                                <td data-label="${I18n.t('actions')}">
                                    <button class="btn btn-ghost btn-sm" onclick="MaintenanceModule.editRepair('${r.id}')">✏️</button>
                                    <button class="btn btn-ghost btn-sm" onclick="MaintenanceModule.deleteRepair('${r.id}')">🗑️</button>
                                </td>
                            </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    function showRepairForm(repair = null) {
        Promise.all([
            DB.getAll('vehicles'),
            Auth.isOwner() ? DB.getAllByIndex('users', 'role', 'mechanic') : Promise.resolve([])
        ]).then(([vehicles, mechanics]) => {
            const isOwner = Auth.isOwner();
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
                    ${isOwner ? `
                    <div class="form-group">
                        <label class="form-label">${I18n.t('role_mechanic')}</label>
                        <select class="form-select" id="repairMechanic">
                            <option value="${Auth.getUserId()}">👤 Yo mismo / Administrador</option>
                            ${mechanics.map(m =>
                    `<option value="${m.id}" ${repair?.mechanicId === m.id ? 'selected' : ''}>
                                    🔧 ${m.name}
                                </option>`
                ).join('')}
                        </select>
                    </div>
                    ` : ''}
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label">${I18n.t('mech_odometer')} (${Units.distanceLabel()})</label>
                            <input type="number" class="form-input" id="repairOdometer"
                                value="${repair ? Units.displayDistance(repair.odometer || 0) : ''}"
                                inputmode="numeric">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${I18n.t('mech_labor_cost')} (${I18n.t('unit_currency')})</label>
                            <input type="number" class="form-input" id="repairLaborCost"
                                value="${repair?.laborCost !== undefined ? repair.laborCost : (repair?.cost || '')}" step="0.01" inputmode="decimal">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${I18n.t('date')}</label>
                            <input type="date" class="form-input" id="repairDate"
                                value="${repair?.date ? new Date(repair.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}">
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-2);">
                            <label class="form-label" style="margin-bottom:0;">${I18n.t('mech_parts')}</label>
                            <button class="btn btn-sm btn-ghost" type="button" onclick="MaintenanceModule.addPartRow()">➕ ${I18n.t('mech_add_part')}</button>
                        </div>
                        <div id="repairPartsContainer">
                            ${(() => {
                    if (repair?.parts && repair.parts.length > 0) {
                        return repair.parts.map(p => `
                                        <div class="part-row" style="display:flex; gap:var(--space-2); margin-bottom:var(--space-2); align-items:center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: var(--space-2);">
                                            <input type="text" class="form-input part-name" placeholder="${I18n.t('mech_part_name')}" value="${p.name}">
                                            <input type="number" class="form-input part-cost" placeholder="${I18n.t('unit_currency')} ${I18n.t('mech_part_cost')}" value="${p.cost}" step="0.01" style="width:100px;" inputmode="decimal">
                                            <button class="btn btn-icon btn-danger" type="button" onclick="MaintenanceModule.removePartRow(this)" title="${I18n.t('delete')}">✕</button>
                                        </div>
                                    `).join('');
                    } else if (repair?.description) {
                        // Soporte para reparaciones antiguas que solo tenían texto de descripción
                        return `
                                        <div class="part-row" style="display:flex; gap:var(--space-2); margin-bottom:var(--space-2); align-items:center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: var(--space-2);">
                                            <input type="text" class="form-input part-name" placeholder="${I18n.t('mech_part_name')}" value="${repair.description}">
                                            <input type="number" class="form-input part-cost" placeholder="${I18n.t('unit_currency')} ${I18n.t('mech_part_cost')}" value="${repair.cost || ''}" step="0.01" style="width:100px;" inputmode="decimal">
                                            <button class="btn btn-icon btn-danger" type="button" onclick="MaintenanceModule.removePartRow(this)" title="${I18n.t('delete')}">✕</button>
                                        </div>
                                    `;
                    } else {
                        // Por defecto una vacía
                        return `
                                        <div class="part-row" style="display:flex; gap:var(--space-2); margin-bottom:var(--space-2); align-items:center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: var(--space-2);">
                                            <input type="text" class="form-input part-name" placeholder="${I18n.t('mech_part_name')}" value="">
                                            <input type="number" class="form-input part-cost" placeholder="${I18n.t('unit_currency')} ${I18n.t('mech_part_cost')}" value="" step="0.01" style="width:100px;" inputmode="decimal">
                                            <button class="btn btn-icon btn-danger" type="button" onclick="MaintenanceModule.removePartRow(this)" title="${I18n.t('delete')}">✕</button>
                                        </div>
                                    `;
                    }
                })()}
                        </div>
                    </div>
                    ${Components.renderPhotoCapture('repairPhoto', I18n.t('mech_photos'))}
                `,
                `
                    <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                    <button class="btn btn-primary" onclick="MaintenanceModule.saveRepair('${repair?.id || ''}')">${I18n.t('save')}</button>
                `
            );
        });
    }

    async function saveRepair(repairId) {
        const vehicleId = document.getElementById('repairVehicle')?.value;
        const odometer = parseFloat(document.getElementById('repairOdometer')?.value) || 0;
        const laborCost = parseFloat(document.getElementById('repairLaborCost')?.value) || 0;
        const date = document.getElementById('repairDate')?.value;
        const rawPhoto = Components.getPhotoData('repairPhoto');
        const mechanicId = Auth.isOwner() ? (document.getElementById('repairMechanic')?.value || Auth.getUserId()) : Auth.getUserId();

        const partRows = document.querySelectorAll('#repairPartsContainer .part-row');
        const parts = [];
        let partsTotalCost = 0;
        let descriptionParts = [];

        partRows.forEach(row => {
            const nameInput = row.querySelector('.part-name');
            const costInput = row.querySelector('.part-cost');
            if (!nameInput) return; // fail-safe para posibles remociones raras

            const name = nameInput.value.trim();
            const cost = parseFloat(costInput.value) || 0;
            if (name) {
                parts.push({ name, cost });
                partsTotalCost += cost;
                descriptionParts.push(name);
            }
        });

        // Validar que al menos haya un ítem de reparación
        if (!vehicleId || vehicleId === '' || parts.length === 0) {
            Components.showToast(I18n.t('error') + ': Ingrese vehículo y al menos un detalle de reparación', 'danger');
            return;
        }

        const totalCost = laborCost + partsTotalCost;
        const description = descriptionParts.join(', '); // Retro-compatibilidad de descripción texto string
        const odometerKm = Units.toKm(odometer);

        // ── Subir foto a Firebase Storage (NO guardar Base64 en DB) ──
        let photoURL = null;
        if (rawPhoto && rawPhoto.startsWith('data:')) {
            try {
                Components.showToast('📤 Subiendo foto de reparación...', 'info');
                const fleetId = Auth.getFleetId() || 'default';
                const ts = Date.now();
                const path = `repairs/${fleetId}/${vehicleId}_${ts}.jpg`;
                photoURL = await StorageUtil.uploadImage(rawPhoto, path);
                console.log('✅ Foto de reparación subida a Storage:', photoURL);
            } catch (uploadErr) {
                console.error('❌ Error subiendo foto de reparación:', uploadErr);
                Components.showToast('⚠️ No se pudo subir la foto, se guardará sin imagen.', 'warning');
            }
        }

        const data = {
            vehicleId,
            mechanicId: mechanicId,
            description,
            odometer: odometerKm,
            cost: totalCost,
            laborCost,
            parts,
            date: date || new Date().toISOString()
        };
        // Solo incluir photo si se subió exitosamente (mantener payload liviano)
        if (photoURL) data.photo = photoURL;

        console.log('📦 JSON PAYLOAD REPARACIÓN COMPLETO: ', JSON.stringify(data, null, 2));

        // Validar KM contra odómetro actual del vehículo según ROL
        const role = Auth.getRole();
        const vehicle = await DB.get('vehicles', vehicleId);

        if (vehicle && vehicle.currentOdometer && odometerKm < vehicle.currentOdometer) {
            if (role === 'driver') {
                Components.showToast('El kilometraje no puede ser menor al actual. Por favor, verifica el tablero.', 'danger');
                return;
            } else {
                Components.confirm(
                    '¿Deseas que este registro actualice el odómetro actual del auto?',
                    async () => {
                        await _finishSaveRepair(repairId, data, vehicle, odometerKm, true);
                    },
                    async () => {
                        await _finishSaveRepair(repairId, data, vehicle, odometerKm, false);
                    }
                );
                return;
            }
        }

        // Ejecución normal
        await _finishSaveRepair(repairId, data, vehicle, odometerKm, true);
    }

    async function _finishSaveRepair(repairId, data, vehicle, odometerKm, updateOdometer) {
        if (updateOdometer === false || (vehicle && vehicle.currentOdometer && odometerKm < vehicle.currentOdometer)) {
            Components.showToast('Registrando mantenimiento histórico', 'warning');
        }

        if (repairId && repairId !== '' && repairId !== 'null') {
            data.id = repairId;
            await DB.put('repairs', data);
        } else {
            await DB.add('repairs', data);
        }

        // Actualizar odómetro si corresponde
        if (updateOdometer && vehicle && odometerKm > (vehicle.currentOdometer || 0)) {
            vehicle.currentOdometer = odometerKm;
            await DB.put('vehicles', vehicle);
        } else if (updateOdometer && vehicle && odometerKm < (vehicle.currentOdometer || 0)) {
            vehicle.currentOdometer = odometerKm;
            await DB.put('vehicles', vehicle);
        }

        Components.closeModal();
        Components.showToast(I18n.t('success') + ' ✅', 'success');
        Router.navigate('maintenance');
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
                Router.navigate('maintenance');
            }
        );
    }

    function addPartRow() {
        const container = document.getElementById('repairPartsContainer');
        const row = document.createElement('div');
        row.className = 'part-row';
        row.style.cssText = 'display:flex; gap:var(--space-2); margin-bottom:var(--space-2); align-items:center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: var(--space-2);';
        row.innerHTML = `
        <input type="text" class="form-input part-name" placeholder="${I18n.t('mech_part_name')}">
        <input type="number" class="form-input part-cost" placeholder="${I18n.t('unit_currency')} ${I18n.t('mech_part_cost')}" step="0.01" style="width:100px;" inputmode="decimal">
        <button class="btn btn-icon btn-danger" type="button" onclick="MaintenanceModule.removePartRow(this)" title="${I18n.t('delete')}">✕</button>
    `;
        container.appendChild(row);
    }
    function removePartRow(btn) {
        btn.parentElement.remove();
    }

    return { render, registerBeltChange, saveBeltChange, renderRepairTable, showRepairForm, saveRepair, editRepair, deleteRepair, addPartRow, removePartRow };
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

        const html = `
            <!-- Formulario de registro -->
            <div class="card" style="margin-bottom:var(--space-6);">
                <h3 style="margin-bottom:var(--space-4);">🛢️ ${I18n.t('oil_add')}</h3>

                <div class="repair-form-grid">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('mech_vehicle')}</label>
                        <select class="form-select" id="oilVehicle" onchange="OilModule.prefillOdometer()">
                            ${vehicles.map(v => `<option value="${v.id}">${v.name} — ${v.plate}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('oil_odometer')} (${Units.distanceLabel()})</label>
                        <input type="number" class="form-input" id="oilOdometer"
                            placeholder="${I18n.t('veh_odometer')}" inputmode="numeric">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('oil_quantity')} (${Units.volumeLabel()})</label>
                        <input type="number" class="form-input" id="oilQuantity"
                            placeholder="0.5" step="0.1" inputmode="decimal">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Tipo de Aceite</label>
                        <input type="text" class="form-input" id="oilType" placeholder="Ej: 10W-40 Sintético">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('date')}</label>
                        <input type="date" class="form-input" id="oilDate" value="${new Date().toISOString().split('T')[0]}">
                    </div>
                </div>

                <!-- Filtros cambiados -->
                <div style="font-weight:600; margin-top:var(--space-3); margin-bottom:var(--space-2);">Filtros Cambiados</div>
                <div class="form-group" style="display:flex; flex-direction:column; gap:var(--space-2);">
                    <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer;">
                        <input type="checkbox" id="oilFilterOil"> Filtro de Aceite
                    </label>
                    <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer;">
                        <input type="checkbox" id="oilFilterAir"> Filtro de Aire
                    </label>
                    <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer;">
                        <input type="checkbox" id="oilFilterCabin"> Filtro de Habitáculo
                    </label>
                </div>

                <!-- Checkbox de cambio completo de aceite -->
                <div class="form-group" style="margin-top:var(--space-3);">
                    <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer;">
                        <input type="checkbox" id="oilIsChange" onchange="OilModule.toggleOilChange()">
                        <span style="font-weight:600;">🔄 ${I18n.t('oil_change')}</span>
                    </label>
                </div>
                <div id="oilChangeSection" style="display:none; margin-top:var(--space-3);">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('oil_next_change_km')} (${Units.distanceLabel()})</label>
                        <input type="number" class="form-input" id="oilNextChangeKm"
                            placeholder="${I18n.t('oil_next_change_km')}" inputmode="numeric">
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

        // Pre-llenar el KM del primer vehículo después de renderizar
        setTimeout(() => OilModule.prefillOdometer(), 150);

        return html;
    }

    async function renderOilTable(logs) {
        // Resolver nombres de vehículos y choferes
        let rows = '';
        for (const l of logs) {
            const vehicle = await DB.get('vehicles', l.vehicleId);
            const driver = l.driverId ? await DB.get('users', l.driverId) : null;
            const vehName = vehicle ? `${vehicle.name} — ${vehicle.plate || ''}` : `#${l.vehicleId}`;
            const driverName = l.driverName || driver?.name || driver?.email || '-';
            rows += `
                <tr>
                    <td data-label="${I18n.t('date')}">${new Date(l.date).toLocaleDateString()}</td>
                    <td data-label="${I18n.t('mech_vehicle')}">
                        <div style="font-weight:bold;">${vehName}</div>
                        ${l.odometer ? `<div style="font-size:0.8em; color:var(--text-secondary);">Odómetro: ${l.odometer.toLocaleString()} KM</div>` : ''}
                    </td>
                    <td data-label="Detalles">
                        <div><span style="font-weight:600;">${Units.formatVolume(l.quantity || l.litros)}</span> ${(l.oilType || l.tipo_aceite) ? `| Tipo: ${l.oilType || l.tipo_aceite}` : ''}</div>
                        ${(l.filterOil || l.filterAir || l.filterCabin || l.filtros_check) ? `
                        <div style="font-size:0.8em; color:var(--text-secondary); margin-top:2px;">
                            Filtros: ${l.filterOil || (l.filtros_check && l.filtros_check.aceite) ? '🛢️Aceite ' : ''}${l.filterAir || (l.filtros_check && l.filtros_check.aire) ? '💨Aire ' : ''}${l.filterCabin || (l.filtros_check && l.filtros_check.habitaculo) ? '❄️Hab. ' : ''}
                        </div>` : ''}
                    </td>
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
                            <th>Detalles y Filtros</th>
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

    function toggleOilChange() {
        const isChange = document.getElementById('oilIsChange')?.checked;
        const section = document.getElementById('oilChangeSection');
        if (section) section.style.display = isChange ? 'block' : 'none';
    }

    async function saveOilLog() {
        const vehicleId = document.getElementById('oilVehicle')?.value;
        const odometerInput = parseFloat(document.getElementById('oilOdometer')?.value);
        const quantity = parseFloat(document.getElementById('oilQuantity')?.value);
        const oilType = document.getElementById('oilType')?.value?.trim() || '';
        const date = document.getElementById('oilDate')?.value;
        const rawPhoto = Components.getPhotoData('oilPhoto');
        const isChange = document.getElementById('oilIsChange')?.checked;
        const nextChangeKmInput = parseFloat(document.getElementById('oilNextChangeKm')?.value);

        const filterOil = document.getElementById('oilFilterOil')?.checked || false;
        const filterAir = document.getElementById('oilFilterAir')?.checked || false;
        const filterCabin = document.getElementById('oilFilterCabin')?.checked || false;

        if (!vehicleId || vehicleId === '' || !quantity) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        const quantityLiters = Units.toLiters(quantity);
        const odometerKm = odometerInput ? Units.toKm(odometerInput) : null;

        // ── Subir foto a Firebase Storage (NO guardar Base64 en DB) ──
        let photoURL = null;
        if (rawPhoto && rawPhoto.startsWith('data:')) {
            try {
                Components.showToast('📤 Subiendo foto de aceite...', 'info');
                const fleetId = Auth.getFleetId() || 'default';
                const ts = Date.now();
                const path = `oilLogs/${fleetId}/${vehicleId}_${ts}.jpg`;
                photoURL = await StorageUtil.uploadImage(rawPhoto, path);
                console.log('✅ Foto de aceite subida a Storage:', photoURL);
            } catch (uploadErr) {
                console.error('❌ Error subiendo foto de aceite:', uploadErr);
                Components.showToast('⚠️ No se pudo subir la foto, se guardará sin imagen.', 'warning');
            }
        }

        const logData = {
            vehicleId,
            driverId: Auth.getUserId() || 'unknown',
            driverName: Auth.getUserName() || 'Conductor',
            quantity: quantityLiters || 0,
            litros: quantityLiters || 0,
            fecha_service: date || new Date().toISOString(),
            date: date || new Date().toISOString(),
            tipo_aceite: oilType || 'No especificado',
            oilType: oilType || 'No especificado',
            filtros_check: {
                aceite: !!filterOil,
                aire: !!filterAir,
                habitaculo: !!filterCabin
            },
            filterOil: !!filterOil,
            filterAir: !!filterAir,
            filterCabin: !!filterCabin
        };
        // Solo incluir photo si se subió exitosamente (mantener payload liviano)
        if (photoURL) logData.photo = photoURL;

        if (odometerKm !== null) logData.odometer = odometerKm;
        if (isChange) logData.type = 'change';

        console.log('📦 JSON PAYLOAD ACEITE (formulario principal): ', JSON.stringify(logData, null, 2));

        // Validar KM contra odómetro actual del vehículo según ROL
        const role = Auth.getRole();
        let vehicle = null;
        
        if (odometerKm !== null) {
            vehicle = await DB.get('vehicles', vehicleId);
            if (vehicle && vehicle.currentOdometer && odometerKm < vehicle.currentOdometer) {
                if (role === 'driver') {
                    Components.showToast('El kilometraje no puede ser menor al actual. Por favor, verifica el tablero.', 'danger');
                    return;
                } else {
                    Components.confirm(
                        '¿Deseas que este registro actualice el odómetro actual del auto?',
                        async () => {
                            await _finishSaveOilLog(logData, vehicle, odometerKm, isChange, nextChangeKmInput, true);
                        },
                        async () => {
                            await _finishSaveOilLog(logData, vehicle, odometerKm, isChange, nextChangeKmInput, false);
                        }
                    );
                    return;
                }
            }
        } else if (isChange && nextChangeKmInput) {
             vehicle = await DB.get('vehicles', vehicleId);
        }

        await _finishSaveOilLog(logData, vehicle, odometerKm, isChange, nextChangeKmInput, true);
    }

    async function _finishSaveOilLog(logData, vehicle, odometerKm, isChange, nextChangeKmInput, updateOdometer) {
        if (updateOdometer === false || (vehicle && vehicle.currentOdometer && odometerKm !== null && odometerKm < vehicle.currentOdometer)) {
            Components.showToast('Registrando mantenimiento histórico', 'warning');
        }

        await DB.add('oilLogs', logData);

        // Si es cambio completo, guardar nextOilChangeKm en el vehículo
        if (isChange && nextChangeKmInput && vehicle) {
            vehicle.nextOilChangeKm = Units.toKm(nextChangeKmInput);
            vehicle.ultimoAceiteTipo = logData.tipo_aceite || logData.oilType || '';
            vehicle.ultimoAceiteLitros = logData.litros || logData.quantity || 0;
            vehicle.filtroAceite = (logData.filtros_check && logData.filtros_check.aceite) || logData.filterOil || false;
            vehicle.filtroAire = (logData.filtros_check && logData.filtros_check.aire) || logData.filterAir || false;
            vehicle.filtroHabitaculo = (logData.filtros_check && logData.filtros_check.habitaculo) || logData.filterCabin || false;
            if (updateOdometer && odometerKm !== null && odometerKm > (vehicle.currentOdometer || 0)) {
                vehicle.currentOdometer = odometerKm;
            } else if (updateOdometer && odometerKm !== null && odometerKm < (vehicle.currentOdometer || 0)) {
                vehicle.currentOdometer = odometerKm;
            }
            await DB.put('vehicles', vehicle);
        } else if (odometerKm !== null && vehicle) {
            // Actualizar odómetro si corresponde
            if (updateOdometer && odometerKm > (vehicle.currentOdometer || 0)) {
                vehicle.currentOdometer = odometerKm;
                await DB.put('vehicles', vehicle);
            } else if (updateOdometer && odometerKm < (vehicle.currentOdometer || 0)) {
                vehicle.currentOdometer = odometerKm;
                await DB.put('vehicles', vehicle);
            }
        }

        Components.showToast(I18n.t('success') + ' ✅', 'success');
        
        // Redirigir según desde dónde se haya lanzado
        const currentHash = window.location.hash;
        if (currentHash.includes('maintenance')) {
            Router.navigate('maintenance');
        } else {
            Router.navigate('oil');
        }
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

    // --- Pre-llenar KM del vehículo seleccionado ---
    async function prefillOdometer() {
        const vehicleId = document.getElementById('oilVehicle')?.value;
        if (!vehicleId) return;
        const vehicle = await DB.get('vehicles', vehicleId);
        const odometerField = document.getElementById('oilOdometer');
        if (vehicle && vehicle.currentOdometer && odometerField) {
            odometerField.value = Units.displayDistance(vehicle.currentOdometer);
        } else if (odometerField) {
            odometerField.value = '';
        }
    }

    async function registerOilChange(vehicleId) {
        const vehicle = await DB.get('vehicles', vehicleId);
        if (!vehicle) return;

        Components.showModal(
            '🛢️ Registrar Cambio de Aceite',
            `
                <div class="form-group">
                    <label class="form-label">${I18n.t('veh_odometer')}</label>
                    <input type="number" class="form-input" id="oilModalOdometer" inputmode="numeric"
                        value="${vehicle.currentOdometer ? Units.displayDistance(vehicle.currentOdometer) : ''}"
                        oninput="OilModule.calcNextChange()">
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('oil_next_change_km')}</label>
                    <input type="number" class="form-input" id="oilModalNextChange" inputmode="numeric"
                        value="${vehicle.currentOdometer ? Units.displayDistance(vehicle.currentOdometer) + 10000 : 10000}">
                </div>
                <div class="repair-form-grid">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('oil_quantity')} (${Units.volumeLabel()})</label>
                        <input type="number" class="form-input" id="oilModalQuantity" step="0.1" inputmode="decimal" placeholder="4.0">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Tipo de Aceite</label>
                        <input type="text" class="form-input" id="oilModalType" placeholder="Ej: 10W-40 Sintético">
                    </div>
                </div>
                
                <div style="font-weight:600; margin-top:var(--space-3); margin-bottom:var(--space-2);">Filtros Cambiados</div>
                <div class="form-group" style="display:flex; flex-direction:column; gap:var(--space-2);">
                    <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer;">
                        <input type="checkbox" id="oilModalFilterOil"> Filtro de Aceite
                    </label>
                    <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer;">
                        <input type="checkbox" id="oilModalFilterAir"> Filtro de Aire
                    </label>
                    <label style="display:flex; align-items:center; gap:var(--space-2); cursor:pointer;">
                        <input type="checkbox" id="oilModalFilterCabin"> Filtro de Habitáculo
                    </label>
                </div>
                
                <div class="form-group" style="margin-top:var(--space-3); margin-bottom:var(--space-3);">
                    <label class="form-label">${I18n.t('date')}</label>
                    <input type="date" class="form-input" id="oilModalDate" value="${new Date().toISOString().split('T')[0]}">
                </div>

                ${Components.renderPhotoCapture('oilModalPhoto', 'Subir foto del comprobante/ticket (Opcional)')}
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="OilModule.saveOilChangeFromModal('${vehicleId}')">${I18n.t('save')}</button>
            `
        );
    }

    function calcNextChange() {
        const odo = parseFloat(document.getElementById('oilModalOdometer')?.value) || 0;
        const next = document.getElementById('oilModalNextChange');
        if (next) {
            next.value = odo + 10000;
        }
    }

    async function saveOilChangeFromModal(vehicleId) {
        // ======================================================
        // PASO 1: Captura directa de cada input del modal
        // ======================================================
        const elOdometer = document.getElementById('oilModalOdometer');
        const elNextChange = document.getElementById('oilModalNextChange');
        const elQuantity = document.getElementById('oilModalQuantity');
        const elType = document.getElementById('oilModalType');
        const elDate = document.getElementById('oilModalDate');
        const elFilterOil = document.getElementById('oilModalFilterOil');
        const elFilterAir = document.getElementById('oilModalFilterAir');
        const elFilterCabin = document.getElementById('oilModalFilterCabin');

        // Debug: verificar que los elementos existen
        console.log('🔍 INPUTS ENCONTRADOS:', {
            oilModalOdometer: !!elOdometer,
            oilModalNextChange: !!elNextChange,
            oilModalQuantity: !!elQuantity,
            oilModalType: !!elType,
            oilModalDate: !!elDate,
            oilModalFilterOil: !!elFilterOil,
            oilModalFilterAir: !!elFilterAir,
            oilModalFilterCabin: !!elFilterCabin
        });

        // ======================================================
        // PASO 2: Extraer valores RAW (sin transformar)
        // ======================================================
        const rawOdometer = elOdometer ? elOdometer.value : '';
        const rawNextChange = elNextChange ? elNextChange.value : '';
        const rawQuantity = elQuantity ? elQuantity.value : '';
        const rawType = elType ? elType.value.trim() : '';
        const rawDate = elDate ? elDate.value : '';
        const rawFilterOil = elFilterOil ? elFilterOil.checked : false;
        const rawFilterAir = elFilterAir ? elFilterAir.checked : false;
        const rawFilterCabin = elFilterCabin ? elFilterCabin.checked : false;
        const rawPhoto = Components.getPhotoData('oilModalPhoto');

        console.log('📋 VALORES RAW CAPTURADOS:', {
            rawOdometer, rawNextChange, rawQuantity, rawType,
            rawDate, rawFilterOil, rawFilterAir, rawFilterCabin,
            rawPhoto: rawPhoto ? '(foto capturada)' : '(sin foto)'
        });

        // ======================================================
        // PASO 3: Validación
        // ======================================================
        const quantity = parseFloat(rawQuantity);
        if (!quantity || isNaN(quantity)) {
            Components.showToast('⚠️ Falta la cantidad de litros.', 'danger');
            return;
        }

        // ======================================================
        // PASO 4: Conversión de unidades
        // ======================================================
        const quantityLiters = Units.toLiters(quantity);
        const odometerKm = rawOdometer ? Units.toKm(parseFloat(rawOdometer)) : null;
        const nextChangeKm = rawNextChange ? Units.toKm(parseFloat(rawNextChange)) : null;

        // ======================================================
        // PASO 5: Subir foto a Firebase Storage (NO Base64 en DB)
        // ======================================================
        let photoURL = null;
        if (rawPhoto && rawPhoto.startsWith('data:')) {
            try {
                Components.showToast('📤 Subiendo foto del cambio de aceite...', 'info');
                const fleetId = Auth.getFleetId() || 'default';
                const ts = Date.now();
                const path = `oilLogs/${fleetId}/${vehicleId}_modal_${ts}.jpg`;
                photoURL = await StorageUtil.uploadImage(rawPhoto, path);
                console.log('✅ Foto de cambio aceite (modal) subida a Storage:', photoURL);
            } catch (uploadErr) {
                console.error('❌ Error subiendo foto de cambio aceite (modal):', uploadErr);
                Components.showToast('⚠️ No se pudo subir la foto, se guardará sin imagen.', 'warning');
            }
        }

        // ======================================================
        // PASO 6: Construir objeto COMPLETO para Firebase (liviano, sin Base64)
        // ======================================================
        const logData = {
            vehicleId: vehicleId,
            driverId: Auth.getUserId() || 'unknown',
            driverName: Auth.getUserName() || 'Conductor',
            odometer: odometerKm || 0,
            nextOilChangeKm: nextChangeKm || 0,
            quantity: quantityLiters,
            litros: quantityLiters,
            tipo_aceite: rawType || 'No especificado',
            oilType: rawType || 'No especificado',
            filterOil: rawFilterOil,
            filterAir: rawFilterAir,
            filterCabin: rawFilterCabin,
            filtros_check: {
                aceite: rawFilterOil,
                aire: rawFilterAir,
                habitaculo: rawFilterCabin
            },
            date: rawDate || new Date().toISOString().split('T')[0],
            fecha_service: rawDate || new Date().toISOString().split('T')[0],
            type: 'change',
            timestamp: new Date().toISOString()
        };
        // Solo incluir photo si se subió exitosamente (mantener payload liviano)
        if (photoURL) logData.photo = photoURL;

        // ======================================================
        // PASO 7: LOG FINAL — este es el objeto que va a Firebase
        // ======================================================
        console.log('🚀 ENVIANDO A FIREBASE (DB.add oilLogs):', JSON.stringify(logData, null, 2));

        // ======================================================
        // PASO 8: Guardar en Firebase con try/catch
        // ======================================================
        try {
            const newId = await DB.add('oilLogs', logData);
            console.log('✅ GUARDADO EXITOSO en oilLogs. ID:', newId);
        } catch (err) {
            console.error('❌ ERROR GUARDANDO EN FIREBASE:', err);
            Components.showToast('❌ Error guardando: ' + err.message, 'danger');
            return;
        }

        // ======================================================
        // PASO 9: Actualizar vehículo (odómetro + datos de aceite)
        // ======================================================
        try {
            let vehicle = await DB.get('vehicles', vehicleId);
            if (vehicle) {
                if (nextChangeKm) vehicle.nextOilChangeKm = nextChangeKm;
                if (odometerKm && odometerKm >= (vehicle.currentOdometer || 0)) {
                    vehicle.currentOdometer = odometerKm;
                }
                vehicle.ultimoAceiteTipo = rawType || '';
                vehicle.ultimoAceiteLitros = quantityLiters;
                vehicle.filtroAceite = rawFilterOil;
                vehicle.filtroAire = rawFilterAir;
                vehicle.filtroHabitaculo = rawFilterCabin;
                await DB.put('vehicles', vehicle);
                console.log('✅ VEHÍCULO ACTUALIZADO:', vehicleId);
            }
        } catch (err) {
            console.error('⚠️ Error actualizando vehículo (no crítico):', err);
        }

        // ======================================================
        // PASO 10: Cerrar modal y redirigir
        // ======================================================
        Components.closeModal();
        Components.showToast('✅ Cambio de aceite registrado correctamente', 'success');

        const currentHash = window.location.hash;
        if (currentHash.includes('maintenance')) {
            Router.navigate('maintenance');
        } else {
            Router.navigate('oil');
        }
    }

    return { render, saveOilLog, deleteOilLog, toggleOilChange, prefillOdometer, registerOilChange, calcNextChange, saveOilChangeFromModal };
})();
