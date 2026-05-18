/**
 * SoundMaster — Auto-EQ Page Module
 * Binds DOM events para a página de Auto-EQ / Target Curve Matching.
 */

'use strict';

(function () {

    let _listeners = [];
    let _lastResult = null;

    function _on(target, event, handler) {
        if (!target) return;
        target.addEventListener(event, handler);
        _listeners.push({ target, event, handler });
    }

    function _setStatus(msg, type) {
        const el = document.getElementById('aeq-status');
        if (el) {
            el.textContent = msg;
            el.className = 'status-msg ' + (type || '');
        }
    }

    function init() {
        console.log('[AutoEqPage] Initializing...');

        // Resize canvas
        const canvas = document.getElementById('aeq-canvas');
        if (canvas) {
            const resize = function () {
                const rect = canvas.parentElement.getBoundingClientRect();
                canvas.width = rect.width - 24;
                canvas.height = 300;
                if (_lastResult && window.AutoEqRenderer) {
                    AutoEqRenderer.drawGraph(canvas, _lastResult);
                }
            };
            resize();
            window.addEventListener('resize', resize);
            _listeners.push({ target: window, event: 'resize', handler: resize });
        }

        // Target curve select
        _on(document.getElementById('aeq-target-select'), 'change', function () {
            const customArea = document.getElementById('aeq-custom-area');
            if (customArea) customArea.classList.toggle('visible', this.value === 'custom');
            if (window.AutoEQ) AutoEQ.setTarget(this.value);
        });

        // Custom curve apply
        _on(document.getElementById('aeq-apply-custom-btn'), 'click', function () {
            const json = document.getElementById('aeq-custom-json');
            if (!json) return;
            try {
                const pts = JSON.parse(json.value);
                if (!Array.isArray(pts)) throw new Error('Deve ser array');
                if (window.AutoEQ) AutoEQ.setTarget('custom', pts);
                _setStatus('Curva customizada aplicada.', 'ok');
            } catch (e) {
                _setStatus('JSON inválido: ' + e.message, 'err');
            }
        });

        // Destination select
        _on(document.getElementById('aeq-dest-select'), 'change', function () {
            const chInput = document.getElementById('aeq-channel-input');
            if (chInput) chInput.style.display = this.value === 'channel' ? '' : 'none';
        });

        // Analyze
        _on(document.getElementById('aeq-analyze-btn'), 'click', function () {
            if (!window.AutoEQ) { _setStatus('AutoEQ service não carregado.', 'err'); return; }

            let freqData = null, sampleRate = 48000, fftSize = 8192;

            const liveAnalyzer = window.SoundMasterAnalyzer;
            if (liveAnalyzer && typeof liveAnalyzer.getFreqData === 'function') {
                const snap = liveAnalyzer.getFreqData();
                if (snap) { freqData = snap.data; sampleRate = snap.sampleRate || 48000; fftSize = snap.fftSize || 8192; }
            }

            if (!freqData || freqData.length === 0) {
                freqData = AutoEqRenderer.demoFreqData(fftSize / 2, sampleRate);
                _setStatus('⚠️ Sem dados ao vivo — usando espectro de demonstração.', 'err');
            } else {
                _setStatus('');
            }

            const targetSel = document.getElementById('aeq-target-select');
            const targetName = targetSel ? targetSel.options[targetSel.selectedIndex].text.split(' (')[0] : '';

            AutoEQ.setTarget(targetSel && targetSel.value === 'custom' ? 'custom' : targetSel?.value || 'smaart');
            const result = AutoEQ.analyze(freqData, sampleRate, fftSize);
            _lastResult = result;

            if (window.AutoEqRenderer) {
                AutoEqRenderer.renderStats(result.stats, targetName);
                AutoEqRenderer.renderPEQ(document.getElementById('aeq-peq-content'), result.peq);
                AutoEqRenderer.renderGEQ(document.getElementById('aeq-geq-content'), result.geq);
                AutoEqRenderer.drawGraph(canvas, result, freqData, sampleRate, fftSize);
            }

            const exportBtn = document.getElementById('aeq-export-btn');
            if (exportBtn) exportBtn.disabled = false;
            const applyRow = document.getElementById('aeq-apply-row');
            if (applyRow) applyRow.style.display = '';
        });

        // Export
        _on(document.getElementById('aeq-export-btn'), 'click', function () {
            if (!window.AutoEQ) return;
            const csv = AutoEQ.exportGEQ();
            const blob = new Blob([csv], { type: 'text/csv' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'auto-eq-geq.csv';
            a.click();
        });

        // Apply to mixer
        _on(document.getElementById('aeq-apply-btn'), 'click', function () {
            if (!_lastResult || !window.AutoEQ) return;
            const dest = document.getElementById('aeq-dest-select')?.value || 'master';
            const ch = parseInt(document.getElementById('aeq-channel-input')?.value) || 1;
            const res = AutoEQ.applyToMixer(_lastResult.peq, dest, ch);
            if (res && res.length) {
                _setStatus(`✅ ${res.length} filtro(s) PEQ enviado(s) para a mesa (${dest === 'master' ? 'Master' : 'Canal ' + ch}).`, 'ok');
            } else {
                _setStatus('Nenhum filtro significativo para aplicar (desvio < 0.5dB).', 'err');
            }
        });

        // Init default target
        if (window.AutoEQ) AutoEQ.setTarget('smaart');

        console.log('[AutoEqPage] Initialized.');
    }

    function destroy() {
        _listeners.forEach(({ target, event, handler }) => {
            target.removeEventListener(event, handler);
        });
        _listeners = [];
        _lastResult = null;
        console.log('[AutoEqPage] Destroyed.');
    }

    window.AutoEqPage = { init, destroy };
})();
