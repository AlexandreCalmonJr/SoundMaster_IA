/**
 * @fileoverview Página de Medição RT60 — Medição e visualização do tempo de
 * decaimento sonoro (RT60) com curva de Schroeder e métricas acústicas.
 *
 * Esta página permite medir o RT60 (tempo de reverberação) de um ambiente
 * utilizando pulso/sweep de sinal, exibir a curva de Schroeder decrescente
 * e calcular métricas acústicas como T20, T30, EDT, C50, C80, D50 e STI.
 * Também integra gravação multitrack (MTK) para virtual soundcheck.
 *
 * ## Funcionalidades Principais
 * - Disparo de pulso/sweep de sinal para medição (12 segundos)
 * - Visualização gráfica da curva de Schroeder com marks T20/T30
 * - Cards de métricas: RT60, EDT, T20, T30, C50, C80, D50, STI
 * - Cálculo manual de RT60 a partir de dados salvos
 * - Histórico de medições acústicas (vazio vs. lotado)
 * - Gravação multitrack (MTK) para virtual soundcheck
 * - Botão de limpar medições e redefinir visualização
 * - Integração com eventos rt60-result em tempo real
 *
 * ## Como Usar
 * 1. Conecte o analisador (SoundMasterAnalyzer) com microfone calibrado
 * 2. Clique em "Disparar Pulso de Medição" e aguarde 12 segundos
 * 3. A curva de Schroeder e as métricas serão exibidas automaticamente
 * 4. Use "Calcular RT60" para recalcular a partir dos últimos dados
 5. Use "Limpar" para resetar a visualização
 * 6. Opcionalmente, use MTK para gravar multitrack
 *
 * ## Dependências e Integrações
 * - **createPageModule()**: Módulo base para páginas
 * - **SoundMasterAnalyzer**: Analisador de áudio
 *   - `triggerImpulse()` — Dispara sweep de medição
 *   - `getLastRt60()` — Obtém último resultado RT60
 * - **SchroederRenderer**: Renderização da curva de Schroeder
 *   - `draw(canvas, curve, params)` — Desenha curva no canvas
 *   - `updateMetricCards(params)` — Atualiza cards de métricas
 * - **SocketService**: Comunicação WebSocket
 *   - `on('acoustic_history_data', handler)` — Recebe histórico
 *   - `emit('get_acoustic_history')` — Solicita histórico
 * - **MixerService**: Controle de gravação MTK
 *   - `mtkControl(action)` — Inicia/para gravação multitrack
 * - **AppStore**: Estado global (isRecordingMTK, logs)
 *
 * @module RT60Page
 * @version 1.0.0
 */

