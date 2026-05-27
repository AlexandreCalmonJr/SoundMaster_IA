/**
 * SoundMaster Pro — Transfer Function Processor (Dual-Channel AudioWorklet)
 * DSP Engineer: Alexandre Calmon Jr.
 *
 * Algoritmos implementados:
 *  1. Cross-Spectrum (Gxy) via FFT cruzada com janela Hann
 *  2. Phase Response com unwrapping acumulativo e Phase Delay estimado
 *  3. Coerência Magnitude-Squared (MSC) γ² de 0–100%
 *  4. GCC-PHAT Delay Finder com interpolação parabólica sub-sample
 *
 * Protocolo de mensagens (port.onmessage):
 *   { type: 'set-demo',    value: bool }   → ativa modo simulação
 *   { type: 'set-avg',     seconds: 1|2|5 } → janela de média móvel
 *   { type: 'set-fft',     value: potência de 2 } → redimensiona FFT
 *   { type: 'reset' }                      → zera acumuladores
 *
 * Protocolo de saída (port.postMessage):
 *   { type: 'transfer-function', magnitude[], phase[], coherence[],
 *     wrappedPhase[], phaseDelay, delayMs, delaySamples, confidence }
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NOTA: Este processor mantém implementações inline de FFT, Windowing e
 * Spectrum Calculator para autonomia (AudioWorklets não suportam imports ES modules).
 * Versões modulares disponíveis em: dsp/fft-worklet.js, dsp/windowing-worklet.js,
 * dsp/spectrum-worklet.js, dsp/delay-finder.js
 * Bundle combinado em: dsp/worklet-bundle.js
 * ═══════════════════════════════════════════════════════════════════════════════
 */

'use strict';

class TransferFunctionProcessor extends AudioWorkletProcessor {

    // ─── Construtor ───────────────────────────────────────────────────────────

    constructor() {
        super();

        this._fftSize    = 16384;   // potência de 2 → resolução ~2.7 Hz @ 44.1kHz
        this._hopSize    = 4096;    // janela overlap 75% (WOLA)
        this._sr         = sampleRate;

        // Buffers circulares de entrada (ref = Canal 0, meas = Canal 1)
        this._refBuf     = new Float32Array(this._fftSize);
        this._measBuf    = new Float32Array(this._fftSize);
        this._writeIdx   = 0;
        this._hopCount   = 0;       // samples acumulados desde o último compute

        // Modo demo e filtro biquad para simulação realista
        this._demo       = false;
        this._demoDelay  = 480;     // samples ≈ 10.9 ms @ 44.1 kHz
        this._demoWriteIdx = 0;
        this._demoBuf    = new Float32Array(this._fftSize);
        this._filterZ    = [0, 0];
        // Passa-baixas Butterworth 2ª ordem @ ~4 kHz (simula coloração do sistema)
        this._bq = { b0: 0.0196, b1: 0.0392, b2: 0.0196, a1: -1.5548, a2: 0.6330 };

        this._avgSeconds = 2;

        this._buildHann();
        this._allocSpectral();
        this._allocAveraging();
        this._allocDelayFinder();

        this.port.onmessage = (e) => this._onMessage(e.data);
    }

    // ─── Configuração ─────────────────────────────────────────────────────────

    _onMessage(msg) {
        switch (msg.type) {
            case 'set-demo':
            case 'set-demo-mode':
                this._demo = !!msg.value;
                break;
            case 'set-avg':
                this._setAverageSeconds(msg.seconds ?? msg.value);
                break;
            case 'set-fft':
                this._resize(msg.value);
                break;
            case 'reset':
                this._allocSpectral();
                this._allocAveraging();
                break;
        }
    }

    _buildHann() {
        const n = this._fftSize;
        this._hann = new Float32Array(n);
        // Normalização de potência: sum(w²) = N/2 → fator 1/N já aplicado no IFFT
        for (let i = 0; i < n; i++) {
            this._hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
        }
    }

