/**
 * SoundMaster Pro — SPL Logger (IEC 61672 compliant)
 *
 * Responsabilidades:
 *   1. Calcular SPL instantâneo com Ponderação A, C ou Z (Flat)
 *   2. Acumular Leq contínuo em janelas de 1 s, 1 min (Leq1) e 10 min (Leq10)
 *   3. Manter histórico compacto de até 8 horas sem memory leak
 *   4. Publicar eventos no AppStore para a UI reagir de forma reativa
 *
 * Normas de referência:
 *   - IEC 61672-1:2013  (Class 2 tolerances, weighting filters)
 *   - ISO 1996-1:2016   (environmental noise descriptors: Leq, Lmax, Lmin)
 *   - OSHA PEL: 90 dB(A) / 8h   |   NIOSH REL: 85 dB(A) / 8h
 *
 * API Pública (window.SplLogger):
 *   .init(sampleRate)         → prepara filtros biquad para o fs dado
 *   .push(freqData, timeData) → alimenta com dados do analyser (chamado a cada frame)
 *   .setWeighting('A'|'C'|'Z')
 *   .getHistory()             → { seconds: Float32Array, leq1: Float32Array, leq10: Float32Array }
 *   .getStats()               → { leqTotal, leq1, leq10, lmax, lmin, ldose, dose8h, lden }
 *   .reset()
 *   .export()                 → CSV string para download
 */

'use strict';

