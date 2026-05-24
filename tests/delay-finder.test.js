import { describe, expect, it } from 'vitest';
import { DelayFinder } from '../frontend/js/core/dsp/delay-finder.js';

describe('DelayFinder', () => {
    const sampleRate = 48000;
    const n = 1024;

    // Helper to generate sine wave signal
    function generateSineWave(freq, sampleRate, length, delaySamples = 0) {
        const signal = new Float64Array(length);
        for (let i = 0; i < length; i++) {
            const t = (i - delaySamples) / sampleRate;
            // Use windowing or just a pure sine wave, but shift correctly
            if (i - delaySamples >= 0 && i - delaySamples < length) {
                signal[i] = Math.sin(2 * Math.PI * freq * t);
            } else {
                signal[i] = 0;
            }
        }
        return signal;
    }

    // Helper to generate white noise signal
    function generateNoise(length, delaySamples = 0) {
        const signal = new Float64Array(length);
        // Seeded or simple Math.random() noise
        // Since we want correlation to be clear, let's generate base noise
        const baseNoise = new Float64Array(length);
        for (let i = 0; i < length; i++) {
            baseNoise[i] = Math.random() * 2 - 1;
        }

        for (let i = 0; i < length; i++) {
            const srcIdx = i - delaySamples;
            if (srcIdx >= 0 && srcIdx < length) {
                signal[i] = baseNoise[srcIdx];
            } else {
                signal[i] = 0;
            }
        }
        return { signal, baseNoise };
    }

    it('should find 0 delay for identical signals', () => {
        const { signal: signalA, baseNoise: signalB } = generateNoise(n, 0);

        const result = DelayFinder.findDelay(signalA, signalB, sampleRate);
        const resultPHAT = DelayFinder.findDelayPHAT(signalA, signalB, sampleRate);

        expect(result.delaySamples).toBe(0);
        expect(result.confidence).toBeGreaterThan(0.8);
        expect(resultPHAT.delaySamples).toBe(0);
    });

    it('should find positive delay correctly', () => {
        const delay = 12;
        const { signal: signalB, baseNoise: signalA } = generateNoise(n, delay);

        const result = DelayFinder.findDelay(signalA, signalB, sampleRate);
        const resultPHAT = DelayFinder.findDelayPHAT(signalA, signalB, sampleRate);

        expect(result.delaySamples).toBe(delay);
        expect(result.confidence).toBeGreaterThan(0.8);
        expect(resultPHAT.delaySamples).toBe(delay);
    });

    it('should find negative delay correctly', () => {
        const delay = -8;
        const { signal: signalB, baseNoise: signalA } = generateNoise(n, delay);

        const result = DelayFinder.findDelay(signalA, signalB, sampleRate);
        const resultPHAT = DelayFinder.findDelayPHAT(signalA, signalB, sampleRate);

        expect(result.delaySamples).toBe(delay);
        expect(result.confidence).toBeGreaterThan(0.8);
        expect(resultPHAT.delaySamples).toBe(delay);
    });

    it('should clamp delay within maxDelay boundaries', () => {
        // maxDelay is Math.min(half, Math.floor(0.05 * sampleRate))
        // For fftSize = nextPow2(1024*2) = 2048, half = 1024.
        // 0.05 * 48000 = 2400. So maxDelay is 1024.
        // Let's create an extreme delay that goes beyond 1024, or let's use a smaller signal length
        // to have a smaller maxDelay.
        // e.g. signal length 128, fftSize = 256, half = 128. maxDelay = 128.
        const length = 128;
        const delay = 200; // larger than half
        const { signal: signalB, baseNoise: signalA } = generateNoise(length, delay);

        const result = DelayFinder.findDelay(signalA, signalB, sampleRate);
        expect(Math.abs(result.delaySamples)).toBeLessThanOrEqual(128);
    });
});
