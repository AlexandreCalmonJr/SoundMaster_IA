/**
 * SoundMaster Pro — Signal Generator AudioWorklets
 * ==================================================
 * White Noise, MLS (Maximum Length Sequence), e Chirp/Dual-tone
 * Todos os processadores seguem o protocolo:
 *   port.onmessage: { type: 'set-param', value: ... }
 *   port.postMessage: { type: 'rms', value: ... }
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// WHITE NOISE PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════
class WhiteNoiseProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'amplitude', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
        ];
    }

    constructor() {
        super();
        this._active = true;
        this._ampOverride = null;
        this._seed = Math.random() * 2147483647;

        this.port.onmessage = (e) => {
            if (e.data.type === 'set-active') this._active = !!e.data.value;
            if (e.data.type === 'set-amplitude') this._ampOverride = Math.max(0, Math.min(1, e.data.value));
            if (e.data.type === 'set-seed') this._seed = e.data.value;
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0]?.[0];
        if (!output) return true;

        const amp = this._ampOverride ?? parameters.amplitude[0];

        if (!this._active) {
            output.fill(0);
            return true;
        }

        const len = output.length;
        for (let i = 0; i < len; i++) {
            //LCG pseudo-random (mesma qualidade que Math.random mas reproduzível com seed)
            this._seed = (this._seed * 16807) % 2147483647;
            output[i] = ((this._seed / 2147483647) * 2 - 1) * amp;
        }

        return true;
    }
}
registerProcessor('white-noise-processor', WhiteNoiseProcessor);

// ═══════════════════════════════════════════════════════════════════════════
// MLS PROCESSOR (Maximum Length Sequence)
// ═══════════════════════════════════════════════════════════════════════════
class MLSProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'amplitude', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'order', defaultValue: 13, minValue: 5, maxValue: 18, automationRate: 'k-rate' }
        ];
    }

    constructor() {
        super();
        this._active = true;
        this._ampOverride = null;
        this._order = 13;
        this._register = (1 << this._order) - 1;
        this._state = this._register;

        // Primitive polynomial tap tables (0-indexed from LSB, i.e., bit index)
        this._tapsTable = {
            5:  [4, 2],          // x^5 + x^3 + 1
            6:  [5, 4],          // x^6 + x^5 + 1
            7:  [6, 5],          // x^7 + x^6 + 1
            8:  [7, 5, 4, 3],    // x^8 + x^6 + x^5 + x^4 + 1
            9:  [8, 4],          // x^9 + x^5 + 1
            10: [9, 6],          // x^10 + x^7 + 1
            11: [10, 8],         // x^11 + x^9 + 1
            12: [11, 10, 9, 3],  // x^12 + x^11 + x^10 + x^4 + 1
            13: [12, 11, 10, 7], // x^13 + x^12 + x^11 + x^8 + 1
            14: [13, 12, 11, 1], // x^14 + x^13 + x^12 + x^2 + 1
            15: [14, 13],        // x^15 + x^14 + 1
            16: [15, 14, 12, 3], // x^16 + x^15 + x^13 + x^4 + 1
            17: [16, 13],        // x^17 + x^14 + 1
            18: [17, 10]         // x^18 + x^11 + 1
        };

        this.port.onmessage = (e) => {
            if (e.data.type === 'set-active') this._active = !!e.data.value;
            if (e.data.type === 'set-amplitude') this._ampOverride = Math.max(0, Math.min(1, e.data.value));
            if (e.data.type === 'set-order') {
                this._order = Math.max(5, Math.min(18, e.data.value));
                this._register = (1 << this._order) - 1;
                this._state = this._register;
            }
        };
    }

    _nextBit() {
        const taps = this._tapsTable[this._order] || [this._order - 1, this._order - 2];
        let feedback = 0;
        for (let i = 0; i < taps.length; i++) {
            feedback ^= (this._state >> taps[i]);
        }
        feedback &= 1;
        this._state = ((this._state << 1) | feedback) & this._register;
        return feedback * 2 - 1;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0]?.[0];
        if (!output) return true;

        const amp = this._ampOverride ?? parameters.amplitude[0];

        if (!this._active) {
            output.fill(0);
            return true;
        }

        const len = output.length;
        for (let i = 0; i < len; i++) {
            output[i] = this._nextBit() * amp;
        }

        return true;
    }
}
registerProcessor('mls-processor', MLSProcessor);

// ═══════════════════════════════════════════════════════════════════════════
// CHIRP / DUAL-TONE PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════
class ChirpProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'amplitude', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'startFreq', defaultValue: 20, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
            { name: 'endFreq', defaultValue: 20000, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
            { name: 'duration', defaultValue: 2.0, minValue: 0.1, maxValue: 10.0, automationRate: 'k-rate' }
        ];
    }

    constructor() {
        super();
        this._active = true;
        this._ampOverride = null;
        this._phase = 0; // Cumulative phase accumulator
        this._sampleCount = 0; // Sample counter to track duration for looping
        this._isPlaying = false;
        this._loopMode = true;

        this.port.onmessage = (e) => {
            if (e.data.type === 'set-active') {
                this._active = !!e.data.value;
                if (this._active && !this._isPlaying) {
                    this._phase = 0;
                    this._sampleCount = 0;
                    this._isPlaying = true;
                }
            }
            if (e.data.type === 'set-amplitude') this._ampOverride = Math.max(0, Math.min(1, e.data.value));
            if (e.data.type === 'set-freq-range') {
                this._startFreq = e.data.start || 20;
                this._endFreq = e.data.end || 20000;
            }
            if (e.data.type === 'set-duration') this._duration = e.data.value;
            if (e.data.type === 'trigger') this._trigger();
        };

        this._startFreq = 20;
        this._endFreq = 20000;
        this._duration = 2.0;
    }

    _trigger() {
        this._phase = 0;
        this._sampleCount = 0;
        this._isPlaying = true;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0]?.[0];
        if (!output) return true;

        const amp = this._ampOverride ?? parameters.amplitude[0];
        const startFreq = parameters.startFreq[0];
        const endFreq = parameters.endFreq[0];
        const duration = parameters.duration[0];
        const sr = sampleRate;

        if (!this._active) {
            output.fill(0);
            return true;
        }

        const len = output.length;
        const totalSamples = duration * sr;

        for (let i = 0; i < len; i++) {
            const t = (this._sampleCount % totalSamples) / totalSamples;
            const logFreq = Math.log10(startFreq) + t * (Math.log10(endFreq) - Math.log10(startFreq));
            const freq = Math.pow(10, logFreq);
            
            const phaseInc = 2 * Math.PI * freq / sr;
            output[i] = Math.sin(this._phase) * amp;
            
            this._phase += phaseInc;
            if (this._phase > 2 * Math.PI) {
                this._phase -= 2 * Math.PI;
            }
            
            this._sampleCount++;
        }

        return true;
    }
}
registerProcessor('chirp-processor', ChirpProcessor);

// ═══════════════════════════════════════════════════════════════════════════
// DUAL-TONE PROCESSOR (Two simultaneous tones for IMD testing)
// ═══════════════════════════════════════════════════════════════════════════
class DualToneProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'amplitude', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'freq1', defaultValue: 1000, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
            { name: 'freq2', defaultValue: 1500, minValue: 20, maxValue: 20000, automationRate: 'k-rate' }
        ];
    }

    constructor() {
        super();
        this._active = true;
        this._ampOverride = null;
        this._phase1 = 0;
        this._phase2 = 0;

        this.port.onmessage = (e) => {
            if (e.data.type === 'set-active') this._active = !!e.data.value;
            if (e.data.type === 'set-amplitude') this._ampOverride = Math.max(0, Math.min(1, e.data.value));
            if (e.data.type === 'set-freq1') this._freq1 = e.data.value;
            if (e.data.type === 'set-freq2') this._freq2 = e.data.value;
        };

        this._freq1 = 1000;
        this._freq2 = 1500;
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0]?.[0];
        if (!output) return true;

        const amp = this._ampOverride ?? parameters.amplitude[0];
        const f1 = parameters.freq1[0];
        const f2 = parameters.freq2[0];
        const sr = sampleRate;

        if (!this._active) {
            output.fill(0);
            return true;
        }

        const len = output.length;
        for (let i = 0; i < len; i++) {
            const sample = Math.sin(this._phase1 * 2 * Math.PI * f1 / sr) +
                          Math.sin(this._phase2 * 2 * Math.PI * f2 / sr);
            output[i] = sample * amp;
            this._phase1++;
            this._phase2++;
        }

        return true;
    }
}
registerProcessor('dual-tone-processor', DualToneProcessor);

console.log('[SignalGenerators] Worklets loaded: white-noise, mls, chirp, dual-tone');