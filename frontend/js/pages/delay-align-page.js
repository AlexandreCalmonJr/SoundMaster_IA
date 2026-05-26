(function () {
    'use strict';
    var pm = createPageModule();
    var _delayMs = null;
    var _intervalId = null;

    function _gotoStep(n) {
        for (var i = 1; i <= 3; i++) {
            var panel = pm._el('dal-panel-' + i);
            if (panel) panel.classList.toggle('hidden', i !== n);
            var step = pm._el('dal-step-' + i);
            if (step) {
                step.classList.remove('bg-cyan-500', 'bg-slate-700');
                if (i < n) step.classList.add('bg-cyan-500');
                else if (i === n) step.classList.add('bg-cyan-500');
                else step.classList.add('bg-slate-700');
            }
        }
    }

    function _startMeasurement() {
        var statusEl = pm._el('dal-delay-status');
        if (statusEl) statusEl.textContent = 'Aguardando dados do Transfer Function...';

        var liveAnalyzer = window.SoundMasterAnalyzer;
        if (!liveAnalyzer || typeof liveAnalyzer.getDelayMs !== 'function') {
            if (statusEl) statusEl.textContent = 'Ative o Analyzer com TF (duplo-canal) primeiro.';
            return;
        }

        if (_intervalId) clearInterval(_intervalId);
        _intervalId = setInterval(function () {
            try {
                var delay = liveAnalyzer.getDelayMs();
                if (delay !== null && delay !== undefined) {
                    _delayMs = delay;
                    var valEl = pm._el('dal-delay-value');
                    if (valEl) valEl.textContent = delay.toFixed(2) + ' ms';
                    var barEl = pm._el('dal-delay-bar');
                    if (barEl) barEl.style.width = Math.min(100, delay * 5) + '%';
                    if (statusEl) statusEl.textContent = 'Estável ✓';
                    statusEl.classList.add('text-green-400');
                }
            } catch (e) {
                if (statusEl) statusEl.textContent = 'Erro: ' + e.message;
            }
        }, 500);
    }

    function _stopMeasurement() {
        if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
    }

    function init() {
        pm._on(pm._el('dal-next-1'), 'click', function () {
            _gotoStep(2);
            setTimeout(_startMeasurement, 300);
        });

        pm._on(pm._el('dal-next-2'), 'click', function () {
            _stopMeasurement();
            var valEl = pm._el('dal-apply-delay');
            if (valEl && _delayMs !== null) valEl.textContent = _delayMs.toFixed(2) + ' ms';
            _gotoStep(3);
        });

        pm._on(pm._el('dal-back-1'), 'click', function () { _stopMeasurement(); _gotoStep(1); });
        pm._on(pm._el('dal-back-2'), 'click', function () { _gotoStep(2); setTimeout(_startMeasurement, 300); });

        pm._on(pm._el('dal-apply-btn'), 'click', function () {
            if (_delayMs === null) { pm._el('dal-apply-status').textContent = 'Nenhum delay medido.'; return; }
            var ch = pm._el('dal-target-channel') ? pm._el('dal-target-channel').value : 'aux1';
            var ms = _delayMs.toFixed(1);
            if (window.MixerService && typeof MixerService.setDelay === 'function') {
                MixerService.setDelay(ch, ms);
                pm._el('dal-apply-status').textContent = 'Delay de ' + ms + 'ms aplicado em ' + ch + ' ✓';
            } else if (window.MixerService && window.SocketService) {
                SocketService.emit('set_aux_delay', { aux: ch, delayMs: parseFloat(ms) });
                pm._el('dal-apply-status').textContent = 'Delay de ' + ms + 'ms aplicado em ' + ch + ' ✓';
            } else {
                pm._el('dal-apply-status').textContent = 'Mixer não conectado. Delay: ' + ms + 'ms';
            }
        });

        pm._on(pm._el('dal-finish'), 'click', function () { _stopMeasurement(); _gotoStep(1); _delayMs = null; });
    }

    function destroy() { _stopMeasurement(); pm.destroy(); _delayMs = null; }

    window.DelayAlignPage = { init: init, destroy: destroy };
})();
