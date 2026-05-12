/* ============================================
   FleetAdmin Pro — Módulo de Vehículos
   CRUD de vehículos con odómetro, estado y RTO/VTV
   ============================================ */

const VehiclesModule = (() => {
    const CAR_CATALOG_ARG = [
        "Baic Senova (5p)", "Baic X25 (5p)", "Baic X35 (5p)", "Baic X55 (5p)",
        "Changan CS15 (5p)", "Changan CS35 (5p)",
        "Chery Arrizo 5 (4p)", "Chery Fulwin (5p)", "Chery QQ (5p)", "Chery Tiggo 2 (5p)", "Chery Tiggo 3 (5p)", "Chery Tiggo 4 (5p)", "Chery Tiggo 5 (5p)", "Chery Tiggo 8 (5p)",
        "Chevrolet Aveo (4p)", "Chevrolet Classic (4p)", "Chevrolet Cobalt (4p)", "Chevrolet Corsa (4p)", "Chevrolet Corsa II (5p)", "Chevrolet Cruze (4p)", "Chevrolet Cruze (5p)", "Chevrolet Equinox (5p)", "Chevrolet Onix (5p)", "Chevrolet Onix Plus (4p)", "Chevrolet Prisma (4p)", "Chevrolet S10 (4p)", "Chevrolet Spin (5p)", "Chevrolet Tracker (5p)",
        "Citroën Berlingo (5p)", "Citroën C3 (5p)", "Citroën C3 Aircross (5p)", "Citroën C4 Cactus (5p)", "Citroën C4 Lounge (4p)", "Citroën C4 Sedan (4p)",
        "DFSK Glory 580 (5p)",
        "FAW X40 (5p)",
        "Fiat Argo (5p)", "Fiat Cronos (4p)", "Fiat Fastback (5p)", "Fiat Grand Siena (4p)", "Fiat Mobi (5p)", "Fiat Palio (5p)", "Fiat Pulse (5p)", "Fiat Punto (5p)", "Fiat Siena (4p)", "Fiat Toro (4p)", "Fiat Uno Way (5p)",
        "Ford EcoSport (5p)", "Ford Fiesta Kinetic (5p)", "Ford Fiesta Kinetic Sedan (4p)", "Ford Focus (5p)", "Ford Focus Sedan (4p)", "Ford Ka (5p)", "Ford Ka+ (4p)", "Ford Kuga (5p)", "Ford Mondeo (4p)", "Ford Ranger (4p)", "Ford Territory (5p)",
        "Geely Emgrand (4p)", "Geely Emgrand X7 (5p)", "Geely LC (5p)",
        "Haval H1 (5p)", "Haval H2 (5p)", "Haval H6 (5p)", "Haval Jolion (5p)",
        "Honda City (4p)", "Honda Civic (4p)", "Honda CR-V (5p)", "Honda Fit (5p)", "Honda HR-V (5p)",
        "Hyundai Creta (5p)", "Hyundai Grand i10 (5p)", "Hyundai HB20 (5p)", "Hyundai HB20S (4p)", "Hyundai i10 (5p)", "Hyundai Tucson (5p)",
        "JAC S2 (5p)", "JAC S3 (5p)", "JAC S5 (5p)", "JAC T6 (4p)",
        "Jetour X70 (5p)",
        "Kia Cerato (4p)", "Kia Picanto (5p)", "Kia Rio (5p)", "Kia Seltos (5p)", "Kia Sportage (5p)",
        "Lifan 530 (4p)", "Lifan Myway (5p)", "Lifan X60 (5p)", "Lifan X70 (5p)",
        "Nissan Frontier (4p)", "Nissan Kicks (5p)", "Nissan March (5p)", "Nissan Note (5p)", "Nissan Sentra (4p)", "Nissan Tiida (5p)", "Nissan Versa (4p)",
        "Peugeot 2008 (5p)", "Peugeot 207 Compact (5p)", "Peugeot 207 Sedan (4p)", "Peugeot 208 (5p)", "Peugeot 3008 (5p)", "Peugeot 307 (5p)", "Peugeot 308 (5p)", "Peugeot 408 (4p)", "Peugeot 5008 (5p)", "Peugeot Partner (5p)",
        "Renault Alaskan (4p)", "Renault Clio IV (5p)", "Renault Clio Mio (5p)", "Renault Duster (5p)", "Renault Fluence (4p)", "Renault Kangoo (5p)", "Renault Koleos (5p)", "Renault Logan (4p)", "Renault Oroch (4p)", "Renault Sandero (5p)", "Renault Stepway (5p)", "Renault Symbol (4p)",
        "Shineray X30 (5p)",
        "Toyota Corolla (4p)", "Toyota Corolla Cross (5p)", "Toyota Etios (5p)", "Toyota Etios Sedan (4p)", "Toyota Hilux (4p)", "Toyota SW4 (5p)", "Toyota Yaris (5p)", "Toyota Yaris Sedan (4p)",
        "VW Amarok (4p)", "VW Bora (4p)", "VW Fox (5p)", "VW Gol Trend (5p)", "VW Nivus (5p)", "VW Polo (5p)", "VW Suran (5p)", "VW T-Cross (5p)", "VW Taos (5p)", "VW Tiguan (5p)", "VW Vento (4p)", "VW Virtus (4p)", "VW Voyage (4p)"
    ];


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
                <div class="vehicle-list-container" style="display:flex; flex-direction:column; gap:var(--space-3);">
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

    // Dependencia: getVtvStatus fue migrada a Alerts.js para resolver Lazy Loading.

    async function renderVehicleCards(vehicles) {
        let html = '';
        for (const v of vehicles) {
            const belt = await Alerts.getBeltStatus(v);
            const shifts = await DB.getAllByIndex('shifts', 'vehicleId', v.id);
            const completedShifts = shifts.filter(s => s.status === 'completed');
            const totalKm = completedShifts.reduce((sum, s) => sum + ((s.endOdometer || 0) - (s.startOdometer || 0)), 0);

            // Badge RTO/VTV
            const vtv = Alerts.getVtvStatus(v);
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

            // Financial & Alert Badges
            let financialBadge = '';
            let alertsBadge = '';
            let btnGrua = '';

            if (v.metodoPago === 'Crédito' && v.cuotasTotales > 0) {
                financialBadge = `<span class="badge" style="background:#e8f5e9; color:#2e7d32; font-size:0.75rem;">💰 ${v.cuotasPagas || 0} / ${v.cuotasTotales}</span>`;
                
                let restantes = (v.cuotasTotales || 0) - (v.cuotasPagas || 0);
                if (restantes === 3) {
                    alertsBadge += `<span class="badge badge-success" style="font-size:0.75rem;">${I18n.t('veh_installments_almost_done')}</span>`;
                }
                
                if (v.diaVencimiento) {
                    const today = new Date();
                    const currentDay = today.getDate();
                    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
                    
                    let targetDay = v.diaVencimiento;
                    if (targetDay > daysInMonth) targetDay = daysInMonth;
                    
                    let daysLeft;
                    if (currentDay > targetDay) {
                        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, targetDay);
                        daysLeft = Math.ceil((nextMonth - today) / (1000 * 60 * 60 * 24));
                    } else {
                        daysLeft = targetDay - currentDay;
                    }
                    
                    if (daysLeft <= 5 && daysLeft >= 0) {
                        const alertText = daysLeft === 1 ? I18n.t('veh_due_in_1_day') : I18n.t('veh_due_in_days', { days: daysLeft });
                        alertsBadge += `<span class="badge badge-danger" style="font-size:0.75rem;">${alertText}</span>`;
                    }
                }
            }

            if (v.telefonoAuxilio) {
                btnGrua = `<a href="tel:${v.telefonoAuxilio}" style="width:100%; margin-top:var(--space-3); display:flex; justify-content:center; padding: 0.6rem; text-decoration:none; color:white; background:var(--color-danger); border-radius:var(--radius-md); font-weight:bold; align-items:center; gap:0.5rem; text-transform:uppercase; letter-spacing:0.5px; box-shadow:0 4px 6px rgba(239,68,68,0.2);"><span style="font-size:1.2rem;">🚨</span> ${I18n.t('veh_call_tow')}</a>`;
            }

            // Compact Info for Row
            const statusBadge = `<span class="badge ${v.status === 'active' ? 'badge-success' : 'badge-warning'}" style="font-size:0.7rem; padding:2px 6px;">${v.status === 'active' ? I18n.t('veh_active') : I18n.t('veh_inactive')}</span>`;
            const vtvStatusChar = vtv.level === 'danger' ? '🔴' : vtv.level === 'warning' ? '🟡' : vtv.level === 'ok' ? '🟢' : '⚪';
            
            // Oil Status calculation
            const oil = Alerts.getOilChangeStatus(v);
            let oilBadge = '';
            if (oil.level === 'danger') {
                oilBadge = `<span class="badge badge-danger" style="font-size:0.7rem;">🔴 ${I18n.t('oil_title') || 'Aceite'}: ${I18n.t('oil_expired') || 'Vencido'}</span>`;
            } else if (oil.level === 'warning') {
                oilBadge = `<span class="badge badge-warning" style="font-size:0.7rem;">🟡 ${I18n.t('oil_title') || 'Aceite'}: ${Units.formatDistance(oil.remainingKm)}</span>`;
            } else if (oil.level === 'ok') {
                oilBadge = `<span class="badge badge-success" style="font-size:0.7rem;">🟢 ${I18n.t('oil_title') || 'Aceite'}: ${Units.formatDistance(oil.remainingKm)}</span>`;
            }

            html += `
                <div class="vehicle-expandable-row" style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-xl); overflow:hidden; transition:all 0.2s ease; box-shadow:var(--shadow-sm);">
                    
                    <!-- HEADER: Row representation -->
                    <div class="veh-header-row" onclick="VehiclesModule.toggleExpand('${v.id}')" 
                         style="display:flex; align-items:center; justify-content:space-between; padding:var(--space-4); cursor:pointer; user-select:none; position:relative;">
                        
                        <div style="display:flex; align-items:center; gap:var(--space-3); flex:1;">
                            <div style="background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.2); width:42px; height:42px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:1.3rem; flex-shrink:0;">🚗</div>
                            <div style="min-width:0; overflow:hidden;">
                                <div style="font-weight:700; font-size:1rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#fff;">${v.name}</div>
                                <div style="display:flex; align-items:center; gap:var(--space-2); font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">
                                    <span style="background:var(--bg-tertiary); padding:1px 6px; border-radius:4px; font-weight:700; color:var(--text-primary); border:1px solid rgba(255,255,255,0.05);">${v.plate || '-'}</span>
                                    <span>•</span>
                                    <span>${v.year || '-'}</span>
                                </div>
                            </div>
                        </div>

                        <div style="display:flex; align-items:center; gap:var(--space-3); flex-shrink:0;">
                            <div class="veh-mini-badges" style="display:flex; gap:4px;">
                                ${vtvStatusChar === '🔴' || oil.level === 'danger' || belt.level === 'danger' ? '<span style="background:#ef4444; color:white; border-radius:50px; padding:2px 8px; font-size:0.7rem; font-weight:bold; animation:pulse 1.5s infinite;">⚠️ MANTENIMIENTO</span>' : ''}
                                ${statusBadge}
                            </div>
                            <span id="veh-chevron-${v.id}" style="color:var(--text-tertiary); font-size:0.8rem; transition:transform 0.3s ease;">▶</span>
                        </div>
                    </div>

                    <!-- BODY: The expanded full card view (hidden by default) -->
                    <div id="veh-body-${v.id}" class="veh-expanded-body" style="display:none; padding:0 var(--space-5) var(--space-5) var(--space-5); border-top:1px solid rgba(255,255,255,0.05); background:rgba(0,0,0,0.15);">
                        
                        <div style="display:flex; flex-wrap:wrap; gap:var(--space-2); margin:var(--space-4) 0 var(--space-4) 0;">
                            ${v.companiaSeguro ? `<span class="badge" style="font-size:0.7rem; background:var(--bg-tertiary); color:var(--text-secondary); border:1px solid rgba(255,255,255,0.1);">🛡️ ${v.companiaSeguro}</span>` : ''}
                            ${financialBadge}
                            ${alertsBadge}
                            ${belt.level !== 'ok' ? `
                                <span class="badge badge-${belt.level === 'danger' ? 'danger' : 'warning'}" style="font-size:0.7rem;">
                                    ${belt.level === 'danger' ? '🔴' : '🟡'} ${I18n.t('maint_timing_belt')}
                                </span>
                            ` : '<span class="badge badge-success" style="font-size:0.7rem;">🟢 Correa de Distribución</span>'}
                            ${oilBadge}
                            ${vtvBadge}
                            ${v.zonaBaseLabel ? `<span class="badge" style="font-size:0.7rem; background:var(--bg-tertiary); color:var(--text-secondary);">📍 ${v.zonaBaseLabel}</span>` : ''}
                        </div>

                        <div class="vehicle-stats" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:var(--space-3); margin-bottom:var(--space-4);">
                            <div class="vehicle-stat" style="background:rgba(30, 41, 59, 0.5); border:1px solid rgba(255,255,255,0.03);">
                                <div class="vehicle-stat-value" style="font-size:1.1rem;">${Units.formatDistance(v.currentOdometer || 0)}</div>
                                <div class="vehicle-stat-label">${I18n.t('veh_odometer')}</div>
                            </div>
                            <div class="vehicle-stat" style="background:rgba(30, 41, 59, 0.5); border:1px solid rgba(255,255,255,0.03);">
                                <div class="vehicle-stat-value" style="font-size:1.1rem;">${Units.formatDistance(totalKm)}</div>
                                <div class="vehicle-stat-label">${I18n.t('shift_total_km')}</div>
                            </div>
                            <div class="vehicle-stat" style="background:rgba(30, 41, 59, 0.5); border:1px solid rgba(255,255,255,0.03); border-bottom: 2px solid ${oil.level === 'danger' ? '#ef4444' : oil.level === 'warning' ? '#f59e0b' : '#10b981'};">
                                <div class="vehicle-stat-value" style="font-size:1.1rem; color: ${oil.level === 'danger' ? '#fca5a5' : '#fff'};">
                                    ${oil.remainingKm !== null ? Units.formatDistance(oil.remainingKm) : '--'}
                                </div>
                                <div class="vehicle-stat-label">Rest. Aceite</div>
                            </div>
                            <div class="vehicle-stat" style="background:rgba(30, 41, 59, 0.5); border:1px solid rgba(255,255,255,0.03); border-bottom: 2px solid ${belt.level === 'danger' ? '#ef4444' : belt.level === 'warning' ? '#f59e0b' : '#10b981'};">
                                <div class="vehicle-stat-value" style="font-size:1.1rem; color: ${belt.level === 'danger' ? '#fca5a5' : '#fff'};">
                                    ${Units.formatDistance(belt.remainingKm)}
                                </div>
                                <div class="vehicle-stat-label">Rest. Correa</div>
                            </div>
                            <div class="vehicle-stat" style="background:rgba(30, 41, 59, 0.5); border:1px solid rgba(255,255,255,0.03);">
                                <div class="vehicle-stat-value" style="font-size:1.1rem;">${v.metodoPago === 'Crédito' ? v.cuotasTotales - (v.cuotasPagas||0) : '-'}</div>
                                <div class="vehicle-stat-label">Cuotas Rest.</div>
                            </div>
                        </div>

                        ${Auth.isOwner() ? `
                            <div style="display:flex; flex-wrap:wrap; gap:var(--space-2); border-top:1px solid rgba(255,255,255,0.05); padding-top:var(--space-4);">
                                <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); VehiclesModule.showForm('${v.id}')" style="font-size:0.8rem;">
                                    ✏️ ${I18n.t('edit')}
                                </button>
                                <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); VehiclesModule.showVtvEditor('${v.id}')" style="font-size:0.8rem;">
                                    🔧 ${I18n.t('vtv_title')}
                                </button>
                                <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); VehiclesModule.deleteVehicle('${v.id}')" style="font-size:0.8rem; color:#ef4444;">
                                    🗑️ ${I18n.t('delete')}
                                </button>
                            </div>
                        ` : ''}
                        
                        ${v.telefonoAuxilio ? `
                            <div style="margin-top:var(--space-3);" onclick="event.stopPropagation();">
                                ${btnGrua}
                            </div>
                        ` : ''}
                    </div>
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
                    <input type="text" class="form-input" id="vehName" list="vehCatalogList"
                        value="${vehicle?.name || ''}" placeholder="Ej: Toyota Corolla 2020 (Busca marca o modelo)">
                    <datalist id="vehCatalogList">
                        ${CAR_CATALOG_ARG.map(c => `<option value="${c}">`).join('')}
                    </datalist>
                </div>
                <div class="repair-form-grid">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('veh_plate')} *</label>
                        <input type="text" class="form-input" id="vehPlate"
                            value="${vehicle?.plate || ''}" placeholder="ABC-1234" style="text-transform:uppercase;">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('veh_year')} *</label>
                        <input type="number" class="form-input" id="vehYear"
                            value="${vehicle?.year || ''}" placeholder="2020" inputmode="numeric">
                    </div>
                </div>
                <div class="repair-form-grid">
                    <div class="form-group">
                        <label class="form-label">${I18n.t('veh_odometer')} (${Units.distanceLabel()}) *</label>
                        <input type="number" class="form-input" id="vehOdometer"
                            value="${vehicle ? Units.displayDistance(vehicle.currentOdometer || 0) : ''}"
                            inputmode="numeric">
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('veh_color')} *</label>
                        <select class="form-select" id="vehColor">
                            <option value="">-- ${I18n.t('search')} --</option>
                            <option value="white" ${vehicle?.color === 'white' ? 'selected' : ''}>${I18n.t('color_white')}</option>
                            <option value="black" ${vehicle?.color === 'black' ? 'selected' : ''}>${I18n.t('color_black')}</option>
                            <option value="taxi" ${vehicle?.color === 'taxi' ? 'selected' : ''}>${I18n.t('color_taxi')}</option>
                            <option value="gray" ${vehicle?.color === 'gray' ? 'selected' : ''}>${I18n.t('color_gray')}</option>
                            <option value="silver" ${vehicle?.color === 'silver' ? 'selected' : ''}>${I18n.t('color_silver')}</option>
                            <option value="red" ${vehicle?.color === 'red' ? 'selected' : ''}>${I18n.t('color_red')}</option>
                            <option value="blue" ${vehicle?.color === 'blue' ? 'selected' : ''}>${I18n.t('color_blue')}</option>
                            <option value="maroon" ${vehicle?.color === 'maroon' ? 'selected' : ''}>${I18n.t('color_maroon')}</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">${I18n.t('veh_status')} *</label>
                    <select class="form-select" id="vehStatus">
                        <option value="active" ${vehicle?.status === 'active' ? 'selected' : ''}>${I18n.t('veh_active')}</option>
                        <option value="inactive" ${vehicle?.status === 'inactive' ? 'selected' : ''}>${I18n.t('veh_inactive')}</option>
                    </select>
                </div>

                <!-- Finanzas y Protección -->
                <div style="border-top:1px solid var(--border-color); padding-top:var(--space-4); margin-top:var(--space-2);">
                    <div style="font-weight:600; margin-bottom:var(--space-3); color:var(--color-primary);">
                        ${I18n.t('veh_finance_title')}
                    </div>

                    <div class="form-group">
                        <label class="form-label">${I18n.t('veh_payment_method')} *</label>
                        <select class="form-select" id="vehMetodoPago" onchange="VehiclesModule.toggleFinanceFields()">
                            <option value="Contado" ${vehicle?.metodoPago === 'Contado' || !vehicle?.metodoPago ? 'selected' : ''}>${I18n.t('veh_method_cash')}</option>
                            <option value="Crédito" ${vehicle?.metodoPago === 'Crédito' ? 'selected' : ''}>${I18n.t('veh_method_credit')}</option>
                        </select>
                    </div>

                    <div id="financeFields" style="display: ${vehicle?.metodoPago === 'Crédito' ? 'block' : 'none'}; padding-left:0.5rem; border-left:3px solid var(--color-primary);">
                        <div class="form-group">
                            <label class="form-label" style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
                                <input type="checkbox" id="vehEsPrendario" ${vehicle?.esPrendario ? 'checked' : ''} onchange="VehiclesModule.togglePrendario()">
                                ${I18n.t('veh_is_secured')}
                            </label>
                            <div id="prendarioWarning" style="display: ${vehicle?.esPrendario ? 'block' : 'none'}; color: var(--color-warning); font-size: 0.8rem; margin-top: 0.2rem;">
                                ${I18n.t('veh_secured_warning')}
                            </div>
                        </div>

                        <div class="repair-form-grid">
                            <div class="form-group">
                                <label class="form-label">${I18n.t('veh_grant_date')}</label>
                                <input type="date" class="form-input" id="vehFechaOtorgamiento" value="${vehicle?.fechaOtorgamiento || ''}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">${I18n.t('veh_due_day')}</label>
                                <input type="number" class="form-input" id="vehDiaVencimiento" value="${vehicle?.diaVencimiento || ''}" min="1" max="31">
                            </div>
                        </div>

                        <div class="repair-form-grid">
                            <div class="form-group">
                                <label class="form-label">${I18n.t('veh_total_installments')}</label>
                                <input type="number" class="form-input" id="vehCuotasTotales" value="${vehicle?.cuotasTotales || ''}" placeholder="36" oninput="VehiclesModule.calcRemaining()">
                            </div>
                            <div class="form-group">
                                <label class="form-label">${I18n.t('veh_paid_installments')}</label>
                                <input type="number" class="form-input" id="vehCuotasPagas" value="${vehicle?.cuotasPagas || ''}" placeholder="10" oninput="VehiclesModule.calcRemaining()">
                            </div>
                        </div>
                        
                        <div class="repair-form-grid">
                            <div class="form-group">
                                <label class="form-label">${I18n.t('veh_installment_value')} (${I18n.t('unit_currency')})</label>
                                <input type="number" class="form-input" id="vehValorCuota" value="${vehicle?.valorCuota || ''}" placeholder="50000">
                            </div>
                            <div class="form-group">
                                <label class="form-label">${I18n.t('veh_remaining_installments')}</label>
                                <input type="text" class="form-input" id="vehCuotasRestantes" readonly style="background:var(--bg-tertiary);" value="${(vehicle?.cuotasTotales || 0) - (vehicle?.cuotasPagas || 0) || ''}">
                            </div>
                        </div>
                    </div>

                    <div style="font-weight:600; margin-top:var(--space-4); margin-bottom:var(--space-3); color:var(--color-primary);">
                        ${I18n.t('veh_insurance_title')}
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('veh_insurance_company')} *</label>
                        <input type="text" class="form-input" id="vehCompaniaSeguro" value="${vehicle?.companiaSeguro || ''}" placeholder="La Caja, Sancor, etc.">
                    </div>
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label">${I18n.t('veh_coverage_type')}</label>
                            <input type="text" class="form-input" id="vehTipoCobertura" value="${vehicle?.tipoCobertura || ''}" placeholder="Terceros Completo">
                        </div>
                        <div class="form-group">
                            <label class="form-label">${I18n.t('veh_emergency_phone')}</label>
                            <input type="tel" class="form-input" id="vehTelefonoAuxilio" value="${vehicle?.telefonoAuxilio || ''}" placeholder="0800...">
                        </div>
                    </div>
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
                        ${I18n.t('veh_base_zone')}
                    </div>
                    <div class="form-group">
                        <label class="form-label">${I18n.t('veh_zone_label')}</label>
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
        const odometer = parseFloat(document.getElementById('vehOdometer')?.value);
        const status = document.getElementById('vehStatus')?.value;
        const color = document.getElementById('vehColor')?.value;
        const vtvIssueDate = document.getElementById('vehVtvIssue')?.value || null;
        const vtvExpiryDate = document.getElementById('vehVtvExpiry')?.value || null;

        // Finanzas y Seguros
        const metodoPago = document.getElementById('vehMetodoPago')?.value;
        const esPrendario = document.getElementById('vehEsPrendario')?.checked || false;
        const fechaOtorgamiento = document.getElementById('vehFechaOtorgamiento')?.value || null;
        const diaVencimientoStr = document.getElementById('vehDiaVencimiento')?.value;
        const diaVencimiento = diaVencimientoStr ? parseInt(diaVencimientoStr) : null;
        const cuotasTotales = parseInt(document.getElementById('vehCuotasTotales')?.value) || 0;
        const cuotasPagas = parseInt(document.getElementById('vehCuotasPagas')?.value) || 0;
        const valorCuota = parseFloat(document.getElementById('vehValorCuota')?.value) || 0;
        const companiaSeguro = document.getElementById('vehCompaniaSeguro')?.value.trim();
        const tipoCobertura = document.getElementById('vehTipoCobertura')?.value.trim() || '';
        const telefonoAuxilio = document.getElementById('vehTelefonoAuxilio')?.value.trim() || '';

        // VALIDACIÓN DE CAMPOS OBLIGATORIOS
        if (!name || !plate || !year || isNaN(odometer) || !status || !color || !metodoPago || !companiaSeguro) {
            Components.showToast(I18n.t('error') + ': ' + I18n.t('required') + ' (Completa todos los campos con *)', 'danger');
            return;
        }

        const odometerKm = Units.toKm(odometer);

        const data = {
            name, plate, year,
            currentOdometer: odometerKm,
            status,
            color,
            metodoPago,
            esPrendario,
            cuotasTotales,
            cuotasPagas,
            valorCuota,
            companiaSeguro,
            tipoCobertura,
            telefonoAuxilio
        };
        
        if (fechaOtorgamiento) data.fechaOtorgamiento = fechaOtorgamiento;
        if (diaVencimiento !== null) data.diaVencimiento = diaVencimiento;

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

    // Funciones dinámicas del formulario de finanzas
    function calcRemaining() {
        const total = parseInt(document.getElementById('vehCuotasTotales')?.value) || 0;
        const pagas = parseInt(document.getElementById('vehCuotasPagas')?.value) || 0;
        const rest = document.getElementById('vehCuotasRestantes');
        if (rest) {
            let val = total - pagas;
            rest.value = val < 0 ? 0 : val;
        }
    }

    function toggleFinanceFields() {
        const method = document.getElementById('vehMetodoPago')?.value;
        const fields = document.getElementById('financeFields');
        if (fields) {
            fields.style.display = method === 'Crédito' ? 'block' : 'none';
        }
    }

    function togglePrendario() {
        const isChecked = document.getElementById('vehEsPrendario')?.checked;
        const warning = document.getElementById('prendarioWarning');
        if (warning) {
            warning.style.display = isChecked ? 'block' : 'none';
        }
    }

    function toggleExpand(vehicleId) {
        const body = document.getElementById(`veh-body-${vehicleId}`);
        const chevron = document.getElementById(`veh-chevron-${vehicleId}`);
        if (!body) return;

        const isOpen = body.style.display !== 'none';
        
        // Close all others if desired? (Optional usability choice, keeps UI very clean)
        document.querySelectorAll('.veh-expanded-body').forEach(b => {
            if (b.id !== `veh-body-${vehicleId}`) {
                b.style.display = 'none';
                const targetId = b.id.replace('veh-body-', '');
                const targetChev = document.getElementById(`veh-chevron-${targetId}`);
                if (targetChev) targetChev.style.transform = 'rotate(0deg)';
            }
        });

        if (isOpen) {
            body.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        } else {
            body.style.display = 'block';
            if (chevron) chevron.style.transform = 'rotate(90deg)';
            // Add slight glow hover effect to show active
            body.parentElement.style.borderColor = 'var(--color-primary)';
            setTimeout(() => {
                body.parentElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 100);
        }
    }

    return { 
        render, showForm, saveVehicle, deleteVehicle, showVtvEditor, saveVtv,
        calcRemaining, toggleFinanceFields, togglePrendario, toggleExpand
    };
})();
