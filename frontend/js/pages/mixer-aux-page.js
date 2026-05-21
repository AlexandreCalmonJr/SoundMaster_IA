/**
 * SoundMaster — Mixer Aux Page Module
 * Controls the 10 aux outputs (monitors), their names, volume levels, delay, and mutes.
 */

'use strict';

(function () {
    const pm = createPageModule();

    let auxNames = {};
    const defaultNames = ['Pastor', 'Líder', 'Vocal 1', 'Vocal 2', 'Piano', 'Bateria', 'Guit 1', 'Guit 2', 'Side L', 'Side R'];

    async function loadNames() {
        try {
            const savedNames = await MixerService.loadNames();
            auxNames = savedNames.aux || {};
        } catch (e) {
            console.error('[MixerAuxPage] Error loading names:', e);
        }
    }

    function renderAuxiliaries() {
        const container = pm._el('mixer-aux-container');
        if (!container) return;

        // Configura container para scroll horizontal conforme layout
        container.className = 'mixer-scroll-container pb-6 flex gap-6 overflow-x-auto';

        container.innerHTML = '';
        for (let i = 1; i <= 10; i++) {
            const auxName = auxNames[i] || defaultNames[i - 1] || `AUX ${i}`;
            const auxCard = document.createElement('div');
            auxCard.className = 'bg-slate-900/60 border border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col gap-6 min-w-[300px] min-h-[350px] flex-shrink-0 relative overflow-hidden';
            auxCard.innerHTML = `
                <div class="flex items-center justify-between border-b border-white/5 pb-4">
                    <input type="text" id="name-aux-${i}" value="${auxName}" 
                           class="bg-transparent text-sm font-black uppercase tracking-widest text-cyan-400 focus:outline-none focus:text-white transition-colors w-40">
                    <span class="px-2 py-1 bg-green-900/30 text-green-400 text-[8px] font-black rounded-md border border-green-500/20 uppercase">Post-Fader</span>
                </div>
                
                <div class="flex-1 flex flex-col gap-4 items-center justify-between bg-black/40 rounded-2xl p-4 border border-white/5 shadow-inner">
                    <div class="flex flex-col gap-2 w-full items-center">
                        <span class="text-[9px] text-slate-500 uppercase font-black tracking-widest">Nível Envio</span>
                        <div class="h-32 w-12 flex justify-center bg-black/20 rounded-xl py-3 border border-white/5 relative">
                            <input type="range" id="aux-level-${i}" min="0" max="100" value="70" 
                                   class="fader-vertical text-cyan-500" orient="vertical">
                        </div>
                    </div>

                    <div class="w-full space-y-3">
                        <div class="flex flex-col gap-1 w-full">
                            <div class="flex justify-between items-center px-1">
                                <span class="text-[8px] text-slate-500 uppercase font-black">Delay</span>
                                <span id="aux-delay-val-${i}" class="text-[9px] text-cyan-500 font-bold">0ms</span>
                            </div>
                            <input type="range" id="aux-delay-${i}" min="0" max="500" value="0" class="w-full accent-cyan-500 cursor-pointer h-1.5 bg-slate-800 rounded-full appearance-none">
                        </div>
                        
                        <button id="btn-aux-mute-${i}" class="w-full py-2.5 bg-slate-800 text-slate-500 text-[9px] font-black rounded-xl border border-white/5 hover:bg-red-900/20 hover:text-red-500 transition-all active:scale-95 uppercase tracking-tighter">Mute Auxiliar</button>
                    </div>
                </div>
            `;
            container.appendChild(auxCard);

            // Bind Event Listeners
            const muteBtn = pm._el(`btn-aux-mute-${i}`);
            if (muteBtn) {
                pm._on(muteBtn, 'click', () => {
                    const stateKey = `mute_aux_${i}`;
                    const isMuted = AppStore.getState()[stateKey] || false;
                    MixerService.sendRaw(`SETD|a|${i - 1}|mute|${isMuted ? 0 : 1}`);
                    AppStore.setState({ [stateKey]: !isMuted });
                    AppStore.addLog(`AUX ${i}: ${!isMuted ? 'MUTADO' : 'ATIVO'}`);
                });
            }

            const levelInput = pm._el(`aux-level-${i}`);
            if (levelInput) {
                pm._on(levelInput, 'input', (e) => {
                    const val = e.target.value / 100;
                    if (window.SocketService) {
                        window.SocketService.lockFader(`aux_${i}`, val);
                    }
                    MixerService.sendRaw(`SETD|a|${i - 1}|mix|${val}`);
                });
                pm._on(levelInput, 'change', () => {
                    if (window.SocketService) {
                        window.SocketService.unlockFader(`aux_${i}`);
                    }
                });
            }

            const delayInput = pm._el(`aux-delay-${i}`);
            if (delayInput) {
                pm._on(delayInput, 'input', (e) => {
                    const ms = e.target.value;
                    const valDisplay = pm._el(`aux-delay-val-${i}`);
                    if (valDisplay) valDisplay.innerText = `${ms}ms`;
                    MixerService.setDelay(i, ms);
                });
            }

            const nameInput = pm._el(`name-aux-${i}`);
            if (nameInput) {
                pm._on(nameInput, 'blur', (e) => {
                    const newNames = AppStore.getState().mixerNames || { channels: {}, aux: {} };
                    if (!newNames.aux) newNames.aux = {};
                    newNames.aux[i] = e.target.value;
                    MixerService.saveNames(newNames);
                });
            }

            // Subscriptions
            pm._subscribe('AppStore', `mute_aux_${i}`, (isMuted) => {
                updateAuxMuteUI(i, isMuted);
            });

            pm._subscribe('AppStore', `aux_${i}_level`, (level) => {
                if (window.SocketService && window.SocketService.isFaderLocked(`aux_${i}`)) return;
                const fader = pm._el(`aux-level-${i}`);
                if (fader) {
                    fader.value = Math.round((level || 0) * 100);
                }
            });

            pm._subscribe('AppStore', `aux_${i}_delay`, (ms) => {
                const slider = pm._el(`aux-delay-${i}`);
                const valDisplay = pm._el(`aux-delay-val-${i}`);
                if (slider) slider.value = ms || 0;
                if (valDisplay) valDisplay.innerText = `${ms || 0}ms`;
            });
        }
    }

    function updateAuxMuteUI(auxIdx, isMuted) {
        const btn = pm._el(`btn-aux-mute-${auxIdx}`);
        if (!btn) return;
        
        if (isMuted) {
            btn.classList.remove('bg-slate-800', 'text-slate-500');
            btn.classList.add('bg-red-600', 'text-white', 'border-red-400');
            btn.innerText = 'MUTADO';
        } else {
            btn.classList.add('bg-slate-800', 'text-slate-500');
            btn.classList.remove('bg-red-600', 'text-white', 'border-red-400');
            btn.innerText = 'MUTE AUXILIAR';
        }
    }

    function init() {
        loadNames().then(() => {
            renderAuxiliaries();
        });
    }

    function destroy() {
        pm.destroy();
    }

    window.MixerAuxPage = {
        init: init,
        destroy: destroy
    };
})();
