/**
 * =============================================================================
 * SoundMaster — Página de Relatório Operacional da Mesa (Mixer Report Page)
 * =============================================================================
 *
 * @description
 * Esta página monitora toda a mesa de som em tempo real e fornece estatísticas
 * detalhadas de uso físico de canais, barramentos de saída, status de Phantom Power (+48V),
 * além de um analisador de IA que dá recomendações operacionais de segurança e mixagem.
 *
 * @page mixer-report-page
 * @module MixerReportPage
 */
'use strict';
(function () {
    var pm = createPageModule();
    var _unsubs = [];
    var _aiTimer = null;
    var _vuTimer = null;

    // Helper para formatar dB
    function _formatDb(level) {
        if (level <= 0) return '-100 dB';
        var db = 20 * Math.log10(level);
        return db.toFixed(1) + ' dB';
    }

    // Inicializar os cartões dos 24 canais
    function _buildChannelsGrid() {
        var grid = pm._el('channels-grid-container');
        if (!grid) return;
        grid.innerHTML = '';

        for (var i = 1; i <= 24; i++) {
            var cardHtml = `
                <div class="channel-card bg-slate-950/80 border border-white/5 hover:border-cyan-500/30 rounded-xl p-3 flex flex-col justify-between h-[210px] transition-all relative overflow-hidden" id="ch-card-${i}">
                    <!-- Header -->
                    <div class="flex items-start justify-between gap-1">
                        <div class="truncate">
                            <span class="text-[8px] font-black font-mono text-slate-500 block">CH ${i.toString().padStart(2, '0')}</span>
                            <span class="text-[11px] font-bold text-white truncate block" id="ch-name-${i}">CANAL ${i}</span>
                        </div>
                        <div id="ch-signal-${i}" class="w-1.5 h-1.5 rounded-full bg-slate-800 transition-colors duration-150 flex-shrink-0 mt-1 shadow-sm"></div>
                    </div>

                    <!-- Fader Gauge & Fader Height -->
                    <div class="flex-1 my-3 flex items-end bg-black/40 rounded-lg overflow-hidden border border-white/5 h-20 relative">
                        <div id="ch-fader-fill-${i}" class="w-full bg-gradient-to-t from-cyan-600 to-cyan-400 transition-all duration-75" style="height: 75%;"></div>
                        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span id="ch-fader-db-${i}" class="text-[9px] font-mono font-bold text-white/50 tracking-tighter">0%</span>
                        </div>
                    </div>

                    <!-- Buttons Row -->
                    <div class="grid grid-cols-3 gap-0.5">
                        <button id="ch-mute-${i}" class="py-1 rounded bg-slate-900 border border-white/5 text-[8px] font-black tracking-tight text-slate-500 transition-colors uppercase hover:text-white">MUTE</button>
                        <button id="ch-solo-${i}" class="py-1 rounded bg-slate-900 border border-white/5 text-[8px] font-black tracking-tight text-slate-500 transition-colors uppercase hover:text-white">SOLO</button>
                        <button id="ch-phantom-${i}" class="py-1 rounded bg-slate-900 border border-white/5 text-[8px] font-black tracking-tight text-slate-500 transition-colors uppercase hover:text-white flex items-center justify-center gap-0.5"><span class="w-1 h-1 rounded-full bg-slate-500" id="ch-phantom-dot-${i}"></span>48V</button>
                    </div>

                    <!-- DSP Tags -->
                    <div class="flex gap-1 justify-center mt-2">
                        <span id="ch-dsp-hpf-${i}" class="px-1 text-[7px] font-bold rounded border border-white/5 bg-slate-900 text-slate-600 uppercase select-none transition-colors">HPF</span>
                        <span id="ch-dsp-gt-${i}" class="px-1 text-[7px] font-bold rounded border border-white/5 bg-slate-900 text-slate-600 uppercase select-none transition-colors">GATE</span>
                        <span id="ch-dsp-cp-${i}" class="px-1 text-[7px] font-bold rounded border border-white/5 bg-slate-900 text-slate-600 uppercase select-none transition-colors">COMP</span>
                    </div>
                </div>
            `;
            grid.insertAdjacentHTML('beforeend', cardHtml);
        }
    }

    // Inicializar os barramentos auxiliares
    function _buildAuxList() {
        var container = pm._el('aux-list-container');
        if (!container) return;
        container.innerHTML = '';

        for (var i = 1; i <= 10; i++) {
            var auxHtml = `
                <div class="p-2 bg-black/30 rounded-lg border border-white/5 flex items-center justify-between text-xs" id="aux-row-${i}">
                    <div class="truncate">
                        <span class="text-[7px] font-black text-slate-500 block">AUX ${i.toString().padStart(2, '0')}</span>
                        <span class="font-bold text-slate-300 truncate block" id="aux-name-${i}">AUXILIARES ${i}</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="font-mono text-[9px] text-slate-500" id="aux-val-${i}">0%</span>
                        <div id="aux-mute-badge-${i}" class="w-2.5 h-2.5 rounded-full bg-slate-700"></div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', auxHtml);
        }
    }

    // Inicializar motores de efeitos
    function _buildFxList() {
        var container = pm._el('fx-list-container');
        if (!container) return;
        container.innerHTML = '';

        for (var i = 1; i <= 4; i++) {
            var fxHtml = `
                <div class="p-2.5 bg-black/30 rounded-lg border border-white/5 flex items-center justify-between text-xs">
                    <div>
                        <span class="text-[7px] font-black text-slate-500 block">FX ${i}</span>
                        <span class="font-bold text-white uppercase tracking-wider text-[10px]" id="fx-type-${i}">Reverb</span>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="text-right">
                            <span class="text-[8px] text-slate-500 block">RETORNO</span>
                            <span class="font-mono text-[9px] text-cyan-400" id="fx-level-${i}">50%</span>
                        </div>
                        <div class="text-right">
                            <span class="text-[8px] text-slate-500 block">BPM</span>
                            <span class="font-mono text-[9px] text-slate-300" id="fx-bpm-${i}">120</span>
                        </div>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', fxHtml);
        }
    }

    // Sincronizar o estado da conexão e modelo
    function _syncConnectionState() {
        var store = window.AppStore;
        if (!store) return;

        var state = store.getState();
        var connected = state.mixerConnected;
        var statusMsg = state.mixerStatusMsg || '';

        // Toggles da tela de offline/online
        var overlay = pm._el('report-offline-overlay');
        var mainContent = pm._el('report-main-content');
        
        if (connected) {
            if (overlay) overlay.classList.add('hidden');
            if (mainContent) mainContent.classList.remove('hidden');
            pm._setText('report-status-text', statusMsg);
            pm._toggleClasses('report-status-dot', ['bg-green-500'], ['bg-red-500', 'bg-cyan-500']);
            
            // Sincronizar info
            var dev = state.deviceInfo || {};
            pm._setText('stat-device-model', dev.model || 'Soundcraft Ui24R');
            pm._setText('stat-device-fw', 'firmware: ' + (dev.firmware || 'N/A'));
        } else {
            if (overlay) overlay.classList.remove('hidden');
            if (mainContent) mainContent.classList.add('hidden');
            pm._setText('report-status-text', 'Offline');
            pm._toggleClasses('report-status-dot', ['bg-red-500'], ['bg-green-500', 'bg-cyan-500']);
        }
    }

    // Atualizações dinâmicas em tempo real
    function _bindStoreEvents() {
        var store = window.AppStore;
        if (!store) return;

        // 1. Ouvir conexão global
        _unsubs.push(store.subscribe('mixerConnected', _syncConnectionState));
        _unsubs.push(store.subscribe('mixerStatusMsg', function (msg) {
            pm._setText('report-status-text', msg || 'Conectado');
        }));
        _unsubs.push(store.subscribe('deviceInfo', function (info) {
            if (!info) return;
            pm._setText('stat-device-model', info.model || 'Soundcraft Ui24R');
            pm._setText('stat-device-fw', 'firmware: ' + (info.firmware || 'N/A'));
        }));

        // 2. Ouvir Master
        _unsubs.push(store.subscribe('masterLevel', function (val) {
            var pct = Math.round(val * 100);
            pm._setText('master-vol-percent', pct + '%');
            var fill = pm._el('master-vol-fill');
            if (fill) fill.style.width = pct + '%';
        }));
        _unsubs.push(store.subscribe('masterDb', function (val) {
            pm._setText('master-vol-db', val != null ? val.toFixed(1) + ' dB' : '-100.0 dB');
        }));
        _unsubs.push(store.subscribe('masterMute', function (val) {
            var badge = pm._el('master-mute-badge');
            if (!badge) return;
            if (val) {
                pm._toggleClasses(badge, ['bg-red-600', 'text-white', 'border-red-500'], ['bg-slate-800', 'text-slate-500', 'border-white/5']);
            } else {
                pm._toggleClasses(badge, ['bg-slate-800', 'text-slate-500', 'border-white/5'], ['bg-red-600', 'text-white', 'border-red-500']);
            }
        }));
        _unsubs.push(store.subscribe('master_dim', function (val) {
            var badge = pm._el('master-dim-badge');
            if (!badge) return;
            if (val) {
                pm._toggleClasses(badge, ['bg-cyan-600', 'text-white', 'border-cyan-500'], ['bg-slate-800', 'text-slate-500', 'border-white/5']);
            } else {
                pm._toggleClasses(badge, ['bg-slate-800', 'text-slate-500', 'border-white/5'], ['bg-cyan-600', 'text-white', 'border-cyan-500']);
            }
        }));
        _unsubs.push(store.subscribe('master_pan', function (val) {
            var txt = val === 0.5 ? 'Center' : (val < 0.5 ? 'L ' + Math.round((0.5 - val) * 200) + '%' : 'R ' + Math.round((val - 0.5) * 200) + '%');
            pm._setText('master-pan-display', txt);
        }));
        _unsubs.push(store.subscribe('master_delay_l', function (val) {
            pm._setText('master-delay-display', val + ' ms');
        }));

        // 3. Nomes de canais da mesa
        _unsubs.push(store.subscribe('mixerNames', function (names) {
            if (!names) return;
            if (names.channels) {
                for (var i = 1; i <= 24; i++) {
                    var chName = names.channels[i] || `CANAL ${i}`;
                    var nameEl = pm._el(`ch-name-${i}`);
                    if (nameEl) nameEl.textContent = chName;
                }
            }
            if (names.aux) {
                for (var j = 1; j <= 10; j++) {
                    var auxName = names.aux[j] || `RETORNO ${j}`;
                    var auxNameEl = pm._el(`aux-name-${j}`);
                    if (auxNameEl) auxNameEl.textContent = auxName;
                }
            }
        }));

        // 4. Ouvir chaves dos 24 canais
        for (let ch = 1; ch <= 24; ch++) {
            // Level
            _unsubs.push(store.subscribe(`ch_${ch}_level`, function (val) {
                var pct = Math.round(val * 100);
                var fill = pm._el(`ch-fader-fill-${ch}`);
                if (fill) fill.style.height = pct + '%';
                var dbText = pm._el(`ch-fader-db-${ch}`);
                if (dbText) dbText.textContent = pct + '%';
            }));

            // Mute
            _unsubs.push(store.subscribe(`mute_ch_${ch}`, function (val) {
                var btn = pm._el(`ch-mute-${ch}`);
                var card = pm._el(`ch-card-${ch}`);
                if (btn) {
                    if (val) {
                        pm._toggleClasses(btn, ['bg-red-600', 'text-white', 'border-red-500'], ['bg-slate-900', 'text-slate-500', 'border-white/5']);
                    } else {
                        pm._toggleClasses(btn, ['bg-slate-900', 'text-slate-500', 'border-white/5'], ['bg-red-600', 'text-white', 'border-red-500']);
                    }
                }
                if (card) {
                    if (val) card.classList.add('opacity-60');
                    else card.classList.remove('opacity-60');
                }
            }));

            // Solo
            _unsubs.push(store.subscribe(`ch_${ch}_solo`, function (val) {
                var btn = pm._el(`ch-solo-${ch}`);
                if (btn) {
                    if (val) {
                        pm._toggleClasses(btn, ['bg-amber-600', 'text-white', 'border-amber-500'], ['bg-slate-900', 'text-slate-500', 'border-white/5']);
                    } else {
                        pm._toggleClasses(btn, ['bg-slate-900', 'text-slate-500', 'border-white/5'], ['bg-amber-600', 'text-white', 'border-amber-500']);
                    }
                }
            }));

            // Phantom Power (+48V)
            _unsubs.push(store.subscribe(`hw_${ch}_phantom`, function (val) {
                var btn = pm._el(`ch-phantom-${ch}`);
                var dot = pm._el(`ch-phantom-dot-${ch}`);
                if (btn) {
                    if (val) {
                        pm._toggleClasses(btn, ['bg-red-950/80', 'text-red-400', 'border-red-500/40'], ['bg-slate-900', 'text-slate-500', 'border-white/5']);
                    } else {
                        pm._toggleClasses(btn, ['bg-slate-900', 'text-slate-500', 'border-white/5'], ['bg-red-950/80', 'text-red-400', 'border-red-500/40']);
                    }
                }
                if (dot) {
                    if (val) {
                        pm._toggleClasses(dot, ['bg-red-500', 'animate-pulse'], ['bg-slate-500']);
                    } else {
                        pm._toggleClasses(dot, ['bg-slate-500'], ['bg-red-500', 'animate-pulse']);
                    }
                }
            }));

            // HPF / Delay para tag de HPF
            _unsubs.push(store.subscribe(`ch_${ch}_delay`, function (val) {
                var tag = pm._el(`ch-dsp-hpf-${ch}`);
                if (!tag) return;
                if (val > 0) {
                    pm._toggleClasses(tag, ['bg-emerald-950/60', 'text-emerald-400', 'border-emerald-500/30'], ['bg-slate-900', 'text-slate-600']);
                } else {
                    pm._toggleClasses(tag, ['bg-slate-900', 'text-slate-600'], ['bg-emerald-950/60', 'text-emerald-400', 'border-emerald-500/30']);
                }
            }));
        }

        // 5. Ouvir auxiliares
        for (let aux = 1; aux <= 10; aux++) {
            _unsubs.push(store.subscribe(`aux_${aux}_level`, function (val) {
                var pct = Math.round(val * 100);
                pm._setText(`aux-val-${aux}`, pct + '%');
            }));
            _unsubs.push(store.subscribe(`mute_aux_${aux}`, function (val) {
                var dot = pm._el(`aux-mute-badge-${aux}`);
                var row = pm._el(`aux-row-${aux}`);
                if (!dot) return;
                if (val) {
                    pm._toggleClasses(dot, ['bg-red-500'], ['bg-slate-700']);
                    if (row) row.classList.add('opacity-50');
                } else {
                    pm._toggleClasses(dot, ['bg-slate-700'], ['bg-red-500']);
                    if (row) row.classList.remove('opacity-50');
                }
            }));
        }

        // 6. Ouvir FX
        for (let fx = 1; fx <= 4; fx++) {
            _unsubs.push(store.subscribe(`fx_${fx}_type`, function (type) {
                pm._setText(`fx-type-${fx}`, type || 'Reverb');
            }));
            _unsubs.push(store.subscribe(`fx_${fx}_level`, function (val) {
                pm._setText(`fx-level-${fx}`, Math.round(val * 100) + '%');
            }));
            _unsubs.push(store.subscribe(`fx_${fx}_bpm`, function (val) {
                pm._setText(`fx-bpm-${fx}`, Math.round(val));
            }));
        }
    }

    // Monitorar e animar os leds de sinal (VU)
    function _startVUMonitor() {
        _vuTimer = setInterval(function () {
            var store = window.AppStore;
            if (!store || !store.getState().mixerConnected) return;

            var vu = store.getState().vuData || {};
            for (var i = 1; i <= 24; i++) {
                // A biblioteca envia ch_0 para o canal 1
                var level = vu['ch_' + (i - 1)] || 0;
                var led = pm._el(`ch-signal-${i}`);
                if (!led) continue;

                if (level > 0.8) {
                    pm._toggleClasses(led, ['bg-red-500', 'shadow-red-500/50'], ['bg-slate-800', 'bg-green-500', 'bg-yellow-500', 'shadow-green-500/30']);
                } else if (level > 0.2) {
                    pm._toggleClasses(led, ['bg-green-500', 'shadow-green-500/30'], ['bg-slate-800', 'bg-red-500', 'bg-yellow-500', 'shadow-red-500/50']);
                } else if (level > 0.02) {
                    pm._toggleClasses(led, ['bg-yellow-500'], ['bg-slate-800', 'bg-red-500', 'bg-green-500', 'shadow-red-500/50', 'shadow-green-500/30']);
                } else {
                    pm._toggleClasses(led, ['bg-slate-800'], ['bg-green-500', 'bg-red-500', 'bg-yellow-500', 'shadow-red-500/50', 'shadow-green-500/30']);
                }
            }
        }, 100);
    }

    // Analisar dados da mesa e sugerir melhorias de IA
    function _generateAISuggestions() {
        var store = window.AppStore;
        if (!store) return;

        var state = store.getState();
        if (!state.mixerConnected) return;

        var names = state.mixerNames || { channels: {}, aux: {} };
        var suggestions = [];
        var activeCount = 0;
        var phantomCount = 0;
        var muteCount = 0;
        var soloCount = 0;
        var vu = state.vuData || {};

        // Varredura dos 24 canais
        for (var i = 1; i <= 24; i++) {
            var level = state[`ch_${i}_level`] || 0;
            var isMuted = !!state[`mute_ch_${i}`];
            var isSolo = !!state[`ch_${i}_solo`];
            var hasPhantom = !!state[`hw_${i}_phantom`];
            var chName = names.channels ? names.channels[i] : null;
            var isNamed = chName && chName.trim() !== '' && chName.indexOf('CANAL') !== 0;
            var signal = vu['ch_' + (i - 1)] || 0;

            if (isMuted) muteCount++;
            if (isSolo) soloCount++;
            if (hasPhantom) phantomCount++;

            // Canal é considerado ativo se tem nome customizado ou tem fader aberto e sinal
            var hasActivity = isNamed || (level > 0.1 && signal > 0.01);
            if (hasActivity) activeCount++;

            // Regra 1: Alerta de Segurança de +48V
            if (hasPhantom && !isNamed) {
                suggestions.push({
                    type: 'danger',
                    icon: `<svg class="w-5 h-5 text-red-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
                    category: 'Segurança Phantom +48V',
                    msg: `Alimentação fantasma ativa no **Canal ${i}**, mas o canal está sem identificação. Desative o +48V se não houver um Direct Box ativo ou microfone condensador acoplado para prevenir queima acidental de microfones dinâmicos.`
                });
            }

            // Regra 2: Ganho versus Fader (Gain staging)
            if (level > 0.90 && !isMuted) {
                suggestions.push({
                    type: 'warning',
                    icon: `<svg class="w-5 h-5 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
                    category: 'Estrutura de Ganho',
                    msg: `O fader do canal **${chName || 'CH ' + i}** está muito alto (${Math.round(level * 100)}%). Sugerimos elevar o ganho de hardware (Gain) da entrada física e baixar o fader para próximo de 0dB (75%) para ter melhor headroom de controle.`
                });
            } else if (level < 0.15 && level > 0 && !isMuted && signal > 0.05) {
                suggestions.push({
                    type: 'info',
                    icon: `<svg class="w-5 h-5 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A5 5 0 0 0 8 8c0 1 .3 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
                    category: 'Ganho Excessivo',
                    msg: `O fader do canal **${chName || 'CH ' + i}** está excessivamente baixo (${Math.round(level * 100)}%) enquanto recebe sinal forte. Reduza o Ganho de Entrada (Gain) para limpar ruídos de fundo e trabalhar com o fader em área de alta resolução.`
                });
            }

            // Regra 3: Canal mutado com sinal ativo (Esquecimento)
            if (isMuted && signal > 0.2) {
                suggestions.push({
                    type: 'info',
                    icon: `<svg class="w-5 h-5 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
                    category: 'Canal Silenciado',
                    msg: `O canal **${chName || 'CH ' + i}** está mutado, mas continua recebendo sinal de áudio alto no palco. Se o cantor/instrumentista saiu do palco, desligue o equipamento ou verifique vazamentos.`
                });
            }
        }

        // Regra 4: Detecção de microfonia pelo detector do app
        if (state.feedbackHz) {
            suggestions.push({
                type: 'danger',
                icon: `<svg class="w-5 h-5 text-red-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
                category: 'Detector de Feedback',
                msg: `Frequência de microfonia iminente detectada em **${state.feedbackHz} Hz**! Reduza ligeiramente o ganho geral ou atenue essa faixa no equalizador do canal com maior ganho.`
            });
        }

        // Regra 5: Master Mute ou Dim ativado
        if (state.masterMute) {
            suggestions.push({
                type: 'warning',
                icon: `<svg class="w-5 h-5 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
                category: 'Saída Silenciada',
                msg: `O barramento **MASTER principal está mutado**. Nenhum som será enviado para as saídas P.A. principais até que o Mute Geral seja desativado.`
            });
        }

        // Preencher estatísticas rápidas
        pm._setText('stat-channels-active', activeCount + ' / 24');
        pm._setText('stat-phantom-count', phantomCount + ' ativos');
        pm._setText('stat-mutes-count', muteCount + ' Mutados / ' + soloCount + ' Solo');

        if (phantomCount > 0) {
            pm._setText('stat-phantom-status', 'Atenção aos microfones dinâmicos');
        } else {
            pm._setText('stat-phantom-status', 'Nenhum risco elétrico');
        }

        // Renderizar na tela as sugestões da IA
        var listContainer = pm._el('ai-suggestions-list');
        if (!listContainer) return;

        if (suggestions.length === 0) {
            listContainer.innerHTML = `
                <div class="p-4 bg-slate-950/20 border border-emerald-500/10 rounded-xl flex items-start gap-3 col-span-2">
                    <svg class="w-5 h-5 text-emerald-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <div>
                        <span class="text-[9px] font-black uppercase tracking-wider text-emerald-400 block mb-1">Tudo Sob Controle</span>
                        <p class="text-xs text-slate-300">A IA analisou os barramentos da mesa de som e não encontrou nenhum gargalo ou risco operacional de segurança. Excelente mixagem!</p>
                    </div>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = '';
        suggestions.forEach(function (s) {
            var borderClass = s.type === 'danger'
                ? 'border-red-500/30 bg-red-950/10'
                : s.type === 'warning'
                ? 'border-amber-500/20 bg-amber-950/10'
                : 'border-cyan-500/10 bg-slate-950/40';

            var labelClass = s.type === 'danger'
                ? 'text-red-400'
                : s.type === 'warning'
                ? 'text-amber-400'
                : 'text-cyan-400';

            var itemHtml = `
                <div class="p-4 border rounded-xl flex items-start gap-3 ${borderClass}">
                    ${s.icon}
                    <div>
                        <span class="text-[9px] font-black uppercase tracking-wider block mb-1 ${labelClass}">${s.category}</span>
                        <p class="text-xs text-slate-300 leading-relaxed">${s.msg}</p>
                    </div>
                </div>
            `;
            listContainer.insertAdjacentHTML('beforeend', itemHtml);
        });
    }

    // Configurar a conexão manual rápida da mesa
    function _setupQuickConnect() {
        var connectBtn = pm._el('btn-report-quick-connect');
        var ipInput = pm._el('report-quick-ip');
        if (connectBtn && ipInput) {
            pm._on(connectBtn, 'click', function () {
                var ip = ipInput.value.trim();
                if (!ip) { alert('Informe o IP da mixer.'); return; }
                connectBtn.disabled = true;
                connectBtn.textContent = 'Conectando...';
                if (window.MixerService && typeof MixerService.connect === 'function') {
                    window.MixerService.connect(ip, 'soundcraft');
                }
                pm._setTimeout(function () {
                    connectBtn.disabled = false;
                    connectBtn.textContent = 'Conectar';
                }, 3000);
            });
        }
    }

    function init() {
        _buildChannelsGrid();
        _buildAuxList();
        _buildFxList();
        
        _syncConnectionState();
        _bindStoreEvents();
        _setupQuickConnect();
        
        _startVUMonitor();
        
        // Loop de geração de sugestões da IA (a cada 1.5 segundos)
        _generateAISuggestions();
        _aiTimer = setInterval(_generateAISuggestions, 1500);
    }

    function destroy() {
        pm.destroy();
        _unsubs.forEach(function (unsub) { if (typeof unsub === 'function') unsub(); });
        _unsubs = [];
        if (_aiTimer) { clearInterval(_aiTimer); _aiTimer = null; }
        if (_vuTimer) { clearInterval(_vuTimer); _vuTimer = null; }
    }

    window.MixerReportPage = { init: init, destroy: destroy };
})();
