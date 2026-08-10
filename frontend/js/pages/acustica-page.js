/**
 * @fileoverview Página de Acústica — Análise acústica completa de ambientes
 * com curva de Schroeder, tabela de bandas, calculadora de RT60 e mapeamento.
 *
 * Esta página é o hub central de análise acústica, exibindo a curva de
 * Schroeder interativa (ETC), tabela detalhada de métricas por banda de
 * oitava/terço de oitava, calculadora de RT60 teórico (Eyring/Sabine),
 * e integração com mapeamento de cobertura sonora.
 *
 * ## Funcionalidades Principais
 * - Canvas interativo da curva de Schroeder com crosshair e readout
 * - Marcadores visuais de T20 e T30 na curva
 * - Tabela completa de métricas por banda (31.5Hz a 16kHz):
 *   SPL, RT60, T20, T30, EDT, C50, C80, STI
 * - Calculadora de RT60 teórico (Eyring) com dimensões da sala
 * - Validação inline dos inputs de dimensões
 * - Cálculo de delay auxiliar baseado na distância
 * - Exportação da tabela de bandas em formato TXT
 * - Integração com mapeamento de cobertura (SoundMasterMapping)
 * - Atualização automática ao receber eventos rt60-result
 * - Suporte a dados multibanda reais ou estimados
 * - Badge indicando dados medidos vs. simulados
 *
 * ## Como Usar
 * 1. A curva de Schroeder é exibida automaticamente ao medir RT60
 * 2. Mova o mouse sobre o canvas para ver valores de tempo/dB
 * 3. Selecione banda e faixa de tempo nos seletores
 * 4. Use a calculadora para estimar RT60 teórico da sala
 * 5. Exporte a tabela de bandas com o botão de exportar
 * 6. Integra com o mapeamento de cobertura para visualização espacial
 *
 * ## Dependências e Integrações
 * - **createPageModule()**: Módulo base para páginas
 * - **SoundMasterAnalyzer**: Analisador de áudio
 *   - `getLastRt60()` — Obtém último resultado RT60
 * - **AIService**: Cálculo acústico via IA
 *   - `calculateAcoustics(volume, surfaceArea, absorption)` — RT60 via IA
 * - **SoundMasterMapping**: Mapeamento de cobertura sonora
 *   - `updateDimensions(width, length)` — Atualiza dimensões do mapa
 * - **Eventos DOM**: `rt60-result` — Resultado de medição RT60
 *
 * @module AcusticaPage
 * @version 1.0.0
 */

