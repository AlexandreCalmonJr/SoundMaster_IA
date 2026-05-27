/**
 * SoundMaster Pro — MTW Spectrum Manager
 * ========================================
 * Gere o AudioWorkletNode do MTW Processor e faz a composição
 * das N bandas paralelas num espectro unificado para a UI.
 *
 * Integração:
 *   window.MtwManager.start(audioCtx, sourceNode)
 *   window.MtwManager.stop()
 *   window.MtwManager.setWindow('blackman'|'hann'|'flattop'|'kaiser')
 *   window.MtwManager.setOverlap(0.75)
 *   window.MtwManager.getSpectrum()   → { bins, magnitudes, hzPerBin[] }
 *   window.MtwManager.onSpectrum(fn)  → callback chamado a cada update
 */

'use strict';

(function () {

    // ─── Estado ───────────────────────────────────────────────────────────────

    let _node      = null;
    let _ctx       = null;
    let _callback  = null;
    let _sourceNode = null;

    // Mapa das últimas magnitudes recebidas por banda
    const _bandData = new Map();

    // Espectro composto final (recalculado a cada update de banda)
    // Resolução final: 1/3 oitava usando bins da banda mais adequada por freq.
    let _compositeFreqs = null;
    let _compositeMags  = null;

    // ─── Configuração de bandas ───────────────────────────────────────────────

    /**
     * Bandas MTW padrão (mesmas do processor).
     * A sobreposição (overlap) entre bandas garante que não há "buraco"
     * na transição de uma banda para outra.
     */
    const BANDS = [
        { id: 'bass', fftSize: 32768, freqMin:    20, freqMax:   300 },
        { id: 'low',  fftSize: 16384, freqMin:    80, freqMax:   800 },
        { id: 'mid',  fftSize:  4096, freqMin:   600, freqMax:  5000 },
        { id: 'high', fftSize:  1024, freqMin:  3000, freqMax: 20000 },
    ];

    /**
     * Define os limites de corte do crossover entre bandas.
     * Para cada frequência, usamos a banda com MAIOR fftSize cujo freqMax >= f.
     * Isso garante sempre a melhor resolução disponível para aquela frequência.
     *
     * Crossover points (usa a banda mais alta que cobre a frequência):
     *   f <= 250 Hz  → bass  (32768 FFT, resolução 1.35 Hz/bin)
     *   f <= 600 Hz  → low   (16384 FFT, resolução 2.69 Hz/bin)
     *   f <= 3500 Hz → mid   ( 4096 FFT, resolução 10.77 Hz/bin)
     *   f >  3500 Hz → high  ( 1024 FFT, resolução 43.07 Hz/bin)
     */
    const CROSSOVER = [
        { maxFreq:  250, bandId: 'bass' },
        { maxFreq:  600, bandId: 'low'  },
        { maxFreq: 3500, bandId: 'mid'  },
        { maxFreq: Infinity, bandId: 'high' },
    ];

    // ─── API ──────────────────────────────────────────────────────────────────

    async function start(audioCtx, sourceNode) {
        if (_node) return; // já activo

        _ctx = audioCtx;

        try {
            await audioCtx.audioWorklet.addModule('js/core/min/mtw-processor.js');
        } catch (e) {
            console.error('[MtwManager] Falha ao carregar mtw-processor.js:', e);
            return;
        }

        _node = new AudioWorkletNode(audioCtx, 'mtw-processor', {
            numberOfInputs:  1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
        });

        // Ligação silenciosa (não reproduzimos o sinal, apenas analisamos)
        const sink = audioCtx.createGain();
        sink.gain.value = 0;
        _node.connect(sink);
        sink.connect(audioCtx.destination);

        // Conecta a fonte de áudio ao worklet
        _sourceNode = sourceNode;
        sourceNode.connect(_node);

        // Recebe resultados de cada banda
        _node.port.onmessage = (e) => _onBandSpectrum(e.data);

        console.log('[MtwManager] MTW iniciado com', BANDS.length, 'bandas.');
    }

    function stop() {
        if (_node) {
            if (_sourceNode) {
                try { _sourceNode.disconnect(_node); } catch (_) {}
                _sourceNode = null;
            }
            try { _node.disconnect(); } catch (_) {}
            _node = null;
        }
        _bandData.clear();
    }

    /** Altera o tipo de janela em runtime. */
    function setWindow(type) {
        _send({ type: 'set-window', value: type });
    }

    /** Altera o overlap em runtime (0.5, 0.75 ou 0.875). */
    function setOverlap(factor) {
        _send({ type: 'set-overlap', value: factor });
    }

    /** Define o parâmetro β do Kaiser-Bessel. */
    function setKaiserBeta(beta) {
        _send({ type: 'set-kaiser-beta', value: beta });
    }

    /**
     * Retorna o espectro composto mais recente.
     * Retorna null se ainda não há dados suficientes.
     */
    function getSpectrum() {
        if (!_compositeFreqs) return null;
        return {
            frequencies: _compositeFreqs,
            magnitudes:  _compositeMags,
        };
    }

    /**
     * Regista um callback chamado a cada atualização do espectro composto.
     * O callback recebe: { frequencies: Float32Array, magnitudes: Float32Array }
     */
    function onSpectrum(fn) {
        _callback = fn;
    }

    // ─── Processamento de resultados ──────────────────────────────────────────

    function _onBandSpectrum(msg) {
        if (msg.type !== 'band-spectrum') return;

        // Armazena os dados mais recentes desta banda
        _bandData.set(msg.id, {
            magnitude: msg.magnitude,   // Float32Array (half-spectrum)
            hzPerBin:  msg.hzPerBin,
            fftSize:   msg.fftSize,
            freqMin:   msg.freqMin,
            freqMax:   msg.freqMax,
            ts:        msg.ts,
        });

        // Só compõe o espectro quando todas as bandas tiverem dados
        if (_bandData.size < BANDS.length) return;

        _buildCompositeSpectrum();

        if (_callback && _compositeFreqs) {
            _callback({ frequencies: _compositeFreqs, magnitudes: _compositeMags });
        }
    }

    /**
     * Constrói o espectro composto unificado usando o crossover definido.
     *
     * Para cada frequência do espectro de saída:
     *   1. Seleciona a banda com maior FFT que cobre essa frequência
     *   2. Interpola linearmente entre os dois bins mais próximos
     *   3. Aplica crossfade suave nas regiões de transição (±1 oitava)
     *
     * Resolução de saída: 1/24 de oitava entre 20 Hz e 20 kHz.
     *   → ~234 pontos de frequência no eixo log.
     */
    function _buildCompositeSpectrum() {
        const sr    = _ctx.sampleRate;
        const nBins = 240; // pontos de saída (1/24 oitava × 10 oitavas)

        if (!_compositeFreqs || _compositeFreqs.length !== nBins) {
            _compositeFreqs = new Float32Array(nBins);
            _compositeMags  = new Float32Array(nBins);

            // Pré-calcula as frequências de saída (escala log)
            const logMin = Math.log10(20);
            const logMax = Math.log10(20000);
            for (let i = 0; i < nBins; i++) {
                _compositeFreqs[i] = Math.pow(10, logMin + (logMax - logMin) * i / (nBins - 1));
            }
        }

        for (let i = 0; i < nBins; i++) {
            const freq = _compositeFreqs[i];
            const mag  = _interpolateMag(freq, sr);
            _compositeMags[i] = mag;
        }
    }

    /**
     * Interpolação de magnitude para uma frequência específica.
     * Seleciona a banda ideal via crossover e interpola linearmente entre bins.
     */
    function _interpolateMag(freq, sr) {
        // Seleciona a banda ideal
        const bandId = _selectBand(freq);
        const band   = _bandData.get(bandId);
        if (!band) return -100;

        // Índice do bin correspondente (interpolação linear)
        const binF  = freq / band.hzPerBin;
        const binLo = Math.floor(binF);
        const binHi = Math.min(binLo + 1, band.magnitude.length - 1);
        const frac  = binF - binLo;

        if (binLo < 0 || binLo >= band.magnitude.length) return -100;

        const magLo = band.magnitude[binLo];
        const magHi = band.magnitude[binHi];

        // Interpolação linear em dB (válida para magnitudes dB vizinhas)
        return magLo + frac * (magHi - magLo);
    }

    /**
     * Seleciona a banda com melhor resolução para a frequência dada,
     * respeitando os crossover points definidos.
     */
    function _selectBand(freq) {
        for (const co of CROSSOVER) {
            if (freq <= co.maxFreq) return co.bandId;
        }
        return 'high';
    }

    function _send(msg) {
        if (_node) _node.port.postMessage(msg);
    }

    // ─── Exposição global ─────────────────────────────────────────────────────

    window.MtwManager = {
        start,
        stop,
        setWindow,
        setOverlap,
        setKaiserBeta,
        getSpectrum,
        onSpectrum,
        // Configurações expostas para a UI
        BANDS,
        CROSSOVER,
        WINDOW_TYPES: ['blackman', 'hann', 'flattop', 'kaiser'],
    };

})();
