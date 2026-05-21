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

        // Use global eqData (either bridged or loaded via script dependency)
        const data = window.eqData ? window.eqData[select.value] : null;
        if (!data) {
            display.innerHTML = `
                <div class="bg-slate-800/40 border border-white/10 rounded-2xl p-8 text-center text-slate-500">
                    Selecione um instrumento acima para carregar o guia.
                </div>
            `;
            return;
        }

        display.innerHTML = `
            <div class="bg-slate-800/60 border border-white/10 rounded-2xl p-6 space-y-4">
                <div class="flex items-center gap-4">
                    <span class="text-4xl" aria-hidden="true">${data.icon}</span>
                    <h3 class="text-xl font-bold text-cyan-400">${data.title}</h3>
                </div>
                <div class="space-y-2 pt-2">
                    <div><strong>HPF (Corte de Graves):</strong> <span class="text-slate-300 font-mono">${data.hpf}</span></div>
                    <div><strong>Área Crítica (Mud):</strong> <span class="text-amber-400 font-mono">${data.mud}</span></div>
                    <div><strong>Presença/Clareza:</strong> <span class="text-green-400 font-mono">${data.presence}</span></div>
                </div>
                <div class="mt-4 pt-4 border-t border-white/10 text-sm text-slate-400 leading-relaxed italic">
                    Dica: ${data.tips}
                </div>
            </div>
        `;
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
