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

    let isPinkNoisePlaying = false;
    let isWhiteNoisePlaying = false;
    let isMLSPlaying = false;
    let isChirpPlaying = false;
    let isDualTonePlaying = false;
    let isSineWavePlaying = false;

    function _getAudioCtx() {
        if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.getAudioContext === 'function') {
            const ctx = window.SoundMasterAnalyzer.getAudioContext();
            if (ctx) return ctx;
        }
        if (!localAudioCtx) {
            localAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
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
            setTimeout(() => {
                stopPinkNoise();
            }, durationMs);
        }
    }

    function stopPinkNoise() {
        if (pinkNoiseNode) {
            try { pinkNoiseNode.disconnect(); } catch (_) {}
        }
        isPinkNoisePlaying = false;
        console.log('[SignalGenerator] Pink noise stopped');
    }

    async function startWhiteNoise(amplitude = 0.3) {
        const audioCtx = _getAudioCtx();
        try {
            await audioCtx.audioWorklet.addModule('js/core/signal-generators.js');
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
            try { whiteNoiseNode.disconnect(); } catch (_) {}
            whiteNoiseNode = null;
        }
        isWhiteNoisePlaying = false;
        console.log('[SignalGenerator] White noise stopped');
    }

    async function startMLS(order = 13, amplitude = 0.5) {
        const audioCtx = _getAudioCtx();
        try {
            await audioCtx.audioWorklet.addModule('js/core/signal-generators.js');
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
            try { mlsNode.disconnect(); } catch (_) {}
            mlsNode = null;
        }
        isMLSPlaying = false;
        console.log('[SignalGenerator] MLS stopped');
    }

    async function startChirp(startFreq = 20, endFreq = 20000, duration = 2.0, amplitude = 0.5) {
        const audioCtx = _getAudioCtx();
        try {
            await audioCtx.audioWorklet.addModule('js/core/signal-generators.js');
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
            try { chirpNode.disconnect(); } catch (_) {}
            chirpNode = null;
        }
        isChirpPlaying = false;
        console.log('[SignalGenerator] Chirp stopped');
    }

    async function startDualTone(freq1 = 1000, freq2 = 1500, amplitude = 0.3) {
        const audioCtx = _getAudioCtx();
        try {
            await audioCtx.audioWorklet.addModule('js/core/signal-generators.js');
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
            try { dualToneNode.disconnect(); } catch (_) {}
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
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = amplitude;
        sineWaveNode.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        sineWaveNode.start();
        isSineWavePlaying = true;
        console.log(`[SignalGenerator] Sine wave started at ${freq}Hz`);
    }

    function stopSine() {
        if (sineWaveNode) {
            try {
                sineWaveNode.stop();
                sineWaveNode.disconnect();
            } catch (_) {}
            sineWaveNode = null;
        }
        isSineWavePlaying = false;
        console.log('[SignalGenerator] Sine wave stopped');
    }

    function stopAll() {
        stopPinkNoise();
        stopWhiteNoise();
        stopMLS();
        stopChirp();
        stopDualTone();
        stopSine();
    }

    function isPlayingAny() {
        return isPinkNoisePlaying || isWhiteNoisePlaying || isMLSPlaying || isChirpPlaying || isDualTonePlaying || isSineWavePlaying;
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
        stopAll,
        isPlayingAny,
        isPinkNoisePlaying: () => isPinkNoisePlaying,
        isWhiteNoisePlaying: () => isWhiteNoisePlaying,
        isMLSPlaying: () => isMLSPlaying,
        isChirpPlaying: () => isChirpPlaying,
        isDualTonePlaying: () => isDualTonePlaying,
        isSineWavePlaying: () => isSineWavePlaying
    };

    console.log('[SignalGeneratorController] Carregado.');
})();