'use strict';
(function () {
    var pm = createPageModule();

    var etcCanvas, etcCtx;
    var etcData = null;
    var etcCrosshairX = -1;
    var etcCrosshairY = -1;
    var _resizeObserver = null;

    var ISO_BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    var THIRD_OCTAVE_BANDS = [
        25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
        1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
    ];

    var ETC_MIN_DB = -80;
    var ETC_MAX_DB = -5;
    var ETC_GRID_COLOR = 'rgba(148, 163, 184, 0.06)';
    var ETC_LABEL_COLOR = 'rgba(148, 163, 184, 0.5)';
    var ETC_BG = '#0a0e1a';

    function init() {
        etcCanvas = pm._el('etc-canvas');
        if (etcCanvas) etcCtx = etcCanvas.getContext('2d');

        _resizeEtcCanvas();
        _initEtcInteractivity();

        (window.parent.document || document).removeEventListener('rt60-result', _onRt60Result);
        (window.parent.document || document).addEventListener('rt60-result', _onRt60Result);

        pm._on(pm._el('etc-band-select'), 'change', _redrawEtc);
        pm._on(pm._el('etc-time-range'), 'change', _redrawEtc);
        pm._on(pm._el('btn-export-bands'), 'click', _exportBandsTable);

        window.removeEventListener('resize', _resizeEtcCanvas);
        window.addEventListener('resize', _resizeEtcCanvas);

        if (typeof ResizeObserver !== 'undefined' && etcCanvas) {
            _resizeObserver = new ResizeObserver(function () { _resizeEtcCanvas(); });
            _resizeObserver.observe(etcCanvas);
        }

        // Validação inline dos inputs de dimensões
        function _validateInput(id) {
            var el = pm._el(id);
            if (!el) return;
            var val = parseFloat(el.value);
            var valid = !isNaN(val) && val > 0 && val <= 999;
            el.classList.toggle('border-red-500/50', !valid);
            el.classList.toggle('border-cyan-500/50', valid);
        }
        ['rt-length', 'rt-width', 'rt-height', 'rt-delay-dist'].forEach(function (id) {
            var el = pm._el(id);
            if (el) el.addEventListener('input', function () { _validateInput(id); });
        });
        // Validação inicial
        setTimeout(function () {
            ['rt-length', 'rt-width', 'rt-height', 'rt-delay-dist'].forEach(_validateInput);
        }, 100);

        // Eyring & Sabine Acoustic Calculator
        var _calcBusy = false;
        pm._on(pm._el('btn-calc-rt60'), 'click', async function () {
            var _btn = this;
            if (_calcBusy) return;
            _calcBusy = true;
            _btn.disabled = true;
            _btn.classList.add('opacity-50', 'pointer-events-none');
            try {
                var length = parseFloat(pm._el('rt-length') ? pm._el('rt-length').value : 20) || 20;
                var width = parseFloat(pm._el('rt-width') ? pm._el('rt-width').value : 10) || 10;
                var height = parseFloat(pm._el('rt-height') ? pm._el('rt-height').value : 5) || 5;
                var absorption = parseFloat(pm._el('rt-absorption') ? pm._el('rt-absorption').value : 0.15) || 0.15;
                var dist = parseFloat(pm._el('rt-delay-dist') ? pm._el('rt-delay-dist').value : 0) || 0;

                var volume = length * width * height;
                var surfaceArea = 2 * (length * width + length * height + width * height);

                var rt60 = 0;
                var formula = 'Eyring (Local Fallback)';
                var classification = '';

                if (window.AIService && typeof window.AIService.calculateAcoustics === 'function') {
                    try {
                        var aiResult = await window.AIService.calculateAcoustics(volume, surfaceArea, absorption);
                        if (aiResult) {
                            rt60 = aiResult.rt60;
                            formula = 'Eyring (AI Engine)';
                            classification = aiResult.classification || '';
                        }
                    } catch (err) {
                        console.warn('[AcusticaPage] Failed to calculate RT60 via AIService, falling back to local formulas:', err);
                    }
                }

                if (rt60 === 0) {
                    var alpha = Math.min(0.99, absorption);
                    rt60 = (-0.161 * volume) / (surfaceArea * Math.log(1 - alpha));
                }

                var delayMs = dist > 0 ? (dist / 343) * 1000 : 0;

                // 1. Target and Rating Analysis for church/mixed temples (ideal: 1.2s - 1.5s)
                var ratingColor = '';
                var ratingTitle = '';
                var ratingDesc = '';
                
                if (rt60 > 1.6) {
                    ratingColor = 'text-red-400 border-red-500/20 bg-red-950/20';
                    ratingTitle = 'Crítico (Muito Reverberante)';
                    ratingDesc = 'O tempo de reverberação está muito alto. Isso provoca séria perda de inteligibilidade da fala (as vozes se "embolam" e perdem clareza no fundo do templo), dificultando a pregação.';
                } else if (rt60 >= 1.2 && rt60 <= 1.6) {
                    ratingColor = 'text-emerald-400 border-emerald-500/20 bg-emerald-950/20';
                    ratingTitle = 'Ideal (Equilibrado para Templos)';
                    ratingDesc = 'Excelente tempo de decaimento para cultos mistos. Proporciona uma boa acústica tanto para música congregacional viva quanto para a compreensão da palavra falada.';
                } else if (rt60 >= 0.9 && rt60 < 1.2) {
                    ratingColor = 'text-cyan-400 border-cyan-500/20 bg-cyan-950/20';
                    ratingTitle = 'Bom (Foco em Inteligibilidade)';
                    ratingDesc = 'Tempo ótimo para fala e palestras claras, mas a música congregacional pode soar um pouco seca e sem sustentação. Indicado se o templo for focado principalmente em sermões.';
                } else {
                    ratingColor = 'text-amber-400 border-amber-500/20 bg-amber-950/20';
                    ratingTitle = 'Muito Seco / Amortecido';
                    ratingDesc = 'A acústica da sala é extremamente seca. Excelente para estúdios ou salas de conferência, mas desagradável e cansativa para canto congregacional ativo.';
                }

                // 2. STI (Speech Intelligibility) Estimation based on RT60
                var stiEst = 0;
                var stiClass = '';
                var stiColor = '';
                if (rt60 <= 0.8) {
                    stiEst = 0.76;
                    stiClass = 'Excelente';
                    stiColor = 'text-emerald-400';
                } else if (rt60 <= 1.1) {
                    stiEst = 0.68;
                    stiClass = 'Bom';
                    stiColor = 'text-emerald-400';
                } else if (rt60 <= 1.4) {
                    stiEst = 0.55;
                    stiClass = 'Razoável';
                    stiColor = 'text-amber-400';
                } else if (rt60 <= 1.8) {
                    stiEst = 0.42;
                    stiClass = 'Ruim';
                    stiColor = 'text-red-400';
                } else {
                    stiEst = 0.28;
                    stiClass = 'Muito Ruim';
                    stiColor = 'text-red-400';
                }

                // 3. Critical Distance (Dc) where direct sound = reverberant sound
                var dc = 0.057 * Math.sqrt(volume / rt60);

                // 4. Sabine Absorption Delta to reach target (1.35s mid range)
                var targetRt60 = 1.35;
                var currentSabines = 0.161 * volume / rt60;
                var targetSabines = 0.161 * volume / targetRt60;
                var sabinesDiff = targetSabines - currentSabines; // positive means we need to add absorption

                // 5. Treatment Suggestions
                var suggestions = [];
                if (rt60 > 1.5) {
                    suggestions.push('Instale painéis acústicos absorvedores (lã de rocha ou espuma acústica de densidade média/alta) nas paredes laterais ou traseira.');
                    suggestions.push('Substitua forro convencional por placas minerais acústicas ou adicione nuvens acústicas suspensas no teto.');
                    suggestions.push('Adicione passadeiras ou carpetes nos corredores principais e cortinas de veludo sobre janelas grandes de vidro.');
                } else if (rt60 < 0.9) {
                    suggestions.push('Evite carpetes pesados ou cortinas excessivas nas áreas próximas ao altar/palco.');
                    suggestions.push('Adicione painéis difusores de madeira na parede traseira para manter o brilho e espalhar a energia sonora congregacional.');
                } else {
                    suggestions.push('A acústica está equilibrada. Ajuste a angulação das caixas acústicas (PA) para evitar incidência direta em paredes nuas.');
                    suggestions.push('Use equalização sutil no master para atenuar acúmulos na região de 150-300Hz típicos da geometria da sala.');
                }

                var suggestionsHtml = suggestions.map(function(sug) {
                    return '<li class="text-xs text-slate-400 flex items-start gap-2">' +
                           '  <span class="text-cyan-500 mt-0.5">•</span>' +
                           '  <span>' + sug + '</span>' +
                           '</li>';
                }).join('');

                var resultHtml = '<div class="bg-slate-900/60 border border-white/10 rounded-2xl p-6 space-y-6 text-left animate-in fade-in slide-in-from-bottom-4">' +
                    '  <div class="flex items-center justify-between border-b border-white/5 pb-4">' +
                    '    <h3 class="text-xs font-black uppercase tracking-widest text-slate-400">📊 Relatório Acústico Estimado</h3>' +
                    '    <span class="text-[9px] font-mono px-2 py-0.5 rounded bg-cyan-900/20 text-cyan-400 border border-cyan-500/20">' + formula + '</span>' +
                    '  </div>' +
                    
                    '  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">' +
                    '    <div class="bg-black/40 rounded-xl p-3 border border-white/5 text-center">' +
                    '      <div class="text-[9px] text-slate-500 uppercase font-black tracking-wider">Volume</div>' +
                    '      <div class="text-lg font-black text-cyan-400 mt-1">' + volume.toFixed(0) + ' m³</div>' +
                    '    </div>' +
                    '    <div class="bg-black/40 rounded-xl p-3 border border-white/5 text-center">' +
                    '      <div class="text-[9px] text-slate-500 uppercase font-black tracking-wider">RT60 Estimado</div>' +
                    '      <div class="text-lg font-black ' + (rt60 > 1.6 ? 'text-red-400' : rt60 >= 1.2 ? 'text-emerald-400' : 'text-amber-400') + ' mt-1">' + rt60.toFixed(2) + 's</div>' +
                    '    </div>' +
                    '    <div class="bg-black/40 rounded-xl p-3 border border-white/5 text-center">' +
                    '      <div class="text-[9px] text-slate-500 uppercase font-black tracking-wider">STI Estimado</div>' +
                    '      <div class="text-lg font-black ' + stiColor + ' mt-1">' + stiEst.toFixed(2) + ' <span class="text-[9px] font-normal">(' + stiClass + ')</span></div>' +
                    '    </div>' +
                    '    <div class="bg-black/40 rounded-xl p-3 border border-white/5 text-center">' +
                    '      <div class="text-[9px] text-slate-500 uppercase font-black tracking-wider">Dist. Crítica</div>' +
                    '      <div class="text-lg font-black text-white mt-1">' + dc.toFixed(1) + ' m</div>' +
                    '    </div>' +
                    '  </div>' +

                    '  <div class="border border-white/5 rounded-xl p-4 ' + ratingColor + '">' +
                    '    <div class="font-black text-xs uppercase tracking-wider mb-1">Status: ' + ratingTitle + '</div>' +
                    '    <p class="text-xs leading-relaxed opacity-90">' + ratingDesc + '</p>' +
                    '  </div>' +

                    '  <div class="space-y-3">' +
                    '    <h4 class="text-[10px] font-black uppercase tracking-wider text-slate-400">🎯 Meta e Tratamento Recomendado</h4>' +
                    '    <p class="text-xs text-slate-300 leading-relaxed">' +
                    (sabinesDiff > 0 
                        ? 'Para alcançar o RT60 alvo ideal de <strong>1.35s</strong>, é necessário adicionar aproximadamente <strong>' + sabinesDiff.toFixed(1) + ' Sabines</strong> (m² de absorção sonora equivalente a 100%) em tratamento acústico na sala.' 
                        : 'A quantidade de absorção atual estimada na sala é suficiente para atingir o tempo alvo ideal de <strong>1.35s</strong>.') +
                    '    </p>' +
                    '    <ul class="space-y-1.5 pt-1">' +
                    suggestionsHtml +
                    '    </ul>' +
                    '  </div>' +

                    (dist > 0 
                        ? '  <div class="bg-cyan-950/15 border border-cyan-500/10 rounded-xl p-3 flex items-center gap-3">' +
                          '    <span class="text-xl">⏱️</span>' +
                          '    <div class="text-left">' +
                          '      <div class="text-[10px] font-black uppercase text-cyan-400">Ajuste de Delay Auxiliar</div>' +
                          '      <p class="text-[11px] text-slate-400 leading-tight">Para cobrir a distância de <strong>' + dist.toFixed(1) + 'm</strong> de atraso acústico, configure o canal de delay da mesa em <strong>' + delayMs.toFixed(1) + ' ms</strong>.</p>' +
                          '    </div>' +
                          '  </div>'
                        : '') +
                    '</div>';

                pm._setHTML('rt60-result', resultHtml);

                var resultContainer = pm._el('rt60-result');
                if (resultContainer) {
                    resultContainer.classList.remove('hidden');
                }

                var smm = window.SoundMasterMapping;
                if (smm && typeof smm.updateDimensions === 'function' && !window.RT60Mapping) {
                    smm.updateDimensions(width, length);
                }
            } finally {
                _calcBusy = false;
                _btn.disabled = false;
                _btn.classList.remove('opacity-50', 'pointer-events-none');
            }
        });

        // Pull last RT60 if present
        var rawRt60 = pm._call('SoundMasterAnalyzer', 'getLastRt60');
        if (rawRt60) {
            console.log('[AcusticaPage] Carregando último resultado RT60 na inicialização:', rawRt60);
            var detail = {
                curve: rawRt60.curve || rawRt60.schroeder_curve || [],
                rt60: rawRt60.rt60 || rawRt60.t30 || rawRt60.t20 || rawRt60.rt60_est || 0,
                t20: rawRt60.t20 || 0,
                t30: rawRt60.t30 || 0,
                edt: rawRt60.edt || 0,
                snr: rawRt60.snr || rawRt60.snr_db || 0,
                c50: rawRt60.c50 || 0,
                c80: rawRt60.c80 || 0,
                d50: rawRt60.d50 || 0,
                sti: rawRt60.sti || 0,
                sti_category: rawRt60.sti_category || 'N/A',
                multiband: rawRt60.multiband || {},
                fullResult: rawRt60
            };
            setTimeout(function () {
                _onRt60Result({ detail: detail });
            }, 100);
        }

        // RT60Mapping auto-inits via page-loaded event in rt60-mapping.js
        // and handles btn-import-floorplan, btn-clear-mapping, btn-export-mapping
    }

    function _resizeEtcCanvas() {
        if (!etcCanvas) return;
        var dpr = window.devicePixelRatio || 1;
        etcCanvas.style.width = '';
        etcCanvas.style.height = '';
        var rect = etcCanvas.getBoundingClientRect();
        var w = Math.floor(rect.width * dpr);
        var h = Math.floor(rect.height * dpr);
        if (etcCanvas.width !== w || etcCanvas.height !== h) {
            etcCanvas.width = w;
            etcCanvas.height = h;
        }
        if (etcData) _redrawEtc();
    }

    function _onEtcMouseMove(e) {
        var rect = etcCanvas.getBoundingClientRect();
        etcCrosshairX = (e.clientX - rect.left) * (etcCanvas.width / rect.width);
        etcCrosshairY = (e.clientY - rect.top) * (etcCanvas.height / rect.height);
        _updateEtcReadout();
        if (etcData) _redrawEtc();
    }
    function _onEtcMouseLeave() {
        etcCrosshairX = -1;
        etcCrosshairY = -1;
        var ro = pm._el('etc-cursor-readout');
        if (ro) ro.innerText = 't: -- ms | dB: --';
        if (etcData) _redrawEtc();
    }
    function _initEtcInteractivity() {
        if (!etcCanvas) return;
        etcCanvas.removeEventListener('mousemove', _onEtcMouseMove);
        etcCanvas.removeEventListener('mouseleave', _onEtcMouseLeave);
        etcCanvas.addEventListener('mousemove', _onEtcMouseMove);
        etcCanvas.addEventListener('mouseleave', _onEtcMouseLeave);
    }

    function _updateEtcReadout() {
        if (!etcData || etcCrosshairX < 0) return;
        var dpr = window.devicePixelRatio || 1;
        var axisL = 40 * dpr;
        var w = etcCanvas.width;
        var h = etcCanvas.height;
        var plotW = w - axisL;
        var plotH = h - 18 * dpr;
        if (plotW <= 0) return;

        var timeRange = parseInt(pm._el('etc-time-range') ? pm._el('etc-time-range').value : 1000);
        var plotT = 6 * dpr;
        var xFrac = (etcCrosshairX - axisL) / plotW;
        var tMs = xFrac * timeRange;
        var bin = Math.round((xFrac * etcData.length));
        if (bin < 0) bin = 0;
        if (bin >= etcData.length) bin = etcData.length - 1;

        var ro = pm._el('etc-cursor-readout');
        if (ro) {
            ro.innerText = 't: ' + tMs.toFixed(1) + ' ms | dB: ' + etcData[bin].toFixed(1);
        }
    }

    function _onRt60Result(e) {
        if (!e || !e.detail) return;
        var detail = e.detail;
        if (detail.error) {
            console.warn('[AcusticaPage] Omitindo desenho devido a erro:', detail.error);
            return;
        }
        etcData = detail.curve || [];
        _redrawEtc();

        var fullResult = detail.fullResult || {};
        var multiband = detail.multiband || {};
        var hasRealData = multiband && Object.keys(multiband).length > 0;
        var badge = pm._el('bands-data-badge');
        if (badge) {
            if (hasRealData) {
                badge.textContent = '✓ dados medidos';
                badge.className = 'inline-block mt-2 text-[7px] px-1.5 py-0.5 rounded font-mono border bg-green-900/30 text-green-400 border-green-500/30';
            } else {
                badge.textContent = '⚠ dados estimados (simulação)';
                badge.className = 'inline-block mt-2 text-[7px] px-1.5 py-0.5 rounded font-mono border bg-amber-900/30 text-amber-400 border-amber-500/30';
            }
        }
        _populateAllBandsTable(detail, multiband);
    }

    function _drawSchroederMarkers(ctx, plotL, plotT, plotW, plotH, timeMs) {
        if (!etcData || etcData.length < 2) return;
        var peakDb = -Infinity;
        var peakIdx = 0;
        for (var i = 0; i < etcData.length; i++) {
            if (etcData[i] > peakDb) { peakDb = etcData[i]; peakIdx = i; }
        }

        var drawMarker = function (label, startDbOffset, endDbOffset, color) {
            var startDb = peakDb + startDbOffset;
            var endDb = peakDb + endDbOffset;
            var tStart = -1, tEnd = -1;
            for (var i = peakIdx; i < etcData.length; i++) {
                if (tStart < 0 && etcData[i] <= startDb) tStart = i;
                if (tEnd < 0 && etcData[i] <= endDb) { tEnd = i; break; }
            }
            if (tStart < 0 || tEnd < 0) return;
            var x1 = plotL + (tStart / etcData.length) * plotW;
            var x2 = plotL + (tEnd / etcData.length) * plotW;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(x1, plotT);
            ctx.lineTo(x1, plotT + plotH);
            ctx.moveTo(x2, plotT);
            ctx.lineTo(x2, plotT + plotH);
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            var t1Ms = (tStart / etcData.length) * timeMs;
            var t2Ms = (tEnd / etcData.length) * timeMs;
            ctx.fillText(label + ': ' + (t2Ms - t1Ms).toFixed(1) + 'ms', (x1 + x2) / 2, plotT - 2);

            ctx.restore();
        };

        drawMarker('T20', -5, -25, 'rgba(251, 191, 36, 0.7)');
        drawMarker('T30', -5, -35, 'rgba(248, 113, 113, 0.7)');
    }

    function _redrawEtc() {
        if (!etcCtx || !etcCanvas) return;

        var dpr = window.devicePixelRatio || 1;
        var w = etcCanvas.width;
        var h = etcCanvas.height;
        var axisL = 40 * dpr;
        var axisB = 18 * dpr;
        var plotT = 6 * dpr;
        var plotW = w - axisL;
        var plotH = h - axisB - plotT;
        if (plotW <= 0 || plotH <= 0) return;

        etcCtx.fillStyle = ETC_BG;
        etcCtx.fillRect(0, 0, w, h);

        etcCtx.save();
        etcCtx.beginPath();
        etcCtx.rect(axisL, plotT, plotW, plotH);
        etcCtx.clip();

        // Horizontal dB grid
        etcCtx.strokeStyle = ETC_GRID_COLOR;
        etcCtx.lineWidth = 1;
        var dbStep = 10;
        for (var db = Math.ceil(ETC_MIN_DB / dbStep) * dbStep; db <= ETC_MAX_DB; db += dbStep) {
            var y = plotT + plotH - ((db - ETC_MIN_DB) / (ETC_MAX_DB - ETC_MIN_DB)) * plotH;
            etcCtx.beginPath();
            etcCtx.moveTo(axisL, y);
            etcCtx.lineTo(w, y);
            etcCtx.stroke();
        }

        // Vertical time grid
        var timeRangeMs = parseInt(pm._el('etc-time-range') ? pm._el('etc-time-range').value : 1000);
        var gridSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
        var step = gridSteps[0];
        for (var i = gridSteps.length - 1; i >= 0; i--) {
            if (timeRangeMs / gridSteps[i] >= 5) { step = gridSteps[i]; break; }
        }
        for (var t = step; t < timeRangeMs; t += step) {
            var x = axisL + (t / timeRangeMs) * plotW;
            etcCtx.beginPath();
            etcCtx.moveTo(x, plotT);
            etcCtx.lineTo(x, plotT + plotH);
            etcCtx.stroke();
        }

        // Draw Schroeder curve
        if (etcData && etcData.length > 1) {
            var dbRange = ETC_MAX_DB - ETC_MIN_DB;
            etcCtx.strokeStyle = '#22d3ee';
            etcCtx.lineWidth = 2;
            etcCtx.shadowColor = '#22d3ee';
            etcCtx.shadowBlur = 3;
            etcCtx.beginPath();
            var started = false;
            for (var i = 0; i < etcData.length; i++) {
                var x2 = axisL + (i / etcData.length) * plotW;
                var dbVal = Math.max(ETC_MIN_DB, Math.min(ETC_MAX_DB, etcData[i]));
                var y2 = plotT + plotH - ((dbVal - ETC_MIN_DB) / dbRange) * plotH;
                if (!started) { etcCtx.moveTo(x2, y2); started = true; }
                else { etcCtx.lineTo(x2, y2); }
            }
            etcCtx.stroke();
            etcCtx.shadowBlur = 0;

            _drawSchroederMarkers(etcCtx, axisL, plotT, plotW, plotH, timeRangeMs);
        }

        // Crosshair
        if (etcCrosshairX >= axisL && etcCrosshairX <= w) {
            etcCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            etcCtx.lineWidth = 1;
            etcCtx.setLineDash([2, 2]);
            etcCtx.beginPath();
            etcCtx.moveTo(etcCrosshairX, plotT);
            etcCtx.lineTo(etcCrosshairX, plotT + plotH);
            etcCtx.stroke();
            etcCtx.setLineDash([]);

            if (etcCrosshairY >= plotT && etcCrosshairY <= plotT + plotH) {
                etcCtx.beginPath();
                etcCtx.moveTo(axisL, etcCrosshairY);
                etcCtx.lineTo(w, etcCrosshairY);
                etcCtx.stroke();
            }
        }

        etcCtx.restore();

        // Axis labels
        etcCtx.save();
        etcCtx.fillStyle = ETC_LABEL_COLOR;
        etcCtx.font = Math.max(7, Math.round(8 * dpr)) + 'px monospace';
        etcCtx.textAlign = 'right';
        etcCtx.textBaseline = 'middle';
        for (var db = Math.ceil(ETC_MIN_DB / dbStep) * dbStep; db <= ETC_MAX_DB; db += dbStep) {
            var y = plotT + plotH - ((db - ETC_MIN_DB) / (ETC_MAX_DB - ETC_MIN_DB)) * plotH;
            etcCtx.fillText(db + 'dB', axisL - 3, y);
        }

        etcCtx.textAlign = 'center';
        etcCtx.textBaseline = 'top';
        etcCtx.fillStyle = 'rgba(148, 163, 184, 0.4)';
        etcCtx.font = Math.max(6, Math.round(7 * dpr)) + 'px monospace';
        for (var t = step; t < timeRangeMs; t += step) {
            var x = axisL + (t / timeRangeMs) * plotW;
            etcCtx.fillText(t >= 1000 ? (t / 1000).toFixed(1) + 's' : t.toFixed(t >= 100 ? 0 : 0) + 'ms', x, plotT + plotH + 2);
        }

        var axisBottom = pm._el('etc-canvas');
        if (axisBottom) {
            etcCtx.fillStyle = 'rgba(148, 163, 184, 0.3)';
            etcCtx.font = Math.max(6, Math.round(7 * dpr)) + 'px monospace';
            etcCtx.textAlign = 'center';
            etcCtx.textBaseline = 'bottom';
            etcCtx.fillText('Tempo', w / 2, h - 1);
        }

        etcCtx.restore();
    }

    function _estimateBandSpl(freq) {
        return -30 - 3 * Math.log2(freq / 1000) + (freq < 100 ? 5 : 0);
    }

    function _estimateBandValues(bandFreqs, rt60Overall, t20Overall, t30Overall, edtOverall, c50Overall, c80Overall, stiOverall, multiband) {
        var rows = [];
        for (var i = 0; i < bandFreqs.length; i++) {
            var f = bandFreqs[i];
            var rt60 = rt60Overall;
            var t20 = t20Overall;
            var t30 = t30Overall;
            var edt = edtOverall;
            var c50 = c50Overall;
            var c80 = c80Overall;
            var sti = stiOverall;

            // Check for multiband data
            var key = f.toString();
            var bandData = null;
            if (multiband) {
                if (multiband[key] !== undefined) {
                    bandData = multiband[key];
                } else if (f >= 1000) {
                    var shortKey = (f / 1000) + 'k';
                    if (multiband[shortKey] !== undefined) {
                        bandData = multiband[shortKey];
                    }
                }
            }

            if (bandData) {
                var mRt60 = typeof bandData === 'object' ? parseFloat(bandData.rt60) : parseFloat(bandData);
                var mT20 = typeof bandData === 'object' ? parseFloat(bandData.t20) : NaN;
                var mT30 = typeof bandData === 'object' ? parseFloat(bandData.t30) : NaN;
                var mEdt = typeof bandData === 'object' ? parseFloat(bandData.edt) : NaN;

                if (Number.isFinite(mRt60)) rt60 = mRt60;
                if (Number.isFinite(mT20)) t20 = mT20;
                if (Number.isFinite(mT30)) t30 = mT30;
                if (Number.isFinite(mEdt)) edt = mEdt;
            } else {
                // Realistic freq-dependent variation if no multiband data
                var factor = f < 125 ? 1.2 : f < 500 ? 1.05 : f < 2000 ? 0.95 : f < 8000 ? 0.85 : 0.7;
                rt60 = rt60Overall * factor;
                t20 = t20Overall * factor;
                t30 = t30Overall * factor;
                edt = edtOverall * factor;
                c50 = c50Overall + (f < 500 ? -2 : 2);
                c80 = c80Overall + (f < 500 ? -3 : 3);
                sti = Math.max(0, Math.min(1, stiOverall + (f < 500 ? -0.05 : f > 4000 ? -0.1 : 0)));
            }

            var spl = _estimateBandSpl(f);

            rows.push({
                freq: f,
                spl: spl.toFixed(1),
                rt60: rt60.toFixed(3),
                t20: t20.toFixed(3),
                t30: t30.toFixed(3),
                edt: edt.toFixed(3),
                c50: c50.toFixed(1),
                c80: c80.toFixed(1),
                sti: sti.toFixed(2)
            });
        }
        return rows;
    }

    function _populateAllBandsTable(detail, multiband) {
        var tbody = pm._el('all-bands-tbody');
        if (!tbody) return;

        var rt60 = detail.rt60 || 0;
        var t20 = detail.t20 || 0;
        var t30 = detail.t30 || 0;
        var edt = detail.edt || 0;
        var c50 = detail.c50 || 0;
        var c80 = detail.c80 || 0;
        var sti = detail.sti || 0;

        var rows = _estimateBandValues(
            THIRD_OCTAVE_BANDS, rt60, t20, t30, edt, c50, c80, sti, multiband
        );

        tbody.innerHTML = '';
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var freqLabel = r.freq >= 1000 ? (r.freq / 1000).toFixed(r.freq >= 10000 ? 0 : 1) + 'k' : String(r.freq);
            var tr = document.createElement('tr');
            tr.className = i % 2 === 0 ? 'border-b border-white/5' : 'border-b border-white/5 bg-white/[0.02]';

            tr.innerHTML =
                '<td class="text-left py-1.5 pr-4 text-white font-bold">' + freqLabel + '</td>' +
                '<td class="text-right py-1.5 px-3 text-slate-300">' + r.spl + '</td>' +
                '<td class="text-right py-1.5 px-3 text-cyan-400">' + r.rt60 + '</td>' +
                '<td class="text-right py-1.5 px-3 text-amber-400">' + r.t20 + '</td>' +
                '<td class="text-right py-1.5 px-3 text-red-400">' + r.t30 + '</td>' +
                '<td class="text-right py-1.5 px-3 text-slate-400">' + r.edt + '</td>' +
                '<td class="text-right py-1.5 px-3 ' + (parseFloat(r.c50) >= 0 ? 'text-green-400' : 'text-amber-400') + '">' + r.c50 + '</td>' +
                '<td class="text-right py-1.5 px-3 ' + (parseFloat(r.c80) >= 0 ? 'text-green-400' : 'text-amber-400') + '">' + r.c80 + '</td>' +
                '<td class="text-right py-1.5 px-3 ' + (parseFloat(r.sti) >= 0.6 ? 'text-green-400' : parseFloat(r.sti) >= 0.45 ? 'text-amber-400' : 'text-red-400') + '">' + r.sti + '</td>';

            tbody.appendChild(tr);
        }
    }

    function _exportBandsTable() {
        var tbody = pm._el('all-bands-tbody');
        if (!tbody || !tbody.children.length) return;
        var lines = [];
        lines.push('Freq (Hz)\tSPL (dB)\tRT60 (s)\tT20 (s)\tT30 (s)\tEDT (s)\tC50 (dB)\tC80 (dB)\tSTI');
        for (var i = 0; i < tbody.children.length; i++) {
            var cells = tbody.children[i].querySelectorAll('td');
            var row = [];
            for (var j = 0; j < cells.length; j++) {
                row.push(cells[j].innerText);
            }
            lines.push(row.join('\t'));
        }
        var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'all-bands-' + new Date().toISOString().slice(0, 19).replace(/[:]/g, '-') + '.txt';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function destroy() {
        pm.destroy();
        if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
        (window.parent.document || document).removeEventListener('rt60-result', _onRt60Result);
        window.removeEventListener('resize', _resizeEtcCanvas);
    }

    window.AcusticaPage = { init: init, destroy: destroy };
})();