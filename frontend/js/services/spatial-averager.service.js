/**
 * SoundMaster Pro — Spatial Averaging (Média Espacial) Service
 * =============================================================
 * Recebe espectros de até 8 microfones simultâneos e calcula:
 *
 *   1. Média Logarítmica (RMS em dB) — correta para pressão sonora
 *   2. Variância Espacial por banda — identifica problemas acústicos
 *      da SALA vs. problemas do PA
 *   3. Overlay de rendering: linhas individuais (baixa opacidade) +
 *      linha de média em destaque no canvas RTA
 *
 * Fontes de áudio suportadas:
 *   - Web Audio API nativa (getUserMedia multicanal)
 *   - Streams AES67 via WebSocket (freqData já pré-processados no backend)
 *   - Injeção manual via SpatialAverager.pushSource(id, freqDataArray)
 *
 * API pública (window.SpatialAverager):
 *   .addSource(id, label, color?)       → regista uma fonte
 *   .removeSource(id)                   → remove fonte
 *   .pushSource(id, freqDataArray)      → alimenta dados de um frame
 *   .getResult()                        → { avg, variance, sources, meta }
 *   .drawOverlay(canvasCtx, canvas, analyser) → desenha overlay no RTA
 *   .startMultiDevice(maxMics?)         → abre múltiplos getUserMedia
 *   .stop()                             → para todos os contextos
 *   .isActive()                         → boolean
 *   .subscribe(fn)                      → callback a cada frame calculado
 */

'use strict';