    _allocSpectral() {
        const n = this._fftSize;
        const h = n >>> 1;
        // Acumuladores espectrais do frame atual.
        this._Gxy_re = new Float32Array(h);   // Cross-spectrum real
        this._Gxy_im = new Float32Array(h);   // Cross-spectrum imag
        this._Gxx    = new Float32Array(h);   // Auto-spectrum referência
        this._Gyy    = new Float32Array(h);   // Auto-spectrum medição

        // Pre-allocated buffers to avoid GC pressure
        this._xRe = new Float32Array(n);
        this._xIm = new Float32Array(n);
        this._yRe = new Float32Array(n);
        this._yIm = new Float32Array(n);
        this._magnitude = new Float32Array(h);
        this._coherence = new Float32Array(h);
        this._phaseUnwrapped = new Float32Array(h);

        // Zero GC: pool de wrappedPhase para Transferable
        this._wrappedPhasePool = [new Float32Array(h), new Float32Array(h), new Float32Array(h)];
        this._wrappedPhaseIdx = 0;
    }

    _allocAveraging() {
        const h = this._fftSize >>> 1;
        const frameSec = this._hopSize / this._sr;
        this._avgFrameTarget = Math.max(1, Math.round(this._avgSeconds / frameSec));

        // Zero GC: pré-aloca todos os frames de média no constructor
        this._avgFrames = [];
        for (let i = 0; i < this._avgFrameTarget; i++) {
            this._avgFrames.push({
                magnitude: new Float32Array(h),
                phase: new Float32Array(h),
                coherence: new Float32Array(h),
            });
        }
        this._avgPtr = 0;
        this._avgFillCount = 0;
        this._avgMagSum = new Float64Array(h);
        this._avgPhsSum = new Float64Array(h);
        this._avgCohSum = new Float64Array(h);

        // Zero GC: pool de buffers de saída para Transferable
        this._outMagPool = [new Float32Array(h), new Float32Array(h), new Float32Array(h)];
        this._outPhsPool = [new Float32Array(h), new Float32Array(h), new Float32Array(h)];
        this._outCohPool = [new Float32Array(h), new Float32Array(h), new Float32Array(h)];
        this._outPoolIdx = 0;
    }

    _allocDelayFinder() {
        const n = this._fftSize;
        this._phatRe = new Float32Array(n);
        this._phatIm = new Float32Array(n);
        // Histórico para smoothing do delay (mediana de 32 frames)
        this._delayHist  = new Float32Array(32);
        this._delayHistI = 0;
        this._prevDelayMs = 0;
        this._confidence  = 0;
    }

    _resize(size) {
        if (!Number.isInteger(size) || size < 512 || size > 65536) return;
        if (size & (size - 1)) return; // deve ser pot. de 2
        this._fftSize = size;
        this._hopSize = size >>> 2;
        this._refBuf  = new Float32Array(size);
        this._measBuf = new Float32Array(size);
        this._demoBuf = new Float32Array(size);
        this._writeIdx = 0;
        this._buildHann();
        this._allocSpectral();
        this._allocAveraging();
        this._allocDelayFinder();
        this._hopCount = 0;
        this.port.postMessage({ type: 'fft-size-changed', size });
    }

    _setAverageSeconds(seconds) {
        const value = Number(seconds);
        if (!Number.isFinite(value)) return;
        this._avgSeconds = Math.max(0.1, Math.min(10, value));
        this._allocAveraging();
        this.port.postMessage({
            type: 'avg-changed',
            seconds: this._avgSeconds,
            frames: this._avgFrameTarget
        });
    }

    // ─── AudioWorklet process() ───────────────────────────────────────────────

    process(inputs, outputs) {
        const refCh  = inputs[0]?.[0];
        const measCh = inputs[1]?.[0];

        if (!refCh && !this._demo) return true;

        const blockSize = refCh ? refCh.length : 128;

        if (this._demo) {
            this._feedDemo(blockSize);
        } else {
            this._feedReal(refCh, measCh ?? new Float32Array(blockSize));
        }

        return true;
    }

    // ─── Alimentação de buffers ───────────────────────────────────────────────

