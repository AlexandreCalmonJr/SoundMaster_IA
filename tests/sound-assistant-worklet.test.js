import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKLET_PATH = resolve(process.cwd(), 'frontend/js/core/audio-processor.js');
const MIN_WORKLET_PATH = resolve(process.cwd(), 'frontend/js/core/min/audio-processor.js');

describe('SoundMasterProcessor — stereo shadow telemetry', () => {
    afterEach(() => {
        delete globalThis.AudioWorkletProcessor;
        delete globalThis.registerProcessor;
    });

    it('reports independent L/R peaks without executing any action', () => {
        const messages = [];
        const registered = {};
        globalThis.AudioWorkletProcessor = class {
            constructor() {
                this.port = { postMessage: (message) => messages.push(message) };
            }
        };
        globalThis.registerProcessor = (name, klass) => { registered[name] = klass; };

        const code = readFileSync(WORKLET_PATH, 'utf8');
        new Function(code)();
        const Processor = registered['soundmaster-processor'];
        const processor = new Processor();

        for (let block = 0; block < 32; block++) {
            const left = new Float32Array(128).fill(0.25);
            const right = new Float32Array(128).fill(block === 31 ? 0.99 : 0.5);
            processor.process([[left, right]], [[]], {});
        }

        const meter = messages.find((message) => message.type === 'meter-frame');
        expect(meter).toBeDefined();
        expect(meter.peakL).toBeCloseTo(0.25, 4);
        expect(meter.peakR).toBeCloseTo(0.99, 4);
        expect(meter.rmsR).toBeGreaterThan(meter.rmsL);
        expect(meter.sampleCount).toBe(4096);
    });

    it('keeps stereo telemetry in the minified production worklet', () => {
        const messages = [];
        const registered = {};
        globalThis.AudioWorkletProcessor = class {
            constructor() {
                this.port = { postMessage: (message) => messages.push(message) };
            }
        };
        globalThis.registerProcessor = (name, klass) => { registered[name] = klass; };

        new Function(readFileSync(MIN_WORKLET_PATH, 'utf8'))();
        const processor = new registered['soundmaster-processor']();
        for (let block = 0; block < 32; block++) {
            processor.process([[
                new Float32Array(128).fill(0.2),
                new Float32Array(128).fill(block === 31 ? 0.99 : 0.45)
            ]], [[]], {});
        }
        const meter = messages.find((message) => message.type === 'meter-frame');
        expect(meter).toBeDefined();
        expect(meter.peakR).toBeCloseTo(0.99, 4);
        expect(meter.sampleCount).toBe(4096);
    });
});
