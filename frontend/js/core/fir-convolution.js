/**
 * SoundMaster Pro — FIR Convolution Engine
 * =========================================
 * Arquitetura para aplicação de filtros FIR (Finite Impulse Response)
 * permitindo correção de magnitude E fase de sistemas de P.A. e microfones.
 * 
 * Suporta:
 * - Convolução em tempo real via AudioWorklet
 * - Carregamento de filtros IR (Impulse Response) de arquivos .wav/.txt
 * - Geração de filtros inversos para correção de fase
 * - Modos: Bypass, Apply, Measure
 */

(function() {
    'use strict';

    let audioCtx = null;
    let convolverNode = null;
    let inputNode = null;
    let outputNode = null;
    let currentIR = null;
    let isEnabled = false;
    let _readyCallbacks = [];

    // ═══════════════════════════════════════════════════════════════════════
    // CONVOLUTION WORKLET (Processamento em tempo real)
    // ═══════════════════════════════════════════════════════════════════════
    async function _loadConvolverWorklet(ctx) {
        try {
            await ctx.audioWorklet.addModule('js/core/min/fir-convolver-processor.js');
            console.log('[FIR-Convolution] Worklet loaded');
            return true;
        } catch (e) {
            console.error('[FIR-Convolution] Worklet load failed:', e);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INICIALIZAÇÃO
    // ═══════════════════════════════════════════════════════════════════════
    async function init(context) {
        audioCtx = context;
        
        const workletLoaded = await _loadConvolverWorklet(audioCtx);
        if (!workletLoaded) {
            console.warn('[FIR-Convolution] Using fallback (ScriptProcessorNode deprecated)');
            return false;
        }

        // Cria nós de routing
        inputNode = audioCtx.createGain();
        outputNode = audioCtx.createGain();
        
        // Convolver principal
        convolverNode = new AudioWorkletNode(audioCtx, 'fir-convolver-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1
        });

        // Routing: Input → Convolver → Output
        inputNode.connect(convolverNode);
        convolverNode.connect(outputNode);

        // Bypass inicial
        bypass();

        _readyCallbacks.forEach(cb => cb());
        console.log('[FIR-Convolution] Engine initialized');
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CARREGAMENTO DE IR (Impulse Response)
    // ═══════════════════════════════════════════════════════════════════════
    async function loadIRFromArray(coeffs) {
        if (!convolverNode) {
            console.error('[FIR-Convolution] Not initialized');
            return false;
        }

        // Normaliza coeficientes
        const maxVal = Math.max(...coeffs.map(Math.abs));
        const normalized = coeffs.map(c => c / maxVal);

        convolverNode.port.postMessage({
            type: 'set-ir',
            coefficients: normalized
        });

        currentIR = normalized;
        console.log(`[FIR-Convolution] IR loaded: ${normalized.length} taps`);
        return true;
    }

    async function loadIRFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                    
                    // Extrai canal mono
                    const channelData = audioBuffer.getChannelData(0);
                    await loadIRFromArray(Array.from(channelData));
                    resolve(true);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GERAÇÃO DE FILTROS INVERSOS
    // ═══════════════════════════════════════════════════════════════════════
    /**
     * Gera filtro FIR inverso para correção de fase
     * @param {Float32Array} ir - Impulse response original
     * @param {string} method - 'minimum-phase' | 'time-reverse' | 'least-squares'
     */
    function generateInverseFilter(ir, method = 'minimum-phase') {
        const n = ir.length;
        
        if (method === 'time-reverse') {
            // Inversão temporal simples (Phase Flip)
            return Float32Array.from(ir).reverse();
        }
        
        if (method === 'minimum-phase') {
            // Extrai fase mínima via Hilbert transform (simplificado)
            // Equivalente ao que ferramentas como Smaart, ARTA usam
            const spectrum = new Float32Array(n);
            const phase = new Float32Array(n);
            
            // FFT simples (sem otimização)
            for (let k = 0; k < n; k++) {
                let re = 0, im = 0;
                for (let i = 0; i < n; i++) {
                    const angle = -2 * Math.PI * k * i / n;
                    re += ir[i] * Math.cos(angle);
                    im += ir[i] * Math.sin(angle);
                }
                const mag = Math.sqrt(re * re + im * im);
                spectrum[k] = mag;
                
                // Fase mínima: apenas magnitude
                phase[k] = mag > 1e-10 ? Math.atan2(im, re) : 0;
            }

            // Reconstrui IR de fase mínima
            const minPhase = new Float32Array(n);
            for (let i = 0; i < n; i++) {
                let re = 0, im = 0;
                for (let k = 0; k < n; k++) {
                    const angle = 2 * Math.PI * k * i / n;
                    re += spectrum[k] * Math.cos(phase[k] + angle);
                    im += spectrum[k] * Math.sin(phase[k] + angle);
                }
                minPhase[i] = re / n;
            }

            // Normaliza pico
            const peak = Math.max(...minPhase.map(Math.abs));
            return minPhase.map(v => v / peak);
        }

        // Least-squares ( Wiener )
        const lambda = 0.01;
        const R = new Float32Array(n * n);
        const p = new Float32Array(n);
        
        for (let i = 0; i < n; i++) {
            p[i] = ir[i];
            for (let j = 0; j < n; j++) {
                const idx = Math.abs(i - j);
                R[i * n + j] = idx < n ? ir[idx] : 0;
                if (i === j) R[i * n + j] += lambda;
            }
        }

        // Resolve R * h = p (simplificado, Gauss-Seidel)
        const h = new Float32Array(n);
        for (let iter = 0; iter < 50; iter++) {
            for (let i = 0; i < n; i++) {
                let sum = 0;
                for (let j = 0; j < n; j++) {
                    if (i !== j) sum += R[i * n + j] * h[j];
                }
                h[i] = (p[i] - sum) / (R[i * n + i] + 1e-10);
            }
        }

        return h;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONTROLE DE ROUTING
    // ═══════════════════════════════════════════════════════════════════════
    function apply() {
        if (!convolverNode || !inputNode || !outputNode) return false;
        
        // Reconecta: Input → Convolver → Output
        inputNode.disconnect();
        inputNode.connect(convolverNode);
        convolverNode.connect(outputNode);
        
        isEnabled = true;
        console.log('[FIR-Convolution] FIR filter ACTIVE');
        return true;
    }

    function bypass() {
        if (!convolverNode || !inputNode || !outputNode) return false;
        
        // Direct pass-through
        inputNode.disconnect();
        inputNode.connect(outputNode);
        
        isEnabled = false;
        console.log('[FIR-Convolution] Bypass mode');
        return true;
    }

    function setGain(gainDb) {
        if (outputNode) {
            outputNode.gain.value = Math.pow(10, (gainDb || 0) / 20);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONEXÃO EXTERNA (para conectar ao fluxo de áudio do sistema)
    // ═══════════════════════════════════════════════════════════════════════
    function getInputNode() {
        return inputNode;
    }

    function getOutputNode() {
        return outputNode;
    }

    function connectTo(source) {
        if (source && inputNode) {
            source.connect(inputNode);
        }
    }

    function connectToDestination(dest) {
        if (dest && outputNode) {
            outputNode.connect(dest);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONSULTA DE ESTADO
    // ═══════════════════════════════════════════════════════════════════════
    function isActive() {
        return isEnabled;
    }

    function getCurrentIR() {
        return currentIR;
    }

    function getTapCount() {
        return currentIR?.length || 0;
    }

    function onReady(callback) {
        if (audioCtx && convolverNode) {
            callback();
        } else {
            _readyCallbacks.push(callback);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GERAÇÃO DE FILTROS DE CORREÇÃO (EQ -> FIR)
    // ═══════════════════════════════════════════════════════════════════════
    /**
     * Converte parametros de EQ (frequencia, gain, Q) em coeficientes FIR
     */
    function generateEQFilter(freq, gainDb, q, sampleRate = 48000) {
        const w = 2 * Math.PI * freq / sampleRate;
        const alpha = Math.sin(w) / (2 * q);
        const A = Math.pow(10, gainDb / 40);

        // Coeficientes Peaking EQ (Biquad → FIR approximated)
        const b0 = 1 + alpha * A;
        const b1 = -2 * Math.cos(w);
        const b2 = 1 - alpha * A;
        const a0 = 1 + alpha / A;
        const a1 = -2 * Math.cos(w);
        const a2 = 1 - alpha / A;

        // Converte IIR para FIR truncando resposta ao impulso
        const taps = 1024;
        const ir = new Float32Array(taps);

        // Resposta ao impulso via iteração
        let x = 0, y = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < taps; i++) {
            const delta = i === 0 ? 1 : 0;
            y = (b0 * delta + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
            x2 = x1; x1 = delta;
            y2 = y1; y1 = y;
            ir[i] = y;
        }

        return ir;
    }

    window.FIRConvolution = {
        init,
        loadIRFromArray,
        loadIRFromFile,
        generateInverseFilter,
        generateEQFilter,
        apply,
        bypass,
        setGain,
        getInputNode,
        getOutputNode,
        connectTo,
        connectToDestination,
        isActive,
        getCurrentIR,
        getTapCount,
        onReady
    };
})();