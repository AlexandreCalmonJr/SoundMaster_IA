/**
 * SoundMaster — EQ Display Service
 * Shared template for rendering EQ instrument data into a container.
 *
 * API Pública (window.EqDisplayService):
 *   .renderEqDisplay(containerEl, instrumentKey, eqData)
 */

'use strict';

(function () {

    function renderEqDisplay(containerEl, instrumentKey, eqData) {
        if (!containerEl) return;

        if (!eqData) {
            containerEl.innerHTML = `
                <div class="flex items-center justify-center h-48 opacity-20">
                    <p class="text-xs uppercase font-black tracking-widest text-white">Selecione um instrumento</p>
                </div>
            `;
            return;
        }

        function _e(s){return String(s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]});}
        containerEl.innerHTML = `
            <div class="bg-slate-800/60 border border-white/10 rounded-2xl p-6 space-y-4">
                <div class="flex items-center gap-4">
                    <span class="text-4xl" aria-hidden="true">${_e(eqData.icon)}</span>
                    <h3 class="text-xl font-bold text-cyan-400">${_e(eqData.title)}</h3>
                </div>
                <div class="space-y-2 pt-2">
                    <div><strong>HPF (Corte de Graves):</strong> <span class="text-slate-300 font-mono">${_e(eqData.hpf)}</span></div>
                    <div><strong>Área Crítica (Mud):</strong> <span class="text-amber-400 font-mono">${_e(eqData.mud)}</span></div>
                    <div><strong>Presença/Clareza:</strong> <span class="text-green-400 font-mono">${_e(eqData.presence)}</span></div>
                </div>
                <div class="mt-4 pt-4 border-t border-white/10 text-sm text-slate-400 leading-relaxed italic">
                    Dica: ${_e(eqData.tips)}
                </div>
            </div>
        `;
    }

    window.EqDisplayService = { renderEqDisplay };

})();
