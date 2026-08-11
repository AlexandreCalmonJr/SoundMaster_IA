import { beforeEach, describe, expect, it, vi } from 'vitest';

const { registerSoundAssistantHandlers } = require('../src/server/handlers/sound-assistant');

function setup(role = 'admin') {
    const handlers = {};
    const emitted = [];
    const socket = {
        id: 'assistant-test',
        user: { id: 'user-1', role },
        on: vi.fn((event, handler) => { handlers[event] = handler; }),
        emit: vi.fn((event, payload) => { emitted.push({ event, payload }); }),
    };
    const actions = {
        ensureMixer: vi.fn(() => true),
        executeMixerCommand: vi.fn(() => 'ajuste aplicado'),
        restoreEqSnapshot: vi.fn(() => ({ msg: 'EQ restaurado' })),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const mixerSingleton = {
        getStateTree: vi.fn(() => ({
            master: { level: 0.7, levelDb: -6, mute: 0, eq: { 4: { hz: 1000, gain: 0, q: 1 } } },
            inputs: Array.from({ length: 24 }, () => ({ level: 0.6, levelDb: -8, mute: 0, hpf: 80, eq: {} })),
            aux: Array.from({ length: 10 }, () => ({ level: 0.5, delay: 0 })),
        })),
    };
    const addToHistory = vi.fn();
    registerSoundAssistantHandlers({ emit: vi.fn() }, socket, {
        actions,
        logger,
        mixerSingleton,
        rateLimiter: vi.fn(() => true),
        addToHistory,
    });
    return { handlers, emitted, socket, actions, logger, addToHistory };
}

function propose(handlers, command) {
    handlers.sound_assistant_propose_action({
        clientRequestId: 'client-1',
        origin: 'ai-chat',
        reason: 'Teste de confirmação',
        evidence: { confidence: 0.9 },
        command,
    });
}

describe('Sound Assistant confirmed action handler', () => {
    it('never executes a proposal before explicit confirmation', () => {
        const { handlers, emitted, actions } = setup();
        propose(handlers, { action: 'eq_cut', target: 'master', hz: 1000, gain: -3, q: 5, band: 4, desc: 'Corte de teste' });

        expect(actions.executeMixerCommand).not.toHaveBeenCalled();
        const pending = emitted.find((entry) => entry.event === 'sound_assistant_action_pending');
        expect(pending.payload.status).toBe('pending');
        expect(pending.payload.command.action).toBe('eq_cut');
    });

    it('executes once after confirmation and exposes undo', () => {
        const { handlers, emitted, actions, addToHistory } = setup();
        propose(handlers, { action: 'set_master_level', level: 0.5, desc: 'Ajustar master' });
        const pending = emitted.find((entry) => entry.event === 'sound_assistant_action_pending').payload;

        handlers.sound_assistant_confirm_action({ actionId: pending.actionId });

        expect(actions.executeMixerCommand).toHaveBeenCalledTimes(1);
        expect(actions.executeMixerCommand).toHaveBeenCalledWith(expect.objectContaining({ action: 'set_master_level', level: 0.5 }), { source: 'ai' });
        const completed = emitted.filter((entry) => entry.event === 'sound_assistant_action_result').at(-1).payload;
        expect(completed.status).toBe('completed');
        expect(completed.undoAvailable).toBe(true);
        expect(addToHistory).toHaveBeenCalledWith(expect.objectContaining({ type: 'sound_assistant_confirmed_action' }));
    });

    it('supports a single undo for reversible actions', () => {
        const { handlers, emitted, actions } = setup();
        propose(handlers, { action: 'set_master_level', level: 0.4, desc: 'Ajustar master' });
        const pending = emitted.find((entry) => entry.event === 'sound_assistant_action_pending').payload;
        handlers.sound_assistant_confirm_action({ actionId: pending.actionId });
        handlers.sound_assistant_undo_action({ actionId: pending.actionId });

        expect(actions.executeMixerCommand).toHaveBeenCalledTimes(2);
        expect(actions.executeMixerCommand).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'set_master_level', level: 0.7 }), { source: 'ai' });
    });

    it('rejects unsupported commands and non-admin proposals', () => {
        const admin = setup();
        propose(admin.handlers, { action: 'send_raw', message: 'SETD^m.mute^1' });
        expect(admin.actions.executeMixerCommand).not.toHaveBeenCalled();
        expect(admin.emitted.some((entry) => entry.event === 'sound_assistant_action_rejected')).toBe(true);

        const viewer = setup('viewer');
        propose(viewer.handlers, { action: 'set_master_level', level: 0.5 });
        expect(viewer.emitted.find((entry) => entry.event === 'sound_assistant_action_rejected').payload.error).toMatch(/administradores/i);
    });
});