    /**
     * Modo Demo: gera ruído rosa banda-larga e aplica delay+filtro para simular canal medido.
     */
    _feedDemo(blockSize) {
        const n   = this._fftSize;
        const hop = this._hopSize;

        for (let i = 0; i < blockSize; i++) {
            // Gerador de ruído rosa (Voss-McCartney simplificado, 5 filtros)
            const w = Math.random() * 2 - 1;
            if (!this._pink) this._pink = { b: new Float64Array(5) };
            const b = this._pink.b;
            b[0] = 0.99886 * b[0] + w * 0.0555179;
            b[1] = 0.99332 * b[1] + w * 0.0750759;
            b[2] = 0.96900 * b[2] + w * 0.1538520;
            b[3] = 0.86650 * b[3] + w * 0.3104856;
            b[4] = 0.55000 * b[4] + w * 0.5329522;
            const pink = (b[0] + b[1] + b[2] + b[3] + b[4] + w * 0.5362) * 0.05;

            // Buffer circular para o delay
            const wi = this._demoWriteIdx % n;
            this._demoBuf[wi] = pink;
            this._demoWriteIdx++;

            // Leitura com delay fixo + ruído de medição + filtro coloração
            const di = ((this._demoWriteIdx - this._demoDelay - 1) % n + n) % n;
            const delayed = this._demoBuf[di] + (Math.random() * 2 - 1) * 0.008;
            const filtered = this._applyBiquad(delayed, this._filterZ, this._bq);

            // Escrita nos buffers de análise
            this._refBuf[this._writeIdx]  = pink;
            this._measBuf[this._writeIdx] = filtered;
            this._writeIdx = (this._writeIdx + 1) % n;
            this._hopCount++;

            if (this._hopCount >= hop) {
                this._hopCount = 0;
                this._computeTF();
            }
        }
    }

    /**
     * Modo Real: alimenta com amostras reais dos dois canais.
     */
    _feedReal(refSamples, measSamples) {
        const n   = this._fftSize;
        const hop = this._hopSize;
        const len = refSamples.length;

        for (let i = 0; i < len; i++) {
            this._refBuf[this._writeIdx]  = refSamples[i];
            this._measBuf[this._writeIdx] = measSamples[i];
            this._writeIdx = (this._writeIdx + 1) % n;
            this._hopCount++;

            if (this._hopCount >= hop) {
                this._hopCount = 0;
                this._computeTF();
            }
        }
    }

    // ─── Núcleo DSP ───────────────────────────────────────────────────────────

    /**
     * Calcula a Função de Transferência H(f) = Gxy / Gxx
     * Coherence γ²(f) = |Gxy|² / (Gxx × Gyy)
     */
    _computeTF() {
        const n = this._fftSize;
        const h = n >>> 1;

        // Copia + aplica janela de Hann
        const xRe = this._xRe;
        const xIm = this._xIm;
        const yRe = this._yRe;
        const yIm = this._yIm;

        // Zero imaginary parts since we reuse them
        xIm.fill(0);
        yIm.fill(0);

        const startIdx = this._writeIdx;
        for (let i = 0; i < n; i++) {
            const w    = this._hann[i];
            const idx  = (startIdx + i) % n; // WOLA: janela sobre dados antigos→novos
            xRe[i] = this._refBuf[idx]  * w;
            yRe[i] = this._measBuf[idx] * w;
        }

        this._fft(xRe, xIm);
        this._fft(yRe, yIm);

        // ── 1. Espectros do frame atual ───────────────────────────────────────
        // Cross-spectrum: Gxy(k) = X*(k) · Y(k)   [conjugado de X vezes Y]
        // Auto-spectra:   Gxx(k) = |X(k)|²,  Gyy(k) = |Y(k)|²
        for (let k = 0; k < h; k++) {
            const xr = xRe[k], xi = xIm[k];
            const yr = yRe[k], yi = yIm[k];

            // X*(k) = (xr, -xi)
            const gxyR = xr * yr + xi * yi;   // Re(X* · Y)
            const gxyI = xr * yi - xi * yr;   // Im(X* · Y)
            const gxx  = xr * xr + xi * xi;
            const gyy  = yr * yr + yi * yi;

            this._Gxy_re[k] = gxyR;
            this._Gxy_im[k] = gxyI;
            this._Gxx[k]    = gxx;
            this._Gyy[k]    = gyy;
        }

        // ── 2. Magnitude, Phase, Coherence ────────────────────────────────────
        const magnitude    = this._magnitude;
        const wrappedPhase = this._wrappedPhasePool[this._wrappedPhaseIdx];
        this._wrappedPhaseIdx = (this._wrappedPhaseIdx + 1) % this._wrappedPhasePool.length;
        if (this._wrappedPhasePool[this._wrappedPhaseIdx].byteLength === 0) {
            this._wrappedPhasePool[this._wrappedPhaseIdx] = new Float32Array(h);
        }
        const coherence    = this._coherence;

        for (let k = 0; k < h; k++) {
            const gxyR = this._Gxy_re[k];
            const gxyI = this._Gxy_im[k];
            const gxx  = this._Gxx[k];
            const gyy  = this._Gyy[k];

            // H(f) = Gxy / Gxx   (estimador H1, mínimo viés com ruído na entrada)
            const hR = gxyR / (gxx + 1e-30);
            const hI = gxyI / (gxx + 1e-30);

            // Magnitude em dB
            const hMag  = Math.sqrt(hR * hR + hI * hI);
            magnitude[k] = 20 * Math.log10(hMag + 1e-12);

            // Fase com wrapping [-π, π]
            wrappedPhase[k] = Math.atan2(hI, hR);

            // MSC: γ²(f) = |Gxy|² / (Gxx · Gyy)
            const gxyMagSq = gxyR * gxyR + gxyI * gxyI;
            const msc = gxyMagSq / (gxx * gyy + 1e-30);
            coherence[k] = Math.max(0, Math.min(1, msc)) * 100; // 0–100%
        }

        // ── 3. Phase Unwrapping ───────────────────────────────────────────────
        const phase = this._unwrapPhase(wrappedPhase);

        // ── 4. Média móvel temporal controlável antes da plotagem ─────────────
        const averaged = this._pushMovingAverage(magnitude, phase, coherence);

        // ── 5. GCC-PHAT Delay Finder ──────────────────────────────────────────
        const delayResult = this._gccPhat();

        // ── 6. Phase Delay médio ponderado (200 Hz – 8 kHz) ───────────────────
        const phaseDelay = this._calcPhaseDelay(averaged.phase, averaged.coherence);

        // ── 7. Envia resultado para o thread principal ─────────────────────────
        // Transfere buffers via zero-copy (Transferable)
        const outMag = averaged.magnitude;
        const outPhs = averaged.phase;
        const outCoh = averaged.coherence;

        this.port.postMessage({
            type:          'transfer-function',
            magnitude:     outMag,
            phase:         outPhs,
            coherence:     outCoh,
            wrappedPhase,
            phaseDelay,
            delayMs:       delayResult.delayMs,
            delaySamples:  delayResult.delaySamples,
            confidence:    delayResult.confidence,
            sampleRate:    this._sr,
            avgSeconds:    this._avgSeconds,
            avgFrames:     this._avgFillCount
        }, [outMag.buffer, outPhs.buffer, outCoh.buffer, wrappedPhase.buffer]);
    }

