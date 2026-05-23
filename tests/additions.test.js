import { describe, it, expect, vi, beforeEach } from 'vitest';
const { registerSocketHandlers } = require('../src/server/socket-handlers');
const mixerSingleton = require('../src/server/mixer-singleton');

// Mocks simples para banco de dados e IA
vi.mock('../src/server/database', () => ({
    presets: {
        insert: vi.fn(),
        find: vi.fn(() => ({ sort: vi.fn(() => ({ exec: vi.fn() })) })),
        findOne: vi.fn()
    }
}));

vi.mock('../src/server/history-service', () => ({
    default: null,
    saveSnapshot: vi.fn(async (data) => ({ _id: 'hist-1', ...data })),
    updateSnapshot: vi.fn(async (_id, data) => ({ _id, ...data })),
    getComparison: vi.fn(async () => []),
    getBenchmark: vi.fn(async () => ({ empty: { rt60: 0, count: 0 }, full: { rt60: 0, count: 0 } }))
}));

vi.mock('../src/server/ai-predictor', () => ({
    predictRisk: vi.fn(async () => 0.95)
}));

describe('Nossos Handlers Adicionais - Socket Handlers', () => {
    let mockIo;
    let mockSocket;
    let registeredHandlers = {};

    beforeEach(async () => {
        registeredHandlers = {};
        vi.clearAllMocks();
        
        // Reseta o mixer singleton real para forçar uma nova conexão simulada em cada teste
        // e evitar que referências de socket fiquem obsoletas/reutilizadas.
        mixerSingleton.setMixer(null);
        
        mockIo = {
            emit: vi.fn(),
            on: vi.fn((event, cb) => {
                if (event === 'connection') {
                    mockSocket = {
                        id: 'test-socket',
                        emit: vi.fn(),
                        on: vi.fn((ev, handler) => {
                            registeredHandlers[ev] = handler;
                        })
                    };
                    cb(mockSocket);
                }
            })
        };
        registerSocketHandlers(mockIo);
        
        // Conecta ao mixer simulado antes de cada teste
        await registeredHandlers['connect_mixer']('simulado');
    });

    it('deve lidar com set_master_mute de forma correta', async () => {
        const handler = registeredHandlers['set_master_mute'];
        
        await handler({ mute: true });
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_log', expect.stringContaining('[Sim] Master MUTADO'));
        
        await handler({ mute: false });
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_log', expect.stringContaining('[Sim] Master ATIVADO'));
    });

    it('deve lidar com set_channel_level de forma correta', async () => {
        const handler = registeredHandlers['set_channel_level'];
        
        await handler({ channel: 3, level: 0.85 });
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_log', expect.stringContaining('[Sim] Canal 3 Fader -> 85%'));
    });

    it('deve lidar com set_channel_mute de forma correta', async () => {
        const handler = registeredHandlers['set_channel_mute'];
        
        await handler({ channel: 5, mute: true });
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_log', expect.stringContaining('[Sim] Canal 5 MUTADO'));
        
        await handler({ channel: 5, mute: false });
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_log', expect.stringContaining('[Sim] Canal 5 ATIVADO'));
    });

    it('deve lidar com set_aux_delay de forma correta', async () => {
        const handler = registeredHandlers['set_aux_delay'];
        
        await handler({ aux: 2, ms: 120 });
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_log', expect.stringContaining('[Sim] Aux 2 Delay -> 120ms'));
    });

    it('deve lidar com apply_parametric_eq de forma correta', async () => {
        const handler = registeredHandlers['apply_parametric_eq'];
        
        await handler({ channel: 2, freq: 1000, gain: -3, q: 1.0 });
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_log', expect.stringContaining('[Sim] Canal 2 EQ B2 Gain -> -3dB'));
    });

    it('deve lidar com apply_notch_filter de forma correta', async () => {
        const handler = registeredHandlers['apply_notch_filter'];
        
        await handler({ channel: 4, freq: 500, gain: -6, q: 8.0 });
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_log', expect.stringContaining('[Sim] Canal 4 EQ B4 Gain -> -6dB'));
    });
});
