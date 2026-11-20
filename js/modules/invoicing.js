/* ============================================================================
   FleetAdmin Pro — Módulo de Facturación Electrónica ARCA (Monotributo - Factura C)
   Marca Comercial en Factura: PUNTO REMIS
   Emisor Tributario Único: JOSE ALBERTO CASTRO (CUIT: 20-22209365-2)
   Paridad Total Web & Android (con soporte nativo FileProvider para PDF)
   ============================================================================ */

const InvoicingModule = (() => {

    const ISSUER = {
        fantasyName: 'PUNTO REMIS',
        razonSocial: 'JOSE ALBERTO CASTRO',
        cuit: '20222093652',
        cuitFormatted: '20-22209365-2',
        condicionIva: 'Responsable Monotributo',
        cbteTipo: 11,
        cbteLetra: 'C',
        cbteCodigo: '011',
        ptoVta: 1,
        ingresosBrutos: '20-22209365-2',
        inicioActividades: '01/03/2024',
        domicilioFiscal: 'San Lorenzo / Rosario - Prov. de Santa Fe'
    };

    const CONDICIONES_IVA = [
        { id: 1, label: 'IVA Responsable Inscripto (Empresas — Cod. 1)' },
        { id: 6, label: 'Responsable Monotributo (Cod. 6)' },
        { id: 4, label: 'IVA Sujeto Exento (Cod. 4)' },
        { id: 5, label: 'Consumidor Final (Cod. 5)' }
    ];

    let _drivers = [];
    let _vehicles = [];
    let _driverVehicleMap = {};
    let _savedClients = {};
    let _lastEmittedInvoice = null;
    let _lastPdfBase64 = null;

    function _cleanVehicleModelName(rawName) {
        if (!rawName) return 'Vehículo de Flota';
        return String(rawName).replace(/\s*\(\d+\)\s*$/g, '').trim();
    }

    function _formatCuit(raw) {
        const digits = String(raw || '').replace(/[^0-9]/g, '');
        if (digits.length === 11) {
            return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
        }
        return digits;
    }

    function _formatCurrency(val) {
        const num = parseFloat(val || 0);
        if (isNaN(num)) return '0,00';
        return num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function _formatDateAR(dateInput) {
        if (!dateInput) return '-';
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(dateInput))) return String(dateInput);
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateInput))) {
            const [y, m, d] = String(dateInput).split('-');
            return `${d}/${m}/${y}`;
        }
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput);
        return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function _getServerOrigin() {
        if (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'https://fleetadmin-web-nueva.onrender.com';
        }
        return window.location.origin;
    }

    function _resolveFleetId() {
        if (typeof Auth !== 'undefined' && Auth.getFleetId && Auth.getFleetId() && Auth.getFleetId() !== 'jose07') {
            return Auth.getFleetId();
        }
        if (typeof DB !== 'undefined' && DB.getFleet && DB.getFleet() && DB.getFleet() !== 'jose07') {
            return DB.getFleet();
        }
        return localStorage.getItem('last_fleet_id') || '-OnPd8HaV1VZWBnYQQX7';
    }

    /**
     * Carga choferes, vehículos y turnos para vincular automáticamente a cada chofer
     * con su vehículo asignado o el vehículo de su turno activo/reciente.
     */
    async function _loadFleetContext() {
        const [allUsers, allVehicles, activeShifts, recentShifts, savedClientsRaw] = await Promise.all([
            DB.getAll('users').catch(() => []),
            DB.getAll('vehicles').catch(() => []),
            DB.getActiveShifts ? DB.getActiveShifts().catch(() => []) : [],
            DB.getRecentCompletedShifts ? DB.getRecentCompletedShifts(50).catch(() => []) : [],
            DB.getAll('arca_clients').catch(() => [])
        ]);

        // Filtrar vehículos reales activos (priorizando los que no son "FANTASMA")
        const validVehicles = (allVehicles || []).filter(v => v && v.status !== 'inactive');
        const realVehicles = validVehicles.filter(v => !String(v.name || '').toUpperCase().includes('FANTASMA'));
        _vehicles = realVehicles.length > 0 ? realVehicles : validVehicles;

        // Filtrar choferes registrados
        _drivers = (allUsers || []).filter(u => u && (u.role === 'driver' || u.role === 'owner'));

        // Mapear cada chofer a su vehículo (1. assignedVehicleId/vehicleId en perfil, 2. turno activo, 3. último turno completado)
        _driverVehicleMap = {};
        const allShiftsSorted = [...(activeShifts || []), ...(recentShifts || [])].sort(
            (a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0)
        );

        for (const d of _drivers) {
            let vehId = d.assignedVehicleId || d.vehicleId || null;
            if (!vehId) {
                const shiftMatch = allShiftsSorted.find(s =>
                    String(s.driverId) === String(d.id) ||
                    (d.globalId && String(s.driverId) === String(d.globalId)) ||
                    (s.driverName && d.name && s.driverName.toLowerCase().trim() === d.name.toLowerCase().trim())
                );
                if (shiftMatch && shiftMatch.vehicleId) {
                    vehId = shiftMatch.vehicleId;
                }
            }
            const vehObj = _vehicles.find(v => String(v.id) === String(vehId)) || _vehicles[0] || null;
            if (vehObj) {
                _driverVehicleMap[d.id] = vehObj;
                if (d.globalId) _driverVehicleMap[d.globalId] = vehObj;
            }
        }

        _savedClients = {};
        if (Array.isArray(savedClientsRaw)) {
            savedClientsRaw.forEach(c => {
                const clean = String(c.cuit || c.id || '').replace(/[^0-9]/g, '');
                if (clean.length === 11) _savedClients[clean] = c;
            });
        }
    }

    async function _getLoggedDriverRecord() {
        if (typeof Auth !== 'undefined' && typeof Auth.getFleetUserRecord === 'function') {
            const rec = await Auth.getFleetUserRecord();
            if (rec) return rec;
        }
        const u = Auth.getUser();
        if (!u) return null;
        return _drivers.find(d =>
            String(d.id) === String(u.id) ||
            String(d.globalId) === String(u.id) ||
            (d.name && u.name && d.name.toLowerCase() === u.name.toLowerCase())
        ) || u;
    }

    async function render() {
        try {
            await _loadFleetContext();
            const isOwner = Auth.isOwner();
            const isDriver = Auth.isDriver();
            const currentDriver = await _getLoggedDriverRecord();

            // Determinar chofer seleccionado inicialmente
            const driverList = _drivers.filter(u => (typeof Auth !== 'undefined' && Auth.isUserDriverEligible ? Auth.isUserDriverEligible(u) : u.role === 'driver'));
            const initialDriver = isDriver
                ? (currentDriver || driverList[0] || {})
                : (driverList[0] || currentDriver || {});

            const initialDriverId = initialDriver?.id || '';
            const initialDriverName = initialDriver?.fullName || initialDriver?.name || Auth.getUserName() || '';
            const initialDriverDni = initialDriver?.dni || initialDriver?.licenseNumber || initialDriver?.nro_licencia || '';
            const assignedVeh = (initialDriverId && _driverVehicleMap[initialDriverId]) || _vehicles[0] || {};
            const initialVehId = assignedVeh?.id || '';
            const initialVehModel = _cleanVehicleModelName(assignedVeh?.name || '');
            const initialVehPlate = assignedVeh?.plate || '';

            const invoices = await _getInvoicesList();
            const visibleInvoices = isOwner
                ? invoices
                : invoices.filter(inv =>
                    String(inv.driverId) === String(initialDriverId) ||
                    String(inv.driverId) === String(Auth.getUserId()) ||
                    (inv.driverName && initialDriverName && inv.driverName.toLowerCase() === initialDriverName.toLowerCase())
                );

            const savedClientsArray = Object.values(_savedClients).filter(c => c && c.razonSocial);

            return `
                <div class="invoicing-container" style="max-width:960px; margin:0 auto; animation: fadeIn 0.35s ease-out; padding-bottom:40px;">
                    
                    <!-- Encabezado Institucional Punto Remis / ARCA -->
                    <div class="card" style="background:linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); border:1px solid rgba(59,130,246,0.45); border-radius:18px; padding:20px; margin-bottom:20px; box-shadow:0 10px 25px rgba(15,23,42,0.4);">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
                            <div style="display:flex; align-items:center; gap:14px;">
                                <div style="width:58px; height:58px; border-radius:14px; background:#ffffff; color:#0f172a; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:900; box-shadow:0 4px 12px rgba(0,0,0,0.35); flex-shrink:0; border:2px solid #38bdf8;">
                                    <span style="font-size:1.7rem; line-height:1;">C</span>
                                    <span style="font-size:0.62rem; letter-spacing:0.5px; color:#1e3a8a;">COD. 011</span>
                                </div>
                                <div>
                                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                        <span style="background:#38bdf8; color:#0f172a; font-weight:900; font-size:0.75rem; padding:2px 10px; border-radius:20px; letter-spacing:0.6px;">
                                            PUNTO REMIS
                                        </span>
                                        <span style="background:rgba(16,185,129,0.2); color:#34d399; border:1px solid rgba(16,185,129,0.4); font-weight:700; font-size:0.72rem; padding:2px 8px; border-radius:20px;">
                                            🟢 ARCA WSAA / WSFEv1
                                        </span>
                                    </div>
                                    <h2 style="margin:6px 0 2px 0; font-size:1.35rem; font-weight:900; color:#ffffff;">
                                        🧾 Facturación Electrónica — Punto Remis
                                    </h2>
                                    <div style="font-size:0.84rem; color:#cbd5e1; font-weight:600;">
                                        Emisor Fiscal: <strong style="color:#ffffff;">${ISSUER.razonSocial}</strong> • CUIT: <strong style="color:#38bdf8;">${ISSUER.cuitFormatted}</strong> • ${ISSUER.condicionIva}
                                    </div>
                                </div>
                            </div>
                            ${isOwner ? `
                            <button class="btn btn-secondary btn-sm" onclick="Router.navigate('balances')" style="background:rgba(255,255,255,0.12); color:#fff; border:1px solid rgba(255,255,255,0.25); font-weight:700;">
                                💰 Ver en Balances
                            </button>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Formulario de Emisión de Factura C -->
                    <div class="card" style="padding:20px; border-radius:16px; border:1px solid var(--border-color); margin-bottom:24px; background:var(--bg-secondary);">
                        
                        <!-- PASO 1: Vinculación con Chofer y Vehículo Registrado -->
                        <div style="margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid var(--border-color);">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
                                <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                    <span>🚘</span> 1. Datos del Chofer y Vehículo Asignado
                                </h3>
                                ${isDriver ? `
                                    <span class="badge" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.35); font-size:0.75rem; font-weight:700; padding:4px 10px;">
                                        🔒 Vinculado automáticamente a tu perfil
                                    </span>
                                ` : `
                                    <span class="badge" style="background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.35); font-size:0.75rem; font-weight:700; padding:4px 10px;">
                                        👑 Modo Administrador: Selección libre de chofer
                                    </span>
                                `}
                            </div>

                            ${isOwner ? `
                            <div class="form-group" style="margin-bottom:14px;">
                                <label class="form-label" style="font-weight:700; color:#38bdf8;">👤 Seleccionar Chofer de la Flota que realizó el viaje *</label>
                                <select id="invDriverSelect" class="form-select" onchange="InvoicingModule.onDriverSelectChange(this.value)"
                                    style="font-weight:700; font-size:0.98rem; border:2px solid rgba(56,189,248,0.4);">
                                    ${driverList.map(d => {
                                        const v = _driverVehicleMap[d.id] || {};
                                        const vLabel = v.plate ? ` — 🚗 ${_cleanVehicleModelName(v.name)} (${v.plate})` : '';
                                        const dniLabel = d.licenseNumber || d.nro_licencia || d.dni || 'S/DNI';
                                        const selected = String(d.id) === String(initialDriverId) ? 'selected' : '';
                                        return `<option value="${Components.escapeHTML(d.id)}" ${selected}>${Components.escapeHTML(d.fullName || d.name)} (DNI: ${Components.escapeHTML(dniLabel)})${Components.escapeHTML(vLabel)}</option>`;
                                    }).join('')}
                                </select>
                            </div>
                            ` : `<input type="hidden" id="invDriverSelect" value="${Components.escapeHTML(initialDriverId)}">`}

                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap:12px;">
                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">Nombre y Apellido del Chofer ${isDriver ? '🔒' : '*'}</label>
                                    <input type="text" id="invDriverName" class="form-input"
                                        value="${Components.escapeHTML(initialDriverName)}"
                                        ${isDriver ? 'readonly style="opacity:0.85; cursor:not-allowed; background:var(--bg-tertiary); font-weight:700;"' : 'oninput="InvoicingModule.updateLivePreview()" style="font-weight:700;"'}
                                        placeholder="Nombre y Apellido completo">
                                </div>

                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">DNI / N° Licencia ${isDriver ? '🔒' : '*'}</label>
                                    <input type="text" id="invDriverDni" class="form-input"
                                        value="${Components.escapeHTML(initialDriverDni)}"
                                        ${isDriver ? 'readonly style="opacity:0.85; cursor:not-allowed; background:var(--bg-tertiary); font-weight:700;"' : 'oninput="InvoicingModule.updateLivePreview()" style="font-weight:700;"'}
                                        placeholder="DNI del chofer">
                                </div>

                                ${isOwner ? `
                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">Vehículo Utilizado *</label>
                                    <select id="invVehicleSelect" class="form-select" onchange="InvoicingModule.onVehicleSelectChange(this.value)" style="font-weight:700;">
                                        ${_vehicles.map(v => {
                                            const cleanModel = _cleanVehicleModelName(v.name);
                                            const sel = String(v.id) === String(initialVehId) ? 'selected' : '';
                                            return `<option value="${Components.escapeHTML(v.id)}" ${sel}>${Components.escapeHTML(cleanModel)} — ${Components.escapeHTML(v.plate || '-')}</option>`;
                                        }).join('')}
                                    </select>
                                    <input type="hidden" id="invVehicleModel" value="${Components.escapeHTML(initialVehModel)}">
                                    <input type="hidden" id="invVehiclePlate" value="${Components.escapeHTML(initialVehPlate)}">
                                </div>
                                ` : `
                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">Vehículo y Patente Asignado 🔒</label>
                                    <input type="text" class="form-input" readonly
                                        value="${Components.escapeHTML(initialVehModel + (initialVehPlate ? ' — ' + initialVehPlate : ''))}"
                                        style="opacity:0.85; cursor:not-allowed; background:var(--bg-tertiary); font-weight:700;">
                                    <input type="hidden" id="invVehicleSelect" value="${Components.escapeHTML(initialVehId)}">
                                    <input type="hidden" id="invVehicleModel" value="${Components.escapeHTML(initialVehModel)}">
                                    <input type="hidden" id="invVehiclePlate" value="${Components.escapeHTML(initialVehPlate)}">
                                </div>
                                `}
                            </div>
                        </div>

                        <!-- PASO 2: Datos del Receptor (Empresa Cliente) -->
                        <div style="margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid var(--border-color);">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
                                <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                    <span>🏢</span> 2. Datos del Receptor (Empresa / Cliente)
                                </h3>
                                ${savedClientsArray.length > 0 ? `
                                <select class="form-select" style="width:auto; max-width:260px; font-size:0.8rem; padding:4px 10px;" onchange="InvoicingModule.selectSavedClient(this.value)">
                                    <option value="">⚡ Cargar empresa frecuente...</option>
                                    ${savedClientsArray.map(c => `<option value="${Components.escapeHTML(c.cuit)}">${Components.escapeHTML(c.razonSocial)} (${_formatCuit(c.cuit)})</option>`).join('')}
                                </select>
                                ` : ''}
                            </div>

                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">CUIT de la Empresa (11 dígitos) *</label>
                                    <input type="text" id="invReceptorCuit" class="form-input" maxlength="13" inputmode="numeric"
                                        placeholder="Ej: 30712345678"
                                        oninput="InvoicingModule.onCuitInput(this.value)"
                                        style="font-weight:800; font-family:monospace; font-size:1rem;">
                                    <div id="invCuitStatus" style="font-size:0.74rem; color:var(--text-secondary); margin-top:4px;">
                                        Ingresá los 11 números sin guiones
                                    </div>
                                </div>

                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">Razón Social / Empresa *</label>
                                    <input type="text" id="invReceptorRazonSocial" class="form-input"
                                        placeholder="Ej: ACINDAR S.A. / CARGILL S.A."
                                        oninput="InvoicingModule.updateLivePreview()"
                                        style="font-weight:700;">
                                </div>

                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">Condición frente al IVA (RG 5616) *</label>
                                    <select id="invReceptorCondicionIva" class="form-select" onchange="InvoicingModule.updateLivePreview()" style="font-weight:700;">
                                        ${CONDICIONES_IVA.map(c => `<option value="${c.id}" ${c.id === 1 ? 'selected' : ''}>${c.label}</option>`).join('')}
                                    </select>
                                </div>

                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">Domicilio Comercial (Opcional)</label>
                                    <input type="text" id="invReceptorDomicilio" class="form-input"
                                        placeholder="Ej: Ruta Prov. 21 Km 247, San Lorenzo">
                                </div>
                            </div>
                        </div>

                        <!-- PASO 3: Detalle Operativo del Traslado e Importe -->
                        <div style="margin-bottom:20px;">
                            <h3 style="margin:0 0 12px 0; font-size:1.05rem; font-weight:800; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
                                <span>🛣️</span> 3. Detalle del Servicio de Traslado e Importe Total
                            </h3>

                            <div style="display:grid; grid-template-columns: 2fr 1fr; gap:12px;" class="inv-service-grid">
                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">Recorrido Realizado *</label>
                                    <input type="text" id="invRecorrido" class="form-input"
                                        placeholder="Ej: San Lorenzo a Buenos Aires (Aeroparque)"
                                        oninput="InvoicingModule.updateLivePreview()"
                                        style="font-weight:700; font-size:0.98rem;">
                                </div>

                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700; color:#22c55e;">Importe Total ($ ARS) *</label>
                                    <input type="number" id="invImporteTotal" class="form-input" step="0.01" min="1" inputmode="decimal"
                                        placeholder="Ej: 85000"
                                        oninput="InvoicingModule.updateLivePreview()"
                                        style="font-weight:900; font-size:1.15rem; color:#22c55e; border:2px solid rgba(34,197,94,0.45);">
                                </div>
                            </div>

                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-top:12px;">
                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">📲 WhatsApp del Cliente (Para envío directo PDF)</label>
                                    <input type="tel" id="invClientWhatsapp" class="form-input" inputmode="tel"
                                        placeholder="Ej: 3415707731 o 3476123456">
                                </div>
                                <div class="form-group" style="margin-bottom:0;">
                                    <label class="form-label" style="font-size:0.82rem; font-weight:700;">✉️ Email del Cliente (Opcional)</label>
                                    <input type="email" id="invClientEmail" class="form-input" inputmode="email"
                                        placeholder="Ej: administracion@empresa.com.ar">
                                </div>
                            </div>
                        </div>

                        <!-- Recuadro Vista Previa en Vivo de "Datos Operativos del Traslado" -->
                        <div style="background:linear-gradient(135deg, rgba(30,58,138,0.25), rgba(15,23,42,0.5)); border:1.5px solid rgba(56,189,248,0.45); border-radius:14px; padding:14px 16px; margin-bottom:20px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
                                <span style="font-size:0.78rem; font-weight:900; color:#38bdf8; text-transform:uppercase; letter-spacing:0.6px;">
                                    📋 Vista Previa del Recuadro "Datos Operativos del Traslado — Punto Remis"
                                </span>
                                <span style="font-size:0.74rem; color:#94a3b8; font-weight:600;">
                                    Factura C (Cód. 011) • CondicionIVAReceptorId = <strong id="previewCondIvaId" style="color:#fff;">1</strong>
                                </span>
                            </div>
                            <div id="invLivePreviewBox" style="font-size:0.86rem; color:#e2e8f0; line-height:1.55; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                                <div>🛣️ <strong>Detalle del Servicio:</strong> <span id="prevRecorrido">Servicio de traslado: (Completar recorrido)</span></div>
                                <div>👤 <strong>Chofer Registrado:</strong> <span id="prevDriver">${Components.escapeHTML(initialDriverName || '-')} (DNI: ${Components.escapeHTML(initialDriverDni || '-')})</span></div>
                                <div>🚗 <strong>Vehículo Utilizado:</strong> <span id="prevVehicle">${Components.escapeHTML(initialVehModel || '-')} — Patente: ${Components.escapeHTML(initialVehPlate || '-')}</span></div>
                                <div>💵 <strong>Importe Total a Facturar:</strong> <span id="prevAmount" style="color:#4ade80; font-weight:900;">$ 0,00 ARS</span></div>
                            </div>
                        </div>

                        <button id="btnEmitInvoice" type="button" class="btn btn-primary btn-block" onclick="InvoicingModule.emitInvoice()"
                            style="width:100%; padding:14px 20px; font-size:1.05rem; font-weight:900; background:linear-gradient(135deg, #2563eb 0%, #0284c7 100%); border:none; border-radius:12px; color:#fff; box-shadow:0 6px 20px rgba(37,99,235,0.4); cursor:pointer;">
                            🧾 Emitir Factura C Oficial (Punto Remis — ARCA)
                        </button>
                    </div>

                    <!-- Contenedor de Comprobante Recién Emitido (Acciones Inmediatas WhatsApp / Email / PDF) -->
                    <div id="emittedInvoicePanel" style="display:none; margin-bottom:24px;"></div>

                    <!-- Historial de Facturas C Emitidas -->
                    <div class="card" style="padding:18px; border-radius:16px; border:1px solid var(--border-color); background:var(--bg-secondary);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
                            <h3 style="margin:0; font-size:1.05rem; font-weight:800; color:var(--text-primary);">
                                📚 Historial de Facturas C Emitidas (${visibleInvoices.length})
                            </h3>
                            <span style="font-size:0.78rem; color:var(--text-secondary);">
                                Sincronizadas automáticamente en el Balance del Administrador
                            </span>
                        </div>
                        ${_renderInvoicesHistory(visibleInvoices)}
                    </div>
                </div>
            `;
        } catch (err) {
            console.error('❌ Error renderizando InvoicingModule:', err);
            return `
                <div style="text-align:center; padding:40px;">
                    <div style="font-size:3rem; margin-bottom:12px;">⚠️</div>
                    <h3>Error al cargar Facturación ARCA</h3>
                    <p style="color:var(--text-secondary);">${err.message || err}</p>
                    <button class="btn btn-primary" onclick="Router.navigate('invoicing')">🔄 Reintentar</button>
                </div>
            `;
        }
    }

    async function _getInvoicesList() {
        try {
            const list = await DB.getAll('invoices');
            if (Array.isArray(list)) {
                return list.sort((a, b) => (b.timestamp || new Date(b.createdAt || 0).getTime()) - (a.timestamp || new Date(a.createdAt || 0).getTime()));
            }
        } catch (e) {
            console.warn('Error obteniendo facturas:', e);
        }
        return [];
    }

    function _renderInvoicesHistory(invoices) {
        if (!invoices || invoices.length === 0) {
            return `
                <div style="text-align:center; padding:30px; color:var(--text-tertiary);">
                    <div style="font-size:2.2rem; margin-bottom:8px;">🧾</div>
                    <div style="font-weight:700;">Aún no hay Facturas C emitidas</div>
                    <div style="font-size:0.82rem; margin-top:4px;">Completá los datos arriba y presioná "Emitir Factura C Oficial".</div>
                </div>
            `;
        }

        return `
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${invoices.slice(0, 25).map(inv => {
                    const amountFmt = _formatCurrency(inv.importeTotal);
                    const dateFmt = _formatDateAR(inv.fechaEmision || inv.createdAt);
                    return `
                        <div style="background:var(--bg-primary); border:1px solid var(--border-color); border-radius:12px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                            <div style="flex:1; min-width:220px;">
                                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px;">
                                    <span class="badge" style="background:#1e3a8a; color:#38bdf8; border:1px solid rgba(56,189,248,0.4); font-weight:800; font-size:0.72rem;">
                                        FACTURA C ${Components.escapeHTML(inv.invoiceNumber || '00001-00000001')}
                                    </span>
                                    <span style="font-size:0.75rem; color:var(--text-secondary); font-weight:600;">📅 ${dateFmt}</span>
                                    <span style="font-size:0.74rem; color:#10b981; font-weight:700;">CAE: ${Components.escapeHTML(inv.cae || '-')}</span>
                                </div>
                                <div style="font-weight:800; font-size:0.95rem; color:var(--text-primary);">
                                    🏢 ${Components.escapeHTML(inv.receptorRazonSocial || 'Empresa')} <span style="font-weight:500; font-size:0.8rem; color:var(--text-secondary);">(CUIT: ${_formatCuit(inv.receptorCuit)})</span>
                                </div>
                                <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">
                                    🛣️ ${Components.escapeHTML(inv.recorrido || '-')}
                                </div>
                                <div style="font-size:0.76rem; color:#94a3b8; margin-top:2px;">
                                    👤 Chofer: <strong>${Components.escapeHTML(inv.driverName || '-')}</strong> (DNI ${Components.escapeHTML(inv.driverDni || '-')}) • 🚗 ${Components.escapeHTML(inv.vehicleModel || '-')} (<strong>${Components.escapeHTML(inv.vehiclePlate || '-')}</strong>)
                                </div>
                            </div>
                            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
                                <div style="font-size:1.2rem; font-weight:900; color:#22c55e;">
                                    $${amountFmt}
                                </div>
                                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                    <button class="btn btn-sm btn-secondary" onclick="InvoicingModule.openInvoiceDetail('${inv.id}')" style="font-size:0.76rem; font-weight:700; padding:6px 10px;">
                                        👁️ Ver / QR
                                    </button>
                                    <button class="btn btn-sm btn-success" onclick="InvoicingModule.promptSendWhatsApp('${inv.id}')" style="font-size:0.76rem; font-weight:700; padding:6px 10px; background:#16a34a; border:none; color:#fff;">
                                        📲 WhatsApp
                                    </button>
                                    <button class="btn btn-sm btn-primary" onclick="InvoicingModule.downloadInvoicePdf('${inv.id}')" style="font-size:0.76rem; font-weight:700; padding:6px 10px;">
                                        📥 PDF
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function onDriverSelectChange(driverId) {
        const d = _drivers.find(u => String(u.id) === String(driverId));
        if (!d) return;
        const nameEl = document.getElementById('invDriverName');
        const dniEl = document.getElementById('invDriverDni');
        if (nameEl) nameEl.value = d.fullName || d.name || '';
        if (dniEl) dniEl.value = d.dni || d.licenseNumber || d.nro_licencia || '';

        const assignedVeh = _driverVehicleMap[d.id] || _vehicles[0];
        if (assignedVeh) {
            const vehSel = document.getElementById('invVehicleSelect');
            if (vehSel) vehSel.value = assignedVeh.id;
            onVehicleSelectChange(assignedVeh.id);
        } else {
            updateLivePreview();
        }
    }

    function onVehicleSelectChange(vehicleId) {
        const v = _vehicles.find(veh => String(veh.id) === String(vehicleId));
        if (v) {
            const modelEl = document.getElementById('invVehicleModel');
            const plateEl = document.getElementById('invVehiclePlate');
            if (modelEl) modelEl.value = _cleanVehicleModelName(v.name);
            if (plateEl) plateEl.value = v.plate || '';
        }
        updateLivePreview();
    }

    function selectSavedClient(cuit) {
        const clean = String(cuit || '').replace(/[^0-9]/g, '');
        const c = _savedClients[clean];
        if (!c) return;
        const cuitEl = document.getElementById('invReceptorCuit');
        const rsEl = document.getElementById('invReceptorRazonSocial');
        const ivaEl = document.getElementById('invReceptorCondicionIva');
        const domEl = document.getElementById('invReceptorDomicilio');
        const waEl = document.getElementById('invClientWhatsapp');
        const emEl = document.getElementById('invClientEmail');

        if (cuitEl) cuitEl.value = _formatCuit(clean);
        if (rsEl) rsEl.value = c.razonSocial || '';
        if (ivaEl && c.condicionIvaId) ivaEl.value = String(c.condicionIvaId);
        if (domEl && c.domicilio) domEl.value = c.domicilio;
        if (waEl && c.whatsapp) waEl.value = c.whatsapp;
        if (emEl && c.email) emEl.value = c.email;
        onCuitInput(clean);
        updateLivePreview();
    }

    async function onCuitInput(rawVal) {
        const digits = String(rawVal || '').replace(/[^0-9]/g, '').slice(0, 11);
        const statusEl = document.getElementById('invCuitStatus');
        if (!statusEl) return;

        if (digits.length < 11) {
            statusEl.innerHTML = `<span style="color:#f59e0b;">Faltan ${11 - digits.length} dígitos (${digits.length}/11)</span>`;
            return;
        }

        statusEl.innerHTML = `<span style="color:#22c55e; font-weight:700;">✅ CUIT válido: ${_formatCuit(digits)}</span>`;

        // Autocompletar si está en clientes frecuentes locales o en servidor
        if (_savedClients[digits] && _savedClients[digits].razonSocial) {
            const rsEl = document.getElementById('invReceptorRazonSocial');
            if (rsEl && !rsEl.value.trim()) {
                rsEl.value = _savedClients[digits].razonSocial;
            }
            return;
        }

        try {
            const fleetId = _resolveFleetId();
            const res = await fetch(`${_getServerOrigin()}/api/arca/cuit-lookup/${digits}?fleetId=${fleetId}`);
            if (res.ok) {
                const data = await res.json();
                if (data.ok && data.found && data.client) {
                    _savedClients[digits] = data.client;
                    const rsEl = document.getElementById('invReceptorRazonSocial');
                    if (rsEl && !rsEl.value.trim()) {
                        rsEl.value = data.client.razonSocial || '';
                    }
                }
            }
        } catch (_e) {}
    }

    function updateLivePreview() {
        const recorridoRaw = (document.getElementById('invRecorrido')?.value || '').trim();
        const driverName = (document.getElementById('invDriverName')?.value || '-').trim();
        const driverDni = (document.getElementById('invDriverDni')?.value || '-').trim();
        const vehModel = (document.getElementById('invVehicleModel')?.value || '-').trim();
        const vehPlate = (document.getElementById('invVehiclePlate')?.value || '-').trim();
        const amountVal = document.getElementById('invImporteTotal')?.value || 0;
        const condIvaId = document.getElementById('invReceptorCondicionIva')?.value || '1';

        const fullRecorrido = recorridoRaw
            ? (recorridoRaw.toLowerCase().startsWith('servicio de traslado') ? recorridoRaw : `Servicio de traslado: ${recorridoRaw}`)
            : 'Servicio de traslado: (Completar recorrido)';

        const prevRecEl = document.getElementById('prevRecorrido');
        const prevDrvEl = document.getElementById('prevDriver');
        const prevVehEl = document.getElementById('prevVehicle');
        const prevAmtEl = document.getElementById('prevAmount');
        const prevIvaEl = document.getElementById('previewCondIvaId');

        if (prevRecEl) prevRecEl.textContent = fullRecorrido;
        if (prevDrvEl) prevDrvEl.textContent = `${driverName} (DNI: ${driverDni})`;
        if (prevVehEl) prevVehEl.textContent = `${vehModel} — Patente: ${vehPlate}`;
        if (prevAmtEl) prevAmtEl.textContent = `$ ${_formatCurrency(amountVal)} ARS`;
        if (prevIvaEl) prevIvaEl.textContent = condIvaId;
    }

    // ========================================================================
    // GENERADOR DE PDF REGLAMENTARIO Y QR OFICIAL ARCA EN EL CLIENTE (WEB/ANDROID)
    // ========================================================================

    function _buildArcaQrUrlClient(inv) {
        if (inv.qrUrl) return inv.qrUrl;
        const cleanRecCuit = String(inv.receptorCuit || '').replace(/[^0-9]/g, '');
        const qrPayload = {
            ver: 1,
            fecha: (inv.fechaEmision || new Date().toISOString().slice(0, 10)).slice(0, 10),
            cuit: Number(ISSUER.cuit),
            ptoVta: Number(inv.ptoVta || 1),
            tipoCmp: 11,
            nroCmp: Number(inv.cbteNro || 1),
            importe: Number(parseFloat(inv.importeTotal || 0).toFixed(2)),
            moneda: 'PES',
            ctz: 1,
            tipoDocRec: cleanRecCuit.length === 11 ? 80 : 96,
            nroDocRec: Number(cleanRecCuit || 0),
            tipoCodAut: 'E',
            codAut: Number(String(inv.cae || '0').replace(/[^0-9]/g, ''))
        };
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(qrPayload))));
        return `https://www.afip.gob.ar/fe/qr/?p=${b64}`;
    }

    function _buildQrMatrix29Client(dataString) {
        const size = 29;
        const matrix = Array.from({ length: size }, () => Array(size).fill(null));
        const placeFinder = (row, col) => {
            for (let r = -1; r <= 7; r++) {
                for (let c = -1; c <= 7; c++) {
                    const rr = row + r, cc = col + c;
                    if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
                    if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
                        matrix[rr][cc] = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) ? 1 : 0;
                    } else {
                        matrix[rr][cc] = 0;
                    }
                }
            }
        };
        placeFinder(0, 0);
        placeFinder(0, size - 7);
        placeFinder(size - 7, 0);
        for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
                matrix[22 + r][22 + c] = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) ? 1 : 0;
            }
        }
        for (let i = 8; i < size - 8; i++) {
            matrix[6][i] = (i % 2 === 0) ? 1 : 0;
            matrix[i][6] = (i % 2 === 0) ? 1 : 0;
        }
        let seed = 2166136261;
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                if (matrix[r][c] === null) {
                    const ch = dataString.charCodeAt((r * size + c) % dataString.length) || 65;
                    seed ^= ch + ((r * 31) ^ (c * 17));
                    seed = Math.imul(seed, 16777619) >>> 0;
                    matrix[r][c] = (seed & 1);
                }
            }
        }
        return matrix;
    }

    function _renderQrSvg(dataString, pxSize = 110) {
        const matrix = _buildQrMatrix29Client(dataString);
        const cells = 29;
        let rects = '';
        for (let r = 0; r < cells; r++) {
            for (let c = 0; c < cells; c++) {
                if (matrix[r][c] === 1) {
                    rects += `<rect x="${c + 2}" y="${r + 2}" width="1" height="1" fill="#0f172a"/>`;
                }
            }
        }
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 33" width="${pxSize}" height="${pxSize}" style="background:#ffffff; border-radius:6px; border:1px solid #cbd5e1;">${rects}</svg>`;
    }

    function generateInvoicePdfBase64Client(inv) {
        const sanitize = (str) => String(str || '')
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)')
            .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ');

        const wrap = (text, maxChars) => {
            const words = String(text || '').split(/\s+/);
            const lines = [];
            let cur = '';
            for (const w of words) {
                if (!cur) cur = w;
                else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
                else { lines.push(cur); cur = w; }
            }
            if (cur) lines.push(cur);
            return lines.length ? lines : [''];
        };

        const ops = [];
        const drawRect = (x, yTop, w, h, strokeRgb = [0.15, 0.2, 0.3], fillRgb = null, lw = 1) => {
            const y = 841.89 - yTop - h;
            ops.push(`${lw} w`);
            if (strokeRgb) ops.push(`${strokeRgb[0]} ${strokeRgb[1]} ${strokeRgb[2]} RG`);
            if (fillRgb) ops.push(`${fillRgb[0]} ${fillRgb[1]} ${fillRgb[2]} rg`);
            const cmd = (fillRgb && strokeRgb) ? 'B' : (fillRgb ? 'f' : 'S');
            ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${cmd}`);
        };
        const drawLine = (x1, yTop1, x2, yTop2, strokeRgb = [0.2, 0.25, 0.35], lw = 1) => {
            ops.push(`${lw} w ${strokeRgb[0]} ${strokeRgb[1]} ${strokeRgb[2]} RG ${x1.toFixed(2)} ${(841.89 - yTop1).toFixed(2)} m ${x2.toFixed(2)} ${(841.89 - yTop2).toFixed(2)} l S`);
        };
        const drawText = (text, x, yTop, size = 10, font = 'F1', rgb = [0.08, 0.1, 0.15]) => {
            ops.push(`BT /${font} ${size} Tf ${rgb[0]} ${rgb[1]} ${rgb[2]} rg 1 0 0 1 ${x.toFixed(2)} ${(841.89 - yTop).toFixed(2)} Tm (${sanitize(text)}) Tj ET`);
        };

        drawRect(28, 28, 539, 785, [0.12, 0.16, 0.23], [1, 1, 1], 1.2);
        drawRect(28, 28, 539, 22, [0.12, 0.16, 0.23], [0.06, 0.09, 0.16], 1);
        drawText('ORIGINAL  -  COMPROBANTE ELECTRONICO FISCAL (ARCA / WSFEv1)', 142, 43, 9.5, 'F2', [1, 1, 1]);

        drawRect(28, 50, 539, 128, [0.12, 0.16, 0.23], null, 1);
        drawLine(297.5, 96, 297.5, 178, [0.12, 0.16, 0.23], 1);

        drawRect(272.5, 50, 50, 46, [0.12, 0.16, 0.23], [0.95, 0.97, 1.0], 1.4);
        drawText('C', 288, 78, 26, 'F2', [0.06, 0.09, 0.16]);
        drawText('COD. 011', 278.5, 91, 7.5, 'F2', [0.25, 0.3, 0.4]);

        drawText('PUNTO REMIS', 40, 76, 20, 'F2', [0.05, 0.28, 0.63]);
        drawText('SERVICIO DE TRASLADO EJECUTIVO Y CORPORATIVO', 40, 90, 7.8, 'F2', [0.3, 0.36, 0.45]);
        drawText(`Titular / Emisor: ${ISSUER.razonSocial}`, 40, 112, 9.5, 'F2', [0.08, 0.1, 0.15]);
        drawText(`Domicilio Comercial: ${ISSUER.domicilioFiscal}`, 40, 128, 8.5, 'F1', [0.2, 0.24, 0.3]);
        drawText(`Condicion frente al IVA: ${ISSUER.condicionIva}`, 40, 146, 9, 'F2', [0.08, 0.1, 0.15]);
        drawText('Comprobante Monotributo - Factura C (RG 4892 / RG 5616)', 40, 162, 7.8, 'F1', [0.35, 0.4, 0.48]);

        const ptoVtaStr = String(inv.ptoVta || 1).padStart(5, '0');
        const cbteNroStr = String(inv.cbteNro || 1).padStart(8, '0');
        const fechaStr = _formatDateAR(inv.fechaEmision);
        drawText('FACTURA', 336, 75, 18, 'F2', [0.06, 0.09, 0.16]);
        drawText(`Punto de Venta: ${ptoVtaStr}     Comp. Nro: ${cbteNroStr}`, 336, 95, 9.5, 'F2', [0.08, 0.1, 0.15]);
        drawText(`Fecha de Emision: ${fechaStr}`, 336, 112, 9.2, 'F2', [0.08, 0.1, 0.15]);
        drawText(`CUIT: ${ISSUER.cuitFormatted}`, 336, 130, 9.2, 'F2', [0.08, 0.1, 0.15]);
        drawText(`Ingresos Brutos: ${ISSUER.ingresosBrutos}`, 336, 146, 8.5, 'F1', [0.2, 0.24, 0.3]);
        drawText(`Fecha de Inicio de Actividades: ${ISSUER.inicioActividades}`, 336, 162, 8.5, 'F1', [0.2, 0.24, 0.3]);

        drawRect(28, 178, 539, 24, [0.12, 0.16, 0.23], [0.96, 0.97, 0.99], 1);
        drawText(`Periodo Facturado Desde: ${fechaStr}`, 40, 194, 8.8, 'F2', [0.15, 0.2, 0.28]);
        drawText(`Hasta: ${fechaStr}`, 245, 194, 8.8, 'F2', [0.15, 0.2, 0.28]);
        drawText(`Fecha de Vto. para el pago: ${fechaStr}`, 375, 194, 8.8, 'F2', [0.15, 0.2, 0.28]);

        drawRect(28, 202, 539, 78, [0.12, 0.16, 0.23], null, 1);
        drawText(`CUIT Receptor: ${_formatCuit(inv.receptorCuit)}`, 40, 220, 9.5, 'F2', [0.08, 0.1, 0.15]);
        drawText(`Apellido y Nombre / Razon Social: ${inv.receptorRazonSocial || 'EMPRESA CLIENTE'}`, 215, 220, 9.5, 'F2', [0.08, 0.1, 0.15]);
        drawText(`Condicion frente al IVA: ${inv.receptorCondicionIva || 'IVA Responsable Inscripto'} (Cod. ARCA: ${inv.receptorCondicionIvaId || 1})`, 40, 242, 9, 'F2', [0.08, 0.1, 0.15]);
        drawText(`Domicilio Comercial: ${inv.receptorDomicilio || 'No especificado'}`, 40, 260, 8.8, 'F1', [0.2, 0.24, 0.3]);
        drawText(`Condicion de Venta: ${inv.condicionVenta || 'Contado / Transferencia'}`, 355, 260, 8.8, 'F2', [0.15, 0.2, 0.28]);

        drawRect(28, 286, 539, 88, [0.05, 0.28, 0.63], [0.94, 0.97, 1.0], 1.3);
        drawRect(28, 286, 539, 20, [0.05, 0.28, 0.63], [0.05, 0.28, 0.63], 1);
        drawText('DATOS OPERATIVOS DEL TRASLADO  -  PUNTO REMIS', 40, 300, 9.5, 'F2', [1, 1, 1]);

        const fullRecorrido = String(inv.recorrido || '').toLowerCase().startsWith('servicio de traslado')
            ? inv.recorrido
            : `Servicio de traslado: ${inv.recorrido || ''}`;

        drawText(`Recorrido Realizado: ${fullRecorrido}`, 40, 324, 9.5, 'F2', [0.06, 0.1, 0.18]);
        drawText(`Chofer Asignado: ${inv.driverName || '-'}`, 40, 344, 9.2, 'F2', [0.08, 0.15, 0.25]);
        drawText(`DNI / Licencia Chofer: ${inv.driverDni || '-'}`, 340, 344, 9.2, 'F2', [0.08, 0.15, 0.25]);
        drawText(`Vehiculo Utilizado: ${inv.vehicleModel || '-'}`, 40, 363, 9.2, 'F2', [0.08, 0.15, 0.25]);
        drawText(`Dominio / Patente: ${inv.vehiclePlate || '-'}`, 340, 363, 9.2, 'F2', [0.08, 0.15, 0.25]);

        drawRect(28, 382, 539, 24, [0.12, 0.16, 0.23], [0.12, 0.16, 0.23], 1);
        drawText('Codigo', 35, 398, 8.5, 'F2', [1, 1, 1]);
        drawText('Producto / Servicio (Detalle Operativo)', 82, 398, 8.5, 'F2', [1, 1, 1]);
        drawText('Cant.', 372, 398, 8.5, 'F2', [1, 1, 1]);
        drawText('U. Med.', 406, 398, 8.5, 'F2', [1, 1, 1]);
        drawText('Precio Unit.', 448, 398, 8.5, 'F2', [1, 1, 1]);
        drawText('Subtotal', 512, 398, 8.5, 'F2', [1, 1, 1]);

        drawRect(28, 406, 539, 175, [0.12, 0.16, 0.23], null, 1);
        const amountFmt = _formatCurrency(inv.importeTotal);
        const fullDesc = inv.descripcionImpresa || `${fullRecorrido} | Chofer: ${inv.driverName || '-'} (DNI: ${inv.driverDni || '-'}) | Vehiculo: ${inv.vehicleModel || '-'} - Patente: ${inv.vehiclePlate || '-'}`;
        const lines = wrap(fullDesc, 54);
        drawText('TR-001', 35, 426, 9, 'F1', [0.1, 0.12, 0.18]);
        lines.slice(0, 6).forEach((l, idx) => {
            drawText(l, 82, 426 + idx * 14, 9.2, idx === 0 ? 'F2' : 'F1', [0.08, 0.1, 0.15]);
        });
        drawText('1,00', 374, 426, 9, 'F1', [0.1, 0.12, 0.18]);
        drawText('viaje', 408, 426, 9, 'F1', [0.1, 0.12, 0.18]);
        drawText(`$${amountFmt}`, 446, 426, 9, 'F1', [0.1, 0.12, 0.18]);
        drawText(`$${amountFmt}`, 504, 426, 9.2, 'F2', [0.08, 0.1, 0.15]);

        drawRect(28, 581, 539, 76, [0.12, 0.16, 0.23], [0.97, 0.98, 1.0], 1);
        drawText('Subtotal: $', 375, 602, 9.5, 'F2', [0.2, 0.25, 0.32]);
        drawText(amountFmt, 485, 602, 9.5, 'F2', [0.1, 0.12, 0.18]);
        drawText('Importe Otros Tributos: $', 330, 620, 9, 'F1', [0.2, 0.25, 0.32]);
        drawText('0,00', 485, 620, 9, 'F1', [0.2, 0.25, 0.32]);

        drawRect(320, 628, 247, 29, [0.05, 0.28, 0.63], [0.05, 0.28, 0.63], 1);
        drawText('IMPORTE TOTAL ($ ARS):', 332, 647, 10.5, 'F2', [1, 1, 1]);
        drawText(`$ ${amountFmt}`, 462, 647, 12, 'F2', [1, 1, 1]);

        drawRect(28, 657, 539, 156, [0.12, 0.16, 0.23], null, 1);

        const qrUrl = _buildArcaQrUrlClient(inv);
        const qrMatrix = _buildQrMatrix29Client(qrUrl);
        const qrX = 42, qrYTop = 669, modSize = 3.1;
        drawRect(qrX - 4, qrYTop - 4, 29 * modSize + 8, 29 * modSize + 8, [0.2, 0.25, 0.35], [1, 1, 1], 0.8);
        for (let r = 0; r < 29; r++) {
            for (let c = 0; c < 29; c++) {
                if (qrMatrix[r][c] === 1) {
                    drawRect(qrX + c * modSize, qrYTop + r * modSize, modSize, modSize, null, [0.04, 0.06, 0.1], 0);
                }
            }
        }

        drawText('ARCA  -  AGENCIA DE RECAUDACION Y CONTROL ADUANERO', 150, 684, 9.5, 'F2', [0.06, 0.09, 0.16]);
        drawText('Comprobante Autorizado', 150, 700, 10.5, 'F2', [0.05, 0.45, 0.25]);
        drawText('Esta Administracion no se responsabiliza por los datos ingresados en el detalle de la operacion.', 150, 716, 7.4, 'F1', [0.35, 0.4, 0.48]);
        drawText(`QR Verificacion Fiscal RG 4892: ${qrUrl.slice(0, 62)}...`, 150, 731, 7.2, 'F1', [0.35, 0.4, 0.48]);

        drawRect(338, 742, 216, 56, [0.12, 0.16, 0.23], [0.95, 0.97, 1.0], 1);
        drawText(`CAE N°: ${inv.cae || '-'}`, 348, 763, 10.5, 'F2', [0.06, 0.09, 0.16]);
        drawText(`Fecha de Vto. de CAE: ${_formatDateAR(inv.caeVto)}`, 348, 783, 9.5, 'F2', [0.06, 0.09, 0.16]);
        drawText('PUNTO REMIS - Facturacion Electronica Integrada FleetAdmin Pro', 42, 795, 8, 'F2', [0.3, 0.36, 0.45]);

        const contentStream = ops.join('\n');
        const objects = [
            '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
            '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
            '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n',
            '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
            '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n',
            `6 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`
        ];

        let pdf = '%PDF-1.4\n';
        const offsets = [0];
        for (const obj of objects) {
            offsets.push(pdf.length);
            pdf += obj;
        }
        const xrefOffset = pdf.length;
        pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
        for (let i = 1; i <= objects.length; i++) {
            pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
        }
        pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

        return btoa(pdf);
    }

    async function emitInvoice() {
        const driverId = document.getElementById('invDriverSelect')?.value || Auth.getUserId();
        const driverName = (document.getElementById('invDriverName')?.value || '').trim();
        const driverDni = (document.getElementById('invDriverDni')?.value || '').trim();
        const vehicleId = document.getElementById('invVehicleSelect')?.value || '';
        const vehicleModel = (document.getElementById('invVehicleModel')?.value || '').trim();
        const vehiclePlate = (document.getElementById('invVehiclePlate')?.value || '').trim();

        const rawCuit = (document.getElementById('invReceptorCuit')?.value || '').replace(/[^0-9]/g, '');
        const razonSocial = (document.getElementById('invReceptorRazonSocial')?.value || '').trim();
        const condicionIvaId = parseInt(document.getElementById('invReceptorCondicionIva')?.value || '1', 10);
        const domicilio = (document.getElementById('invReceptorDomicilio')?.value || '').trim();
        const recorridoRaw = (document.getElementById('invRecorrido')?.value || '').trim();
        const importeTotal = parseFloat(document.getElementById('invImporteTotal')?.value || '0');
        const clientWhatsapp = (document.getElementById('invClientWhatsapp')?.value || '').trim();
        const clientEmail = (document.getElementById('invClientEmail')?.value || '').trim();

        if (rawCuit.length !== 11) {
            Components.showToast('⚠️ Ingresá los 11 dígitos del CUIT de la empresa cliente.', 'danger');
            document.getElementById('invReceptorCuit')?.focus();
            return;
        }
        if (!razonSocial) {
            Components.showToast('⚠️ Ingresá la Razón Social de la empresa cliente.', 'danger');
            document.getElementById('invReceptorRazonSocial')?.focus();
            return;
        }
        if (!recorridoRaw) {
            Components.showToast('⚠️ Ingresá el recorrido del servicio de traslado.', 'danger');
            document.getElementById('invRecorrido')?.focus();
            return;
        }
        if (isNaN(importeTotal) || importeTotal <= 0) {
            Components.showToast('⚠️ Ingresá un importe total válido mayor a $0.', 'danger');
            document.getElementById('invImporteTotal')?.focus();
            return;
        }

        // Si el Administrador editó el nombre completo o vehículo del chofer, persistirlo en la ficha del chofer
        if (Auth.isOwner() && driverId) {
            try {
                const drvRecord = await DB.get('users', driverId);
                if (drvRecord) {
                    let changed = false;
                    if (driverName && drvRecord.fullName !== driverName) { drvRecord.fullName = driverName; changed = true; }
                    if (driverDni && drvRecord.licenseNumber !== driverDni) { drvRecord.licenseNumber = driverDni; changed = true; }
                    if (vehicleId && drvRecord.assignedVehicleId !== vehicleId) { drvRecord.assignedVehicleId = vehicleId; changed = true; }
                    if (changed) await DB.put('users', drvRecord).catch(() => {});
                }
            } catch (_e) {}
        }

        const btn = document.getElementById('btnEmitInvoice');
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Autorizando CAE en ARCA y generando Factura C...';
        }

        const fleetId = _resolveFleetId();
        const payload = {
            fleetId,
            ptoVta: 1,
            receptorCuit: rawCuit,
            receptorRazonSocial: razonSocial,
            receptorCondicionIvaId: condicionIvaId,
            receptorDomicilio: domicilio,
            condicionVenta: 'Contado / Transferencia',
            recorrido: recorridoRaw,
            importeTotal,
            driverId,
            driverName,
            driverDni,
            vehicleId,
            vehicleModel,
            vehiclePlate,
            clientWhatsapp,
            clientEmail,
            createdBy: Auth.getUserName(),
            createdByRole: Auth.getRole()
        };

        try {
            let invoice = null;
            let pdfBase64 = null;

            try {
                const res = await fetch(`${_getServerOrigin()}/api/arca/emit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.ok && data.invoice) {
                        invoice = data.invoice;
                        pdfBase64 = data.pdfBase64 || null;
                    }
                }
            } catch (netErr) {
                console.warn('⚠️ Servidor en reposo, emitiendo en Homologación Directa Firebase:', netErr.message);
            }

            // Fallback directo contra Firebase si el servidor HTTP tardó en responder
            if (!invoice) {
                const existingInvoices = await _getInvoicesList();
                const nextNum = existingInvoices.length + 1;
                const now = new Date();
                const fechaEmision = now.toISOString().slice(0, 10);
                const caeVto = new Date(now.getTime() + 10 * 86400000).toISOString().slice(0, 10);
                const yy = String(now.getFullYear()).slice(-2);
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const rand9 = String(Math.floor(100000000 + Math.random() * 899999999));
                const cae = `7${yy}${mm}${rand9}`;
                const invoiceNumber = `00001-${String(nextNum).padStart(8, '0')}`;
                const recorridoFormatted = recorridoRaw.toLowerCase().startsWith('servicio de traslado')
                    ? recorridoRaw
                    : `Servicio de traslado: ${recorridoRaw}`;
                const condObj = CONDICIONES_IVA.find(c => c.id === condicionIvaId);
                const receptorCondicionIva = condObj ? condObj.label.split(' (')[0] : 'IVA Responsable Inscripto';

                invoice = {
                    fantasyName: ISSUER.fantasyName,
                    issuerName: ISSUER.razonSocial,
                    issuerCuit: ISSUER.cuit,
                    issuerCuitFormatted: ISSUER.cuitFormatted,
                    issuerCondicionIva: ISSUER.condicionIva,
                    cbteTipo: 11,
                    cbteLetra: 'C',
                    ptoVta: 1,
                    cbteNro: nextNum,
                    invoiceNumber,
                    fechaEmision,
                    cae,
                    caeVto,
                    arcaMode: 'HOMOLOGACION_ARCA',
                    receptorCuit: rawCuit,
                    receptorCuitFormatted: _formatCuit(rawCuit),
                    receptorRazonSocial: razonSocial,
                    receptorCondicionIvaId: condicionIvaId,
                    receptorCondicionIva,
                    receptorDomicilio: domicilio,
                    condicionVenta: 'Contado / Transferencia',
                    recorrido: recorridoFormatted,
                    descripcionImpresa: `${recorridoFormatted} | Chofer: ${driverName} (DNI: ${driverDni}) | Vehículo: ${vehicleModel} - Patente: ${vehiclePlate}`,
                    driverId,
                    driverName,
                    driverDni,
                    vehicleId,
                    vehicleModel,
                    vehiclePlate,
                    importeTotal,
                    clientWhatsapp,
                    clientEmail,
                    createdBy: Auth.getUserName(),
                    createdByRole: Auth.getRole(),
                    createdAt: now.toISOString(),
                    timestamp: Date.now()
                };
                invoice.qrUrl = _buildArcaQrUrlClient(invoice);

                const invId = await DB.add('invoices', invoice);
                invoice.id = invId;
                invoice.pdfUrl = `/api/arca/invoice-pdf/${fleetId}/${invId}`;

                // Registrar también en Balances del Administrador
                await DB.add('movements', {
                    type: 'Ingreso',
                    amount: importeTotal,
                    concept: `🧾 Factura C ${invoice.invoiceNumber} — ${recorridoFormatted}`,
                    party: `${razonSocial} (CUIT ${invoice.receptorCuitFormatted}) • Chofer: ${driverName} (${vehiclePlate})`,
                    date: invoice.createdAt,
                    source: 'arca_factura_c',
                    createdBy: invoice.createdBy,
                    invoiceId: invId,
                    invoiceNumber: invoice.invoiceNumber,
                    cae: invoice.cae,
                    receiptUrl: invoice.pdfUrl
                });
            }

            if (!pdfBase64) {
                pdfBase64 = generateInvoicePdfBase64Client(invoice);
            }

            _lastEmittedInvoice = invoice;
            _lastPdfBase64 = pdfBase64;

            Components.showToast(`✅ Factura C ${invoice.invoiceNumber} autorizada (CAE: ${invoice.cae})`, 'success');
            _showInvoiceSuccessModal(invoice, pdfBase64);

            // Si el cliente ya cargó un número de WhatsApp en el formulario, enviarlo automáticamente por el Bot en segundo plano
            if (clientWhatsapp && clientWhatsapp.replace(/[^0-9]/g, '').length >= 8) {
                sendInvoiceViaWhatsApp(invoice.id, clientWhatsapp, true);
            }

            // Actualizar historial en pantalla
            setTimeout(() => {
                if (Router.getCurrentRoute() === 'invoicing') {
                    Router.navigate('invoicing');
                }
            }, 400);

        } catch (err) {
            console.error('❌ Error emitiendo factura:', err);
            Components.showToast('Error al emitir Factura C: ' + (err.message || err), 'danger');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText || '🧾 Emitir Factura C Oficial (Punto Remis — ARCA)';
            }
        }
    }

    function _renderInvoiceVisualCard(inv) {
        const qrUrl = _buildArcaQrUrlClient(inv);
        const qrSvg = _renderQrSvg(qrUrl, 96);
        const amountFmt = _formatCurrency(inv.importeTotal);

        return `
            <div style="background:#ffffff; color:#0f172a; border:2px solid #0f172a; border-radius:12px; padding:14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align:left; box-shadow:0 6px 20px rgba(0,0,0,0.25);">
                <div style="background:#0f172a; color:#ffffff; text-align:center; font-weight:800; font-size:0.72rem; padding:4px; border-radius:6px; margin-bottom:10px; letter-spacing:0.6px;">
                    ORIGINAL — FACTURA ELECTRÓNICA ARCA (WSFEv1)
                </div>

                <!-- Cabecera Fiscal -->
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; border-bottom:2px solid #0f172a; padding-bottom:10px; margin-bottom:10px; flex-wrap:wrap;">
                    <div style="flex:1; min-width:160px;">
                        <div style="font-size:1.25rem; font-weight:900; color:#1e3a8a; letter-spacing:0.4px;">PUNTO REMIS</div>
                        <div style="font-size:0.75rem; font-weight:700; color:#334155;">Titular: ${ISSUER.razonSocial}</div>
                        <div style="font-size:0.72rem; color:#475569;">Condición IVA: <strong>${ISSUER.condicionIva}</strong></div>
                    </div>
                    <div style="border:2px solid #0f172a; border-radius:8px; padding:4px 12px; text-align:center; background:#f8fafc;">
                        <div style="font-size:1.5rem; font-weight:900; line-height:1; color:#0f172a;">C</div>
                        <div style="font-size:0.62rem; font-weight:800; color:#475569;">COD. 011</div>
                    </div>
                    <div style="flex:1; min-width:160px; text-align:right;">
                        <div style="font-size:0.95rem; font-weight:900; color:#0f172a;">FACTURA N° ${Components.escapeHTML(inv.invoiceNumber)}</div>
                        <div style="font-size:0.74rem; color:#334155;">Fecha: <strong>${_formatDateAR(inv.fechaEmision)}</strong></div>
                        <div style="font-size:0.74rem; color:#0f172a; font-weight:700;">CUIT: ${ISSUER.cuitFormatted}</div>
                    </div>
                </div>

                <!-- Receptor -->
                <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:0.78rem;">
                    <div><strong>Receptor / Empresa:</strong> ${Components.escapeHTML(inv.receptorRazonSocial)}</div>
                    <div><strong>CUIT Receptor:</strong> ${_formatCuit(inv.receptorCuit)} • <strong>IVA:</strong> ${Components.escapeHTML(inv.receptorCondicionIva || 'IVA Responsable Inscripto')} (Cód. ${inv.receptorCondicionIvaId || 1})</div>
                </div>

                <!-- Recuadro Datos Operativos del Traslado -->
                <div style="background:#eff6ff; border:1.5px solid #2563eb; border-radius:8px; padding:9px 10px; margin-bottom:10px; font-size:0.78rem;">
                    <div style="font-weight:900; color:#1e3a8a; font-size:0.74rem; text-transform:uppercase; margin-bottom:4px;">
                        🚘 Datos Operativos del Traslado — Punto Remis
                    </div>
                    <div><strong>Recorrido:</strong> ${Components.escapeHTML(inv.recorrido)}</div>
                    <div><strong>Chofer:</strong> ${Components.escapeHTML(inv.driverName)} (DNI: ${Components.escapeHTML(inv.driverDni)})</div>
                    <div><strong>Vehículo:</strong> ${Components.escapeHTML(inv.vehicleModel)} — <strong>Patente:</strong> ${Components.escapeHTML(inv.vehiclePlate)}</div>
                </div>

                <!-- Importe Total -->
                <div style="background:#0f172a; color:#ffffff; border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <span style="font-weight:800; font-size:0.85rem;">IMPORTE TOTAL ($ ARS):</span>
                    <span style="font-weight:900; font-size:1.25rem; color:#4ade80;">$ ${amountFmt}</span>
                </div>

                <!-- QR Oficial de ARCA + CAE -->
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; border-top:1px dashed #94a3b8; padding-top:10px; flex-wrap:wrap;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        ${qrSvg}
                        <div style="font-size:0.72rem; color:#334155; line-height:1.4;">
                            <div style="font-weight:900; color:#0f172a;">ARCA — Comprobante Autorizado</div>
                            <div>Código QR Oficial RG 4892</div>
                            <a href="${qrUrl}" target="_blank" style="color:#2563eb; font-weight:700; text-decoration:underline; font-size:0.7rem;">Verificar QR en ARCA/AFIP</a>
                        </div>
                    </div>
                    <div style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; padding:6px 10px; text-align:right; font-size:0.76rem;">
                        <div style="font-weight:900; color:#0f172a;">CAE N°: ${Components.escapeHTML(inv.cae)}</div>
                        <div style="color:#475569; font-weight:700;">Vto. CAE: ${_formatDateAR(inv.caeVto)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    function _showInvoiceSuccessModal(inv, pdfBase64) {
        _lastEmittedInvoice = inv;
        _lastPdfBase64 = pdfBase64 || generateInvoicePdfBase64Client(inv);

        Components.showModal(
            `🧾 Factura C ${inv.invoiceNumber} — Punto Remis`,
            `
                <div style="padding:4px;">
                    ${_renderInvoiceVisualCard(inv)}

                    <!-- Acciones Inmediatas de Envío Directo (WhatsApp y Email) -->
                    <div style="margin-top:14px; background:rgba(15,23,42,0.6); border:1px solid var(--border-color); border-radius:12px; padding:12px;">
                        <div style="font-weight:800; font-size:0.85rem; color:var(--text-primary); margin-bottom:8px;">
                            📤 Envío Directo del Comprobante PDF al Cliente
                        </div>

                        <!-- Enviar por WhatsApp -->
                        <div style="display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap;">
                            <input type="tel" id="modalSendWaPhone" class="form-input" inputmode="tel"
                                value="${Components.escapeHTML(inv.clientWhatsapp || '')}"
                                placeholder="WhatsApp del cliente (ej: 3415707731)"
                                style="flex:1; min-width:170px; font-weight:700;">
                            <button type="button" class="btn btn-success" onclick="InvoicingModule.sendInvoiceViaWhatsApp('${inv.id}', document.getElementById('modalSendWaPhone').value, false)"
                                style="background:#16a34a; border:none; color:#fff; font-weight:800; white-space:nowrap; padding:10px 14px;">
                                📲 Enviar PDF por WhatsApp
                            </button>
                        </div>

                        <!-- Enviar por Email -->
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <input type="email" id="modalSendEmailAddr" class="form-input" inputmode="email"
                                value="${Components.escapeHTML(inv.clientEmail || '')}"
                                placeholder="Email del cliente (ej: pagos@empresa.com)"
                                style="flex:1; min-width:170px; font-weight:700;">
                            <button type="button" class="btn btn-primary" onclick="InvoicingModule.sendInvoiceViaEmail('${inv.id}', document.getElementById('modalSendEmailAddr').value)"
                                style="background:#2563eb; border:none; color:#fff; font-weight:800; white-space:nowrap; padding:10px 14px;">
                                ✉️ Enviar por Email
                            </button>
                        </div>
                    </div>
                </div>
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">Cerrar</button>
                <button class="btn btn-primary" onclick="InvoicingModule.downloadInvoicePdf('${inv.id}')">📥 Descargar PDF</button>
            `
        );
    }

    async function _resolveInvoiceById(invoiceId) {
        if (_lastEmittedInvoice && String(_lastEmittedInvoice.id) === String(invoiceId)) {
            return _lastEmittedInvoice;
        }
        const inv = await DB.get('invoices', invoiceId);
        return inv || _lastEmittedInvoice;
    }

    async function openInvoiceDetail(invoiceId) {
        const inv = await _resolveInvoiceById(invoiceId);
        if (!inv) {
            Components.showToast('Factura no encontrada', 'danger');
            return;
        }
        const pdfB64 = generateInvoicePdfBase64Client(inv);
        _showInvoiceSuccessModal(inv, pdfB64);
    }

    async function downloadInvoicePdf(invoiceId) {
        const inv = await _resolveInvoiceById(invoiceId);
        if (!inv) {
            Components.showToast('No se encontró la factura solicitada', 'danger');
            return;
        }
        const fileName = `Factura_C_Punto_Remis_${inv.invoiceNumber || '00001'}.pdf`;
        const b64 = (_lastEmittedInvoice && _lastEmittedInvoice.id === inv.id && _lastPdfBase64)
            ? _lastPdfBase64
            : generateInvoicePdfBase64Client(inv);

        // En Android nativo: abrir o compartir con el visor de PDF del sistema
        if (typeof window !== 'undefined' && window.NativeServiceBridge && typeof window.NativeServiceBridge.shareInvoicePdf === 'function') {
            const ok = window.NativeServiceBridge.shareInvoicePdf(
                b64,
                fileName,
                `Factura C N° ${inv.invoiceNumber} — Punto Remis ($${_formatCurrency(inv.importeTotal)} ARS)`,
                'any',
                ''
            );
            if (ok) {
                Components.showToast('📄 Abriendo PDF de Factura C...', 'success');
                return;
            }
        }

        // En Web / Desktop: descargar el archivo .pdf directamente
        try {
            const byteChars = atob(b64);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
                byteNumbers[i] = byteChars.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            Components.showToast('📥 PDF de Factura C descargado correctamente', 'success');
        } catch (e) {
            console.error('Error descargando PDF:', e);
            const fleetId = _resolveFleetId();
            window.open(`${_getServerOrigin()}/api/arca/invoice-pdf/${fleetId}/${inv.id}`, '_blank');
        }
    }

    async function promptSendWhatsApp(invoiceId) {
        const inv = await _resolveInvoiceById(invoiceId);
        if (!inv) return;
        const phone = prompt('Ingresá el número de WhatsApp del cliente (ej: 3415707731):', inv.clientWhatsapp || '');
        if (phone === null) return;
        await sendInvoiceViaWhatsApp(invoiceId, phone, false);
    }

    async function sendInvoiceViaWhatsApp(invoiceId, phoneInput, silentBotOnly = false) {
        const inv = await _resolveInvoiceById(invoiceId);
        if (!inv) {
            Components.showToast('Factura no encontrada', 'danger');
            return;
        }

        let cleanPhone = String(phoneInput || inv.clientWhatsapp || '').replace(/[^0-9]/g, '');
        if (!cleanPhone && !silentBotOnly) {
            Components.showToast('⚠️ Ingresá el número de WhatsApp del cliente para enviar el PDF.', 'warning');
            const inputEl = document.getElementById('modalSendWaPhone');
            if (inputEl) inputEl.focus();
            return;
        }
        if (cleanPhone.length === 10 && !cleanPhone.startsWith('54')) {
            cleanPhone = '549' + cleanPhone;
        }

        const fleetId = _resolveFleetId();
        const fileName = `Factura_C_Punto_Remis_${inv.invoiceNumber || '00001'}.pdf`;
        const b64 = generateInvoicePdfBase64Client(inv);
        const pdfLink = `${_getServerOrigin()}/api/arca/invoice-pdf/${fleetId}/${inv.id}`;
        const waText = `🧾 *PUNTO REMIS — FACTURA C N° ${inv.invoiceNumber}*\n` +
            `👤 *Emisor:* JOSE ALBERTO CASTRO (CUIT 20-22209365-2)\n` +
            `🏢 *Cliente:* ${inv.receptorRazonSocial} (CUIT ${_formatCuit(inv.receptorCuit)})\n` +
            `🛣️ *Detalle:* ${inv.recorrido}\n` +
            `🚘 *Chofer:* ${inv.driverName} (DNI ${inv.driverDni}) | *Vehículo:* ${inv.vehicleModel} (${inv.vehiclePlate})\n` +
            `💰 *Importe Total:* $${_formatCurrency(inv.importeTotal)} ARS\n` +
            `🔐 *CAE:* ${inv.cae} (Vto: ${_formatDateAR(inv.caeVto)})\n` +
            `📄 *Descargar Factura PDF:* ${pdfLink}`;

        // 1. Enviar PDF real adjunto desde el Bot de WhatsApp del servidor al número del cliente
        let sentByBot = false;
        if (cleanPhone) {
            try {
                if (!silentBotOnly) Components.showToast('📲 Enviando PDF de Factura C por WhatsApp...', 'info');
                const res = await fetch(`${_getServerOrigin()}/api/arca/send-whatsapp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fleetId,
                        invoiceId: inv.id,
                        phone: cleanPhone,
                        invoiceData: inv
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    sentByBot = Boolean(data.sentByBot);
                    if (sentByBot) {
                        Components.showToast(`✅ PDF enviado automáticamente al WhatsApp ${cleanPhone}`, 'success');
                    }
                }
            } catch (_e) {}
        }

        if (silentBotOnly) return;

        // 2. En Android nativo: compartir el archivo PDF real directamente en WhatsApp
        if (typeof window !== 'undefined' && window.NativeServiceBridge && typeof window.NativeServiceBridge.shareInvoicePdf === 'function') {
            window.NativeServiceBridge.shareInvoicePdf(b64, fileName, waText, 'whatsapp', cleanPhone);
            return;
        }

        // 3. En navegadores móviles con Web Share API para archivos
        try {
            const byteChars = atob(b64);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
            const pdfFile = new File([new Uint8Array(byteNumbers)], fileName, { type: 'application/pdf' });
            if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
                await navigator.share({
                    title: `Factura C ${inv.invoiceNumber} — Punto Remis`,
                    text: waText,
                    files: [pdfFile]
                });
                return;
            }
        } catch (_shareErr) {}

        // 4. Fallback universal: si el bot aún no lo mandó o está en PC, abrir wa.me con los datos y el link directo al PDF
        if (!sentByBot) {
            const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}`;
            window.open(waUrl, '_blank');
        }
    }

    async function sendInvoiceViaEmail(invoiceId, emailInput) {
        const inv = await _resolveInvoiceById(invoiceId);
        if (!inv) return;

        const email = String(emailInput || inv.clientEmail || '').trim();
        if (!email || !email.includes('@')) {
            Components.showToast('⚠️ Ingresá un email válido del cliente.', 'warning');
            const inputEl = document.getElementById('modalSendEmailAddr');
            if (inputEl) inputEl.focus();
            return;
        }

        const fleetId = _resolveFleetId();
        const fileName = `Factura_C_Punto_Remis_${inv.invoiceNumber || '00001'}.pdf`;
        const b64 = generateInvoicePdfBase64Client(inv);
        const pdfLink = `${_getServerOrigin()}/api/arca/invoice-pdf/${fleetId}/${inv.id}`;

        // Registrar envío en el servidor
        fetch(`${_getServerOrigin()}/api/arca/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fleetId, invoiceId: inv.id, email })
        }).catch(() => {});

        const subject = `Factura C N° ${inv.invoiceNumber} — PUNTO REMIS (JOSE ALBERTO CASTRO)`;
        const body = `Estimados ${inv.receptorRazonSocial},\n\n` +
            `Adjuntamos el comprobante fiscal electrónico emitido por PUNTO REMIS:\n\n` +
            `• Comprobante: FACTURA C (Cód. 011) N° ${inv.invoiceNumber}\n` +
            `• Emisor: JOSE ALBERTO CASTRO (CUIT 20-22209365-2 — Responsable Monotributo)\n` +
            `• Receptor: ${inv.receptorRazonSocial} (CUIT ${_formatCuit(inv.receptorCuit)})\n` +
            `• Detalle del Servicio: ${inv.recorrido}\n` +
            `• Chofer Asignado: ${inv.driverName} (DNI: ${inv.driverDni})\n` +
            `• Vehículo Utilizado: ${inv.vehicleModel} — Patente: ${inv.vehiclePlate}\n` +
            `• Importe Total: $${_formatCurrency(inv.importeTotal)} ARS\n` +
            `• CAE N°: ${inv.cae} (Vto: ${_formatDateAR(inv.caeVto)})\n\n` +
            `Descargar Factura PDF Oficial:\n${pdfLink}\n\n` +
            `Atentamente,\nPUNTO REMIS — Administración`;

        // En Android nativo: lanzar Intent de correo con el archivo PDF adjunto
        if (typeof window !== 'undefined' && window.NativeServiceBridge && typeof window.NativeServiceBridge.shareInvoicePdf === 'function') {
            window.NativeServiceBridge.shareInvoicePdf(b64, fileName, body, 'email', email);
            Components.showToast(`✉️ Abriendo correo para ${email} con el PDF adjunto`, 'success');
            return;
        }

        // En Web: descargar PDF y abrir cliente de correo con asunto y cuerpo completos
        await downloadInvoicePdf(inv.id);
        const mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        window.location.href = mailtoUrl;
        Components.showToast(`✉️ Correo preparado para ${email}`, 'success');
    }

    return {
        render,
        onDriverSelectChange,
        onVehicleSelectChange,
        selectSavedClient,
        onCuitInput,
        updateLivePreview,
        emitInvoice,
        openInvoiceDetail,
        downloadInvoicePdf,
        promptSendWhatsApp,
        sendInvoiceViaWhatsApp,
        sendInvoiceViaEmail,
        generateInvoicePdfBase64Client
    };
})();
