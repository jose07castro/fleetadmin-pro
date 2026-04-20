/* ============================================
   FleetAdmin Pro — Panel de Personalización UI (v110)
   - Sliders: fuente, ancho de cuadros, espaciado
   - Split-Panes arrastrables con S-Pen support
   - Botón "Sincronizar Diseño a la Flota" (solo Admin)
   - Firebase global_ui_settings listener (efecto espejo)
   - Persistencia localStorage + Firebase
   ============================================ */

const UISettings = (() => {
    const STORAGE_KEY = 'fleetadmin_ui_settings';
    const FIREBASE_NODE = 'global_ui_settings';
    const DEFAULTS = {
        fontSize: 16,       // px (12–24)
        cardWidth: 220,      // px (160–400)
        rowGap: 16,          // px (4–40)
        splitStats: 50,      // % split position for stats vs activity
        splitCommunity: 60   // % split position for announcements vs community
    };

    let _panelOpen = false;
    let _firebaseListenerActive = false;
    let _isDraggingSplit = null; // Which split handle is being dragged

    // ============ STORAGE ============

    function _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                return { ...DEFAULTS, ...parsed };
            }
        } catch (e) { /* corrupted */ }
        return { ...DEFAULTS };
    }

    function _save(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('⚠️ UISettings: No se pudo guardar:', e);
        }
    }

    // ============ CSS VARIABLES ============

    function apply(settings) {
        if (!settings) settings = _load();
        const root = document.documentElement;
        root.style.setProperty('--ui-font-size', settings.fontSize + 'px');
        root.style.setProperty('--ui-card-min-width', settings.cardWidth + 'px');
        root.style.setProperty('--ui-row-gap', settings.rowGap + 'px');
        root.style.setProperty('--ui-split-stats', (settings.splitStats || 50) + '%');
        root.style.setProperty('--ui-split-community', (settings.splitCommunity || 60) + '%');
    }

    // ============ INIT ============

    function init() {
        const settings = _load();
        apply(settings);
        _mountPanel();
        _startFirebaseListener();
        console.log('⚙️ UISettings v110 inicializado:', settings);
    }

    // ============ GEAR BUTTON ============



    // ============ SETTINGS PANEL ============

    function _mountPanel() {
        if (document.getElementById('uiSettingsOverlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'uiSettingsOverlay';
        overlay.className = 'ui-settings-overlay';
        overlay.onclick = () => closePanel();

        const panel = document.createElement('div');
        panel.id = 'uiSettingsPanel';
        panel.className = 'ui-settings-panel';
        panel.onclick = (e) => e.stopPropagation();

        const settings = _load();

        // Check if current user is admin (OwnerAdmin)
        const isAdmin = typeof Auth !== 'undefined' && Auth.getUserName && Auth.getUserName() === 'OwnerAdmin';

        panel.innerHTML = `
            <div class="ui-settings-panel-header">
                <h3>⚙️ Personalizar UI</h3>
                <button class="ui-settings-panel-close" onclick="UISettings.closePanel()">✕</button>
            </div>
            <div class="ui-settings-panel-body">
                <!-- Tamaño de Letra -->
                <div class="ui-setting-section">
                    <div class="ui-setting-label">
                        <span>🔤 Tamaño de Letra</span>
                        <span class="ui-setting-value" id="uiFontSizeVal">${settings.fontSize}px</span>
                    </div>
                    <input type="range" class="ui-slider" id="uiFontSizeSlider"
                           min="12" max="24" step="1" value="${settings.fontSize}"
                           oninput="UISettings.onSliderChange()">
                    <div class="ui-setting-preview" id="uiFontSizePreview"
                         style="font-size: ${settings.fontSize}px;">
                        Vista previa del texto — Abc 123
                    </div>
                </div>

                <!-- Ancho de Cuadros -->
                <div class="ui-setting-section">
                    <div class="ui-setting-label">
                        <span>📐 Ancho de Cuadros</span>
                        <span class="ui-setting-value" id="uiCardWidthVal">${settings.cardWidth}px</span>
                    </div>
                    <input type="range" class="ui-slider" id="uiCardWidthSlider"
                           min="160" max="400" step="10" value="${settings.cardWidth}"
                           oninput="UISettings.onSliderChange()">
                    <div class="ui-setting-preview">
                        <div style="display:flex; gap:8px;">
                            <div id="uiCardWidthPreview" style="min-width:${settings.cardWidth / 4}px; height:40px; background: linear-gradient(135deg, rgba(99,102,241,0.3), rgba(6,182,212,0.3)); border-radius:8px; border:1px solid rgba(99,102,241,0.3); transition: min-width 0.2s ease;"></div>
                            <div style="flex:1; height:40px; background: var(--bg-tertiary); border-radius:8px; opacity:0.4;"></div>
                        </div>
                    </div>
                </div>

                <!-- Espaciado entre Filas -->
                <div class="ui-setting-section">
                    <div class="ui-setting-label">
                        <span>↕️ Espaciado entre Filas</span>
                        <span class="ui-setting-value" id="uiRowGapVal">${settings.rowGap}px</span>
                    </div>
                    <input type="range" class="ui-slider" id="uiRowGapSlider"
                           min="4" max="40" step="2" value="${settings.rowGap}"
                           oninput="UISettings.onSliderChange()">
                    <div class="ui-setting-preview">
                        <div style="display:flex; flex-direction:column;" id="uiRowGapPreview">
                            <div style="height:12px; background: linear-gradient(90deg, rgba(99,102,241,0.4), rgba(6,182,212,0.4)); border-radius:4px; margin-bottom:${settings.rowGap}px;"></div>
                            <div style="height:12px; background: linear-gradient(90deg, rgba(99,102,241,0.4), rgba(6,182,212,0.4)); border-radius:4px; margin-bottom:${settings.rowGap}px;"></div>
                            <div style="height:12px; background: linear-gradient(90deg, rgba(99,102,241,0.4), rgba(6,182,212,0.4)); border-radius:4px;"></div>
                        </div>
                    </div>
                </div>

                <!-- Divisor: Proporción Paneles -->
                <div class="ui-setting-section">
                    <div class="ui-setting-label">
                        <span>📊 Proporción Paneles</span>
                        <span class="ui-setting-value" id="uiSplitStatsVal">${settings.splitStats || 50}%</span>
                    </div>
                    <input type="range" class="ui-slider" id="uiSplitStatsSlider"
                           min="20" max="80" step="1" value="${settings.splitStats || 50}"
                           oninput="UISettings.onSliderChange()">
                    <div class="ui-setting-preview" style="font-size:0.75rem; color:var(--text-tertiary);">
                        Controla la proporción entre Anuncios y Centro de Comunidad
                    </div>
                </div>

                <!-- Reset -->
                <button class="ui-settings-reset-btn" onclick="UISettings.resetDefaults()">
                    🔄 Restaurar Valores Originales
                </button>

                ${isAdmin ? `
                <!-- ═══ SINCRONIZACIÓN GLOBAL (Solo Admin) ═══ -->
                <div style="margin-top:24px; padding-top:20px; border-top:2px solid rgba(99,102,241,0.3);">
                    <div style="font-size:0.85rem; font-weight:700; color:var(--color-primary-light); margin-bottom:12px; display:flex; align-items:center; gap:8px;">
                        🛡️ Mando Global de Admin
                    </div>
                    <button class="ui-sync-fleet-btn" onclick="UISettings.syncToFleet()">
                        📡 Sincronizar Diseño a la Flota
                    </button>
                    <div style="font-size:0.7rem; color:var(--text-tertiary); margin-top:8px; line-height:1.4;">
                        Al presionar, todos los dispositivos de choferes recibirán esta configuración automáticamente.
                    </div>
                </div>
                ` : ''}
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(panel);
    }

    // ============ PANEL TOGGLE ============



    function closePanel() {
        const overlay = document.getElementById('uiSettingsOverlay');
        const panel = document.getElementById('uiSettingsPanel');
        if (overlay) overlay.classList.remove('open');
        if (panel) panel.classList.remove('open');
        _panelOpen = false;
    }

    function _syncSliders(s) {
        const ids = {
            uiFontSizeSlider: s.fontSize,
            uiCardWidthSlider: s.cardWidth,
            uiRowGapSlider: s.rowGap,
            uiSplitStatsSlider: s.splitStats || 50
        };
        for (const [id, val] of Object.entries(ids)) {
            const el = document.getElementById(id);
            if (el) el.value = val;
        }
    }

    // ============ SLIDER HANDLER ============

    function onSliderChange() {
        const fontSize = parseInt(document.getElementById('uiFontSizeSlider')?.value || DEFAULTS.fontSize);
        const cardWidth = parseInt(document.getElementById('uiCardWidthSlider')?.value || DEFAULTS.cardWidth);
        const rowGap = parseInt(document.getElementById('uiRowGapSlider')?.value || DEFAULTS.rowGap);
        const splitStats = parseInt(document.getElementById('uiSplitStatsSlider')?.value || DEFAULTS.splitStats);

        const settings = { fontSize, cardWidth, rowGap, splitStats };
        apply(settings);
        _save(settings);
        _updateLabels(settings);
        _applySplitPanes(settings);
    }

    function _updateLabels(s) {
        const updates = {
            uiFontSizeVal: s.fontSize + 'px',
            uiCardWidthVal: s.cardWidth + 'px',
            uiRowGapVal: s.rowGap + 'px',
            uiSplitStatsVal: (s.splitStats || 50) + '%'
        };
        for (const [id, text] of Object.entries(updates)) {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        }

        const fontPreview = document.getElementById('uiFontSizePreview');
        if (fontPreview) fontPreview.style.fontSize = s.fontSize + 'px';

        const cardPreview = document.getElementById('uiCardWidthPreview');
        if (cardPreview) cardPreview.style.minWidth = (s.cardWidth / 4) + 'px';

        const gapPreview = document.getElementById('uiRowGapPreview');
        if (gapPreview) {
            const bars = gapPreview.querySelectorAll('div');
            bars.forEach((bar, i) => {
                if (i < bars.length - 1) bar.style.marginBottom = s.rowGap + 'px';
            });
        }
    }

    // ============ SPLIT PANES ============

    function _applySplitPanes(settings) {
        if (!settings) settings = _load();
        const grid = document.querySelector('.dashboard-community-grid');
        if (!grid) return;

        const pct = settings.splitStats || 50;
        const left = pct;
        const right = 100 - pct;
        grid.style.gridTemplateColumns = `${left}fr ${right}fr`;
    }

    // Wire split-pane dividers on dashboard after render
    function wireSplitPanes() {
        const settings = _load();
        _applySplitPanes(settings);

        const grid = document.querySelector('.dashboard-community-grid');
        if (!grid || grid.querySelector('.split-handle')) return;

        // Insert the split handle between the two children
        const handle = document.createElement('div');
        handle.className = 'split-handle';
        handle.innerHTML = '<div class="split-handle-grip">⋮⋮</div>';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-label', 'Redimensionar paneles');
        handle.setAttribute('tabindex', '0');

        // Insert handle as second child (between column 1 and column 2)
        if (grid.children.length >= 2) {
            grid.insertBefore(handle, grid.children[1]);
            // Update grid to 3 columns: left | handle | right
            const pct = settings.splitStats || 50;
            grid.style.gridTemplateColumns = `${pct}fr 8px ${100 - pct}fr`;
        }

        // Pointer events for mouse, touch, AND S-Pen
        handle.addEventListener('pointerdown', _onSplitStart);
        handle.addEventListener('pointerenter', () => handle.classList.add('split-hover'));
        handle.addEventListener('pointerleave', () => {
            if (!_isDraggingSplit) handle.classList.remove('split-hover');
        });
    }

    function _onSplitStart(e) {
        e.preventDefault();
        e.stopPropagation();
        _isDraggingSplit = e.currentTarget;
        _isDraggingSplit.classList.add('split-active');
        _isDraggingSplit.setPointerCapture(e.pointerId);

        document.addEventListener('pointermove', _onSplitMove);
        document.addEventListener('pointerup', _onSplitEnd);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    }

    function _onSplitMove(e) {
        if (!_isDraggingSplit) return;
        const grid = _isDraggingSplit.parentElement;
        if (!grid) return;

        const rect = grid.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const pct = Math.max(20, Math.min(80, (x / rect.width) * 100));

        grid.style.gridTemplateColumns = `${pct}fr 8px ${100 - pct}fr`;

        // Live update setting
        const settings = _load();
        settings.splitStats = Math.round(pct);
        _save(settings);
        apply(settings);

        // Update slider if panel is open
        const slider = document.getElementById('uiSplitStatsSlider');
        const label = document.getElementById('uiSplitStatsVal');
        if (slider) slider.value = settings.splitStats;
        if (label) label.textContent = settings.splitStats + '%';
    }

    function _onSplitEnd(e) {
        if (_isDraggingSplit) {
            _isDraggingSplit.classList.remove('split-active');
            _isDraggingSplit = null;
        }
        document.removeEventListener('pointermove', _onSplitMove);
        document.removeEventListener('pointerup', _onSplitEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }

    // ============ FIREBASE SYNC ============

    async function syncToFleet() {
        const settings = _load();
        try {
            if (typeof firebaseDB === 'undefined') throw new Error('Firebase no disponible');

            const payload = {
                fontSize: settings.fontSize,
                cardWidth: settings.cardWidth,
                rowGap: settings.rowGap,
                splitStats: settings.splitStats || 50,
                updatedAt: new Date().toISOString(),
                updatedBy: (typeof Auth !== 'undefined' && Auth.getUserName) ? Auth.getUserName() : 'Admin'
            };

            await firebaseDB.ref(FIREBASE_NODE).set(payload);

            if (typeof Components !== 'undefined' && Components.showToast) {
                Components.showToast('📡 Diseño sincronizado a toda la flota', 'success');
            }
            console.log('📡 UISettings: Diseño global sincronizado:', payload);
        } catch (err) {
            console.error('❌ UISettings syncToFleet error:', err);
            if (typeof Components !== 'undefined' && Components.showToast) {
                Components.showToast('Error al sincronizar: ' + err.message, 'danger');
            }
        }
    }

    function _startFirebaseListener() {
        if (_firebaseListenerActive) return;
        if (typeof firebaseDB === 'undefined') {
            console.warn('⚠️ UISettings: Firebase no disponible, sin listener global');
            return;
        }

        try {
            firebaseDB.ref(FIREBASE_NODE).on('value', (snap) => {
                const data = snap.val();
                if (!data) return;

                // Don't override admin's own settings on the same device that just pushed
                const isAdmin = typeof Auth !== 'undefined' && Auth.getUserName && Auth.getUserName() === 'OwnerAdmin';
                if (isAdmin) {
                    console.log('🛡️ UISettings: Admin recibió sync, ignorando (es el origen)');
                    return;
                }

                console.log('📡 UISettings: Recibido diseño global de Firebase:', data);

                const newSettings = {
                    fontSize: data.fontSize || DEFAULTS.fontSize,
                    cardWidth: data.cardWidth || DEFAULTS.cardWidth,
                    rowGap: data.rowGap || DEFAULTS.rowGap,
                    splitStats: data.splitStats || DEFAULTS.splitStats
                };

                _save(newSettings);
                apply(newSettings);
                _applySplitPanes(newSettings);

                // If the settings panel is open, update the sliders
                if (_panelOpen) {
                    _syncSliders(newSettings);
                    _updateLabels(newSettings);
                }

                if (typeof Components !== 'undefined' && Components.showToast) {
                    Components.showToast('📡 Diseño actualizado por el Administrador', 'info');
                }
            });

            _firebaseListenerActive = true;
            console.log('📡 UISettings: Firebase listener activo en ' + FIREBASE_NODE);
        } catch (err) {
            console.warn('⚠️ UISettings: Error activando listener:', err);
        }
    }

    // ============ RESET ============

    function resetDefaults() {
        _save(DEFAULTS);
        apply(DEFAULTS);
        _applySplitPanes(DEFAULTS);
        _syncSliders(DEFAULTS);
        _updateLabels(DEFAULTS);

        if (typeof Components !== 'undefined' && Components.showToast) {
            Components.showToast('✅ Valores restaurados a los originales', 'success');
        }
    }

    // ============ PUBLIC API ============

    function getSettings() {
        return _load();
    }

    return {
        init, apply,
        onSliderChange, resetDefaults, getSettings,
        syncToFleet, wireSplitPanes
    };
})();
