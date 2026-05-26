/**
 * SoundMaster Pro — Auto-EQ / Target Curve Matching Engine
 * ==========================================================
 * Compara o espectro medido (RTA de longo prazo) com uma curva alvo e
 * calcula os filtros PEQ ou GEQ necessários para igualar a resposta.
 *
 * Curvas alvo disponíveis:
 *   flat        — Resposta plana 0dB (referência)
 *   tilt        — Inclinação suave -3dB/oitava nos agudos (estúdio hi-fi)
 *   smaart      — Curva SMAART/L'Acoustics: +3dB nos graves, -2dB nos agudos
 *   xcurve      — X-Curve de cinema (IEC 268-7 / SMPTE)
 *   presence    — Realce de voz (+2dB 1.5-5kHz, para fala/púlpito)
 *   custom      — JSON definido pelo utilizador
 *
 * Modos de saída:
 *   PEQ (4 bandas) — Frequência, Ganho e Q → direto para a Soundcraft Ui
 *   GEQ 31 bandas  — Ganho por banda ISO 1/3 oitava (31.5Hz–16kHz)
 *
 * API pública (window.AutoEQ):
 *   .setTarget(name, customPoints?)
 *   .analyze(freqDataDb, sampleRate, fftSize)  → { peq, geq, curve, diff }
 *   .applyToMixer(peqBands, target, channel)   → emite via Socket.IO
 *   .getTargetNames()
 *   .exportGEQ()                               → CSV
 */

'use strict';

