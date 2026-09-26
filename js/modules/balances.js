/* ============================================
   FleetAdmin Pro — Módulo de Balances de Flota
   Gestión Financiera, Comprobantes de Transferencia
   y Escaneo Automático por WhatsApp
   ============================================ */

const BalancesModule = (() => {

    let _currentPeriodFilter = 'all'; // 'all', 'today', 'week', 'month'
    let _currentTypeFilter = 'all';   // 'all', 'ingreso', 'egreso'

    async function render() {
        try {
            const movements = await _getMovements();
            const pendingPayments = await _getPendingPayments();
            const scannerEnabled = (await DB.getSetting('whatsapp_scanner_enabled')) ?? true;
            const authPhone = (await DB.getSetting('whatsapp_authorized_phone')) || '';
            const sheetId = (await DB.getSetting('google_sheet_id')) || '';

            // Filtrar movimientos según selecciones
            const filteredMovements = _applyFilters(movements, _currentPeriodFilter, _currentTypeFilter);

            // Calcular totales globales del conjunto filtrado
            let totalIngresos = 0;
            let totalEgresos = 0;

            filteredMovements.forEach(m => {
                const amount = parseFloat(m.amount || m.monto || 0);
                const type = (m.type || m.tipo || '').toLowerCase();
                if (type === 'ingreso') {
                    totalIngresos += amount;
                } else if (type === 'egreso') {
                    totalEgresos += amount;
                }
            });

            const netBalance = totalIngresos - totalEgresos;

            // Renderizar sección de pagos pendientes si existen avisos
            let pendingSectionHtml = '';
            if (pendingPayments && pendingPayments.length > 0) {
                const pendingCardsHtml = pendingPayments.map(p => {
                    const isCash = p.method === 'Efectivo';
                    const montoFormatted = _formatCurrency(p.amount);
                    const dateFormatted = p.date ? new Date(p.date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
                    return `
                        <div style="background:var(--bg-primary); border:1px solid ${isCash ? 'rgba(245, 158, 11, 0.4)' : 'rgba(59, 130, 246, 0.4)'}; border-radius:14px; padding:14px; display:flex; flex-direction:column; justify-content:space-between; gap:10px; box-shadow:var(--shadow-sm);">
                            <div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                    <span class="badge" style="background:${isCash ? '#f59e0b' : '#3b82f6'}; color:#fff; font-weight:700; font-size:11px;">
                                        ${isCash ? '💵 Efectivo en mano' : '🏦 Transferencia'}
                                    </span>
                                    <span style="font-family:monospace; font-weight:800; background:rgba(255,255,255,0.08); padding:2px 8px; border-radius:6px; font-size:12px;">
                                        #${p.code}
                                    </span>
                                </div>
                                <div style="font-weight:900; font-size:1.3rem; color:${isCash ? '#f59e0b' : '#3b82f6'};">
                                    $${montoFormatted}
                                </div>
                                <div style="font-weight:700; font-size:0.92rem; color:var(--text-primary); margin-top:4px;">
                                    👤 ${p.driverName || p.party || 'Chofer'}
                                </div>
                                <div style="font-size:0.82rem; color:var(--text-secondary); margin-top:2px;">
                                    📝 ${p.concept || '-'}
                                </div>
                                <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px; opacity:0.8;">
                                    🕒 ${dateFormatted}
                                </div>
                            </div>
                            <div style="display:flex; gap:8px; margin-top:6px;">
                                <button class="btn btn-sm btn-success" onclick="BalancesModule.confirmPendingPayment('${p.code}')" style="flex:1; font-weight:700; font-size:12px; background:#10b981; border:none; color:#fff; justify-content:center; padding:7px 10px;">
                                    ✅ Aprobar
                                </button>
                                <button class="btn btn-sm btn-danger" onclick="BalancesModule.rejectPendingPayment('${p.code}')" style="font-weight:700; font-size:12px; background:#ef4444; border:none; color:#fff; justify-content:center; padding:7px 10px;">
                                    ❌ Rechazar
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

                pendingSectionHtml = `
                    <div class="card" style="background:linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(217, 119, 6, 0.04)); border:1px solid rgba(245, 158, 11, 0.35); border-radius:16px; padding:18px; margin-bottom:24px; box-shadow:0 4px 15px rgba(245, 158, 11, 0.1);">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:8px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="font-size:1.6rem;">🔔</span>
                                <div>
                                    <h3 style="margin:0; font-size:1.1rem; font-weight:800; color:#d97706;">
                                        Avisos de Ingresos Pendientes de Confirmación (${pendingPayments.length})
                                    </h3>
                                    <p style="margin:2px 0 0 0; font-size:0.82rem; color:var(--text-secondary);">
                                        Conductores informaron transferencias o entregas de efectivo. Podés aprobarlos aquí o respondiendo por WhatsApp con <strong>SI [código]</strong>.
                                    </p>
                                </div>
                            </div>
                            <span class="badge" style="background:#f59e0b; color:#fff; font-weight:700; padding:6px 12px; border-radius:20px; font-size:0.82rem;">
                                Esperando Aprobación
                            </span>
                        </div>
                        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">
                            ${pendingCardsHtml}
                        </div>
                    </div>
                `;
            }

            return `
                <div class="balances-container" style="animation: fadeIn 0.4s ease-out;">
                    <!-- Cabecera -->
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px; margin-bottom:20px;">
                        <div>
                            <h2 style="font-size:var(--font-size-2xl); font-weight:800; margin:0; color:var(--text-primary);">
                                💰 Balance de Flota & Escáner WhatsApp
                            </h2>
                            <p style="margin:4px 0 0 0; color:var(--text-secondary); font-size:var(--font-size-sm);">
                                Control de ingresos, egresos y comprobantes de transferencias procesados por IA
                            </p>
                        </div>
                        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
                            <button class="btn btn-secondary" onclick="BalancesModule.exportCSV()" style="font-weight:600; font-size:0.88rem;">
                                📄 Exportar Excel/CSV
                            </button>
                            <button class="btn btn-warning" id="btnScanWhatsapp" onclick="BalancesModule.scanWhatsApp()" style="font-weight:700; font-size:0.88rem; background:#f59e0b; border-color:#f59e0b; color:#fff;">
                                🔍 Escanear WhatsApp
                            </button>
                            <button class="btn btn-primary" onclick="BalancesModule.showImportModal()" style="font-weight:700; font-size:0.88rem; background:#6366f1; border-color:#6366f1; color:#fff;">
                                📥 Importar Comprobantes & Facturas
                            </button>
                            <button class="btn btn-success" onclick="BalancesModule.showGoogleSheetsOptions()" style="font-weight:700; font-size:0.88rem; background:#10b981; border-color:#10b981; color:#fff;">
                                📊 Google Sheets
                            </button>
                            <button class="btn btn-primary" onclick="BalancesModule.showAddMovementModal()" style="font-weight:700; font-size:0.95rem; box-shadow:0 4px 12px rgba(59,130,246,0.3);">
                                ➕ Registrar Movimiento
                            </button>
                        </div>
                    </div>

                    <!-- Estado del Escáner de WhatsApp -->
                    <div class="card" style="background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:16px; padding:16px; margin-bottom:24px; box-shadow:var(--shadow-sm);">
                        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div style="font-size:2rem; width:44px; height:44px; background:rgba(34,197,94,0.1); border-radius:12px; display:flex; align-items:center; justify-content:center;">
                                    📲
                                </div>
                                <div>
                                    <div style="font-weight:700; font-size:1rem; color:var(--text-primary);">
                                        Escáner Bot de WhatsApp: ${scannerEnabled ? '<span class="badge badge-success">🟢 Activo</span>' : '<span class="badge badge-danger">🔴 Inactivo</span>'}
                                    </div>
                                    <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:2px;">
                                        Teléfono Autorizado: <strong>${authPhone ? authPhone : '⚠️ Sin configurar'}</strong> | 
                                        Google Sheets: <strong>${sheetId ? '🔗 Vinculada' : '⚪ Sin vincular'}</strong>
                                    </div>
                                </div>
                            </div>
                            <button class="btn btn-secondary btn-sm" onclick="Router.navigate('settings')">
                                ⚙️ Configurar Escáner
                            </button>
                        </div>
                    </div>

                    <!-- Sección de Pagos Pendientes -->
                    ${pendingSectionHtml}

                    <!-- Tarjetas de Resumen Financiero -->
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:16px; margin-bottom:24px;">
                        <!-- Ingresos -->
                        <div class="stat-card" style="background:linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.05)); border:1px solid rgba(34,197,94,0.3); border-radius:16px; padding:18px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-size:0.8rem; text-transform:uppercase; font-weight:700; color:#22c55e; letter-spacing:0.5px;">📈 Total Ingresos</span>
                                <span style="font-size:1.4rem;">📥</span>
                            </div>
                            <div style="font-size:1.8rem; font-weight:900; color:#22c55e;">
                                $${_formatCurrency(totalIngresos)}
                            </div>
                        </div>

                        <!-- Egresos -->
                        <div class="stat-card" style="background:linear-gradient(135deg, rgba(239,68,68,0.15), rgba(225,29,72,0.05)); border:1px solid rgba(239,68,68,0.3); border-radius:16px; padding:18px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-size:0.8rem; text-transform:uppercase; font-weight:700; color:#ef4444; letter-spacing:0.5px;">📉 Total Egresos</span>
                                <span style="font-size:1.4rem;">📤</span>
                            </div>
                            <div style="font-size:1.8rem; font-weight:900; color:#ef4444;">
                                $${_formatCurrency(totalEgresos)}
                            </div>
                        </div>

                        <!-- Balance Neto -->
                        <div class="stat-card" style="background:${netBalance >= 0 ? 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(37,99,235,0.05))' : 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(185,28,28,0.05))'}; border:1px solid ${netBalance >= 0 ? 'rgba(59,130,246,0.3)' : 'rgba(239,68,68,0.3)'}; border-radius:16px; padding:18px;">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                <span style="font-size:0.8rem; text-transform:uppercase; font-weight:700; color:${netBalance >= 0 ? '#3b82f6' : '#ef4444'}; letter-spacing:0.5px;">💵 Balance Neto</span>
                                <span style="font-size:1.4rem;">📊</span>
                            </div>
                            <div style="font-size:1.8rem; font-weight:900; color:${netBalance >= 0 ? '#3b82f6' : '#ef4444'};">
                                $${_formatCurrency(netBalance)}
                            </div>
                        </div>
                    </div>

                    <!-- Filtros de Movimientos -->
                    <div class="card" style="padding:14px 18px; margin-bottom:20px; border-radius:14px; background:var(--bg-secondary); border:1px solid var(--border-color);">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                            <!-- Filtro por Período -->
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <span style="font-size:0.85rem; font-weight:700; color:var(--text-secondary);">📅 Período:</span>
                                <div class="toggle-group">
                                    <button class="toggle-option ${_currentPeriodFilter === 'all' ? 'active' : ''}" onclick="BalancesModule.setFilter('period', 'all')">Todos</button>
                                    <button class="toggle-option ${_currentPeriodFilter === 'today' ? 'active' : ''}" onclick="BalancesModule.setFilter('period', 'today')">Hoy</button>
                                    <button class="toggle-option ${_currentPeriodFilter === 'week' ? 'active' : ''}" onclick="BalancesModule.setFilter('period', 'week')">Esta semana</button>
                                    <button class="toggle-option ${_currentPeriodFilter === 'month' ? 'active' : ''}" onclick="BalancesModule.setFilter('period', 'month')">Este mes</button>
                                </div>
                            </div>

                            <!-- Filtro por Tipo -->
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <span style="font-size:0.85rem; font-weight:700; color:var(--text-secondary);">🏷️ Tipo:</span>
                                <div class="toggle-group">
                                    <button class="toggle-option ${_currentTypeFilter === 'all' ? 'active' : ''}" onclick="BalancesModule.setFilter('type', 'all')">Todos</button>
                                    <button class="toggle-option ${_currentTypeFilter === 'ingreso' ? 'active' : ''}" onclick="BalancesModule.setFilter('type', 'ingreso')">🟢 Ingresos</button>
                                    <button class="toggle-option ${_currentTypeFilter === 'egreso' ? 'active' : ''}" onclick="BalancesModule.setFilter('type', 'egreso')">🔴 Egresos</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Tabla de Historial -->
                    <div class="dashboard-section">
                        <div class="dashboard-section-title">📋 Historial de Movimientos (${filteredMovements.length})</div>
                        ${_renderMovementsTable(filteredMovements)}
                    </div>
                </div>
            `;
        } catch (e) {
            console.error('🔴 BalancesModule render error:', e);
            return `
                <div style="text-align:center; padding:3rem;">
                    <div style="font-size:3rem; margin-bottom:1rem;">⚠️</div>
                    <h3>Error al cargar balances</h3>
                    <p style="color:var(--text-secondary);">${e.message || 'Error de conexión'}</p>
                    <button class="btn btn-primary" onclick="Router.navigate('balances')" style="margin-top:1rem;">🔄 Reintentar</button>
                </div>
            `;
        }
    }
    function _formatCurrency(amount) {
        const val = parseFloat(amount || 0);
        return isNaN(val) ? '0,00' : val.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    async function _getMovements() {
        if (typeof DB === 'undefined') return [];
        try {
            const list = await DB.getAll('movements');
            if (Array.isArray(list)) {
                // Ordenar por fecha descendente
                return list.sort((a, b) => new Date(b.date || b.fecha || 0) - new Date(a.date || a.fecha || 0));
            }
            return [];
        } catch (e) {
            console.warn('⚠️ Error al obtener movimientos:', e);
            return [];
        }
    }

    async function _getPendingPayments() {
        try {
            const res = await fetch('/api/bot/pending-payments');
            if (res.ok) {
                const data = await res.json();
                if (data.ok && Array.isArray(data.payments)) {
                    return data.payments;
                }
            }
        } catch(e) {}
        if (typeof DB !== 'undefined') {
            try {
                const list = await DB.getAll('pending_payments');
                if (Array.isArray(list)) {
                    return list.filter(p => p.status === 'pending').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                }
            } catch(e2) {}
        }
        return [];
    }

    function _applyFilters(list, period, type) {
        let result = [...list];
        const now = new Date();

        // 1. Filtrar por período
        if (period === 'today') {
            const todayStr = now.toISOString().split('T')[0];
            result = result.filter(m => (m.date || m.fecha || '').startsWith(todayStr));
        } else if (period === 'week') {
            const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            result = result.filter(m => new Date(m.date || m.fecha || 0) >= oneWeekAgo);
        } else if (period === 'month') {
            const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            result = result.filter(m => new Date(m.date || m.fecha || 0) >= firstDayOfMonth);
        }

        // 2. Filtrar por tipo
        if (type === 'ingreso') {
            result = result.filter(m => (m.type || m.tipo || '').toLowerCase() === 'ingreso');
        } else if (type === 'egreso') {
            result = result.filter(m => (m.type || m.tipo || '').toLowerCase() === 'egreso');
        }

        return result;
    }

    function _renderMovementsTable(movements) {
        if (!movements || movements.length === 0) {
            return `
                <div class="card" style="text-align:center; padding:40px; color:var(--text-tertiary);">
                    <div style="font-size:2.5rem; margin-bottom:10px;">🧾</div>
                    <div style="font-size:1.1rem; font-weight:600;">Sin movimientos registrados</div>
                    <p style="font-size:0.85rem; margin-top:4px;">Los comprobantes escaneados por WhatsApp o agregados manualmente aparecerán aquí.</p>
                </div>
            `;
        }

        let rows = '';
        movements.forEach(m => {
            const dateStr = m.date || m.fecha ? new Date(m.date || m.fecha).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
            const typeLower = (m.type || m.tipo || 'ingreso').toLowerCase();
            const isIngreso = typeLower === 'ingreso';

            const typeBadge = isIngreso 
                ? '<span class="badge badge-success" style="font-weight:700;">🟢 Ingreso</span>'
                : '<span class="badge badge-danger" style="font-weight:700;">🔴 Egreso</span>';

            const amountFormatted = (isIngreso ? '+' : '-') + '$' + _formatCurrency(m.amount || m.monto || 0);
            const sourceBadge = (m.source === 'whatsapp' || m.origen === 'whatsapp')
                ? '<span class="badge" style="background:rgba(34,197,94,0.15); color:#22c55e; border:1px solid rgba(34,197,94,0.3); font-size:11px;">📲 WhatsApp Bot</span>'
                : '<span class="badge" style="background:rgba(59,130,246,0.15); color:#3b82f6; border:1px solid rgba(59,130,246,0.3); font-size:11px;">👤 Manual</span>';

            const receiptBtn = (m.receiptUrl || m.comprobanteUrl)
                ? `<button class="btn btn-ghost btn-sm" onclick="BalancesModule.viewReceipt('${m.receiptUrl || m.comprobanteUrl}')" title="Ver comprobante original">👁️ Ver</button>`
                : '<span style="color:var(--text-tertiary); font-size:12px;">-</span>';

            rows += `
                <tr>
                    <td data-label="Fecha" style="font-size:13px; font-weight:600;">${dateStr}</td>
                    <td data-label="Tipo">${typeBadge}</td>
                    <td data-label="Concepto" style="font-weight:600;">${m.concept || m.concepto || 'Transferencia'}</td>
                    <td data-label="Emisor / Receptor">${m.party || m.emisor_receptor || '-'}</td>
                    <td data-label="Origen">${sourceBadge}</td>
                    <td data-label="Monto" style="font-weight:900; font-size:15px; color:${isIngreso ? '#22c55e' : '#ef4444'};">${amountFormatted}</td>
                    <td data-label="Comprobante">${receiptBtn}</td>
                    ${Auth.isOwner() ? `
                    <td data-label="Acciones">
                        <button class="btn btn-icon btn-danger" onclick="BalancesModule.deleteMovement('${m.id}')" title="Eliminar movimiento" style="padding:4px 8px; font-size:12px;">🗑️</button>
                    </td>` : ''}
                </tr>
            `;
        });

        return `
            <div class="data-table-wrapper">
                <table class="data-table data-table-responsive">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Tipo</th>
                            <th>Concepto</th>
                            <th>Emisor / Receptor</th>
                            <th>Origen</th>
                            <th>Monto</th>
                            <th>Comprobante</th>
                            ${Auth.isOwner() ? '<th>Acciones</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    }

    function setFilter(filterType, value) {
        if (filterType === 'period') {
            _currentPeriodFilter = value;
        } else if (filterType === 'type') {
            _currentTypeFilter = value;
        }
        Router.navigate('balances');
    }

    function showAddMovementModal() {
        Components.showModal(
            '➕ Registrar Movimiento Financiero',
            `
                <div class="form-group">
                    <label class="form-label">Tipo de Movimiento *</label>
                    <select class="form-select" id="movType">
                        <option value="Ingreso">🟢 Ingreso (+)</option>
                        <option value="Egreso">🔴 Egreso (-)</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label">Monto ($) *</label>
                    <input type="number" class="form-input" id="movAmount" placeholder="Ej: 15000" step="0.01" inputmode="decimal">
                </div>

                <div class="form-group">
                    <label class="form-label">Concepto *</label>
                    <input type="text" class="form-input" id="movConcept" placeholder="Ej: Recaudación de turno, Combustible, Mecánica">
                </div>

                <div class="form-group">
                    <label class="form-label">Emisor / Receptor (Opcional)</label>
                    <input type="text" class="form-input" id="movParty" placeholder="Ej: MercadoPago, Juan Pérez">
                </div>

                <div class="form-group">
                    <label class="form-label">Fecha y Hora</label>
                    <input type="datetime-local" class="form-input" id="movDate" value="${new Date().toISOString().slice(0, 16)}">
                </div>

                ${Components.renderPhotoCapture('movReceipt', 'Foto de Comprobante (Opcional)')}
            `,
            `
                <button class="btn btn-secondary" onclick="Components.closeModal()">${I18n.t('cancel')}</button>
                <button class="btn btn-primary" onclick="BalancesModule.saveMovement()">${I18n.t('save')}</button>
            `
        );
    }

    async function saveMovement() {
        const type = document.getElementById('movType')?.value;
        const amountStr = document.getElementById('movAmount')?.value;
        const concept = document.getElementById('movConcept')?.value.trim();
        const party = document.getElementById('movParty')?.value.trim() || 'N/A';
        const dateInput = document.getElementById('movDate')?.value;

        const amount = parseFloat(amountStr);

        if (isNaN(amount) || amount <= 0 || !concept) {
            Components.showToast('Por favor completá un monto válido y concepto.', 'danger');
            return;
        }

        const photoRaw = Components.getPhotoData('movReceipt');
        const photo = photoRaw ? await StorageUtil.compressImage(photoRaw, 1024, 1024, 0.7) : null;

        const movementData = {
            type: type,
            amount: amount,
            concept: concept,
            party: party,
            date: dateInput ? new Date(dateInput).toISOString() : new Date().toISOString(),
            source: 'manual',
            createdBy: Auth.getUserName(),
            receiptUrl: photo || null
        };

        try {
            await DB.add('movements', movementData);
            Components.closeModal();
            Components.showToast('Movimiento registrado con éxito ✅', 'success');

            // Si hay planilla vinculada, enviar a backend
            const sheetId = await DB.getSetting('google_sheet_id');
            if (sheetId) {
                _syncWithGoogleSheets(sheetId, movementData);
            }

            Router.navigate('balances');
        } catch (e) {
            console.error('Error al guardar movimiento:', e);
            Components.showToast('Error al guardar movimiento: ' + e.message, 'danger');
        }
    }

    async function deleteMovement(id) {
        if (!id) return;
        Components.confirm(
            '¿Estás seguro de eliminar este movimiento financiero?',
            async () => {
                try {
                    await DB.remove('movements', id);
                    Components.showToast('Movimiento eliminado ✅', 'success');
                    Router.navigate('balances');
                } catch (e) {
                    Components.showToast('Error al eliminar: ' + e.message, 'danger');
                }
            }
        );
    }

    function viewReceipt(url) {
        if (!url) return;
        Components.showModal(
            '🖼️ Comprobante de Transferencia',
            `
                <div style="text-align:center; padding:10px;">
                    <img src="${url}" style="max-width:100%; max-height:75vh; border-radius:12px; border:2px solid var(--border-color); box-shadow:var(--shadow-lg);">
                </div>
            `,
            `<button class="btn btn-secondary" onclick="Components.closeModal()">Cerrar</button>`
        );
    }

    async function _syncWithGoogleSheets(sheetId, movement) {
        try {
            const res = await fetch('/api/sheets/append', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ google_sheet_id: sheetId, sheetId, movement })
            });
            const data = await res.json();
            if (data.ok) {
                console.log('📊 Sincronizado con Google Sheets ✅');
            } else {
                console.warn('⚠️ Error al enviar a Google Sheets:', data.error);
            }
        } catch (e) {
            console.warn('⚠️ Error al enviar a Google Sheets:', e);
        }
    }

    async function exportCSV() {
        try {
            const movements = await _getMovements();
            if (!movements || movements.length === 0) {
                Components.showToast('No hay movimientos registrados para exportar', 'warning');
                return;
            }

            const headers = ['Fecha', 'Tipo', 'Concepto', 'Emisor_Receptor', 'Origen', 'Monto'];
            const rows = movements.map(m => {
                const dateStr = m.date || m.fecha ? new Date(m.date || m.fecha).toLocaleString('es-AR') : '';
                return [
                    `"${dateStr}"`,
                    `"${m.type || m.tipo || ''}"`,
                    `"${(m.concept || m.concepto || '').replace(/"/g, '""')}"`,
                    `"${(m.party || m.emisor_receptor || '').replace(/"/g, '""')}"`,
                    `"${m.source || m.origen || ''}"`,
                    `"${m.amount || m.monto || 0}"`
                ];
            });

            const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reporte_balances_flota_${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            Components.showToast('Reporte CSV descargado correctamente 📄', 'success');
        } catch (e) {
            console.error('Error al exportar CSV:', e);
            Components.showToast('Error al generar el reporte CSV: ' + e.message, 'danger');
        }
    }

        function _resolveFleetId() {
        if (typeof Auth !== 'undefined' && Auth.getFleetId && Auth.getFleetId() && Auth.getFleetId() !== 'jose07') {
            return Auth.getFleetId();
        }
        if (typeof DB !== 'undefined' && DB.getFleet && DB.getFleet() && DB.getFleet() !== 'jose07') {
            return DB.getFleet();
        }
        const stored = localStorage.getItem('last_fleet_id');
        if (stored && stored !== 'jose07') return stored;
        return '-OnPd8HaV1VZWBnYQQX7';
    }

    async function _autoCreateGoogleSheet() {
        Components.showToast('Creando planilla de Google Sheets automáticamente... ⏳', 'info');
        try {
            const fleetId = _resolveFleetId();
            const res = await fetch('/api/sheets/auto-create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fleetId })
            });
            const data = await res.json();
            if (data.ok && data.spreadsheetUrl) {
                await DB.setSetting('google_sheet_id', data.spreadsheetUrl);
                return data.spreadsheetUrl;
            } else {
                Components.showToast('Error al crear planilla: ' + (data.error || 'Error desconocido'), 'danger');
                return null;
            }
        } catch(e) {
            Components.showToast('Error al conectar con el servidor: ' + e.message, 'danger');
            return null;
        }
    }

    async function syncAllSheets() {
        try {
            let sheetId = (await DB.getSetting('google_sheet_id')) || '';
            if (!sheetId) {
                if (typeof SettingsModule !== 'undefined' && SettingsModule.autoCreateGoogleSheet) {
                    await SettingsModule.autoCreateGoogleSheet();
                } else {
                    await _autoCreateGoogleSheet();
                }
                sheetId = (await DB.getSetting('google_sheet_id')) || '';
                if (!sheetId) return;
            }
            const movements = await _getMovements();
            if (!movements || movements.length === 0) {
                Components.showToast('No hay movimientos registrados para sincronizar', 'warning');
                return;
            }
            Components.showToast(`Sincronizando ${movements.length} movimientos a Google Sheets... ⏳`, 'info');
            let synced = 0;
            for (const m of movements) {
                await _syncWithGoogleSheets(sheetId, m);
                synced++;
            }
            Components.showToast(`¡${synced} movimientos enviados a Google Sheets! 📊`, 'success');
        } catch (e) {
            console.error('Error al sincronizar historial a Sheets:', e);
            Components.showToast('Error al sincronizar con Google Sheets', 'danger');
        }
    }

    function showGoogleSheetsOptions() {
        const fleetId = _resolveFleetId();
        const formula = `=IMPORTDATA("${window.location.origin}/api/sheets/csv?fleetId=${fleetId}")`;

        Components.showModal(
            '📊 Balance en Google Sheets (Hoja de Cálculo)',
            `
            <div style="padding:10px;">
                <div style="text-align:center; font-size:2.5rem; margin-bottom:10px;">📊✨</div>
                <h3 style="text-align:center; margin-bottom:10px; color:var(--text-primary);">Balance Automático en Vivo</h3>
                <p style="font-size:0.88rem; color:var(--text-secondary); margin-bottom:15px; text-align:center;">
                    Todas las transferencias, facturas y comprobantes escaneados por WhatsApp se reflejan automáticamente en tu hoja de cálculo.
                </p>

                <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:10px; padding:12px; margin-bottom:15px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-weight:700; color:#10b981; font-size:12px;">⚡ MÉTODO DIRECTO (100% Automático)</span>
                        <button class="btn btn-sm btn-success" onclick="navigator.clipboard.writeText(document.getElementById('balanceSheetFormula').value); Components.showToast('¡Fórmula copiada! Pegala en la celda A1 📋', 'success');" style="font-weight:700; font-size:11px; padding:4px 8px; background:#10b981; border:none; color:#fff;">
                            📋 Copiar Fórmula
                        </button>
                    </div>
                    <p style="font-size:11px; color:var(--text-secondary); margin-bottom:6px;">
                        1. Creá una hoja de cálculo en blanco (<a href="https://sheets.new" target="_blank" style="color:#10b981; font-weight:700; text-decoration:underline;">sheets.new</a>)<br>
                        2. En la celda <strong>A1</strong> pegá esta fórmula:
                    </p>
                    <input type="text" id="balanceSheetFormula" readonly class="form-input" 
                        style="font-family:monospace; font-size:11px !important; background:rgba(0,0,0,0.25); color:#10b981; font-weight:700; border:1px dashed #10b981;"
                        value='${formula}'>
                </div>

                <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
                    <a href="https://sheets.new" target="_blank" class="btn btn-primary" style="font-weight:700; padding:8px 14px; text-decoration:none; font-size:0.88rem;">
                        ➕ Abrir Hoja en Blanco
                    </a>
                    <button class="btn btn-secondary" onclick="BalancesModule.exportCSV(); Components.closeModal();" style="font-weight:600; padding:8px 14px; font-size:0.88rem;">
                        📥 Descargar Excel/CSV
                    </button>
                    <button class="btn btn-secondary" onclick="Components.closeModal(); Router.navigate('settings');" style="font-weight:600; padding:8px 14px; font-size:0.88rem;">
                        ⚙️ Ajustes Avanzados
                    </button>
                </div>
            </div>
            `,
            `<button class="btn btn-secondary" onclick="Components.closeModal()">Cerrar</button>`
        );
    }

    async function scanWhatsApp() {
        const btn = document.getElementById('btnScanWhatsapp');
        const originalText = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '⏳ Escaneando...';
        }
        Components.showToast('Escaneando WhatsApp en busca de transferencias y facturas... 🔍⏳', 'info');

        try {
            const fleetId = _resolveFleetId();
            const origin = (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'https://fleetadmin-web-nueva.onrender.com'
                : window.location.origin;
            const res = await fetch(`${origin}/api/bot/scan-historical`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fleetId })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `Error del servidor (${res.status})`);
            }

            const data = await res.json();
            if (data.ok) {
                const total = data.scanResult?.totalMovements || 0;
                const newProcessed = data.scanResult?.newProcessed || 0;
                const synced = data.scanResult?.syncedToSheets || 0;
                const origin = (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                    ? 'https://fleetadmin-web-nueva.onrender.com'
                    : window.location.origin;
                const importFormula = data.importFormula || `=IMPORTDATA("${origin}/api/sheets/csv?fleetId=${fleetId}")`;
                const csvUrl = data.csvUrl || `${origin}/api/sheets/csv?fleetId=${fleetId}`;

                Components.showToast(`¡Escaneo finalizado! ${newProcessed} nuevos comprobantes procesados ✅`, 'success');

                Components.showModal(
                    '🔍 Escaneo de WhatsApp & Balance Completo',
                    `
                    <div style="text-align:center; padding:10px;">
                        <div style="font-size:3rem; margin-bottom:10px;">📊🚗💰</div>
                        <h3 style="margin-bottom:10px; color:var(--text-primary);">¡Escaneo Contable Finalizado!</h3>
                        <p style="font-size:0.9rem; color:var(--text-secondary); margin-bottom:15px;">
                            ${data.message || 'Se analizaron los comprobantes de transferencias y facturas en WhatsApp.'}
                        </p>

                        <div style="display:flex; justify-content:space-around; background:rgba(255,255,255,0.05); padding:12px; border-radius:10px; margin-bottom:15px; gap:8px;">
                            <div style="flex:1;">
                                <div style="font-size:1.4rem; font-weight:800; color:var(--color-primary-light);">${total}</div>
                                <div style="font-size:0.75rem; color:var(--text-secondary);">Total en Balance</div>
                            </div>
                            <div style="flex:1;">
                                <div style="font-size:1.4rem; font-weight:800; color:#f59e0b;">${newProcessed}</div>
                                <div style="font-size:0.75rem; color:var(--text-secondary);">Nuevos Detectados</div>
                            </div>
                            <div style="flex:1;">
                                <div style="font-size:1.4rem; font-weight:800; color:#10b981;">${synced}</div>
                                <div style="font-size:0.75rem; color:var(--text-secondary);">Sincronizados a Sheets</div>
                            </div>
                        </div>

                        <div style="text-align:left; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:10px; margin-bottom:15px;">
                            <div style="font-size:12px; font-weight:700; color:#10b981; margin-bottom:4px;">📊 Para ver el balance en Google Sheets:</div>
                            <div style="font-size:11px; color:var(--text-secondary); margin-bottom:6px;">Pegá esta fórmula en la celda A1 de una hoja de cálculo en blanco:</div>
                            <div style="display:flex; gap:6px;">
                                <input type="text" readonly value='${importFormula}' id="modalFormulaInput" style="flex:1; font-family:monospace; font-size:10px; background:rgba(0,0,0,0.3); color:#10b981; padding:6px; border-radius:6px; border:1px solid #10b981;">
                                <button class="btn btn-sm btn-success" onclick="navigator.clipboard.writeText(document.getElementById('modalFormulaInput').value); Components.showToast('¡Fórmula copiada! 📋', 'success');" style="font-size:11px; font-weight:700; background:#10b981;">📋 Copiar</button>
                            </div>
                        </div>

                        ${newProcessed === 0 ? `
                        <div style="text-align:left; background:rgba(99,102,241,0.1); border:1px solid rgba(99,102,241,0.3); border-radius:8px; padding:10px; margin-bottom:15px;">
                            <div style="font-size:12px; font-weight:700; color:#818cf8; margin-bottom:4px;">💡 ¿Buscás comprobantes antiguos o facturas en PDF?</div>
                            <div style="font-size:11px; color:var(--text-secondary); margin-bottom:8px;">
                                Si WhatsApp no envió los mensajes antiguos de tu celular por ser una sesión previa, podés subir directamente las fotos de transferencias y PDFs de facturas o importar el chat con la IA contable.
                            </div>
                            <button class="btn btn-sm" onclick="Components.closeModal(); BalancesModule.showImportModal();" style="width:100%; font-size:11px; font-weight:700; background:#6366f1; color:#fff; border:none; padding:7px 10px; border-radius:6px; cursor:pointer;">
                                📥 Subir Comprobantes y Facturas con IA
                            </button>
                        </div>
                        ` : ''}

                        <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
                            <a href="https://sheets.new" target="_blank" class="btn btn-primary" style="font-weight:700; padding:8px 16px; text-decoration:none;">
                                ➕ Abrir Google Sheets Nuevo
                            </a>
                            <a href="${csvUrl}" download class="btn btn-secondary" style="font-weight:600; padding:8px 16px; text-decoration:none;">
                                📥 Descargar CSV
                            </a>
                        </div>
                    </div>
                    `,
                    `<button class="btn btn-secondary" onclick="Components.closeModal(); Router.navigate('balances');">Cerrar y Actualizar</button>`
                );

                // Refrescar automáticamente la tabla de balances
                Router.navigate('balances');
            } else {
                Components.showToast('Error al escanear: ' + (data.error || 'Error desconocido'), 'danger');
            }
        } catch(e) {
            console.error('Error al solicitar escaneo de WhatsApp:', e);
            Components.showToast('Error al escanear WhatsApp: ' + e.message, 'danger');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText || '🔍 Escanear WhatsApp';
            }
        }
    }

    async function confirmPendingPayment(code) {
        if (!confirm(`¿Confirmás el ingreso del pago #${code} al balance de la flota?`)) return;
        try {
            Components.showToast('Confirmando ingreso y sincronizando... ⏳', 'info');
            const res = await fetch('/api/bot/pending-payments/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await res.json();
            if (data.ok) {
                Components.showToast(`¡Pago #${code} confirmado y acreditado con éxito! 💰✅`, 'success');
                Router.navigate('balances');
            } else {
                Components.showToast('Error al confirmar: ' + (data.message || data.error), 'danger');
            }
        } catch(e) {
            Components.showToast('Error de red al confirmar pago: ' + e.message, 'danger');
        }
    }

    async function rejectPendingPayment(code) {
        if (!confirm(`¿Estás seguro de que deseás rechazar el pago #${code}?`)) return;
        try {
            Components.showToast('Rechazando pago... ⏳', 'info');
            const res = await fetch('/api/bot/pending-payments/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            const data = await res.json();
            if (data.ok) {
                Components.showToast(`Pago #${code} descartado correctamente.`, 'warning');
                Router.navigate('balances');
            } else {
                Components.showToast('Error al rechazar: ' + (data.message || data.error), 'danger');
            }
        } catch(e) {
            Components.showToast('Error de red al rechazar pago: ' + e.message, 'danger');
        }
    }

    // ============================================
    // MÓDULO DE IMPORTACIÓN DIRECTA CON IA
    // ============================================
    let _selectedFiles = [];

    function handleFilesSelect(files) {
        if (!files || !files.length) return;
        _selectedFiles = Array.from(files);
        _renderSelectedFiles();
    }

    function handleFilesDrop(files) {
        if (!files || !files.length) return;
        _selectedFiles = Array.from(files);
        _renderSelectedFiles();
    }

    function clearSelectedFiles() {
        _selectedFiles = [];
        _renderSelectedFiles();
    }

    function _renderSelectedFiles() {
        const container = document.getElementById('selectedFilesContainer');
        const countSpan = document.getElementById('selectedFilesCount');
        const listDiv = document.getElementById('selectedFilesList');
        const btnStart = document.getElementById('btnStartImport');
        if (!container || !listDiv || !btnStart) return;

        if (_selectedFiles.length === 0) {
            container.style.display = 'none';
            btnStart.disabled = true;
            return;
        }

        container.style.display = 'block';
        countSpan.textContent = `Archivos seleccionados: ${_selectedFiles.length}`;
        btnStart.disabled = false;

        listDiv.innerHTML = _selectedFiles.map((f, i) => {
            const isPdf = f.name.toLowerCase().endsWith('.pdf');
            const sizeKb = (f.size / 1024).toFixed(1);
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:260px;">${isPdf ? '📄' : '🖼️'} <strong>${f.name}</strong> (${sizeKb} KB)</span>
                    <span class="badge" style="background:${isPdf ? '#ef4444' : '#3b82f6'}; font-size:10px; color:#fff; padding:2px 6px; border-radius:4px;">${isPdf ? 'PDF' : 'IMAGEN'}</span>
                </div>
            `;
        }).join('');
    }

    function switchImportTab(tab) {
        const tabFiles = document.getElementById('tabContentFiles');
        const tabText = document.getElementById('tabContentText');
        const tabQR = document.getElementById('tabContentQR');
        const btnFiles = document.getElementById('tabBtnFiles');
        const btnText = document.getElementById('tabBtnText');
        const btnQR = document.getElementById('tabBtnQR');

        if (tabFiles) tabFiles.style.display = (tab === 'files') ? 'block' : 'none';
        if (tabText) tabText.style.display = (tab === 'text') ? 'block' : 'none';
        if (tabQR) tabQR.style.display = (tab === 'qr') ? 'block' : 'none';

        if (btnFiles) btnFiles.className = (tab === 'files') ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
        if (btnText) btnText.className = (tab === 'text') ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
        if (btnQR) btnQR.className = (tab === 'qr') ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
    }

    async function _readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (e) => reject(e);
            reader.readAsDataURL(file);
        });
    }

    async function startFileImport() {
        if (!_selectedFiles.length) {
            Components.showToast('Seleccioná al menos un archivo para procesar', 'warning');
            return;
        }

        const btn = document.getElementById('btnStartImport');
        const progressBar = document.getElementById('importProgressBar');
        const progressFill = document.getElementById('importProgressFill');
        const progressStatus = document.getElementById('importProgressStatus');
        const driverName = document.getElementById('importDriverSelect')?.value || null;

        if (btn) btn.disabled = true;
        if (progressBar) progressBar.style.display = 'block';

        const fleetId = _resolveFleetId();
        const origin = (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'https://fleetadmin-web-nueva.onrender.com'
            : window.location.origin;

        try {
            const total = _selectedFiles.length;
            let totalProcessed = 0;
            let totalIngresos = 0;
            let totalEgresos = 0;

            for (let i = 0; i < total; i++) {
                const file = _selectedFiles[i];
                if (progressStatus) progressStatus.textContent = `Procesando con IA (${i + 1}/${total}): ${file.name}... ⏳`;
                if (progressFill) progressFill.style.width = `${Math.round(((i) / total) * 100)}%`;

                const base64Data = await _readFileAsBase64(file);
                const payload = {
                    fleetId,
                    files: [{
                        name: file.name,
                        mimeType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
                        base64: base64Data,
                        driverName: driverName
                    }]
                };

                const res = await fetch(`${origin}/api/bot/import-receipts`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.ok && data.processedCount > 0) {
                        totalProcessed += data.processedCount;
                        totalIngresos += (data.totalIngresos || 0);
                        totalEgresos += (data.totalEgresos || 0);
                    }
                }
            }

            if (progressFill) progressFill.style.width = '100%';
            if (progressStatus) progressStatus.textContent = `¡Completado! ${totalProcessed} comprobantes/facturas procesados.`;

            Components.showToast(`¡Procesamiento finalizado! ${totalProcessed} movimientos registrados ✅`, 'success');
            setTimeout(() => {
                Components.closeModal();
                Router.navigate('balances');
            }, 1200);

        } catch(e) {
            console.error('Error importando archivos:', e);
            Components.showToast('Error procesando archivos: ' + e.message, 'danger');
            if (btn) btn.disabled = false;
        }
    }

    async function startTextImport() {
        const text = document.getElementById('importChatText')?.value || '';
        if (!text.trim()) {
            Components.showToast('Pegá el texto de WhatsApp a analizar', 'warning');
            return;
        }

        const btn = document.getElementById('btnProcessChatText');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = 'Analizando texto con IA... ⏳';
        }

        const fleetId = _resolveFleetId();
        const origin = (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'https://fleetadmin-web-nueva.onrender.com'
            : window.location.origin;

        try {
            const res = await fetch(`${origin}/api/bot/import-receipts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fleetId, rawText: text })
            });

            const data = await res.json();
            if (data.ok) {
                Components.showToast(`¡Listo! Se extrajeron ${data.processedCount || 0} movimientos del chat ✅`, 'success');
                setTimeout(() => {
                    Components.closeModal();
                    Router.navigate('balances');
                }, 1000);
            } else {
                Components.showToast('Error al procesar chat: ' + (data.error || 'Error desconocido'), 'danger');
            }
        } catch(e) {
            Components.showToast('Error al analizar texto: ' + e.message, 'danger');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '🔍 Extraer Movimientos del Chat con IA';
            }
        }
    }

    async function requestQRFullSync() {
        if (!confirm('Esto reiniciará temporalmente la sesión de WhatsApp del Bot para que puedas escanear un nuevo código QR con sincronización completa de historial. ¿Deseás continuar?')) return;
        try {
            Components.showToast('Solicitando reinicio para Desktop Full Sync... ⏳', 'info');
            const origin = (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'https://fleetadmin-web-nueva.onrender.com'
                : window.location.origin;
            const res = await fetch(`${origin}/api/bot/request-qr-fullsync`, { method: 'POST' });
            const data = await res.json();
            if (data.ok) {
                Components.showToast('Sesión lista. Redirigiendo a Configuración para escanear el QR...', 'success');
                Components.closeModal();
                Router.navigate('settings');
            } else {
                Components.showToast('Error: ' + data.error, 'danger');
            }
        } catch(e) {
            Components.showToast('Error: ' + e.message, 'danger');
        }
    }

    async function showImportModal() {
        let users = [];
        try {
            users = (await DB.getAll('users')) || [];
        } catch(e) {}
        const driverOptions = users.map(u => `<option value="${u.name || u.nombre}">${u.name || u.nombre} (${u.phone || u.telefono || 'Sin tel'})</option>`).join('');

        _selectedFiles = [];

        Components.showModal(
            '📥 Importador de Comprobantes, Facturas y Chats con IA',
            `
            <div style="padding:10px;">
                <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-color); margin-bottom:15px; padding-bottom:8px; flex-wrap:wrap;">
                    <button id="tabBtnFiles" class="btn btn-sm btn-primary" onclick="BalancesModule.switchImportTab('files')" style="font-weight:700; font-size:12px;">
                        📂 Subir Imágenes y PDFs
                    </button>
                    <button id="tabBtnText" class="btn btn-sm btn-secondary" onclick="BalancesModule.switchImportTab('text')" style="font-weight:700; font-size:12px;">
                        📝 Pegar Chat de WhatsApp
                    </button>
                    <button id="tabBtnQR" class="btn btn-sm btn-secondary" onclick="BalancesModule.switchImportTab('qr')" style="font-weight:700; font-size:12px;">
                        📲 Sincronización QR
                    </button>
                </div>

                <!-- Tab 1: Archivos -->
                <div id="tabContentFiles">
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">
                        Arrastrá o seleccioná uno o varios comprobantes de transferencia (Mercado Pago, Cuenta DNI, bancos) o facturas en PDF (AFIP A/B/C, tickets de nafta, mecánico).
                    </p>

                    <div id="dropZone" style="border:2px dashed #6366f1; border-radius:12px; padding:25px; text-align:center; background:rgba(99,102,241,0.05); cursor:pointer; margin-bottom:15px;"
                         onclick="document.getElementById('receiptFileInput').click()"
                         ondragover="event.preventDefault(); this.style.background='rgba(99,102,241,0.15)';"
                         ondragleave="this.style.background='rgba(99,102,241,0.05)';"
                         ondrop="event.preventDefault(); BalancesModule.handleFilesDrop(event.dataTransfer.files);">
                        <div style="font-size:2.5rem; margin-bottom:8px;">📄📸</div>
                        <div style="font-weight:700; font-size:0.95rem; color:var(--text-primary);">
                            Hacé clic o arrastrá aquí tus comprobantes y facturas
                        </div>
                        <div style="font-size:0.8rem; color:var(--text-secondary); margin-top:4px;">
                            Formatos soportados: JPG, PNG, WEBP, PDF (AFIP, bancos, billeteras)
                        </div>
                        <input type="file" id="receiptFileInput" multiple accept="image/*,.pdf" style="display:none;" onchange="BalancesModule.handleFilesSelect(this.files)">
                    </div>

                    <div style="margin-bottom:15px;">
                        <label style="font-size:0.85rem; font-weight:700; display:block; margin-bottom:4px; color:var(--text-primary);">
                            👤 Chofer Asociado (Opcional):
                        </label>
                        <select id="importDriverSelect" class="form-control" style="width:100%; font-size:0.85rem; padding:8px; border-radius:8px; background:var(--bg-primary); color:var(--text-primary); border:1px solid var(--border-color);">
                            <option value="">Detectar automáticamente por IA</option>
                            ${driverOptions}
                        </select>
                    </div>

                    <div id="selectedFilesContainer" style="display:none; margin-bottom:15px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                            <span style="font-size:0.85rem; font-weight:700; color:var(--text-primary);" id="selectedFilesCount">Archivos seleccionados: 0</span>
                            <button class="btn btn-sm btn-danger" onclick="BalancesModule.clearSelectedFiles()" style="font-size:11px; padding:2px 8px;">Limpiar</button>
                        </div>
                        <div id="selectedFilesList" style="max-height:120px; overflow-y:auto; background:rgba(0,0,0,0.2); border-radius:8px; padding:8px; font-size:0.8rem;"></div>
                    </div>

                    <div id="importProgressBar" style="display:none; margin-bottom:15px;">
                        <div style="font-size:0.85rem; font-weight:700; color:#6366f1; margin-bottom:6px;" id="importProgressStatus">
                            Analizando con Gemini IA... ⏳
                        </div>
                        <div style="background:rgba(255,255,255,0.1); border-radius:6px; height:8px; overflow:hidden;">
                            <div id="importProgressFill" style="background:#6366f1; width:0%; height:100%; transition:width 0.3s;"></div>
                        </div>
                    </div>

                    <button id="btnStartImport" class="btn btn-primary" onclick="BalancesModule.startFileImport()" style="width:100%; font-weight:700; padding:10px; background:#6366f1; border:none; color:#fff;" disabled>
                        🚀 Procesar con Inteligencia Artificial
                    </button>
                </div>

                <!-- Tab 2: Pegar Chat de WhatsApp -->
                <div id="tabContentText" style="display:none;">
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:8px;">
                        Pegá aquí mensajes de WhatsApp o el archivo de texto exportado de un chat. La IA extraerá todas las transferencias, pagos de choferes y gastos automáticamente:
                    </p>
                    <textarea id="importChatText" rows="6" class="form-control" placeholder="Ej:&#10;[25/9 14:30] Kiara: Jose te transferí 45000 de la recaudación&#10;[25/9 16:15] Lucas: Pagué $18.500 de nafta en YPF&#10;[25/9 18:00] Taller: Te paso la factura de 65000 por el cambio de pastillas" style="width:100%; font-size:0.85rem; padding:10px; border-radius:8px; background:var(--bg-primary); color:var(--text-primary); border:1px solid var(--border-color); margin-bottom:12px; font-family:monospace;"></textarea>

                    <button id="btnProcessChatText" class="btn btn-primary" onclick="BalancesModule.startTextImport()" style="width:100%; font-weight:700; padding:10px; background:#6366f1; border:none; color:#fff;">
                        🔍 Extraer Movimientos del Chat con IA
                    </button>
                </div>

                <!-- Tab 3: Sincronización QR -->
                <div id="tabContentQR" style="display:none; text-align:center;">
                    <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">
                        Para descargar todo el archivo histórico directamente de WhatsApp a tu base de datos, podés re-vincular tu WhatsApp en <strong>Modo Desktop Completo</strong>.
                    </p>
                    <div style="background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.3); border-radius:10px; padding:12px; margin-bottom:15px; text-align:left; font-size:0.85rem;">
                        <strong>Pasos:</strong><br>
                        1. Hacé clic en "Solicitar Nuevo QR de Sincronización Total".<br>
                        2. En tu WhatsApp del celular andá a <em>Dispositivos vinculados</em> → <em>Vincular un dispositivo</em>.<br>
                        3. Escaneá el QR generado. WhatsApp enviará todo el historial histórico a FleetAdmin Pro.
                    </div>
                    <button class="btn btn-warning" onclick="BalancesModule.requestQRFullSync()" style="font-weight:700; padding:10px 18px; background:#f59e0b; border:none; color:#fff;">
                        🔄 Solicitar Nuevo QR de Sincronización Total
                    </button>
                </div>
            </div>
            `,
            `<button class="btn btn-secondary" onclick="Components.closeModal()">Cerrar</button>`
        );
    }

    return {
        render,
        setFilter,
        showAddMovementModal,
        saveMovement,
        deleteMovement,
        viewReceipt,
        exportCSV,
        syncAllSheets,
        showGoogleSheetsOptions,
        scanWhatsApp,
        scanHistoricalWhatsApp: scanWhatsApp,
        confirmPendingPayment,
        rejectPendingPayment,
        showImportModal,
        switchImportTab,
        handleFilesSelect,
        handleFilesDrop,
        clearSelectedFiles,
        startFileImport,
        startTextImport,
        requestQRFullSync
    };
})();