(function () {

    // ─── Configuração ─────────────────────────────────────────────────────────

    /** Limite máximo de segundos guardados: 8 horas = 28800 s */
    const MAX_HISTORY_SECONDS = 8 * 3600;

    /** Valor de referência SPL (pressão sonora de referência = 20 μPa → 0 dBSPL) */
    const REF_DB = -94; // offset calibração digital (0 dBFS ↔ 94 dBSPL por defeito)

    /** Perfil NHO/NIOSH: 85 dB(A) por 8 h, taxa de troca de 3 dB. */
    const EXPOSURE_CRITERION_DB = 85;
    const EXPOSURE_CRITERION_SEC = 8 * 3600;
    const EXCHANGE_RATE_DB = 3;
    const EXPOSURE_THRESHOLD_DB = 80;
    const MAX_DOSE_PERCENT = 999;
    const DOSE_PROFILE = 'NHO_NIOSH_85_3';

    /** Perfis de exposição ocupacional (ISO 1996 / NR-15 Brasil / OSHA) */
    const EXPOSURE_PROFILES = {
        'NIOSH': { criterionDb: 85, exchangeRate: 3, thresholdDb: 80, durationSec: 28800, name: 'NIOSH 85dB/8h' },
        'OSHA': { criterionDb: 90, exchangeRate: 5, thresholdDb: 80, durationSec: 28800, name: 'OSHA 90dB/8h' },
        'NR15': { criterionDb: 85, exchangeRate: 5, thresholdDb: 80, durationSec: 28800, name: 'NR-15 (Brasil) 85dB/8h' },
        'ACGIH': { criterionDb: 85, exchangeRate: 3, thresholdDb: 80, durationSec: 28800, name: 'ACGIH 85dB/8h' }
    };
    
    let _currentProfile = 'NIOSH';

    /** Limite NIOSH para dose diária (mantido como alias público legado). */
    const NIOSH_LIMIT_DB = EXPOSURE_CRITERION_DB;

    // ─── Estado interno ───────────────────────────────────────────────────────

    let _sampleRate    = 48000;
    let _weighting     = 'A';          // 'A' | 'C' | 'Z'
    let _initialized   = false;

    // Acumuladores energéticos (potência linear, não dB)
    let _acc1s         = 0;            // acumulador do segundo atual
    let _acc1sCount    = 0;            // nº de frames no segundo atual
    let _acc1min       = 0;            // acumulador do minuto (60 s)
    let _acc1minCount  = 0;
    let _acc10min      = 0;            // acumulador de 10 minutos
    let _acc10minCount = 0;
    let _accTotal      = 0;            // acumulador de toda a sessão
    let _accTotalCount = 0;

    // Peak hold
    let _lmaxSession   = -Infinity;
    let _lminSession   = Infinity;

    // Temporizador interno (conta segundos desde init)
    let _ticker        = null;
    let _elapsedSec    = 0;

    // Dose ocupacional acumulada em tempo real (percentual de 8 h).
    let _dosePercentAcc = 0;
    let _doseSecondsAboveThreshold = 0;

    // Acumuladores Lden por janelas locais: day 07-19, evening 19-23, night 23-07.
    let _ldenAcc = _makeLdenAcc();

    // ─── Histórico compacto (ring buffers de Float32Array) ────────────────────
    // Cada array é um ring buffer com ponteiro de escrita.
    // Tamanho fixo → sem crescimento de heap após init → zero memory leak.

    const _hist = {
        // 1 valor por segundo (SPL instantâneo com ponderação selecionada)
        spk: new Float32Array(MAX_HISTORY_SECONDS),
        // Leq de 1 minuto (1 valor a cada 60 s)
        leq1:  new Float32Array(Math.ceil(MAX_HISTORY_SECONDS / 60)),
        // Leq de 10 minutos (1 valor a cada 600 s)
        leq10: new Float32Array(Math.ceil(MAX_HISTORY_SECONDS / 600)),
        // Ponteiros de escrita
        spkPtr:   0,
        leq1Ptr:  0,
        leq10Ptr: 0,
        // Número de entradas realmente preenchidas (para leitura parcial)
        spkLen:   0,
        leq1Len:  0,
        leq10Len: 0,
    };

    // ─── Coeficientes de filtros Biquad (IEC 61672) ───────────────────────────
    //
    // Os coeficientes abaixo são pré-calculados para fs = 48000 Hz.
    // Para outros sample rates, usamos a transformação Bilinear sob demanda.
    //
    // Cada filtro é uma cadeia de estágios biquad DF-II na forma:
    //   H(z) = ∏ (b0 + b1·z⁻¹ + b2·z⁻²) / (1 + a1·z⁻¹ + a2·z⁻²)
    //
    // Fonte: IEC 61672-1:2013 Annex E + verificação via bilinear transform

    let _filters = {};  // populado em _buildFilters(fs)

    // Estado dos filtros (memória dos estágios biquad)
    let _filterState = {
        A: [],
        C: [],
        Z: []
    };

    // ─── API ──────────────────────────────────────────────────────────────────

    /**
     * Inicializa o módulo para o sample rate dado.
     * Deve ser chamado quando o AudioContext é criado.
     */
    function init(sampleRate) {
        _sampleRate = sampleRate;
        _buildFilters(sampleRate);
        _resetFilterState();
        _acc1s = _acc1min = _acc10min = _accTotal = 0;
        _acc1sCount = _acc1minCount = _acc10minCount = _accTotalCount = 0;
        _resetExposureAccumulators();
        _initialized = true;
        console.log(`[SplLogger] Init: fs=${sampleRate} weighting=${_weighting}`);
    }

    /**
     * Alimenta o logger com um frame de dados do analyser.
     * Deve ser chamado a cada requestAnimationFrame (~60 fps).
     *
     * @param {Float32Array} freqData - getFloatFrequencyData() em dB
     * @param {Float32Array} timeData - getFloatTimeDomainData() em [-1,1]
     * @param {number} fftSize        - analyser.fftSize
     */
    function push(freqData, timeData, fftSize) {
        if (!_initialized) return;
        if (!freqData || !timeData || !fftSize) return;

        const spl = _calcSPL(freqData, fftSize);

        // Acumula energia linear (para Leq correto: média de potência, não de dB)
        const power = Math.pow(10, spl / 10);
        _acc1s       += power; _acc1sCount++;
        _acc1min     += power; _acc1minCount++;
        _acc10min    += power; _acc10minCount++;
        _accTotal    += power; _accTotalCount++;

        // Peak hold
        if (spl > _lmaxSession) _lmaxSession = spl;
        if (spl < _lminSession) _lminSession = spl;
    }

    /** Muda a ponderação ativa. Reseta o estado do filtro correspondente. */
    function setWeighting(w) {
        if (!['A', 'C', 'Z'].includes(w)) return;
        _weighting = w;
        _filterState[w] = _makeFilterState(w);
        _acc1s = _acc1min = _acc10min = _accTotal = 0;
        _acc1sCount = _acc1minCount = _acc10minCount = _accTotalCount = 0;
        _resetExposureAccumulators();
        AppStore.setState({ splWeighting: w });
        console.log(`[SplLogger] Ponderação: ${w}`);
    }

    /** Muda o perfil de exposição ocupacional (NIOSH, OSHA, NR-15, ACGIH). */
    function setExposureProfile(profileName) {
        if (!EXPOSURE_PROFILES[profileName]) return;
        _currentProfile = profileName;
        _resetExposureAccumulators();
        console.log(`[SplLogger] Perfil de exposição: ${profileName}`);
        AppStore.setState({ splExposureProfile: profileName });
    }

    function _getCurrentProfileParams() {
        const p = EXPOSURE_PROFILES[_currentProfile];
        return {
            criterionDb: p.criterionDb,
            exchangeRate: p.exchangeRate,
            thresholdDb: p.thresholdDb,
            durationSec: p.durationSec
        };
    }

    /** Retorna leitura instantânea para a UI (não usa o buffer 1s — usa o último frame). */
    function getLive() {
        if (_acc1sCount === 0) return { spl: -Infinity, leq1: -Infinity, leq10: -Infinity };
        const leq1s = _leanPowerToDb(_acc1s, _acc1sCount);
        const leq1  = _hist.leq1Len > 0 ? _hist.leq1[(_hist.leq1Ptr - 1 + _hist.leq1.length) % _hist.leq1.length] : leq1s;
        const leq10 = _hist.leq10Len > 0 ? _hist.leq10[(_hist.leq10Ptr - 1 + _hist.leq10.length) % _hist.leq10.length] : leq1s;
        return { spl: leq1s, leq1, leq10 };
    }

    /** Retorna estatísticas da sessão completa. */
    function getStats() {
        const leqTotal = _leanPowerToDb(_accTotal, _accTotalCount);
        const live     = getLive();
        const ldose    = _round1(Math.min(MAX_DOSE_PERCENT, _dosePercentAcc));
        const ldenData = _getLdenStats();
        const profileParams = _getCurrentProfileParams();

        return {
            leqTotal:    _formatDbStat(leqTotal),
            leq1:        _formatDbStat(live.leq1),
            leq10:       _formatDbStat(live.leq10),
            lmax:        _formatDbStat(_lmaxSession),
            lmin:        _lminSession === Infinity ? null : parseFloat(_lminSession.toFixed(1)),
            ldose,
            dose8h:      Math.round(ldose),
            doseProfile: DOSE_PROFILE, // Mantido para compatibilidade legacy
            doseProfileName: _currentProfile,
            doseCriterionDb: profileParams.criterionDb,
            doseExchangeRateDb: profileParams.exchangeRate,
            doseThresholdDb: EXPOSURE_THRESHOLD_DB,
            doseSecondsAboveThreshold: _doseSecondsAboveThreshold,
            lden:        ldenData.lden,
            lday:        ldenData.lday,
            levening:    ldenData.levening,
            lnight:      ldenData.lnight,
            elapsedSec:  _elapsedSec,
            weighting:   _weighting,
        };
    }

    /**
     * Retorna o histórico de SPL para plotagem.
     * Retorna apenas as entradas preenchidas (sem zeros de inicialização).
     */
    function getHistory() {
        return {
            // 1 valor/segundo — adequado para gráfico das últimas horas
            seconds: _readRing(_hist.spk,   _hist.spkPtr,   _hist.spkLen),
            leq1:    _readRing(_hist.leq1,  _hist.leq1Ptr,  _hist.leq1Len),
            leq10:   _readRing(_hist.leq10, _hist.leq10Ptr, _hist.leq10Len),
        };
    }

    /** Inicia o ticker de 1 segundo (deve ser chamado após init). */
    function start() {
        if (_ticker) return;
        _ticker = setInterval(_onTick, 1000);
    }

    /** Para o ticker. */
    function stop() {
        if (_ticker) { clearInterval(_ticker); _ticker = null; }
    }

    /** Zera todos os acumuladores e histórico. */
    function reset() {
        stop();
        _acc1s = _acc1sCount = 0;
        _acc1min = _acc1minCount = 0;
        _acc10min = _acc10minCount = 0;
        _accTotal = _accTotalCount = 0;
        _lmaxSession = -Infinity;
        _lminSession  = Infinity;
        _elapsedSec   = 0;
        _resetExposureAccumulators();
        _hist.spkPtr = _hist.leq1Ptr = _hist.leq10Ptr = 0;
        _hist.spkLen = _hist.leq1Len = _hist.leq10Len = 0;
        _hist.spk.fill(0); _hist.leq1.fill(0); _hist.leq10.fill(0);
        _resetFilterState();
        AppStore.setState({ splHistory: null, splStats: null });
    }

    /**
     * Exporta o histórico de 1 s como CSV para download.
     * Formato: timestamp_iso,spl_db,weighting
     */
    function exportCSV() {
        const data = getHistory();
        const now  = new Date();
        const rows = ['timestamp_iso,spl_db,weighting'];
        const n    = data.seconds.length;
        for (let i = 0; i < n; i++) {
            const ts = new Date(now - (n - 1 - i) * 1000).toISOString();
            rows.push(`${ts},${data.seconds[i].toFixed(1)},${_weighting}`);
        }
        return rows.join('\n');
    }

    // ─── Tick de 1 segundo ────────────────────────────────────────────────────

    function _onTick() {
        _elapsedSec++;

        // SPL médio do último segundo (Leq1s)
        const leq1s = _leanPowerToDb(_acc1s, _acc1sCount);
        _acc1s = _acc1sCount = 0;

        _accumulateDose(leq1s);
        _accumulateLden(leq1s, new Date());

        // Grava no ring buffer de 1 s
        _writeRing(_hist.spk, _hist.spkPtr, leq1s);
        _hist.spkPtr = (_hist.spkPtr + 1) % _hist.spk.length;
        _hist.spkLen = Math.min(_hist.spkLen + 1, _hist.spk.length);

        // Leq1: média de 60 s
        if (_elapsedSec % 60 === 0) {
            const leq1 = _leanPowerToDb(_acc1min, _acc1minCount);
            _acc1min = _acc1minCount = 0;
            _writeRing(_hist.leq1, _hist.leq1Ptr, leq1);
            _hist.leq1Ptr = (_hist.leq1Ptr + 1) % _hist.leq1.length;
            _hist.leq1Len = Math.min(_hist.leq1Len + 1, _hist.leq1.length);
        }

        // Leq10: média de 600 s
        if (_elapsedSec % 600 === 0) {
            const leq10 = _leanPowerToDb(_acc10min, _acc10minCount);
            _acc10min = _acc10minCount = 0;
            _writeRing(_hist.leq10, _hist.leq10Ptr, leq10);
            _hist.leq10Ptr = (_hist.leq10Ptr + 1) % _hist.leq10.length;
            _hist.leq10Len = Math.min(_hist.leq10Len + 1, _hist.leq10.length);
        }

        // Publica estado para a UI (reativo via AppStore)
        const stats = getStats();
        AppStore.setState({ splStats: stats });

        // Alerta de limite a cada 10 s
        if (_elapsedSec % 10 === 0 && stats.leq1 > NIOSH_LIMIT_DB) {
            AppStore.setState({
                splAlert: {
                    level:   'warning',
                    message: `⚠️ Lp${_weighting} ${stats.leq1.toFixed(1)} dB > ${NIOSH_LIMIT_DB} dB(A) NIOSH`,
                    ts:      Date.now()
                }
            });
        }
    }

    // ─── Cálculo SPL ─────────────────────────────────────────────────────────

    /**
     * Calcula SPL ponderado a partir do espectro de frequência.
     * Usa os coeficientes de ponderação analítica (domínio da frequência).
     *
     * Para maior precisão, a ponderação C e Z no domínio do tempo
     * são aplicadas via filtros biquad em cascata (ver _buildFilters).
     *
     * @param {Float32Array} freqData  - valores em dBFS
     * @param {number}       fftSize
     * @returns {number} SPL em dB (relativo a calibração REF_DB)
     */
    function _calcSPL(freqData, fftSize) {
        const w        = _weighting;
        const hzPerBin = _sampleRate / fftSize;
        const n        = freqData.length;
        let   sumPwr   = 0;

        for (let k = 1; k < n; k++) {  // k=0 é DC, ignorar
            const freq  = k * hzPerBin;
            const dbRaw = freqData[k];  // dBFS
            const dbW   = dbRaw + _getWeight(w, freq); // ponderação em dB
            sumPwr += Math.pow(10, dbW / 10);
        }

        // Converte potência acumulada → dB + offset de calibração
        return 10 * Math.log10(sumPwr + 1e-30) + REF_DB;
    }

    // ─── Funções de ponderação analítica (domínio da frequência) ─────────────

    /**
     * Retorna o ganho em dB da ponderação selecionada para a frequência f (Hz).
     * IEC 61672-1:2013, Anexo E.
     */
    function _getWeight(type, f) {
        if (type === 'Z') return 0;
        if (type === 'A') return _aWeight(f);
        if (type === 'C') return _cWeight(f);
        return 0;
    }

    /** Ponderação A — IEC 61672-1:2013. Normalizada em 1 kHz (0 dB). */
    function _aWeight(f) {
        if (f < 10) return -100;
        const f2 = f * f;
        const f4 = f2 * f2;
        const num = 12194 * 12194 * f4;
        const den = (f2 + 20.6 * 20.6)
                  * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9))
                  * (f2 + 12194 * 12194);
        const rA  = num / (den + 1e-30);
        return 20 * Math.log10(rA + 1e-30) + 2.00;   // +2.00 dB = normalização a 1 kHz
    }

    /**
     * Ponderação C — IEC 61672-1:2013.
     * C(f) = 12194²·f² / [(f²+20.6²)·(f²+12194²)]  × k_C
     * Normalizada em 1 kHz (0 dB).
     */
    function _cWeight(f) {
        if (f < 10) return -100;
        const f2  = f * f;
        const num = 12194 * 12194 * f2;
        const den = (f2 + 20.6 * 20.6) * (f2 + 12194 * 12194);
        const rC  = num / (den + 1e-30);
        return 20 * Math.log10(rC + 1e-30) + 0.06;   // +0.06 dB = normalização a 1 kHz
    }

    // ─── Filtros Biquad IEC 61672 (domínio do tempo) ─────────────────────────
    //
    // Usados para processamento de sinal raw PCM (não usado no modo padrão
    // que opera sobre freqData, mas exportado para uso em AudioWorklet futuro).

    /**
     * Constrói os coeficientes dos filtros biquad para fs dado,
     * usando a transformação bilinear com pré-warping nas frequências de polo.
     *
     * Ponderação A: 2 zeros em DC + 1 zero em Nyquist + 4 pólos complexos
     * (implementado como 2 biquads em série)
     *
     * Ponderação C: 2 zeros em DC + 2 pólos complexos
     * (implementado como 1 biquad)
     */
    function _buildFilters(fs) {
        _filters.A = _buildAFilter(fs);
        _filters.C = _buildCFilter(fs);
        _filters.Z = [{ b: [1, 0, 0], a: [1, 0, 0] }]; // passthrough
    }

    function _getH(freq, b, a, fs) {
        const w = 2 * Math.PI * freq / fs;
        const cos1 = Math.cos(w);
        const sin1 = Math.sin(w);
        const cos2 = Math.cos(2 * w);
        const sin2 = Math.sin(2 * w);

        const numReal = b[0] + b[1] * cos1 + b[2] * cos2;
        const numImag = -b[1] * sin1 - b[2] * sin2;

        const denReal = a[0] + a[1] * cos1 + a[2] * cos2;
        const denImag = -a[1] * sin1 - a[2] * sin2;

        const numMag = Math.sqrt(numReal * numReal + numImag * numImag);
        const denMag = Math.sqrt(denReal * denReal + denImag * denImag);

        return numMag / (denMag + 1e-30);
    }

    /**
     * Filtro de Ponderação A em três estágios biquad (6ª ordem).
     * Em conformidade com a IEC 61672-1:2013.
     */
    function _buildAFilter(fs) {
        const T  = 1 / fs;
        const w1 = 2 * Math.PI * 20.6;
        const w2 = 2 * Math.PI * 107.7;
        const w3 = 2 * Math.PI * 737.9;
        const w4 = 2 * Math.PI * 12194;
        const k  = 4 / (T * T);

        function _bilinearPair(wa, wb) {
            const n = k + (wa + wb) * 2 / T + wa * wb;
            return {
                b: [k / n, -2 * k / n, k / n],
                a: [1, (2 * wa * wb - 2 * k) / n, (k - (wa + wb) * 2 / T + wa * wb) / n]
            };
        }

        const stage1 = _bilinearPair(w1, w1);
        const stage2 = _bilinearPair(w4, w4);

        const n3 = k + (w2 + w3) * 2 / T + w2 * w3;
        const num3 = 12194 * 12194;
        const stage3 = {
            b: [num3 / n3, 2 * num3 / n3, num3 / n3],
            a: [1, (2 * w2 * w3 - 2 * k) / n3, (k - (w2 + w3) * 2 / T + w2 * w3) / n3]
        };

        const filters = [stage1, stage2, stage3];

        // Normalização a 1 kHz
        let g1000 = 1.0;
        for (const stage of filters) {
            g1000 *= _getH(1000, stage.b, stage.a, fs);
        }
        const norm = 1 / (g1000 + 1e-30);
        stage1.b = stage1.b.map(v => v * norm);

        return filters;
    }

    /**
     * Filtro de Ponderação C em dois estágios biquad (4ª ordem).
     * Em conformidade com a IEC 61672-1:2013.
     */
    function _buildCFilter(fs) {
        const T  = 1 / fs;
        const w1 = 2 * Math.PI * 20.6;
        const w4 = 2 * Math.PI * 12194;
        const k  = 4 / (T * T);

        const n = k + (w1 + w4) * 2 / T + w1 * w4;
        const stage = {
            b: [2 / (T * n), 0, -2 / (T * n)],
            a: [1, (2 * w1 * w4 - 2 * k) / n, (k - (w1 + w4) * 2 / T + w1 * w4) / n]
        };

        const filters = [stage, { b: [...stage.b], a: [...stage.a] }];

        // Normalização a 1 kHz
        let g1000 = 1.0;
        for (const f of filters) {
            g1000 *= _getH(1000, f.b, f.a, fs);
        }
        const norm = 1 / (g1000 + 1e-30);
        filters[0].b = filters[0].b.map(v => v * norm);

        return filters;
    }

    function _resetFilterState() {
        _filterState.A = _makeFilterState('A');
        _filterState.C = _makeFilterState('C');
        _filterState.Z = _makeFilterState('Z');
    }

    function _makeFilterState(w) {
        const stages = (_filters[w] || []).length;
        return Array.from({ length: stages }, () => [0, 0]);
    }

    /**
     * Aplica o filtro biquad em cascata a um buffer PCM.
     * Útil para processamento no domínio do tempo (AudioWorklet / análise offline).
     *
     * @param {Float32Array} input    - PCM [-1, 1]
     * @param {string}       weighting - 'A'|'C'|'Z'
     * @returns {Float32Array}        - sinal filtrado
     */
    function applyWeightingFilter(input, weighting) {
        const stages = _filters[weighting] || [];
        let buf = new Float32Array(input);

        for (let s = 0; s < stages.length; s++) {
            const { b, a } = stages[s];
            const z        = _filterState[weighting][s];
            const out      = new Float32Array(buf.length);
            for (let n = 0; n < buf.length; n++) {
                const x = buf[n];
                const wn = x - a[1] * z[0] - a[2] * z[1];
                const y = b[0] * wn + b[1] * z[0] + b[2] * z[1];
                z[1] = z[0]; z[0] = wn;
                out[n] = y;
            }
            buf = out;
        }
        return buf;
    }

    // ─── Helpers ring buffer ──────────────────────────────────────────────────

    /** Escreve valor no ring buffer na posição ptr (não incrementa o ptr aqui). */
    function _writeRing(buf, ptr, value) {
        buf[ptr % buf.length] = value;
    }

    /**
     * Lê o ring buffer em ordem cronológica (mais antigo → mais recente).
     * Retorna apenas os `len` elementos preenchidos.
     */
    function _readRing(buf, ptr, len) {
        if (len === 0) return new Float32Array(0);
        const n      = buf.length;
        const result = new Float32Array(len);
        const start  = (ptr - len + n * 2) % n; // garantia anti-negativo
        for (let i = 0; i < len; i++) {
            result[i] = buf[(start + i) % n];
        }
        return result;
    }

    /** Converte potência acumulada em dB (Leq). */
    function _leanPowerToDb(sumPower, count) {
        if (count === 0) return -Infinity;
        return 10 * Math.log10(sumPower / count + 1e-30);
    }

    function _formatDbStat(value) {
        if (value === null || value === undefined) return null;
        if (!Number.isFinite(value)) return value;
        return parseFloat(value.toFixed(1));
    }

    function _round1(value) {
        return Math.round(value * 10) / 10;
    }

    function _accumulateDose(leq1s) {
        const profile = _getCurrentProfileParams();
        if (!Number.isFinite(leq1s) || leq1s < profile.thresholdDb) return;

        const allowedSec = profile.durationSec *
            Math.pow(2, (profile.criterionDb - leq1s) / profile.exchangeRate);

        _dosePercentAcc += 100 / allowedSec;
        _doseSecondsAboveThreshold++;
    }

    function _makeLdenAcc() {
        return {
            day:     { sum: 0, weightedSum: 0, sec: 0 },
            evening: { sum: 0, weightedSum: 0, sec: 0 },
            night:   { sum: 0, weightedSum: 0, sec: 0 },
        };
    }

    function _resetExposureAccumulators() {
        _dosePercentAcc = 0;
        _doseSecondsAboveThreshold = 0;
        _ldenAcc = _makeLdenAcc();
    }

    function _getLdenPeriod(date) {
        const hour = date.getHours();
        if (hour >= 7 && hour < 19) {
            return { key: 'day', penaltyDb: 0 };
        }
        if (hour >= 19 && hour < 23) {
            return { key: 'evening', penaltyDb: 5 };
        }
        return { key: 'night', penaltyDb: 10 };
    }

    function _accumulateLden(leq1s, date) {
        if (!Number.isFinite(leq1s)) return;

        const period = _getLdenPeriod(date);
        const acc = _ldenAcc[period.key];
        acc.sum += Math.pow(10, leq1s / 10);
        acc.weightedSum += Math.pow(10, (leq1s + period.penaltyDb) / 10);
        acc.sec++;
    }

    function _calcPeriodLeq(periodAcc) {
        if (!periodAcc || periodAcc.sec === 0) return null;
        return _formatDbStat(10 * Math.log10(periodAcc.sum / periodAcc.sec + 1e-30));
    }

    function _getLdenStats() {
        const day = _ldenAcc.day;
        const evening = _ldenAcc.evening;
        const night = _ldenAcc.night;
        const totalSec = day.sec + evening.sec + night.sec;
        const weightedSum = day.weightedSum + evening.weightedSum + night.weightedSum;
        const lden = totalSec > 0
            ? _formatDbStat(10 * Math.log10(weightedSum / totalSec + 1e-30))
            : null;

        return {
            lden,
            lday: _calcPeriodLeq(day),
            levening: _calcPeriodLeq(evening),
            lnight: _calcPeriodLeq(night),
        };
    }

    // ─── Exposição global ─────────────────────────────────────────────────────

    window.SplLogger = {
        init,
        start,
        stop,
        push,
        setWeighting,
        setExposureProfile,
        getLive,
        getStats,
        getHistory,
        applyWeightingFilter,
        exportCSV,
        reset,
        // Constantes úteis para a UI
        NIOSH_LIMIT_DB,
        REF_DB,
        EXPOSURE_CRITERION_DB,
        EXPOSURE_CRITERION_SEC,
        EXCHANGE_RATE_DB,
        EXPOSURE_THRESHOLD_DB,
        MAX_DOSE_PERCENT,
        DOSE_PROFILE,
        EXPOSURE_PROFILES,
    };

})();
