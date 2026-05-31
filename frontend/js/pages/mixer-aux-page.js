/**
 * @fileoverview Módulo de Página de Auxiliares/Monitores do Mixer
 * @module MixerAuxPage
 * @description Página responsável por controlar as 10 saídas auxiliares (monitores).
 * Permite configurar níveis de envio, nomes personalizados, delay (até 500ms)
 * e silenciamento individual de cada auxiliar.
 *
 * ## Funcionalidades Principais
 * - Renderização de 10 cards de auxiliares com layout horizontal
 * - Controle de nível de envio via fader vertical (0-100%)
 * - Ajuste de delay por auxiliar (0-500ms)
 * - Controle de mute com feedback visual (vermelho quando ativo)
 * - Edição de nomes com nomes padrão pré-definidos (Pastor, Líder, Vocal 1, etc.)
 * - Indicador de status "Post-Fader" por auxiliar
 *
 * ## Como Usar
 * 1. Inicializar a página chamando `MixerAuxPage.init()`
 * 2. Ajustar o fader de nível para controlar o envio de áudio para cada monitor
 * 3. Configurar delay conforme necessário (para compensação de latência)
 * 4. Usar botão "MUTE AUXILIAR" para silenciar temporariamente
 * 5. Editar nomes conforme os músicos/instrumentos
 *
 * ## Dependências e Integrações
 * - **MixerService**: Serviço de comunicação com o mixer (comandos SETD, saveNames, setDelay)
 * - **AppStore**: Armazenamento de estado global (níveis aux, mutes, nomes)
 * - **SocketService**: Serviço de WebSocket para controle de faders (lock/unlock)
 * - **createPageModule()**: Factory de módulo de página para gerenciamento de lifecycle
 * - Eventos: `mute_aux_X` (mute auxiliar), `aux_X_level` (nível aux), `aux_X_delay` (delay aux)
 * - Nomes padrão: Pastor, Líder, Vocal 1, Vocal 2, Piano, Bateria, Guit 1, Guit 2, Side L, Side R
 */

'use strict';

(function () {
    const pm = createPageModule();

    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    let auxNames = {};
    let localMuteState = {};
    const _auxDebounce = {};
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
        var state = AppStore.getState ? AppStore.getState() : {};
        for (let i = 1; i <= 10; i++) {
            const auxName = auxNames[i] || defaultNames[i - 1] || `AUX ${i}`;
            const auxCard = document.createElement('div');
            auxCard.className = 'bg-slate-900/60 border border-white/10 rounded-3xl p-6 shadow-2xl flex flex-col gap-6 min-w-[300px] min-h-[350px] flex-shrink-0 relative overflow-hidden';
            auxCard.innerHTML = `
                <div class="flex items-center justify-between border-b border-white/5 pb-4">
                    <input type="text" id="name-aux-${i}" value="${esc(auxName)}" 
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

            localMuteState[i] = state['mute_aux_' + i] || false;
            if (localMuteState[i]) updateAuxMuteUI(i, true);

            // Bind Event Listeners
            const muteBtn = pm._el(`btn-aux-mute-${i}`);
            if (muteBtn) {
                pm._on(muteBtn, 'click', () => {
                    var next = !localMuteState[i];
                    localMuteState[i] = next;
                    MixerService.sendRaw(`SETD|a|${i - 1}|mute|${next ? 1 : 0}`);
                    AppStore.setState({ ['mute_aux_' + i]: next });
                    AppStore.addLog(`AUX ${i}: ${next ? 'MUTADO' : 'ATIVO'}`);
                    updateAuxMuteUI(i, next);
                });
            }

            const levelInput = pm._el(`aux-level-${i}`);
            if (levelInput) {
                pm._on(levelInput, 'pointerdown', (e) => {
                    const val = Number(e.target.value) / 100;
                    if (window.SocketService) SocketService.lockFader(`aux_${i}`, val);
                });
                pm._on(levelInput, 'change', (e) => {
                    const val = Number(e.target.value) / 100;
                    MixerService.sendRaw(`SETD|a|${i - 1}|mix|${val}`);
                    clearTimeout(_auxDebounce[i]);
                    _auxDebounce[i] = setTimeout(() => {
                        if (window.SocketService) SocketService.unlockFader(`aux_${i}`);
                    }, 300);
                });
            }

            const delayInput = pm._el(`aux-delay-${i}`);
            if (delayInput) {
                pm._on(delayInput, 'input', (e) => {
                    const ms = e.target.value;
                    const valDisplay = pm._el(`aux-delay-val-${i}`);
                    if (valDisplay) valDisplay.innerText = `${ms}ms`;
                });
                pm._on(delayInput, 'change', (e) => {
                    const ms = e.target.value;
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
                localMuteState[i] = !!isMuted;
                updateAuxMuteUI(i, !!isMuted);
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
        }).catch(err => {
            console.error('[MixerAuxPage] init error:', err);
        });
    }

    function destroy() {
        Object.keys(_auxDebounce).forEach(function (k) { clearTimeout(_auxDebounce[k]); delete _auxDebounce[k]; });
        pm.destroy();
    }

    window.MixerAuxPage = {
        init: init,
        destroy: destroy
    };
})();
