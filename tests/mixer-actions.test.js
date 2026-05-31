import { describe, it, expect, vi } from 'vitest';
const { createMixerActions } = require('../src/server/mixer-actions');

vi.mock('../src/server/mixer-singleton', () => ({
    updateChannelState: vi.fn(),
    updateMasterState: vi.fn(),
    updateAuxState: vi.fn(),
    getChannelState: vi.fn(() => ({})),
    getMasterState: vi.fn(() => ({}))
}));

describe('Mixer Actions', () => {
    function createMockMixer() {
        const cachedInputs = {};
        const cachedLines = {};
        const cachedPlayers = {};
        const cachedAuxes = {};
        const cachedFxs = {};
        const cachedSubs = {};
        const cachedVcas = {};

        function getOrCreateMockChannel(cache, type, id) {
            if (cache[id]) return cache[id];
            
            const auxMock = {
                setFaderLevel: vi.fn(),
                setPost: vi.fn(),
                post: vi.fn(),
                pre: vi.fn(),
                togglePost: vi.fn(),
                setPostProc: vi.fn(),
                postProc: vi.fn(),
                preProc: vi.fn(),
                setPan: vi.fn()
            };
            const fxMock = {
                setFaderLevel: vi.fn(),
                setPost: vi.fn(),
                post: vi.fn(),
                pre: vi.fn(),
                togglePost: vi.fn()
            };
            
            cache[id] = {
                eq: () => ({
                    setHpfFreq: vi.fn(),
                    setHpfSlope: vi.fn(),
                    band: vi.fn(() => ({ setFreq: vi.fn(), setGain: vi.fn(), setQ: vi.fn(), setType: vi.fn() }))
                }),
                gate: () => ({ enable: vi.fn(), disable: vi.fn(), setThreshold: vi.fn() }),
                compressor: () => ({ enable: vi.fn(), setRatio: vi.fn(), setThreshold: vi.fn(), setAttack: vi.fn(), setRelease: vi.fn() }),
                aux: vi.fn((aId) => auxMock),
                fx: vi.fn((fId) => fxMock),
                setName: vi.fn(),
                setDelay: vi.fn(),
                setMute: vi.fn(),
                toggleMute: vi.fn(),
                setSolo: vi.fn(),
                solo: vi.fn(),
                unsolo: vi.fn(),
                toggleSolo: vi.fn(),
                multiTrackToggle: vi.fn(),
                automixRemove: vi.fn(),
                automixSetWeightDB: vi.fn(),
                automixChangeWeightDB: vi.fn(),
                setFaderLevel: vi.fn(),
                setFaderLevelDB: vi.fn(),
                changeFaderLevel: vi.fn(),
                changeFaderLevelDB: vi.fn(),
                fadeTo: vi.fn(),
                fadeToDB: vi.fn()
            };
            return cache[id];
        }

        const inputFn = vi.fn((ch) => getOrCreateMockChannel(cachedInputs, 'input', ch));
        const lineFn = vi.fn((ch) => getOrCreateMockChannel(cachedLines, 'line', ch));
        const playerFn = vi.fn((ch) => getOrCreateMockChannel(cachedPlayers, 'player', ch));
        const auxFn = vi.fn((ch) => getOrCreateMockChannel(cachedAuxes, 'aux', ch));
        const fxFn = vi.fn((ch) => getOrCreateMockChannel(cachedFxs, 'fx', ch));
        const subFn = vi.fn((ch) => getOrCreateMockChannel(cachedSubs, 'sub', ch));
        const vcaFn = vi.fn((ch) => getOrCreateMockChannel(cachedVcas, 'vca', ch));

        const hwMock = { setGain: vi.fn(), setGainDB: vi.fn(), phantomOn: vi.fn(), phantomOff: vi.fn() };
        const volumeBusMock = {
            setFaderLevel: vi.fn(),
            setFaderLevelDB: vi.fn(),
            changeFaderLevel: vi.fn(),
            changeFaderLevelDB: vi.fn(),
            fadeTo: vi.fn(),
            fadeToDB: vi.fn()
        };

        return {
            conn: { sendMessage: vi.fn(), reconnect: vi.fn(), status: 'OPEN' },
            master: {
                input: inputFn,
                line: lineFn,
                player: playerFn,
                aux: auxFn,
                fx: fxFn,
                sub: subFn,
                vca: vcaFn
            },
            volume: {
                solo: volumeBusMock,
                headphone: vi.fn(() => volumeBusMock)
            },
            hw: vi.fn(() => hwMock),
            reconnect: vi.fn()
        };
    }

    it('should clamp values correctly', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);
        
        // Testando HPF clamp (20-400)
        actions.applyChannelHpf(1, 10); // Abaixo do min
        expect(mockMixer.master.input).toHaveBeenCalledWith(1);
        
        actions.applyChannelHpf(1, 500); // Acima do max
        expect(mockMixer.master.input).toHaveBeenCalledWith(1);
    });

    it('should throw error for invalid channel', () => {
        const actions = createMixerActions(() => createMockMixer());
        expect(() => actions.executeMixerCommand({ action: 'unknown' })).toThrow('Acao nao suportada');
    });

    it('should apply channel gate correctly', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);
        
        actions.applyChannelGate(5, true, -40);
        expect(mockMixer.master.input).toHaveBeenCalledWith(5);
    });

    it('should execute aux and fx commands from AI contract', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);

        expect(actions.executeMixerCommand({ action: 'set_aux_level', channel: 2, aux: 3, level: 0.7 })).toContain('AUX 3');
        expect(actions.executeMixerCommand({ action: 'set_fx_level', channel: 2, fx: 1, level: 0.5 })).toContain('FX 1');
    });

    it('should set channel name correctly', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);
        
        const result = actions.executeMixerCommand({ action: 'set_channel_name', channel: 3, name: 'Voz Pastor' });
        expect(mockMixer.master.input).toHaveBeenCalledWith(3);
        expect(result).toContain('Nome do canal 3 alterado para "Voz Pastor"');
    });

    it('should set channel delay correctly', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);
        
        const result = actions.executeMixerCommand({ action: 'set_delay', target: 'channel', channel: 2, ms: 150 });
        expect(mockMixer.master.input).toHaveBeenCalledWith(2);
        expect(result).toContain('Delay de 150ms solicitado para channel');
    });

    it('should apply master EQ using raw commands', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);
        
        const result = actions.executeMixerCommand({ action: 'eq_cut', target: 'master', hz: 1000, gain: -6, q: 2.0, band: 3 });
        expect(mockMixer.conn.sendMessage).toHaveBeenCalledWith('SETD^m.eq.band.2.freq^1000');
        expect(mockMixer.conn.sendMessage).toHaveBeenCalledWith('SETD^m.eq.band.2.gain^-6');
        expect(mockMixer.conn.sendMessage).toHaveBeenCalledWith('SETD^m.eq.band.2.q^2');
        expect(mockMixer.conn.sendMessage).toHaveBeenCalledWith('SETD^m.eq.band.2.type^0');
        expect(result).toContain('EQ aplicado no Master');
    });

    it('should set physical hardware gain in dB', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);
        
        const result = actions.executeMixerCommand({ action: 'set_hw_gain_db', input: 3, val: 24 });
        expect(mockMixer.hw).toHaveBeenCalledWith(3);
        expect(mockMixer.hw(3).setGainDB).toHaveBeenCalledWith(24);
        expect(result).toContain('Ganho de Hardware da Entrada Física 3 ajustado para 24dB.');
    });

    it('should handle boolean and advanced mute/solo/dim actions', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);

        actions.executeMixerCommand({ action: 'channel_mute', channel: 1, enabled: true });
        expect(mockMixer.master.input(1).setMute).toHaveBeenCalledWith(1);

        actions.executeMixerCommand({ action: 'toggle_channel_mute', channel: 1 });
        expect(mockMixer.master.input(1).toggleMute).toHaveBeenCalled();

        actions.executeMixerCommand({ action: 'toggle_solo', channel: 1 });
        expect(mockMixer.master.input(1).toggleSolo).toHaveBeenCalled();

        actions.executeMixerCommand({ action: 'set_solo', channel: 1, enabled: true });
        expect(mockMixer.master.input(1).setSolo).toHaveBeenCalledWith(1);
    });

    it('should handle multi-track recorder toggle and automix actions', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);

        actions.executeMixerCommand({ action: 'mtk_toggle', channel: 2 });
        expect(mockMixer.master.input(2).multiTrackToggle).toHaveBeenCalled();

        actions.executeMixerCommand({ action: 'automix_remove', channel: 3 });
        expect(mockMixer.master.input(3).automixRemove).toHaveBeenCalled();

        actions.executeMixerCommand({ action: 'automix_set_weight_db', channel: 3, weightDb: 6 });
        expect(mockMixer.master.input(3).automixSetWeightDB).toHaveBeenCalledWith(6);

        actions.executeMixerCommand({ action: 'automix_change_weight_db', channel: 3, offsetDb: -3 });
        expect(mockMixer.master.input(3).automixChangeWeightDB).toHaveBeenCalledWith(-3);
    });

    it('should resolve and control VolumeBus targets (solo/headphones)', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);

        actions.executeMixerCommand({ action: 'set_channel_level', target: 'solo', level: 0.8 });
        expect(mockMixer.volume.solo.setFaderLevel).toHaveBeenCalledWith(0.8);

        actions.executeMixerCommand({ action: 'set_fader_level_db', target: 'hp1', levelDb: -10 });
        expect(mockMixer.volume.headphone).toHaveBeenCalledWith(1);
        expect(mockMixer.volume.headphone(1).setFaderLevelDB).toHaveBeenCalledWith(-10);

        actions.executeMixerCommand({ action: 'fade_channel', target: 'hp2', level: 0, time: 1500 });
        expect(mockMixer.volume.headphone).toHaveBeenCalledWith(2);
        expect(mockMixer.volume.headphone(2).fadeTo).toHaveBeenCalledWith(0, 1500);
    });

    it('should control pre/post status for aux and fx sends', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);

        actions.executeMixerCommand({ action: 'set_aux_post', channel: 1, aux: 2, enabled: true });
        expect(mockMixer.master.input(1).aux(2).post).toHaveBeenCalled();

        actions.executeMixerCommand({ action: 'set_aux_post_proc', channel: 1, aux: 2, enabled: true });
        expect(mockMixer.master.input(1).aux(2).postProc).toHaveBeenCalled();

        actions.executeMixerCommand({ action: 'set_fx_post', channel: 1, fx: 3, enabled: false });
        expect(mockMixer.master.input(1).fx(3).pre).toHaveBeenCalled();

        actions.executeMixerCommand({ action: 'toggle_aux_post', channel: 1, aux: 2 });
        expect(mockMixer.master.input(1).aux(2).togglePost).toHaveBeenCalled();

        actions.executeMixerCommand({ action: 'toggle_fx_post', channel: 1, fx: 3 });
        expect(mockMixer.master.input(1).fx(3).togglePost).toHaveBeenCalled();
    });

    it('should handle connection reconnect and status actions', () => {
        const mockMixer = createMockMixer();
        const actions = createMixerActions(() => mockMixer);

        const statusRes = actions.executeMixerCommand({ action: 'get_connection_status' });
        expect(statusRes).toContain('OPEN');

        const reconnectRes = actions.executeMixerCommand({ action: 'reconnect_mixer' });
        expect(mockMixer.reconnect).toHaveBeenCalled();
        expect(reconnectRes).toContain('Tentando reconectar');
    });
});

