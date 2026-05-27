import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CB_PATH = resolve(process.cwd(), 'frontend/js/core/circuit-breaker.js');
const AI_PATH = resolve(process.cwd(), 'frontend/js/services/ai.service.js');

function loadModules(mockFetch) {
    globalThis.window = globalThis;
    globalThis.console = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    globalThis.fetch = mockFetch;

    const _state = {
        aiStatus: 'offline',
        mixerConnected: false,
        masterLevel: 0,
        masterDb: null,
        masterMute: false,
        vuData: {},
        aiSessionId: 'test-session',
    };
    globalThis.AppStore = {
        getState: vi.fn(() => ({ ..._state })),
        setState: vi.fn((patch) => Object.assign(_state, patch)),
        addLog: vi.fn(),
        addAISuggestion: vi.fn(),
    };

    globalThis.SimulationService = {
        isRunning: vi.fn(() => false),
        askAI: vi.fn(),
    };

    globalThis.SoundMasterAnalyzer = null;

    delete globalThis.CircuitBreaker;
    const cbCode = readFileSync(CB_PATH, 'utf8');
    new Function('globalThis', 'var window = globalThis.window; ' + cbCode)(globalThis);

    delete globalThis.AIService;
    const aiCode = readFileSync(AI_PATH, 'utf8');
    new Function('globalThis', 'var window = globalThis.window; var AppStore = globalThis.AppStore; ' + aiCode)(globalThis);

    return globalThis.AIService;
}

