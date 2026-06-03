/**
 * =============================================================================
 * SoundMaster — Página de Sinais do Analisador
 * =============================================================================
 *
 * Descrição:
 *     Módulo responsável pela interface de geração de sinais de áudio.
 *     Controla a geração de múltiplos tipos de sinais e delega a geração
 *     efetiva para o SignalGeneratorController.
 *
 * Tipos de Sinais Suportados:
 *     - Pink Noise (Ruído Rosa): Ruído com distribuição de energia por oitava
 *     - White Noise (Ruído Branco): Ruído com distribuição uniforme de energia
 *     - MLS (Maximum Length Sequence): Sequência de comprimento máximo para medição
 *     - Chirp: Varredura de frequência linear ou logarítmica
 *     - Dual-Tone: Dois tons simultâneos (1000Hz e 1500Hz padrão)
 *     - Sine Wave (Onda Senoidal): Tom puro com frequência e nível configuráveis
 *     - Band-Limited Noise: Ruído limitado a banda específica (pink/white)
 *
 * Funcionalidades:
 *     - Controle de nível de saída global (slider em dB)
 *     - Presets de frequência para onda senoidal
 *     - Configuração de banda para ruído limitado
 *     - Botões de estado com feedback visual (toggle on/off)
 *     - Prevenção de sobreposição de sinais (stopAll antes de iniciar)
 *     - Parada automática ao navegar fora da página
 *
 * Dependências:
 *     - SignalGeneratorController: Controlador de geração de sinais
 *     - SoundMasterAnalyzer: Analisador para medição de ruído rosa
 *     - createPageModule(): Módulo base de páginas
 *
 * Integrações:
 *     - Integra com o Analisador para medições de ruído rosa
 *     - Conecta-se ao trigger de impulso do analisador
 *     - Fornece controles para calibração de sistema
 *
 * Uso:
 *     Para inicializar: AnalyzerSignalsPage.init()
 *     Para destruir (para todos os sinais): AnalyzerSignalsPage.destroy()
 *
 * Variável Global:
 *     window.AnalyzerSignalsPage - Objeto público com métodos init() e destroy()
 * =============================================================================
 */

'use strict';

