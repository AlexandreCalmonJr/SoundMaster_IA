/**
 * SoundMaster — Analyzer Page Module
 * Binds DOM events para a página de análise de áudio.
 *
 * Padrão: init() no page-loaded, destroy() no page-unload.
 */

'use strict';

(function () {

    let _listeners = [];

    function _on(target, event, selector, handler) {
        if (typeof selector === 'function') {
            handler = selector;
            selector = null;
        }
        const el = selector ? (typeof selector === 'string' ? document.querySelector(selector) : selector) : target;
        if (!el) return;
        el.addEventListener(event, handler);
        _listeners.push({ target: el, event, handler });
    }

    function init() {
        console.log('[AnalyzerPage] Initializing...');

        // Signal generators
        _on(document.getElementById('btn-white-noise'), 'click', function () {
            if (!window.SignalGeneratorService) return;
            if (SignalGeneratorService.isPlayingAny()) {
                SignalGeneratorService.stopAll();
                this.classList.remove('bg-cyan-600', 'text-white');
                this.classList.add('bg-slate-700/50');
                this.querySelector('span:last-child').textContent = 'Branco';
            } else {
                SignalGeneratorService.startWhiteNoise(0.3);
                this.classList.add('bg-cyan-600', 'text-white');
                this.classList.remove('bg-slate-700/50');
                this.querySelector('span:last-child').textContent = 'STOP';
            }
        });

        _on(document.getElementById('btn-mls-signal'), 'click', function () {
            if (!window.SignalGeneratorService) return;
            if (SignalGeneratorService.isPlayingAny()) {
                SignalGeneratorService.stopAll();
                this.classList.remove('bg-amber-600', 'text-white');
                this.classList.add('bg-amber-900/20');
                this.querySelector('span:last-child').textContent = 'MLS';
            } else {
                SignalGeneratorService.startMLS(13, 0.5);
                this.classList.add('bg-amber-600', 'text-white');
                this.classList.remove('bg-amber-900/20');
                this.querySelector('span:last-child').textContent = 'STOP';
            }
        });

        _on(document.getElementById('btn-chirp-signal'), 'click', function () {
            if (!window.SignalGeneratorService) return;
            if (SignalGeneratorService.isPlayingAny()) {
                SignalGeneratorService.stopAll();
                this.classList.remove('bg-purple-600', 'text-white');
                this.classList.add('bg-purple-900/20');
                this.querySelector('span:last-child').textContent = 'Chirp';
            } else {
                SignalGeneratorService.startChirp(20, 20000, 2.0, 0.5);
                this.classList.add('bg-purple-600', 'text-white');
                this.classList.remove('bg-purple-900/20');
                this.querySelector('span:last-child').textContent = 'STOP';
            }
        });

        _on(document.getElementById('btn-dual-tone'), 'click', function () {
            if (!window.SignalGeneratorService) return;
            if (SignalGeneratorService.isPlayingAny()) {
                SignalGeneratorService.stopAll();
                this.classList.remove('bg-cyan-600', 'text-white');
                this.classList.add('bg-cyan-900/20');
                this.querySelector('span:last-child').textContent = 'Dual-Tone';
            } else {
                SignalGeneratorService.startDualTone(1000, 1500, 0.3);
                this.classList.add('bg-cyan-600', 'text-white');
                this.classList.remove('bg-cyan-900/20');
                this.querySelector('span:last-child').textContent = 'STOP';
            }
        });

        _on(document.getElementById('btn-pink-noise'), 'click', function () {
            if (!window.SoundMasterAnalyzer) return;
            SoundMasterAnalyzer.toggle();
        });

        _on(document.getElementById('btn-start-audio'), 'click', function () {
            if (window.SoundMasterAnalyzer) SoundMasterAnalyzer.toggle();
        });

        _on(document.getElementById('btn-stop-audio'), 'click', function () {
            if (window.SoundMasterAnalyzer) SoundMasterAnalyzer.toggle();
        });

        _on(document.getElementById('btn-send-analysis'), 'click', function () {
            if (window.SoundMasterAnalyzer) {
                const analysis = SoundMasterAnalyzer.getLastAnalysis();
                if (!analysis) {
                    alert('Nenhuma análise disponível. Ative o microfone e aguarde.');
                    return;
                }
                // Delegar para o analyzer.js existente
                if (typeof window._sendAnalysisToAI === 'function') {
                    window._sendAnalysisToAI();
                }
            }
        });

        _on(document.getElementById('btn-measure-pink'), 'click', function () {
            if (window.SoundMasterAnalyzer) SoundMasterAnalyzer.toggle();
        });

        _on(document.getElementById('btn-log-sweep'), 'click', function () {
            if (window.SoundMasterAnalyzer) SoundMasterAnalyzer.triggerImpulse();
        });

        _on(document.getElementById('btn-toggle-auto-cut'), 'change', function () {
            console.log(`[AnalyzerPage] Auto-Cut: ${this.checked ? 'ON' : 'OFF'}`);
        });

        _on(document.getElementById('btn-manual-diagnostic'), 'click', function () {
            if (window.SoundMasterAnalyzer && SoundMasterAnalyzer.hasAnalysis()) {
                const summaryEl = document.getElementById('acoustic-summary');
                const analysis = SoundMasterAnalyzer.getLastAnalysis();
                if (summaryEl && analysis) {
                    summaryEl.innerHTML = `<strong>Diagnóstico:</strong> ${analysis.text}`;
                    summaryEl.classList.add('text-cyan-400');
                }
            }
        });

        // Subtab switching
        document.querySelectorAll('.subtab-btn[data-subtab]').forEach(btn => {
            _on(btn, 'click', function () {
                const subtab = this.getAttribute('data-subtab');
                document.querySelectorAll('.subtab-btn[data-subtab]').forEach(b => {
                    b.classList.remove('active');
                    b.classList.add('text-slate-400');
                });
                this.classList.add('active');
                this.classList.remove('text-slate-400');

                document.querySelectorAll('.analyzer-subtab').forEach(panel => {
                    panel.classList.add('hidden');
                    panel.classList.remove('active');
                });
                const target = document.getElementById(subtab);
                if (target) {
                    target.classList.remove('hidden');
                    target.classList.add('active');
                }
            });
        });

        console.log('[AnalyzerPage] Initialized.');
    }

    function destroy() {
        _listeners.forEach(({ target, event, handler }) => {
            target.removeEventListener(event, handler);
        });
        _listeners = [];
        console.log('[AnalyzerPage] Destroyed.');
    }

    window.AnalyzerPage = { init, destroy };
})();