    // ─── GCC-PHAT ─────────────────────────────────────────────────────────────

    /**
     * Generalized Cross-Correlation with Phase Transform (GCC-PHAT).
     * Robusta a reverberação; usa IFFT da cross-correlation normalizada pela magnitude.
     * Busca limitada a ±delayRange samples para evitar falsos picos.
     */
    _gccPhat() {
        const n        = this._fftSize;
        const h        = n >>> 1;
        const sr       = this._sr;
        // Limite de busca: 50 ms (suficiente para alinhamento de sub-arrays)
        const maxDelay = Math.min(h, Math.floor(0.05 * sr));

        const pRe = this._phatRe;
        const pIm = this._phatIm;

        // Monta cross-spectrum completo (espelho Hermitiano) e aplica PHAT whitening
        for (let k = 0; k < h; k++) {
            const gxyR = this._Gxy_re[k];
            const gxyI = this._Gxy_im[k];
            const mag  = Math.sqrt(gxyR * gxyR + gxyI * gxyI) + 1e-30;

            pRe[k]     =  gxyR / mag;
            pIm[k]     =  gxyI / mag;
            // Espelho para garantir sinal real no IFFT
            if (k > 0 && k < h) {
                pRe[n - k] =  pRe[k];
                pIm[n - k] = -pIm[k];
            }
        }
        pRe[0] = pIm[0] = 0;     // Remove componente DC
        pRe[h] = pIm[h] = 0;     // Nyquist

        this._ifft(pRe, pIm);

        // Busca o pico dentro da janela ±maxDelay
        let maxVal  = -Infinity;
        let peakIdx = 0;

        // [0 … maxDelay] = lags positivos
        for (let i = 0; i <= maxDelay; i++) {
            if (pRe[i] > maxVal) { maxVal = pRe[i]; peakIdx = i; }
        }
        // [n-maxDelay … n-1] = lags negativos
        for (let i = n - maxDelay; i < n; i++) {
            if (pRe[i] > maxVal) { maxVal = pRe[i]; peakIdx = i; }
        }

        // Sub-sample refinement: interpolação parabólica
        const refined = this._parabolic(pRe, peakIdx, n);

        // Converte para delay com sinal: lags > n/2 são lags negativos
        let delaySamples = refined > h ? refined - n : refined;

        // Clamp seguro
        delaySamples = Math.max(-maxDelay, Math.min(maxDelay, delaySamples));
        const delayMs = (delaySamples / sr) * 1000;

        // Smoothing por mediana circular (estável a outliers)
        this._delayHist[this._delayHistI % this._delayHist.length] = delayMs;
        this._delayHistI++;
        const sorted  = this._delayHist.slice().sort((a, b) => a - b);
        const median  = sorted[Math.floor(sorted.length / 2)];

        // Confiança: estabilidade temporal do delay
        const drift = Math.abs(delayMs - this._prevDelayMs);
        this._confidence = drift < 1.0
            ? Math.min(1, this._confidence + 0.04)
            : Math.max(0, this._confidence - 0.08);
        this._prevDelayMs = delayMs;

        return {
            delayMs:      median,
            delaySamples: Math.round(median * sr / 1000),
            confidence:   this._confidence
        };
    }

