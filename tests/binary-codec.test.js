import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Server codec (CommonJS)
const serverCodec = require('../src/server/codecs/binary');

// Client codec (IIFE → window.BinaryCodec)
const CLIENT_PATH = resolve(process.cwd(), 'frontend/js/utils/binary-codec.js');

function loadClientCodec() {
    globalThis.window = globalThis;
    globalThis.console = { ...console, log: vi.fn() };
    delete globalThis.BinaryCodec;
    const code = readFileSync(CLIENT_PATH, 'utf8');
    const run = new Function('globalThis', 'var window = globalThis.window; ' + code);
    run(globalThis);
    return globalThis.BinaryCodec;
}

function serverBufferToArrayBuffer(buf) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe('Binary Codec — Server (Node.js Buffer)', () => {
    it('encodes and decodes master level', () => {
        const buf = serverCodec.encodeMasterLevel(0.75);
        expect(buf.length).toBe(4);
        expect(serverCodec.decodeMasterLevel(buf)).toBeCloseTo(0.75, 5);
    });

    it('encodes and decodes master level dB', () => {
        const buf = serverCodec.encodeMasterLevelDb(-12.5);
        expect(buf.length).toBe(4);
        expect(serverCodec.decodeMasterLevelDb(buf)).toBeCloseTo(-12.5, 5);
    });

    it('encodes and decodes channel level', () => {
        const buf = serverCodec.encodeChannelLevel(5, 0.85);
        expect(buf.length).toBe(5);
        const result = serverCodec.decodeChannelLevel(buf);
        expect(result.channel).toBe(5);
        expect(result.level).toBeCloseTo(0.85, 5);
    });

    it('encodes and decodes VU data with all channels', () => {
        const vuData = {
            master: 0.5,
            channels: {
                1: { vuPre: 0.1, vuPost: 0.2, vuPostFader: 0.3 },
                24: { vuPre: 0.4, vuPost: 0.5, vuPostFader: 0.6 },
            }
        };
        const buf = serverCodec.encodeVuData(vuData);
        expect(buf.length).toBe(292);
        const decoded = serverCodec.decodeVuData(buf);
        expect(decoded.master).toBeCloseTo(0.5, 5);
        expect(decoded.channels[1].vuPre).toBeCloseTo(0.1, 5);
        expect(decoded.channels[1].vuPost).toBeCloseTo(0.2, 5);
        expect(decoded.channels[1].vuPostFader).toBeCloseTo(0.3, 5);
        expect(decoded.channels[24].vuPre).toBeCloseTo(0.4, 5);
        expect(decoded.channels[24].vuPost).toBeCloseTo(0.5, 5);
        expect(decoded.channels[24].vuPostFader).toBeCloseTo(0.6, 5);
    });

    it('encodes VU data with empty channels as zeros, omits zeros on decode', () => {
        const buf = serverCodec.encodeVuData({ master: 0 });
        const decoded = serverCodec.decodeVuData(buf);
        expect(decoded.master).toBe(0);
        expect(Object.keys(decoded.channels).length).toBe(0);
    });

    it('handles NaN and Infinity gracefully', () => {
        const buf = serverCodec.encodeMasterLevel(NaN);
        expect(serverCodec.decodeMasterLevel(buf)).toBeNaN();

        const buf2 = serverCodec.encodeMasterLevel(Infinity);
        expect(serverCodec.decodeMasterLevel(buf2)).toBe(Infinity);
    });

    it('produces correct VU_TOTAL constant', () => {
        expect(serverCodec.VU_TOTAL).toBe(292);
    });
});

