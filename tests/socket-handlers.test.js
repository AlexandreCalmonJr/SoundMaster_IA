import { describe, it, expect, vi, beforeEach } from 'vitest';
const { registerSocketHandlers } = require('../src/server/socket-handlers');

const mockMixerState = {
    master: { level: 0.5, levelDb: -10, mute: 0, eq: {} },
    inputs: Array(24).fill(0).map(() => ({ level: 0.4, mute: 0, phantom: 0, eq: {} })),
    aux: Array(10).fill(0).map(() => ({ level: 0.2 }))
};

// Mock das dependências externas
vi.mock('soundcraft-ui-connection', () => ({
    ConnectionStatus: { Open: 'open', Close: 'close', Error: 'error', Reconnecting: 'reconnecting' },
    SoundcraftUI: vi.fn().mockImplementation(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        status$: { subscribe: vi.fn() },
        master: {
            faderLevel$: { subscribe: vi.fn() },
            faderLevelDB$: { subscribe: vi.fn() },
            setFaderLevel: vi.fn()
        },
        vuProcessor: { vuData$: { subscribe: vi.fn() } },
        deviceInfo: { firmware$: { subscribe: vi.fn() }, capabilities$: { subscribe: vi.fn() } },
        automix: { groups: { a: { state$: { subscribe: vi.fn() } }, b: { state$: { subscribe: vi.fn() } } }, responseTimeMs$: { subscribe: vi.fn() } },
        recorderDualTrack: { recording$: { subscribe: vi.fn() } },
        recorderMultiTrack: { recording$: { subscribe: vi.fn() } },
        player: { state$: { subscribe: vi.fn() }, track$: { subscribe: vi.fn() } },
        shows: { currentShow$: { subscribe: vi.fn() }, currentSnapshot$: { subscribe: vi.fn() }, currentCue$: { subscribe: vi.fn() } },
        input: vi.fn(() => ({ name$: { subscribe: vi.fn() }, faderLevel$: { subscribe: vi.fn() }, mute$: { subscribe: vi.fn() } })),
        muteGroup: vi.fn(() => ({ state$: { subscribe: vi.fn() } })),
        channelSync: { getSelectedChannel: vi.fn(() => ({ subscribe: vi.fn() })) }
    }))
}));

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

vi.mock('../src/server/logger', () => ({
    getInstance: vi.fn(() => ({
        onLog: null,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }))
}));

vi.mock('../src/server/mixer-singleton', () => ({
    getMixer: vi.fn(() => null),
    setMixer: vi.fn(),
    getState: vi.fn(() => mockMixerState),
    getMasterState: vi.fn(() => mockMixerState.master),
    getChannelState: vi.fn((ch) => mockMixerState.inputs[ch - 1]),
    getAuxState: vi.fn((aux) => mockMixerState.aux[aux - 1]),
    updateChannelState: vi.fn(),
    updateMasterState: vi.fn(),
    updateAuxState: vi.fn()
}));

describe('Socket Handlers Integration', () => {
    let mockIo;
    let mockSocket;
    let registeredHandlers = {};

    beforeEach(() => {
        registeredHandlers = {};
        vi.clearAllMocks();
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
    });

    it('should validate and reject invalid connect_mixer IP', async () => {
        const handler = registeredHandlers['connect_mixer'];
        
        // "invalid" não passa no regex nem no enum
        await handler('invalid');
        
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_status', expect.objectContaining({
            msg: expect.stringContaining('Erro de conexao')
        }));
    });

    it('should validate and accept correct simulated IP', async () => {
        const handler = registeredHandlers['connect_mixer'];
        await handler('simulado');
        
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_status', expect.objectContaining({
            isSimulated: true
        }));
    });

    it('should reject invalid set_master_level data', async () => {
        const handler = registeredHandlers['set_master_level'];
        
        // Conectar primeiro
        await registeredHandlers['connect_mixer']('simulado');
        
        // Enviando string ao invés de número no level
        await handler({ level: 'invalid' });
        
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_status', expect.objectContaining({
            msg: expect.stringContaining('Dados inválidos')
        }));
    });

    it('should validate apply_channel_hpf with correct types', async () => {
        const handler = registeredHandlers['apply_channel_hpf'];
        
        // Primeiro conectar para ter um mixer ativo
        await registeredHandlers['connect_mixer']('simulado');
        
        await handler({ channel: 1, hz: 150 });
        
        expect(mockSocket.emit).toHaveBeenCalledWith('feedback_cut_success', expect.objectContaining({
            msg: expect.stringContaining('HPF 150Hz aplicado')
        }));
    });

    it('should reject apply_channel_hpf with out of range values', async () => {
        const handler = registeredHandlers['apply_channel_hpf'];
        await registeredHandlers['connect_mixer']('simulado');
        
        // Canal 25 não existe (max 24)
        await handler({ channel: 25, hz: 150 });
        
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_status', expect.objectContaining({
            connected: true
        }));
    });

    it('should block direct AI commands and require the confirmation flow', async () => {
        await registeredHandlers['connect_mixer']('simulado');
        await registeredHandlers['execute_ai_command']({
            action: 'set_aux_level',
            desc: 'Aumentar retorno',
            channel: 2,
            aux: 3,
            level: 0.7
        });

        expect(mockSocket.emit).toHaveBeenCalledWith('sound_assistant_action_rejected', expect.objectContaining({
            status: 'rejected',
            error: expect.stringContaining('confirmação')
        }));
        expect(mockSocket.emit).not.toHaveBeenCalledWith('feedback_cut_success', expect.anything());
    });

    it('should reject raw messages outside whitelist', async () => {
        await registeredHandlers['connect_mixer']('simulado');
        await registeredHandlers['send_raw_message']({ message: 'DROP TABLE' });

        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_status', expect.objectContaining({
            msg: expect.stringContaining('rejeitado')
        }));
    });
});
