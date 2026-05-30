'use strict';
(function () {
    var pm = createPageModule();

    function _toggleSignal(btnId, activeCls, inactiveCls, startFn, label) {
        var btn = pm._el(btnId);
        if (!btn || !window.SignalGeneratorService) return;
        if (SignalGeneratorService.isPlayingAny()) {
            SignalGeneratorService.stopAll();
            btn.classList.remove.apply(btn.classList, activeCls);
            btn.classList.add.apply(btn.classList, inactiveCls);
            btn.querySelector('span:last-child').textContent = label;
        } else {
            startFn();
            btn.classList.add.apply(btn.classList, activeCls);
            btn.classList.remove.apply(btn.classList, inactiveCls);
            btn.querySelector('span:last-child').textContent = 'STOP';
        }
    }

    function init() {
        pm._on(pm._el('btn-white-noise'), 'click', function () { _toggleSignal('btn-white-noise', ['bg-cyan-600', 'text-white'], ['bg-slate-700/50'], function () { SignalGeneratorService.startWhiteNoise(0.3); }, 'Branco'); });
        pm._on(pm._el('btn-mls-signal'), 'click', function () { _toggleSignal('btn-mls-signal', ['bg-amber-600', 'text-white'], ['bg-amber-900/20'], function () { SignalGeneratorService.startMLS(13, 0.5); }, 'MLS'); });
        pm._on(pm._el('btn-chirp-signal'), 'click', function () { _toggleSignal('btn-chirp-signal', ['bg-amber-600', 'text-white'], ['bg-amber-900/20'], function () { SignalGeneratorService.startChirp(20, 20000, 2.0, 0.5); }, 'Chirp'); });
        pm._on(pm._el('btn-dual-tone'), 'click', function () { _toggleSignal('btn-dual-tone', ['bg-cyan-600', 'text-white'], ['bg-cyan-900/20'], function () { SignalGeneratorService.startDualTone(1000, 1500, 0.3); }, 'Dual-Tone'); });
        pm._on(pm._el('btn-pink-noise'), 'click', function () { pm._safeCall('SoundMasterAnalyzer', 'toggle'); });
        pm._on(pm._el('btn-start-audio'), 'click', function () { pm._safeCall('SoundMasterAnalyzer', 'toggle'); });
        pm._on(pm._el('btn-stop-audio'), 'click', function () { pm._safeCall('SoundMasterAnalyzer', 'toggle'); });
        pm._on(pm._el('btn-send-analysis'), 'click', function () { if (window.SoundMasterAnalyzer) { var analysis = SoundMasterAnalyzer.getLastAnalysis(); if (!analysis) { alert('Nenhuma an\u00E1lise dispon\u00EDvel. Ative o microfone e aguarde.'); return; } if (typeof window._sendAnalysisToAI === 'function') window._sendAnalysisToAI(); } });
        pm._on(pm._el('btn-measure-pink'), 'click', function () { pm._safeCall('SoundMasterAnalyzer', 'startPinkNoiseMeasurement'); });
        pm._on(pm._el('btn-log-sweep'), 'click', function () { pm._safeCall('SoundMasterAnalyzer', 'triggerImpulse'); });
        pm._on(pm._el('btn-toggle-auto-cut'), 'change', function () { console.log('[AnalyzerPage] Auto-Cut: ' + (this.checked ? 'ON' : 'OFF')); });
        pm._on(pm._el('btn-manual-diagnostic'), 'click', function () { if (window.SoundMasterAnalyzer && SoundMasterAnalyzer.hasAnalysis()) { var summaryEl = pm._el('acoustic-summary'), analysis = SoundMasterAnalyzer.getLastAnalysis(); if (summaryEl && analysis) { summaryEl.innerHTML = '<strong>Diagn\u00F3stico:</strong> ' + analysis.text.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]}); summaryEl.classList.add('text-cyan-400'); } } });

        document.querySelectorAll('.subtab-btn[data-subtab]').forEach(function (btn) {
            pm._on(btn, 'click', function () {
                var subtab = this.getAttribute('data-subtab');
                document.querySelectorAll('.subtab-btn[data-subtab]').forEach(function (b) { b.classList.remove('active'); b.classList.add('text-slate-400'); });
                this.classList.add('active'); this.classList.remove('text-slate-400');
                document.querySelectorAll('.analyzer-subtab').forEach(function (panel) { panel.classList.add('hidden'); panel.classList.remove('active'); });
                var target = pm._el(subtab);
                if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
            });
        });
    }

    function destroy() { pm.destroy(); }

    window.AnalyzerPage = { init: init, destroy: destroy };
})();
