'use strict';
(function () {
    var pm = createPageModule();
    var _lastResult = null;

    function _setStatus(msg, type) {
        var el = pm._el('aeq-status');
        if (el) { el.textContent = msg; el.className = 'status-msg ' + (type || ''); }
    }

    function init() {
        var canvas = pm._el('aeq-canvas');
        if (canvas) {
            var resize = function () { var rect = canvas.parentElement.getBoundingClientRect(); canvas.width = rect.width - 24; canvas.height = 300; if (_lastResult && window.AutoEqRenderer) AutoEqRenderer.drawGraph(canvas, _lastResult); };
            resize();
            pm._on(window, 'resize', resize);
        }

        pm._on(pm._el('aeq-target-select'), 'change', function () { pm._toggleClass('aeq-custom-area', 'visible', this.value === 'custom'); pm._safeCall('AutoEQ', 'setTarget', this.value); });
        pm._on(pm._el('aeq-apply-custom-btn'), 'click', function () { var json = pm._el('aeq-custom-json'); if (!json) return; try { var pts = JSON.parse(json.value); if (!Array.isArray(pts)) throw new Error('Deve ser array'); pm._safeCall('AutoEQ', 'setTarget', 'custom', pts); _setStatus('Curva customizada aplicada.', 'ok'); } catch (e) { _setStatus('JSON inv\u00E1lido: ' + e.message, 'err'); } });
        pm._on(pm._el('aeq-dest-select'), 'change', function () { pm._toggleClass('aeq-channel-input', 'visible', this.value === 'channel'); var ci = pm._el('aeq-channel-input'); if (ci) ci.style.display = this.value === 'channel' ? '' : 'none'; });

        pm._on(pm._el('aeq-analyze-btn'), 'click', function () {
            if (!window.AutoEQ) { _setStatus('AutoEQ service n\u00E3o carregado.', 'err'); return; }
            pm._el('aeq-stat-rms').classList.add('animate-pulse');
            var freqData = null, sampleRate = 48000, fftSize = 8192;
            var liveAnalyzer = window.SoundMasterAnalyzer;
            if (liveAnalyzer && typeof liveAnalyzer.getFreqData === 'function') { var snap = liveAnalyzer.getFreqData(); if (snap) { freqData = snap.data; sampleRate = snap.sampleRate || 48000; fftSize = snap.fftSize || 8192; } }
            if (!freqData || freqData.length === 0) { freqData = AutoEqRenderer.demoFreqData(fftSize / 2, sampleRate); _setStatus('\u26A0\uFE0F Sem dados ao vivo \u2014 usando espectro de demonstra\u00E7\u00E3o.', 'err'); } else { _setStatus(''); }
            var targetSel = pm._el('aeq-target-select');
            var targetName = targetSel ? targetSel.options[targetSel.selectedIndex].text.split(' (')[0] : '';
            pm._safeCall('AutoEQ', 'setTarget', targetSel && targetSel.value === 'custom' ? 'custom' : (targetSel ? targetSel.value : 'smaart') || 'smaart');
            var result = AutoEQ.analyze(freqData, sampleRate, fftSize); _lastResult = result;
            if (window.AutoEqRenderer) { AutoEqRenderer.renderStats(result.stats, targetName); AutoEqRenderer.renderPEQ(pm._el('aeq-peq-content'), result.peq); AutoEqRenderer.renderGEQ(pm._el('aeq-geq-content'), result.geq); AutoEqRenderer.drawGraph(canvas, result, freqData, sampleRate, fftSize); }
            var exportBtn = pm._el('aeq-export-btn'); if (exportBtn) exportBtn.disabled = false;
            var exportLakeBtn = pm._el('aeq-export-lake-btn'); if (exportLakeBtn) exportLakeBtn.disabled = false;
            var exportPeqBtn = pm._el('aeq-export-peq-btn'); if (exportPeqBtn) exportPeqBtn.disabled = false;
            var applyRow = pm._el('aeq-apply-row'); if (applyRow) applyRow.style.display = '';
            pm._el('aeq-stat-rms').classList.remove('animate-pulse');
        });

        pm._on(pm._el('aeq-ai-btn'), 'click', async function () {
            if (!window.AIService) { _setStatus('AIService não disponível.', 'err'); return; }
            _setStatus('🤖 Consultando IA Python para cálculo do EQ...', '');
            pm._el('aeq-stat-rms').classList.add('animate-pulse');
            var freqData = null, sampleRate = 48000, fftSize = 8192;
            var liveAnalyzer = window.SoundMasterAnalyzer;
            if (liveAnalyzer && typeof liveAnalyzer.getFreqData === 'function') { var snap = liveAnalyzer.getFreqData(); if (snap) { freqData = Array.from(snap.data); sampleRate = snap.sampleRate || 48000; fftSize = snap.fftSize || 8192; } }
            if (!freqData || freqData.length === 0) { _setStatus('❌ Sem dados do analisador ao vivo.', 'err'); return; }
            var targetSel = pm._el('aeq-target-select');
            var targetName = targetSel ? targetSel.value : 'smaart';
            try {
                var result = await AIService.autoEqFromAI(freqData, sampleRate, fftSize, targetName);
                if (result && result.peq) {
                    _lastResult = result;
                    if (window.AutoEqRenderer) {
                        AutoEqRenderer.renderStats(result.stats, targetName);
                        AutoEqRenderer.renderPEQ(pm._el('aeq-peq-content'), result.peq);
                        AutoEqRenderer.renderGEQ(pm._el('aeq-geq-content'), result.geq);
                        var canvas = pm._el('aeq-canvas');
                        if (canvas && result.geq) AutoEqRenderer.drawGraph(canvas, result, freqData, sampleRate, fftSize);
                    }
                    var exportBtn = pm._el('aeq-export-btn'); if (exportBtn) exportBtn.disabled = false;
                    var exportLakeBtn = pm._el('aeq-export-lake-btn'); if (exportLakeBtn) exportLakeBtn.disabled = false;
                    var exportPeqBtn = pm._el('aeq-export-peq-btn'); if (exportPeqBtn) exportPeqBtn.disabled = false;
                    var applyRow = pm._el('aeq-apply-row'); if (applyRow) applyRow.style.display = '';
                    _setStatus('✅ EQ calculado pela IA Python.', 'ok');
                } else {
                    _setStatus('❌ IA não retornou resultados. Usando motor local.', 'err');
                    pm._el('aeq-analyze-btn') && pm._el('aeq-analyze-btn').click();
                }
            } catch (e) { _setStatus('❌ Erro IA: ' + e.message, 'err'); }
            pm._el('aeq-stat-rms').classList.remove('animate-pulse');
        });
        pm._on(pm._el('aeq-export-btn'), 'click', function () { if (!window.AutoEQ) return; AutoEQ.downloadEqData(AutoEQ.exportGEQ(), 'auto-eq-geq.csv', 'text/csv'); });
        pm._on(pm._el('aeq-export-lake-btn'), 'click', function () { if (!window.AutoEQ || !_lastResult) return; AutoEQ.downloadEqData(AutoEQ.exportLake(_lastResult.peq), 'auto-eq-lake.txt', 'text/plain'); });
        pm._on(pm._el('aeq-export-peq-btn'), 'click', function () { if (!window.AutoEQ || !_lastResult) return; AutoEQ.downloadEqData(AutoEQ.exportGenericPEQ(_lastResult.peq), 'auto-eq-peq.txt', 'text/plain'); });

        function _showUndoBtn(show) {
            var btn = pm._el('aeq-undo-btn');
            if (btn) btn.style.display = show ? '' : 'none';
        }

        function _doApply() {
            if (!_lastResult || !window.AutoEQ) return;
            var dest = pm._el('aeq-dest-select') ? pm._el('aeq-dest-select').value : 'master';
            var ch = parseInt(pm._el('aeq-channel-input') ? pm._el('aeq-channel-input').value : 1) || 1;
            var res = AutoEQ.applyToMixer(_lastResult.peq, dest, ch);
            if (res && res.length) {
                _setStatus('\u2705 ' + res.length + ' filtro(s) PEQ enviado(s) para a mesa (' + (dest === 'master' ? 'Master' : 'Canal ' + ch) + ').', 'ok');
                _showUndoBtn(true);
            } else {
                _setStatus('Nenhum filtro significativo para aplicar (desvio < 0.5dB).', 'err');
            }
        }

        function _showConfirmDialog() {
            if (!_lastResult) return;
            var overlay = pm._el('aeq-confirm-overlay');
            var summary = pm._el('aeq-confirm-summary');
            if (!overlay || !summary) { _doApply(); return; }
            var html = _lastResult.peq.map(function (f) { return '<div>Band' + f.band + ': <strong>' + f.hz + 'Hz</strong>, ' + (f.gainDb >= 0 ? '+' : '') + f.gainDb.toFixed(1) + 'dB, Q' + f.q.toFixed(1) + '</div>'; }).join('');
            var dest = pm._el('aeq-dest-select') ? pm._el('aeq-dest-select').value : 'master';
            var ch = parseInt(pm._el('aeq-channel-input') ? pm._el('aeq-channel-input').value : 1) || 1;
            summary.innerHTML = '<div class="text-cyan-300 font-bold mb-2">Destino: ' + (dest === 'master' ? 'Master' : 'Canal ' + ch) + '</div>' + html;
            overlay.classList.remove('hidden');
        }

        pm._on(pm._el('aeq-apply-btn'), 'click', _showConfirmDialog);
        pm._on(pm._el('aeq-confirm-ok'), 'click', function () {
            var overlay = pm._el('aeq-confirm-overlay');
            if (overlay) overlay.classList.add('hidden');
            _doApply();
        });
        pm._on(pm._el('aeq-confirm-cancel'), 'click', function () {
            var overlay = pm._el('aeq-confirm-overlay');
            if (overlay) overlay.classList.add('hidden');
        });
        pm._on(pm._el('aeq-undo-btn'), 'click', function () {
            if (!window.AutoEQ) return;
            AutoEQ.requestUndo();
            _setStatus('↩ EQ desfeito.', 'ok');
            _showUndoBtn(false);
        });

        pm._on(pm._el('aeq-dest-select'), 'change', function () { _showUndoBtn(false); });
        pm._on(pm._el('aeq-channel-input'), 'input', function () { _showUndoBtn(false); });
        pm._safeCall('AutoEQ', 'setTarget', 'smaart');
    }

    function destroy() { pm.destroy(); _lastResult = null; }

    window.AutoEqPage = { init: init, destroy: destroy };
})();
