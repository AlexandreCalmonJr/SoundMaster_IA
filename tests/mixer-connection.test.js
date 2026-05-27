import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mixerSingleton = require('../src/server/mixer-singleton');

vi.mock('../src/server/codecs/binary', () => ({
    encodeVuData: vi.fn((data) => Buffer.alloc(292)),
    encodeMasterLevel: vi.fn((v) => { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b; }),
    encodeMasterLevelDb: vi.fn((v) => { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b; }),
    encodeChannelLevel: vi.fn((ch, lv) => { const b = Buffer.alloc(5); b.writeUInt8(ch, 0); b.writeFloatLE(lv, 1); return b; }),
}));

vi.mock('../src/server/mixers/mixer-factory', () => ({
    createMixer: vi.fn((ip, opts) => {
        if (ip === 'simulado') {
            return {
                targetIp: ip,
                isSimulated: true,
                brand: 'simulated',
                connect: vi.fn(),
                disconnect: vi.fn(),
            };
        }
        return {
            targetIp: ip,
            isSimulated: false,
            brand: opts?.brand || 'unknown',
            connect: vi.fn(),
            disconnect: vi.fn(),
            isSubscribed: false,
            status$: { subscribe: vi.fn() },
            master: {
                faderLevel$: { subscribe: vi.fn() },
                faderLevelDB$: { subscribe: vi.fn() },
            },
            vuProcessor: { vuData$: { subscribe: vi.fn() } },
            deviceInfo: {
                firmware$: { subscribe: vi.fn() },
                capabilities$: { subscribe: vi.fn() },
                model: 'X32',
            },
            automix: {
                groups: { a: { state$: { subscribe: vi.fn() } }, b: { state$: { subscribe: vi.fn() } } },
                responseTimeMs$: { subscribe: vi.fn() },
            },
            recorderDualTrack: { recording$: { subscribe: vi.fn() } },
            recorderMultiTrack: { recording$: { subscribe: vi.fn() } },
            player: { state$: { subscribe: vi.fn() }, track$: { subscribe: vi.fn() } },
            shows: { currentShow$: { subscribe: vi.fn() }, currentSnapshot$: { subscribe: vi.fn() }, currentCue$: { subscribe: vi.fn() } },
            input: vi.fn(() => ({
                name$: { subscribe: vi.fn() },
                faderLevel$: { subscribe: vi.fn() },
                mute$: { subscribe: vi.fn() },
            })),
            muteGroup: vi.fn(() => ({ state$: { subscribe: vi.fn() } })),
            channelSync: { getSelectedChannel: vi.fn(() => ({ subscribe: vi.fn() })) },
        };
    }),
    isSimulatedIp: vi.fn((ip) => ip === 'simulado' || ip === '127.0.0.1'),
}));

const { registerMixerConnectionHandlers } = require('../src/server/handlers/mixer-connection');

