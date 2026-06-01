/**
 * @fileoverview Módulo de Página de Entradas do Mixer
 * @module MixerInputPage
 * @description Página responsável por controlar as 24 entradas de canais do mixer.
 * Permite ajustar níveis de volume (faders), silenciamento (mute), nomes dos canais
 * e exibição de medidores VU em tempo real.
 *
 * ## Funcionalidades Principais
 * - Renderização de 24 canais de entrada com controles individuais
 * - Ajuste de níveis via faders verticais (0-100%)
 * - Controle de mute por canal com estado visual
 * - Edição de nomes dos canais com persistência
 * - Medidores VU com atualização em tempo real
 * - Suporte a mixagem master e auxiliar (10 saídas aux)
 *
 * ## Como Usar
 * 1. Inicializar a página chamando `MixerInputPage.init()`
 * 2. Selecionar o destino de mixagem (master ou aux) no seletor
 * 3. Ajustar faders para controlar níveis de volume
 * 4. Usar botões MUTE para silenciar canais individuais
 * 5. Editar nomes clicando nos campos de texto abaixo de cada canal
 *
 * ## Dependências e Integrações
 * - **MixerService**: Serviço de comunicação com o mixer (envio de comandos, carregamento de nomes)
 * - **AppStore**: Armazenamento de estado global da aplicação (níveis, mutes, nomes)
 * - **SocketService**: Serviço de WebSocket para atualizações em tempo real
 * - **createPageModule()**: Factory de módulo de página para gerenciamento de lifecycle
 * - Eventos: `vuData` (dados VU), `ch_X_level` (nível do canal), `mute_ch_X` (estado mute)
 */

'use strict';

