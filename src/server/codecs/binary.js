'use strict';

/**
 * Binary Codec — Serialização binária para mensagens de alta frequência.
 *
 * Formato VU Data:
 *   [master: f32][24 blocos de: vuPre: f32, vuPost: f32, vuPostFader: f32]
 *   Total: 4 + 24*12 = 292 bytes
 *
 * Formato Master Level / Master Level dB:
 *   [value: f32] → 4 bytes
 *
 * Formato Channel Level:
 *   [channel: u8][level: f32] → 5 bytes
 */

const CHANNEL_COUNT = 24;
const VU_MASTER_OFF = 0;            // 4 bytes
const VU_CH_START   = 4;            // início dos canais
const VU_CH_BYTES   = 12;           // 3 floats × 4 bytes
const VU_TOTAL      = 4 + CHANNEL_COUNT * VU_CH_BYTES; // 292

function encodeVuData(mapped) {
    const { master, channels = {} } = mapped;
    const buf = Buffer.alloc(VU_TOTAL);

    buf.writeFloatLE(typeof master === 'number' ? master : 0, VU_MASTER_OFF);

    for (let i = 0; i < CHANNEL_COUNT; i++) {
        const ch = channels[i + 1] || {};
        const off = VU_CH_START + i * VU_CH_BYTES;
        buf.writeFloatLE(ch.vuPre ?? 0, off);
        buf.writeFloatLE(ch.vuPost ?? 0, off + 4);
        buf.writeFloatLE(ch.vuPostFader ?? 0, off + 8);
    }

    return buf;
}

function decodeVuData(buf) {
    const master = buf.readFloatLE(VU_MASTER_OFF);
    const channels = {};
    for (let i = 0; i < CHANNEL_COUNT; i++) {
        const off = VU_CH_START + i * VU_CH_BYTES;
        const vuPre = buf.readFloatLE(off);
        const vuPost = buf.readFloatLE(off + 4);
        const vuPostFader = buf.readFloatLE(off + 8);
        if (vuPre !== 0 || vuPost !== 0 || vuPostFader !== 0) {
            channels[i + 1] = { vuPre, vuPost, vuPostFader };
        }
    }
    return { master, channels };
}

function encodeMasterLevel(value) {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(value, 0);
    return buf;
}

function decodeMasterLevel(buf) {
    return buf.readFloatLE(0);
}

function encodeMasterLevelDb(value) {
    return encodeMasterLevel(value); // same format
}

function decodeMasterLevelDb(buf) {
    return decodeMasterLevel(buf);   // same format
}

function encodeChannelLevel(channel, level) {
    const buf = Buffer.alloc(5);
    buf.writeUInt8(channel, 0);
    buf.writeFloatLE(level, 1);
    return buf;
}

function decodeChannelLevel(buf) {
    const channel = buf.readUInt8(0);
    const level = buf.readFloatLE(1);
    return { channel, level };
}

module.exports = {
    encodeVuData,
    decodeVuData,
    encodeMasterLevel,
    decodeMasterLevel,
    encodeMasterLevelDb,
    decodeMasterLevelDb,
    encodeChannelLevel,
    decodeChannelLevel,
    VU_TOTAL,
};
