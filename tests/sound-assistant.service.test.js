import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVICE_PATH = resolve(process.cwd(), 'frontend/js/services/sound-assistant.service.js');

function loadService() {
    globalThis.window = globalThis;
    globalThis.console = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    globalThis.AppStore = {
        setState: vi.fn(),
    };
    globalThis.SoundMasterToast = {
        showToast: vi.fn(),
    };
    globalThis.CustomEvent = class {
        constructor(type, init) {
            this.type = type;
            this.detail = init?.detail;
        }
    };
    globalThis.dispatchEvent = vi.fn();

    delete globalThis.SoundAssistantService;
    const code = readFileSync(SERVICE_PATH, 'utf8');
    new Function('globalThis', 'var window = globalThis.window; ' + code)(globalThis);
    return globalThis.SoundAssistantService;
}

function frame(timestamp, overrides = {}) {
    return {
        timestamp,
        sourceMode: 'main-lr',
        truePeakDb: -20,
        rmsDb: -35,
        isClipping: false,
        peakHz: 1000,
        peakDb: -60,
        localFloorDb: -65,
        classification: '',
        classificationScore: 0,
        ...overrides,
    };
}

describe('SoundAssistantService — shadow mode', () => {
    let service;

    beforeEach(() => {
        service = loadService();
    });

    afterEach(() => {
        delete globalThis.SoundAssistantService;
        delete globalThis.AppStore;
        delete globalThis.SoundMasterToast;
        delete globalThis.CustomEvent;
        delete globalThis.dispatchEvent;
        delete globalThis.window;
    });

    it('does not alert on an isolated clipping sample', () => {
        service.ingestFrame(frame(100, { isClipping: true, truePeakDb: -0.05 }));
        expect(service.getState().activeCount).toBe(0);
    });

    it('creates a non-executable clipping alert after consecutive frames', () => {
        service.ingestFrame(frame(100, { isClipping: true, truePeakDb: -0.05 }));
        service.ingestFrame(frame(200, { isClipping: true, truePeakDb: -0.04 }));
        service.ingestFrame(frame(300, { isClipping: true, truePeakDb: -0.03 }));

        const state = service.getState();
        expect(state.mode).toBe('shadow');
        expect(state.sourceMode).toBe('main-lr');
        expect(state.activeCount).toBe(1);
        expect(state.alerts[0]).toMatchObject({
            code: 'MAIN_CLIPPING',
            severity: 'critical',
            requiresConfirmation: true,
            executionAllowed: false,
            proposedAction: { executable: false },
        });
        expect(globalThis.AppStore.setState).toHaveBeenCalled();
    });

    it('resolves clipping after the signal remains below the limit', () => {
        service.ingestFrame(frame(100, { isClipping: true, truePeakDb: -0.05 }));
        service.ingestFrame(frame(200, { isClipping: true, truePeakDb: -0.04 }));
        service.ingestFrame(frame(300, { isClipping: true, truePeakDb: -0.03 }));
        service.ingestFrame(frame(3500));

        const alert = service.getAlerts().find((item) => item.code === 'MAIN_CLIPPING');
        expect(alert.status).toBe('resolved');
        expect(service.getState().activeCount).toBe(0);
    });

    it('detects a stable, prominent feedback tone', () => {
        for (let i = 0; i < 9; i++) {
            service.ingestFrame(frame(100 + i * 100, {
                peakHz: 1000 + (i % 2),
                peakDb: -8,
                localFloorDb: -30,
            }));
        }

        const alert = service.getAlerts().find((item) => item.code === 'MAIN_FEEDBACK_RISK');
        expect(alert).toBeDefined();
        expect(alert.confidence).toBeGreaterThanOrEqual(0.82);
        expect(alert.evidence.frequencyHz).toBeCloseTo(1000, 0);
        expect(alert.proposedAction).toMatchObject({
            type: 'apply_eq_cut',
            executable: false,
            parameters: { gainDb: -3, q: 10 },
        });
    });

    it('does not classify moving musical peaks as feedback', () => {
        const frequencies = [250, 500, 900, 1400, 2200, 3500, 6000, 800, 4200, 1200];
        frequencies.forEach((peakHz, index) => {
            service.ingestFrame(frame(100 + index * 100, {
                peakHz,
                peakDb: -8,
                localFloorDb: -30,
            }));
        });

        expect(service.getAlerts().some((item) => item.code === 'MAIN_FEEDBACK_RISK')).toBe(false);
    });

    it('accepts a high-confidence server risk as an alert but never executes it', () => {
        service.ingestServerRisk({ hz: 3150, risk: 0.96, timestamp: 1000 });
        const alert = service.getAlerts()[0];

        expect(alert).toMatchObject({
            code: 'MAIN_FEEDBACK_RISK',
            executionAllowed: false,
            proposedAction: {
                type: 'apply_eq_cut',
                executable: false,
            },
        });
        expect(alert.evidence.frequencyHz).toBe(3150);
    });
});
