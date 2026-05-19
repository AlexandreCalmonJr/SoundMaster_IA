/**
 * SoundMaster — Feedback Detector Service
 * Detecta feedback (microfonia) analisando picos de frequência sustentados.
 *
 * API Pública (window.FeedbackDetectorService):
 *   .analyze(peakHz, peakDb, threshold) → boolean
 *   .getHistory() → array de picos recentes
 *   .reset()
 */

'use strict';

(function () {

    const DEFAULT_BUFFER_SIZE = 15;

    let _history = [];
    let _bufferSize = DEFAULT_BUFFER_SIZE;

    /**
     * Analisa se o pico atual configura feedback real.
     * Feedback real = mesma frequência sustentada por múltiplos frames.
     * Usa tolerância proporcional (razão de freq ±1/6 de oitava).
     *
     * @param {number} peakHz    - frequência do pico dominante
     * @param {number} peakDb    - nível do pico em dB
     * @param {number} threshold - nível mínimo para considerar (default: -20)
     * @returns {boolean}
     */
    function analyze(peakHz, peakDb, threshold = -20) {
        _history.push({ hz: peakHz, db: peakDb });

        if (_history.length > _bufferSize) {
            _history.shift();
        }

        if (_history.length < _bufferSize) return false;

        const avgHz = _history.reduce((s, p) => s + p.hz, 0) / _history.length;

        const allSimilarFreq = _history.every(p =>
            Math.abs(Math.log2(p.hz / avgHz)) < 1 / 6
        );
        const allAboveThreshold = _history.every(p => p.db > threshold);

        return allSimilarFreq && allAboveThreshold;
    }

    function getHistory() {
        return [..._history];
    }

    function reset() {
        _history = [];
    }

    function setBufferSize(size) {
        _bufferSize = Math.max(5, Math.min(60, size));
        if (_history.length > _bufferSize) {
            _history = _history.slice(-_bufferSize);
        }
    }

    window.FeedbackDetectorService = {
        analyze,
        getHistory,
        reset,
        setBufferSize,
    };

    console.log('[FeedbackDetectorService] Carregado.');
})();