(function () {

    // ─── Curvas Alvo ──────────────────────────────────────────────────────────

    /**
     * Cada curva é definida como [[Hz, dB], ...] e interpolada para qualquer
     * frequência por método log-linear (idêntico à calibração de microfone).
     */
    const TARGET_CURVES = {

        flat: {
            name: 'Flat (0dB)',
            points: [[20, 0], [20000, 0]],
        },

        tilt: {
            name: 'Studio Tilt (−3dB/oct HF)',
            // Inclinação característica de monitoração de estúdio (Neumann, Genelec)
            // -3dB por oitava acima de 2kHz
            points: [
                [20,    0],
                [200,   0],
                [2000,  0],
                [4000, -1.5],
                [8000, -3.0],
                [16000,-6.0],
                [20000,-7.5],
            ],
        },

        smaart: {
            name: 'L\'Acoustics / SMAART Target',
            // Curva de referência para PA de grande porte
            // Baseada nas recomendações de ajuste de sala do SMAART v8
            points: [
                [20,    3.0],
                [40,    3.0],
                [80,    2.0],
                [160,   1.0],
                [315,   0.5],
                [630,   0.0],
                [1250,  0.0],
                [2500, -0.5],
                [5000, -1.5],
                [10000,-3.0],
                [16000,-5.0],
                [20000,-6.0],
            ],
        },

        xcurve: {
            name: 'X-Curve Cinema (SMPTE ST 202)',
            // IEC 60268-7:1996 / SMPTE ST 202:2010
            // Nível médio de sala de cinema com difusão
            points: [
                [20,   0],
                [2000, 0],
                [2000, 0],   // ponto de inflexão
                [10000,-3.0],
                [12500,-4.5],
                [16000,-7.0],
                [20000,-10.0],
            ],
        },

        presence: {
            name: 'Realce de Voz (Púlpito)',
            // Optimizado para inteligibilidade de fala em ambiente reverberante
            // baseado nas diretrizes da IEC 60268-16 (STI)
            points: [
                [20,    0],
                [80,   -1.0],  // reduz bumble (retroalimentação de palco)
                [250,   0.0],
                [800,   0.5],
                [1500,  1.5],  // realce de vogais
                [3000,  2.0],  // presença máxima de voz
                [5000,  1.5],  // sibilância
                [8000,  0.0],
                [16000,-1.5],
                [20000,-3.0],
            ],
        },
    };

    // ─── Bandas GEQ 31 (ISO 1/3 de oitava) ───────────────────────────────────
    // Frequências centrais standard conforme IEC 61260
    const GEQ_BANDS_HZ = [
        20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
        200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
        2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
    ];

    // ─── Estado interno ───────────────────────────────────────────────────────

    let _targetName   = 'flat';
    let _customPoints = null;
    let _lastResult   = null;

    // ─── Interpolação log-linear ──────────────────────────────────────────────

    function _interpCurve(points, hz) {
        if (!points || points.length === 0) return 0;
        const sorted = [...points].sort((a, b) => a[0] - b[0]);
        const logF   = Math.log10(Math.max(hz, 1));
        const logPs  = sorted.map(p => Math.log10(Math.max(p[0], 1)));

        if (logF <= logPs[0])              return sorted[0][1];
        if (logF >= logPs[logPs.length - 1]) return sorted[sorted.length - 1][1];

        // Busca binária
        let lo = 0, hi = sorted.length - 2;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (logPs[mid + 1] < logF) lo = mid + 1;
            else hi = mid;
        }
        const t = (logF - logPs[lo]) / (logPs[lo + 1] - logPs[lo]);
        return sorted[lo][1] + t * (sorted[lo + 1][1] - sorted[lo][1]);
    }

    function _getTargetPoints() {
        if (_targetName === 'custom' && _customPoints) return _customPoints;
        return (TARGET_CURVES[_targetName] || TARGET_CURVES.flat).points;
    }

    // ─── Motor principal ──────────────────────────────────────────────────────

    /**
     * Analisa o espectro medido e calcula os filtros de correção.
     *
     * @param {Float32Array|number[]} freqDataDb  - dados do analyser.getFloatFrequencyData()
     * @param {number}                sampleRate
     * @param {number}                fftSize     - analyser.fftSize
     * @returns {{ peq, geq, curve, diff, stats }}
     */
    function analyze(freqDataDb, sampleRate, fftSize) {
        const binCount = freqDataDb.length;
        const hzPerBin = sampleRate / fftSize;
        const targetPts = _getTargetPoints();

        // 1. Calcula a diferença (measured - target) para cada bin FFT
        const diff = new Float32Array(binCount);
        for (let k = 1; k < binCount; k++) {
            const hz     = k * hzPerBin;
            if (hz > sampleRate / 2) break;
            const target = _interpCurve(targetPts, hz);
            diff[k]      = freqDataDb[k] - target;   // positivo = medido > alvo → precisa corte
        }

        // 2. Calcula GEQ (31 bandas ISO 1/3 oitava)
        const geq = _calcGEQ(diff, hzPerBin, binCount);

        // 3. Calcula PEQ (até 4 bandas paramétricas)
        const peq = _calcPEQ(geq);

        // 4. Curva alvo amostrada nas frequências do GEQ (para visualização)
        const curve = GEQ_BANDS_HZ.map(hz => ({
            hz,
            targetDb: _interpCurve(targetPts, hz),
        }));

        // 5. Estatísticas
        const diffs = geq.map(b => b.correctionDb);
        const stats = {
            rms:    _rms(diffs),
            max:    Math.max(...diffs.map(Math.abs)),
            bands:  geq.filter(b => Math.abs(b.correctionDb) > 1.0).length,
        };

        _lastResult = { peq, geq, curve, diff: Array.from(diff), stats };
        return _lastResult;
    }

    // ─── GEQ (31 bandas) ─────────────────────────────────────────────────────

    /**
     * Calcula o ganho de correção para cada uma das 31 bandas ISO.
     *
     * Para cada banda central, integra a diferença nos bins FFT dentro do
     * intervalo [f/√2, f×√2] (1/3 de oitava) e calcula a média ponderada.
     * Aplica suavização entre bandas (evita "dentes de serra" no GEQ).
     *
     * A correção é a curva INVERSA: se a sala tem +3dB a 250Hz, aplicamos -3dB.
     * Clampado a ±12dB para proteger o sistema.
     */
    function _calcGEQ(diff, hzPerBin, binCount) {
        const rawGEQ = GEQ_BANDS_HZ.map(centerHz => {
            const fLow  = centerHz / Math.pow(2, 1/3);
            const fHigh = centerHz * Math.pow(2, 1/3);

            const kLow  = Math.max(1,         Math.round(fLow  / hzPerBin));
            const kHigh = Math.min(binCount - 1, Math.round(fHigh / hzPerBin));

            if (kHigh <= kLow) return { hz: centerHz, correctionDb: 0 };

            // Média ponderada (peso = magnitude inversa → evita que picos de feedback dominem)
            let sumW = 0, sumWD = 0;
            for (let k = kLow; k <= kHigh; k++) {
                const w = 1; // peso uniforme; pode ser window de Hann para suavidade
                sumW  += w;
                sumWD += diff[k] * w;
            }
            const avgDiff = sumW > 0 ? sumWD / sumW : 0;

            // Correção = -diff (curva inversa), clampada a ±12dB
            return {
                hz:           centerHz,
                correctionDb: Math.max(-12, Math.min(12, -avgDiff)),
                avgDiff,
            };
        });

        // Suavização entre bandas vizinhas (3-point weighted average)
        // Evita transições abruptas que soam não naturais
        return rawGEQ.map((b, i) => {
            const prev = rawGEQ[i - 1]?.correctionDb ?? b.correctionDb;
            const next = rawGEQ[i + 1]?.correctionDb ?? b.correctionDb;
            const smoothed = prev * 0.15 + b.correctionDb * 0.70 + next * 0.15;
            return { ...b, correctionDb: Math.round(smoothed * 10) / 10 };
        });
    }

    // ─── PEQ (4 bandas paramétricas) ─────────────────────────────────────────

    /**
     * Converte o GEQ numa representação de 4 filtros Bell PEQ.
     *
     * Estratégia:
     *   1. Identifica os 4 picos/vales mais significativos no GEQ
     *   2. Para cada um, calcula:
     *      - Frequência central (hz)
     *      - Ganho (correctionDb)
     *      - Q (estimado pela largura do pico: largura estreita → Q alto)
     *   3. Os 4 filtros cobrem: bass (<200Hz), low-mid (200-800Hz),
     *      high-mid (800-5kHz), treble (>5kHz)
     *
     * A Soundcraft Ui24R tem 4 bandas PEQ por canal (bands 1-4).
     */
    function _calcPEQ(geq) {
        const ZONES = [
            { name: 'Bass',     min:    20, max:   200, band: 1 },
            { name: 'Low-Mid',  min:   200, max:   800, band: 2 },
            { name: 'High-Mid', min:   800, max:  5000, band: 3 },
            { name: 'Treble',   min:  5000, max: 20000, band: 4 },
        ];

        return ZONES.map(zone => {
            const bandsInZone = geq.filter(b => b.hz >= zone.min && b.hz <= zone.max);
            if (bandsInZone.length === 0) {
                return { band: zone.band, name: zone.name, hz: _zoneCenter(zone), gainDb: 0, q: 1.0 };
            }

            // Seleciona a banda com maior desvio absoluto
            const peak = bandsInZone.reduce((a, b) =>
                Math.abs(b.correctionDb) > Math.abs(a.correctionDb) ? b : a
            );

            // Estima Q a partir da largura do pico (nº de bandas consecutivas com mesmo sinal)
            const q = _estimateQ(bandsInZone, peak);

            return {
                band:    zone.band,
                name:    zone.name,
                hz:      peak.hz,
                gainDb:  Math.round(peak.correctionDb * 10) / 10,
                q:       Math.round(q * 10) / 10,
            };
        }).filter(p => Math.abs(p.gainDb) >= 0.5); // só inclui filtros com correção significativa
    }

    function _estimateQ(bandsInZone, peak) {
        // Conta bandas adjacentes com mesmo sinal que o pico
        const sign     = Math.sign(peak.correctionDb);
        const peakIdx  = bandsInZone.indexOf(peak);
        let width      = 1;

        for (let i = peakIdx + 1; i < bandsInZone.length; i++) {
            if (Math.sign(bandsInZone[i].correctionDb) === sign) width++; else break;
        }
        for (let i = peakIdx - 1; i >= 0; i--) {
            if (Math.sign(bandsInZone[i].correctionDb) === sign) width++; else break;
        }

        // Q inversamente proporcional à largura (1 banda → Q≈4, 4 bandas → Q≈1)
        return Math.max(0.5, Math.min(8, 4 / width));
    }

    function _zoneCenter(zone) {
        return Math.round(Math.sqrt(zone.min * zone.max));
    }

    // ─── Aplicação na mesa ────────────────────────────────────────────────────

    /**
     * Envia os filtros PEQ calculados para a mesa Soundcraft via Socket.IO.
     * Usa o novo evento apply_eq_batch (com snapshot + undo).
     *
     * @param {Array}  peqBands   - resultado de analyze().peq
     * @param {string} target     - 'master' | 'channel'
     * @param {number} channel    - número do canal (se target === 'channel')
     */
    function applyToMixer(peqBands, target = 'master', channel = 1) {
        if (!SocketService || !SocketService.isConnected()) {
            console.warn('[AutoEQ] Socket não disponível.');
            return;
        }
        if (!peqBands || peqBands.length === 0) {
            console.warn('[AutoEQ] Sem filtros PEQ para aplicar.');
            return;
        }

        const bands = peqBands.map(f => ({ hz: f.hz, gainDb: f.gainDb, q: f.q, band: f.band }));
        SocketService.emit('apply_eq_batch', { target, channel, bands });

        // Training: envia cada banda como evento de treino
        if (window.AIService && typeof AIService.sendTrainingEvent === 'function') {
            bands.forEach(function (b) {
                AIService.sendTrainingEvent(b.hz, 0, 0, b.gainDb, false);
            });
        }

        const applied = bands.map(f => `Band${f.band}(${f.hz}Hz, ${f.gainDb}dB, Q${f.q})`);
        console.log(`[AutoEQ] PEQ aplicado (${target}): ${applied.join(', ')}`);
        AppStore.setState({ autoEqApplied: { target, channel, bands: peqBands, ts: Date.now() } });
        return applied;
    }

    function requestUndo() {
        if (!SocketService || !SocketService.isConnected()) return;
        SocketService.emit('undo_eq_correction', {});
    }

    // ─── Exportação GEQ ──────────────────────────────────────────────────────

    function exportGEQ() {
        if (!_lastResult) return '';
        const lines = ['Hz,Correction_dB'];
        _lastResult.geq.forEach(b => lines.push(`${b.hz},${b.correctionDb}`));
        return lines.join('\n');
    }

    // ─── Exportação PEQ (Lake / Genérico) ─────────────────────────────────────

    function exportLake(peqBands) {
        if (!peqBands || peqBands.length === 0) return '';
        const lines = ['# Lake Mesa EQ Preset (SoundAssist)', '# Formato: Filtro,Freq(Hz),Gain(dB),Q,Tipo'];
        peqBands.forEach((b, i) => {
            const type = b.type || 'PEQ';
            lines.push(`PEQ${i + 1},${b.hz},${b.gainDb.toFixed(1)},${b.q.toFixed(2)},${type}`);
        });
        return lines.join('\n');
    }

    function exportGenericPEQ(peqBands) {
        if (!peqBands || peqBands.length === 0) return '';
        const lines = ['# SoundAssist PEQ Export', '# freq_hz gain_db q type'];
        peqBands.forEach(b => {
            const type = b.type || 'PEQ';
            lines.push(`${b.hz}\t${b.gainDb.toFixed(1)}\t${b.q.toFixed(2)}\t${type}`);
        });
        return lines.join('\n');
    }

    function downloadEqData(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType || 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ─── Controlo de curva alvo ───────────────────────────────────────────────

    function setTarget(name, customPoints = null) {
        if (name === 'custom' && customPoints) {
            _targetName   = 'custom';
            _customPoints = customPoints;
        } else if (TARGET_CURVES[name]) {
            _targetName   = name;
            _customPoints = null;
        } else {
            console.warn(`[AutoEQ] Curva desconhecida: ${name}. A usar 'flat'.`);
            _targetName = 'flat';
        }
        console.log(`[AutoEQ] Curva alvo: ${_targetName}`);
        AppStore.setState({ autoEqTarget: _targetName });
    }

    function getTargetNames() {
        return Object.entries(TARGET_CURVES).map(([id, c]) => ({ id, name: c.name }));
    }

    function getLastResult() {
        return _lastResult;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _rms(arr) {
        if (!arr.length) return 0;
        return Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length);
    }

    // ─── API pública ──────────────────────────────────────────────────────────

    window.AutoEQ = {
        analyze,
        applyToMixer,
        requestUndo,
        setTarget,
        getTargetNames,
        getLastResult,
        exportGEQ,
        GEQ_BANDS_HZ,
        TARGET_CURVES,
    };

    console.log('[AutoEQ] Motor de Target Curve Matching carregado.');

})();