describe('MixerConnection — Server Handler', () => {
    let mockIo, mockSocket, registeredHandlers, deps, logger;

    beforeEach(() => {
        registeredHandlers = {};
        vi.clearAllMocks();
        mixerSingleton.setMixer(null);

        logger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        };

        mockSocket = {
            id: 'test-socket',
            emit: vi.fn(),
            on: vi.fn((event, handler) => { registeredHandlers[event] = handler; }),
        };

        mockIo = {
            emit: vi.fn(),
        };

        deps = { logger, mixerSingleton };

        registerMixerConnectionHandlers(mockIo, mockSocket, deps);
    });

    afterEach(() => {
        mixerSingleton.setMixer(null);
    });

    it('registers request_state_delta, connect_mixer, and disconnect_mixer', () => {
        expect(registeredHandlers['request_state_delta']).toBeDefined();
        expect(registeredHandlers['connect_mixer']).toBeDefined();
        expect(registeredHandlers['disconnect_mixer']).toBeDefined();
    });

    it('request_state_delta emits mixer_state_full with state tree', () => {
        mixerSingleton.setMixer({ targetIp: '10.10.1.100', isSimulated: false });
        registeredHandlers['request_state_delta']({ windowSecs: 30 });
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_state_full', expect.objectContaining({
            _source: 'delta',
            _windowSecs: 30,
        }));
        expect(logger.info).toHaveBeenCalledWith('test-socket', 'STATE_DELTA_SENT', { windowSecs: 30 });
    });

    it('request_state_delta uses default windowSecs when not provided', () => {
        mixerSingleton.setMixer({ targetIp: '10.10.1.100', isSimulated: false });
        registeredHandlers['request_state_delta']({});
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_state_full', expect.objectContaining({ _windowSecs: 10 }));
    });

    it('connect_mixer with simulated IP returns immediately', async () => {
        await registeredHandlers['connect_mixer']('simulado');
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_status', { connected: true, isSimulated: true, msg: 'Modo Simulado Ativo' });
    });

    it('connect_mixer reuses same mixer when IP matches', async () => {
        const existingMixer = { targetIp: '10.10.1.100', getState: vi.fn(() => ({ master: {} })), disconnect: vi.fn() };
        mixerSingleton.setMixer(existingMixer);

        await registeredHandlers['connect_mixer']({ ip: '10.10.1.100' });

        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_status', { connected: true, msg: expect.stringContaining('Reutilizando') });
        expect(logger.info).toHaveBeenCalledWith('test-socket', 'MIXER_SINGLETON_REUSE');
    });

    it('connect_mixer disconnects previous mixer when IP differs', async () => {
        const oldMixer = { targetIp: '10.10.1.50', disconnect: vi.fn() };
        mixerSingleton.setMixer(oldMixer);

        await registeredHandlers['connect_mixer']({ ip: '10.10.1.100', brand: 'behringer' });

        expect(oldMixer.disconnect).toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith('test-socket', 'MIXER_CLEANUP_PREVIOUS');
    });

    it('connect_mixer handles invalid IP gracefully', async () => {
        await registeredHandlers['connect_mixer']({ ip: 'invalid-ip' });
        expect(logger.error).toHaveBeenCalledWith('test-socket', 'MIXER_CONNECT_ERROR', expect.any(Object));
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_status', { connected: false, msg: expect.stringContaining('Erro') });
    });

    it('connect_mixer handles missing ip field gracefully', async () => {
        await registeredHandlers['connect_mixer']({ brand: 'behringer' });
        expect(logger.error).toHaveBeenCalledWith('test-socket', 'MIXER_CONNECT_ERROR', expect.any(Object));
    });

    it('connect_mixer handles string data', async () => {
        await registeredHandlers['connect_mixer']('simulado');
        expect(mockSocket.emit).toHaveBeenCalledWith('mixer_status', { connected: true, isSimulated: true, msg: 'Modo Simulado Ativo' });
    });

    it('connect_mixer handles null data gracefully', async () => {
        await registeredHandlers['connect_mixer'](null);
        expect(logger.error).toHaveBeenCalledWith('test-socket', 'MIXER_CONNECT_ERROR', expect.any(Object));
    });

    it('disconnect_mixer disconnects and clears mixer', () => {
        const mixer = { targetIp: '10.10.1.100', disconnect: vi.fn() };
        mixerSingleton.setMixer(mixer);

        registeredHandlers['disconnect_mixer']();
        expect(mixer.disconnect).toHaveBeenCalled();
        expect(mixerSingleton.getMixer()).toBeNull();
        expect(mockIo.emit).toHaveBeenCalledWith('mixer_status', { connected: false, msg: 'Desconectado.' });
        expect(logger.info).toHaveBeenCalledWith('test-socket', 'MIXER_DISCONNECTED');
    });

    it('disconnect_mixer does nothing when no mixer is connected', () => {
        registeredHandlers['disconnect_mixer']();
        expect(mockIo.emit).not.toHaveBeenCalled();
    });
});
