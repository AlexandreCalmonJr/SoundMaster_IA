/**
 * SoundMaster — EQ Guide Page Module
 * Controls the detailed equalization guide, AI synchronization, and dynamic suggestions.
 */

'use strict';

(function () {
    const pm = createPageModule();

    function updateEqDisplay() {
        const select = pm._el('eq-instrument-select');
        const display = pm._el('eq-data-display');
        if (!select || !display) return;

        const data = window.eqData ? window.eqData[select.value] : null;
        if (!data) {
            display.innerHTML = `
                <div class="flex items-center justify-center h-48 opacity-20">
                    <p class="text-xs uppercase font-black tracking-widest text-white">Guia indisponível</p>
                </div>
            `;
            return;
        }

        display.innerHTML = `
            <div class="flex flex-col md:flex-row gap-8 items-center justify-between">
                <div class="flex-1 space-y-4">
                    <div class="flex items-center gap-4">
                        <span class="p-3 bg-cyan-950/40 rounded-2xl text-3xl" aria-hidden="true">${data.icon}</span>
                        <div>
                            <h3 class="text-2xl font-black text-white">${data.title}</h3>
                            <p class="text-xs text-slate-400 font-bold uppercase tracking-wider">Perfil Técnico de Equalização</p>
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                        <div class="bg-black/30 p-4 rounded-xl border border-white/5">
                            <div class="text-[9px] text-slate-500 uppercase font-black mb-1">HPF (Graves)</div>
                            <div class="text-sm font-black text-cyan-400">${data.hpf}</div>
                        </div>
                        <div class="bg-black/30 p-4 rounded-xl border border-white/5">
                            <div class="text-[9px] text-red-500/80 uppercase font-black mb-1">Corte Crítico (Mud)</div>
                            <div class="text-sm font-black text-amber-500">${data.mud}</div>
                        </div>
                        <div class="bg-black/30 p-4 rounded-xl border border-white/5">
                            <div class="text-[9px] text-green-500/80 uppercase font-black mb-1">Presença (Clareza)</div>
                            <div class="text-sm font-black text-green-400">${data.presence}</div>
                        </div>
                    </div>
                </div>

                <div class="w-full md:w-80 bg-black/20 p-6 rounded-2xl border border-white/5 self-stretch flex flex-col justify-between">
                    <div>
                        <h4 class="text-[10px] uppercase font-black text-slate-500 tracking-wider mb-2">Recomendação de Mix</h4>
                        <p class="text-xs text-slate-300 leading-relaxed">${data.tips}</p>
                    </div>
                    <div class="text-[9px] text-slate-500 mt-4 border-t border-white/5 pt-2 flex items-center justify-between">
                        <span>Reativo via Engine</span>
                        <span class="text-green-500 font-bold">● Pronto</span>
                    </div>
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

        const btnSync = pm._el('btn-sync-eq-ai');
        if (btnSync && select) {
            pm._on(btnSync, 'click', () => {
                const instrument = select.options[select.selectedIndex].text;
                const channelInput = pm._el('ai-target-channel');
                const channel = channelInput ? channelInput.value : 1;

                if (window.AIService) {
                    window.AIService.ask(`Equalizar ${instrument} no canal ${channel}`, channel);
                    alert(`🚀 Enviado para a IA: "Equalizar ${instrument} no canal ${channel}"`);
                } else {
                    console.error('[EQGuidePage] AIService not found.');
                }
            });
        }
    }

    function destroy() {
        pm.destroy();
    }

    window.EqGuidePage = {
        init: init,
        destroy: destroy
    };
})();
