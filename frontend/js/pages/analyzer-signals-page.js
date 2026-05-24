/**
 * SoundMaster — Analyzer Signals Page Module
 * Controls the signal generator UI and delegates audio generation to SignalGeneratorController.
 */

'use strict';

(function () {
    const pm = createPageModule();

    function updateButtonStates() {
        const gen = window.SignalGeneratorController;
        if (!gen) return;

        const pinkBtn = pm._el('btn-pink-noise');
        const whiteBtn = pm._el('btn-white-noise');
        const mlsBtn = pm._el('btn-mls-signal');
        const chirpBtn = pm._el('btn-chirp-signal');
        const dualBtn = pm._el('btn-dual-tone');
        const sineBtn = pm._el('btn-sine-wave');

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
    }

    function destroy() {
        // Automatically stop all playing signals when navigating away to protect users' ears/equipment
        if (window.SignalGeneratorController) {
            window.SignalGeneratorController.stopAll();
        }
        pm.destroy();
    }

    window.AnalyzerSignalsPage = {
        init: init,
        destroy: destroy
    };
})();
