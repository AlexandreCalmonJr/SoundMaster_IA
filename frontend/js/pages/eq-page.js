/**
 * SoundMaster — EQ Page Module
 * Displays basic equalization advice per instrument.
 */

'use strict';

(function () {
    const pm = createPageModule();

    function updateEqDisplay() {
        const select = pm._el('eq-instrument-select');
        const display = pm._el('eq-data-display');
        if (!select || !display) return;

        const data = window.eqData ? window.eqData[select.value] : null;
        if (window.EqDisplayService) {
            EqDisplayService.renderEqDisplay(display, select.value, data);
        }
    }

    function init() {
        const select = pm._el('eq-instrument-select');
        if (select) {
            pm._on(select, 'change', updateEqDisplay);
            updateEqDisplay();
        }
    }

    function destroy() {
        pm.destroy();
    }

    window.EqPage = {
        init: init,
        destroy: destroy
    };
})();
