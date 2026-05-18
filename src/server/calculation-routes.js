/**
 * SoundMaster — Calculation Routes
 * Rotas HTTP para cálculos pesados no servidor.
 *
 * Endpoints:
 *   POST /api/calculate/auto-eq    → PEQ + GEQ + stats
 *   POST /api/calculate/rt60       → Schroeder curve + métricas
 *   POST /api/calculate/spl        → SPL ponderado + crest factor
 *   POST /api/calculate/feedback   → Feedback risk analysis
 */

const express = require('express');
const router = express.Router();

// ── Auto-EQ Calculation ──

router.post('/auto-eq', (req, res) => {
    try {
        const { freqData, sampleRate, fftSize, targetCurve } = req.body;

        if (!freqData || !Array.isArray(freqData) || freqData.length === 0) {
            return res.status(400).json({ error: 'freqData é obrigatório e deve ser um array não vazio' });
        }

        const sr = sampleRate || 48000;
        const fft = fftSize || 8192;
        const hzPerBin = sr / fft;

        // Target curves
        const targets = {
            flat: [[20, 0], [20000, 0]],
            smaart: [[20, 3], [80, 2], [315, 0.5], [630, 0], [2500, -0.5], [5000, -1.5], [10000, -3], [20000, -6]],
            tilt: [[20, 0], [2000, 0], [4000, -1.5], [8000, -3], [16000, -6], [20000, -7.5]],
            xcurve: [[20, 0], [2000, 0], [10000, -3], [16000, -7], [20000, -10]],
            presence: [[20, 0], [80, -1], [250, 0], [800, 0.5], [1500, 1.5], [3000, 2], [5000, 1.5], [8000, 0], [16000, -1.5], [20000, -3]],
        };

        const targetPts = targets[targetCurve] || targets.flat;

        // Interpolação log-linear
        function interpTarget(hz) {
            const logF = Math.log10(Math.max(hz, 1));
            for (let i = 0; i < targetPts.length - 1; i++) {
                const [f1, d1] = targetPts[i];
                const [f2, d2] = targetPts[i + 1];
                const log1 = Math.log10(Math.max(f1, 1));
                const log2 = Math.log10(Math.max(f2, 1));
                if (logF >= log1 && logF <= log2) {
                    const t = (logF - log1) / (log2 - log1);
                    return d1 + t * (d2 - d1);
                }
            }
            return targetPts[targetPts.length - 1][1];
        }

        // GEQ 31 bandas ISO
        const GEQ_BANDS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];

        const geq = GEQ_BANDS.map(centerHz => {
            const fLow = centerHz / Math.pow(2, 1 / 3);
            const fHigh = centerHz * Math.pow(2, 1 / 3);
            const kLow = Math.max(1, Math.round(fLow / hzPerBin));
            const kHigh = Math.min(freqData.length - 1, Math.round(fHigh / hzPerBin));

            if (kHigh <= kLow) return { hz: centerHz, correctionDb: 0 };

            let sumDiff = 0, count = 0;
            for (let k = kLow; k <= kHigh; k++) {
                const measured = freqData[k] || -100;
                const target = interpTarget(centerHz);
                sumDiff += measured - target;
                count++;
            }

            const avgDiff = count > 0 ? sumDiff / count : 0;
            return {
                hz: centerHz,
                correctionDb: Math.round(Math.max(-12, Math.min(12, -avgDiff)) * 10) / 10,
            };
        });

        // Smooth GEQ
        const smoothedGeq = geq.map((b, i) => {
            const prev = geq[i - 1]?.correctionDb ?? b.correctionDb;
            const next = geq[i + 1]?.correctionDb ?? b.correctionDb;
            const smoothed = prev * 0.15 + b.correctionDb * 0.70 + next * 0.15;
            return { ...b, correctionDb: Math.round(smoothed * 10) / 10 };
        });

        // PEQ 4 bandas
        const ZONES = [
            { name: 'Bass', min: 20, max: 200, band: 1 },
            { name: 'Low-Mid', min: 200, max: 800, band: 2 },
            { name: 'High-Mid', min: 800, max: 5000, band: 3 },
            { name: 'Treble', min: 5000, max: 20000, band: 4 },
        ];

        const peq = ZONES.map(zone => {
            const bandsInZone = smoothedGeq.filter(b => b.hz >= zone.min && b.hz <= zone.max);
            if (bandsInZone.length === 0) {
                return { band: zone.band, name: zone.name, hz: Math.round(Math.sqrt(zone.min * zone.max)), gainDb: 0, q: 1.0 };
            }
            const peak = bandsInZone.reduce((a, b) => Math.abs(b.correctionDb) > Math.abs(a.correctionDb) ? b : a);
            return {
                band: zone.band,
                name: zone.name,
                hz: peak.hz,
                gainDb: peak.correctionDb,
                q: 1.4,
            };
        }).filter(p => Math.abs(p.gainDb) >= 0.5);

        // Stats
        const corrections = smoothedGeq.map(b => b.correctionDb);
        const rms = Math.sqrt(corrections.reduce((s, v) => s + v * v, 0) / corrections.length);
        const maxDev = Math.max(...corrections.map(Math.abs));
        const bandsOver1 = corrections.filter(v => Math.abs(v) > 1).length;

        // Target curve sampled
        const curve = GEQ_BANDS.map(hz => ({ hz, targetDb: interpTarget(hz) }));

        res.json({
            peq,
            geq: smoothedGeq,
            curve,
            stats: {
                rms: Math.round(rms * 10) / 10,
                max: Math.round(maxDev * 10) / 10,
                bands: bandsOver1,
            },
        });
    } catch (err) {
        console.error('[CalcRoutes] Auto-EQ error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── RT60 Calculation ──

router.post('/rt60', (req, res) => {
    try {
        const { impulseResponse, sampleRate } = req.body;

        if (!impulseResponse || !Array.isArray(impulseResponse) || impulseResponse.length < 100) {
            return res.status(400).json({ error: 'impulseResponse é obrigatório (min 100 samples)' });
        }

        const sr = sampleRate || 48000;
        const ir = new Float32Array(impulseResponse);
        const n = ir.length;

        // Energia da IR
        const energy = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            energy[i] = ir[i] * ir[i];
        }

        // Curva de Schroeder (integral reversa)
        const schroeder = new Float32Array(n);
        let sum = 0;
        for (let i = n - 1; i >= 0; i--) {
            sum += energy[i];
            schroeder[i] = sum;
        }

        // Normalizar para dB
        const maxEnergy = schroeder[0] || 1;
        const schroederDb = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            schroederDb[i] = 10 * Math.log10(schroeder[i] / maxEnergy + 1e-30);
        }

        // Encontrar RT60 (tempo para decair 60dB do pico)
        const peakIdx = schroederDb.findIndex(v => v > -5);
        const targetDb = -60;

        let rt60Idx = n - 1;
        for (let i = peakIdx; i < n; i++) {
            if (schroederDb[i] <= targetDb) {
                rt60Idx = i;
                break;
            }
        }

        const rt60 = (rt60Idx - peakIdx) / sr;

        // EDT (-10dB), T20 (-5 to -25), T30 (-5 to -35)
        function findDecayTime(startDb, endDb) {
            let startI = -1, endI = -1;
            for (let i = peakIdx; i < n; i++) {
                if (startI === -1 && schroederDb[i] <= startDb) startI = i;
                if (startI !== -1 && endI === -1 && schroederDb[i] <= endDb) { endI = i; break; }
            }
            if (startI === -1 || endI === -1) return null;
            const range = startDb - endDb;
            const extrapolated = (endI - startI) / sr * (60 / range);
            return extrapolated;
        }

        const edt = findDecayTime(0, -10);
        const t20 = findDecayTime(-5, -25);
        const t30 = findDecayTime(-5, -35);

        // C50 (clareza)
        const c50Idx = Math.round(0.050 * sr);
        let earlyEnergy = 0, lateEnergy = 0;
        for (let i = 0; i < n; i++) {
            if (i < c50Idx) earlyEnergy += energy[i];
            else lateEnergy += energy[i];
        }
        const c50 = lateEnergy > 0 ? 10 * Math.log10(earlyEnergy / lateEnergy) : 0;

        // C80 (clareza musical)
        const c80Idx = Math.round(0.080 * sr);
        earlyEnergy = 0; lateEnergy = 0;
        for (let i = 0; i < n; i++) {
            if (i < c80Idx) earlyEnergy += energy[i];
            else lateEnergy += energy[i];
        }
        const c80 = lateEnergy > 0 ? 10 * Math.log10(earlyEnergy / lateEnergy) : 0;

        // D50 (definição)
        const d50Idx = Math.round(0.050 * sr);
        let dEarly = 0, dTotal = 0;
        for (let i = 0; i < n; i++) {
            dTotal += energy[i];
            if (i < d50Idx) dEarly += energy[i];
        }
        const d50 = dTotal > 0 ? (dEarly / dTotal) * 100 : 0;

        // STI estimado
        const sti = Math.max(0, Math.min(1, 1 - rt60 / 4));
        const stiCategory = sti >= 0.75 ? 'Excelente' : sti >= 0.6 ? 'Bom' : sti >= 0.45 ? 'Razoável' : 'Ruim';

        // Truncar curva para retorno (max 2000 pontos)
        const step = Math.max(1, Math.floor(n / 2000));
        const truncatedCurve = [];
        for (let i = 0; i < n; i += step) {
            truncatedCurve.push(parseFloat(schroederDb[i].toFixed(2)));
        }

        res.json({
            rt60: parseFloat(rt60.toFixed(3)),
            edt: edt ? parseFloat(edt.toFixed(3)) : null,
            t20: t20 ? parseFloat(t20.toFixed(3)) : null,
            t30: t30 ? parseFloat(t30.toFixed(3)) : null,
            c50: parseFloat(c50.toFixed(1)),
            c80: parseFloat(c80.toFixed(1)),
            d50: parseFloat(d50.toFixed(1)),
            sti: parseFloat(sti.toFixed(2)),
            sti_category: stiCategory,
            curve: truncatedCurve,
        });
    } catch (err) {
        console.error('[CalcRoutes] RT60 error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── SPL Calculation ──

router.post('/spl', (req, res) => {
    try {
        const { freqData, timeData, sampleRate, weighting } = req.body;

        if (!freqData || !Array.isArray(freqData)) {
            return res.status(400).json({ error: 'freqData é obrigatório' });
        }

        const sr = sampleRate || 48000;
        const w = weighting || 'A';
        const hzPerBin = sr / (freqData.length * 2);

        // Weighting functions
        function aWeight(f) {
            if (f < 10) return -100;
            const f2 = f * f, f4 = f2 * f2;
            const rA = (12194 * 12194 * f4) / ((f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194));
            return 20 * Math.log10(rA + 1e-30) + 2.00;
        }

        function cWeight(f) {
            if (f < 10) return -100;
            const f2 = f * f;
            const rC = (12194 * 12194 * f2) / ((f2 + 20.6 * 20.6) * (f2 + 12194 * 12194));
            return 20 * Math.log10(rC + 1e-30) + 0.06;
        }

        function getWeight(type, f) {
            if (type === 'A') return aWeight(f);
            if (type === 'C') return cWeight(f);
            return 0;
        }

        let sumPwr = 0;
        for (let k = 1; k < freqData.length; k++) {
            const freq = k * hzPerBin;
            const dbW = freqData[k] + getWeight(w, freq);
            sumPwr += Math.pow(10, dbW / 10);
        }

        const rmsDb = 10 * Math.log10(sumPwr + 1e-30) - 94;

        // Peak e Crest Factor
        let peak = 0;
        if (timeData && Array.isArray(timeData)) {
            for (let i = 0; i < timeData.length; i++) {
                const val = Math.abs(timeData[i]);
                if (val > peak) peak = val;
            }
        }

        const peakDb = 20 * Math.log10(peak + 1e-12);
        const crestFactor = peakDb - rmsDb;

        res.json({
            rmsDb: parseFloat(rmsDb.toFixed(1)),
            peakDb: parseFloat(peakDb.toFixed(1)),
            crestFactor: parseFloat(crestFactor.toFixed(1)),
            weighting: w,
            isClipping: peak > 0.98,
        });
    } catch (err) {
        console.error('[CalcRoutes] SPL error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── Feedback Risk Analysis ──

router.post('/feedback', (req, res) => {
    try {
        const { peakHistory, threshold } = req.body;

        if (!peakHistory || !Array.isArray(peakHistory) || peakHistory.length < 5) {
            return res.status(400).json({ error: 'peakHistory é obrigatório (min 5 entries)' });
        }

        const thresh = threshold || -20;
        const recent = peakHistory.slice(-15);

        if (recent.length < 10) {
            return res.json({ isFeedback: false, confidence: 0, reason: 'Insufficient data' });
        }

        const avgHz = recent.reduce((s, p) => s + p.hz, 0) / recent.length;
        const allSimilar = recent.every(p => Math.abs(Math.log2(p.hz / avgHz)) < 1 / 6);
        const allAbove = recent.every(p => p.db > thresh);

        const isFeedback = allSimilar && allAbove;

        // Confidence based on consistency
        const freqVariance = recent.reduce((s, p) => s + Math.pow(Math.log2(p.hz / avgHz), 2), 0) / recent.length;
        const confidence = Math.max(0, Math.min(1, 1 - freqVariance * 10));

        res.json({
            isFeedback,
            confidence: parseFloat(confidence.toFixed(2)),
            freqHz: Math.round(avgHz),
            avgDb: parseFloat((recent.reduce((s, p) => s + p.db, 0) / recent.length).toFixed(1)),
        });
    } catch (err) {
        console.error('[CalcRoutes] Feedback error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
