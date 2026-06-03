/**
 * SoundMaster — Signal Generator Controller
 * Manages audio test signals: Pink Noise, White Noise, MLS, Chirp, Dual-Tone, Sine Wave.
 */

'use strict';

(function () {
    let localAudioCtx = null;
    let pinkNoiseNode = null;
    let whiteNoiseNode = null;
    let mlsNode = null;
    let chirpNode = null;
    let dualToneNode = null;
    let sineWaveNode = null;
    let sineWaveGainNode = null;
    let bandLimitedNoiseNode = null;
    let bandLimitedFilter = null;
    let bandLimitedGain = null;
    let _autoStopTimer = null;

    let isPinkNoisePlaying = false;
    let isWhiteNoisePlaying = false;
    let isMLSPlaying = false;
    let isChirpPlaying = false;
    let isDualTonePlaying = false;
    let isSineWavePlaying = false;
    let isBandLimitedPlaying = false;

    function _getAudioCtx() {
        if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.getAudioContext === 'function') {
            const ctx = window.SoundMasterAnalyzer.getAudioContext();
            if (ctx && ctx.state !== 'closed') return ctx;
        }
        if (!localAudioCtx || localAudioCtx.state === 'closed') {
            if (localAudioCtx) { try { localAudioCtx.close(); } catch (_) { console.warn('[SignalGenerator] Error closing old AudioContext'); } }
            localAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (window.MixerAudioSource && typeof window.MixerAudioSource.applyOutputDevice === 'function') {
                window.MixerAudioSource.applyOutputDevice(localAudioCtx).catch(err => {
                    console.warn('[SignalGenerator] Falha ao definir saída de áudio no localAudioCtx:', err.message);
                });
            }
        }
        if (localAudioCtx.state === 'suspended') {
            localAudioCtx.resume();
        }
        return localAudioCtx;
    }

    async function startPinkNoise(autoStop = false, durationMs = 4000) {
        const audioCtx = _getAudioCtx();
        if (!pinkNoiseNode && window.AcousticCalibration) {
            pinkNoiseNode = await AcousticCalibration.createPinkNoiseNode(audioCtx, 0.25);
        }
        if (pinkNoiseNode) {
            pinkNoiseNode.connect(audioCtx.destination);
            isPinkNoisePlaying = true;
            console.log('[SignalGenerator] Pink noise started');
        }

        if (autoStop) {
            if (_autoStopTimer) clearTimeout(_autoStopTimer);
            _autoStopTimer = setTimeout(function () {
                _autoStopTimer = null;
                stopPinkNoise();
            }, durationMs);
        }
    }

    function stopPinkNoise() {
        if (pinkNoiseNode) {
            try { pinkNoiseNode.disconnect(); } catch (_) { console.warn('[SignalGenerator] Error disconnecting pink noise'); }
            pinkNoiseNode = null;
        }
        isPinkNoisePlaying = false;
        console.log('[SignalGenerator] Pink noise stopped');
    }

    async function startWhiteNoise(amplitude = 0.3) {
        stopWhiteNoise();
        const audioCtx = _getAudioCtx();
        try {
            await audioCtx.audioWorklet.addModule('js/core/min/signal-generators.js');
            whiteNoiseNode = new AudioWorkletNode(audioCtx, 'white-noise-processor');
            whiteNoiseNode.parameters.get('amplitude').value = amplitude;
            whiteNoiseNode.connect(audioCtx.destination);
            isWhiteNoisePlaying = true;
            console.log('[SignalGenerator] White noise started');
            return true;
        } catch (e) {
            console.error('[SignalGenerator] White noise failed:', e);
            return false;
        }
    }

    function stopWhiteNoise() {
        if (whiteNoiseNode) {
            try { whiteNoiseNode.disconnect(); } catch (_) { console.warn('[SignalGenerator] Error disconnecting white noise'); }
            whiteNoiseNode = null;
        }
        isWhiteNoisePlaying = false;
        console.log('[SignalGenerator] White noise stopped');
    }

    async function startMLS(order = 13, amplitude = 0.5) {
        stopMLS();
        const audioCtx = _getAudioCtx();
        try {
            await audioCtx.audioWorklet.addModule('js/core/min/signal-generators.js');
            mlsNode = new AudioWorkletNode(audioCtx, 'mls-processor');
            mlsNode.parameters.get('order').value = order;
            mlsNode.parameters.get('amplitude').value = amplitude;
            mlsNode.connect(audioCtx.destination);
            isMLSPlaying = true;
            console.log(`[SignalGenerator] MLS started (order ${order})`);
            return true;
        } catch (e) {
            console.error('[SignalGenerator] MLS failed:', e);
            return false;
        }
    }

    function stopMLS() {
        if (mlsNode) {
            try { mlsNode.disconnect(); } catch (_) { console.warn('[SignalGenerator] Error disconnecting MLS'); }
            mlsNode = null;
        }
        isMLSPlaying = false;
        console.log('[SignalGenerator] MLS stopped');
    }

    async function startChirp(startFreq = 20, endFreq = 20000, duration = 2.0, amplitude = 0.5) {
        stopChirp();
        const audioCtx = _getAudioCtx();
        try {
            await audioCtx.audioWorklet.addModule('js/core/min/signal-generators.js');
            chirpNode = new AudioWorkletNode(audioCtx, 'chirp-processor');
            chirpNode.parameters.get('startFreq').value = startFreq;
            chirpNode.parameters.get('endFreq').value = endFreq;
            chirpNode.parameters.get('duration').value = duration;
            chirpNode.parameters.get('amplitude').value = amplitude;
            chirpNode.connect(audioCtx.destination);
            isChirpPlaying = true;
            console.log(`[SignalGenerator] Chirp started (${startFreq}-${endFreq}Hz)`);
            return true;
        } catch (e) {
            console.error('[SignalGenerator] Chirp failed:', e);
            return false;
        }
    }

    function stopChirp() {
        if (chirpNode) {
            try { chirpNode.disconnect(); } catch (_) { console.warn('[SignalGenerator] Error disconnecting chirp'); }
            chirpNode = null;
        }
        isChirpPlaying = false;
        console.log('[SignalGenerator] Chirp stopped');
    }

    async function startDualTone(freq1 = 1000, freq2 = 1500, amplitude = 0.3) {
        stopDualTone();
        const audioCtx = _getAudioCtx();
        try {
            await audioCtx.audioWorklet.addModule('js/core/min/signal-generators.js');
            dualToneNode = new AudioWorkletNode(audioCtx, 'dual-tone-processor');
            dualToneNode.parameters.get('freq1').value = freq1;
            dualToneNode.parameters.get('freq2').value = freq2;
            dualToneNode.parameters.get('amplitude').value = amplitude;
            dualToneNode.connect(audioCtx.destination);
            isDualTonePlaying = true;
            console.log(`[SignalGenerator] Dual tone started (${freq1} + ${freq2}Hz)`);
            return true;
        } catch (e) {
            console.error('[SignalGenerator] Dual tone failed:', e);
            return false;
        }
    }

    function stopDualTone() {
        if (dualToneNode) {
            try { dualToneNode.disconnect(); } catch (_) { console.warn('[SignalGenerator] Error disconnecting dual tone'); }
            dualToneNode = null;
        }
        isDualTonePlaying = false;
        console.log('[SignalGenerator] Dual tone stopped');
    }

    function startSine(freq = 1000, amplitude = 0.1) {
        const audioCtx = _getAudioCtx();
        if (isSineWavePlaying && sineWaveNode) {
            stopSine();
        }
        sineWaveNode = audioCtx.createOscillator();
        sineWaveNode.type = 'sine';
        sineWaveNode.frequency.value = freq;
        sineWaveGainNode = audioCtx.createGain();
        sineWaveGainNode.gain.value = amplitude;
        sineWaveNode.connect(sineWaveGainNode);
        sineWaveGainNode.connect(audioCtx.destination);
        sineWaveNode.start();
        isSineWavePlaying = true;
        console.log(`[SignalGenerator] Sine wave started at ${freq}Hz`);
    }

    function stopSine() {
        if (sineWaveNode) {
            try {
                sineWaveNode.stop();
                sineWaveNode.disconnect();
            } catch (_) { console.warn('[SignalGenerator] Error stopping sine node'); }
            sineWaveNode = null;
        }
        if (sineWaveGainNode) {
            try {
                sineWaveGainNode.disconnect();
            } catch (_) { console.warn('[SignalGenerator] Error disconnecting sine gain'); }
            sineWaveGainNode = null;
        }
        isSineWavePlaying = false;
        console.log('[SignalGenerator] Sine wave stopped');
    }

    async function startBandLimitedNoise(type, centerFreq, bandOctave, amplitude) {
        const audioCtx = _getAudioCtx();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        stopBandLimitedNoise();

        try {
            if (type === 'pink') {
                if (window.AcousticCalibration) {
                    bandLimitedNoiseNode = await AcousticCalibration.createPinkNoiseNode(audioCtx, 0.25);
                } else {
                    throw new Error('AcousticCalibration not available for pink noise');
                }
            } else {
                await audioCtx.audioWorklet.addModule('js/core/min/signal-generators.js');
                bandLimitedNoiseNode = new AudioWorkletNode(audioCtx, 'white-noise-processor');
                bandLimitedNoiseNode.parameters.get('amplitude').value = amplitude || 0.3;
            }

            bandLimitedFilter = audioCtx.createBiquadFilter();
            bandLimitedFilter.type = 'bandpass';
            bandLimitedFilter.frequency.value = centerFreq;
            // Q = sqrt(2^(bandOctave)) / (2^(bandOctave) - 1) for -3dB bandwidth
            const bw = Math.pow(2, bandOctave);
            bandLimitedFilter.Q.value = Math.sqrt(bw) / (bw - 1);

            bandLimitedGain = audioCtx.createGain();
            bandLimitedGain.gain.value = amplitude || 0.3;

            bandLimitedNoiseNode.connect(bandLimitedFilter);
            bandLimitedFilter.connect(bandLimitedGain);
            bandLimitedGain.connect(audioCtx.destination);
            isBandLimitedPlaying = true;
            console.log(`[SignalGenerator] Band-limited ${type} noise started: ${centerFreq}Hz, ${bandOctave}-octave`);
            return true;
        } catch (e) {
            console.error('[SignalGenerator] Band-limited noise failed:', e);
            return false;
        }
    }

    function stopBandLimitedNoise() {
        if (bandLimitedNoiseNode) {
            try { bandLimitedNoiseNode.disconnect(); } catch (_) { console.warn('[SignalGenerator] Error disconnecting band-limited noise'); }
            bandLimitedNoiseNode = null;
        }
        if (bandLimitedFilter) {
            try { bandLimitedFilter.disconnect(); } catch (_) { console.warn('[SignalGenerator] Error disconnecting band-limited filter'); }
            bandLimitedFilter = null;
        }
        if (bandLimitedGain) {
            try { bandLimitedGain.disconnect(); } catch (_) { console.warn('[SignalGenerator] Error disconnecting band-limited gain'); }
            bandLimitedGain = null;
        }
        isBandLimitedPlaying = false;
        if (_autoStopTimer) { clearTimeout(_autoStopTimer); _autoStopTimer = null; }
        console.log('[SignalGenerator] Band-limited noise stopped');
    }

    function stopAll() {
        stopPinkNoise();
        stopWhiteNoise();
        stopMLS();
        stopChirp();
        stopDualTone();
        stopSine();
        stopBandLimitedNoise();
    }

    function isPlayingAny() {
        return isPinkNoisePlaying || isWhiteNoisePlaying || isMLSPlaying || isChirpPlaying || isDualTonePlaying || isSineWavePlaying || isBandLimitedPlaying;
    }

    window.SignalGeneratorController = {
        startPinkNoise,
        stopPinkNoise,
        startWhiteNoise,
        stopWhiteNoise,
        startMLS,
        stopMLS,
        startChirp,
        stopChirp,
        startDualTone,
        stopDualTone,
        startSine,
        stopSine,
        startBandLimitedNoise,
        stopBandLimitedNoise,
        stopAll,
        isPlayingAny,
        isPinkNoisePlaying: () => isPinkNoisePlaying,
        isWhiteNoisePlaying: () => isWhiteNoisePlaying,
        isMLSPlaying: () => isMLSPlaying,
        isChirpPlaying: () => isChirpPlaying,
        isDualTonePlaying: () => isDualTonePlaying,
        isSineWavePlaying: () => isSineWavePlaying,
        isBandLimitedPlaying: () => isBandLimitedPlaying
    };

    // Ouvir alterações de dispositivo de saída em tempo real
    (window.parent?.document || document).addEventListener('audio_source_changed', async () => {
        if (localAudioCtx && window.MixerAudioSource && typeof window.MixerAudioSource.applyOutputDevice === 'function') {
            await window.MixerAudioSource.applyOutputDevice(localAudioCtx).catch(err => {
                console.warn('[SignalGenerator] Falha ao re-aplicar saída no localAudioCtx:', err.message);
            });
        }
    });

    console.log('[SignalGeneratorController] Carregado.');
})();
