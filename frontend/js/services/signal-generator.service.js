/**
 * SoundMaster — Signal Generator Service
 * Gera sinais de teste de áudio via AudioWorklet.
 *
 * API Pública (window.SignalGeneratorService):
 *   .startWhiteNoise(amplitude) → Promise<boolean>
 *   .stopWhiteNoise()
 *   .startMLS(order, amplitude) → Promise<boolean>
 *   .stopMLS()
 *   .startChirp(startFreq, endFreq, duration, amplitude) → Promise<boolean>
 *   .stopChirp()
 *   .startDualTone(freq1, freq2, amplitude) → Promise<boolean>
 *   .stopDualTone()
 *   .stopAll()
 *   .isPlayingAny() → boolean
 */

'use strict';

(function () {

    let _audioCtx = null;
    let _whiteNoiseNode = null;
    let _pinkNoiseNode = null;
    let _mlsNode = null;
    let _chirpNode = null;
    let _dualToneNode = null;
    let _sineNode = null;

    let _isWhiteNoisePlaying = false;
    let _isPinkNoisePlaying = false;
    let _isMLSPlaying = false;
    let _isChirpPlaying = false;
    let _isDualTonePlaying = false;
    let _isSinePlaying = false;

    function _ensureCtx() {
        if (!_audioCtx || _audioCtx.state === 'closed') {
            if (_audioCtx && _audioCtx.state === 'closed') {
                try { _audioCtx.close(); } catch (_) {}
            }
            _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (_audioCtx.state === 'suspended') {
            _audioCtx.resume();
        }
        return _audioCtx;
    }

    async function _addModule(path) {
        const ctx = _ensureCtx();
        try {
            await ctx.audioWorklet.addModule(path);
        } catch (e) {
            console.warn(`[SignalGenerator] Worklet não disponível: ${path}`, e);
            throw e;
        }
    }

    // ── Pink Noise ──

    async function startPinkNoise(amplitude = 0.3) {
        try {
            await _addModule('js/core/pink-noise-processor.js');
            const ctx = _ensureCtx();
            _pinkNoiseNode = new AudioWorkletNode(ctx, 'pink-noise-processor');
            _pinkNoiseNode.parameters.get('amplitude').value = amplitude;
            _pinkNoiseNode.connect(ctx.destination);
            _isPinkNoisePlaying = true;
            console.log('[SignalGenerator] Pink Noise started');
            return true;
        } catch (e) {
            console.error('[SignalGenerator] Pink Noise failed:', e);
            return false;
        }
    }

    function stopPinkNoise() {
        if (_pinkNoiseNode) {
            try { _pinkNoiseNode.disconnect(); } catch (_) {}
            _pinkNoiseNode = null;
        }
        _isPinkNoisePlaying = false;
    }

    // ── Sine Wave ──

    async function startSine(freq = 1000, amplitude = 0.3) {
        try {
            await _addModule('js/core/signal-generators.js');
            const ctx = _ensureCtx();
            _sineNode = new AudioWorkletNode(ctx, 'sine-processor');
            _sineNode.parameters.get('frequency').value = freq;
            _sineNode.parameters.get('amplitude').value = amplitude;
            _sineNode.connect(ctx.destination);
            _isSinePlaying = true;
            console.log(`[SignalGenerator] Sine started (${freq}Hz)`);
            return true;
        } catch (e) {
            console.error('[SignalGenerator] Sine failed:', e);
            return false;
        }
    }

    function stopSine() {
        if (_sineNode) {
            try { _sineNode.disconnect(); } catch (_) {}
            _sineNode = null;
        }
        _isSinePlaying = false;
    }

    // ── White Noise ──

    async function startWhiteNoise(amplitude = 0.3) {
        try {
            await _addModule('js/core/signal-generators.js');
            const ctx = _ensureCtx();
            _whiteNoiseNode = new AudioWorkletNode(ctx, 'white-noise-processor');
            _whiteNoiseNode.parameters.get('amplitude').value = amplitude;
            _whiteNoiseNode.connect(ctx.destination);
            _isWhiteNoisePlaying = true;
            console.log('[SignalGenerator] White Noise started');
            return true;
        } catch (e) {
            console.error('[SignalGenerator] White Noise failed:', e);
            return false;
        }
    }

    function stopWhiteNoise() {
        if (_whiteNoiseNode) {
            try { _whiteNoiseNode.disconnect(); } catch (_) {}
            _whiteNoiseNode = null;
        }
        _isWhiteNoisePlaying = false;
    }

    // ── MLS ──

    async function startMLS(order = 13, amplitude = 0.5) {
        try {
            await _addModule('js/core/signal-generators.js');
            const ctx = _ensureCtx();
            _mlsNode = new AudioWorkletNode(ctx, 'mls-processor');
            _mlsNode.parameters.get('order').value = order;
            _mlsNode.parameters.get('amplitude').value = amplitude;
            _mlsNode.connect(ctx.destination);
            _isMLSPlaying = true;
            console.log(`[SignalGenerator] MLS started (order ${order})`);
            return true;
        } catch (e) {
            console.error('[SignalGenerator] MLS failed:', e);
            return false;
        }
    }

    function stopMLS() {
        if (_mlsNode) {
            try { _mlsNode.disconnect(); } catch (_) {}
            _mlsNode = null;
        }
        _isMLSPlaying = false;
    }

    // ── Chirp ──

    async function startChirp(startFreq = 20, endFreq = 20000, duration = 2.0, amplitude = 0.5) {
        try {
            await _addModule('js/core/signal-generators.js');
            const ctx = _ensureCtx();
            _chirpNode = new AudioWorkletNode(ctx, 'chirp-processor');
            _chirpNode.parameters.get('startFreq').value = startFreq;
            _chirpNode.parameters.get('endFreq').value = endFreq;
            _chirpNode.parameters.get('duration').value = duration;
            _chirpNode.parameters.get('amplitude').value = amplitude;
            _chirpNode.connect(ctx.destination);
            _isChirpPlaying = true;
            console.log(`[SignalGenerator] Chirp started (${startFreq}-${endFreq}Hz, ${duration}s)`);
            return true;
        } catch (e) {
            console.error('[SignalGenerator] Chirp failed:', e);
            return false;
        }
    }

    function stopChirp() {
        if (_chirpNode) {
            try { _chirpNode.disconnect(); } catch (_) {}
            _chirpNode = null;
        }
        _isChirpPlaying = false;
    }

    // ── Dual Tone ──

    async function startDualTone(freq1 = 1000, freq2 = 1500, amplitude = 0.3) {
        try {
            await _addModule('js/core/signal-generators.js');
            const ctx = _ensureCtx();
            _dualToneNode = new AudioWorkletNode(ctx, 'dual-tone-processor');
            _dualToneNode.parameters.get('freq1').value = freq1;
            _dualToneNode.parameters.get('freq2').value = freq2;
            _dualToneNode.parameters.get('amplitude').value = amplitude;
            _dualToneNode.connect(ctx.destination);
            _isDualTonePlaying = true;
            console.log(`[SignalGenerator] Dual-Tone started (${freq1}Hz + ${freq2}Hz)`);
            return true;
        } catch (e) {
            console.error('[SignalGenerator] Dual-Tone failed:', e);
            return false;
        }
    }

    function stopDualTone() {
        if (_dualToneNode) {
            try { _dualToneNode.disconnect(); } catch (_) {}
            _dualToneNode = null;
        }
        _isDualTonePlaying = false;
    }

    // ── Bulk ──

    function stopAll() {
        stopWhiteNoise();
        stopPinkNoise();
        stopMLS();
        stopChirp();
        stopDualTone();
        stopSine();
    }

    function isPlayingAny() {
        return _isWhiteNoisePlaying || _isPinkNoisePlaying || _isMLSPlaying || _isChirpPlaying || _isDualTonePlaying || _isSinePlaying;
    }

    function getState() {
        return {
            whiteNoise: _isWhiteNoisePlaying,
            pinkNoise: _isPinkNoisePlaying,
            mls: _isMLSPlaying,
            chirp: _isChirpPlaying,
            dualTone: _isDualTonePlaying,
            sine: _isSinePlaying,
        };
    }

    window.SignalGeneratorService = {
        startWhiteNoise,
        stopWhiteNoise,
        startPinkNoise,
        stopPinkNoise,
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
        getState,
    };

    console.log('[SignalGeneratorService] Carregado.');
})();