describe('Binary Codec — Client (DataView)', () => {
    let client;

    beforeEach(() => { client = loadClientCodec(); });
    afterEach(() => { delete globalThis.BinaryCodec; delete globalThis.window; });

    it('decodes master level from ArrayBuffer', () => {
        const buf = serverCodec.encodeMasterLevel(0.5);
        const ab = serverBufferToArrayBuffer(buf);
        expect(client.decodeMasterLevel(ab)).toBeCloseTo(0.5, 5);
    });

    it('decodes master level dB from ArrayBuffer', () => {
        const buf = serverCodec.encodeMasterLevelDb(-6.0);
        const ab = serverBufferToArrayBuffer(buf);
        expect(client.decodeMasterLevelDb(ab)).toBeCloseTo(-6.0, 5);
    });

    it('decodes channel level from ArrayBuffer', () => {
        const buf = serverCodec.encodeChannelLevel(7, 0.42);
        const ab = serverBufferToArrayBuffer(buf);
        const result = client.decodeChannelLevel(ab);
        expect(result.channel).toBe(7);
        expect(result.level).toBeCloseTo(0.42, 5);
    });

    it('decodes VU data from ArrayBuffer (round-trip)', () => {
        const original = {
            master: 0.75,
            channels: {
                1: { vuPre: 0.1, vuPost: 0.2, vuPostFader: 0.3 },
                8: { vuPre: 0.4, vuPost: 0.5, vuPostFader: 0.6 },
                16: { vuPre: 0.7, vuPost: 0.8, vuPostFader: 0.9 },
            }
        };
        const serverBuf = serverCodec.encodeVuData(original);
        const ab = serverBufferToArrayBuffer(serverBuf);
        const decoded = client.decodeVuData(ab);

        expect(decoded.master).toBeCloseTo(0.75, 5);
        expect(decoded.channels[1].vuPre).toBeCloseTo(0.1, 5);
        expect(decoded.channels[1].vuPost).toBeCloseTo(0.2, 5);
        expect(decoded.channels[1].vuPostFader).toBeCloseTo(0.3, 5);
        expect(decoded.channels[8].vuPre).toBeCloseTo(0.4, 5);
        expect(decoded.channels[8].vuPost).toBeCloseTo(0.5, 5);
        expect(decoded.channels[8].vuPostFader).toBeCloseTo(0.6, 5);
        expect(decoded.channels[16].vuPre).toBeCloseTo(0.7, 5);
        expect(decoded.channels[16].vuPost).toBeCloseTo(0.8, 5);
        expect(decoded.channels[16].vuPostFader).toBeCloseTo(0.9, 5);
    });

    it('decodes VU data omitting zero-only channels', () => {
        const buf = serverCodec.encodeVuData({ master: 0 });
        const ab = serverBufferToArrayBuffer(buf);
        const decoded = client.decodeVuData(ab);
        expect(Object.keys(decoded.channels).length).toBe(0);
    });

    it('decodes VU data with all 24 channels active', () => {
        const channels = {};
        for (let i = 1; i <= 24; i++) {
            channels[i] = { vuPre: i * 0.01, vuPost: i * 0.02, vuPostFader: i * 0.03 };
        }
        const buf = serverCodec.encodeVuData({ master: 1.0, channels });
        const ab = serverBufferToArrayBuffer(buf);
        const decoded = client.decodeVuData(ab);

        expect(Object.keys(decoded.channels).length).toBe(24);
        expect(decoded.channels[1].vuPre).toBeCloseTo(0.01, 5);
        expect(decoded.channels[24].vuPre).toBeCloseTo(0.24, 5);
        expect(decoded.channels[24].vuPostFader).toBeCloseTo(0.72, 5);
    });

    it('handles Uint8Array input (from WebSocket message)', () => {
        const buf = serverCodec.encodeMasterLevel(0.33);
        const uint8 = new Uint8Array(serverBufferToArrayBuffer(buf));
        expect(client.decodeMasterLevel(uint8)).toBeCloseTo(0.33, 5);
    });
});

describe('Binary Codec — Round-trip compatibility', () => {
    let client;

    beforeEach(() => { client = loadClientCodec(); });
    afterEach(() => { delete globalThis.BinaryCodec; delete globalThis.window; });

    it('master level: server encode → client decode', () => {
        const values = [0, 0.5, 1.0, -3.0, 0.123456];
        for (const v of values) {
            const buf = serverCodec.encodeMasterLevel(v);
            const ab = serverBufferToArrayBuffer(buf);
            const decoded = client.decodeMasterLevel(ab);
            expect(decoded).toBeCloseTo(v, 5);
        }
    });

    it('master level dB: server encode → client decode', () => {
        const values = [-60, 0, 6.5, -120, 20];
        for (const v of values) {
            const buf = serverCodec.encodeMasterLevelDb(v);
            const ab = serverBufferToArrayBuffer(buf);
            const decoded = client.decodeMasterLevelDb(ab);
            expect(decoded).toBeCloseTo(v, 5);
        }
    });

    it('channel level: server encode → client decode', () => {
        const cases = [{ ch: 1, level: 0 }, { ch: 12, level: 0.5 }, { ch: 24, level: 1.0 }];
        for (const { ch, level } of cases) {
            const buf = serverCodec.encodeChannelLevel(ch, level);
            const ab = serverBufferToArrayBuffer(buf);
            const decoded = client.decodeChannelLevel(ab);
            expect(decoded.channel).toBe(ch);
            expect(decoded.level).toBeCloseTo(level, 5);
        }
    });

    it('VU data: server encode → client decode preserves all channel values', () => {
        const channels = {};
        for (let i = 1; i <= 24; i++) {
            channels[i] = { vuPre: 0.1 * i, vuPost: 0.2 * i, vuPostFader: 0.3 * i };
        }
        const buf = serverCodec.encodeVuData({ master: 0.99, channels });
        const ab = serverBufferToArrayBuffer(buf);
        const decoded = client.decodeVuData(ab);

        expect(decoded.master).toBeCloseTo(0.99, 5);
        for (let i = 1; i <= 24; i++) {
            expect(decoded.channels[i].vuPre).toBeCloseTo(0.1 * i, 5);
            expect(decoded.channels[i].vuPost).toBeCloseTo(0.2 * i, 5);
            expect(decoded.channels[i].vuPostFader).toBeCloseTo(0.3 * i, 5);
        }
    });

    it('negative and edge case values round-trip correctly', () => {
        const bufMl = serverCodec.encodeMasterLevel(-0.0);
        // -0 é tratado como 0 em point-to-fix; use toBeCloseTo para evitar Object.is(-0, 0)
        expect(serverCodec.decodeMasterLevel(bufMl)).toBeCloseTo(0, 10);

        const bufCl = serverCodec.encodeChannelLevel(0, 0);
        const cl = serverCodec.decodeChannelLevel(bufCl);
        expect(cl.channel).toBe(0);
        expect(cl.level).toBe(0);
    });
});
