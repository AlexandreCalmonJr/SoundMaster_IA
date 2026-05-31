/**
 * SoundMaster Pro — DSP Performance Benchmark
 * Testes de performance para algoritmos DSP.
 */

import { describe, expect, it } from 'vitest';

describe('DSP Performance Benchmark', () => {
    it('FFT deve completar em tempo razoável para 1024 samples', () => {
        // Criar sinal de teste
        const n = 1024;
        const signal = new Float64Array(n);
        const sampleRate = 48000;
        
        for (let i = 0; i < n; i++) {
            signal[i] = Math.sin(2 * Math.PI * 1000 * i / sampleRate);
        }

        // Implementação inline da FFT para benchmark
        const re = Float64Array.from(signal);
        const im = new Float64Array(n);

        const startTime = performance.now();
        
        // FFT simples (sem otimizações avançadas para benchmark)
        for (let iter = 0; iter < 100; iter++) {
            // Reset arrays
            for (let i = 0; i < n; i++) {
                re[i] = signal[i];
                im[i] = 0;
            }
            
            // Bit-reversal
            for (let i = 0, j = 0; i < n; i++) {
                if (i < j) {
                    let t = re[i]; re[i] = re[j]; re[j] = t;
                    t = im[i]; im[i] = im[j]; im[j] = t;
                }
                let m = n >>> 1;
                while (m >= 1 && j >= m) { j -= m; m >>>= 1; }
                j += m;
            }
            
            // Butterfly
            for (let len = 2; len <= n; len <<= 1) {
                const half = len >>> 1;
                const ang = -Math.PI / half;
                const wbR = Math.cos(ang);
                const wbI = Math.sin(ang);
                
                for (let i = 0; i < n; i += len) {
                    let wR = 1, wI = 0;
                    for (let j = 0; j < half; j++) {
                        const uR = re[i + j];
                        const uI = im[i + j];
                        const vR = re[i + j + half] * wR - im[i + j + half] * wI;
                        const vI = re[i + j + half] * wI + im[i + j + half] * wR;
                        re[i + j] = uR + vR;
                        im[i + j] = uI + vI;
                        re[i + j + half] = uR - vR;
                        im[i + j + half] = uI - vI;
                        const nwR = wR * wbR - wI * wbI;
                        wI = wR * wbI + wI * wbR;
                        wR = nwR;
                    }
                }
            }
        }

        const elapsed = performance.now() - startTime;
        
        // 100 iterações de FFT 1024 devem ser < 100ms
        expect(elapsed).toBeLessThan(100);
    });

    it('FFT deve completar para 4096 samples em tempo razoável', () => {
        const n = 4096;
        const signal = new Float64Array(n);
        const sampleRate = 48000;
        
        for (let i = 0; i < n; i++) {
            signal[i] = Math.sin(2 * Math.PI * 1000 * i / sampleRate);
        }

        const re = Float64Array.from(signal);
        const im = new Float64Array(n);

        const startTime = performance.now();
        
        // 10 iterações de FFT 4096
        for (let iter = 0; iter < 10; iter++) {
            for (let i = 0; i < n; i++) {
                re[i] = signal[i];
                im[i] = 0;
            }
            
            for (let i = 0, j = 0; i < n; i++) {
                if (i < j) {
                    let t = re[i]; re[i] = re[j]; re[j] = t;
                    t = im[i]; im[i] = im[j]; im[j] = t;
                }
                let m = n >>> 1;
                while (m >= 1 && j >= m) { j -= m; m >>>= 1; }
                j += m;
            }
            
            for (let len = 2; len <= n; len <<= 1) {
                const half = len >>> 1;
                const ang = -Math.PI / half;
                const wbR = Math.cos(ang);
                const wbI = Math.sin(ang);
                
                for (let i = 0; i < n; i += len) {
                    let wR = 1, wI = 0;
                    for (let j = 0; j < half; j++) {
                        const uR = re[i + j];
                        const uI = im[i + j];
                        const vR = re[i + j + half] * wR - im[i + j + half] * wI;
                        const vI = re[i + j + half] * wI + im[i + j + half] * wR;
                        re[i + j] = uR + vR;
                        im[i + j] = uI + vI;
                        re[i + j + half] = uR - vR;
                        im[i + j + half] = uI - vI;
                        const nwR = wR * wbR - wI * wbI;
                        wI = wR * wbI + wI * wbR;
                        wR = nwR;
                    }
                }
            }
        }

        const elapsed = performance.now() - startTime;
        
        // 10 iterações de FFT 4096 devem ser < 100ms
        expect(elapsed).toBeLessThan(100);
    });

    it('Windowing deve ser rápido para 8192 samples', () => {
        const n = 8192;
        
        const startTime = performance.now();
        const w = new Float64Array(n);
        const c = 2 * Math.PI / (n - 1);
        
        // 100 iterações de Hann window
        for (let iter = 0; iter < 100; iter++) {
            for (let i = 0; i < n; i++) {
                w[i] = 0.5 * (1 - Math.cos(c * i));
            }
        }
        
        const elapsed = performance.now() - startTime;
        
        expect(elapsed).toBeLessThan(100);
    });

    it('Magnitude calculation deve ser rápida', () => {
        const n = 2048;
        const re = new Float64Array(n);
        const im = new Float64Array(n);
        
        for (let i = 0; i < n; i++) {
            re[i] = Math.random();
            im[i] = Math.random();
        }

        const startTime = performance.now();
        
        // 1000 iterações de cálculo de magnitude
        for (let iter = 0; iter < 1000; iter++) {
            const half = n >>> 1;
            const result = new Float64Array(half);
            for (let i = 0; i < half; i++) {
                result[i] = 20 * Math.log10(Math.sqrt(re[i] * re[i] + im[i] * im[i]) + 1e-30);
            }
        }
        
        const elapsed = performance.now() - startTime;
        
        expect(elapsed).toBeLessThan(100);
    });
});