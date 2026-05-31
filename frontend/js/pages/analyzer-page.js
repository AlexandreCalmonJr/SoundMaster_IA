/**
 * =============================================================================
 * SoundMaster — Página Principal do Analisador
 * =============================================================================
 *
 * Descrição:
 *     Módulo principal da página de análise de áudio. Fornece controles para
 *     geração de sinais (ruído branco, MLS, Chirp, Dual-Tone), controle do
 *     analisador FFT em tempo real, medição de ruído rosa e trigger de impulso.
 *
 * Funcionalidades:
 *     - Geração e controle de sinais de teste (toggle on/off)
 *     - Controle do analisador FFT (iniciar/parar)
 *     - Medição de ruído rosa para calibração
 *     - Trigger de sweep logarítmico para medição de impulso
 *     - Toggle de auto-cut para controle automático de corte
 *     - Diagnóstico acústico baseado na última análise
 *     - Navegação entre sub-abas do analisador
 *
 * Dependências:
 *     - SignalGeneratorService: Serviço de geração de sinais de áudio
 *     - SoundMasterAnalyzer: Serviço principal de análise FFT
 *     - createPageModule(): Módulo base de páginas (fornece _el, _on, _safeCall)
 *
 * Integrações:
 *     - Integra com o sistema de sinais para gerar diferentes tipos de onda
 *     - Conecta-se ao analisador FFT para medições em tempo real
 *     - Expõe interface para diagnóstico acústico
 *
 * Uso:
 *     Para inicializar a página: AnalyzerPage.init()
 *     Para destruir a página: AnalyzerPage.destroy()
 *
 * Variável Global:
 *     window.AnalyzerPage - Objeto público com métodos init() e destroy()
 * =============================================================================
 */

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