    /** Interpolação parabólica sub-sample ao redor do pico */
    _parabolic(buf, idx, n) {
        const prev = buf[(idx - 1 + n) % n];
        const curr = buf[idx];
        const next = buf[(idx + 1) % n];
        const denom = 2 * (2 * curr - prev - next);
        if (Math.abs(denom) < 1e-12) return idx;
        return idx + (prev - next) / denom;
    }

    // ─── Phase Unwrapping ─────────────────────────────────────────────────────

    /**
     * Unwrapping acumulativo de fase.
     * A cada frame, calcula a fase desembrulhada relativa ao frame anterior
     * usando o estado salvo `_unwrapAcc`.
     */
    _unwrapPhase(wrapped) {
        const h = this._fftSize >>> 1;
        const out = this._phaseUnwrapped; // reuse pre-allocated array!
        if (h === 0) return out;

        let correction = 0;
        out[0] = wrapped[0];

        for (let k = 1; k < h; k++) {
            let delta = wrapped[k] - wrapped[k - 1];
            if (delta > Math.PI) {
                correction -= 2 * Math.PI;
            } else if (delta < -Math.PI) {
                correction += 2 * Math.PI;
            }
            out[k] = wrapped[k] + correction;
        }
        return out;
    }

    _pushMovingAverage(magnitude, phase, coherence) {
        const h = this._fftSize >>> 1;

        const frame = this._avgFrames[this._avgPtr];

        // Subtract old values only when buffer is fully warm
        if (this._avgFillCount >= this._avgFrameTarget) {
            for (let k = 0; k < h; k++) {
                this._avgMagSum[k] -= frame.magnitude[k];
                this._avgPhsSum[k] -= frame.phase[k];
                this._avgCohSum[k] -= frame.coherence[k];
            }
        }

        // Copy new values into the existing arrays (reuse — zero GC!)
        frame.magnitude.set(magnitude);
        frame.phase.set(phase);
        frame.coherence.set(coherence);

        for (let k = 0; k < h; k++) {
            this._avgMagSum[k] += frame.magnitude[k];
            this._avgPhsSum[k] += frame.phase[k];
            this._avgCohSum[k] += frame.coherence[k];
        }

        this._avgPtr = (this._avgPtr + 1) % this._avgFrameTarget;
        if (this._avgFillCount < this._avgFrameTarget) {
            this._avgFillCount++;
        }

        const count = Math.max(1, this._avgFillCount);
        const outMag = this._outMagPool[this._outPoolIdx];
        const outPhs = this._outPhsPool[this._outPoolIdx];
        const outCoh = this._outCohPool[this._outPoolIdx];
        this._outPoolIdx = (this._outPoolIdx + 1) % this._outMagPool.length;
        // Re-create detached buffers if needed (cycling via Transferable)
        if (this._outMagPool[this._outPoolIdx].byteLength === 0) {
            this._outMagPool[this._outPoolIdx] = new Float32Array(h);
            this._outPhsPool[this._outPoolIdx] = new Float32Array(h);
            this._outCohPool[this._outPoolIdx] = new Float32Array(h);
        }

        for (let k = 0; k < h; k++) {
            outMag[k] = this._avgMagSum[k] / count;
            outPhs[k] = this._avgPhsSum[k] / count;
            outCoh[k] = this._avgCohSum[k] / count;
        }

        return { magnitude: outMag, phase: outPhs, coherence: outCoh };
    }