(function () {
    const pm = createPageModule();

    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    }); }

    let chNames = {};
    let currentTarget = 'master';
    let localMuteState = {};
    let localSoloState = {};
    let localMtkState = {};

    async function loadNames() {
        try {
            const savedNames = await MixerService.loadNames();
            chNames = savedNames.channels || {};
        } catch (e) {
            console.error('[MixerInputPage] Error loading names:', e);
        }
    }

    function renderConsole() {
        const container = pm._el('mixer-channels-container');
        if (!container) return;

        container.innerHTML = '';
        var state = AppStore.getState ? AppStore.getState() : {};
        for (let i = 1; i <= 24; i++) {
            const chName = chNames[i] || `CANAL ${i}`;
            localMuteState[i] = state[`mute_ch_${i}`] || false;
            localSoloState[i] = state[`ch_${i}_solo`] || false;
            localMtkState[i] = state[`ch_${i}_mtk_selected`] || false;
            const chDiv = document.createElement('div');
            chDiv.className = 'w-24 flex flex-col gap-4 flex-shrink-0';
            chDiv.innerHTML =
                '<div class="flex-1 bg-black/40 rounded-2xl p-3 flex flex-col items-center gap-4 border border-white/5 group hover:border-cyan-500/30 transition-all">' +
                    '<span class="text-[10px] font-black text-slate-500 uppercase">Ch ' + i.toString().padStart(2, '0') + '</span>' +
                    '<div class="flex-1 w-2 bg-slate-800 rounded-full relative overflow-hidden">' +
                        '<div id="meter-ch-' + i + '" class="absolute bottom-0 w-full bg-cyan-500 h-[0%] transition-all duration-200"></div>' +
                    '</div>' +
                    '<div class="w-6 h-20 relative flex items-center justify-center bg-black/20 rounded-xl border border-white/5 overflow-hidden">' +
                         '<input type="range" id="gain-ch-' + i + '" min="0" max="100" value="75" class="fader-vertical text-cyan-500" orient="vertical">' +
                    '</div>' +
                    '<input type="text" id="name-ch-' + i + '" value="' + esc(chName) + '" class="bg-transparent text-[9px] font-bold text-white text-center w-full focus:outline-none focus:bg-white/5 rounded p-1 border-b border-transparent focus:border-cyan-500/50">' +
                '</div>' +
                '<div class="flex gap-1 w-full mt-2">' +
                    '<button id="mute-ch-' + i + '" class="flex-1 py-1.5 bg-slate-800 text-slate-500 text-[9px] font-black rounded-lg border border-white/5 transition-all uppercase">Mute</button>' +
                    '<button id="solo-ch-' + i + '" class="flex-1 py-1.5 bg-slate-800 text-slate-500 text-[9px] font-black rounded-lg border border-white/5 transition-all uppercase">Solo</button>' +
                    '<button id="mtk-ch-' + i + '" class="flex-1 py-1.5 bg-slate-800 text-slate-500 text-[9px] font-black rounded-lg border border-white/5 transition-all uppercase">Mtk</button>' +
                '</div>';
            container.appendChild(chDiv);

            // Apply initial states
            if (localMuteState[i]) updateMuteUI(i, true);
            if (localSoloState[i]) updateSoloUI(i, true);
            if (localMtkState[i]) updateMtkUI(i, true);

            // Bind DOM events
            const muteBtn = pm._el('mute-ch-' + i);
            if (muteBtn) {
                pm._on(muteBtn, 'click', function () {
                    var next = !localMuteState[i];
                    localMuteState[i] = next;
                    MixerService.sendRaw('SETD|c|' + (i - 1) + '|mute|' + (next ? 1 : 0));
                    AppStore.setState({ ['mute_ch_' + i]: next });
                    updateMuteUI(i, next);
                });
            }

            const soloBtn = pm._el('solo-ch-' + i);
            if (soloBtn) {
                pm._on(soloBtn, 'click', function () {
                    var next = !localSoloState[i];
                    localSoloState[i] = next;
                    MixerService.sendRaw('SETD|c|' + (i - 1) + '|solo|' + (next ? 1 : 0));
                    AppStore.setState({ ['ch_' + i + '_solo']: next });
                    updateSoloUI(i, next);
                });
            }

            const mtkBtn = pm._el('mtk-ch-' + i);
            if (mtkBtn) {
                pm._on(mtkBtn, 'click', function () {
                    var next = !localMtkState[i];
                    localMtkState[i] = next;
                    if (window.SocketService) {
                        SocketService.emit('execute_ai_command', { action: 'mtk_select', channel: i, enabled: next ? 1 : 0 });
                    }
                    AppStore.setState({ ['ch_' + i + '_mtk_selected']: next });
                    updateMtkUI(i, next);
                });
            }

            const gainInput = pm._el('gain-ch-' + i);
            if (gainInput) {
                (function (chIdx, gainEl) {
                    var _faderLocked = false;
                    pm._on(gainEl, 'pointerdown', function () { _faderLocked = true; });
                    pm._on(gainEl, 'input', function (e) {
                        var val = e.target.value / 100;
                        if (currentTarget === 'master') {
                            MixerService.sendRaw('SETD|c|' + (chIdx - 1) + '|mix|' + val);
                        } else if (currentTarget.startsWith('aux')) {
                            var auxIdx = parseInt(currentTarget.replace('aux', ''));
                            MixerService.setAuxLevel(chIdx, auxIdx, val);
                        }
                    });
                    pm._on(gainEl, 'change', function () {
                        setTimeout(function () { _faderLocked = false; }, 300);
                    });
                    pm._subscribe('AppStore', 'ch_' + chIdx + '_level', function (level) {
                        if (_faderLocked) return;
                        var fader = pm._el('gain-ch-' + chIdx);
                        if (fader) fader.value = Math.round((level || 0) * 100);
                    });
                })(i, gainInput);
            }

            const nameInput = pm._el('name-ch-' + i);
            if (nameInput) {
                pm._on(nameInput, 'blur', function (e) {
                    var newNames = AppStore.getState().mixerNames || { channels: {}, aux: {} };
                    if (!newNames.channels) newNames.channels = {};
                    newNames.channels[i] = e.target.value;
                    MixerService.saveNames(newNames);
                });
            }

            pm._subscribe('AppStore', 'mute_ch_' + i, function (isMuted) {
                localMuteState[i] = !!isMuted;
                updateMuteUI(i, !!isMuted);
            });

            pm._subscribe('AppStore', 'ch_' + i + '_solo', function (isSolo) {
                localSoloState[i] = !!isSolo;
                updateSoloUI(i, !!isSolo);
            });

            pm._subscribe('AppStore', 'ch_' + i + '_mtk_selected', function (isMtk) {
                localMtkState[i] = !!isMtk;
                updateMtkUI(i, !!isMtk);
            });
        }

        syncFadersToTarget();
    }

    function updateMuteUI(ch, isMuted) {
        const btn = pm._el(`mute-ch-${ch}`);
        if (!btn) return;
        if (isMuted) {
            btn.classList.remove('bg-slate-800', 'text-slate-500');
            btn.classList.add('bg-red-900/40', 'text-red-500', 'border-red-500/20');
        } else {
            btn.classList.add('bg-slate-800', 'text-slate-500');
            btn.classList.remove('bg-red-900/40', 'text-red-500', 'border-red-500/20');
        }
    }

    function updateSoloUI(ch, isSolo) {
        const btn = pm._el(`solo-ch-${ch}`);
        if (!btn) return;
        if (isSolo) {
            btn.classList.remove('bg-slate-800', 'text-slate-500');
            btn.classList.add('bg-amber-900/40', 'text-amber-500', 'border-amber-500/20');
        } else {
            btn.classList.add('bg-slate-800', 'text-slate-500');
            btn.classList.remove('bg-amber-900/40', 'text-amber-500', 'border-amber-500/20');
        }
    }

    function updateMtkUI(ch, isMtk) {
        const btn = pm._el(`mtk-ch-${ch}`);
        if (!btn) return;
        if (isMtk) {
            btn.classList.remove('bg-slate-800', 'text-slate-500');
            btn.classList.add('bg-cyan-900/40', 'text-cyan-400', 'border-cyan-500/20');
        } else {
            btn.classList.add('bg-slate-800', 'text-slate-500');
            btn.classList.remove('bg-cyan-900/40', 'text-cyan-400', 'border-cyan-500/20');
        }
    }

    function syncFadersToTarget() {
        const state = AppStore.getState();
        for (let i = 1; i <= 24; i++) {
            const gainInput = pm._el(`gain-ch-${i}`);
            if (!gainInput) continue;

            if (currentTarget === 'master') {
                const val = state[`ch_${i}_level`] !== undefined ? state[`ch_${i}_level`] : 0.75;
                gainInput.value = Math.round(val * 100);
            } else if (currentTarget.startsWith('aux')) {
                const auxIdx = parseInt(currentTarget.replace('aux', ''));
                // In real mixer aux levels might be stored under aux_${auxIdx}_ch_${i}
                const stateKey = `aux_${auxIdx}_ch_${i}_level`;
                const val = state[stateKey] !== undefined ? state[stateKey] : 0.70;
                gainInput.value = Math.round(val * 100);
            }
        }
    }

    function init() {
        const targetSelect = pm._el('mixer-target-select');
        if (targetSelect) {
            currentTarget = targetSelect.value || 'master';
            pm._on(targetSelect, 'change', (e) => {
                currentTarget = e.target.value;
                AppStore.addLog(`Console alterado para mixagem de: ${currentTarget.toUpperCase()}`);
                syncFadersToTarget();
                // Solicitar dados atualizados do mixer para o novo target
                if (currentTarget === 'master') {
                    MixerService.sendRaw('GETD|all|levels');
                } else if (currentTarget.startsWith('aux')) {
                    var auxIdx = parseInt(currentTarget.replace('aux', ''));
                    MixerService.sendRaw('GETD|aux' + auxIdx + '|levels');
                }
            });
        }

        loadNames().then(() => {
            renderConsole();
        }).catch(err => {
            console.error('[MixerInputPage] init error:', err);
        });

        // VU meter update
        pm._subscribe('AppStore', 'vuData', (data) => {
            if (!data || !data.channels) return;
            for (let i = 1; i <= 24; i++) {
                const meter = pm._el(`meter-ch-${i}`);
                if (meter) {
                    const chData = data.channels[i];
                    if (chData) {
                        const height = MixerService.vuToHeight(chData.vuPostFader || 0);
                        meter.style.height = height + '%';
                    }
                }
            }
        });
    }

    function destroy() {
        pm.destroy();
    }

    window.MixerInputPage = {
        init: init,
        destroy: destroy
    };
})();
