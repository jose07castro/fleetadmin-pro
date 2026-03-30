/* ============================================
   FleetAdmin Pro — Panel de Personalización UI (v108)
   Controles deslizantes para tamaño de fuente,
   ancho de cuadros y espaciado entre filas.
   Persistencia en localStorage.
   ============================================ */

const UISettings = (() => {
    const STORAGE_KEY = 'fleetadmin_ui_settings';
    const DEFAULTS = {
        fontSize: 16,      // px (12–24)
        cardWidth: 220,     // px (160–400)
        rowGap: 16          // px (4–40)
    };

    let _panelOpen = false;

    // --- Cargar config guardada ---
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

    // --- Guardar config ---
    function _save(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('⚠️ UISettings: No se pudo guardar:', e);
        }
    }

    // --- Aplicar CSS Variables ---
    function apply(settings) {
        if (!settings) settings = _load();
        const root = document.documentElement;
        root.style.setProperty('--ui-font-size', settings.fontSize + 'px');
        root.style.setProperty('--ui-card-min-width', settings.cardWidth + 'px');
        root.style.setProperty('--ui-row-gap', settings.rowGap + 'px');
    }

    // --- Inicializar: aplicar settings y montar el botón gear ---
    function init() {
        const settings = _load();
        apply(settings);
        _mountGearButton();
        _mountPanel();
        console.log('⚙️ UISettings v108 inicializado:', settings);
    }

    // --- Montar el botón engranaje flotante ---
    function _mountGearButton() {
        if (document.getElementById('uiSettingsGear')) return;
        const btn = document.createElement('button');
        btn.id = 'uiSettingsGear';
        btn.className = 'ui-settings-gear';
        btn.innerHTML = '⚙️';
        btn.title = 'Personalizar interfaz';
        btn.onclick = togglePanel;
        document.body.appendChild(btn);
    }

    // --- Montar el panel slide-out ---
    function _mountPanel() {
        if (document.getElementById('uiSettingsOverlay')) return;

        // Overlay
        const overlay = document.createElement('div');
        overlay.id = 'uiSettingsOverlay';
        overlay.className = 'ui-settings-overlay';
        overlay.onclick = () => closePanel();

        // Panel
        const panel = document.createElement('div');
        panel.id = 'uiSettingsPanel';
        panel.className = 'ui-settings-panel';
        panel.onclick = (e) => e.stopPropagation(); // prevent close on panel click

        const settings = _load();

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

                <!-- Reset -->
                <button class="ui-settings-reset-btn" onclick="UISettings.resetDefaults()">
                    🔄 Restaurar Valores Originales
                </button>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(panel);
    }

    // --- Toggle panel ---
    function togglePanel() {
        if (_panelOpen) {
            closePanel();
        } else {
            openPanel();
        }
    }

    function openPanel() {
        const overlay = document.getElementById('uiSettingsOverlay');
        const panel = document.getElementById('uiSettingsPanel');
        if (overlay) overlay.classList.add('open');
        if (panel) panel.classList.add('open');
        _panelOpen = true;

        // Sync slider values to current settings
        const settings = _load();
        const fontSlider = document.getElementById('uiFontSizeSlider');
        const cardSlider = document.getElementById('uiCardWidthSlider');
        const gapSlider = document.getElementById('uiRowGapSlider');
        if (fontSlider) fontSlider.value = settings.fontSize;
        if (cardSlider) cardSlider.value = settings.cardWidth;
        if (gapSlider) gapSlider.value = settings.rowGap;
        _updateLabels(settings);
    }

    function closePanel() {
        const overlay = document.getElementById('uiSettingsOverlay');
        const panel = document.getElementById('uiSettingsPanel');
        if (overlay) overlay.classList.remove('open');
        if (panel) panel.classList.remove('open');
        _panelOpen = false;
    }

    // --- Slider change handler (live preview + save) ---
    function onSliderChange() {
        const fontSize = parseInt(document.getElementById('uiFontSizeSlider')?.value || DEFAULTS.fontSize);
        const cardWidth = parseInt(document.getElementById('uiCardWidthSlider')?.value || DEFAULTS.cardWidth);
        const rowGap = parseInt(document.getElementById('uiRowGapSlider')?.value || DEFAULTS.rowGap);

        const settings = { fontSize, cardWidth, rowGap };

        // Apply instantly
        apply(settings);
        // Save to localStorage
        _save(settings);
        // Update labels and previews
        _updateLabels(settings);
    }

    function _updateLabels(s) {
        const fontVal = document.getElementById('uiFontSizeVal');
        const cardVal = document.getElementById('uiCardWidthVal');
        const gapVal = document.getElementById('uiRowGapVal');

        if (fontVal) fontVal.textContent = s.fontSize + 'px';
        if (cardVal) cardVal.textContent = s.cardWidth + 'px';
        if (gapVal) gapVal.textContent = s.rowGap + 'px';

        // Font preview
        const fontPreview = document.getElementById('uiFontSizePreview');
        if (fontPreview) fontPreview.style.fontSize = s.fontSize + 'px';

        // Card width preview
        const cardPreview = document.getElementById('uiCardWidthPreview');
        if (cardPreview) cardPreview.style.minWidth = (s.cardWidth / 4) + 'px';

        // Row gap preview
        const gapPreview = document.getElementById('uiRowGapPreview');
        if (gapPreview) {
            const bars = gapPreview.querySelectorAll('div');
            bars.forEach((bar, i) => {
                if (i < bars.length - 1) {
                    bar.style.marginBottom = s.rowGap + 'px';
                }
            });
        }
    }

    // --- Reset to defaults ---
    function resetDefaults() {
        _save(DEFAULTS);
        apply(DEFAULTS);

        const fontSlider = document.getElementById('uiFontSizeSlider');
        const cardSlider = document.getElementById('uiCardWidthSlider');
        const gapSlider = document.getElementById('uiRowGapSlider');
        if (fontSlider) fontSlider.value = DEFAULTS.fontSize;
        if (cardSlider) cardSlider.value = DEFAULTS.cardWidth;
        if (gapSlider) gapSlider.value = DEFAULTS.rowGap;

        _updateLabels(DEFAULTS);

        if (typeof Components !== 'undefined' && Components.showToast) {
            Components.showToast('✅ Valores restaurados a los originales', 'success');
        }
    }

    // --- Obtener config actual (para uso externo / Firebase sync futuro) ---
    function getSettings() {
        return _load();
    }

    return {
        init, apply, togglePanel, openPanel, closePanel,
        onSliderChange, resetDefaults, getSettings
    };
})();
