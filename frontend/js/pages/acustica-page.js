'use strict';
(function () {
    var pm = createPageModule();

    var etcCanvas, etcCtx;
    var etcData = null;
    var etcCrosshairX = -1;
    var etcCrosshairY = -1;

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
                var formula = 'Sabine (Local Fallback)';
                var classification = '';

                if (window.AIService && typeof window.AIService.calculateAcoustics === 'function') {
                    try {
                        var aiResult = await window.AIService.calculateAcoustics(volume, surfaceArea, absorption);
                        if (aiResult) {
                            rt60 = aiResult.rt60;
                            formula = 'Eyring (AI Engine)';
                            classification = aiResult.classification;
                        }
                    } catch (err) {
                        console.warn('[AcusticaPage] Failed to calculate RT60 via AIService, falling back to local formulas:', err);
                    }
                }

                if (rt60 === 0) {
                    var alpha = Math.min(0.99, absorption);
                    rt60 = (-0.161 * volume) / (surfaceArea * Math.log(1 - alpha));
                    formula = 'Eyring (Local Fallback)';
                }

                var delayMs = dist > 0 ? (dist / 343) * 1000 : 0;
                var color = rt60 > 1.6 ? 'text-red-400' : rt60 > 1.4 ? 'text-green-400' : 'text-amber-400';

                var resultHtml = '<div class="bg-slate-800/60 border border-white/10 rounded-2xl p-6">' +
                    '<h3 class="text-xs font-black uppercase tracking-widest text-slate-500 mb-4">Resultado Estimado</h3>' +
                    '<div class="grid grid-cols-2 gap-4">' +
                    '<div class="bg-black/40 rounded-xl p-4 text-center">' +
                    '<div class="text-[9px] text-slate-500 uppercase font-bold">Volume</div>' +
                    '<div class="text-xl font-black text-cyan-400">' + volume.toFixed(0) + ' m³</div>' +
                    '</div>' +
                    '<div class="bg-black/40 rounded-xl p-4 text-center">' +
                    '<div class="text-[9px] text-slate-500 uppercase font-bold">RT60 Estimado</div>' +
                    '<div class="text-xl font-black ' + color + '">' + rt60.toFixed(2) + 's</div>' +
                    '</div>' +
                    '</div>' +
                    '<p class="text-[10px] text-slate-400 mt-4">Fórmula: ' + formula + '</p>' +
                    '</div>';

                pm._setHTML('rt60-result', resultHtml);

                var resultContainer = pm._el('rt60-result');
                if (resultContainer) {
                    resultContainer.classList.remove('hidden');
                }

                if (dist > 0) {
                    var el = pm._el('rt60-result');
                    if (el) {
                        var delayInfo = document.createElement('div');
                        delayInfo.className = 'bg-black/30 rounded-xl p-3 mt-3 text-center';
                        delayInfo.innerHTML = '<span class="text-[9px] text-slate-500 uppercase font-bold">Delay Auxiliar:</span> <span class="text-sm font-black text-cyan-400">' + delayMs.toFixed(1) + ' ms</span>';
                        el.appendChild(delayInfo);
                    }
                }

                var smm = window.SoundMasterMapping;
                if (smm && typeof smm.updateDimensions === 'function') {
                    smm.updateDimensions(width, length);
                }
            } finally {
                _calcBusy = false;
                _btn.disabled = false;
                _btn.classList.remove('opacity-50', 'pointer-events-none');
            }
        });

        pm._on(pm._el('btn-import-floorplan'), 'click', function () {
            var input = pm._el('input-floorplan');
            if (input) input.click();
        });

        var rtm = window.RT60Mapping;
        if (rtm && typeof rtm.init === 'function') {
            var canvas = pm._el('mapping-canvas');
            var container = pm._el('mapping-container');
            if (canvas) {
                rtm.init(canvas, container);
            }
        }
    }

    function _resizeEtcCanvas() {
        if (!etcCanvas) return;
        var dpr = window.devicePixelRatio || 1;
        var rect = etcCanvas.getBoundingClientRect();
        var w = Math.floor(rect.width * dpr);
        var h = Math.floor(rect.height * dpr);
        if (etcCanvas.width !== w || etcCanvas.height !== h) {
            etcCanvas.width = w;
            etcCanvas.height = h;
            etcCanvas.style.width = rect.width + 'px';
            etcCanvas.style.height = rect.height + 'px';
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
        var dbRange = ETC_MAX_DB - ETC_MIN_DB;
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
            if (multiband && multiband[key] !== undefined) {
                var val = parseFloat(multiband[key]);
                if (Number.isFinite(val)) {
                    rt60 = val;
                    t20 = val * 0.92;
                    t30 = val;
                    edt = val * 0.85;
                }
            }

            // Realistic freq-dependent variation if no multiband data
            if (!multiband || multiband[key] === undefined) {
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
        (window.parent.document || document).removeEventListener('rt60-result', _onRt60Result);
        window.removeEventListener('resize', _resizeEtcCanvas);
    }

    window.AcusticaPage = { init: init, destroy: destroy };
})();