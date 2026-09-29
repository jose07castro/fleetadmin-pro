/* ============================================
   FleetAdmin Pro — Balance de Costos Fijos por Km
   Cálculo y análisis de costo operativo por km:
   - GNC, 100% Eléctricos, Híbridos y Nafta
   - Neumáticos cada 60.000 km
   - Cambio de aceite cada 10.000 km ($0 para eléctricos)
   - Seguro mensual prorrateado
   - Simulador interactivo de kilometraje
   ============================================ */

const VehicleCostsModule = (() => {
    let _simulatedKm = 5000; // Kilómetros mensuales por defecto para la simulación
    let _selectedFilter = 'all'; // 'all', 'gnc', 'electric', 'hybrid', 'nafta', 'diesel'
    let _searchQuery = '';
    let _selectedVehicleId = null;

    // Valores de referencia por defecto para la flota
    const DEFAULT_COSTS = {
        gnc: {
            label: 'GNC (Nafta + GNC)',
            badge: '⛽ GNC',
            badgeClass: 'badge-gnc',
            color: '#3b82f6',
            combustibleKm: 48, // $/km en GNC
            neumaticos: 540000, // 4 neumáticos c/60.000 km
            intervaloNeumaticos: 60000,
            aceite: 85000, // c/10.000 km
            intervaloAceite: 10000,
            seguro: 70000 // $/mes
        },
        electric: {
            label: '100% Eléctrico (EV)',
            badge: '⚡ 100% Eléctrico',
            badgeClass: 'badge-electric',
            color: '#10b981',
            combustibleKm: 20, // $/km en recarga eléctrica
            neumaticos: 560000, // c/60.000 km
            intervaloNeumaticos: 60000,
            aceite: 0, // $0 - No utiliza aceite de motor ni filtros
            intervaloAceite: 10000,
            seguro: 85000
        },
        hybrid: {
            label: 'Híbrido (HEV / PHEV)',
            badge: '🔋 Híbrido',
            badgeClass: 'badge-hybrid',
            color: '#06b6d4',
            combustibleKm: 55, // $/km consumo mixto
            neumaticos: 540000,
            intervaloNeumaticos: 60000,
            aceite: 85000,
            intervaloAceite: 10000,
            seguro: 75000
        },
        nafta: {
            label: 'Nafta Tradicional',
            badge: '🛢️ Nafta',
            badgeClass: 'badge-nafta',
            color: '#64748b',
            combustibleKm: 115, // $/km nafta súper ciudad
            neumaticos: 540000,
            intervaloNeumaticos: 60000,
            aceite: 85000,
            intervaloAceite: 10000,
            seguro: 70000
        },
        diesel: {
            label: 'Diésel / Gasoil',
            badge: '🚜 Diésel',
            badgeClass: 'badge-diesel',
            color: '#78716c',
            combustibleKm: 105,
            neumaticos: 560000,
            intervaloNeumaticos: 60000,
            aceite: 95000,
            intervaloAceite: 10000,
            seguro: 70000
        }
    };

    /**
     * Calcula las métricas completas de costo para un vehículo según sus valores o defaults
     */
    function calculateVehicleCostMetrics(vehicle, monthlyKm = _simulatedKm) {
        const motorType = (vehicle.motorType || 'gnc').toLowerCase();
        const defaults = DEFAULT_COSTS[motorType] || DEFAULT_COSTS.gnc;

        // Combustible / Energía por km
        const combustibleKm = (vehicle.costoCombustibleKm !== undefined && vehicle.costoCombustibleKm !== null && vehicle.costoCombustibleKm !== '')
            ? parseFloat(vehicle.costoCombustibleKm)
            : defaults.combustibleKm;

        // Neumáticos cada 60.000 km
        const costoNeumaticos = (vehicle.costoNeumaticos !== undefined && vehicle.costoNeumaticos !== null && vehicle.costoNeumaticos !== '')
            ? parseFloat(vehicle.costoNeumaticos)
            : defaults.neumaticos;
        const intervaloNeumaticos = parseInt(vehicle.kmIntervaloNeumaticos) || 60000;
        const neumaticosKm = intervaloNeumaticos > 0 ? (costoNeumaticos / intervaloNeumaticos) : 0;

        // Aceite y Filtros cada 10.000 km ($0 si es eléctrico)
        const isElectric = motorType === 'electric';
        const costoAceite = isElectric ? 0 : ((vehicle.costoCambioAceite !== undefined && vehicle.costoCambioAceite !== null && vehicle.costoCambioAceite !== '')
            ? parseFloat(vehicle.costoCambioAceite)
            : defaults.aceite);
        const intervaloAceite = parseInt(vehicle.kmIntervaloAceite) || 10000;
        const aceiteKm = (isElectric || intervaloAceite <= 0) ? 0 : (costoAceite / intervaloAceite);

        // Seguro mensual prorrateado
        const costoSeguroMensual = (vehicle.costoSeguroMensual !== undefined && vehicle.costoSeguroMensual !== null && vehicle.costoSeguroMensual !== '')
            ? parseFloat(vehicle.costoSeguroMensual)
            : defaults.seguro;
        const kmBase = monthlyKm > 0 ? monthlyKm : 5000;
        const seguroKm = costoSeguroMensual / kmBase;

        // Otros costos fijos opcionales (Patente, VTV, etc.)
        const costoPatenteMensual = parseFloat(vehicle.costoPatenteMensual) || 0;
        const patenteKm = costoPatenteMensual / kmBase;

        const costoMantenimientoExtraKm = parseFloat(vehicle.costoMantenimientoExtraKm) || 0;

        // Costo Total por Kilómetro
        const costoTotalKm = combustibleKm + neumaticosKm + aceiteKm + seguroKm + patenteKm + costoMantenimientoExtraKm;

        // Proyecciones
        const costoMensual = costoTotalKm * kmBase;
        const costoAnual = costoMensual * 12;
        const costo1000Km = costoTotalKm * 1000;
        const costo60000Km = costoTotalKm * 60000;

        // Porcentajes para barra de distribución
        const pctCombustible = costoTotalKm > 0 ? (combustibleKm / costoTotalKm) * 100 : 0;
        const pctNeumaticos = costoTotalKm > 0 ? (neumaticosKm / costoTotalKm) * 100 : 0;
        const pctAceite = costoTotalKm > 0 ? (aceiteKm / costoTotalKm) * 100 : 0;
        const pctSeguro = costoTotalKm > 0 ? ((seguroKm + patenteKm) / costoTotalKm) * 100 : 0;

        return {
            motorType,
            defaults,
            isElectric,
            combustibleKm,
            costoNeumaticos,
            intervaloNeumaticos,
            neumaticosKm,
            costoAceite,
            intervaloAceite,
            aceiteKm,
            costoSeguroMensual,
            seguroKm,
            costoPatenteMensual,
            patenteKm,
            costoMantenimientoExtraKm,
            costoTotalKm,
            costoMensual,
            costoAnual,
            costo1000Km,
            costo60000Km,
            kmBase,
            percentages: {
                combustible: pctCombustible,
                neumaticos: pctNeumaticos,
                aceite: pctAceite,
                seguro: pctSeguro
            }
        };
    }

    /**
     * Render principal de la sección
     */
    async function render() {
        try {
            const vehicles = (await DB.getAll('vehicles')) || [];
            const globalSettings = (await DB.getSetting('fleet_cost_defaults')) || {};

            // Aplicar configuraciones globales si existen
            if (globalSettings.gnc) Object.assign(DEFAULT_COSTS.gnc, globalSettings.gnc);
            if (globalSettings.electric) Object.assign(DEFAULT_COSTS.electric, globalSettings.electric);
            if (globalSettings.hybrid) Object.assign(DEFAULT_COSTS.hybrid, globalSettings.hybrid);
            if (globalSettings.nafta) Object.assign(DEFAULT_COSTS.nafta, globalSettings.nafta);

            // Filtrar vehículos
            let filteredVehicles = vehicles;
            if (_selectedFilter !== 'all') {
                filteredVehicles = filteredVehicles.filter(v => (v.motorType || 'gnc').toLowerCase() === _selectedFilter);
            }
            if (_searchQuery) {
                const q = _searchQuery.toLowerCase();
                filteredVehicles = filteredVehicles.filter(v => 
                    (v.name && v.name.toLowerCase().includes(q)) || 
                    (v.plate && v.plate.toLowerCase().includes(q))
                );
            }

            // Calcular métricas de cada vehículo
            const vehicleMetrics = vehicles.map(v => ({
                vehicle: v,
                metrics: calculateVehicleCostMetrics(v, _simulatedKm)
            }));

            // Calcular KPIs de la flota
            let totalCostoKm = 0;
            let totalCostoMensual = 0;
            let cheapestVehicle = null;
            let mostExpensiveVehicle = null;

            if (vehicleMetrics.length > 0) {
                vehicleMetrics.forEach(item => {
                    totalCostoKm += item.metrics.costoTotalKm;
                    totalCostoMensual += item.metrics.costoMensual;
                    if (!cheapestVehicle || item.metrics.costoTotalKm < cheapestVehicle.metrics.costoTotalKm) {
                        cheapestVehicle = item;
                    }
                    if (!mostExpensiveVehicle || item.metrics.costoTotalKm > mostExpensiveVehicle.metrics.costoTotalKm) {
                        mostExpensiveVehicle = item;
                    }
                });
            }

            const avgCostoKm = vehicleMetrics.length > 0 ? (totalCostoKm / vehicleMetrics.length) : 0;

            // Ahorro teórico de flota comparando el promedio con Nafta pura
            const naftaRefCost = (DEFAULT_COSTS.nafta.combustibleKm + 
                                 (DEFAULT_COSTS.nafta.neumaticos / 60000) + 
                                 (DEFAULT_COSTS.nafta.aceite / 10000) + 
                                 (DEFAULT_COSTS.nafta.seguro / _simulatedKm));
            const ahorroXKmVsNafta = Math.max(0, naftaRefCost - avgCostoKm);
            const ahorroMensualFlota = ahorroXKmVsNafta * _simulatedKm * (vehicleMetrics.length || 1);

            return `
                <div class="vehicle-costs-container" style="animation: fadeIn 0.4s ease-out; padding-bottom: 60px;">
                    <!-- Sub-nav Tabs -->
                    <div style="display:flex; gap:10px; margin-bottom:20px; border-bottom:1px solid var(--border-color); padding-bottom:12px; overflow-x:auto;">
                        <button class="btn btn-sm btn-secondary" onclick="Router.navigate('balances')" style="font-weight:700; border-radius:20px; padding:6px 16px; background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-color);">
                            💰 Movimientos & WhatsApp
                        </button>
                        <button class="btn btn-sm btn-primary" style="font-weight:700; border-radius:20px; padding:6px 16px;">
                            🚗 Costos Fijos x Km (GNC, Eléctricos, Neumáticos)
                        </button>
                    </div>

                    <!-- Header -->
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:24px;">
                        <div>
                            <h2 style="font-size:var(--font-size-2xl); font-weight:800; margin:0; color:var(--text-primary); display:flex; align-items:center; gap:10px;">
                                <span>📊 Balance de Costos Fijos por Km</span>
                                <span class="badge" style="background:rgba(59, 130, 246, 0.2); color:#60a5fa; border:1px solid rgba(59, 130, 246, 0.4); font-size:12px; font-weight:700; padding:4px 10px;">
                                    Flota Pro
                                </span>
                            </h2>
                            <p style="margin:6px 0 0 0; color:var(--text-secondary); font-size:var(--font-size-sm); max-width:800px;">
                                Costo operativo real por vehículo: GNC, 100% Eléctricos, Híbridos, Nafta, desgaste de neumáticos c/60.000 km, aceite c/10.000 km y seguro mensual.
                            </p>
                        </div>
                        <div style="display:flex; gap:10px; flex-wrap:wrap;">
                            <button class="btn btn-secondary" onclick="VehicleCostsModule.showGlobalSettingsModal()" style="font-weight:700; font-size:0.88rem; display:flex; align-items:center; gap:6px;">
                                ⚙️ Precios de Referencia
                            </button>
                            <button class="btn btn-secondary" onclick="VehicleCostsModule.exportComparisonCSV()" style="font-weight:600; font-size:0.88rem; display:flex; align-items:center; gap:6px;">
                                📄 Exportar CSV
                            </button>
                            <button class="btn btn-primary" onclick="VehiclesModule.showForm()" style="font-weight:700; font-size:0.88rem; display:flex; align-items:center; gap:6px;">
                                ➕ Nuevo Auto
                            </button>
                        </div>
                    </div>

                    <!-- KPI Cards Summary -->
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; margin-bottom:24px;">
                        <!-- Costo Promedio Flota -->
                        <div class="card" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:16px; padding:18px; position:relative; overflow:hidden;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-size:0.85rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Costo Promedio Flota</span>
                                <span style="font-size:1.4rem;">📉</span>
                            </div>
                            <div style="font-size:2rem; font-weight:900; color:#38bdf8; font-family:monospace;">
                                $${avgCostoKm.toFixed(2)} <span style="font-size:1rem; font-weight:600; color:var(--text-secondary);">/ km</span>
                            </div>
                            <div style="font-size:0.82rem; color:var(--text-secondary); margin-top:6px;">
                                Basado en ${_formatNumber(_simulatedKm)} km/mes por vehículo
                            </div>
                        </div>

                        <!-- Auto Más Económico -->
                        <div class="card" style="background:linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(5, 150, 105, 0.04)); border:1px solid rgba(16, 185, 129, 0.35); border-radius:16px; padding:18px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-size:0.85rem; font-weight:700; color:#10b981; text-transform:uppercase; letter-spacing:0.5px;">Más Eficiente</span>
                                <span style="font-size:1.4rem;">🏆</span>
                            </div>
                            <div style="font-size:2rem; font-weight:900; color:#10b981; font-family:monospace;">
                                $${cheapestVehicle ? cheapestVehicle.metrics.costoTotalKm.toFixed(2) : '0.00'} <span style="font-size:1rem; font-weight:600; color:var(--text-secondary);">/ km</span>
                            </div>
                            <div style="font-size:0.85rem; font-weight:700; color:var(--text-primary); margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                ${cheapestVehicle ? `${cheapestVehicle.vehicle.name || 'Vehículo'} (${cheapestVehicle.vehicle.plate || ''})` : 'Sin vehículos'}
                            </div>
                        </div>

                        <!-- Ahorro Mensual Estimado vs Nafta -->
                        <div class="card" style="background:linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(37, 99, 235, 0.04)); border:1px solid rgba(59, 130, 246, 0.35); border-radius:16px; padding:18px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-size:0.85rem; font-weight:700; color:#60a5fa; text-transform:uppercase; letter-spacing:0.5px;">Ahorro Flota vs Nafta</span>
                                <span style="font-size:1.4rem;">💡</span>
                            </div>
                            <div style="font-size:2rem; font-weight:900; color:#60a5fa; font-family:monospace;">
                                $${_formatNumber(Math.round(ahorroMensualFlota))} <span style="font-size:1rem; font-weight:600; color:var(--text-secondary);">/ mes</span>
                            </div>
                            <div style="font-size:0.82rem; color:var(--text-secondary); margin-top:6px;">
                                Gracias al uso de GNC, Híbridos y Eléctricos
                            </div>
                        </div>

                        <!-- Gasto Operativo Mensual Proyectado -->
                        <div class="card" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:16px; padding:18px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-size:0.85rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Gasto Mensual Flota</span>
                                <span style="font-size:1.4rem;">💼</span>
                            </div>
                            <div style="font-size:2rem; font-weight:900; color:var(--text-primary); font-family:monospace;">
                                $${_formatNumber(Math.round(totalCostoMensual))}
                            </div>
                            <div style="font-size:0.82rem; color:var(--text-secondary); margin-top:6px;">
                                Costo total operativo proyectado al mes
                            </div>
                        </div>
                    </div>

                    <!-- Panel de Control Interactivo: Simulador de KM y Filtros -->
                    <div class="card" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:16px; padding:20px; margin-bottom:24px; box-shadow:var(--shadow-md);">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:16px;">
                            <div>
                                <h3 style="margin:0; font-size:1.1rem; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                    <span>🎚️ Simulador de Kilómetros Mensuales</span>
                                    <span style="font-size:0.8rem; font-weight:600; color:var(--text-secondary);">(Impacto del seguro y costos fijos)</span>
                                </h3>
                                <p style="margin:4px 0 0 0; font-size:0.82rem; color:var(--text-secondary);">
                                    A mayor kilometraje recorrido en el mes, el costo del seguro y la patente se diluyen, bajando el costo por kilómetro.
                                </p>
                            </div>
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="font-size:1.4rem; font-weight:900; color:#38bdf8; font-family:monospace;" id="simulatedKmDisplay">
                                    ${_formatNumber(_simulatedKm)} km / mes
                                </span>
                            </div>
                        </div>

                        <!-- Slider -->
                        <div style="display:flex; align-items:center; gap:16px; margin-bottom:14px;">
                            <span style="font-size:0.8rem; color:var(--text-secondary); font-weight:700;">1.000 km</span>
                            <input type="range" id="kmSlider" min="1000" max="15000" step="500" value="${_simulatedKm}" 
                                oninput="VehicleCostsModule.onKmSliderInput(this.value)" 
                                onchange="VehicleCostsModule.onKmSliderChange(this.value)"
                                style="flex:1; cursor:pointer; accent-color:#38bdf8; height:8px; border-radius:4px;">
                            <span style="font-size:0.8rem; color:var(--text-secondary); font-weight:700;">15.000 km</span>
                        </div>

                        <!-- Botones Rápidos de Km & Filtros de Motorización -->
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                            <!-- Botones rápidos de km -->
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                <button class="btn btn-sm ${Math.round(_simulatedKm) === 3000 ? 'btn-primary' : 'btn-secondary'}" onclick="VehicleCostsModule.setSimulatedKm(3000)" style="font-size:12px; font-weight:700; border-radius:12px; padding:4px 10px;">
                                    3.000 km/m
                                </button>
                                <button class="btn btn-sm ${Math.round(_simulatedKm) === 5000 ? 'btn-primary' : 'btn-secondary'}" onclick="VehicleCostsModule.setSimulatedKm(5000)" style="font-size:12px; font-weight:700; border-radius:12px; padding:4px 10px;">
                                    5.000 km/m
                                </button>
                                <button class="btn btn-sm ${Math.round(_simulatedKm) === 7500 ? 'btn-primary' : 'btn-secondary'}" onclick="VehicleCostsModule.setSimulatedKm(7500)" style="font-size:12px; font-weight:700; border-radius:12px; padding:4px 10px;">
                                    7.500 km/m
                                </button>
                                <button class="btn btn-sm ${Math.round(_simulatedKm) === 10000 ? 'btn-primary' : 'btn-secondary'}" onclick="VehicleCostsModule.setSimulatedKm(10000)" style="font-size:12px; font-weight:700; border-radius:12px; padding:4px 10px;">
                                    10.000 km/m
                                </button>
                            </div>

                            <!-- Filtro de tipo de motor -->
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                <button class="btn btn-sm ${_selectedFilter === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="VehicleCostsModule.setFilter('all')" style="font-size:12px; font-weight:700; border-radius:12px; padding:4px 10px;">
                                    Todos (${vehicles.length})
                                </button>
                                <button class="btn btn-sm ${_selectedFilter === 'gnc' ? 'btn-primary' : 'btn-secondary'}" onclick="VehicleCostsModule.setFilter('gnc')" style="font-size:12px; font-weight:700; border-radius:12px; padding:4px 10px;">
                                    ⛽ GNC
                                </button>
                                <button class="btn btn-sm ${_selectedFilter === 'electric' ? 'btn-primary' : 'btn-secondary'}" onclick="VehicleCostsModule.setFilter('electric')" style="font-size:12px; font-weight:700; border-radius:12px; padding:4px 10px;">
                                    ⚡ Eléctricos 100%
                                </button>
                                <button class="btn btn-sm ${_selectedFilter === 'hybrid' ? 'btn-primary' : 'btn-secondary'}" onclick="VehicleCostsModule.setFilter('hybrid')" style="font-size:12px; font-weight:700; border-radius:12px; padding:4px 10px;">
                                    🔋 Híbridos
                                </button>
                                <button class="btn btn-sm ${_selectedFilter === 'nafta' ? 'btn-primary' : 'btn-secondary'}" onclick="VehicleCostsModule.setFilter('nafta')" style="font-size:12px; font-weight:700; border-radius:12px; padding:4px 10px;">
                                    🛢️ Nafta
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Grilla de Tarjetas de Vehículos -->
                    <div style="margin-bottom:32px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                            <h3 style="margin:0; font-size:1.25rem; font-weight:800; color:var(--text-primary);">
                                🚗 Desglose por Vehículo (${filteredVehicles.length})
                            </h3>
                            <div style="width:240px;">
                                <input type="text" class="form-input" placeholder="🔍 Buscar por modelo o patente..." 
                                    value="${_searchQuery}" oninput="VehicleCostsModule.onSearchInput(this.value)" 
                                    style="padding:6px 12px; font-size:13px; border-radius:20px;">
                            </div>
                        </div>

                        ${filteredVehicles.length > 0 ? `
                            <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); gap:20px;">
                                ${filteredVehicles.map(v => _renderVehicleCostCard(v)).join('')}
                            </div>
                        ` : Components.renderEmptyState(
                            '🚗',
                            'No se encontraron vehículos',
                            'No hay autos que coincidan con el filtro seleccionado.',
                            `<button class="btn btn-primary" onclick="VehiclesModule.showForm()">➕ Agregar Vehículo</button>`
                        )}
                    </div>

                    <!-- Tabla Comparativa Global de la Flota -->
                    ${vehicles.length > 0 ? `
                        <div class="card" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:16px; padding:20px; margin-bottom:32px; box-shadow:var(--shadow-sm);">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
                                <div>
                                    <h3 style="margin:0; font-size:1.15rem; font-weight:800; color:var(--text-primary);">
                                        📋 Tabla Resumen Comparativa de Costos
                                    </h3>
                                    <p style="margin:4px 0 0 0; font-size:0.82rem; color:var(--text-secondary);">
                                        Ranking de vehículos ordenados del menor al mayor costo por kilómetro.
                                    </p>
                                </div>
                            </div>

                            <div style="overflow-x:auto;">
                                <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
                                    <thead>
                                        <tr style="border-bottom:2px solid var(--border-color); color:var(--text-secondary); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">
                                            <th style="padding:10px 12px;">Vehículo</th>
                                            <th style="padding:10px 12px;">Propulsión</th>
                                            <th style="padding:10px 12px; text-align:right;">Combustible/Km</th>
                                            <th style="padding:10px 12px; text-align:right;">Neumáticos (c/60k)</th>
                                            <th style="padding:10px 12px; text-align:right;">Aceite (c/10k)</th>
                                            <th style="padding:10px 12px; text-align:right;">Seguro/Km</th>
                                            <th style="padding:10px 12px; text-align:right; font-weight:800; color:var(--color-primary);">TOTAL / KM</th>
                                            <th style="padding:10px 12px; text-align:right;">Costo Mensual</th>
                                            <th style="padding:10px 12px; text-align:center;">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${vehicleMetrics.sort((a, b) => a.metrics.costoTotalKm - b.metrics.costoTotalKm).map((item, idx) => {
                                            const v = item.vehicle;
                                            const m = item.metrics;
                                            const isTop1 = idx === 0;
                                            return `
                                                <tr style="border-bottom:1px solid var(--border-color); ${isTop1 ? 'background:rgba(16, 185, 129, 0.05);' : ''}">
                                                    <td style="padding:12px; font-weight:700; color:var(--text-primary);">
                                                        ${isTop1 ? '🥇 ' : ''}${v.name || 'Vehículo'}
                                                        <div style="font-size:11px; font-family:monospace; color:var(--text-secondary);">${v.plate || ''} • ${v.year || ''}</div>
                                                    </td>
                                                    <td style="padding:12px;">
                                                        <span class="badge" style="background:${m.defaults.color}; color:#fff; font-size:11px; font-weight:700; padding:3px 8px; border-radius:12px;">
                                                            ${m.defaults.badge}
                                                        </span>
                                                    </td>
                                                    <td style="padding:12px; text-align:right; font-family:monospace; color:#38bdf8;">
                                                        $${m.combustibleKm.toFixed(2)}
                                                    </td>
                                                    <td style="padding:12px; text-align:right; font-family:monospace; color:#f97316;">
                                                        $${m.neumaticosKm.toFixed(2)}
                                                    </td>
                                                    <td style="padding:12px; text-align:right; font-family:monospace; color:${m.isElectric ? '#10b981' : '#eab308'}; font-weight:${m.isElectric ? '800' : 'normal'};">
                                                        ${m.isElectric ? '⚡ $0.00' : `$${m.aceiteKm.toFixed(2)}`}
                                                    </td>
                                                    <td style="padding:12px; text-align:right; font-family:monospace; color:#a855f7;">
                                                        $${m.seguroKm.toFixed(2)}
                                                    </td>
                                                    <td style="padding:12px; text-align:right; font-family:monospace; font-size:15px; font-weight:900; color:#38bdf8;">
                                                        $${m.costoTotalKm.toFixed(2)}
                                                    </td>
                                                    <td style="padding:12px; text-align:right; font-family:monospace; font-weight:700; color:var(--text-primary);">
                                                        $${_formatNumber(Math.round(m.costoMensual))}
                                                    </td>
                                                    <td style="padding:12px; text-align:center;">
                                                        <button class="btn btn-sm btn-secondary" onclick="VehicleCostsModule.showEditCostsModal('${v.id}')" style="font-size:11px; padding:4px 8px; font-weight:700;">
                                                            ✏️ Ajustar
                                                        </button>
                                                    </td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ` : ''}

                    <!-- Matriz Comparativa Educativa: Ahorro acumulado a los 60.000 km -->
                    <div class="card" style="background:linear-gradient(135deg, rgba(30, 41, 59, 0.95), rgba(15, 23, 42, 0.95)); border:1px solid rgba(255, 255, 255, 0.1); border-radius:20px; padding:24px; box-shadow:var(--shadow-lg);">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:20px;">
                            <div>
                                <h3 style="margin:0; font-size:1.25rem; font-weight:800; color:#fff; display:flex; align-items:center; gap:10px;">
                                    <span>⚡ Comparativa de Propulsión: Ahorro en 60.000 Km</span>
                                    <span class="badge" style="background:#10b981; color:#fff; font-size:11px; font-weight:800;">Retorno de Inversión</span>
                                </h3>
                                <p style="margin:6px 0 0 0; color:#94a3b8; font-size:0.85rem;">
                                    Cálculo integral incluyendo el juego de 4 neumáticos ($540k), los 6 cambios de aceite c/10.000 km ($510k) y el combustible para 60.000 km.
                                </p>
                            </div>
                        </div>

                        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px;">
                            <!-- 100% Eléctrico -->
                            <div style="background:rgba(16, 185, 129, 0.08); border:2px solid #10b981; border-radius:16px; padding:18px; text-align:center;">
                                <div style="font-size:2rem; margin-bottom:4px;">⚡</div>
                                <div style="font-weight:800; color:#10b981; font-size:1.1rem;">100% Eléctrico (EV)</div>
                                <div style="font-size:0.8rem; color:#94a3b8; margin-top:2px;">$20/km recarga • $0 Aceite</div>
                                
                                <div style="margin:16px 0; border-top:1px solid rgba(16, 185, 129, 0.2); border-bottom:1px solid rgba(16, 185, 129, 0.2); padding:12px 0;">
                                    <div style="font-size:0.75rem; text-transform:uppercase; color:#94a3b8; font-weight:700;">Gasto en 60.000 km</div>
                                    <div style="font-size:1.6rem; font-weight:900; color:#10b981; font-family:monospace; margin-top:2px;">
                                        $${_formatNumber(60000 * 20 + 540000 + 0 + (70000 / _simulatedKm * 60000))}
                                    </div>
                                </div>

                                <div class="badge" style="background:#10b981; color:#fff; font-weight:800; font-size:12px; width:100%; justify-content:center; padding:6px 0;">
                                    🏆 Máximo Ahorro (+65%)
                                </div>
                            </div>

                            <!-- GNC -->
                            <div style="background:rgba(59, 130, 246, 0.08); border:1px solid rgba(59, 130, 246, 0.4); border-radius:16px; padding:18px; text-align:center;">
                                <div style="font-size:2rem; margin-bottom:4px;">⛽</div>
                                <div style="font-weight:800; color:#3b82f6; font-size:1.1rem;">Nafta + GNC</div>
                                <div style="font-size:0.8rem; color:#94a3b8; margin-top:2px;">$48/km GNC • Aceite c/10k</div>
                                
                                <div style="margin:16px 0; border-top:1px solid rgba(59, 130, 246, 0.2); border-bottom:1px solid rgba(59, 130, 246, 0.2); padding:12px 0;">
                                    <div style="font-size:0.75rem; text-transform:uppercase; color:#94a3b8; font-weight:700;">Gasto en 60.000 km</div>
                                    <div style="font-size:1.6rem; font-weight:900; color:#38bdf8; font-family:monospace; margin-top:2px;">
                                        $${_formatNumber(60000 * 48 + 540000 + (6 * 85000) + (70000 / _simulatedKm * 60000))}
                                    </div>
                                </div>

                                <div class="badge" style="background:rgba(59, 130, 246, 0.2); color:#60a5fa; font-weight:700; font-size:12px; width:100%; justify-content:center; padding:6px 0;">
                                    ⭐ Estándar Flotillero (+45%)
                                </div>
                            </div>

                            <!-- Híbrido -->
                            <div style="background:rgba(6, 182, 212, 0.08); border:1px solid rgba(6, 182, 212, 0.4); border-radius:16px; padding:18px; text-align:center;">
                                <div style="font-size:2rem; margin-bottom:4px;">🔋</div>
                                <div style="font-weight:800; color:#06b6d4; font-size:1.1rem;">Híbrido (HEV)</div>
                                <div style="font-size:0.8rem; color:#94a3b8; margin-top:2px;">$55/km mixto • Sin tubo GNC</div>
                                
                                <div style="margin:16px 0; border-top:1px solid rgba(6, 182, 212, 0.2); border-bottom:1px solid rgba(6, 182, 212, 0.2); padding:12px 0;">
                                    <div style="font-size:0.75rem; text-transform:uppercase; color:#94a3b8; font-weight:700;">Gasto en 60.000 km</div>
                                    <div style="font-size:1.6rem; font-weight:900; color:#06b6d4; font-family:monospace; margin-top:2px;">
                                        $${_formatNumber(60000 * 55 + 540000 + (6 * 85000) + (75000 / _simulatedKm * 60000))}
                                    </div>
                                </div>

                                <div class="badge" style="background:rgba(6, 182, 212, 0.2); color:#22d3ee; font-weight:700; font-size:12px; width:100%; justify-content:center; padding:6px 0;">
                                    🌱 Confort & Ahorro (+40%)
                                </div>
                            </div>

                            <!-- Nafta -->
                            <div style="background:rgba(100, 116, 139, 0.08); border:1px solid rgba(100, 116, 139, 0.4); border-radius:16px; padding:18px; text-align:center;">
                                <div style="font-size:2rem; margin-bottom:4px;">🛢️</div>
                                <div style="font-weight:800; color:#94a3b8; font-size:1.1rem;">Nafta Pura</div>
                                <div style="font-size:0.8rem; color:#94a3b8; margin-top:2px;">$115/km ciudad • Aceite c/10k</div>
                                
                                <div style="margin:16px 0; border-top:1px solid rgba(100, 116, 139, 0.2); border-bottom:1px solid rgba(100, 116, 139, 0.2); padding:12px 0;">
                                    <div style="font-size:0.75rem; text-transform:uppercase; color:#94a3b8; font-weight:700;">Gasto en 60.000 km</div>
                                    <div style="font-size:1.6rem; font-weight:900; color:#f87171; font-family:monospace; margin-top:2px;">
                                        $${_formatNumber(60000 * 115 + 540000 + (6 * 85000) + (70000 / _simulatedKm * 60000))}
                                    </div>
                                </div>

                                <div class="badge" style="background:rgba(239, 68, 68, 0.15); color:#fca5a5; font-weight:700; font-size:12px; width:100%; justify-content:center; padding:6px 0;">
                                    ❌ Costo Más Elevado
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } catch (err) {
            console.error('Error rendering VehicleCostsModule:', err);
            return `<div class="card p-4"><h3>Error cargando balance de costos: ${err.message}</h3></div>`;
        }
    }

    /**
     * Renderiza la tarjeta detallada de un vehículo
     */
    function _renderVehicleCostCard(vehicle) {
        const m = calculateVehicleCostMetrics(vehicle, _simulatedKm);
        const v = vehicle;

        return `
            <div class="card vehicle-cost-card" id="vCostCard_${v.id}" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:18px; padding:20px; display:flex; flex-direction:column; justify-content:space-between; gap:16px; box-shadow:var(--shadow-sm); position:relative; overflow:hidden;">
                <!-- Header de la Tarjeta -->
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;">
                        <div>
                            <h4 style="margin:0; font-size:1.2rem; font-weight:800; color:var(--text-primary);">
                                ${v.name || 'Vehículo'}
                            </h4>
                            <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:2px; display:flex; align-items:center; gap:6px;">
                                <span style="font-family:monospace; font-weight:700; background:var(--bg-tertiary); padding:1px 6px; border-radius:4px; border:1px solid var(--border-color);">
                                    ${v.plate || 'SIN PATENTE'}
                                </span>
                                <span>•</span>
                                <span>${v.year || '2020'}</span>
                            </div>
                        </div>
                        <span class="badge" style="background:${m.defaults.color}; color:#fff; font-size:11px; font-weight:800; padding:4px 10px; border-radius:12px; white-space:nowrap;">
                            ${m.defaults.badge}
                        </span>
                    </div>

                    <!-- Gran Métrica de Costo por Km -->
                    <div style="background:linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.8)); border:1px solid var(--border-color); border-radius:14px; padding:14px; margin-bottom:14px; text-align:center;">
                        <div style="font-size:0.75rem; text-transform:uppercase; font-weight:800; color:var(--text-secondary); letter-spacing:0.5px;">
                            Costo Total por Kilómetro
                        </div>
                        <div style="font-size:2.4rem; font-weight:900; color:#38bdf8; font-family:monospace; line-height:1.1; margin:4px 0;">
                            $${m.costoTotalKm.toFixed(2)}
                            <span style="font-size:1rem; font-weight:600; color:var(--text-secondary);">/ km</span>
                        </div>
                        <div style="font-size:0.82rem; color:var(--text-secondary); display:flex; justify-content:center; gap:12px; margin-top:6px;">
                            <span>Cada 1.000 km: <strong>$${_formatNumber(Math.round(m.costo1000Km))}</strong></span>
                            <span>•</span>
                            <span>Mes (${_formatNumber(m.kmBase)} km): <strong>$${_formatNumber(Math.round(m.costoMensual))}</strong></span>
                        </div>
                    </div>

                    <!-- Barra de Distribución Porcentual -->
                    <div style="margin-bottom:14px;">
                        <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700; margin-bottom:4px; color:var(--text-secondary);">
                            <span>Distribución del Costo</span>
                            <span>100%</span>
                        </div>
                        <div style="display:flex; height:10px; border-radius:5px; overflow:hidden; background:var(--bg-tertiary); box-shadow:inset 0 1px 2px rgba(0,0,0,0.2);">
                            <div title="Combustible/Energía: ${m.percentages.combustible.toFixed(1)}%" style="width:${m.percentages.combustible}%; background:#38bdf8;"></div>
                            <div title="Neumáticos c/60k: ${m.percentages.neumaticos.toFixed(1)}%" style="width:${m.percentages.neumaticos}%; background:#f97316;"></div>
                            ${!m.isElectric ? `<div title="Aceite c/10k: ${m.percentages.aceite.toFixed(1)}%" style="width:${m.percentages.aceite}%; background:#eab308;"></div>` : ''}
                            <div title="Seguro Mensual: ${m.percentages.seguro.toFixed(1)}%" style="width:${m.percentages.seguro}%; background:#a855f7;"></div>
                        </div>
                        <div style="display:flex; justify-content:space-between; flex-wrap:wrap; font-size:10px; color:var(--text-secondary); margin-top:4px; gap:4px;">
                            <span style="display:inline-flex; align-items:center; gap:3px;"><span style="width:6px; height:6px; border-radius:50%; background:#38bdf8;"></span> Combustible (${m.percentages.combustible.toFixed(0)}%)</span>
                            <span style="display:inline-flex; align-items:center; gap:3px;"><span style="width:6px; height:6px; border-radius:50%; background:#f97316;"></span> Neumáticos (${m.percentages.neumaticos.toFixed(0)}%)</span>
                            ${!m.isElectric ? `<span style="display:inline-flex; align-items:center; gap:3px;"><span style="width:6px; height:6px; border-radius:50%; background:#eab308;"></span> Aceite (${m.percentages.aceite.toFixed(0)}%)</span>` : '<span style="color:#10b981; font-weight:700;">⚡ Sin Aceite</span>'}
                            <span style="display:inline-flex; align-items:center; gap:3px;"><span style="width:6px; height:6px; border-radius:50%; background:#a855f7;"></span> Seguro (${m.percentages.seguro.toFixed(0)}%)</span>
                        </div>
                    </div>

                    <!-- Tabla de Desglose de Costos Unitarios -->
                    <div style="background:var(--bg-tertiary); border:1px solid var(--border-color); border-radius:12px; padding:10px; font-size:12px;">
                        <!-- Combustible / Energía -->
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                            <span style="color:var(--text-secondary); display:flex; align-items:center; gap:6px;">
                                <span>${m.isElectric ? '⚡ Recarga Eléctrica' : (m.motorType === 'gnc' ? '⛽ GNC Estimado' : (m.motorType === 'hybrid' ? '🔋 Nafta / Híbrido' : '🛢️ Combustible'))}:</span>
                            </span>
                            <span style="font-weight:800; font-family:monospace; color:#38bdf8;">
                                $${m.combustibleKm.toFixed(2)} / km
                            </span>
                        </div>

                        <!-- Neumáticos cada 60.000 km -->
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                            <span style="color:var(--text-secondary);">
                                🛞 Neumáticos (${_formatNumber(m.intervaloNeumaticos)} km):
                                <div style="font-size:10px; color:var(--text-tertiary);">$${_formatNumber(m.costoNeumaticos)} juego 4</div>
                            </span>
                            <span style="font-weight:800; font-family:monospace; color:#f97316;">
                                $${m.neumaticosKm.toFixed(2)} / km
                            </span>
                        </div>

                        <!-- Aceite cada 10.000 km -->
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
                            <span style="color:var(--text-secondary);">
                                🛢️ Cambio Aceite (${_formatNumber(m.intervaloAceite)} km):
                                ${!m.isElectric ? `<div style="font-size:10px; color:var(--text-tertiary);">$${_formatNumber(m.costoAceite)} service completo</div>` : ''}
                            </span>
                            <span style="font-weight:800; font-family:monospace; color:${m.isElectric ? '#10b981' : '#eab308'};">
                                ${m.isElectric ? '⚡ $0.00 / km' : `$${m.aceiteKm.toFixed(2)} / km`}
                            </span>
                        </div>

                        <!-- Seguro Mensual -->
                        <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0;">
                            <span style="color:var(--text-secondary);">
                                🛡️ Seguro Mensual:
                                <div style="font-size:10px; color:var(--text-tertiary);">$${_formatNumber(m.costoSeguroMensual)}/mes</div>
                            </span>
                            <span style="font-weight:800; font-family:monospace; color:#a855f7;">
                                $${m.seguroKm.toFixed(2)} / km
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Botones de Acción -->
                <div style="display:flex; gap:8px; margin-top:8px;">
                    <button class="btn btn-sm btn-primary" onclick="VehicleCostsModule.showEditCostsModal('${v.id}')" style="flex:1; font-weight:700; font-size:12px; justify-content:center;">
                        ✏️ Ajustar Costos
                    </button>
                    <button class="btn btn-sm btn-secondary" onclick="VehicleCostsModule.showMotorComparisonModal('${v.id}')" style="font-weight:700; font-size:12px; justify-content:center;" title="Comparar con otros motores">
                        ⚖️ Comparar
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Modal para editar los costos específicos de un vehículo
     */
    async function showEditCostsModal(vehicleId) {
        const vehicle = await DB.get('vehicles', vehicleId);
        if (!vehicle) {
            Components.showToast('No se encontró el vehículo', 'danger');
            return;
        }

        const m = calculateVehicleCostMetrics(vehicle, _simulatedKm);

        Components.showModal(
            `📊 Configurar Costos x Km: ${vehicle.name || 'Vehículo'} (${vehicle.plate || ''})`,
            `
                <div style="display:flex; flex-direction:column; gap:16px;">
                    <!-- Tipo de Motor -->
                    <div class="form-group">
                        <label class="form-label" style="font-weight:700;">Tipo de Motorización *</label>
                        <select class="form-select" id="editMotorType" onchange="VehicleCostsModule.onEditModalMotorTypeChange()">
                            <option value="gnc" ${m.motorType === 'gnc' ? 'selected' : ''}>⛽ Nafta + GNC (Gas Natural Comprimido)</option>
                            <option value="electric" ${m.motorType === 'electric' ? 'selected' : ''}>⚡ 100% Eléctrico (EV — Batería)</option>
                            <option value="hybrid" ${m.motorType === 'hybrid' ? 'selected' : ''}>🔋 Híbrido (HEV / PHEV — Nafta + Regenerativo)</option>
                            <option value="nafta" ${m.motorType === 'nafta' ? 'selected' : ''}>🛢️ Nafta Tradicional</option>
                            <option value="diesel" ${m.motorType === 'diesel' ? 'selected' : ''}>🚜 Diésel / Gasoil</option>
                        </select>
                        <div style="font-size:0.75rem; color:var(--text-tertiary); margin-top:4px;">
                            Selecciona la motorización para precargar los valores sugeridos.
                        </div>
                    </div>

                    <!-- Costo Combustible / Energía -->
                    <div class="form-group">
                        <label class="form-label" style="font-weight:700;" id="lblCombustible">
                            Costo Combustible / GNC / Energía ($ por cada km) *
                        </label>
                        <input type="number" step="0.5" class="form-input" id="editCostoCombustibleKm" 
                            value="${m.combustibleKm}" placeholder="Ej: 48 ($/km)">
                        <div id="hintCombustible" style="font-size:0.75rem; color:var(--text-tertiary); margin-top:4px;">
                            GNC aprox $45-$55/km • Eléctrico aprox $18-$25/km • Nafta aprox $110-$130/km
                        </div>
                    </div>

                    <!-- Neumáticos -->
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label" style="font-weight:700;">Costo Juego 4 Neumáticos ($) *</label>
                            <input type="number" class="form-input" id="editCostoNeumaticos" 
                                value="${m.costoNeumaticos}" placeholder="Ej: 540000">
                        </div>
                        <div class="form-group">
                            <label class="form-label" style="font-weight:700;">Intervalo Neumáticos (km)</label>
                            <input type="number" class="form-input" id="editIntervaloNeumaticos" 
                                value="${m.intervaloNeumaticos}" placeholder="60000">
                        </div>
                    </div>

                    <!-- Aceite y Filtros -->
                    <div class="repair-form-grid" id="editAceiteContainer">
                        <div class="form-group">
                            <label class="form-label" style="font-weight:700;" id="lblAceite">
                                Costo Cambio Aceite y Filtros ($)
                            </label>
                            <input type="number" class="form-input" id="editCostoCambioAceite" 
                                value="${m.costoAceite}" ${m.isElectric ? 'disabled style="background:var(--bg-tertiary); opacity:0.6;"' : ''} placeholder="Ej: 85000">
                            <div id="hintAceite" style="font-size:0.75rem; color:${m.isElectric ? '#10b981' : 'var(--text-tertiary)'}; margin-top:4px;">
                                ${m.isElectric ? '⚡ $0/km: Los autos 100% eléctricos no llevan aceite de motor' : 'Service de aceite + filtros + mano de obra'}
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label" style="font-weight:700;">Intervalo Aceite (km)</label>
                            <input type="number" class="form-input" id="editIntervaloAceite" 
                                value="${m.intervaloAceite}" ${m.isElectric ? 'disabled style="background:var(--bg-tertiary); opacity:0.6;"' : ''} placeholder="10000">
                        </div>
                    </div>

                    <!-- Seguro Mensual y Km -->
                    <div class="repair-form-grid">
                        <div class="form-group">
                            <label class="form-label" style="font-weight:700;">Seguro Mensual ($/mes) *</label>
                            <input type="number" class="form-input" id="editCostoSeguroMensual" 
                                value="${m.costoSeguroMensual}" placeholder="Ej: 70000">
                        </div>
                        <div class="form-group">
                            <label class="form-label" style="font-weight:700;">Patente / Otros Fijos ($/mes)</label>
                            <input type="number" class="form-input" id="editCostoPatenteMensual" 
                                value="${m.costoPatenteMensual}" placeholder="Ej: 15000">
                        </div>
                    </div>

                    <!-- Kilómetros Estimados -->
                    <div class="form-group">
                        <label class="form-label" style="font-weight:700;">Kilómetros Mensuales Promedio (km/mes)</label>
                        <input type="number" class="form-input" id="editKmMensualesEstimados" 
                            value="${vehicle.kmMensualesEstimados || _simulatedKm}" placeholder="Ej: 5000">
                        <div style="font-size:0.75rem; color:var(--text-tertiary); margin-top:4px;">
                            Utilizado como base para prorratear los costos fijos de este auto.
                        </div>
                    </div>
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">Cancelar</button>
                <button class="btn btn-primary" onclick="VehicleCostsModule.saveVehicleCosts('${vehicleId}')">💾 Guardar Costos</button>
            `
        );
    }

    /**
     * Dispara cuando el usuario cambia el selector de motorización en el modal de edición
     */
    function onEditModalMotorTypeChange() {
        const type = document.getElementById('editMotorType')?.value;
        const defaults = DEFAULT_COSTS[type] || DEFAULT_COSTS.gnc;
        const isElectric = type === 'electric';

        const inputCombustible = document.getElementById('editCostoCombustibleKm');
        const inputAceite = document.getElementById('editCostoCambioAceite');
        const inputIntervaloAceite = document.getElementById('editIntervaloAceite');
        const hintAceite = document.getElementById('hintAceite');
        const hintCombustible = document.getElementById('hintCombustible');

        if (inputCombustible) inputCombustible.value = defaults.combustibleKm;

        if (inputAceite && inputIntervaloAceite && hintAceite) {
            if (isElectric) {
                inputAceite.value = 0;
                inputAceite.disabled = true;
                inputAceite.style.background = 'var(--bg-tertiary)';
                inputAceite.style.opacity = '0.6';
                inputIntervaloAceite.disabled = true;
                hintAceite.innerHTML = '⚡ $0/km: Los autos 100% eléctricos no llevan aceite de motor';
                hintAceite.style.color = '#10b981';
            } else {
                if (parseFloat(inputAceite.value) === 0) inputAceite.value = defaults.aceite;
                inputAceite.disabled = false;
                inputAceite.style.background = '';
                inputAceite.style.opacity = '';
                inputIntervaloAceite.disabled = false;
                hintAceite.innerHTML = 'Service de aceite + filtros + mano de obra';
                hintAceite.style.color = 'var(--text-tertiary)';
            }
        }

        if (hintCombustible) {
            if (type === 'gnc') hintCombustible.innerText = 'GNC aprox $45-$55/km (según m³ y rendimiento)';
            else if (type === 'electric') hintCombustible.innerText = 'Electricidad aprox $18-$25/km (consumo ~15 kWh / 100 km)';
            else if (type === 'hybrid') hintCombustible.innerText = 'Híbrido aprox $50-$60/km (rendimiento ~22 km/l nafta)';
            else if (type === 'nafta') hintCombustible.innerText = 'Nafta aprox $110-$130/km (rendimiento ~10 km/l)';
            else if (type === 'diesel') hintCombustible.innerText = 'Diésel aprox $100-$115/km';
        }
    }

    /**
     * Guarda los costos del vehículo
     */
    async function saveVehicleCosts(vehicleId) {
        try {
            const motorType = document.getElementById('editMotorType')?.value || 'gnc';
            const costoCombustibleKm = parseFloat(document.getElementById('editCostoCombustibleKm')?.value) || 0;
            const costoNeumaticos = parseFloat(document.getElementById('editCostoNeumaticos')?.value) || 0;
            const kmIntervaloNeumaticos = parseInt(document.getElementById('editIntervaloNeumaticos')?.value) || 60000;
            const costoCambioAceite = motorType === 'electric' ? 0 : (parseFloat(document.getElementById('editCostoCambioAceite')?.value) || 0);
            const kmIntervaloAceite = parseInt(document.getElementById('editIntervaloAceite')?.value) || 10000;
            const costoSeguroMensual = parseFloat(document.getElementById('editCostoSeguroMensual')?.value) || 0;
            const costoPatenteMensual = parseFloat(document.getElementById('editCostoPatenteMensual')?.value) || 0;
            const kmMensualesEstimados = parseInt(document.getElementById('editKmMensualesEstimados')?.value) || 5000;

            const updateData = {
                motorType,
                costoCombustibleKm,
                costoNeumaticos,
                kmIntervaloNeumaticos,
                costoCambioAceite,
                kmIntervaloAceite,
                costoSeguroMensual,
                costoPatenteMensual,
                kmMensualesEstimados
            };

            await DB.update('vehicles', vehicleId, updateData);
            Components.closeModal();
            Components.showToast('✅ Costos del vehículo actualizados con éxito', 'success');

            // Refrescar vista
            Router.navigate('vehicle-costs');
        } catch (err) {
            console.error('Error guardando costos:', err);
            Components.showToast('Error al guardar: ' + err.message, 'danger');
        }
    }

    /**
     * Modal interactivo para comparar cómo rendiría este vehículo con diferentes motorizaciones
     */
    async function showMotorComparisonModal(vehicleId) {
        const vehicle = await DB.get('vehicles', vehicleId);
        if (!vehicle) return;

        const currentMetrics = calculateVehicleCostMetrics(vehicle, _simulatedKm);
        const kmRef = 60000; // Para el intervalo completo de neumáticos

        // Simular los 4 tipos para este vehículo manteniendo el mismo seguro y neumáticos
        const tipos = ['electric', 'gnc', 'hybrid', 'nafta'];
        const rows = tipos.map(t => {
            const tempVeh = Object.assign({}, vehicle, {
                motorType: t,
                costoCombustibleKm: DEFAULT_COSTS[t].combustibleKm,
                costoCambioAceite: DEFAULT_COSTS[t].aceite
            });
            const m = calculateVehicleCostMetrics(tempVeh, _simulatedKm);
            return {
                type: t,
                def: DEFAULT_COSTS[t],
                metrics: m,
                gasto60k: m.costo60000Km,
                ahorroVsNafta: 0
            };
        });

        const naftaGasto = rows.find(r => r.type === 'nafta')?.gasto60k || 1;
        rows.forEach(r => {
            r.ahorroVsNafta = Math.max(0, naftaGasto - r.gasto60k);
        });

        Components.showModal(
            `⚖️ Comparativa de Propulsión: ${vehicle.name || 'Vehículo'}`,
            `
                <div style="display:flex; flex-direction:column; gap:16px;">
                    <p style="font-size:0.88rem; color:var(--text-secondary); margin:0;">
                        Comparación de costos para <strong>${vehicle.name}</strong> a lo largo de <strong>60.000 km</strong> (duración de 1 juego de neumáticos) con una tasa de uso de <strong>${_formatNumber(_simulatedKm)} km/mes</strong>.
                    </p>

                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${rows.map(r => {
                            const isCurrent = r.type === currentMetrics.motorType;
                            return `
                                <div style="background:${isCurrent ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-tertiary)'}; border:1px solid ${isCurrent ? 'var(--color-primary)' : 'var(--border-color)'}; border-radius:12px; padding:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <span style="font-size:1.6rem;">${r.def.badge.split(' ')[0]}</span>
                                        <div>
                                            <div style="font-weight:800; font-size:1rem; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
                                                <span>${r.def.label}</span>
                                                ${isCurrent ? '<span class="badge badge-primary" style="font-size:10px; padding:1px 6px;">Actual</span>' : ''}
                                            </div>
                                            <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">
                                                Combustible: $${r.metrics.combustibleKm}/km • Aceite: ${r.type === 'electric' ? '$0' : `$${r.metrics.aceiteKm.toFixed(2)}/km`}
                                            </div>
                                        </div>
                                    </div>

                                    <div style="text-align:right;">
                                        <div style="font-size:1.25rem; font-weight:900; color:#38bdf8; font-family:monospace;">
                                            $${r.metrics.costoTotalKm.toFixed(2)} / km
                                        </div>
                                        <div style="font-size:0.8rem; font-weight:700; color:${r.ahorroVsNafta > 0 ? '#10b981' : 'var(--text-secondary)'}; margin-top:2px;">
                                            ${r.ahorroVsNafta > 0 ? `Ahorro en 60k km: +$${_formatNumber(Math.round(r.ahorroVsNafta))}` : 'Base de comparación'}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `,
            `<button class="btn btn-primary" onclick="Components.closeModal()">Cerrar</button>`
        );
    }

    /**
     * Modal para configurar valores globales de referencia
     */
    async function showGlobalSettingsModal() {
        Components.showModal(
            `⚙️ Precios de Referencia Globales para la Flota`,
            `
                <div style="display:flex; flex-direction:column; gap:16px;">
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin:0;">
                        Estos precios se utilizarán como valores sugeridos para todos los vehículos que no tengan un costo personalizado.
                    </p>

                    <div style="border-top:1px solid var(--border-color); padding-top:12px;">
                        <h4 style="margin:0 0 10px 0; font-size:0.95rem; color:#3b82f6;">⛽ GNC (Gas Natural Comprimido)</h4>
                        <div class="form-group">
                            <label class="form-label">Costo Estimativo GNC ($ / km)</label>
                            <input type="number" step="0.5" class="form-input" id="globGncKm" value="${DEFAULT_COSTS.gnc.combustibleKm}">
                        </div>
                    </div>

                    <div style="border-top:1px solid var(--border-color); padding-top:12px;">
                        <h4 style="margin:0 0 10px 0; font-size:0.95rem; color:#10b981;">⚡ 100% Eléctricos (EV)</h4>
                        <div class="form-group">
                            <label class="form-label">Costo Estimativo Electricidad ($ / km)</label>
                            <input type="number" step="0.5" class="form-input" id="globElectricKm" value="${DEFAULT_COSTS.electric.combustibleKm}">
                        </div>
                    </div>

                    <div style="border-top:1px solid var(--border-color); padding-top:12px;">
                        <h4 style="margin:0 0 10px 0; font-size:0.95rem; color:#06b6d4;">🔋 Híbridos (HEV / PHEV)</h4>
                        <div class="form-group">
                            <label class="form-label">Costo Estimativo Nafta/Mixto ($ / km)</label>
                            <input type="number" step="0.5" class="form-input" id="globHybridKm" value="${DEFAULT_COSTS.hybrid.combustibleKm}">
                        </div>
                    </div>

                    <div style="border-top:1px solid var(--border-color); padding-top:12px;">
                        <h4 style="margin:0 0 10px 0; font-size:0.95rem; color:#64748b;">🛢️ Nafta Pura</h4>
                        <div class="form-group">
                            <label class="form-label">Costo Estimativo Nafta Ciudad ($ / km)</label>
                            <input type="number" step="0.5" class="form-input" id="globNaftaKm" value="${DEFAULT_COSTS.nafta.combustibleKm}">
                        </div>
                    </div>
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">Cancelar</button>
                <button class="btn btn-primary" onclick="VehicleCostsModule.saveGlobalSettings()">💾 Guardar Precios</button>
            `
        );
    }

    /**
     * Guarda la configuración de precios globales
     */
    async function saveGlobalSettings() {
        try {
            const gncKm = parseFloat(document.getElementById('globGncKm')?.value) || 48;
            const electricKm = parseFloat(document.getElementById('globElectricKm')?.value) || 20;
            const hybridKm = parseFloat(document.getElementById('globHybridKm')?.value) || 55;
            const naftaKm = parseFloat(document.getElementById('globNaftaKm')?.value) || 115;

            const newDefaults = {
                gnc: { combustibleKm: gncKm },
                electric: { combustibleKm: electricKm },
                hybrid: { combustibleKm: hybridKm },
                nafta: { combustibleKm: naftaKm }
            };

            await DB.setSetting('fleet_cost_defaults', newDefaults);
            Components.closeModal();
            Components.showToast('✅ Precios de referencia actualizados', 'success');
            Router.navigate('vehicle-costs');
        } catch (err) {
            console.error('Error guardando precios globales:', err);
            Components.showToast('Error al guardar: ' + err.message, 'danger');
        }
    }

    /**
     * Eventos de interacción en vivo
     */
    function onKmSliderInput(val) {
        _simulatedKm = parseFloat(val) || 5000;
        const display = document.getElementById('simulatedKmDisplay');
        if (display) {
            display.innerText = `${_formatNumber(_simulatedKm)} km / mes`;
        }
    }

    function onKmSliderChange(val) {
        _simulatedKm = parseFloat(val) || 5000;
        Router.navigate('vehicle-costs');
    }

    function setSimulatedKm(val) {
        _simulatedKm = val;
        Router.navigate('vehicle-costs');
    }

    function setFilter(type) {
        _selectedFilter = type;
        Router.navigate('vehicle-costs');
    }

    function onSearchInput(query) {
        _searchQuery = query;
        Router.navigate('vehicle-costs');
    }

    function selectVehicle(vehicleId) {
        _selectedVehicleId = vehicleId;
        setTimeout(() => {
            const card = document.getElementById(`vCostCard_${vehicleId}`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.outline = '3px solid #38bdf8';
                card.style.transform = 'scale(1.02)';
                setTimeout(() => {
                    card.style.outline = '';
                    card.style.transform = '';
                }, 2000);
            }
        }, 100);
    }

    /**
     * Exporta el balance comparativo de costos a formato CSV / Excel
     */
    async function exportComparisonCSV() {
        const vehicles = (await DB.getAll('vehicles')) || [];
        if (vehicles.length === 0) {
            Components.showToast('No hay vehículos para exportar', 'warning');
            return;
        }

        let csv = 'Vehiculo;Patente;Año;Motorizacion;Costo_Combustible_Km;Neumaticos_Total;Intervalo_Neumaticos_Km;Neumaticos_Km;Aceite_Total;Intervalo_Aceite_Km;Aceite_Km;Seguro_Mensual;Km_Mensuales_Simulados;Seguro_Km;COSTO_TOTAL_KM;Gasto_Mensual_Estimado;Gasto_Anual_Estimado\n';

        vehicles.forEach(v => {
            const m = calculateVehicleCostMetrics(v, _simulatedKm);
            csv += `"${v.name || ''}";"${v.plate || ''}";${v.year || ''};"${m.defaults.label}";${m.combustibleKm};${m.costoNeumaticos};${m.intervaloNeumaticos};${m.neumaticosKm.toFixed(2)};${m.costoAceite};${m.intervaloAceite};${m.aceiteKm.toFixed(2)};${m.costoSeguroMensual};${m.kmBase};${m.seguroKm.toFixed(2)};${m.costoTotalKm.toFixed(2)};${Math.round(m.costoMensual)};${Math.round(m.costoAnual)}\n`;
        });

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Balance_Costos_x_Km_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        Components.showToast('✅ Archivo CSV descargado con éxito', 'success');
    }

    // Helper de formato de números con separador de miles
    function _formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return Number(num).toLocaleString('es-AR');
    }

    return {
        render,
        calculateVehicleCostMetrics,
        showEditCostsModal,
        onEditModalMotorTypeChange,
        saveVehicleCosts,
        showMotorComparisonModal,
        showGlobalSettingsModal,
        saveGlobalSettings,
        onKmSliderInput,
        onKmSliderChange,
        setSimulatedKm,
        setFilter,
        onSearchInput,
        selectVehicle,
        exportComparisonCSV
    };
})();

window.VehicleCostsModule = VehicleCostsModule;