(function () {
    const pm = createPageModule();
    let _pollingInterval = null;

    function _pollRealtimeData() {
        const analyzer = window.SoundMasterAnalyzer;
        if (!analyzer) return;

        const gen = window.SignalGeneratorController;
        if (gen) {
            const anyPlaying = gen.isPinkNoisePlaying() || gen.isWhiteNoisePlaying() || gen.isMLSPlaying() || 
                               gen.isChirpPlaying() || gen.isDualTonePlaying() || gen.isSineWavePlaying() || 
                               gen.isBandLimitedPlaying();
            if (anyPlaying && !analyzer.isAnalyzing()) {
                analyzer.start();
            }
        }

        const panel = pm._el('signals-realtime-panel');
        if (!panel) return;

        if (analyzer.isAnalyzing()) {
            panel.classList.remove('hidden');

            const analysis = analyzer.getLastAnalysis();
            if (analysis && analysis.details) {
                const rmsEl = pm._el('realtime-rms');
                const crestEl = pm._el('realtime-crest');
                const peakFreqEl = pm._el('realtime-peak-freq');
                const peakLevelEl = pm._el('realtime-peak-level');

                if (rmsEl) rmsEl.textContent = analysis.details.rmsDb + ' dB';
                if (crestEl) crestEl.textContent = analysis.details.crestFactor + ' dB';
                if (peakFreqEl) peakFreqEl.textContent = analysis.details.peakHz + ' Hz';
                if (peakLevelEl) peakLevelEl.textContent = analysis.details.peakDb + ' dB';

                const reportCard = pm._el('pink-report-card');
                if (analysis.pinkReport && reportCard) {
                    reportCard.classList.remove('hidden');
                    const summaryEl = pm._el('pink-report-summary');
                    const lowEl = pm._el('pink-report-low');
                    const midEl = pm._el('pink-report-mid');
                    const highEl = pm._el('pink-report-high');

                    if (summaryEl) summaryEl.textContent = analysis.pinkReport.summary;
                    if (lowEl) lowEl.textContent = analysis.pinkReport.details.averages.low + ' dB';
                    if (midEl) midEl.textContent = analysis.pinkReport.details.averages.mid + ' dB';
                    if (highEl) highEl.textContent = analysis.pinkReport.details.averages.high + ' dB';
                } else if (reportCard) {
                    reportCard.classList.add('hidden');
                }
            }
        } else {
            panel.classList.add('hidden');
        }
    }

    function updateButtonStates() {
        const gen = window.SignalGeneratorController;
        if (!gen) return;

        const pinkBtn = pm._el('btn-pink-noise');
        const whiteBtn = pm._el('btn-white-noise');
        const mlsBtn = pm._el('btn-mls-signal');
        const chirpBtn = pm._el('btn-chirp-signal');
        const dualBtn = pm._el('btn-dual-tone');
        const sineBtn = pm._el('btn-sine-wave');
        const blBtn = pm._el('btn-bandlimited-noise');

        // Reset all active classes
        if (pinkBtn) {
            pinkBtn.classList.toggle('bg-red-600', gen.isPinkNoisePlaying());
            pinkBtn.classList.toggle('text-white', gen.isPinkNoisePlaying());
        }
        if (whiteBtn) {
            whiteBtn.classList.toggle('bg-slate-400', gen.isWhiteNoisePlaying());
            whiteBtn.classList.toggle('text-black', gen.isWhiteNoisePlaying());
        }
        if (mlsBtn) {
            mlsBtn.classList.toggle('bg-amber-600', gen.isMLSPlaying());
            mlsBtn.classList.toggle('text-white', gen.isMLSPlaying());
        }
        if (chirpBtn) {
            chirpBtn.classList.toggle('bg-amber-600', gen.isChirpPlaying());
            chirpBtn.classList.toggle('text-white', gen.isChirpPlaying());
        }
        if (dualBtn) {
            dualBtn.classList.toggle('bg-cyan-600', gen.isDualTonePlaying());
            dualBtn.classList.toggle('text-white', gen.isDualTonePlaying());
        }
        if (sineBtn) {
            sineBtn.classList.toggle('bg-cyan-600', gen.isSineWavePlaying());
            sineBtn.classList.toggle('text-white', gen.isSineWavePlaying());
            sineBtn.innerText = gen.isSineWavePlaying() ? '⏹ Parar Senoidal' : '🎵 Tom Senoidal';
        }
        if (blBtn) {
            blBtn.classList.toggle('bg-cyan-700', gen.isBandLimitedPlaying());
            blBtn.classList.toggle('text-white', gen.isBandLimitedPlaying());
            blBtn.innerText = gen.isBandLimitedPlaying() ? '⏹ Parar' : '▶ Tocar';
        }
    }

    function toggleSignal(type, startFn) {
        const gen = window.SignalGeneratorController;
        if (!gen) return;

        let currentlyPlaying = false;
        switch (type) {
            case 'pink': currentlyPlaying = gen.isPinkNoisePlaying(); break;
            case 'white': currentlyPlaying = gen.isWhiteNoisePlaying(); break;
            case 'mls': currentlyPlaying = gen.isMLSPlaying(); break;
            case 'chirp': currentlyPlaying = gen.isChirpPlaying(); break;
            case 'dual': currentlyPlaying = gen.isDualTonePlaying(); break;
            case 'sine': currentlyPlaying = gen.isSineWavePlaying(); break;
            case 'bandlimited': currentlyPlaying = gen.isBandLimitedPlaying(); break;
        }

        // Stop all first to prevent overlapping signals
        gen.stopAll();

        if (!currentlyPlaying) {
            // Start the selected signal
            startFn();
        }

        updateButtonStates();
    }

    function init() {
        if (window.MixerAudioSource) {
            window.MixerAudioSource.init();
        }

        const gen = window.SignalGeneratorController;
        if (!gen) {
            console.error('[AnalyzerSignalsPage] SignalGeneratorController not found.');
            return;
        }

        var levelSlider = pm._el('signal-level-slider');
        var levelVal = pm._el('signal-level-val');
        if (levelSlider && levelVal) {
            pm._on(levelSlider, 'input', function () {
                levelVal.textContent = this.value + ' dB';
                if (gen.setGlobalLevel) gen.setGlobalLevel(Number(this.value));
            });
        }

        var sineLevel = pm._el('sine-level');
        var sineLevelVal = pm._el('sine-level-val');
        if (sineLevel && sineLevelVal) {
            pm._on(sineLevel, 'input', function () {
                sineLevelVal.textContent = this.value + 'dB';
            });
        }

        document.querySelectorAll('.sine-preset').forEach(function (btn) {
            pm._on(btn, 'click', function () {
                var freq = this.getAttribute('data-freq');
                var freqInput = pm._el('sine-freq');
                if (freqInput) freqInput.value = freq;
                var sineBtn = pm._el('btn-sine-wave');
                if (sineBtn) sineBtn.click();
            });
        });

        // Binds
        pm._on(pm._el('btn-pink-noise'), 'click', () => {
            toggleSignal('pink', () => gen.startPinkNoise(false));
        });

        pm._on(pm._el('btn-white-noise'), 'click', () => {
            toggleSignal('white', () => gen.startWhiteNoise(0.3));
        });

        pm._on(pm._el('btn-mls-signal'), 'click', () => {
            toggleSignal('mls', () => gen.startMLS(13, 0.5));
        });

        pm._on(pm._el('btn-chirp-signal'), 'click', () => {
            toggleSignal('chirp', () => gen.startChirp(20, 20000, 2.0, 0.5));
        });

        pm._on(pm._el('btn-dual-tone'), 'click', () => {
            toggleSignal('dual', () => gen.startDualTone(1000, 1500, 0.3));
        });

        pm._on(pm._el('btn-sine-wave'), 'click', () => {
            const freqInput = pm._el('sine-freq');
            const freq = parseFloat(freqInput ? freqInput.value : 1000) || 1000;
            const levelSlider = pm._el('sine-level');
            const levelDb = levelSlider ? Number(levelSlider.value) : -20;
            const amplitude = Math.pow(10, levelDb / 20);
            toggleSignal('sine', () => gen.startSine(freq, amplitude));
        });

        pm._on(pm._el('btn-bandlimited-noise'), 'click', () => {
            const type = (pm._el('bl-noise-type')?.value) || 'pink';
            const freq = Number(pm._el('bl-noise-freq')?.value) || 1000;
            const band = Number(pm._el('bl-noise-band')?.value) || 0.333;
            const amp = 0.25;
            toggleSignal('bandlimited', () => gen.startBandLimitedNoise(type, freq, band, amp));
        });

        pm._on(pm._el('btn-measure-pink'), 'click', () => {
            if (window.SoundMasterAnalyzer) {
                if (typeof SoundMasterAnalyzer.startPinkNoiseMeasurement === 'function') {
                    SoundMasterAnalyzer.startPinkNoiseMeasurement();
                } else {
                    console.log('[AnalyzerSignalsPage] startPinkNoiseMeasurement fallback.');
                    alert('Mediçao de Ruído Rosa requer o Analisador ativo.');
                }
            }
        });

        pm._on(pm._el('btn-log-sweep'), 'click', () => {
            if (window.SoundMasterAnalyzer && typeof SoundMasterAnalyzer.triggerImpulse === 'function') {
                SoundMasterAnalyzer.triggerImpulse();
            }
        });

        // Initialize state of buttons (if any are already playing in background)
        updateButtonStates();

        if (!_pollingInterval) {
            _pollingInterval = setInterval(_pollRealtimeData, 100);
        }
    }

    function destroy() {
        if (_pollingInterval) {
            clearInterval(_pollingInterval);
            _pollingInterval = null;
        }
        const gen = window.SignalGeneratorController;
        if (gen) {
            gen.stopAll();
        }
        if (window.SoundMasterAnalyzer && window.SoundMasterAnalyzer.isAnalyzing()) {
            window.SoundMasterAnalyzer.stop();
        }
        pm.destroy();
    }

    window.AnalyzerSignalsPage = {
        init: init,
        destroy: destroy
    };
})();
