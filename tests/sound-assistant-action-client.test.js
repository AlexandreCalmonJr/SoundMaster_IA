import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVICE_PATH = resolve(process.cwd(), 'frontend/js/services/sound-assistant.service.js');

function loadService() {
    const listeners = {};
    const emitted = [];
    globalThis.window = globalThis;
    globalThis.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    globalThis.AppStore = { setState: vi.fn(), getState: vi.fn(() => ({ mixerConnected: true, masterLevel: 0.7, masterMute: false })) };
    globalThis.SoundMasterToast = { showToast: vi.fn() };
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
    globalThis.dispatchEvent = vi.fn();
    globalThis.SocketService = {
        on: vi.fn((event, callback) => { listeners[event] = callback; }),
        off: vi.fn(),
        emit: vi.fn((event, payload) => { emitted.push({ event, payload }); }),
        isConnected: vi.fn(() => true),
    };

    const code = readFileSync(SERVICE_PATH, 'utf8');
    new Function('globalThis', 'var window = globalThis.window; ' + code)(globalThis);
    globalThis.SoundAssistantService.bindSocket();
    return { service: globalThis.SoundAssistantService, listeners, emitted };
}

afterEach(() => {
    delete globalThis.SoundAssistantService;
    delete globalThis.SocketService;
    delete globalThis.AppStore;
    delete globalThis.SoundMasterToast;
    delete globalThis.CustomEvent;
    delete globalThis.dispatchEvent;
    delete globalThis.localStorage;
    delete globalThis.window;
});

describe('SoundAssistantService action lifecycle', () => {
    it('proposes, confirms and requests undo through separate socket events', () => {
        const { service, listeners, emitted } = loadService();
        const requestId = service.proposeAction({
            action: 'eq_cut', target: 'master', hz: 1000, gain: -3, q: 5, band: 4, desc: 'Notch'
        }, { origin: 'ai-chat', reason: 'Pico persistente' });

        expect(emitted.some((entry) => entry.event === 'sound_assistant_propose_action')).toBe(true);
        expect(service.getActions().find((entry) => entry.clientRequestId === requestId).status).toBe('proposing');

        listeners.sound_assistant_action_pending({
            actionId: '11111111-1111-4111-8111-111111111111',
            clientRequestId: requestId,
            status: 'pending',
            command: { action: 'eq_cut', target: 'master', hz: 1000, gain: -3, q: 5, band: 4 },
            createdAt: 1,
            expiresAt: 999999,
        });
        const actionId = '11111111-1111-4111-8111-111111111111';
        expect(service.confirmAction(actionId)).toBe(true);
        expect(emitted.some((entry) => entry.event === 'sound_assistant_confirm_action' && entry.payload.actionId === actionId)).toBe(true);

        listeners.sound_assistant_action_result({
            actionId,
            status: 'completed',
            command: { action: 'eq_cut' },
            result: 'ok',
            undoAvailable: true,
            createdAt: 1,
        });
        expect(service.undoAction(actionId)).toBe(true);
        expect(emitted.some((entry) => entry.event === 'sound_assistant_undo_action' && entry.payload.actionId === actionId)).toBe(true);
    });

    it('persists confirmation policy as always', () => {
        const { service } = loadService();
        const settings = service.updateSettings({ confirmationPolicy: 'automatic', sensitivity: 'sensitive' });
        expect(settings.confirmationPolicy).toBe('always');
        expect(settings.sensitivity).toBe('sensitive');
    });
});
