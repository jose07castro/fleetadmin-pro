/* ============================================
   FleetAdmin Pro — Módulo de Turnos
   12 horas, fotos de odómetro y ganancias
   Privacidad: chofer solo ve su turno actual
   ============================================ */

const ShiftsModule = (() => {

    let shiftTimer = null;
    let selectedShiftType = 'day'; // 'day' o 'night'

    function selectShiftType(type) {
        selectedShiftType = type;
        document.querySelectorAll('.shift-type-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.type === type);
        });
    }

    async function render() {
        const role = Auth.getRole();
        const userId = Auth.getUserId();

        if (role === 'driver') {
            return await renderDriverView(userId);
        } else {
            return await renderOwnerView();
        }
    }

    // --- Vista del Chofer ---
    async function renderDriverView(driverId) {
        const vehicles = await DB.getAll('vehicles');
        const allShifts = await DB.getAllByIndex('shifts', 'driverId', driverId);
        const activeShift = allShifts.find(s => s.status === 'active');

        if (activeShift) {
            return renderActiveShift(activeShift, vehicles);
        }

        // Historial del chofer (solo sus turnos)
        const completed = allShifts.filter(s => s.status === 'completed')
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

        return `
            <div class="shift-status" style="justify-content:center; flex-direction:column; text-align:center;">
                <div style="font-size:2.5rem; margin-bottom:var(--space-3);">🕐</div>
                <div style="font-size:var(--font-size-lg); font-weight:600;">${I18n.t('shift_inactive')}</div>
            </div>

            <!-- Iniciar nuevo turno -->
            <div class="card" style="margin-bottom:var(--space-6);">
                <h3 style="margin-bottom:var(--space-4);">${I18n.t('shift_start')}</h3>

                <div class="form-group">
                    <label class="form-label">${I18n.t('shift_type')}</label>
                    <div class="role-selector" id="shiftTypeSelector" style="margin-bottom:var(--space-2);">
                        <button class="role-option shift-type-option selected" data-type="day" onclick="ShiftsModule.selectShiftType('day')">
                            <span class="role-icon">🌅</span>
                            <span class="role-label">06:00 - 18:00</span>
                        </button>
                        <button class="role-option shift-type-option" data-type="night" onclick="ShiftsModule.selectShiftType('night')">
                            <span class="role-icon">🌙</span>
                            <span class="role-label">18:00 - 06:00</span>
                        </button>
                    </div>
                </div>

                <div class="form-group">
                    <label class="form-label">${I18n.t('shift_select_vehicle')}</label>
                    <select class="form-select" id="shiftVehicle">
                        ${vehicles.map(v => `<option value="${v.id}">${v.name} — ${v.plate}</option>`).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">${I18n.t('shift_odometer_start')} (${Units.distanceLabel()})</label>
                    <input type="number" class="form-input" id="shiftOdometerStart"
                        placeholder="${I18n.t('shift_odometer_start')}" inputmode="numeric">
                </div>

                ${Components.renderPhotoCapture('shiftOdoStart', I18n.t('shift_odometer_photo'))}

                <button class="btn btn-success btn-block btn-lg" onclick="ShiftsModule.startShift()">
                    ▶️ ${I18n.t('shift_start')}
                </button>
            </div>

            <!-- Historial -->
            <div class="dashboard-section">
                <div class="dashboard-section-title">📋 ${I18n.t('shift_history')}</div>
                ${completed.length > 0 ? await renderShiftTable(completed) :
                `<p style="color:var(--text-tertiary);">${I18n.t('shift_no_history')}</p>`}
            </div>
        `;
    }

    // --- Turno activo ---
    function renderActiveShift(shift, vehicles) {
        const vehicle = vehicles.find(v => v.id === shift.vehicleId);
        const startTime = new Date(shift.startTime);
        const shiftDuration = 12 * 60 * 60 * 1000; // 12 horas en ms
        const endTime = new Date(startTime.getTime() + shiftDuration);
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        const elapsed = now - startTime;
        const progress = Math.min(100, (elapsed / shiftDuration) * 100);

        const hours = Math.floor(remaining / 3600000);
        const mins = Math.floor((remaining % 3600000) / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);

        const html = `
            <div class="shift-status">
                <div class="stat-icon success" style="width:48px;height:48px;">🟢</div>
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:var(--font-size-lg);">${I18n.t('shift_active')}</div>
                    <div style="color:var(--text-secondary); font-size:var(--font-size-sm);">
                        ${vehicle?.name || ''} — ${vehicle?.plate || ''}
                    </div>
                </div>
                <span class="badge ${shift.shiftType === 'night' ? 'badge-warning' : 'badge-success'}">
                    ${shift.shiftType === 'night' ? '🌙 18-06' : '🌅 06-18'}
                </span>
            </div>

            <div class="shift-timer">
                <div class="shift-timer-label">${I18n.t('shift_time_remaining')}</div>
                <div class="shift-timer-display" id="shiftTimerDisplay">
                    ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}
                </div>
                <div class="progress-bar" style="margin-top:var(--space-4);">
                    <div class="progress-fill ${progress > 90 ? 'danger' : progress > 75 ? 'warning' : ''}"
                        style="width:${progress}%"></div>
                </div>
                <div style="font-size:var(--font-size-xs); color:var(--text-tertiary); margin-top:var(--space-2);">
                    ${I18n.t('shift_odometer_start')}: ${Units.formatDistance(shift.startOdometer)}
                </div>
            </div>

            <!-- Finalizar turno -->
            <div class="card">
                <h3 style="margin-bottom:var(--space-4);">⏹️ ${I18n.t('shift_end')}</h3>

                <div class="form-group">
                    <label class="form-label">${I18n.t('shift_odometer_end')} (${Units.distanceLabel()})</label>
                    <input type="number" class="form-input" id="shiftOdometerEnd"
                        placeholder="${I18n.t('shift_odometer_end')}" inputmode="numeric">
                </div>

                ${Components.renderPhotoCapture('shiftOdoEnd', I18n.t('shift_odometer_photo'))}

                <div class="form-group">
                    <label class="form-label">${I18n.t('shift_earnings')} (${I18n.t('unit_currency')})</label>
                    <input type="number" class="form-input" id="shiftEarnings"
                        placeholder="0.00" step="0.01" inputmode="decimal">
                </div>

                ${Components.renderPhotoCapture('shiftEarningsPhoto', I18n.t('shift_earnings_photo'))}

                <button class="btn btn-danger btn-block btn-lg" onclick="ShiftsModule.endShift('${shift.id}')">
                    ⏹️ ${I18n.t('shift_end')}
                </button>
            </div>
        `;

        // Iniciar timer en tiempo real después de renderizar
        setTimeout(() => startTimer(shift), 100);

        return html;
    }

    // --- Vista del Dueño (todos los turnos) ---
    async function renderOwnerView() {
        const shifts = await DB.getAll('shifts');
        const activeShifts = shifts.filter(s => s.status === 'active');
        const completed = shifts.filter(s => s.status === 'completed')
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

        return `
            <!-- Turnos activos -->
            ${activeShifts.length > 0 ? `
                <div class="dashboard-section">
                    <div class="dashboard-section-title">🟢 ${I18n.t('dash_active_shifts')} (${activeShifts.length})</div>
                    ${await renderActiveShiftsCards(activeShifts)}
                </div>
            ` : `
                <div class="shift-status" style="justify-content:center; flex-direction:column; text-align:center;">
                    <div style="font-size:2rem; margin-bottom:var(--space-2);">😴</div>
                    <div style="color:var(--text-secondary);">${I18n.t('shift_inactive')}</div>
                </div>
            `}

            <!-- Historial completo -->
            <div class="dashboard-section">
                <div class="dashboard-section-title">📋 ${I18n.t('shift_history')}</div>
                ${completed.length > 0 ? await renderShiftTable(completed) :
                `<p style="color:var(--text-tertiary);">${I18n.t('shift_no_history')}</p>`}
            </div>
        `;
    }

    async function renderActiveShiftsCards(shifts) {
        let html = '<div class="content-grid">';
        for (const s of shifts) {
            const driver = await DB.get('users', s.driverId);
            const vehicle = await DB.get('vehicles', s.vehicleId);
            html += `
                <div class="card">
                    <div style="display:flex; align-items:center; gap:var(--space-3); margin-bottom:var(--space-3);">
                        <div class="stat-icon success">⏱️</div>
                        <div style="flex:1;">
                            <div style="font-weight:600;">${driver?.name || ''}</div>
                            <div style="font-size:var(--font-size-xs); color:var(--text-tertiary);">
                                ${vehicle?.name || ''} — ${vehicle?.plate || ''}
                            </div>
                        </div>
                        <span class="badge ${s.shiftType === 'night' ? 'badge-warning' : 'badge-success'}">
                            ${s.shiftType === 'night' ? '🌙 18-06' : '🌅 06-18'}
                        </span>
                    </div>
                    <div style="font-size:var(--font-size-xs); color:var(--text-secondary);">
                        ${I18n.t('shift_odometer_start')}: ${Units.formatDistance(s.startOdometer)} |
                        ${new Date(s.startTime).toLocaleString()}
                    </div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    }

    async function renderShiftTable(shifts) {
        // Resolver nombres de choferes
        let rows = '';
        for (const s of shifts.slice(0, 20)) {
            const driver = await DB.get('users', s.driverId);
            const driverName = driver?.name || '-';
            rows += `
                <tr>
                    <td data-label="${I18n.t('date')}">${new Date(s.startTime).toLocaleDateString()}</td>
                    <td data-label="${I18n.t('shift_type')}">${s.shiftType === 'night' ? '🌙' : '🌅'}</td>
                    <td data-label="${I18n.t('shift_driver')}">${driverName}</td>
                    <td data-label="${I18n.t('shift_odometer_start')}">${Units.formatDistance(s.startOdometer)}</td>
                    <td data-label="${I18n.t('shift_odometer_end')}">${s.endOdometer ? Units.formatDistance(s.endOdometer) : '-'}</td>
                    <td data-label="${I18n.t('shift_total_km')}">${s.endOdometer ? Units.formatDistance(s.endOdometer - s.startOdometer) : '-'}</td>
                    <td data-label="${I18n.t('shift_earnings')}">
                        ${Auth.isOwner() ? `${I18n.t('unit_currency')}${(s.earnings || 0).toLocaleString()}` : '-'}
                    </td>
                </tr>
            `;
        }

        return `
            <div class="data-table-wrapper">
                <table class="data-table data-table-responsive">
                    <thead>
                        <tr>
                            <th>${I18n.t('date')}</th>
                            <th>${I18n.t('shift_type')}</th>
                            <th>${I18n.t('shift_driver')}</th>
                            <th>${I18n.t('shift_odometer_start')}</th>
                            <th>${I18n.t('shift_odometer_end')}</th>
                            <th>${I18n.t('shift_total_km')}</th>
                            <th>${I18n.t('shift_earnings')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    }

    // --- Iniciar turno ---
    async function startShift() {
        const vehicleId = document.getElementById('shiftVehicle')?.value;
        const odoStart = parseFloat(document.getElementById('shiftOdometerStart')?.value);
        const photo = Components.getPhotoData('shiftOdoStart');

        if (!vehicleId || vehicleId === '' || !odoStart) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        const odometerKm = Units.toKm(odoStart);

        await DB.add('shifts', {
            vehicleId,
            driverId: Auth.getUserId(),
            shiftType: selectedShiftType,
            startTime: new Date().toISOString(),
            startOdometer: odometerKm,
            startOdometerPhoto: photo,
            status: 'active',
            earnings: 0
        });

        // Reset selector
        selectedShiftType = 'day';

        // Actualizar odómetro del vehículo
        const vehicle = await DB.get('vehicles', vehicleId);
        if (vehicle) {
            vehicle.currentOdometer = odometerKm;
            await DB.put('vehicles', vehicle);
        }

        Components.showToast(I18n.t('shift_start') + ' ✅', 'success');
        Router.navigate('shifts');
    }

    // --- Finalizar turno ---
    async function endShift(shiftId) {
        const odoEnd = parseFloat(document.getElementById('shiftOdometerEnd')?.value);
        const earnings = parseFloat(document.getElementById('shiftEarnings')?.value) || 0;
        const odoPhoto = Components.getPhotoData('shiftOdoEnd');
        const earningsPhoto = Components.getPhotoData('shiftEarningsPhoto');

        if (!odoEnd) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            return;
        }

        const odometerKm = Units.toKm(odoEnd);

        const shift = await DB.get('shifts', shiftId);
        if (shift) {
            shift.endTime = new Date().toISOString();
            shift.endOdometer = odometerKm;
            shift.endOdometerPhoto = odoPhoto;
            shift.earnings = earnings;
            shift.earningsPhoto = earningsPhoto;
            shift.status = 'completed';
            await DB.put('shifts', shift);

            // Actualizar odómetro del vehículo
            const vehicle = await DB.get('vehicles', shift.vehicleId);
            if (vehicle) {
                vehicle.currentOdometer = odometerKm;
                await DB.put('vehicles', vehicle);
            }
        }

        Components.showToast(I18n.t('shift_end') + ' ✅', 'success');
        Router.navigate('shifts');
    }

    // Timer de actualización en tiempo real
    function startTimer(shift) {
        if (shiftTimer) clearInterval(shiftTimer);

        const startTime = new Date(shift.startTime).getTime();
        const shiftDuration = 12 * 60 * 60 * 1000; // 12 horas en ms
        const endTime = startTime + shiftDuration;

        shiftTimer = setInterval(() => {
            const display = document.getElementById('shiftTimerDisplay');
            if (!display) {
                clearInterval(shiftTimer);
                return;
            }

            const now = Date.now();
            const remaining = Math.max(0, endTime - now);
            const elapsed = now - startTime;
            const progress = Math.min(100, (elapsed / shiftDuration) * 100);

            const hours = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            const secs = Math.floor((remaining % 60000) / 1000);

            // Actualizar contador
            display.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            // Actualizar barra de progreso
            const progressFill = document.querySelector('.progress-fill');
            if (progressFill) {
                progressFill.style.width = `${progress}%`;
                progressFill.className = `progress-fill ${progress > 90 ? 'danger' : progress > 75 ? 'warning' : ''}`;
            }

            // Si se terminó, detener
            if (remaining <= 0) {
                clearInterval(shiftTimer);
                display.textContent = '00:00:00';
                Components.showToast(I18n.t('alert_shift_ending', { minutes: '0' }), 'warning');
            }
        }, 1000);
    }

    return { render, startShift, endShift, selectShiftType };
})();
