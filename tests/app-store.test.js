import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STORE_PATH = resolve(process.cwd(), 'frontend/js/store/app.store.js');

function loadAppStore() {
    globalThis.window = globalThis;
    globalThis.localStorage = {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    };
    globalThis.console = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    globalThis.document = {
        getElementById: vi.fn(() => null),
    };
    globalThis.addEventListener = vi.fn();

    delete globalThis.AppStore;

    const code = readFileSync(STORE_PATH, 'utf8');
    const run = new Function('globalThis', `
        var window = globalThis.window;
        ${code}
    `);
    run(globalThis);

    return globalThis.AppStore;
}

describe('AppStore', () => {
    let store;

    beforeEach(() => {
        store = loadAppStore();
    });

    afterEach(() => {
        delete globalThis.AppStore;
        delete globalThis.window;
        delete globalThis.localStorage;
        delete globalThis.document;
        delete globalThis.addEventListener;
    });

    it('should initialize with default state values', () => {
        const state = store.getState();
        expect(state.mixerConnected).toBe(false);
        expect(state.mixerIp).toBe('10.10.1.1');
        expect(state.userMode).toBe('technician');
        expect(state.muteGroups).toEqual({});
        expect(state.aux_1_delay).toBe(0);
        expect(state.mute_fx_1).toBe(false);
    });

    it('should return a deep clone from getState() to prevent accidental mutations', () => {
        const state1 = store.getState();
        state1.deviceInfo.model = 'Mutated Model';
        
        const state2 = store.getState();
        expect(state2.deviceInfo.model).toBe('Unknown');
    });

    it('should update state and notify subscribers on setState', () => {
        const callback = vi.fn();
        const unsub = store.subscribe('mixerConnected', callback);

        store.setState({ mixerConnected: true });
        
        expect(callback).toHaveBeenCalledWith(true, expect.any(Object));
        expect(store.getState().mixerConnected).toBe(true);

        unsub();
        store.setState({ mixerConnected: false });
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should add entry to mixerLog and limit size to 50 logs', () => {
        for (let i = 0; i < 60; i++) {
            store.addLog(`Message ${i}`);
        }
        const state = store.getState();
        expect(state.mixerLog.length).toBe(50);
        expect(state.mixerLog[0].text).toBe('Message 10');
        expect(state.mixerLog[49].text).toBe('Message 59');
    });

    it('should add entry to aiSuggestions and limit size to 10 suggestions', () => {
        for (let i = 0; i < 15; i++) {
            store.addAISuggestion({ desc: `Suggestion ${i}`, command: {} });
        }
        const state = store.getState();
        expect(state.aiSuggestions.length).toBe(10);
        expect(state.aiSuggestions[0].desc).toBe('Suggestion 14');
        expect(state.aiSuggestions[9].desc).toBe('Suggestion 5');
    });
});
