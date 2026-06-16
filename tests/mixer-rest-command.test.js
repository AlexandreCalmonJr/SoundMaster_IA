import { describe, it, expect } from 'vitest';

const { parseRestMixerCommand, buildRestMixerBroadcast } = require('../src/server/mixer-rest-command');

describe('Mixer REST command parser', () => {
    it('normalizes aliases to canonical actions', () => {
        expect(parseRestMixerCommand({ action: 'master_level', level: 0.5 })).toEqual({
            action: 'set_master_level',
            level: 0.5
        });

        expect(parseRestMixerCommand({ action: 'channel_fader', channel: 3, level: 0.7 })).toEqual({
            action: 'set_channel_level',
            channel: 3,
            level: 0.7
        });

        expect(parseRestMixerCommand({ action: 'set_phantom_power', input: 2, enabled: 1 })).toEqual({
            action: 'set_phantom',
            input: 2,
            enabled: true
        });
    });

    it('rejects unsupported actions', () => {
        expect(() => parseRestMixerCommand({ action: 'send_raw', msg: 'SETD^m.mix^0.75' })).toThrow(
            'Acao nao permitida na API REST: send_raw'
        );
    });

    it('rejects malformed payloads', () => {
        expect(() => parseRestMixerCommand(null)).toThrow('Payload do comando deve ser um objeto JSON.');
        expect(() => parseRestMixerCommand({ action: 'set_channel_level', channel: 99, level: 0.5 })).toThrow();
        expect(() => parseRestMixerCommand({ action: 'eq_cut', target: 'channel', hz: 400 })).toThrow();
        expect(() => parseRestMixerCommand({ action: 'set_master_level', level: 0.5, raw: 'SETD^m.mix^1' })).toThrow();
    });

    it('parses allowed commands with explicit bounds', () => {
        expect(parseRestMixerCommand({ action: 'set_aux_level', channel: 2, aux: 3, level: 0.5 })).toEqual({
            action: 'set_aux_level',
            channel: 2,
            aux: 3,
            level: 0.5
        });

        expect(parseRestMixerCommand({ action: 'set_delay', target: 'aux', aux: 1, ms: 120 })).toEqual({
            action: 'set_delay',
            target: 'aux',
            aux: 1,
            ms: 120
        });
    });

    it('rejects unknown fields instead of silently stripping them', () => {
        expect(() => parseRestMixerCommand({
            action: 'set_channel_name',
            channel: 2,
            name: 'Pastor',
            extra: true
        })).toThrow();
    });
});

describe('Mixer REST command broadcast mapping', () => {
    it('maps canonical commands to socket sync events only when needed', () => {
        expect(buildRestMixerBroadcast({ action: 'set_master_level', level: 0.3 })).toEqual({
            event: 'set_master_level',
            data: { level: 0.3 }
        });

        expect(buildRestMixerBroadcast({ action: 'master_mute', enabled: true })).toEqual({
            event: 'set_master_mute',
            data: { mute: true }
        });

        expect(buildRestMixerBroadcast({ action: 'eq_cut', target: 'master', hz: 1000 })).toBeNull();
    });
});