(function () {

    // ─── Paleta de cores para os microfones individuais ────────────────────────
    const MIC_COLORS = [
        '#38bdf8',  // sky-400   — Mic 1
        '#34d399',  // emerald-400 — Mic 2
        '#fb923c',  // orange-400 — Mic 3
        '#fbbf24',  // amber-400 — Mic 4
        '#f472b6',  // pink-400  — Mic 5
        '#facc15',  // yellow-400 — Mic 6
        '#22d3ee',  // cyan-400  — Mic 7
        '#4ade80',  // green-400 — Mic 8
    ];

    // Cor da linha de média espacial (destaque máximo)
    const AVG_COLOR     = '#ffffff';
    const AVG_LINE_W    = 2.5;
    const SOURCE_LINE_W = 1.0;
    const SOURCE_ALPHA  = 0.25;

    // Variância acima deste threshold (dB²) → banda marcada como "problemática"
    const VARIANCE_WARN_DB2 = 16;   // ±4dB de desvio entre microfones
    const VARIANCE_CRIT_DB2 = 36;   // ±6dB — problema acústico severo

    // Máximo de fontes simultâneas
    const MAX_SOURCES = 8;

    // ─── Estado interno ───────────────────────────────────────────────────────

    const _sources = new Map();   // id → { label, color, latestFrame, audioCtx, stream, analyser }
    let   _callbacks = [];
    let   _active    = false;
    let   _lastResult = null;
    let   _animId    = null;

    // ─── API principal ────────────────────────────────────────────────────────

    /** Regista uma nova fonte (sem abrir áudio — usada para fontes AES67 externas) */
    function addSource(id, label, color) {
        if (_sources.size >= MAX_SOURCES) {
            console.warn(`[SpatialAvg] Máximo de ${MAX_SOURCES} fontes atingido.`);
            return false;
        }
        const colorFinal = color || MIC_COLORS[_sources.size % MIC_COLORS.length];
        _sources.set(id, { id, label: label || id, color: colorFinal, latestFrame: null });
        console.log(`[SpatialAvg] Fonte registada: ${label} (${id})`);
        return true;
    }

    /** Remove uma fonte e liberta recursos de áudio associados */
    function removeSource(id) {
        const src = _sources.get(id);
        if (!src) return;
        if (src.stream) src.stream.getTracks().forEach(t => t.stop());
        if (src.audioCtx) { try { src.audioCtx.close(); } catch (_) {} }
        _sources.delete(id);
        console.log(`[SpatialAvg] Fonte removida: ${id}`);
    }

    /**
     * Alimenta o frame mais recente de uma fonte.
     * @param {string}           id           — identificador da fonte
     * @param {Float32Array}     freqDataArray — saída de analyser.getFloatFrequencyData()
     */
    function pushSource(id, freqDataArray) {
        const src = _sources.get(id);
        if (!src) return;
        // Copia para evitar aliasing (o caller pode reutilizar o buffer)
        src.latestFrame = freqDataArray instanceof Float32Array
            ? freqDataArray.slice()
            : Float32Array.from(freqDataArray);
        _compute();
    }

    /** Retorna o último resultado calculado */
    function getResult() { return _lastResult; }

    /** Subscreve atualizações (chamado a cada frame calculado) */
    function subscribe(fn) {
        if (typeof fn === 'function') _callbacks.push(fn);
    }

    function isActive() { return _active; }

    // ─── Cálculo principal ────────────────────────────────────────────────────

    /**
     * Calcula a média logarítmica e a variância espacial.
     *
     * Média logarítmica (correta para SPL):
     *   Para cada bin k:
     *     p_linear(k) = 10^(dB(k)/10)       ← converte para potência linear
     *     avg_linear  = mean(p_linear)       ← média das potências
     *     avg_dB(k)   = 10 × log10(avg_linear)  ← volta para dB
     *
     * Isto é equivalente a calcular a média energética (RMS em dB).
     *
     * Variância espacial (em dB²):
     *   var(k) = mean((dB_i(k) - avg_dB(k))²) para cada microfone i
     *
     * Uma variância alta numa banda específica indica que os microfones
     * "discordam" nessa frequência — sinal de modo acústico da sala,
     * e NÃO de um problema do PA que justifique uma correção de EQ.
     */
    function _compute() {
        const activeSrcs = Array.from(_sources.values()).filter(s => s.latestFrame !== null);
        if (activeSrcs.length === 0) return;

        const N    = activeSrcs.length;
        const bins = activeSrcs[0].latestFrame.length;

        const avg      = new Float32Array(bins);
        const variance = new Float32Array(bins);

        for (let k = 0; k < bins; k++) {
            // 1. Média logarítmica (energética)
            let sumLinear = 0;
            for (let i = 0; i < N; i++) {
                sumLinear += Math.pow(10, activeSrcs[i].latestFrame[k] / 10);
            }
            const avgDb = 10 * Math.log10(Math.max(sumLinear / N, 1e-20));
            avg[k] = avgDb;

            // 2. Variância em dB²
            let sumSq = 0;
            for (let i = 0; i < N; i++) {
                const diff = activeSrcs[i].latestFrame[k] - avgDb;
                sumSq += diff * diff;
            }
            variance[k] = sumSq / N;
        }

        _lastResult = {
            avg,
            variance,
            sources: activeSrcs.map(s => ({ id: s.id, label: s.label, color: s.color, frame: s.latestFrame })),
            meta: {
                n:         N,
                bins,
                ts:        Date.now(),
                // Bandas com variância elevada (índices)
                warnBins:  _findHighVarianceBins(variance, VARIANCE_WARN_DB2),
                critBins:  _findHighVarianceBins(variance, VARIANCE_CRIT_DB2),
            },
        };

        // Notifica subscribers
        _callbacks.forEach(fn => { try { fn(_lastResult); } catch (e) {} });

        // Publica no AppStore se disponível
        if (window.AppStore) AppStore.setState({ spatialAvgResult: _lastResult });
    }

    function _findHighVarianceBins(variance, threshold) {
        const result = [];
        for (let k = 0; k < variance.length; k++) {
            if (variance[k] >= threshold) result.push(k);
        }
        return result;
    }

    // ─── Rendering (overlay no canvas RTA) ───────────────────────────────────

    /**
     * Desenha o overlay de Spatial Averaging sobre o canvas do RTA.
     * Deve ser chamado no loop de animação APÓS o draw normal do analyzer.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {HTMLCanvasElement}        canvas
     * @param {AnalyserNode}             analyser   — para minDecibels/maxDecibels
     * @param {number}                   sampleRate
     */
    function drawOverlay(ctx, canvas, analyser, sampleRate) {
        if (!_lastResult) return;

        const { avg, variance, sources, meta } = _lastResult;
        if (!avg || avg.length === 0) return;

        const W         = canvas.width;
        const H         = canvas.height;
        const minDb     = analyser.minDecibels;
        const maxDb     = analyser.maxDecibels;
        const dbRange   = maxDb - minDb;
        const sr        = sampleRate || 48000;
        const fftSize   = (avg.length) * 2;
        const hzPerBin  = sr / fftSize;
        const minFreq   = 20;
        const maxFreq   = sr / 2;
        const logMin    = Math.log10(minFreq);
        const logRange  = Math.log10(maxFreq) - logMin;

        // Mapeia bin FFT → X no canvas (escala logarítmica)
        const binToX = (k) => {
            const hz  = k * hzPerBin;
            if (hz < minFreq) return -1;
            const logF = Math.log10(hz);
            return ((logF - logMin) / logRange) * W;
        };

        // Mapeia dB → Y no canvas
        const dbToY = (db) => H - Math.max(0, Math.min(1, (db - minDb) / dbRange)) * H;

        ctx.save();

        // ── 1. Faixas de alta variância (zonas de problema acústico) ──────────
        if (meta.critBins.length > 0) {
            _drawVarianceBands(ctx, meta.critBins, binToX, H, 'rgba(239,68,68,0.12)');
        }
        if (meta.warnBins.length > 0) {
            _drawVarianceBands(ctx, meta.warnBins, binToX, H, 'rgba(251,146,60,0.08)');
        }

        // ── 2. Linhas individuais dos microfones (baixa opacidade) ────────────
        sources.forEach(src => {
            ctx.globalAlpha = SOURCE_ALPHA;
            ctx.strokeStyle = src.color;
            ctx.lineWidth   = SOURCE_LINE_W;
            ctx.beginPath();
            let started = false;
            for (let k = 1; k < src.frame.length; k++) {
                const x = binToX(k);
                if (x < 0) continue;
                const y = dbToY(src.frame[k]);
                if (!started) { ctx.moveTo(x, y); started = true; }
                else            ctx.lineTo(x, y);
            }
            ctx.stroke();
        });

        // ── 3. Linha de média (destaque total) ────────────────────────────────
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = AVG_COLOR;
        ctx.lineWidth   = AVG_LINE_W;
        ctx.shadowColor = 'rgba(255,255,255,0.6)';
        ctx.shadowBlur  = 6;
        ctx.setLineDash([]);
        ctx.beginPath();
        let started = false;
        for (let k = 1; k < avg.length; k++) {
            const x = binToX(k);
            if (x < 0) continue;
            const y = dbToY(avg[k]);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else            ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ── 4. Legenda dos microfones ─────────────────────────────────────────
        _drawLegend(ctx, sources, meta.n, W);

        // ── 5. Indicador de variância nos picos críticos ───────────────────────
        if (meta.critBins.length > 0) {
            _drawVarianceAnnotations(ctx, meta.critBins, variance, binToX, dbToY, avg, hzPerBin);
        }

        ctx.restore();
    }

    function _drawVarianceBands(ctx, bins, binToX, H, fillStyle) {
        // Agrupa bins contíguos e desenha faixas
        if (bins.length === 0) return;
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.fillStyle   = fillStyle;

        let start = bins[0];
        for (let i = 1; i <= bins.length; i++) {
            if (i === bins.length || bins[i] !== bins[i - 1] + 1) {
                const x1 = binToX(start);
                const x2 = binToX(bins[i - 1] + 1);
                if (x1 >= 0 && x2 > x1) ctx.fillRect(x1, 0, x2 - x1, H);
                if (i < bins.length) start = bins[i];
            }
        }
        ctx.restore();
    }

    function _drawLegend(ctx, sources, n, W) {
        const PAD  = 10;
        const ROW  = 14;
        const boxW = 110;
        const boxH = PAD + (n + 1) * ROW + PAD;

        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle   = 'rgba(2,10,20,0.75)';
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth   = 1;
        const lx = W - boxW - 8;
        const ly = 8;
        ctx.beginPath();
        ctx.roundRect(lx, ly, boxW, boxH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.globalAlpha = 1.0;
        ctx.font        = '9px Inter, monospace';

        // Entrada para a média
        ctx.fillStyle  = AVG_COLOR;
        ctx.fillRect(lx + 8, ly + PAD + 3, 18, 2);
        ctx.fillStyle  = 'rgba(255,255,255,0.9)';
        ctx.fillText('Média Espacial', lx + 30, ly + PAD + 10);

        sources.forEach((src, i) => {
            const y = ly + PAD + (i + 1) * ROW;
            ctx.fillStyle = src.color;
            ctx.fillRect(lx + 8, y + 3, 18, 2);
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText(src.label.slice(0, 14), lx + 30, y + 10);
        });

        ctx.restore();
    }

    function _drawVarianceAnnotations(ctx, critBins, variance, binToX, dbToY, avg, hzPerBin) {
        // Mostra triângulo de aviso nas zonas de alta variância
        const shown = new Set();
        critBins.forEach(k => {
            const x = binToX(k);
            if (x < 0 || shown.has(Math.round(x / 20))) return;
            shown.add(Math.round(x / 20));

            const y    = dbToY(avg[k]) - 12;
            const hz   = Math.round(k * hzPerBin);
            const vDb  = Math.sqrt(variance[k]).toFixed(1);

            ctx.save();
            ctx.globalAlpha = 0.9;
            // Triângulo
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.moveTo(x, y - 8);
            ctx.lineTo(x - 5, y);
            ctx.lineTo(x + 5, y);
            ctx.closePath();
            ctx.fill();
            // Tooltip
            ctx.font      = '8px monospace';
            ctx.fillStyle = '#fca5a5';
            ctx.fillText(`${hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : hz}Hz ±${vDb}dB`, x + 6, y - 2);
            ctx.restore();
        });
    }

    // ─── Captura multi-dispositivo (Web Audio API nativa) ─────────────────────

    /**
     * Abre streams de áudio de múltiplos dispositivos de entrada.
     * Enumera os dispositivos disponíveis e pede permissão para cada um.
     *
     * Nota: browsers limitam múltiplos getUserMedia simultâneos.
     * Em Chrome, é possível capturar até ~4 dispositivos com AudioContexts separados.
     * Para AES67, usar pushSource() externamente com os freqData já calculados.
     *
     * @param {number} maxMics   — número máximo de microfones (default: 4)
     */
    async function startMultiDevice(maxMics = 4) {
        if (_active) await stop();

        let devices;
        try {
            // Pede permissão inicial para enumerar com labels
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            tempStream.getTracks().forEach(t => t.stop());
            devices = allDevices.filter(d => d.kind === 'audioinput').slice(0, maxMics);
        } catch (e) {
            console.error('[SpatialAvg] Erro ao enumerar dispositivos:', e);
            return [];
        }

        const opened = [];
        for (let i = 0; i < devices.length; i++) {
            const dev = devices[i];
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: { exact: dev.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
                });
                const actx    = new AudioContext({ sampleRate: 48000 });
                const srcNode = actx.createMediaStreamSource(stream);
                const analyserNode = actx.createAnalyser();
                analyserNode.fftSize       = 4096;
                analyserNode.smoothingTimeConstant = 0.75;
                analyserNode.minDecibels   = -90;
                analyserNode.maxDecibels   = 0;
                srcNode.connect(analyserNode);

                const id    = `mic_${i}`;
                const label = dev.label || `Microfone ${i + 1}`;

                addSource(id, label);
                _sources.get(id).audioCtx = actx;
                _sources.get(id).stream   = stream;
                _sources.get(id).analyserNode = analyserNode;

                opened.push({ id, label, deviceId: dev.deviceId });
                console.log(`[SpatialAvg] Dispositivo aberto: ${label}`);
            } catch (e) {
                console.warn(`[SpatialAvg] Dispositivo ${dev.label} falhou:`, e.message);
            }
        }

        _active = true;
        _startCaptureLoop();
        return opened;
    }

    /**
     * Loop de captura: lê os freqData de cada AnalyserNode interno
     * e alimenta pushSource() a 30fps.
     */
    function _startCaptureLoop() {
        const tick = () => {
            if (!_active) return;

            _sources.forEach((src) => {
                if (!src.analyserNode) return;
                const buf = new Float32Array(src.analyserNode.frequencyBinCount);
                src.analyserNode.getFloatFrequencyData(buf);
                // Só actualiza se o sinal não for silêncio total (evita -Infinity)
                const hasSignal = buf.some(v => isFinite(v) && v > -130);
                if (hasSignal) src.latestFrame = buf;
            });

            _compute();
            _animId = requestAnimationFrame(tick);
        };
        _animId = requestAnimationFrame(tick);
    }

    /** Para todos os streams e liberta recursos */
    async function stop() {
        _active = false;
        if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
        for (const id of _sources.keys()) removeSource(id);
        _lastResult = null;
        if (window.AppStore) AppStore.setState({ spatialAvgResult: null });
        console.log('[SpatialAvg] Parado.');
    }

    // ─── API pública ──────────────────────────────────────────────────────────

    window.SpatialAverager = {
        addSource,
        removeSource,
        pushSource,
        getResult,
        drawOverlay,
        startMultiDevice,
        stop,
        isActive,
        subscribe,
        MIC_COLORS,
        VARIANCE_WARN_DB2,
        VARIANCE_CRIT_DB2,
        MAX_SOURCES,
    };

    console.log('[SpatialAvg] Serviço de Média Espacial carregado.');

})();
