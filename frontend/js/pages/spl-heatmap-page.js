/**
 * SoundMaster — SPL Heatmap Page Module
 * Delegates heatmap configuration and spatial averaging rendering to SoundMasterHeatmap.
 */

'use strict';

(function () {
    const pm = createPageModule();

    function init() {
        if (window.SoundMasterHeatmap && typeof window.SoundMasterHeatmap.init === 'function') {
            window.SoundMasterHeatmap.init();
        } else {
            console.error('[SplHeatmapPage] SoundMasterHeatmap not found.');
        }
    }

    function destroy() {
        if (window.SoundMasterHeatmap && typeof window.SoundMasterHeatmap.destroy === 'function') {
            window.SoundMasterHeatmap.destroy();
        }
        pm.destroy();
    }

    window.SplHeatmapPage = {
        init: init,
        destroy: destroy
    };
})();