describe('AIService', () => {
    let ai;

    afterEach(() => {
        delete globalThis.AIService;
        delete globalThis.CircuitBreaker;
        delete globalThis.AppStore;
        delete globalThis.SimulationService;
        delete globalThis.SoundMasterAnalyzer;
        delete globalThis.window;
        delete globalThis.fetch;
    });

    describe('_buildMessage (via ask)', () => {
        it('appends channel number when not specified', async () => {
            let capturedBody;
            const mockFetch = vi.fn(async (url, opts) => {
                capturedBody = JSON.parse(opts.body);
                return Promise.reject(new Error('fail'));
            });
            ai = loadModules(mockFetch);
            await ai.ask('voz abafada', 3).catch(() => {});
            expect(capturedBody.message).toBe('voz abafada canal 3');
        });

        it('does not duplicate channel when already in message', async () => {
            let capturedBody;
            const mockFetch = vi.fn(async (url, opts) => {
                capturedBody = JSON.parse(opts.body);
                return Promise.reject(new Error('fail'));
            });
            ai = loadModules(mockFetch);
            await ai.ask('canal 5 está baixo', 3).catch(() => {});
            expect(capturedBody.message).toBe('canal 5 está baixo');
        });

        it('does not duplicate "ch" prefix channel', async () => {
            let capturedBody;
            const mockFetch = vi.fn(async (url, opts) => {
                capturedBody = JSON.parse(opts.body);
                return Promise.reject(new Error('fail'));
            });
            ai = loadModules(mockFetch);
            await ai.ask('ch 2 sem som', 1).catch(() => {});
            expect(capturedBody.message).toBe('ch 2 sem som');
        });

        it('defaults to channel 1 for invalid numbers', async () => {
            let capturedBody;
            const mockFetch = vi.fn(async (url, opts) => {
                capturedBody = JSON.parse(opts.body);
                return Promise.reject(new Error('fail'));
            });
            ai = loadModules(mockFetch);
            await ai.ask('teste', NaN).catch(() => {});
            expect(capturedBody.message).toBe('teste canal 1');
        });

        it('clamps channel to 1-24 range', async () => {
            let capturedBody;
            const mockFetch = vi.fn(async (url, opts) => {
                capturedBody = JSON.parse(opts.body);
                return Promise.reject(new Error('fail'));
            });
            ai = loadModules(mockFetch);
            await ai.ask('teste', 99).catch(() => {});
            expect(capturedBody.message).toBe('teste canal 1');
        });
    });

    describe('_getMixerSnapshot (via ask)', () => {
        it('includes mixer context in fetch body', async () => {
            let capturedBody;
            const mockFetch = vi.fn(async (url, opts) => {
                capturedBody = JSON.parse(opts.body);
                return Promise.reject(new Error('fail'));
            });
            ai = loadModules(mockFetch);
            await ai.ask('teste', 1).catch(() => {});
            expect(capturedBody.mixer_context).toHaveProperty('selectedChannel');
            expect(capturedBody.mixer_context).toHaveProperty('channel');
            expect(capturedBody.mixer_context).toHaveProperty('aux_sends');
            expect(capturedBody.mixer_context).toHaveProperty('master');
            expect(capturedBody.mixer_context).toHaveProperty('all_vus');
        });

        it('includes master state in mixer context', async () => {
            let capturedBody;
            const mockFetch = vi.fn(async (url, opts) => {
                capturedBody = JSON.parse(opts.body);
                return Promise.reject(new Error('fail'));
            });
            ai = loadModules(mockFetch);
            await ai.ask('teste', 1).catch(() => {});
            expect(capturedBody.mixer_context.master).toHaveProperty('level');
            expect(capturedBody.mixer_context.master).toHaveProperty('mute');
        });
    });

    describe('ask', () => {
        it('returns fallback text when fetch fails and simulation is off', async () => {
            const mockFetch = vi.fn(() => Promise.reject(new Error('Network error')));
            ai = loadModules(mockFetch);

            const result = await ai.ask('voz abafada', 1);

            expect(result).toHaveProperty('text');
            expect(result.text).toContain('offline');
            expect(result.command).toBeNull();
        });

        it('returns simulation result when fetch fails and simulation is on', async () => {
            const mockFetch = vi.fn(() => Promise.reject(new Error('Network error')));
            ai = loadModules(mockFetch);
            SimulationService.isRunning.mockReturnValue(true);
            SimulationService.askAI.mockResolvedValue({ text: 'simulado', command: { desc: 'test' } });

            const result = await ai.ask('voz abafada', 1);

            expect(result.text).toBe('simulado');
            expect(SimulationService.askAI).toHaveBeenCalled();
        });

        it('sets aiStatus to loading during request', async () => {
            const mockFetch = vi.fn(() => Promise.reject(new Error('fail')));
            ai = loadModules(mockFetch);

            await ai.ask('teste', 1);
            expect(AppStore.setState).toHaveBeenCalledWith({ aiStatus: 'loading' });
        });

        it('circuit breaker opens after 3 failures', async () => {
            const mockFetch = vi.fn(() => Promise.reject(new Error('fail')));
            ai = loadModules(mockFetch);

            await ai.ask('t1', 1);
            await ai.ask('t2', 1);
            await ai.ask('t3', 1);

            expect(mockFetch).toHaveBeenCalledTimes(3);
            await ai.ask('t4', 1);
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });
    });

    describe('ping', () => {
        it('returns false when health endpoint returns error', async () => {
            const mockFetch = vi.fn(() => Promise.resolve({ ok: false }));
            ai = loadModules(mockFetch);

            const result = await ai.ping();
            expect(result).toBe(false);
        });

        it('returns true when health endpoint succeeds', async () => {
            const mockFetch = vi.fn(() => Promise.resolve({ ok: true }));
            ai = loadModules(mockFetch);

            const result = await ai.ping();
            expect(result).toBe(true);
        });

        it('returns true when simulation is running even if fetch fails', async () => {
            const mockFetch = vi.fn(() => Promise.reject(new Error('offline')));
            ai = loadModules(mockFetch);
            SimulationService.isRunning.mockReturnValue(true);

            const result = await ai.ping();
            expect(result).toBe(true);
        });
    });

    describe('calculateAcoustics', () => {
        it('returns null from fallback after circuit opens (3 failures)', async () => {
            const mockFetch = vi.fn(() => Promise.reject(new Error('fail')));
            ai = loadModules(mockFetch);

            // Primeiras 3 chamadas: circuito CLOSED → OPEN cada uma rejeita
            await expect(ai.calculateAcoustics(100, 200, 0.15)).rejects.toThrow('fail');
            await expect(ai.calculateAcoustics(100, 200, 0.15)).rejects.toThrow('fail');
            await expect(ai.calculateAcoustics(100, 200, 0.15)).rejects.toThrow('fail');

            // 4ª chamada: circuito OPEN → fallback retorna null
            const result = await ai.calculateAcoustics(100, 200, 0.15);
            expect(result).toBeNull();
        });
    });

    describe('classifyAudio', () => {
        it('returns empty classification from fallback after circuit opens', async () => {
            const mockFetch = vi.fn(() => Promise.reject(new Error('fail')));
            ai = loadModules(mockFetch);

            await expect(ai.classifyAudio([1, 2, 3], 48000)).rejects.toThrow('fail');
            await expect(ai.classifyAudio([1, 2, 3], 48000)).rejects.toThrow('fail');
            await expect(ai.classifyAudio([1, 2, 3], 48000)).rejects.toThrow('fail');

            const result = await ai.classifyAudio([1, 2, 3], 48000);
            expect(result).toEqual({ classes: [], topClass: null, topScore: null });
        });
    });

    describe('_getLiveAnalysis (via ask)', () => {
        it('does not include live_mic when no analyzer available', async () => {
            let capturedAnalysis;
            const mockFetch = vi.fn(async (url, opts) => {
                const body = JSON.parse(opts.body);
                capturedAnalysis = body.analysis;
                return Promise.reject(new Error('fail'));
            });
            ai = loadModules(mockFetch);
            await ai.ask('teste', 1).catch(() => {});
            expect(capturedAnalysis.live_mic).toBeUndefined();
        });

        it('includes live_mic when analyzer is active', async () => {
            let capturedAnalysis;
            const mockFetch = vi.fn(async (url, opts) => {
                const body = JSON.parse(opts.body);
                capturedAnalysis = body.analysis;
                return Promise.reject(new Error('fail'));
            });
            ai = loadModules(mockFetch);
            SoundMasterAnalyzer = {
                isAnalyzing: vi.fn(() => true),
                getLastAnalysis: vi.fn(() => ({
                    text: 'SPL 75dB',
                    details: { peakHz: 100, peakDb: -12, rmsDb: -20, bands: {}, spectrum_v11: {} }
                }))
            };
            await ai.ask('teste', 1).catch(() => {});
            expect(capturedAnalysis.live_mic).toBeDefined();
            expect(capturedAnalysis.live_mic.live).toBe(true);
            expect(capturedAnalysis.live_mic.summary).toBe('SPL 75dB');
        });
    });
});
