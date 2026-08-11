import { describe, expect, it, vi } from 'vitest';

const { registerDiagnosticHandlers } = require('../src/server/handlers/diagnostics');

function setup(risk) {
    const handlers = {};
    const io = { emit: vi.fn() };
    const socket = {
        id: 'shadow-test',
        on: vi.fn((event, handler) => { handlers[event] = handler; }),
        emit: vi.fn(),
    };
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const historyService = {
        saveSnapshot: vi.fn(),
        updateSnapshot: vi.fn(),
        getComparison: vi.fn(),
        getBenchmark: vi.fn(),
        db: null,
    };
    const aiPredictor = { predictRisk: vi.fn(async () => risk) };

    registerDiagnosticHandlers(io, socket, { logger, historyService, aiPredictor });
    return { handlers, io, socket, logger, aiPredictor };
}

describe('Diagnostic handlers — Sound Assistant shadow mode', () => {
    it('emits an alert and never emits a mixer action for high feedback risk', async () => {
        const { handlers, io, socket, logger } = setup(0.96);

        await handlers.analyze_feedback_risk({ hz: 3150, db: -7, prevDb: -12, gain: 0 });

        expect(socket.emit).toHaveBeenCalledWith('feedback_risk_result', expect.objectContaining({
            hz: 3150,
            risk: 0.96,
            mode: 'shadow',
        }));
        expect(io.emit).toHaveBeenCalledWith('sound_assistant_alert', expect.objectContaining({
            code: 'MAIN_FEEDBACK_RISK',
            confidence: 0.96,
            proposedAction: expect.objectContaining({
                executable: false,
                requiresConfirmation: true,
            }),
        }));
        expect(socket.emit).not.toHaveBeenCalledWith('feedback_cut_success', expect.anything());
        expect(logger.info).toHaveBeenCalledWith('shadow-test', 'SOUND_ASSISTANT_SHADOW_ALERT', expect.anything());
    });

    it('does not create an alert below the confidence threshold', async () => {
        const { handlers, io, socket } = setup(0.4);

        await handlers.analyze_feedback_risk({ hz: 800, db: -18, prevDb: -19, gain: 0 });

        expect(socket.emit).toHaveBeenCalledWith('feedback_risk_result', expect.objectContaining({ risk: 0.4 }));
        expect(io.emit).not.toHaveBeenCalledWith('sound_assistant_alert', expect.anything());
    });

    it('rejects malformed frequency data before calling the predictor', async () => {
        const { handlers, io, logger, aiPredictor } = setup(0.99);

        await handlers.analyze_feedback_risk({ hz: 999999, db: -5, prevDb: -10, gain: 0 });

        expect(aiPredictor.predictRisk).not.toHaveBeenCalled();
        expect(io.emit).not.toHaveBeenCalledWith('sound_assistant_alert', expect.anything());
        expect(logger.error).toHaveBeenCalledWith('shadow-test', 'AI_PREDICTION_ERROR', expect.objectContaining({
            error: expect.stringContaining('inválidos'),
        }));
    });
});