    // ─── Phase Delay Médio ────────────────────────────────────────────────────

    /**
     * Estima o atraso de fase médio τ = -φ(f) / (2πf) na banda 200–8000 Hz,
     * ponderado pela coerência (bins com baixa coerência têm menos peso).
     * Retorna em milissegundos.
     */
    _calcPhaseDelay(phase, coherence) {
        const h      = this._fftSize >>> 1;
        const hzBin  = this._sr / this._fftSize;
        const kLow   = Math.ceil(200  / hzBin);
        const kHigh  = Math.floor(8000 / hzBin);

        let wSum = 0, wTotal = 0;

        for (let k = kLow; k <= kHigh && k < h; k++) {
            const freq = k * hzBin;
            const pd   = -phase[k] / (2 * Math.PI * freq) * 1000; // ms
            if (!isFinite(pd) || Math.abs(pd) > 200) continue;

            const w = Math.max(0.01, coherence[k] / 100);
            wSum   += pd * w;
            wTotal += w;
        }

        return wTotal > 0 ? wSum / wTotal : 0;
    }

    // ─── Biquad IIR ───────────────────────────────────────────────────────────

    /**
     * Filtro biquad — Transposed Direct Form II (TDF-II).
     *
     * Equação de estado:
     *   y    = b0·x + z[0]
     *   z[0] = b1·x − a1·y + z[1]
     *   z[1] = b2·x − a2·y
     *
     * Vantagens sobre DF-I/DF-II clássica:
     *  - Numericamente mais estável (mesmo método do Web Audio BiquadFilterNode)
     *  - Apenas 2 registros de estado (mínimo possível para 2ª ordem)
     *  - Sem armazenamento de amostras passadas de entrada (sem atraso de x)
     *
     * FIX P1: Versão anterior salvava `x` em z[0] (topologia híbrida incorreta)
     * produzindo resposta de frequência errada no modo Demo.
     */
    _applyBiquad(x, z, c) {
        const y  = c.b0 * x + z[0];
        z[0] = c.b1 * x - c.a1 * y + z[1];
        z[1] = c.b2 * x - c.a2 * y;
        return y;
    }

    // ─── FFT Cooley-Tukey In-Place (Radix-2 DIT) ─────────────────────────────

    /**
     * FFT in-place. real[] e imag[] devem ter comprimento = potência de 2.
     * Converte para espectro complexo de comprimento N.
     */
    _fft(re, im) {
        const n = re.length;

        // Bit-reversal permutation
        for (let i = 0, j = 0; i < n; i++) {
            if (i < j) {
                let t = re[i]; re[i] = re[j]; re[j] = t;
                    t = im[i]; im[i] = im[j]; im[j] = t;
            }
            let m = n >>> 1;
            while (m >= 1 && j >= m) { j -= m; m >>>= 1; }
            j += m;
        }

        // Butterfly stages
        for (let len = 2; len <= n; len <<= 1) {
            const halfLen = len >>> 1;
            const ang = -Math.PI / halfLen; // sinal negativo = FFT direta
            const wBaseR = Math.cos(ang);
            const wBaseI = Math.sin(ang);

            for (let i = 0; i < n; i += len) {
                let wR = 1, wI = 0;
                for (let j = 0; j < halfLen; j++) {
                    const uR = re[i + j];
                    const uI = im[i + j];
                    const vR = re[i + j + halfLen] * wR - im[i + j + halfLen] * wI;
                    const vI = re[i + j + halfLen] * wI + im[i + j + halfLen] * wR;
                    re[i + j]          = uR + vR;
                    im[i + j]          = uI + vI;
                    re[i + j + halfLen] = uR - vR;
                    im[i + j + halfLen] = uI - vI;
                    const nwR = wR * wBaseR - wI * wBaseI;
                    wI = wR * wBaseI + wI * wBaseR;
                    wR = nwR;
                }
            }
        }
    }

    /** IFFT: conjuga → FFT → conjuga → escala por 1/N */
    _ifft(re, im) {
        const n = re.length;
        // Conjuga para inverter sinal de fase
        for (let i = 0; i < n; i++) im[i] = -im[i];
        this._fft(re, im);
        const invN = 1 / n;
        for (let i = 0; i < n; i++) {
            re[i] *=  invN;
            im[i] *= -invN; // conjuga de volta + escala
        }
    }
}

registerProcessor('transfer-function-processor', TransferFunctionProcessor);
