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
                            ${sheetId ? `
                            <button class="btn btn-secondary" onclick="BalancesModule.syncAllSheets()" style="font-weight:600; font-size:0.88rem;">
                                📊 Sincronizar Historial a Sheet
                            </button>` : ''}
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
            await fetch('/api/sheets/append', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sheetId, movement })
            });
            console.log('📊 Sincronizado con Google Sheets ✅');
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

    async function syncAllSheets() {
        try {
            const sheetId = (await DB.getSetting('google_sheet_id')) || '';
            if (!sheetId) {
                Components.showToast('No tenés ninguna planilla vinculada. Hace clic en ⚙️ Configurar Escáner.', 'warning');
                return;
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

    return {
        render,
        setFilter,
        showAddMovementModal,
        saveMovement,
        deleteMovement,
        viewReceipt,
        exportCSV,
        syncAllSheets
    };
})();
