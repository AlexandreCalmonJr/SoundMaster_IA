/**
 * Binary Codec (Client) — Decodificação de mensagens binárias de alta frequência.
 *
 * Deve manter compatibilidade com src/server/codecs/binary.js
 * (mesmo layout little-endian).
 */
(function () {
    'use strict';

    var CHANNEL_COUNT = 24;
    var VU_MASTER_OFF = 0;
    var VU_CH_START   = 4;
    var VU_CH_BYTES   = 12;   // 3 × f32
    var VU_TOTAL      = 4 + CHANNEL_COUNT * VU_CH_BYTES; // 292

    /**
     * Decodifica VU data de um ArrayBuffer (ou TypedArray).
     * @param {ArrayBuffer|Uint8Array} buffer
     * @returns {{ master: number, channels: Object }}
     */
    function decodeVuData(buffer) {
        var dv = buffer instanceof DataView
            ? buffer
            : new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
        var master = dv.getFloat32(VU_MASTER_OFF, true);
        var channels = {};
        for (var i = 0; i < CHANNEL_COUNT; i++) {
            var off = VU_CH_START + i * VU_CH_BYTES;
            var vuPre = dv.getFloat32(off, true);
            var vuPost = dv.getFloat32(off + 4, true);
            var vuPostFader = dv.getFloat32(off + 8, true);
            // Só inclui canais com sinal
            if (vuPre !== 0 || vuPost !== 0 || vuPostFader !== 0) {
                channels[i + 1] = { vuPre: vuPre, vuPost: vuPost, vuPostFader: vuPostFader };
            }
        }
        return { master: master, channels: channels };
    }

    function decodeMasterLevel(buffer) {
        var dv = buffer instanceof DataView ? buffer : new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
        return dv.getFloat32(0, true);
    }

    function decodeMasterLevelDb(buffer) {
        return decodeMasterLevel(buffer);
    }

    function decodeChannelLevel(buffer) {
        var dv = buffer instanceof DataView ? buffer : new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
        return {
            channel: dv.getUint8(0, true),
            level: dv.getFloat32(1, true)
        };
    }

    window.BinaryCodec = {
        decodeVuData: decodeVuData,
        decodeMasterLevel: decodeMasterLevel,
        decodeMasterLevelDb: decodeMasterLevelDb,
        decodeChannelLevel: decodeChannelLevel,
    };
})();