'use strict';
(function () {
    var pm = createPageModule();
    var rt60Listener = null;
    var _currentPlan  = null;  // Plano de correções atual

    function handleAcousticHistory(data) {
        var emptyVal = (data && data.benchmark && data.benchmark.empty && data.benchmark.empty.rt60) || 0;
        var fullVal = (data && data.benchmark && data.benchmark.full && data.benchmark.full.rt60) || 0;
        
        var emptyEl = pm._el('rt60-empty-rt60');
        var fullEl = pm._el('rt60-full-rt60');
        
        if (emptyEl) {
            emptyEl.innerText = emptyVal > 0 ? emptyVal.toFixed(2) + 's' : 'Sem dados';
        }
        if (fullEl) {
            fullEl.innerText = fullVal > 0 ? fullVal.toFixed(2) + 's' : 'Sem dados';
        }
    }

    function updateMtkUI(isRec) {
        var btnRec = pm._el('btn-rt-rec-mtk');
        var btnStop = pm._el('btn-rt-stop-mtk');
        var recDot = pm._el('rt-rec-dot');
        var recText = pm._el('rt-rec-text');
        
        if (isRec) {
            if (recDot) {
                recDot.classList.remove('bg-slate-500');
                recDot.classList.add('bg-red-500');
            }
            if (recText) {
                recText.innerText = 'REC';
                recText.classList.remove('text-slate-500');
                recText.classList.add('text-red-500');
            }
            if (btnRec) btnRec.disabled = true;
            if (btnStop) {
                btnStop.disabled = false;
                btnStop.classList.remove('cursor-not-allowed', 'text-slate-500');
                btnStop.classList.add('text-white');
            }
        } else {
            if (recDot) {
                recDot.classList.remove('bg-red-500');
                recDot.classList.add('bg-slate-500');
            }
            if (recText) {
                recText.innerText = 'OFFLINE';
                recText.classList.remove('text-red-500');
                recText.classList.add('text-slate-500');
            }
            if (btnRec) btnRec.disabled = false;
            if (btnStop) {
                btnStop.disabled = true;
                btnStop.classList.add('cursor-not-allowed', 'text-slate-500');
                btnStop.classList.remove('text-white');
            }
        }
    }

    function handleRt60Result(e) {
        console.log('[Rt60Page] handleRt60Result recebido:', e.detail);
        var detail = e.detail || {};
        if (detail.error) {
            var panel = pm._el('schroeder-chart-panel');
            if (panel) panel.classList.remove('hidden');
            _appendResultMessage('Erro na medição: ' + detail.error, 'text-red-400');
            return;
        }
        
        var hasCurve = detail.curve && detail.curve.length > 0;
        var hasMetrics = detail.rt60 || detail.t20 || detail.t30 || detail.edt;

        if (hasCurve && window.SchroederRenderer) {
            var canvas = pm._el('schroeder-canvas');
            var panel = pm._el('schroeder-chart-panel');
            if (panel) panel.classList.remove('hidden');
            if (canvas) {
                window.SchroederRenderer.draw(canvas, detail.curve, {
                    rt60: detail.rt60, t20: detail.t20, t30: detail.t30, edt: detail.edt
                });
            }
            window.SchroederRenderer.updateMetricCards({
                rt60: detail.rt60, t20: detail.t20, t30: detail.t30, edt: detail.edt,
                c50: detail.c50, c80: detail.c80, d50: detail.d50,
                sti: detail.sti, sti_category: detail.sti_category
            });
        } else if (hasMetrics) {
            // Sem curva mas tem métricas — mostra cards
            var panel = pm._el('schroeder-chart-panel');
            if (panel) panel.classList.remove('hidden');
            if (window.SchroederRenderer) {
                window.SchroederRenderer.updateMetricCards({
                    rt60: detail.rt60, t20: detail.t20, t30: detail.t30, edt: detail.edt,
                    c50: detail.c50, c80: detail.c80, d50: detail.d50,
                    sti: detail.sti, sti_category: detail.sti_category
                });
            }
            _appendResultMessage('Medição concluída. Dados: RT60=' + (detail.rt60 || '?') + 's, STI=' + (detail.sti || '?'), 'text-cyan-400');
        } else {
            _appendResultMessage('Medição concluída mas sem dados suficientes para exibir.', 'text-amber-400');
        }

        // ── NOVO: solicita correções ao servidor ─────────────────────────────
        if (hasMetrics || hasCurve) {
            _requestCorrections(detail);
        }
    }

    function _appendResultMessage(text, colorClass) {
        var el = pm._el('schroeder-chart-panel');
        if (!el) return;
        var msg = document.createElement('p');
        msg.className = 'text-xs ' + (colorClass || 'text-slate-400') + ' mt-2 text-center';
        msg.innerText = text;
        el.appendChild(msg);
    }

    // ─── Correções Acústicas ─────────────────────────────────────────────────

    function _requestCorrections(metrics) {
        var socket = pm._call('SocketService', 'raw');
        if (!socket) return;
        var mixerChannel = window.MixerAudioSource ? window.MixerAudioSource.getSelectedChannel() : null;
        socket.emit('rt60_get_corrections', {
            metrics: metrics,
            roomProfile: { measurementChannel: mixerChannel }
        });
    }

    function _renderCorrectionsPlan(plan) {
        _currentPlan = plan;
        var container = pm._el('rt60-corrections-panel');
        if (!container) return;

        var qualityColors = { good: '#22c55e', fair: '#f59e0b', poor: '#ef4444', unknown: '#94a3b8' };
        var qualityLabels = { good: 'Boa', fair: 'Moderada', poor: 'Ruim', unknown: '?' };
        var color = qualityColors[plan.roomQuality] || '#94a3b8';
        var label = qualityLabels[plan.roomQuality] || '?';

        var actionsHtml = (plan.actions || []).map(function(action) {
            var changesHtml = (action.changes || []).map(function(c) {
                if (c.type === 'peaking' || c.type === 'shelf') {
                    return '<span class="rt60-change-tag">' + c.label + ': ' +
                           (c.gain > 0 ? '+' : '') + c.gain + 'dB @ ' + c.hz + 'Hz</span>';
                }
                if (c.type === 'hpf') {
                    return '<span class="rt60-change-tag">HPF ' + c.hz + 'Hz</span>';
                }
                if (c.type === 'compressor') {
                    return '<span class="rt60-change-tag">Comp ' + c.ratio + ':1 @ ' + c.threshold + 'dB</span>';
                }
                return '<span class="rt60-change-tag">' + c.label + '</span>';
            }).join('');

            var priorityBadge = action.priority === 1
                ? '<span class="rt60-badge rt60-badge-critical">Crítico</span>'
                : action.priority === 2
                ? '<span class="rt60-badge rt60-badge-medium">Sugerido</span>'
                : '<span class="rt60-badge rt60-badge-low">Opcional</span>';

            return '<div class="rt60-action-card" data-action-id="' + action.id + '">' +
                   '  <div class="rt60-action-header">' +
                   '    ' + priorityBadge +
                   '    <span class="rt60-action-desc">' + _esc(action.description) + '</span>' +
                   '  </div>' +
                   '  <div class="rt60-action-changes">' + changesHtml + '</div>' +
                   '  <p class="rt60-action-explanation">' + _esc(action.explanation) + '</p>' +
                   '</div>';
        }).join('');

        var mixerConnected = (window.AppStore && window.AppStore.getState().mixerConnected);

        container.innerHTML =
            '<div class="rt60-corrections-header">' +
            '  <div class="rt60-quality-indicator">' +
            '    <span class="rt60-quality-dot" style="background:' + color + '"></span>' +
            '    <span class="rt60-quality-label">Qualidade Acústica: <strong>' + label + '</strong></span>' +
            '    <span class="rt60-confidence">' + plan.confidence + '% de confiança</span>' +
            '  </div>' +
            '  <p class="rt60-summary">' + _esc(plan.summary) + '</p>' +
            '</div>' +
            (actionsHtml ? '<div class="rt60-actions-list">' + actionsHtml + '</div>' : '') +
            '<div class="rt60-apply-row">' +
            '  <button id="btn-apply-all-corrections" class="rt60-apply-btn" ' +
               (mixerConnected ? '' : 'disabled title="Conecte a mesa primeiro"') + '>' +
            '    <span>✅</span> Aplicar todas na mesa' +
            '  </button>' +
            '  <span class="rt60-apply-hint">' +
            (mixerConnected ? 'Mesa conectada — pronto para aplicar' : '⚠️ Mesa não conectada') +
            '  </span>' +
            '</div>';

        container.classList.remove('hidden');
        document.getElementById('btn-apply-all-corrections')?.addEventListener('click', _applyAllCorrections);
    }

    function _applyAllCorrections() {
        if (!_currentPlan) return;
        var btn = document.getElementById('btn-apply-all-corrections');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span>⏳</span> Aplicando...'; }

        var socket = pm._call('SocketService', 'raw');
        var channel = window.MixerAudioSource ? window.MixerAudioSource.getSelectedChannel() : null;
        if (socket) {
            socket.emit('rt60_apply_all', {
                plan: _currentPlan,
                channels: channel ? [channel] : []
            });
        }
    }

    function init() {
        if (window.MixerAudioSource) {
            window.MixerAudioSource.init();
        }

        document.addEventListener('audio_source_changed', function(e) {
            pm._call('AppStore', 'addLog', '🎤 Fonte de áudio alterada para medição.');
        });

        pm._on(pm._el('btn-trigger-pulse'), 'click', function () {
            var btn = pm._el('btn-trigger-pulse');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span>⏳</span> Medindo... (12s)';
            }
            _appendResultMessage('Iniciando sweep de sinal (12 segundos)...', 'text-cyan-400');
            pm._safeCall('SoundMasterAnalyzer', 'triggerImpulse');
            // Re-enable button after expected duration
            setTimeout(function () {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span>🔊</span> Disparar Pulso de Medição';
                }
            }, 15000);
        });

        pm._on(pm._el('btn-calculate-rt60'), 'click', function () {
            var rawRt60 = pm._call('SoundMasterAnalyzer', 'getLastRt60');
            console.log('[Rt60Page] Calcular RT60 clicado, rawRt60:', rawRt60);
            if (rawRt60 && window.SchroederRenderer) {
                var canvas = pm._el('schroeder-canvas');
                var panel = pm._el('schroeder-chart-panel');
                if (panel) panel.classList.remove('hidden');
                
                var curve = rawRt60.curve || rawRt60.schroeder_curve || [];
                var rt60Val = rawRt60.rt60 || rawRt60.t30 || rawRt60.t20 || rawRt60.rt60_est || 0;
                
                var params = {
                    rt60: rt60Val,
                    t20: rawRt60.t20,
                    t30: rawRt60.t30,
                    edt: rawRt60.edt,
                    c50: rawRt60.c50,
                    c80: rawRt60.c80,
                    d50: rawRt60.d50,
                    sti: rawRt60.sti,
                    sti_category: rawRt60.sti_category
                };

                if (canvas && curve.length > 0) {
                    window.SchroederRenderer.draw(canvas, curve, params);
                }
                window.SchroederRenderer.updateMetricCards(params);
            }
        });

        pm._on(pm._el('btn-clear-measurements'), 'click', function () { 
            pm._toggleClasses('schroeder-chart-panel', ['hidden'], []);
            var metricEls = ['schroeder-rt60', 'schroeder-edt', 'schroeder-t20', 'schroeder-t30', 'schroeder-c50', 'schroeder-c80', 'schroeder-d50', 'schroeder-sti'];
            metricEls.forEach(function (id) {
                var el = pm._el(id);
                if (el) el.innerText = '--';
            });
            var canvas = pm._el('schroeder-canvas');
            if (canvas) {
                var ctx = canvas.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        });

        // Socket integration for historical benchmarking
        var socket = pm._call('SocketService', 'raw');
        if (socket) {
            socket.on('acoustic_history_data', handleAcousticHistory);
            pm._call('SocketService', 'emit', 'get_acoustic_history');

            // Correções RT60 do servidor
            socket.on('rt60_corrections_ready', function(data) {
                if (data && data.plan) _renderCorrectionsPlan(data.plan);
            });

            socket.on('rt60_all_applied', function(data) {
                var btn = document.getElementById('btn-apply-all-corrections');
                if (btn) {
                    btn.innerHTML = '<span>✅</span> Aplicado!';
                    setTimeout(function() {
                        btn.disabled = false;
                        btn.innerHTML = '<span>✅</span> Aplicar todas na mesa';
                    }, 3000);
                }
                pm._call('AppStore', 'addLog', '🎚️ Correções acústicas aplicadas na Ui24R.');
            });

            socket.on('rt60_error', function(data) {
                pm._call('AppStore', 'addLog', '⚠️ RT60: ' + (data && data.message || 'Erro desconhecido'));
            });
        }

        // AppStore integration for Virtual Soundcheck (MTK) status
        var store = window.AppStore;
        if (store) {
            var state = store.getState ? store.getState() : {};
            updateMtkUI(state.isRecordingMTK);
            
            if (store.subscribe) {
                pm._subscribe('AppStore', 'isRecordingMTK', function (isRec) {
                    updateMtkUI(isRec);
                });
            }
        }

        var _mtkBusy = false;
        pm._on(pm._el('btn-rt-rec-mtk'), 'click', function () {
            if (_mtkBusy) return;
            _mtkBusy = true;
            this.disabled = true;
            pm._call('MixerService', 'mtkControl', 'start');
            pm._call('AppStore', 'setState', { isRecordingMTK: true });
            pm._call('AppStore', 'addLog', 'MTK: Gravação de Multitrack iniciada.');
            var self = this;
            setTimeout(function () { _mtkBusy = false; }, 1000);
        });
        
        pm._on(pm._el('btn-rt-stop-mtk'), 'click', function () {
            pm._call('MixerService', 'mtkControl', 'stop');
            pm._call('AppStore', 'setState', { isRecordingMTK: false });
            pm._call('AppStore', 'addLog', 'MTK: Gravação de Multitrack finalizada.');
        });

        // Listen for new RT60 results dispatched into this page document
        rt60Listener = handleRt60Result;
        console.log('[Rt60Page] Vinculando ouvintes do evento rt60-result. SchroederRenderer disponível:', typeof window.SchroederRenderer !== 'undefined');
        document.removeEventListener('rt60-result', rt60Listener);
        document.addEventListener('rt60-result', rt60Listener);
    }

    function destroy() {
        var socket = pm._call('SocketService', 'raw');
        if (socket) {
            socket.off('acoustic_history_data', handleAcousticHistory);
            socket.off('rt60_corrections_ready');
            socket.off('rt60_all_applied');
            socket.off('rt60_error');
        }
        document.removeEventListener('rt60-result', rt60Listener);
        pm.destroy();
    }

    function _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    window.RT60Page = { init: init, destroy: destroy };
})();
