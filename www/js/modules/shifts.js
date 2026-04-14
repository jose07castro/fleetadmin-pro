/* ============================================
   FleetAdmin Pro — Módulo de Turnos
   12 horas, fotos de odómetro y ganancias
   Privacidad: chofer solo ve su turno actual
   ============================================ */

const ShiftsModule = (() => {

    let shiftTimer = null;
    let selectedShiftType = 'day'; // 'day' o 'night'
    let _activeShiftId = null;
    let _activeVehicleId = null;
    let _activeVehicleName = '';

    function selectShiftType(type) {
        selectedShiftType = type;
        document.querySelectorAll('.shift-type-option').forEach(el => {
            el.classList.toggle('selected', el.dataset.type === type);
        });
    }

    // --- RENDER TRADICIONAL: fetch datos async, devolver HTML completo ---
    async function render() {
        const role = Auth.getRole();
        const userId = Auth.getUserId();

        try {
            if (role === 'driver') {
                return await renderDriverView(userId);
            } else {
                return await renderOwnerView();
            }
        } catch (e) {
            console.error('⏱️ Shifts: render error:', e);
            return `
                <div style="text-align:center; padding:var(--space-8);">
                    <div style="font-size:3rem; margin-bottom:var(--space-4);">⚠️</div>
                    <h3>Error cargando turnos</h3>
                    <p style="color:var(--text-secondary); margin-top:var(--space-2);">${e.message || 'Error de conexión'}</p>
                    <button class="btn btn-primary" onclick="Router.navigate('shifts')" style="margin-top:var(--space-4);">🔄 Reintentar</button>
                </div>`;
        }
    }

    // --- Limpieza de Clones (Race Condition) ---
    async function cleanupDuplicateShifts(driverId) {
        const activeShifts = await DB.getActiveShifts();
        const driverActiveShifts = activeShifts.filter(s => String(s.driverId) === String(driverId));
        
        if (driverActiveShifts.length > 1) {
            console.warn(`🚨 MULTIPLES TURNOS ACTIVOS DETECTADOS para chofer ${driverId}. Limpiando clones...`);
            // Ordenar por fecha (el más reciente primero)
            driverActiveShifts.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
            
            const keepShift = driverActiveShifts[0]; // Mantener el más actual
            const duplicates = driverActiveShifts.slice(1);
            
            for (const dup of duplicates) {
                console.log(`🧹 Eliminando turno clon: ${dup.id}`);
                await DB.remove('shifts', dup.id);
            }
            return keepShift;
        }
        return driverActiveShifts[0]; // Retorna el único activo, o undefined
    }

    // --- Vista del Chofer ---
    async function renderDriverView(driverId) {
        // LAZY LOADING: Devolver esqueleto inmediatamente
        setTimeout(() => _hydratedDriverView(driverId), 50);

        const cachedShiftId = localStorage.getItem('active_shift_id');
        
        if (cachedShiftId) {
            // Priority 0: Instant Load
            return `
                <div id="shiftsContent">
                    <div class="shift-status">
                        <div class="stat-icon success" style="width:48px;height:48px;">🟢</div>
                        <div style="flex:1;">
                            <div style="font-weight:600; font-size:var(--font-size-lg);">${I18n.t('shift_active') || 'Turno Activo'}</div>
                            <div style="color:var(--text-secondary); font-size:var(--font-size-sm);">Recuperando conexión...</div>
                        </div>
                    </div>
                    <div class="shift-timer">
                        <div class="splash-loader-bar" style="max-width:100px; margin:0 auto var(--space-4);"></div>
                        <p style="text-align:center; color:var(--text-secondary); font-size:14px;">Sincronizando estado...</p>
                    </div>
                </div>
            `;
        } else {
            return `
                <div id="shiftsContent">
                    <div style="text-align:center; padding:var(--space-8);">
                        <div class="splash-loader-bar" style="max-width:200px; margin:0 auto;"></div>
                        <p style="margin-top:var(--space-4); font-weight:600; color:var(--text-secondary);">Cargando tu turno...</p>
                    </div>
                </div>
            `;
        }
    }

    async function _hydratedDriverView(driverId) {
        try {
            const vehicles = await DB.getAll('vehicles');
            
            // 1. Limpiar duplicados automáticamente (ahora rápido, sin cargar todo)
            const activeShift = await cleanupDuplicateShifts(driverId);
            const cachedShiftId = localStorage.getItem('active_shift_id');

            const container = document.getElementById('shiftsContent');
            if (!container) return; // El usuario cambió de pantalla

            if (activeShift) {
                // Sincronización silenciosa (mantener localStorage actualizado si venía de otro lado)
                localStorage.setItem('active_shift_id', activeShift.id);
                localStorage.setItem('active_shift_state', 'true');

                container.innerHTML = renderActiveShift(activeShift, vehicles);
                return;
            }

            // Sync silenciosa de limpieza (ej. fue cerrado remotamente por el Admin)
            if (cachedShiftId && !activeShift) {
                console.log('🔄 Turno cerrado remotamente. Limpiando localStorage.');
                localStorage.removeItem('active_shift_id');
                localStorage.removeItem('active_shift_state');
                if (typeof Components !== 'undefined') {
                    Components.showToast('Tu turno fue finalizado por el administrador.', 'info');
                }
            }

            // Detectar vehículos ocupados por CUALQUIER turno activo
            const allActiveShifts = await DB.getActiveShifts();
            const occupiedVehicleIds = new Set(allActiveShifts.map(s => String(s.vehicleId)));
        const vehicleDriverMap = {};
        for (const s of allActiveShifts) {
            vehicleDriverMap[String(s.vehicleId)] = s.driverName || 'Otro chofer';
        }

        // Solo traemos los últimos 20 completados, sin congelar la pestaña
        const completed = await DB.getRecentCompletedShifts(20);
        const myCompleted = completed.filter(s => String(s.driverId) === String(driverId))
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

        // Renderizar tabla asíncronamente para no bloquear el hilo
        const tableHtml = myCompleted.length > 0 ? await renderShiftTable(myCompleted) : `<p style="color:var(--text-tertiary);">${I18n.t('shift_no_history')}</p>`;

        container.innerHTML = `
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
                        ${vehicles.map(v => {
                            const isOccupied = occupiedVehicleIds.has(String(v.id));
                            const usedBy = vehicleDriverMap[String(v.id)] || '';
                            if (isOccupied) {
                                return `<option value="${v.id}" disabled style="color:#ef4444; font-weight:600;">🔒 ${v.name} — ${v.plate} (En uso por ${usedBy})</option>`;
                            }
                            return `<option value="${v.id}">✅ ${v.name} — ${v.plate}</option>`;
                        }).join('')}
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">${I18n.t('shift_odometer_start')} (${Units.distanceLabel()})</label>
                    <input type="number" class="form-input" id="shiftOdometerStart"
                        placeholder="${I18n.t('shift_odometer_start')}" inputmode="numeric">
                </div>

                ${Components.renderPhotoCapture('shiftOdoStart', I18n.t('shift_odometer_photo'))}

                <button class="btn btn-success btn-block btn-lg" onclick="ShiftsModule.startShift(event)">
                    ▶️ ${I18n.t('shift_start')}
                </button>
            </div>

            <!-- Historial -->
            <div class="dashboard-section">
                <div class="dashboard-section-title">📋 Últimos Turnos</div>
                ${tableHtml}
            </div>
        `;
        } catch (e) {
            console.error('Error in _hydratedDriverView', e);
            document.getElementById('shiftsContent').innerHTML = `<p style="color:red; text-align:center;">Error cargando turnos: ${e.message}</p>`;
        }
    }

    // --- Turno activo ---
    function renderActiveShift(shift, vehicles) {
        const vehicle = vehicles.find(v => v.id === shift.vehicleId);
        
        // Guardar datos del turno activo para el SOS FAB
        _activeShiftId = shift.id;
        _activeVehicleId = shift.vehicleId;
        _activeVehicleName = vehicle ? `${vehicle.name} — ${vehicle.plate}` : '';

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
                    ${(vehicle && vehicle.companiaSeguro) ? `
                    <div style="margin-top:var(--space-2); padding-top:var(--space-2); border-top:1px solid rgba(0,0,0,0.05); display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--space-2);">
                        <div style="font-size:var(--font-size-xs); line-height:1.2; color:var(--text-secondary);">
                            <strong style="color:var(--text-primary);">${I18n.t('shift_insurance') || 'Seguro'}:</strong> ${vehicle.companiaSeguro} ${vehicle.tipoCobertura ? `(${vehicle.tipoCobertura})` : ''}
                        </div>
                        ${vehicle.telefonoAuxilio ? `
                        <a href="tel:${vehicle.telefonoAuxilio}" onclick="event.stopPropagation();" style="display:inline-flex; align-items:center; gap:4px; padding:4px 8px; background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-color); border-radius:4px; text-decoration:none; font-size:11px; font-weight:600;">
                            🚜 ${I18n.t('shift_call_tow') || 'Auxilio'}
                        </a>` : ''}
                    </div>` : ''}
                </div>
                <span class="badge ${shift.shiftType === 'night' ? 'badge-warning' : 'badge-success'}" style="align-self:flex-start;">
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

            <!-- Botón SOS de Emergencia (solo chofer en turno activo) -->
            ${Auth.isDriver() ? SOSModule.renderSOSButton(shift.id, shift.vehicleId, vehicle ? `${vehicle.name} — ${vehicle.plate}` : '') : ''}

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

                <button class="btn btn-danger btn-block btn-lg btn-end-shift" onclick="ShiftsModule.endShift('${shift.id}', event)">
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
        // LAZY LOADING
        setTimeout(() => _hydratedOwnerView(), 50);

        return `
            <div id="ownerShiftsContent">
                <div style="text-align:center; padding:var(--space-8);">
                    <div class="splash-loader-bar" style="max-width:200px; margin:0 auto;"></div>
                    <p style="margin-top:var(--space-4); font-weight:600; color:var(--text-secondary);">Cargando panel de turnos...</p>
                </div>
            </div>
        `;
    }

    async function _hydratedOwnerView() {
        try {
            const activeShifts = await DB.getActiveShifts();
            
            // Detectar si hay conductores con múltiples turnos activos y corregirlos silenciosamente
            const activeDrivers = new Set();
            for (const s of activeShifts) {
                    if (activeDrivers.has(s.driverId)) {
                        // Duplicado encontrado globalmente: aplicar limpieza
                        await cleanupDuplicateShifts(s.driverId);
                    } else {
                        activeDrivers.add(s.driverId);
                    }
            }

            // Refetch after possible cleanup
            const cleanActiveShifts = await DB.getActiveShifts();
            
            // Cargar solo los últimos 20 completados usando la nueva función optimizada
            const completed = await DB.getRecentCompletedShifts(20);
            completed.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

            const container = document.getElementById('ownerShiftsContent');
            if (!container) return;

            const tableHtml = completed.length > 0 ? await renderShiftTable(completed) : `<p style="color:var(--text-tertiary);">${I18n.t('shift_no_history')}</p>`;
            const cardsHtml = await renderActiveShiftsCards(cleanActiveShifts);

            container.innerHTML = `
                <!-- Turnos activos -->
                ${cleanActiveShifts.length > 0 ? `
                    <div class="dashboard-section">
                        <div class="dashboard-section-title">🟢 ${I18n.t('dash_active_shifts')} (${cleanActiveShifts.length})</div>
                        ${cardsHtml}
                    </div>
                ` : `
                    <div class="shift-status" style="justify-content:center; flex-direction:column; text-align:center;">
                        <div style="font-size:2rem; margin-bottom:var(--space-2);">😴</div>
                        <div style="color:var(--text-secondary);">${I18n.t('shift_inactive')}</div>
                    </div>
                `}

                <!-- Historial completo -->
                <div class="dashboard-section">
                    <div class="dashboard-section-title">📋 Últimos Turnos (Historial Rápido)</div>
                    ${tableHtml}
                </div>
            `;
        } catch (e) {
            console.error('Error in _hydratedOwnerView', e);
            document.getElementById('ownerShiftsContent').innerHTML = `<p style="color:red; text-align:center;">Error: ${e.message}</p>`;
        }
    }

    async function renderActiveShiftsCards(shifts) {
        let html = '<div class="content-grid">';
        for (const s of shifts) {
            const driver = await DB.get('users', s.driverId);
            const vehicle = await DB.get('vehicles', s.vehicleId);
            const driverDisplayName = driver?.name || s.driverName || 'Conductor desconocido';
            html += `
                <div class="card">
                    <div style="display:flex; align-items:center; gap:var(--space-3); margin-bottom:var(--space-3);">
                        <div class="stat-icon success">⏱️</div>
                        <div style="flex:1;">
                            <div style="font-weight:700; font-size:var(--font-size-base); color:var(--color-primary-light);">
                                👤 ${driverDisplayName}
                            </div>
                            <div style="font-size:var(--font-size-xs); color:var(--text-tertiary);">
                                🚗 ${vehicle?.name || ''} — ${vehicle?.plate || ''}
                            </div>
                        </div>
                        <span class="badge ${s.shiftType === 'night' ? 'badge-warning' : 'badge-success'}">
                            ${s.shiftType === 'night' ? '🌙 18-06' : '🌅 06-18'}
                        </span>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="font-size:var(--font-size-xs); color:var(--text-secondary);">
                            ${I18n.t('shift_odometer_start')}: ${Units.formatDistance(s.startOdometer)} |
                            ${new Date(s.startTime).toLocaleString([], { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12: false })}
                        </div>
                        ${Auth.isOwner() ? `
                        <div style="display:flex; gap:var(--space-2);">
                            <button class="btn btn-icon btn-primary" onclick="ShiftsModule.editShift('${s.id}')" title="Editar" style="padding:4px; font-size:12px;">✏️</button>
                            <button class="btn btn-icon btn-danger" onclick="ShiftsModule.deleteShift('${s.id}')" title="Eliminar" style="padding:4px; font-size:12px;">🗑️</button>
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }
        html += '</div>';
        return html;
    }

    async function renderShiftTable(shifts) {
        // Resolver nombres de choferes y vehículos
        let rows = '';
        for (const s of shifts.slice(0, 50)) { // Mostrar hasta 50
            const driver = await DB.get('users', s.driverId);
            const vehicle = await DB.get('vehicles', s.vehicleId);
            // Prioridad: nombre guardado en el turno > nombre del usuario en DB > email > guion
            const driverName = s.driverName || driver?.name || driver?.email || '-';
            // Vehículo: nombre guardado en turno > lookup en DB > ID
            const vehicleName = s.vehicleName || (vehicle ? `${vehicle.name} — ${vehicle.plate}` : `#${s.vehicleId}`);
            rows += `
                <tr>
                    <td data-label="${I18n.t('date')}">${new Date(s.startTime).toLocaleDateString()} ${new Date(s.startTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12: false })}</td>
                    <td data-label="${I18n.t('mech_vehicle')}">${vehicleName}</td>
                    <td data-label="${I18n.t('shift_type')}">
                        <div style="display:flex; align-items:center; gap:6px;">
                            ${s.shiftType === 'night' ? '🌙' : '🌅'}
                            <span>${new Date(s.startTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12: false })} - ${s.endTime ? new Date(s.endTime).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12: false }) : '--:--'}</span>
                        </div>
                    </td>
                    <td data-label="${I18n.t('shift_driver')}">${driverName}</td>
                    <td data-label="${I18n.t('shift_odometer_start')}">${Units.formatDistance(s.startOdometer)}</td>
                    <td data-label="${I18n.t('shift_odometer_end')}">${s.endOdometer ? Units.formatDistance(s.endOdometer) : '-'}</td>
                    <td data-label="${I18n.t('shift_total_km')}">${s.endOdometer ? Units.formatDistance(s.endOdometer - s.startOdometer) : '-'}</td>
                    <td data-label="${I18n.t('shift_earnings')}">
                        ${Auth.isOwner() ? `${I18n.t('unit_currency')}${(s.earnings || 0).toLocaleString()}` : '-'}
                    </td>
                    <td data-label="📷">
                        ${s.earningsPhoto ? `<button class="btn btn-ghost btn-sm" onclick="ShiftsModule.previewPhoto('${s.id}')" title="Ver captura">👁️</button>` : '-'}
                    </td>
                    ${Auth.isOwner() ? `
                    <td data-label="Acciones">
                        <button class="btn btn-icon btn-primary" onclick="ShiftsModule.editShift('${s.id}')" title="Editar" style="margin-right:var(--space-2);">✏️</button>
                        <button class="btn btn-icon btn-danger" onclick="ShiftsModule.deleteShift('${s.id}')" title="Eliminar">🗑️</button>
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
                            <th>${I18n.t('shift_type')}</th>
                            <th>${I18n.t('shift_driver')}</th>
                            <th>${I18n.t('shift_odometer_start')}</th>
                            <th>${I18n.t('shift_odometer_end')}</th>
                            <th>${I18n.t('shift_total_km')}</th>
                            <th>${I18n.t('shift_earnings')}</th>
                            <th>📷</th>
                            ${Auth.isOwner() ? `<th>Acciones</th>` : ''}
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
    async function startShift(event) {
        // Bloquear botón instantáneamente (Frontend Race Condition Prevention)
        const btn = event ? event.currentTarget : document.querySelector('.btn-success');
        let originalText = '▶️ Iniciar Turno';
        if (btn) {
            if (btn.disabled) return; // Drop si ya se le hizo clic
            originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '⏳ INICIANDO... (No cierres la app)';
            btn.style.opacity = '0.7';
        }

        const restoreBtn = () => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
                btn.style.opacity = '1';
            }
        };

        // Guard: verificar sesión activa
        if (!Auth.isLoggedIn()) {
            alert('Error: Sesión no encontrada. Por favor iniciá sesión nuevamente.');
            Router.navigate('login');
            restoreBtn();
            return;
        }

        const vehicleId = document.getElementById('shiftVehicle')?.value;
        const odoStart = parseFloat(document.getElementById('shiftOdometerStart')?.value);
        const photo = Components.getPhotoData('shiftOdoStart');

        if (!vehicleId || vehicleId === '' || !odoStart) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            restoreBtn();
            return;
        }

        // Obtener todos los turnos para validaciones de seguridad
        const allActiveShifts = await DB.getActiveShifts();

        // Validación 1: El chofer no puede tener más de un turno activo
        const driverId = Auth.getUserId();
        const driverHasActiveShift = allActiveShifts.find(s => s.driverId === driverId);
        if (driverHasActiveShift) {
            Components.showToast('ℹ️ Tienes un turno en curso. Redirigiendo...', 'info');
            restoreBtn();
            Router.navigate('shifts'); 
            return;
        }

        // Validación 2: El vehículo no puede estar en uso por otro turno activo
        // Usar String() para evitar problemas de tipos (ej: 1 === "1" es falso)
        const activeShiftOnVehicle = allActiveShifts.find(s => String(s.vehicleId) === String(vehicleId));

        if (activeShiftOnVehicle) {
            // Obtener el nombre de quien lo está usando
            const driverInUse = await DB.get('users', activeShiftOnVehicle.driverId);
            const driverName = driverInUse ? driverInUse.name : 'Otro chofer';

            // Extraer la hora exacta en la que inició el turno
            const shiftStartTime = new Date(activeShiftOnVehicle.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

            Components.showToast(`🚨 Auto en uso por ${driverName} (desde las ${shiftStartTime}). Asegurate de que el turno anterior haya finalizado.`, 'danger');
            return;
        }

        // Validación 3: Licencia de conducir vencida (BLOQUEO)
        const currentDriver = await DB.get('users', driverId);
        if (currentDriver && currentDriver.licenseExpiryDate) {
            const licenseStatus = Alerts.getLicenseStatus(currentDriver);
            if (licenseStatus.level === 'danger') {
                Components.showToast('🚫 LICENCIA VENCIDA — No podés iniciar turno. Actualizá tu documentación en Configuración → Legajo.', 'danger');
                return;
            }
        }

        const odometerKm = Units.toKm(odoStart);

        // Resolver nombre del vehículo para persistir en el turno
        const vehicleData = await DB.get('vehicles', vehicleId);
        const vehicleName = vehicleData ? `${vehicleData.name} — ${vehicleData.plate}` : '';

        // --- "Luz de Check Engine": envolver la escritura en try/catch ---
        try {
            const shiftIdRef = await DB.add('shifts', {
                vehicleId,
                vehicleName,
                driverId,
                driverName: Auth.getUserName(),
                shiftType: selectedShiftType,
                startTime: new Date().toISOString(),
                startOdometer: odometerKm,
                startOdometerPhoto: photo ? 'migrated' : null,
                status: 'active',
                earnings: 0
            });

            // Persistencia LocalStorage (Priority 0)
            try {
                localStorage.setItem('active_shift_id', shiftIdRef);
                localStorage.setItem('active_shift_state', 'true');
            } catch(lsErr) { console.warn('No se pudo guardar persistencia local', lsErr); }

            // Guardar foto separada
            if (photo) {
                try {
                    firebase.database().ref(DB.getFleet() + '/shift_photos/' + shiftIdRef + '/startOdometerPhoto').set(photo);
                } catch(e) { console.warn('No se pudo guardar la foto de inicio', e); }
            }

            // Reset selector
            selectedShiftType = 'day';

            // Actualizar odómetro del vehículo
            if (vehicleData) {
                vehicleData.currentOdometer = odometerKm;
                await DB.put('vehicles', vehicleData);
            }

            Components.showToast(I18n.t('shift_start') + ' ✅', 'success');

            // Geofencing: vincular domicilio del conductor como zona_base del vehículo
            if (vehicleData && currentDriver && currentDriver.address) {
                if (!vehicleData.zonaBaseLabel) {
                    vehicleData.zonaBaseLabel = 'Domicilio ' + (currentDriver.name || 'Chofer');
                    await DB.put('vehicles', vehicleData);
                }
            }

            Router.navigate('shifts');

            // Gatillar permisos GPS post-inicio (v113)
            setTimeout(() => {
                if (typeof GPSPermissions !== 'undefined' && typeof Auth !== 'undefined' && !Auth.isOwner()) {
                    GPSPermissions.requestWithDialog();
                }
            }, 800);

        } catch (shiftError) {
            console.error('🔴 Fallo en Iniciar Turno: ', shiftError);

            // Traducir error a mensaje legible
            const code = shiftError.code || shiftError.message || '';
            let reason = '';

            if (code.includes('permission-denied') || code.includes('PERMISSION_DENIED')) {
                reason = '🔒 Permiso denegado en Firestore. Tu cuenta no tiene permisos para crear turnos.';
            } else if (code.includes('unavailable') || code.includes('network') || code.includes('failed-precondition')) {
                reason = '📡 Sin conexión al servidor. Revisá tu internet e intentá de nuevo.';
            } else if (code.includes('not-found')) {
                reason = '🗂️ La colección de turnos no existe. Contactá al administrador.';
            } else if (code.includes('resource-exhausted') || code.includes('quota')) {
                reason = '⚠️ Se superó la cuota de la base de datos. Contactá al administrador.';
            } else {
                reason = `❌ No se pudo iniciar el turno: ${shiftError.message || code || 'error desconocido'}. Revisá la consola (F12).`;
            }

            Components.showToast(reason, 'danger');
            restoreBtn();
        }
    }

    // --- Finalizar turno ---
    async function endShift(shiftId, event) {
        // Bloquear botón
        const btn = event ? event.currentTarget : document.querySelector('.btn-end-shift');
        let originalText = '⏹️ Finalizar Turno';
        if (btn) {
            if (btn.disabled) return;
            originalText = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '⏳ FINALIZANDO...';
            btn.style.opacity = '0.7';
        }

        const restoreBtn = () => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
                btn.style.opacity = '1';
            }
        };

        // Guard: verificar sesión activa
        if (!Auth.isLoggedIn()) {
            alert('Error: Sesión no encontrada. Por favor iniciá sesión nuevamente.');
            Router.navigate('login');
            restoreBtn();
            return;
        }

        const odoEnd = parseFloat(document.getElementById('shiftOdometerEnd')?.value);
        const earnings = parseFloat(document.getElementById('shiftEarnings')?.value) || 0;
        const odoPhoto = Components.getPhotoData('shiftOdoEnd');
        const earningsPhoto = Components.getPhotoData('shiftEarningsPhoto');

        if (!odoEnd) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required'), 'danger');
            restoreBtn();
            return;
        }

        const shift = await DB.get('shifts', shiftId);
        if (!shift) {
            restoreBtn();
            return;
        }

        // Validar que KM final >= KM inicial
        const odometerKm = Units.toKm(odoEnd);
        if (odometerKm < shift.startOdometer) {
            Components.showToast(I18n.t('km_error_lower'), 'danger');
            restoreBtn();
            return;
        }

        // Validar contra odómetro actual del vehículo
        const vehicle = await DB.get('vehicles', shift.vehicleId);
        if (vehicle && vehicle.currentOdometer && odometerKm < vehicle.currentOdometer) {
            Components.showToast(I18n.t('km_error_lower'), 'danger');
            restoreBtn();
            return;
        }

        // --- "Luz de Check Engine": envolver finalizazión en try/catch ---
        try {
            shift.endTime = new Date().toISOString();
            shift.endOdometer = odometerKm;
            shift.endOdometerPhoto = odoPhoto ? 'migrated' : null;
            shift.earnings = earnings;
            shift.earningsPhoto = earningsPhoto ? 'migrated' : null;
            shift.driverName = Auth.getUserName();
            // Persistir nombre del vehículo si no existe aún
            if (!shift.vehicleName && vehicle) {
                shift.vehicleName = `${vehicle.name} — ${vehicle.plate}`;
            }
            shift.status = 'completed';
            await DB.put('shifts', shift);

            // Eliminar de LocalStorage (Finalización)
            try {
                localStorage.removeItem('active_shift_id');
                localStorage.removeItem('active_shift_state');
            } catch(lsErr) {}

            // Guardar fotos separadas para que no alenten el Login
            if (odoPhoto || earningsPhoto) {
                try {
                    const photosNode = firebase.database().ref(DB.getFleet() + '/shift_photos/' + shift.id);
                    if (odoPhoto) photosNode.child('endOdometerPhoto').set(odoPhoto);
                    if (earningsPhoto) photosNode.child('earningsPhoto').set(earningsPhoto);
                } catch(e) { console.warn('Error guardando fotos en background', e); }
            }

            // Actualizar odómetro del vehículo
            if (vehicle) {
                vehicle.currentOdometer = odometerKm;
                await DB.put('vehicles', vehicle);

                // --- Trigger de Alerta Multiplataforma (Aceite 10,000 km) ---
                if (vehicle.nextOilChangeKm) {
                    try {
                        fetch('/api/notify/maintenance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                fleetId: DB.getFleet(),
                                vehicleId: vehicle.id,
                                vehiclePlate: vehicle.plate,
                                driverId: Auth.getUserId(),
                                currentOdometer: odometerKm,
                                nextOilChangeKm: vehicle.nextOilChangeKm
                            })
                        }).catch(e => console.warn('Push maintenance emit fallback', e));
                    } catch(e) {}
                }
            }

            Components.showToast(I18n.t('shift_end') + ' ✅', 'success');
            Router.navigate('shifts');

        } catch (endError) {
            console.error('🔴 Fallo en Finalizar Turno: ', endError);

            const code = endError.code || endError.message || '';
            let reason = '';

            if (code.includes('permission-denied') || code.includes('PERMISSION_DENIED')) {
                reason = '🔒 Permiso denegado. No se pudo guardar el turno.';
            } else if (code.includes('unavailable') || code.includes('network') || code.includes('failed-precondition')) {
                reason = '📡 Sin conexión. El turno no se pudo finalizar. Intentá de nuevo.';
            } else {
                reason = `❌ No se pudo finalizar el turno: ${endError.message || code || 'error desconocido'}. Revisá la consola (F12).`;
            }

            Components.showToast(reason, 'danger');
            restoreBtn();
        }
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

    // --- Eliminar turno (Solo Dueño) ---
    async function deleteShift(shiftId) {
        if (!Auth.isOwner()) return;

        if (confirm('¿Estás seguro de que deseas eliminar este turno permanentemente? Esta acción borrará el registro de horas, kilómetros y ganancias asociados a este turno.')) {
            await DB.remove('shifts', shiftId);
            Components.showToast('Turno eliminado correctamente.', 'success');
            // Refrescar vista
            Router.navigate('shifts');
        }
    }

    // --- Utilidad para datetime-local ---
    function toLocalDatetime(isoString) {
        if (!isoString) return '';
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return '';
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // --- Editar turno (Solo Dueño) ---
    async function editShift(shiftId) {
        if (!Auth.isOwner()) return;

        const shift = await DB.get('shifts', shiftId);
        if (!shift) return;

        // Resolver info de vehículo y conductor
        const vehicle = await DB.get('vehicles', shift.vehicleId);
        const vehicleName = vehicle ? `${vehicle.name} — ${vehicle.plate}` : `Vehículo #${shift.vehicleId}`;
        const currentDriverName = shift.driverName || Auth.getUserName();

        const startOdo = shift.startOdometer || '';
        const endOdo = shift.endOdometer || '';
        const startTimeStr = toLocalDatetime(shift.startTime);
        const endTimeStr = shift.endTime ? toLocalDatetime(shift.endTime) : '';
        const earningsStr = shift.earnings || '';



        const bodyHTML = `
            <input type="hidden" id="editShiftId" value="${shift.id}">

            <!-- Info del turno -->
            <div style="background:var(--bg-tertiary); border-radius:var(--radius-lg); padding:var(--space-3) var(--space-4); margin-bottom:var(--space-4); display:flex; align-items:center; gap:var(--space-3);">
                <div style="font-size:1.5rem;">🚗</div>
                <div>
                    <div style="font-weight:600; font-size:var(--font-size-base);">${vehicleName}</div>
                    <div style="font-size:var(--font-size-xs); color:var(--text-tertiary);">${shift.shiftType === 'night' ? '🌙 Nocturno' : '🌅 Diurno'}</div>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label">👤 Conductor</label>
                <input type="text" id="editShiftDriverName" class="form-input" value="${currentDriverName}" style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
            </div>
            <div class="form-group">
                <label class="form-label">${I18n.t('shift_odometer_start')} (KM)</label>
                <input type="number" id="editShiftOdoStart" class="form-input" value="${startOdo}" step="0.1" oninput="ShiftsModule.validateEditKm()" style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
            </div>
            <div class="form-group">
                <label class="form-label">${I18n.t('shift_odometer_end')} (KM)</label>
                <input type="number" id="editShiftOdoEnd" class="form-input" value="${endOdo}" step="0.1" oninput="ShiftsModule.validateEditKm()" style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
            </div>
            <div id="editKmError" style="display:none; color:#ef4444; font-size:13px; font-weight:600; margin:-8px 0 12px; padding:6px 10px; background:rgba(239,68,68,0.1); border-radius:6px;">
                ❌ El KM Final no puede ser menor al KM Inicial
            </div>
            <div class="form-group">
                <label class="form-label">Hora de Inicio</label>
                <input type="datetime-local" id="editShiftStartTime" class="form-input" value="${startTimeStr}" style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
            </div>
            <div class="form-group">
                <label class="form-label">Hora de Fin</label>
                <input type="datetime-local" id="editShiftEndTime" class="form-input" value="${endTimeStr}" style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
                <small class="form-help">Dejar en blanco si el turno sigue Activo.</small>
            </div>
            <div class="form-group">
                <label class="form-label">${I18n.t('shift_earnings')}</label>
                <input type="number" id="editShiftEarnings" class="form-input" value="${earningsStr}" step="0.1" style="background:#ffffff !important; color:#000000 !important; font-size:20px !important; font-weight:900 !important; border:2px solid #000000 !important;">
            </div>
        `;

        const footerHTML = `
            <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
            <button class="btn btn-primary" id="editShiftSaveBtn" onclick="ShiftsModule.saveEditShift()">💾 Guardar Cambios</button>
        `;

        Components.showModal('✏️ Editar Turno', bodyHTML, footerHTML);

        // Validar KM al abrir
        setTimeout(() => ShiftsModule.validateEditKm(), 100);
    }

    // --- Validación de KM en tiempo real en el editor ---
    function validateEditKm() {
        const odoStart = parseFloat(document.getElementById('editShiftOdoStart')?.value);
        const odoEnd = parseFloat(document.getElementById('editShiftOdoEnd')?.value);
        const errorEl = document.getElementById('editKmError');
        const saveBtn = document.getElementById('editShiftSaveBtn');
        const odoEndInput = document.getElementById('editShiftOdoEnd');

        if (!isNaN(odoStart) && !isNaN(odoEnd) && odoEnd < odoStart) {
            // Mostrar error y bloquear
            if (errorEl) errorEl.style.display = 'block';
            if (odoEndInput) odoEndInput.classList.add('km-error');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.style.opacity = '0.5';
                saveBtn.style.pointerEvents = 'none';
            }
        } else {
            // Limpiar error
            if (errorEl) errorEl.style.display = 'none';
            if (odoEndInput) odoEndInput.classList.remove('km-error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
                saveBtn.style.pointerEvents = 'auto';
            }
        }
    }

    async function saveEditShift() {
        const id = document.getElementById('editShiftId').value;
        const shift = await DB.get('shifts', id);
        if (!shift) return;

        const odoStart = parseFloat(document.getElementById('editShiftOdoStart').value);
        const odoEnd = parseFloat(document.getElementById('editShiftOdoEnd').value);
        const startTime = document.getElementById('editShiftStartTime').value;
        const endTime = document.getElementById('editShiftEndTime').value;
        const earnings = parseFloat(document.getElementById('editShiftEarnings').value);
        const driverName = document.getElementById('editShiftDriverName')?.value.trim();

        // Validar que KM final >= KM inicial
        if (!isNaN(odoStart) && !isNaN(odoEnd) && odoEnd < odoStart) {
            Components.showToast(I18n.t('km_error_lower'), 'danger');
            return;
        }

        if (!isNaN(odoStart)) shift.startOdometer = odoStart;
        if (!isNaN(odoEnd)) shift.endOdometer = odoEnd;
        if (startTime) shift.startTime = new Date(startTime).toISOString();
        if (endTime) shift.endTime = new Date(endTime).toISOString();
        if (!isNaN(earnings)) shift.earnings = earnings;

        // Guardar nombre del conductor — SIEMPRE usar displayName de Firebase Auth
        const authUser = typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser;
        shift.driverName = (authUser && authUser.displayName) ? authUser.displayName : (driverName || Auth.getUserName());

        // Persistir nombre del vehículo si no existe
        if (!shift.vehicleName) {
            const editVehicle = await DB.get('vehicles', shift.vehicleId);
            if (editVehicle) {
                shift.vehicleName = `${editVehicle.name} — ${editVehicle.plate}`;
            }
        }

        await DB.put('shifts', shift);

        if (shift.endOdometer) {
            const vehicle = await DB.get('vehicles', shift.vehicleId);
            if (vehicle && (vehicle.currentOdometer || 0) < shift.endOdometer) {
                vehicle.currentOdometer = shift.endOdometer;
                await DB.put('vehicles', vehicle);
            }
        }

        Components.closeModal();
        Components.showToast('Turno actualizado ✅', 'success');
        Router.navigate('shifts');
    }

    // --- Previsualizar foto de ganancias ---
    async function previewPhoto(shiftId) {
        Components.showToast('Cargando imagen...', 'info');
        const shift = await DB.get('shifts', shiftId);
        
        if (!shift || (!shift.earningsPhoto && !shift.startOdometerPhoto && !shift.endOdometerPhoto)) {
            Components.showToast('No hay foto disponible', 'warning');
            return;
        }

        let photoB64 = shift.earningsPhoto;
        
        if (photoB64 === 'migrated') {
            photoB64 = await DB.getShiftPhoto(shiftId, 'earningsPhoto');
            if (!photoB64) {
                Components.showToast('La foto ya no está disponible o no se guardó correctamente', 'danger');
                return;
            }
        }

        Components.showModal(
            '📷 ' + I18n.t('shift_earnings_photo'),
            `<img src="${photoB64}" style="width:100%; border-radius:8px; max-height:80vh; object-fit:contain;">`
        );
    }

    // --- Verificación de turno activo (Shift Hydration) ---
    // Consulta Firebase para ver si el conductor logueado tiene un turno abierto.
    // Devuelve el objeto del turno activo o null.
    async function checkActiveShift() {
        try {
            const driverId = Auth.getUserId();
            if (!driverId) return null;

            const activeShifts = await DB.getActiveShifts();
            const activeShift = activeShifts.find(s => String(s.driverId) === String(driverId));

            if (activeShift) {
                // Hidratar datos internos del módulo
                const vehicles = await DB.getAll('vehicles');
                const vehicle = vehicles.find(v => v.id === activeShift.vehicleId);
                _activeShiftId = activeShift.id;
                _activeVehicleId = activeShift.vehicleId;
                _activeVehicleName = vehicle ? `${vehicle.name} — ${vehicle.plate}` : '';
                console.log(`🔄 Shift hydration: turno activo encontrado (ID: ${activeShift.id}, Vehículo: ${_activeVehicleName})`);
                return activeShift;
            }

            console.log('🔄 Shift hydration: no hay turno activo');
            return null;
        } catch (e) {
            console.warn('🔄 Shift hydration: error al verificar turno activo:', e);
            return null;
        }
    }

    // --- Hidratación pública: restaurar estado del turno al volver del background ---
    // Llamada desde App._restoreSessionOnResume() para conductores.
    // Si hay turno activo, fuerza la navegación a la vista de turnos.
    async function hydrateActiveShift() {
        const activeShift = await checkActiveShift();
        if (activeShift) {
            // Forzar la vista de turnos para que renderice el turno activo
            Router.navigate('shifts');
            return true;
        }
        return false;
    }

    return { render, startShift, endShift, selectShiftType, deleteShift, editShift, saveEditShift, previewPhoto, validateEditKm,
        getActiveShiftData: () => ({ shiftId: _activeShiftId, vehicleId: _activeVehicleId, vehicleName: _activeVehicleName }),
        checkActiveShift, hydrateActiveShift
    };
})();
