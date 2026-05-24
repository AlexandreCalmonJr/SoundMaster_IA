import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Helper to load files in a mocked environment
function loadCodeInEnv(filePath, globals = {}) {
    const code = readFileSync(filePath, 'utf8');
    const fullGlobals = {
        globalThis,
        window: globalThis,
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        ...globals
    };
    
    // Assign globals to globalThis so the code can access them
    Object.keys(fullGlobals).forEach(key => {
        globalThis[key] = fullGlobals[key];
    });

    const run = new Function('globalThis', `
        var window = globalThis.window;
        ${Object.keys(globals).map(k => `var ${k} = globalThis.${k};`).join('\n')}
        ${code}
    `);
    run(globalThis);
}

describe('Core DSP & AudioWorklet Modules', () => {
    
    it('FIRConvolution - minimum-phase should not return NaNs', () => {
        // Mock global window object
        globalThis.window = {
            FIRConvolution: null
        };
        globalThis.audioCtx = {
            decodeAudioData: vi.fn()
        };

        const filePath = resolve(process.cwd(), 'frontend/js/core/fir-convolution.js');
        loadCodeInEnv(filePath);

        const FIR = globalThis.window.FIRConvolution;
        expect(FIR).toBeDefined();

        // Impulse response: Delta function (perfect peak at 0, zero elsewhere)
        const ir = new Float32Array(64);
        ir[0] = 1.0;
        ir[1] = 0.5;
        ir[2] = 0.25;

        // Generate inverse filter
        const inv = FIR.generateInverseFilter(ir, 'minimum-phase');
        
        expect(inv).toBeDefined();
        expect(inv.length).toBe(64);
        // Verify no NaN values
        for (let i = 0; i < inv.length; i++) {
            expect(Number.isNaN(inv[i])).toBe(false);
            expect(Number.isFinite(inv[i])).toBe(true);
        }
        
        // Cleanup
        delete globalThis.window;
        delete globalThis.audioCtx;
    });

    it('FIRConvolverProcessor - should convolve circularly without history cutoff', () => {
        // Mock AudioWorklet environment
        globalThis.AudioWorkletProcessor = class {
            constructor() {
                this.port = {
                    onmessage: null,
                    postMessage: () => {}
                };
            }
        };
        const registered = {};
        globalThis.registerProcessor = (name, klass) => {
            registered[name] = klass;
        };

        const filePath = resolve(process.cwd(), 'frontend/js/core/fir-convolver-processor.js');
        loadCodeInEnv(filePath);

        const ProcessorKlass = registered['fir-convolver-processor'];
        expect(ProcessorKlass).toBeDefined();

        const processor = new ProcessorKlass();
        
        // Set IR: h[n] = [1, 0.5, 0.2]
        processor._setIR([1.0, 0.5, 0.2]);

        // Input blocks (size 2)
        // Block 1: [1, 2]
        // y[0] = x[0]*h[0] = 1*1 = 1
        // y[1] = x[1]*h[0] + x[0]*h[1] = 2*1 + 1*0.5 = 2.5
        const input1 = [new Float32Array([1.0, 2.0])];
        const output1 = [new Float32Array(2)];
        
        processor.process([input1], [output1]);
        
        expect(output1[0][0]).toBeCloseTo(1.0, 5);
        expect(output1[0][1]).toBeCloseTo(2.5, 5);

        // Block 2: [3, 4]
        // y[2] = x[2]*h[0] + x[1]*h[1] + x[0]*h[2] = 3*1 + 2*0.5 + 1*0.2 = 3 + 1 + 0.2 = 4.2
        // y[3] = x[3]*h[0] + x[2]*h[1] + x[1]*h[2] = 4*1 + 3*0.5 + 2*0.2 = 4 + 1.5 + 0.4 = 5.9
        const input2 = [new Float32Array([3.0, 4.0])];
        const output2 = [new Float32Array(2)];
        
        processor.process([input2], [output2]);
        
        expect(output2[0][0]).toBeCloseTo(4.2, 5);
        expect(output2[0][1]).toBeCloseTo(5.9, 5);

        // Cleanup
        delete globalThis.AudioWorkletProcessor;
        delete globalThis.registerProcessor;
    });

    it('MLSProcessor - primitive polynomial tap table checking', () => {
        // Mock AudioWorklet environment
        globalThis.AudioWorkletProcessor = class {
            constructor() {
                this.port = {
                    onmessage: null,
                    postMessage: () => {}
                };
            }
        };
        const registered = {};
        globalThis.registerProcessor = (name, klass) => {
            registered[name] = klass;
        };

        const filePath = resolve(process.cwd(), 'frontend/js/core/signal-generators.js');
        loadCodeInEnv(filePath);

        const ProcessorKlass = registered['mls-processor'];
        expect(ProcessorKlass).toBeDefined();

        // Let's test order 5: maximum sequence length is 2^5 - 1 = 31 samples.
        const processor = new ProcessorKlass();
        processor._order = 5;
        processor._register = (1 << 5) - 1;
        processor._state = processor._register;

        const seq = [];
        for (let i = 0; i < 100; i++) {
            seq.push(processor._nextBit());
        }

        // The MLS sequence of order 5 should repeat every 31 samples.
        // Let's verify that seq[i] === seq[i + 31]
        for (let i = 0; i < 50; i++) {
            expect(seq[i]).toBe(seq[i + 31]);
        }

        // Let's test order 6: maximum sequence length is 2^6 - 1 = 63 samples.
        const processor6 = new ProcessorKlass();
        processor6._order = 6;
        processor6._register = (1 << 6) - 1;
        processor6._state = processor6._register;

        const seq6 = [];
        for (let i = 0; i < 200; i++) {
            seq6.push(processor6._nextBit());
        }

        // Verify period is 63
        for (let i = 0; i < 100; i++) {
            expect(seq6[i]).toBe(seq6[i + 63]);
        }

        // Cleanup
        delete globalThis.AudioWorkletProcessor;
        delete globalThis.registerProcessor;
    });

    it('ChirpProcessor - should run without ReferenceError and generate chirp signals', () => {
        // Mock AudioWorklet environment
        globalThis.AudioWorkletProcessor = class {
            constructor() {
                this.port = {
                    onmessage: null,
                    postMessage: () => {}
                };
            }
        };
        globalThis.sampleRate = 48000;
        const registered = {};
        globalThis.registerProcessor = (name, klass) => {
            registered[name] = klass;
        };

        const filePath = resolve(process.cwd(), 'frontend/js/core/signal-generators.js');
        loadCodeInEnv(filePath);

        const ProcessorKlass = registered['chirp-processor'];
        expect(ProcessorKlass).toBeDefined();

        const processor = new ProcessorKlass();

        // Mock parameters
        const parameters = {
            amplitude: [0.5],
            startFreq: [20],
            endFreq: [20000],
            duration: [2.0]
        };

        const inputs = [];
        const outputs = [[new Float32Array(128)]];

        // Run process - shouldn't throw ReferenceError
        let success = false;
        expect(() => {
            success = processor.process(inputs, outputs, parameters);
        }).not.toThrow();

        expect(success).toBe(true);
        // Verify output is populated and bounded
        const chData = outputs[0][0];
        console.log('Chirp output:', Array.from(chData.slice(0, 10)));
        let nonzero = false;
        for (let i = 0; i < 128; i++) {
            expect(Math.abs(chData[i])).toBeLessThanOrEqual(0.5);
            if (chData[i] !== 0) nonzero = true;
        }
        expect(nonzero).toBe(true);

        // Cleanup
        delete globalThis.AudioWorkletProcessor;
        delete globalThis.registerProcessor;
        delete globalThis.sampleRate;
    });
});
