/**
 * SoundMaster — Analisador de Áudio em Tempo Real (Web Audio API)
 * Encapsulado em IIFE para evitar poluição do escopo global.
 *
 * NOTA TÉCNICA: processamento customizado usa AudioWorklet.
 * ScriptProcessorNode foi removido dos caminhos ativos por ser deprecated.
 */
(function () {
'use strict';

// Previne inicialização múltipla se o script for re-executado pelo roteador SPA
if (window.SoundMasterAnalyzerInitialized) return;
window.SoundMasterAnalyzerInitialized = true;

// Analisador de Áudio em Tempo Real (Web Audio API)
let audioCtx;
let analyser;
let analyserFast; // Novo: Analisador rápido para detecção técnica
let source;
let stream;
let monitorGain = null;
let isAnalyzing = false;
let animationId;
let lastAnalysis = null;
let silentFrameCount = 0;
let pinkMeasurementActive = false;
let pinkMeasurementCount = 0;
let pinkMeasurementSum = null;
let pinkReport = null;
let lastRt60Result = null; // ✅ Novo: Guarda o último RT60 medido para a IA
let lastRt60 = 0;
let lastRt60Multiband = {};
let lastMeasurementPosition = null;

// ✅ Novo: Arrays globais (reaproveitados) para evitar GC pressure no loop 60fps
let freqData = null;
let timeData = null;
let bufferLength = 0;

// Refs que serão capturadas no init
let canvas, canvasCtx, rmsBar, feedbackAlert, analysisSummaryText, analysisDetailList, btnSendAnalysis, btnMeasurePink, btnDesktopPink, pinkMeasureSummary, btnLogSweep, micSelect;
let waterfallCanvasEl, waterfallCtx;

let rtaCrosshairX = -1;
let rtaCrosshairY = -1;

// Web Workers & Worklets
let acousticWorker = null;
let audioWorkletNode = null;
let transferFunctionNode = null; // ✅ Novo: Nó de Função de Transferência
let refSource = null; // ✅ Novo: Fonte de Referência (Loopback)
let latestTFData = null; // ✅ Novo: Cache para snapshot
let isDemoMode = false; // ✅ Novo: Estado de simulação digital
let refAudioQueue = []; // ✅ Fila global de áudio de referência (singleton)
let sweepNode = null; // ✅ Novo: Nó Log-Sine Sweep
let sweepProcessorInstance = null; // ✅ Instância do worklet de sweep
let isSweepActive = false;
let sweepRecordingBuffer = null;
let sweepRecordingIdx = 0;
let sweepCaptureActive = false;

// --- Estado Auto-Cut ---
let isAutoCutEnabled = false;
let autoCutHistory = {}; // { '1000': -3 }
let autoCutCooldown = 0; // Previne cortes em múltiplos frames seguidos

// --- Novas Variáveis de Melhoria ---
let peakHold = { hz: 0, db: -100, timer: 0 };
// Waterfall historico manual removido: usamos shift nativo do canvas para ultra-performance
const WATERFALL_DEPTH = 100; // Quantos frames guardar na tela

// --- Estado da Ponderação de Medição SPL ---
let currentWeighting = 'A'; // 'A', 'C', ou 'Z' (Flat)
let isLeqLogging = false; // ✅ Gravação de Leq ativada/desativada
let leqLogData = []; // ✅ Array que armazena { time, spl }

// --- Variáveis do Gerador de Sinais (declaradas aqui para evitar poluição de escopo global) ---
let btnPink = null;
let btnSine = null;
let sineFreqInput = null;
let isPinkNoisePlaying = false;
let pinkNoiseNode = null;
let isSineWavePlaying = false;
let sineWaveNode = null;

// Novos sinais (Bloco 5.1)
let whiteNoiseNode = null;
let isWhiteNoisePlaying = false;
let mlsNode = null;
let isMLSPlaying = false;
let chirpNode = null;
let isChirpPlaying = false;
let dualToneNode = null;
let isDualTonePlaying = false;

class FeedbackDetector {
    constructor(bufferSize = 10) {
        this.peakHistory = new Array(bufferSize).fill(null);
        this.bufferIndex = 0;
    }
    
    analyze(peakHz, peakDb, threshold = -20) {
        this.peakHistory[this.bufferIndex % this.peakHistory.length] = { hz: peakHz, db: peakDb };
        this.bufferIndex++;
        
        // Feedback real = mesma frequência sustentada por múltiplos frames
        const recentPeaks = this.peakHistory.filter(Boolean);
        if (recentPeaks.length < this.peakHistory.length) return false;

        const avgHz = recentPeaks.reduce((s, p) => s + p.hz, 0) / recentPeaks.length;
        
        // ✅ Correção Auditoria: Tolerância proporcional (razão de freq) em vez de absoluta (Hz)
        // ±1/6 de oitava é musicalmente preciso para identificar a mesma nota/ressonância
        const allSimilarFreq = recentPeaks.every(p => 
            Math.abs(Math.log2(p.hz / avgHz)) < 1/6
        );
        const allAboveThreshold = recentPeaks.every(p => p.db > threshold);
        
        return allSimilarFreq && allAboveThreshold;
    }
}

const feedbackDetector = new FeedbackDetector(15); // Sensibilidade ajustada

    // -------------------------------------------------------------------------
    // Controles Manuais (Ferramentas Técnicas)
    // -------------------------------------------------------------------------
    function _initManualControls() {
        const btnPink = document.getElementById('btn-toggle-pink-noise');
        const sliderPink = document.getElementById('pink-noise-level');
        const valPink = document.getElementById('pink-noise-val');
        const btnDiag = document.getElementById('btn-manual-diagnostic');

        if (btnPink) {
            btnPink.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                const level = sliderPink ? sliderPink.value : -20;
                MixerService.setOscillator(enabled, level);
                console.log(`[Analyzer] Ruído Rosa: ${enabled ? 'ON' : 'OFF'} (${level}dB)`);
            });
        }

        if (sliderPink) {
            sliderPink.addEventListener('input', (e) => {
                const level = e.target.value;
                if (valPink) valPink.innerText = level + 'dB';
                // Só emite se o ruído estiver ligado (throttle implícito pelo protocolo)
                if (btnPink && btnPink.checked) {
                    MixerService.setOscillator(true, level);
                }
            });
        }

        if (btnDiag) {
            btnDiag.addEventListener('click', () => {
                if (!lastAnalysis) {
                    alert('Ative o microfone primeiro para realizar a análise.');
                    return;
                }
                const summaryEl = document.getElementById('acoustic-summary');
                if (summaryEl) {
                    summaryEl.innerHTML = `<strong>Diagnóstico Manual:</strong> ${lastAnalysis.text}`;
                    summaryEl.classList.add('text-cyan-400');
                }
                console.log('[Analyzer] Diagnóstico Manual disparado usando última análise.');
            });
        }

        // --- Range de Decibéis ---
        const inputMinDb = document.getElementById('input-min-db');
        const inputMaxDb = document.getElementById('input-max-db');
        
        if (inputMinDb && inputMaxDb) {
            const updateRange = () => {
                const min = parseInt(inputMinDb.value);
                const max = parseInt(inputMaxDb.value);
                if (analyser && analyserFast) {
                    analyser.minDecibels = min;
                    analyser.maxDecibels = max;
                    analyserFast.minDecibels = min;
                    analyserFast.maxDecibels = max;
                    console.log(`[Analyzer] Range atualizado: ${min}dB a ${max}dB`);
                }
            };
            inputMinDb.addEventListener('change', updateRange);
            inputMaxDb.addEventListener('change', updateRange);
        }

        // --- Leq Logging ---
        const btnToggleLeq = document.getElementById('btn-toggle-leq');
        const btnExportLeq = document.getElementById('btn-export-leq');

        if (btnToggleLeq) {
            btnToggleLeq.addEventListener('click', () => {
                isLeqLogging = !isLeqLogging;
                if (isLeqLogging) {
                    leqLogData = [];
                    btnToggleLeq.innerText = '⏹ Parar Leq';
                    btnToggleLeq.classList.replace('bg-slate-700', 'bg-red-600');
                    btnToggleLeq.classList.replace('hover:bg-slate-600', 'hover:bg-red-500');
                    if (btnExportLeq) btnExportLeq.classList.add('hidden');
                    console.log('[Analyzer] Iniciou gravação de Leq SPL.');
                } else {
                    btnToggleLeq.innerText = '▶ Gravar Leq';
                    btnToggleLeq.classList.replace('bg-red-600', 'bg-slate-700');
                    btnToggleLeq.classList.replace('hover:bg-red-500', 'hover:bg-slate-600');
                    if (btnExportLeq && leqLogData.length > 0) btnExportLeq.classList.remove('hidden');
                    console.log('[Analyzer] Parou gravação de Leq SPL.');
                }
            });
        }

        if (btnExportLeq) {
            btnExportLeq.addEventListener('click', () => {
                if (leqLogData.length === 0) return;
                // ✅ FIX P0: usar \r\n (CRLF) para compatibilidade máxima com Excel/LibreOffice
                const rows = leqLogData.map(row =>
                    `${row.time},${row.spl.toFixed(2)},${row.weighting}`
                );
                const csv = ['Timestamp,SPL_dB,Weighting', ...rows].join('\r\n');
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `SoundMaster_Leq_SPL_Log_${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
            });
        }
    }

    function _initAutomixControls() {
        const btnToggle = document.getElementById('btn-toggle-automix');
        const sliderSpeed = document.getElementById('automix-speed-slider');
        const valSpeed = document.getElementById('automix-speed-val');
        const btnGroupA = document.getElementById('btn-automix-group-a');
        const btnGroupB = document.getElementById('btn-automix-group-b');

        let currentGroup = 'a';

        if (btnToggle) {
            btnToggle.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                MixerService.automixControl(currentGroup, enabled ? 'enable' : 'disable');
                console.log(`[Analyzer] Automix ${currentGroup.toUpperCase()}: ${enabled ? 'ON' : 'OFF'}`);
            });
        }

        if (sliderSpeed) {
            sliderSpeed.addEventListener('input', (e) => {
                const ms = e.target.value;
                if (valSpeed) valSpeed.innerText = ms + 'ms';
                MixerService.automixControl(null, 'responseTime', ms);
            });
        }

        const updateGroupUI = (group) => {
            currentGroup = group;
            if (btnGroupA && btnGroupB) {
                btnGroupA.classList.toggle('active', group === 'a');
                btnGroupA.classList.toggle('bg-cyan-600/20', group === 'a');
                btnGroupB.classList.toggle('active', group === 'b');
                btnGroupB.classList.toggle('bg-cyan-600/20', group === 'b');
            }
        };

        btnGroupA?.addEventListener('click', () => updateGroupUI('a'));
        btnGroupB?.addEventListener('click', () => updateGroupUI('b'));
    }

    let SoundMasterAnalyzerReady = false;

    function _resizeCanvases() {
        const dpr = window.devicePixelRatio || 1;
        const canvases = [
            { el: canvas },
            { el: waterfallCanvasEl }
        ];
        const tfCanvases = ['tf-magnitude-canvas', 'tf-phase-canvas'];
        
        canvases.forEach(({ el }) => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const w = Math.floor(rect.width * dpr);
            const h = Math.floor(rect.height * dpr);
            if (el.width !== w || el.height !== h) {
                el.width = w;
                el.height = h;
                el.style.width = rect.width + 'px';
                el.style.height = rect.height + 'px';
            }
        });

        tfCanvases.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const w = Math.floor(rect.width * dpr);
            const h = Math.floor(rect.height * dpr);
            if (el.width !== w || el.height !== h) {
                el.width = w;
                el.height = h;
                el.style.width = rect.width + 'px';
                el.style.height = rect.height + 'px';
            }
        });
    }

    function initAnalyzer() {
        console.log('[Analyzer] Inicializando elementos do DOM...');
        canvas = document.getElementById('fft-canvas');
        if (!canvas) return;

        canvasCtx = canvas.getContext('2d');
        
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            rtaCrosshairX = (e.clientX - rect.left) * (canvas.width / rect.width);
            rtaCrosshairY = (e.clientY - rect.top) * (canvas.height / rect.height);
        });
        canvas.addEventListener('mouseleave', () => {
            rtaCrosshairX = -1;
            rtaCrosshairY = -1;
        });

        waterfallCanvasEl = document.getElementById('waterfall-canvas');
        if (waterfallCanvasEl) waterfallCtx = waterfallCanvasEl.getContext('2d');

        _resizeCanvases();

        _initManualControls();
        _initAutomixControls();

        // Inicializa Visualizador de Transfer Function
        if (window.SoundMasterVisualizer) window.SoundMasterVisualizer.init();
        
        // Captura de elementos
        rmsBar = document.getElementById('rms-bar');
        feedbackAlert = document.getElementById('feedback-alert');
        analysisSummaryText = document.getElementById('acoustic-summary');
        analysisDetailList = document.getElementById('acoustic-detail-list');
        btnSendAnalysis = document.getElementById('btn-send-analysis');
        btnMeasurePink = document.getElementById('btn-measure-pink');
        btnDesktopPink = document.getElementById('btn-desktop-pink-noise');
        btnLogSweep = document.getElementById('btn-log-sweep');
        micSelect = document.getElementById('mic-select');
        pinkMeasureSummary = document.getElementById('pink-measure-summary');

        // Novos elementos de sugestão IA
        const aiBox = document.getElementById('ai-suggestions-box');
        const aiText = document.getElementById('ai-suggestions-text');

        // Toggle de Auto-Cut
        const btnToggleAutoCut = document.getElementById('btn-toggle-auto-cut');
        if (btnToggleAutoCut) {
            btnToggleAutoCut.addEventListener('change', (e) => {
                isAutoCutEnabled = e.target.checked;
                console.log(`[Analyzer] Auto-Cut: ${isAutoCutEnabled ? 'ON' : 'OFF'}`);
            });
        }

        // Listeners locais da página de análise (usando clone para evitar duplicatas)
        const btnStart = document.getElementById('btn-start-audio');
        const btnStop = document.getElementById('btn-stop-audio');
        if (btnStart) {
            const newBtn = btnStart.cloneNode(true);
            btnStart.parentNode.replaceChild(newBtn, btnStart);
            newBtn.addEventListener('click', startAnalyzer);
            newBtn.disabled = isAnalyzing;
        }
        if (btnStop) {
            const newBtn = btnStop.cloneNode(true);
            btnStop.parentNode.replaceChild(newBtn, btnStop);
            newBtn.addEventListener('click', stopAnalyzer);
            newBtn.disabled = !isAnalyzing;
        }
        btnSendAnalysis?.addEventListener('click', sendAnalysisToAI);
        btnMeasurePink?.addEventListener('click', startPinkNoiseMeasurement);
        btnLogSweep?.addEventListener('click', startLogarithmicSweep);

        // Listeners Função de Transferência (Movidos para delegação global para maior robustez)
        
        // Popula lista de microfones
        _populateDeviceList();

        // Sinais
        btnPink = document.getElementById('btn-pink-noise');
        btnSine = document.getElementById('btn-sine-wave');
        sineFreqInput = document.getElementById('sine-freq');

        btnPink?.addEventListener('click', () => {
            ensureAudioCtx();
            if (isPinkNoisePlaying) stopPinkNoise();
            else startPinkNoise(false);
        });

        btnDesktopPink?.addEventListener('click', () => {
            ensureAudioCtx();
            if (isPinkNoisePlaying) stopPinkNoise();
            else startPinkNoise(false);
        });

        btnSine?.addEventListener('click', () => {
            ensureAudioCtx();
            if (isSineWavePlaying && sineWaveNode) {
                sineWaveNode.stop();
                sineWaveNode.disconnect();
                isSineWavePlaying = false;
                btnSine.innerHTML = '🎵 Tom Senoidal';
                return;
            }
            const freq = parseFloat(sineFreqInput?.value) || 60;
            sineWaveNode = audioCtx.createOscillator();
            sineWaveNode.type = 'sine';
            sineWaveNode.frequency.value = freq;
            const gainNode = audioCtx.createGain();
            gainNode.gain.value = 0.1;
            sineWaveNode.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            sineWaveNode.start();
            isSineWavePlaying = true;
            btnSine.innerHTML = '⏹ Parar Senoidal';
        });
    }

    /**
     * Inicialização Global (Botões do cabeçalho e Workers)
     * Deve rodar apenas uma vez na carga do app.
     */
    function initGlobalAnalyzer() {
        console.log('[Analyzer] Inicializando serviços globais de áudio...');
        
        // 1. Global Mic Toggle Header (Sempre presente no index.html)
        // 1. Global Mic Toggle Header (Sempre presente no index.html)
        const btnMic = document.getElementById('btn-toggle-mic');
        if (btnMic) {
            // Remove anterior para evitar duplicidade caso o init seja chamado via console/re-entry
            btnMic.removeEventListener('click', toggleAnalyzer);
            btnMic.addEventListener('click', toggleAnalyzer);
        }

        // 2. Inicializa Worker de Acústica
        if (!acousticWorker) {
            acousticWorker = new Worker('js/workers/acoustic.worker.js');
            acousticWorker.onmessage = (e) => {
                if (e.data.type === 'rt60-result') {
                    _handleRT60Result(e.data.result);
                }
                if (e.data.type === 'ir-result') {
                    _handleSweepAnalysisResult(e.data.result);
                }
                if (e.data.type === 'error') {
                    console.error('[AcousticWorker]', e.data.message);
                }
            };
        }

        // 3. Listener global para garantir que o AudioContext seja retomado por interação do usuário
        document.addEventListener('click', () => {
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        }, { once: false });
    }

async function _populateDeviceList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    try {
        const selectedDevice = micSelect?.value || 'default';
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');

        if (micSelect) {
            micSelect.innerHTML = '';
            const defaultOption = document.createElement('option');
            defaultOption.value = 'default';
            defaultOption.text = 'Microfone Padrão';
            micSelect.appendChild(defaultOption);

            audioInputs.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Microfone ${index + 1}`;
                micSelect.appendChild(option);
            });

            if ([...micSelect.options].some(opt => opt.value === selectedDevice)) {
                micSelect.value = selectedDevice;
            } else {
                micSelect.value = 'default';
            }

            if (audioInputs.length === 0) {
                const noDevice = document.createElement('option');
                noDevice.value = 'default';
                noDevice.text = 'Nenhum microfone detectado';
                noDevice.disabled = true;
                micSelect.appendChild(noDevice);
            }
        }
    } catch (err) {
        console.error('[Analyzer] Erro ao listar dispositivos:', err);
    }
}

// Ouvir evento do roteador
document.addEventListener('page-loaded', (e) => {
    // Sempre inicializa os serviços globais se ainda não foram
    if (!acousticWorker) initGlobalAnalyzer();

    if (e.detail.pageId === 'analyzer') {
        initAnalyzer();
    }
    if (e.detail.pageId === 'rt60') {
        // Inicializa controles de RT60 na página específica
        document.getElementById('btn-trigger-pulse')?.addEventListener('click', () => {
            window.SoundMasterAnalyzer.triggerImpulse();
        });
    }
});

// Cleanup global ao sair da página ou fechar aba
window.addEventListener('beforeunload', () => {
    if (isAnalyzing) stopAnalyzer();
});

async function startAnalyzer() {
    try {
        console.log('[Analyzer] startAnalyzer() chamado. Seleção de microfone:', micSelect?.value || 'default');
        const deviceId = micSelect?.value || 'default';
        const constraints = {
            audio: {
                deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1
            }
        };

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('O navegador não suporta captura de áudio ou você está em uma conexão não segura (HTTP). Use Localhost ou HTTPS.');
        }

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('[Analyzer] getUserMedia OK, tracks:', stream.getTracks().map(t => `${t.kind}:${t.readyState}:${t.enabled}`).join(', '));
        silentFrameCount = 0;
        await _populateDeviceList();
        
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        if (audioCtx.state !== 'running') {
            throw new Error('AudioContext não pôde ser iniciado. Verifique as permissões do navegador.');
        }
        
        // Carrega AudioWorklets para processamento em thread separada
        try {
            await audioCtx.audioWorklet.addModule('js/core/audio-processor.js');
            await audioCtx.audioWorklet.addModule('js/core/transfer-function-processor.js');
            
            audioWorkletNode = new AudioWorkletNode(audioCtx, 'soundmaster-processor');
            
            // Instancia o Nó de Transfer Function com 2 entradas
            transferFunctionNode = new AudioWorkletNode(audioCtx, 'transfer-function-processor', {
                numberOfInputs: 2,
                numberOfOutputs: 1
            });
            const avgSelect = document.getElementById('tf-avg-select');
            transferFunctionNode.port.postMessage({
                type: 'set-avg',
                seconds: avgSelect ? Number(avgSelect.value) : 2
            });

            transferFunctionNode.port.onmessage = (e) => {
                if (e.data.type === 'transfer-function') {
                    _handleTransferFunctionData(e.data);
                }
            };
        } catch (e) {
            console.warn('[Analyzer] AudioWorklet falhou, usando fallback.', e);
        }

        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 32768; // Alta resolução: ~1.3Hz por bin
        analyser.smoothingTimeConstant = 0.8;
        // ✅ Correção Auditoria: Padronização de janela (Hann/Blackman-Harris-inspired)
        // O Web Audio não permite setar Hann via propriedade, mas garantimos consistência
        // setando smoothing alto para visual e processando janelamento manual no Worklet.
        analyser.minDecibels = -100;
        analyser.maxDecibels = -10;
        
        source = audioCtx.createMediaStreamSource(stream);
        try {
            source.channelCountMode = 'explicit';
            source.channelCount = 1;
            source.channelInterpretation = 'discrete';
        } catch (e) {
            console.warn('[Analyzer] Não foi possível forçar mono no source:', e);
        }
        console.log('[Analyzer] MediaStreamSource criado. channelCount:', source.channelCount, 'channelInterpretation:', source.channelInterpretation);
        source.connect(analyser);

        const analyserGain = audioCtx.createGain();
        analyserGain.gain.value = 0;
        analyser.connect(analyserGain);
        analyserGain.connect(audioCtx.destination);
        console.log('[Analyzer] AnalyserNode conectado ao destino silencioso.');

        monitorGain = audioCtx.createGain();
        monitorGain.gain.value = 0;
        source.connect(monitorGain);
        monitorGain.connect(audioCtx.destination);

        if (audioWorkletNode) {
            source.connect(audioWorkletNode);
            const silentGain = audioCtx.createGain();
            silentGain.gain.value = 0;
            audioWorkletNode.connect(silentGain);
            silentGain.connect(audioCtx.destination);
        }

        // ✅ Conecta fontes ao Nó de Transfer Function
        if (transferFunctionNode) {
            // Canal 1: Medição (Microfone RTA)
            source.connect(transferFunctionNode, 0, 1);

            // Canal 0: Referência (Loopback via AES67/WebSocket)
            // Criamos um destino silencioso para o nó de referência
            _setupReferenceSource(audioCtx, transferFunctionNode);
        }

        // ✅ Novo: Analisador rápido para detecção de feedback (baixa latência)
        analyserFast = audioCtx.createAnalyser();
        analyserFast.fftSize = 4096;
        analyserFast.smoothingTimeConstant = 0.1;
        analyserFast.minDecibels = -100;
        analyserFast.maxDecibels = -10;
        source.connect(analyserFast);
        const fastGain = audioCtx.createGain();
        fastGain.gain.value = 0;
        analyserFast.connect(fastGain);
        fastGain.connect(audioCtx.destination);
        console.log('[Analyzer] AnalyserFast conectado ao destino silencioso.');

        // ── SPL Logger (IEC 61672): inicializa e arranca ticker de 1s ───────────
        if (window.SplLogger) {
            SplLogger.init(audioCtx.sampleRate);
            SplLogger.start();
        }

        // ── MTW Processor: alta resolução espectral (Multi-Time Windowing) ────────
        if (window.MtwManager) {
            MtwManager.start(audioCtx, source).then(() => {
                MtwManager.onSpectrum((spectrum) => {
                    // Publica no AppStore para qualquer componente de UI subscrever
                    AppStore.setState({ mtwSpectrum: spectrum });
                });
            });
        }

        isAnalyzing = true;
        
        // Update UI - Header
        const dot = document.getElementById('mic-status-dot');
        const text = document.getElementById('mic-status-text');
        if (dot) dot.classList.add('online');
        if (text) text.innerText = 'Mic Online';

        // Update UI - Page Buttons
        const btnStart = document.getElementById('btn-start-audio');
        const btnStop = document.getElementById('btn-stop-audio');
        if (btnStart) btnStart.disabled = true;
        if (btnStop) btnStop.disabled = false;
        
        _resizeCanvases();
        analyze();
    } catch (err) {
        console.error("Erro ao acessar microfone:", err);
        alert(`Erro ao acessar o microfone: ${err.message}`);
    }
}

async function stopAnalyzer() {
    console.log('[Analyzer] Parando analisador e limpando recursos...');
    
    isAnalyzing = false;
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    if (stream) {
        stream.getTracks().forEach(track => {
            console.log(`[Analyzer] Parando track: ${track.kind}`);
            track.stop();
        });
        stream = null;
    }

    if (audioCtx) {
        if (audioCtx.state !== 'closed') {
            try {
                await audioCtx.close();
                console.log('[Analyzer] AudioContext fechado.');
            } catch (e) {
                console.warn('[Analyzer] Erro ao fechar AudioContext:', e);
            }
        }
        audioCtx = null;
    }

    if (monitorGain) {
        try {
            monitorGain.disconnect();
        } catch (e) {
            console.warn('[Analyzer] Falha ao desconectar monitorGain:', e);
        }
        monitorGain = null;
    }

    // Limpeza de nós específicos
    analyser = null;
    analyserFast = null;
    source = null;
    audioWorkletNode = null;

    // ✅ Limpa timer do worklet de referência
    if (window._refSourceFeedTimer) {
        clearInterval(window._refSourceFeedTimer);
        window._refSourceFeedTimer = null;
    }

    // ── SPL Logger: para o ticker ─────────────────────────────────────────
    if (window.SplLogger) SplLogger.stop();

    // ── MTW Manager: desliga análise multi-banda ─────────────────────────
    if (window.MtwManager) MtwManager.stop();

    if (pinkNoiseNode) {
        pinkNoiseNode.disconnect();
        pinkNoiseNode = null;
    }
    if (sineWaveNode) {
        sineWaveNode.disconnect();
        sineWaveNode = null;
    }
    
    if (canvasCtx && canvas) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    if (rmsBar) rmsBar.style.width = '0%';
    
    // Update UI - Header
    const dot = document.getElementById('mic-status-dot');
    const text = document.getElementById('mic-status-text');
    if (dot) dot.classList.remove('online');
    if (text) text.innerText = 'Mic Offline';
    
    // Update UI - Page Buttons
    const btnStart = document.getElementById('btn-start-audio');
    const btnStop = document.getElementById('btn-stop-audio');
    if (btnStart) btnStart.disabled = false;
    if (btnStop) btnStop.disabled = true;
    
    if (feedbackAlert) {
        feedbackAlert.className = 'alert safe';
        feedbackAlert.innerHTML = 'Sem picos perigosos.';
    }
    if (analysisSummaryText) {
        analysisSummaryText.innerText = 'Aguardando análise...';
    }
}

function formatDb(value) {
    return value.toFixed(1);
}
function getBandAverage(freqData, sampleRate, minHz, maxHz, fftSize) {
    let sum = 0;
    let count = 0;
    const hzPerBin = sampleRate / fftSize;

    for (let i = 0; i < freqData.length; i++) {
        const freq = i * hzPerBin;
        if (freq >= minHz && freq < maxHz) {
            // ✅ Correção Auditoria: Ponderação Logarítmica (1/f)
            const weight = 1.0 / Math.max(freq, 20);
            sum += freqData[i] * weight;
            count += weight;
        }
    }
    return count ? sum / count : -100;
}

/**
 * ✅ Correção Auditoria: Ponderação-A (A-Weighting) conforme IEC 61672:2003.
 * Essencial para medições de SPL que refletem a audição humana.
 */
function getAWeighting(freq) {
    if (freq < 1) return -100;
    const f2 = freq * freq;
    const f4 = f2 * f2;
    
    const rA = (Math.pow(12194, 2) * f4) /
        ((f2 + Math.pow(20.6, 2)) * Math.sqrt((f2 + Math.pow(107.7, 2)) * (f2 + Math.pow(737.9, 2))) * (f2 + Math.pow(12194, 2)));
    
    return 20 * Math.log10(rA) + 2.00;
}

/**
 * Ponderação-C (C-Weighting) conforme IEC 61672:2003.
 * Usada para medições de picos e baixas frequências (graves mais presentes).
 */
function getCWeighting(freq) {
    if (freq < 1) return -100;
    const f2 = freq * freq;
    
    const rC = (Math.pow(12194, 2) * f2) /
        ((f2 + Math.pow(20.6, 2)) * (f2 + Math.pow(12194, 2)));
    
    return 20 * Math.log10(rC) + 0.06;
}

/**
 * ✅ Novo: Calcula RMS Ponderado (A, C ou Z) e Crest Factor
 */
function calculateAcousticMetrics(timeData, freqData, sampleRate) {
    let sumSqWeighted = 0;
    let peak = 0;
    const hzPerBin = sampleRate / (freqData.length * 2);

    // 1. RMS Ponderado via Domínio da Frequência
    for (let i = 0; i < freqData.length; i++) {
        const freq = i * hzPerBin;
        const db = freqData[i];
        
        let weight = 0; // Ponderação Z (Flat) por padrão
        if (currentWeighting === 'A') {
            weight = getAWeighting(freq);
        } else if (currentWeighting === 'C') {
            weight = getCWeighting(freq);
        }
        
        const weightedDb = db + weight;
        
        // Converte dB para potência linear (10^(dB/10))
        sumSqWeighted += Math.pow(10, weightedDb / 10);
    }
    
    // 2. Pico Real (Domínio do Tempo) para Clipping e Crest Factor
    for (let i = 0; i < timeData.length; i++) {
        const val = Math.abs(timeData[i]);
        if (val > peak) peak = val;
    }

    const rmsDb = 10 * Math.log10(sumSqWeighted + 1e-12);
    const peakDb = 20 * Math.log10(peak + 1e-12);
    const crestFactor = peakDb - rmsDb;

    return {
        rmsDb: rmsDb,
        weighting: currentWeighting,
        peakDb: peakDb,
        crestFactor: crestFactor,
        isClipping: peak > 0.98
    };
}

function formatBandLabel(hz) {
    if (hz >= 1000) return `${hz / 1000}kHz`;
    return `${hz}Hz`;
}

function getPinkReference(freq, referenceDb) {
    const refHz = 250;
    if (freq <= 0) return referenceDb;
    const octaves = Math.log2(freq / refHz);
    return referenceDb - 3 * octaves;
}

function buildPinkNoiseReport(avgSpectrum, sampleRate) {
    const bands = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
    
    // ✅ Correção Auditoria: Usar 1kHz como referência em vez de 0Hz (DC)
    const refBin = Math.round(1000 * analyser.fftSize / sampleRate);
    const referenceDb = avgSpectrum[refBin] || -60;
    
    const report = [];
    const deviations = {};
    let lowSum = 0;
    let midSum = 0;
    let highSum = 0;
    let lowCount = 0;
    let midCount = 0;
    let highCount = 0;

    for (const hz of bands) {
        const index = Math.round(hz * analyser.fftSize / sampleRate);
        const measured = avgSpectrum[index] || analyser.minDecibels;
        const ideal = getPinkReference(hz, referenceDb);
        const deviation = measured - ideal;
        deviations[hz] = formatDb(deviation);
        report.push(` ${formatBandLabel(hz)}: ${formatDb(measured)} dB (${formatDb(deviation)} dB)`);

        if (hz <= 250) { lowSum += measured; lowCount += 1; }
        else if (hz <= 2000) { midSum += measured; midCount += 1; }
        else { highSum += measured; highCount += 1; }
    }

    const lowAvg = lowCount ? lowSum / lowCount : -100;
    const midAvg = midCount ? midSum / midCount : -100;
    const highAvg = highCount ? highSum / highCount : -100;
    const conclusions = [];
    if (lowAvg > midAvg + 4) conclusions.push('grave elevado');
    if (lowAvg < midAvg - 4) conclusions.push('grave fraco');
    if (highAvg < midAvg - 4) conclusions.push('agudos muito retraidos');
    if (highAvg > midAvg + 4) conclusions.push('agudos vivos ou reflexivos');
    if (Math.abs(midAvg - lowAvg) < 3 && Math.abs(highAvg - midAvg) < 3) conclusions.push('curva relativamente equilibrada');

    const summaryText = `Medição rosa: ${conclusions.length ? conclusions.join(', ') + '.' : 'sem desvio pronunciado.'}`;
    return {
        summary: summaryText,
        details: {
            bands: deviations,
            averages: {
                low: formatDb(lowAvg),
                mid: formatDb(midAvg),
                high: formatDb(highAvg)
            },
            reportLines: report
        }
    };
}

function buildAcousticSummary(freqData, timeData) {
    const peak = { db: -Infinity, index: 0 };
    const minBin = Math.floor(20 * analyser.fftSize / audioCtx.sampleRate); // Ignora ruído subsônico/DC (0Hz)
    for (let i = minBin; i < freqData.length; i++) {
        if (freqData[i] > peak.db) {
            peak.db = freqData[i];
            peak.index = i;
        }
    }

    const metrics = calculateAcousticMetrics(timeData, freqData, audioCtx.sampleRate);
    const rmsDb = metrics.rmsDb;
    const crestFactor = metrics.crestFactor;

    const peakHz = peak.index * audioCtx.sampleRate / analyser.fftSize;
    const lowAvg = getBandAverage(freqData, audioCtx.sampleRate, 20, 250, analyser.fftSize);
    const lowMidAvg = getBandAverage(freqData, audioCtx.sampleRate, 250, 800, analyser.fftSize);
    const midAvg = getBandAverage(freqData, audioCtx.sampleRate, 800, 2000, analyser.fftSize);
    const highMidAvg = getBandAverage(freqData, audioCtx.sampleRate, 2000, 5000, analyser.fftSize);
    const highAvg = getBandAverage(freqData, audioCtx.sampleRate, 5000, 16000, analyser.fftSize);

    const notes = [];
    if (lowAvg > midAvg + 6) notes.push('grave muito presente');
    else if (lowAvg < midAvg - 6) notes.push('grave fraco');
    
    if (highMidAvg > midAvg + 5) notes.push('médio-agudos proeminentes (atenção a sibilância)');
    if (highAvg < highMidAvg - 6) notes.push('falta de brilho nos agudos superiores');
    else if (highAvg > highMidAvg + 6) notes.push('agudos muito vivos');

    if (peak.db > -18 && peakHz > 20 && peakHz < 8000) notes.push(`pico estreito em ${Math.round(peakHz)} Hz`);

    const summaryText = `SPL(${metrics.weighting}) ${formatDb(rmsDb)} dB | Pico Real ${formatDb(metrics.peakDb)} dB | Crista ${crestFactor.toFixed(1)} dB. G:${formatDb(lowAvg)} | LM:${formatDb(lowMidAvg)} | M:${formatDb(midAvg)} | HM:${formatDb(highMidAvg)} | A:${formatDb(highAvg)}.` +
        (notes.length ? ' Obs: ' + notes.join('; ') + '.' : ' Resposta equilibrada.');

    return {
        text: summaryText,
        details: {
            peakHz: Math.round(peakHz),
            peakDb: formatDb(peak.db),
            rmsDb: formatDb(rmsDb),
            crestFactor: crestFactor.toFixed(1),
            weighting: metrics.weighting,
            spectrum_v11: {
                "125": formatDb(getBandAverage(freqData, audioCtx.sampleRate, 110, 140, analyser.fftSize)),
                "500": formatDb(getBandAverage(freqData, audioCtx.sampleRate, 450, 550, analyser.fftSize)),
                "1000": formatDb(getBandAverage(freqData, audioCtx.sampleRate, 900, 1100, analyser.fftSize)),
                "4000": formatDb(getBandAverage(freqData, audioCtx.sampleRate, 3600, 4400, analyser.fftSize))
            },
            bands: {
                low: formatDb(lowAvg),
                lowMid: formatDb(lowMidAvg),
                mid: formatDb(midAvg),
                highMid: formatDb(highMidAvg),
                high: formatDb(highAvg)
            }
        }
    };
}

function renderAnalysisDetails(summary, pink) {
    if (!analysisDetailList) return;
    analysisDetailList.innerHTML = '';
    const items = [
        `RMS: ${summary.details.rmsDb} dB`,
        `Pico: ${summary.details.peakHz} Hz (${summary.details.peakDb} dB)`,
        `Graves: ${summary.details.bands.low} dB`,
        `Low-Mid: ${summary.details.bands.lowMid} dB`,
        `Médios: ${summary.details.bands.mid} dB`,
        `Altos Médios: ${summary.details.bands.highMid} dB`,
        `Agudos: ${summary.details.bands.high} dB`
    ];
    if (pink) {
        items.push(`Relatório rosa: ${pink.summary}`);
        if (pink.details && pink.details.reportLines) {
            pink.details.reportLines.forEach(line => items.push(line));
        }
    }
    items.forEach(text => {
        const li = document.createElement('li');
        li.innerText = text;
        analysisDetailList.appendChild(li);
    });
}

function buildRt60Payload(rt60Result) {
    if (!rt60Result) return null;
    if (rt60Result.multiband && typeof rt60Result.multiband === 'object' && Object.keys(rt60Result.multiband).length) {
        return rt60Result.multiband;
    }
    if (rt60Result.rt60 === undefined || rt60Result.rt60 === null) return null;
    const rt60Value = Number(rt60Result.rt60);
    if (!Number.isFinite(rt60Value)) return null;
    return {
        '125': rt60Value,
        '500': rt60Value,
        '1000': rt60Value,
        '4000': rt60Value
    };
}

function getCurrentMeasurementPosition() {
    if (lastMeasurementPosition) return lastMeasurementPosition;
    return null;
}

function startPinkNoiseMeasurement() {
    if (!audioCtx) {
        alert('Ative o microfone antes de iniciar a medição de ruído rosa.');
        return;
    }
    if (pinkMeasurementActive) return;
    if (!isPinkNoisePlaying) {
        startPinkNoise(true);
    }
    pinkMeasurementActive = true;
    pinkMeasurementCount = 0;
    pinkMeasurementSum = new Float32Array(analyser.frequencyBinCount);
    pinkReport = null;
    if (pinkMeasureSummary) {
        pinkMeasureSummary.innerText = 'Medindo ruído rosa... mantenha o microfone estável.';
    }
    btnMeasurePink && (btnMeasurePink.innerText = '⏳ Medindo...');
}

function finishPinkNoiseMeasurement() {
    pinkMeasurementActive = false;
    const averageSpectrum = new Float32Array(pinkMeasurementSum.length);
    for (let i = 0; i < pinkMeasurementSum.length; i++) {
        averageSpectrum[i] = pinkMeasurementSum[i] / Math.max(1, pinkMeasurementCount);
    }
    pinkReport = buildPinkNoiseReport(averageSpectrum, audioCtx.sampleRate);
    
    // ✅ Correção Auditoria: Validar se o ruído rosa estava realmente ativo
    // O ruído rosa tem uma queda característica de -3dB/oitava.
    // Verificamos a diferença entre 250Hz e 4000Hz (4 oitavas -> ~12dB de queda esperada)
    const lowCheck = getBandAverage(averageSpectrum, audioCtx.sampleRate, 200, 300, analyser.fftSize);
    const highCheck = getBandAverage(averageSpectrum, audioCtx.sampleRate, 3500, 4500, analyser.fftSize);
    const slope = lowCheck - highCheck;

    if (slope < 6 || slope > 20) {
        if (pinkMeasureSummary) {
            pinkMeasureSummary.innerHTML = `<span class="text-amber-400 font-bold">⚠️ Atenção: Ruído rosa não detectado ou inconsistente.</span><br><small class="text-slate-400">Verifique se o sinal está sendo reproduzido no som do salão.</small>`;
        }
    } else {
        if (pinkMeasureSummary) {
            pinkMeasureSummary.innerText = pinkReport.summary;
        }
    }

    lastAnalysis = lastAnalysis || {};
    lastAnalysis.pinkReport = pinkReport;
    btnMeasurePink && (btnMeasurePink.innerText = '🎚️ Medir Ruído Rosa');
    if (isPinkNoisePlaying && pinkNoiseNode) {
        stopPinkNoise();
    }
}

async function startPinkNoise(autoStop = false) {
    ensureAudioCtx();

    // Cria o nó apenas uma vez via AudioWorklet.
    if (!pinkNoiseNode && window.AcousticCalibration) {
        pinkNoiseNode = await AcousticCalibration.createPinkNoiseNode(audioCtx, 0.25);
    }

    if (pinkNoiseNode) pinkNoiseNode.connect(audioCtx.destination);
    isPinkNoisePlaying = true;
    btnPink && (btnPink.innerHTML = '⏹ Parar Ruído Rosa');
    btnPink && btnPink.classList.remove('secondary');
    btnPink && btnPink.classList.add('primary');

    if (autoStop) {
        setTimeout(() => {
            if (pinkMeasurementActive) finishPinkNoiseMeasurement();
        }, 4000);
    }
}

function stopPinkNoise() {
    if (pinkNoiseNode) {
        try { pinkNoiseNode.disconnect(); } catch (_) {}
    }
    isPinkNoisePlaying = false;
    btnPink && (btnPink.innerHTML = '🔊 Ruído Rosa (Pink)');
    btnPink && btnPink.classList.remove('primary');
    btnPink && btnPink.classList.add('secondary');
}

// ═══════════════════════════════════════════════════════════════════════════
// NOVOS SINAIS (Bloco 5.1): White Noise, MLS, Chirp, Dual-Tone
// ═══════════════════════════════════════════════════════════════════════════

async function startWhiteNoise(amplitude = 0.3) {
    ensureAudioCtx();
    try {
        await audioCtx.audioWorklet.addModule('js/core/signal-generators.js');
        whiteNoiseNode = new AudioWorkletNode(audioCtx, 'white-noise-processor');
        whiteNoiseNode.parameters.get('amplitude').value = amplitude;
        whiteNoiseNode.connect(audioCtx.destination);
        isWhiteNoisePlaying = true;
        console.log('[SignalGen] White Noise started');
        return true;
    } catch (e) {
        console.error('[SignalGen] White Noise failed:', e);
        return false;
    }
}

function stopWhiteNoise() {
    if (whiteNoiseNode) {
        try { whiteNoiseNode.disconnect(); } catch (_) {}
        whiteNoiseNode = null;
    }
    isWhiteNoisePlaying = false;
    console.log('[SignalGen] White Noise stopped');
}

async function startMLS(order = 13, amplitude = 0.5) {
    ensureAudioCtx();
    try {
        await audioCtx.audioWorklet.addModule('js/core/signal-generators.js');
        mlsNode = new AudioWorkletNode(audioCtx, 'mls-processor');
        mlsNode.parameters.get('order').value = order;
        mlsNode.parameters.get('amplitude').value = amplitude;
        mlsNode.connect(audioCtx.destination);
        isMLSPlaying = true;
        console.log(`[SignalGen] MLS started (order ${order})`);
        return true;
    } catch (e) {
        console.error('[SignalGen] MLS failed:', e);
        return false;
    }
}

function stopMLS() {
    if (mlsNode) {
        try { mlsNode.disconnect(); } catch (_) {}
        mlsNode = null;
    }
    isMLSPlaying = false;
    console.log('[SignalGen] MLS stopped');
}

async function startChirp(startFreq = 20, endFreq = 20000, duration = 2.0, amplitude = 0.5) {
    ensureAudioCtx();
    try {
        await audioCtx.audioWorklet.addModule('js/core/signal-generators.js');
        chirpNode = new AudioWorkletNode(audioCtx, 'chirp-processor');
        chirpNode.parameters.get('startFreq').value = startFreq;
        chirpNode.parameters.get('endFreq').value = endFreq;
        chirpNode.parameters.get('duration').value = duration;
        chirpNode.parameters.get('amplitude').value = amplitude;
        chirpNode.connect(audioCtx.destination);
        isChirpPlaying = true;
        console.log(`[SignalGen] Chirp started (${startFreq}-${endFreq}Hz, ${duration}s)`);
        return true;
    } catch (e) {
        console.error('[SignalGen] Chirp failed:', e);
        return false;
    }
}

function stopChirp() {
    if (chirpNode) {
        try { chirpNode.disconnect(); } catch (_) {}
        chirpNode = null;
    }
    isChirpPlaying = false;
    console.log('[SignalGen] Chirp stopped');
}

async function startDualTone(freq1 = 1000, freq2 = 1500, amplitude = 0.3) {
    ensureAudioCtx();
    try {
        await audioCtx.audioWorklet.addModule('js/core/signal-generators.js');
        dualToneNode = new AudioWorkletNode(audioCtx, 'dual-tone-processor');
        dualToneNode.parameters.get('freq1').value = freq1;
        dualToneNode.parameters.get('freq2').value = freq2;
        dualToneNode.parameters.get('amplitude').value = amplitude;
        dualToneNode.connect(audioCtx.destination);
        isDualTonePlaying = true;
        console.log(`[SignalGen] Dual-Tone started (${freq1}Hz + ${freq2}Hz)`);
        return true;
    } catch (e) {
        console.error('[SignalGen] Dual-Tone failed:', e);
        return false;
    }
}

function stopDualTone() {
    if (dualToneNode) {
        try { dualToneNode.disconnect(); } catch (_) {}
        dualToneNode = null;
    }
    isDualTonePlaying = false;
    console.log('[SignalGen] Dual-Tone stopped');
}

function stopAllSignals() {
    stopPinkNoise();
    stopWhiteNoise();
    stopMLS();
    stopChirp();
    stopDualTone();
    if (isSineWavePlaying && sineWaveNode) {
        sineWaveNode.stop();
        sineWaveNode.disconnect();
        isSineWavePlaying = false;
    }
}


/**
 * Configura a fonte de referência via WebSocket PCM Stream.
 * P0: usa AudioWorkletNode; ScriptProcessorNode foi removido por ser deprecated.
 */
async function _setupReferenceSource(ctx, targetNode) {
    try {
        // Tenta carregar o worklet de fonte de referência
        await ctx.audioWorklet.addModule('js/core/reference-source-processor.js');
        refSource = new AudioWorkletNode(ctx, 'reference-source-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1]
        });

        // Injeta amostras da fila global no worklet quando disponíveis
        const _feedWorklet = setInterval(() => {
            if (!refSource || refAudioQueue.length === 0) return;
            // Transfere até 4096 amostras por vez ao worklet
            const chunk = refAudioQueue.splice(0, 4096);
            refSource.port.postMessage({ type: 'pcm', samples: new Float32Array(chunk) });
        }, 50);

        // Guarda o timer para cleanup no stopAnalyzer
        window._refSourceFeedTimer = _feedWorklet;

        console.log('[ReferenceSource] AudioWorklet inicializado.');
    } catch (err) {
        console.error('[ReferenceSource] Falha ao carregar AudioWorklet:', err.message);
        refSource = null;
        return;
    }

    if (!refSource) return;

    // Conecta a referência ao Canal 0 do nó de Transfer Function
    refSource.connect(targetNode, 0, 0);

    // Saída silenciosa para manter o clock ativo
    const silent = ctx.createGain();
    silent.gain.value = 0;
    refSource.connect(silent);
    silent.connect(ctx.destination);
}

/**
 * ✅ Novo: Processa dados da Função de Transferência para a UI
 */
function _handleTransferFunctionData(data) {
    latestTFData = data; // Armazena para snapshot
    const { magnitude, phase, coherence, delayMs, sampleRate } = data;
    
    // 1. Atualiza o valor do Delay Finder na UI
    const delayEl = document.getElementById('delay-finder-value');
    if (delayEl) {
        delayEl.innerText = `${delayMs.toFixed(2)} ms`;
        // Se o delay for muito alto (> 100ms), destaca em amarelo
        delayEl.style.color = delayMs > 100 ? '#facc15' : '#22d3ee';
    }

    // 2. Atualiza a Coerência Média (Avg Coherence)
    const avgCoherence = coherence.reduce((a, b) => a + b, 0) / coherence.length;
    const coherenceEl = document.getElementById('coherence-value');
    if (coherenceEl) {
        coherenceEl.innerText = `${avgCoherence.toFixed(0)}%`;
        // Escala de cor para coerência
        if (avgCoherence > 80) coherenceEl.style.color = '#4ade80'; // Verde (Bom)
        else if (avgCoherence > 50) coherenceEl.style.color = '#facc15'; // Amarelo (Médio)
        else coherenceEl.style.color = '#f87171'; // Vermelho (Ruim)
    }

    // 3. Dispara o renderizador de gráficos (Magnitude/Fase/Coerência)
    if (window.SoundMasterVisualizer) {
        window.SoundMasterVisualizer.drawTransferFunction(magnitude, phase, coherence, {
            sampleRate: sampleRate || audioCtx?.sampleRate || 48000,
            avgSeconds: data.avgSeconds,
            avgFrames: data.avgFrames
        });
    }
}

function stopPinkNoiseMeasurement() {
    pinkMeasurementActive = false;
    pinkMeasurementCount = 0;
    pinkMeasurementSum = null;
    if (pinkMeasureSummary) {
        pinkMeasureSummary.innerText = 'Medição cancelada.';
    }
    btnMeasurePink && (btnMeasurePink.innerText = '🎚️ Medir Ruído Rosa');
}

function _drawWaterfallTimeAxis(ctx, x, y, width, height) {
    const right = x + width;
    const midY = y + height / 2;
    const bottomY = y + height - 5;

    ctx.save();
    ctx.clearRect(x, y, width, height);
    ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, y);
    ctx.lineTo(x + 0.5, y + height);
    ctx.stroke();

    ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('0s', right - 4, y + 2);
    ctx.textBaseline = 'middle';
    ctx.fillText('-5s', right - 4, midY);
    ctx.textBaseline = 'bottom';
    ctx.fillText('-10s', right - 4, bottomY);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    [y + 1, midY, y + height - 1].forEach((tickY) => {
        ctx.beginPath();
        ctx.moveTo(x, tickY);
        ctx.lineTo(x + 5, tickY);
        ctx.stroke();
    });
    ctx.restore();
}

function analyze() {
    if (!isAnalyzing) return;
    
    try {
        animationId = requestAnimationFrame(analyze);
        
        // ✅ Inicializa arrays se necessário
        if (!freqData || freqData.length !== analyser.frequencyBinCount) {
            bufferLength = analyser.frequencyBinCount;
            freqData = new Float32Array(bufferLength);
            timeData = new Float32Array(analyser.fftSize);
        }
        
        analyser.getFloatFrequencyData(freqData);
        
        if (freqData.every(value => value === analyser.minDecibels)) {
            console.warn('[Analyzer] freqData todos no valor mínimo, possível sinal ausente ou source desconectado. isAnalyzing=', isAnalyzing);
        }
        
        if (freqData.every(v => !isFinite(v))) {
            silentFrameCount += 1;
            if (silentFrameCount === 10) {
                console.warn('[Analyzer] Nenhum dado de frequência recebido do microfone; verificando conexões.');
            }
        } else {
            silentFrameCount = 0;
        }
        
        // ✅ Novo: Captura dados do analisador rápido para detecção técnica/feedback
        const fastBufferLength = analyserFast.frequencyBinCount;
        const fastFreqData = new Float32Array(fastBufferLength);
        analyserFast.getFloatFrequencyData(fastFreqData);

    // Aplica correção de microfone e calibração SPL
    // ✅ FIX P0: fftSize obrigatório para cálculo correto de hzPerBin na curva de calibração
    if (window.AcousticCalibration) {
        window.AcousticCalibration.applyCalibration(freqData, audioCtx.sampleRate, analyser.fftSize);
    }
    
    analyser.getFloatTimeDomainData(timeData);

    // ── SPL Logger (IEC 61672) ──────────────────────────────────────────────
    // Alimenta o logger com os dados de frequência já calibrados.
    // O SplLogger acumula energia internamente e publica no AppStore via ticker de 1s.
    if (window.SplLogger) {
        SplLogger.push(freqData, timeData, analyser.fftSize);
    }

    // ── Auto-EQ: Acumulação de espectro de longo prazo ──────────────────────
    // Acumula freqData durante 5 segundos (≈300 frames @60fps) e calcula
    // a correção de curva alvo. Publicado no AppStore para a UI consumir.
    if (window.AutoEQ) {
        if (!window._aeqAcc) {
            window._aeqAcc = { sum: new Float32Array(freqData.length), count: 0 };
        }
        const acc = window._aeqAcc;
        for (let i = 0; i < freqData.length; i++) acc.sum[i] += freqData[i];
        acc.count++;

        if (acc.count >= 300) {
            const avg = new Float32Array(freqData.length);
            for (let i = 0; i < avg.length; i++) avg[i] = acc.sum[i] / acc.count;
            const result = AutoEQ.analyze(avg, audioCtx.sampleRate, analyser.fftSize);
            AppStore.setState({ autoEqResult: result });
            // Reinicia acumulador
            acc.sum.fill(0);
            acc.count = 0;
        }
    }

    // ✅ Novo: Detecção de Clipping (Saturação Digital)
    let isClipping = false;
    for (let i = 0; i < timeData.length; i++) {
        if (Math.abs(timeData[i]) > 0.98) {
            isClipping = true;
            break;
        }
    }

    // --- Detecção de Pico Global (Usando analyserFast para precisão temporal) ---
    let peakDb = -Infinity;
    let peakIndex = 0;
    const minBin = Math.floor(20 * analyserFast.fftSize / audioCtx.sampleRate); // ✅ Filtro 20Hz para evitar 1Hz fake
    for (let i = minBin; i < fastBufferLength; i++) {
        if (fastFreqData[i] > peakDb) {
            peakDb = fastFreqData[i];
            peakIndex = i;
        }
    }
    const currentFastPeakHz = peakIndex * audioCtx.sampleRate / analyserFast.fftSize;

    // --- Lógica de Peak Hold ---
    if (peakDb > peakHold.db) {
        peakHold.db = peakDb;
        peakHold.hz = currentFastPeakHz;
        peakHold.timer = 120; // ~2 segundos a 60fps
    } else if (peakHold.timer > 0) {
        peakHold.timer--;
    } else {
        peakHold.db = -100;
    }

    // --- Atualização Visual (Apenas se estivermos na aba de análise) ---
    if (canvas && canvasCtx) {
        // --- Renderização RTA 1/3 de Oitava (Padrão IEC 61260) ---
        const iecCenters = [
            20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 
            500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 
            6300, 8000, 10000, 12500, 16000, 20000
        ];
        
        canvasCtx.fillStyle = '#0f172a'; // Deep Slate Blue (Paleta SoundMaster)
        canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        
        const numBands = iecCenters.length;
        const spacing = 2; // px
        const barWidth = (canvas.width - (spacing * (numBands - 1))) / numBands;
        
        let x = 0;
        
        // Fator limitante para 1/3 de oitava: 2^(1/6) ~= 1.12246
        const halfStep = Math.pow(2, 1/6);
        
        for (let i = 0; i < numBands; i++) {
            const fc = iecCenters[i];
            const freqStart = fc / halfStep;
            const freqEnd = fc * halfStep;

            // Converte frequência para bins do buffer FFT
            const binStart = Math.max(0, Math.floor(freqStart * analyser.fftSize / audioCtx.sampleRate));
            const binEnd = Math.min(bufferLength, Math.ceil(freqEnd * analyser.fftSize / audioCtx.sampleRate));
            
            let maxDbInBin = -120;
            if (binStart >= binEnd) {
                // Muito grave, FFT sem bin suficiente para a banda inteira, pega o bin mais próximo
                const bin = Math.max(0, Math.round(fc * analyser.fftSize / audioCtx.sampleRate));
                maxDbInBin = freqData[bin] || -120;
            } else {
                for (let j = binStart; j < binEnd; j++) {
                    if (freqData[j] > maxDbInBin) maxDbInBin = freqData[j];
                }
            }
            
            let fillStyle = '#64748b'; // Slate 500 default
            if (fc < 60) fillStyle = '#3b82f6';        // Sub (Blue)
            else if (fc < 250) fillStyle = '#10b981';  // Low (Emerald)
            else if (fc < 2000) fillStyle = '#f59e0b'; // Mid (Amber)
            else if (fc < 6000) fillStyle = '#f97316'; // High-Mid (Orange)
            else fillStyle = '#ef4444';                // High (Red)

            const normalized = Math.max(0, Math.min(1, (maxDbInBin - analyser.minDecibels) / (analyser.maxDecibels - analyser.minDecibels)));
            const barHeight = normalized * canvas.height;

            canvasCtx.fillStyle = fillStyle;
            canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            x += barWidth + spacing;
        }

    // Desenhar Peak Hold Line Corrigido para as bandas IEC
    if (peakHold.timer > 0) {
        // Acha a banda mais próxima do pico
        let closestBandIndex = 0;
        let minDiff = Infinity;
        for (let i = 0; i < numBands; i++) {
            const diff = Math.abs(iecCenters[i] - peakHold.hz);
            if (diff < minDiff) {
                minDiff = diff;
                closestBandIndex = i;
            }
        }
        
        const peakX = closestBandIndex * (barWidth + spacing);
        const peakNormalized = Math.max(0, Math.min(1, (peakHold.db - analyser.minDecibels) / (analyser.maxDecibels - analyser.minDecibels)));
        const peakY = canvas.height - (peakNormalized * canvas.height);
        
        canvasCtx.strokeStyle = '#ffffff';
        canvasCtx.lineWidth = 2;
        canvasCtx.beginPath();
        canvasCtx.moveTo(peakX, peakY);
        canvasCtx.lineTo(peakX + barWidth, peakY);
        canvasCtx.stroke();
    }

    // --- Crosshair UI (RTA) ---
    if (rtaCrosshairX > 0 && rtaCrosshairY > 0 && window.Crosshair) {
        Crosshair.drawRTA(canvasCtx, rtaCrosshairX, rtaCrosshairY, {
            width: canvas.width,
            height: canvas.height,
            color: '#22d3ee',
            minDb: analyser.minDecibels,
            maxDb: analyser.maxDecibels,
            iecCenters: iecCenters
        });
    }

    // --- Lógica de Waterfall (Histórico Visual Otimizado) ---

    if (waterfallCtx && waterfallCanvasEl) {
        const w = waterfallCanvasEl.width;
        const h = waterfallCanvasEl.height;
        const rowHeight = Math.max(1, h / WATERFALL_DEPTH);
        const axisWidth = 34;
        const plotW = Math.max(1, w - axisWidth);
        
        // GPU Native Scroll: Desloca a imagem para baixo sem re-renderizar arrays pesados
        waterfallCtx.drawImage(waterfallCanvasEl, 0, 0, plotW, h - rowHeight, 0, rowHeight, plotW, h - rowHeight);
        waterfallCtx.clearRect(0, 0, plotW, rowHeight);
        
        // Otimização: desenha apenas 'w' retângulos na primeira linha (1px por bin agrupado)
        const wfTotalBars = Math.floor(plotW);
        const wfBinsPerBar = Math.max(1, Math.floor(bufferLength / wfTotalBars));
        
        for (let i = 0; i < wfTotalBars; i++) {
            const binStart = i * wfBinsPerBar;
            const binEnd = Math.min(binStart + wfBinsPerBar, bufferLength);
            
            let maxDbInBin = -Infinity;
            for (let j = binStart; j < binEnd; j++) {
                if (freqData[j] > maxDbInBin) maxDbInBin = freqData[j];
            }
            
            const db = maxDbInBin;
            const normalized = Math.max(0, Math.min(1, (db - analyser.minDecibels) / (analyser.maxDecibels - analyser.minDecibels)));
            
            // Cor baseada em intensidade (Heatmap)
            let color;
            if (normalized < 0.2) color = `rgb(0, 0, ${Math.floor(normalized * 255)})`;
            else if (normalized < 0.5) color = `rgb(0, ${Math.floor((normalized-0.2)*255)}, 255)`;
            else if (normalized < 0.8) color = `rgb(${Math.floor((normalized-0.5)*255)}, 255, 0)`;
            else color = `rgb(255, ${Math.floor((1-normalized)*255)}, 0)`;
            
            waterfallCtx.fillStyle = color;
            waterfallCtx.fillRect(i, 0, 1, rowHeight);
        }
        
        // --- Eixo de Tempo (P2) ---
        // Desenha a marcação de tempo (ex: 14:05:02) a cada virada de segundo na linha zero.
        // O drawImage() de scroll nativo (linha 1207) cuidará de rolar isso suavemente para baixo.
        _drawWaterfallTimeAxis(waterfallCtx, plotW, 0, axisWidth, h);

        if (!window._lastWfSec) window._lastWfSec = 0;
        const nowSec = Math.floor(Date.now() / 1000);
        if (nowSec !== window._lastWfSec) {
            window._lastWfSec = nowSec;
            waterfallCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            waterfallCtx.fillRect(0, 0, plotW, 1);
        }
    }
    } // Fim do if (canvas && canvasCtx)

    // ── Spatial Averaging: alimenta microfone primário e desenha overlay ────
    // O SpatialAverager só renderiza quando há ≥2 fontes activas.
    // Em modo de microfone único, o overhead é apenas 1 pushSource() + 1 check.
    if (window.SpatialAverager) {
        // Regista o microfone primário na primeira vez que o analyzer corre
        if (isAnalyzing && !SpatialAverager._primaryRegistered) {
            SpatialAverager.addSource('primary', 'Mic Principal', '#ffffff');
            SpatialAverager._primaryRegistered = true;
        }
        if (isAnalyzing) {
            SpatialAverager.pushSource('primary', freqData);
        }
        // Overlay no canvas (só visível se houver ≥2 fontes com dados)
        if (canvas && canvasCtx && SpatialAverager.getResult()?.meta?.n >= 2) {
            SpatialAverager.drawOverlay(canvasCtx, canvas, analyser, audioCtx.sampleRate);
        }
    }

    const peakHz = peakIndex * audioCtx.sampleRate / analyser.fftSize;
    const neighborLeft = freqData[Math.max(0, peakIndex - 1)] || analyser.minDecibels;
    const neighborRight = freqData[Math.min(bufferLength - 1, peakIndex + 1)] || analyser.minDecibels;
    const neighborAvg = (neighborLeft + neighborRight) / 2;
    
    // ✅ Utiliza o cálculo padronizado Ponderado (A/C/Z)
    const metrics = calculateAcousticMetrics(timeData, freqData, audioCtx.sampleRate);
    const rmsDb = metrics.rmsDb;
    const crestFactor = metrics.crestFactor;
    
    // Converte de volta para potência linear só para a variável global currentGlobalRMS usada pelo calibrador legadado
    window.currentGlobalRMS = Math.pow(10, rmsDb / 20); 

    // ✅ Novo: Gravação contínua de Leq
    if (isLeqLogging) {
        // Grava a cada 1 segundo (~60 frames @ 60fps). Usaremos um contador no timestamp para não encher a memória muito rápido
        const nowMs = Date.now();
        if (!window._lastLeqTime || nowMs - window._lastLeqTime > 1000) {
            leqLogData.push({ time: new Date(nowMs).toISOString(), spl: rmsDb, weighting: metrics.weighting });
            window._lastLeqTime = nowMs;
        }
    }

    const rmsPercent = Math.min(100, Math.max(0, ((rmsDb - analyser.minDecibels) / (analyser.maxDecibels - analyser.minDecibels)) * 100));
    if (rmsBar) {
        rmsBar.style.width = `${rmsPercent}%`;
        // Alerta visual de Clipping na barra de RMS
        rmsBar.style.backgroundColor = isClipping ? '#ef4444' : '#10b981';
    }
    
    const summary = buildAcousticSummary(freqData, timeData);
    if (pinkMeasurementActive) {
        if (!pinkMeasurementSum || pinkMeasurementSum.length !== bufferLength) {
            pinkMeasurementSum = new Float32Array(bufferLength);
        }
        for (let i = 0; i < bufferLength; i++) {
            pinkMeasurementSum[i] += freqData[i];
        }
        pinkMeasurementCount += 1;
        const progress = Math.min(100, Math.round((pinkMeasurementCount / 80) * 100));
        if (pinkMeasureSummary) {
            pinkMeasureSummary.innerText = `Medindo ruído rosa... ${progress}%`;
        }
        if (pinkMeasurementCount >= 80) {
            finishPinkNoiseMeasurement();
        }
    }
    lastAnalysis = summary;
    if (pinkReport) {
        lastAnalysis.pinkReport = pinkReport;
    }
    if (analysisSummaryText) {
        let text = summary.text + ` [Crest Factor: ${crestFactor.toFixed(1)} dB]`;
        if (isClipping) text = "⚠️ CLIPPING DETECTADO! Reduza o ganho. " + text;
        analysisSummaryText.innerText = text;
    }
    renderAnalysisDetails(summary, pinkReport);
    
    const btnAutoCut = document.getElementById('btn-auto-cut');
    
    // ✅ Correção Auditoria: Feedback detectado no analisador rápido (latência mínima)
    const isFeedback = feedbackDetector.analyze(currentFastPeakHz, peakDb, -20);
    
    // Timer para o Auto-Cut
    if (autoCutCooldown > 0) autoCutCooldown--;
    
    // ✅ Novo: Solicita verificação de risco de IA se houver pico relevante
    if (isAnalyzing && peakDb > -15) {
        SocketService.emit('analyze_feedback_risk', { 
            hz: Math.round(currentFastPeakHz), 
            db: peakDb, 
            prevDb: lastAnalysis?.details?.peakDb || -100 
        });
    }
    
    if (isFeedback) {
        const freqInt = Math.round(peakHz);
        if (feedbackAlert) {
            feedbackAlert.className = 'alert danger';
            feedbackAlert.innerHTML = `⚠️ <strong>Microfonia DETECTADA</strong> em <strong>${freqInt} Hz</strong> sustentados. Diferença local: ${formatDb(peakDb - neighborAvg)} dB.`;
        }

        if (isAutoCutEnabled && autoCutCooldown === 0) {
            // Usa a frequência exata do feedback (não arredonda) para notch preciso
            const exactFreq = Math.round(peakHz);
            const bandId = Math.round(exactFreq / 10) * 10;
            const currentCut = autoCutHistory[bandId] || 0;
            
            // Limita o corte máximo para -12dB na mesma banda
            if (currentCut > -12) {
                const newCut = currentCut - 3;
                autoCutHistory[bandId] = newCut;
                autoCutCooldown = 60; // 1 segundo de cooldown a 60fps para o áudio reagir
                
                // Aplica Notch Filter (Q=30 bem estreito)
                if (window.MixerService) {
                    if (typeof MixerService.applyNotchFilter === 'function') {
                        // Preferir Notch Filter para feedback
                        MixerService.applyNotchFilter('master', exactFreq, -3);
                        console.log(`[AutoCut] Notch Filter aplicado em ${exactFreq}Hz (Total: ${newCut}dB)`);
                    } else if (typeof MixerService.applyEQ === 'function') {
                        // Fallback para EQ paramétrico
                        MixerService.applyEQ('master', exactFreq, 30, -3);
                        console.log(`[AutoCut] EQ aplicado em ${exactFreq}Hz (Q=30, -3dB)`);
                    } else {
                        // Fallback final
                        MixerService.cutFeedback(exactFreq);
                    }
                }

                if (btnAutoCut) {
                    btnAutoCut.style.display = 'block';
                    btnAutoCut.innerText = `🔇 Notch: ${freqInt}Hz (-3dB)`;
                    btnAutoCut.classList.add('bg-orange-600');
                    setTimeout(() => { btnAutoCut.classList.remove('bg-orange-600'); }, 1000);
                }
            } else {
                if (btnAutoCut) {
                    btnAutoCut.style.display = 'block';
                    btnAutoCut.innerText = `⚠️ Limite atingido em ${bandId}Hz`;
                }
            }
        } else if (!isAutoCutEnabled) {
            if (btnAutoCut) {
                btnAutoCut.style.display = 'block';
                btnAutoCut.onclick = () => {
                    if (window.MixerService && typeof MixerService.cutFeedback === 'function') {
                        MixerService.cutFeedback(freqInt);
                    }
                    btnAutoCut.innerText = 'Cortando...';
                };
            }
        }
    } else {
        if (feedbackAlert) {
            feedbackAlert.className = 'alert safe';
            feedbackAlert.innerHTML = `Espectro estável. Pico dominante: ${Math.round(peakHz)} Hz (${formatDb(peakDb)} dB).`;
        }
        if (btnAutoCut && !isAutoCutEnabled) {
            btnAutoCut.style.display = 'none';
            btnAutoCut.innerText = '🪄 Cortar Frequência na Mesa';
        }
    }
    } catch (err) {
        console.error('[Analyzer] analyze() error:', err);
        if (isAnalyzing) {
            animationId = requestAnimationFrame(analyze);
        }
    }
}

async function sendAnalysisToAI() {
    if (!lastAnalysis) {
        alert('Nenhuma análise disponível. Ative o microfone e aguarde alguns segundos.');
        return;
    }

    const channelInput = document.getElementById('ai-target-channel');
    const channel = channelInput ? Number(channelInput.value) : 1;
    
    const aiBox = document.getElementById('ai-suggestions-box');
    const aiText = document.getElementById('ai-suggestions-text');
    
    if (aiBox) aiBox.classList.remove('hidden');
    if (aiText) aiText.innerText = 'Processando dados com IA...';

    const rt60Payload = buildRt60Payload(lastRt60Result);
    const acousticSnapshot = {
        schema_version: '1.1',
        name: `Análise Automática - Canal ${channel}`,
        type: 'acoustic_measurement',
        summary: lastAnalysis.text,
        measurementType: pinkMeasurementActive ? 'pink-noise' : 'live-analysis',
        peakHz: lastAnalysis.details.peakHz,
        peakDb: Number(lastAnalysis.details.peakDb),
        rms: Number(lastAnalysis.details.rmsDb),
        spl: Number(lastAnalysis.details.peakDb),
        rt60: Number(lastRt60) || 0,
        rt60_multiband: rt60Payload,
        spectrum_db: lastAnalysis.details.spectrum_v11 || {},
        bands: lastAnalysis.details.bands,
        position: getCurrentMeasurementPosition(),
        crowdStatus: document.getElementById('crowd-status')?.value || 'empty',
        timestamp: new Date().toISOString()
    };

    // Comentário intencional: o backend normaliza esse contrato para manter histórico e heatmap alinhados.
    SocketService.emit('save_acoustic_snapshot', acousticSnapshot);

    const payload = {
        schema_version: '1.1',
        summary: lastAnalysis.text,
        spectrum_db: lastAnalysis.details.spectrum_v11 || {},
        rt60_multiband: rt60Payload,
        bands: lastAnalysis.details.bands,
        peakHz: lastAnalysis.details.peakHz,
        peakDb: lastAnalysis.details.peakDb,
        rms: lastAnalysis.details.rmsDb,
        isPinkNoise: pinkMeasurementActive
    };

    try {
        const result = await AIService.ask('Análise acústica do ambiente', channel, payload);
        if (aiText) aiText.innerText = result.text || result.answer;
        
        const actionsArea = document.getElementById('ai-actions');
        if (actionsArea && result.command) {
            actionsArea.innerHTML = '';
            const button = document.createElement('button');
            button.className = 'px-3 py-1.5 bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 rounded-lg text-[10px] font-bold uppercase hover:bg-cyan-500 hover:text-white transition-all';
            button.innerText = 'Executar Correção Sugerida';
            button.addEventListener('click', () => MixerService.executeAICommand(result.command));
            actionsArea.appendChild(button);
        }
    } catch (err) {
        if (aiText) aiText.innerText = 'Erro ao consultar a IA. Verifique sua conexão.';
        console.error('[Analyzer] AI Error:', err);
    }
}

window.SoundMasterAnalyzer = {
    getLastAnalysis: function () { return lastAnalysis; },
    getPinkReport: function () { return pinkReport; },
    hasAnalysis: function () { return !!lastAnalysis; },
    triggerImpulse: function () { triggerImpulseMeasure(); },
    toggle: function () { toggleAnalyzer(); }
};

function toggleAnalyzer() {
    console.log('[Analyzer] toggleAnalyzer() chamado. isAnalyzing=', isAnalyzing);
    if (isAnalyzing) {
        stopAnalyzer();
    } else {
        startAnalyzer();
    }
}

// --- Geradores de Sinais de Áudio Avançados ---

function startLogarithmicSweep() {
    // Delega para o pipeline completo com deconvolução
    triggerImpulseMeasure();
}

/**
 * RT60: Dispara Log-Sine Sweep e processa via backend Python
 */
async function triggerImpulseMeasure() {
    console.log('[RT60] Iniciando medição via Log-Sine Sweep...');
    ensureAudioCtx();

    if (!isAnalyzing) {
        console.log('[RT60] Microfone desligado. Ativando automaticamente...');
        await startAnalyzer();
        await new Promise(r => setTimeout(r, 1000));
    }

    await startSweepMeasurement();
}

async function startSweepMeasurement() {
    if (isSweepActive) return;
    ensureAudioCtx();

    isSweepActive = true;
    sweepCaptureActive = true;

    const summaryEl = document.getElementById('pink-measure-summary');
    if (summaryEl) summaryEl.innerText = 'Iniciando Log-Sine Sweep...';

    try {
        await audioCtx.audioWorklet.addModule('js/core/log-sweep-processor.js');
    } catch (e) {
        console.warn('[Sweep] Worklet indisponível, usando fallback.', e);
        await startSweepMeasurementFallback();
        return;
    }

    // Worklet com microfone como input[0] (captura simultânea à reprodução)
    sweepNode = new AudioWorkletNode(audioCtx, 'log-sweep-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1]
    });

    // Conecta microfone como entrada do worklet para captura sincronizada
    if (source) source.connect(sweepNode);
    // Reproduz o sweep para os alto-falantes
    sweepNode.connect(audioCtx.destination);

    sweepNode.port.onmessage = (e) => {
        const msg = e.data;

        if (msg.type === 'sweep-ready') {
            const dur = msg.duration;
            console.log(`[Sweep] Pronto: ${dur}s, ${msg.f0}Hz → ${msg.f1}Hz, ${msg.totalSamples} samples`);
            if (summaryEl) summaryEl.innerText = `🎵 Log-Sine Sweep em progresso (${dur}s)...`;
        }

        if (msg.type === 'progress') {
            if (summaryEl) summaryEl.innerText = `🎵 Sweep: ${msg.pct}%...`;
        }

        if (msg.type === 'sweep-done') {
            // O worklet entrega tanto a gravação quanto a referência
            _onSweepWorkletDone(msg.recording, msg.reference, msg.sampleRate);
        }

        if (msg.type === 'sweep-cancelled') {
            isSweepActive = false;
            sweepCaptureActive = false;
            if (summaryEl) summaryEl.innerText = 'Sweep cancelado.';
        }
    };

    const sweepParams = {
        f0: 20, f1: 20000, duration: 10,
        amplitude: 0.85, silencePre: 0.5, silencePost: 2.0,
        fadeInMs: 20, fadeOutMs: 100
    };

    sweepNode.port.postMessage({ type: 'start', params: sweepParams });

    // Timeout de segurança: 20s (silencePre + duration + silencePost + margem)
    const safetyMs = (sweepParams.silencePre + sweepParams.duration + sweepParams.silencePost + 5) * 1000;
    setTimeout(() => {
        if (isSweepActive && sweepNode) {
            sweepNode.port.postMessage({ type: 'stop' });
        }
    }, safetyMs);
}

async function startSweepMeasurementFallback() {
    const sampleRate = audioCtx.sampleRate;
    const sweepDuration = 8;
    const captureDuration = sweepDuration + 6;

    sweepRecordingBuffer = new Float32Array(sampleRate * captureDuration);
    sweepRecordingIdx = 0;
    sweepCaptureActive = true;
    isSweepActive = true;

    const bufferSize = Math.ceil(sampleRate * sweepDuration);
    const sweepBuffer = audioCtx.createBuffer(1, bufferSize, sampleRate);
    const data = sweepBuffer.getChannelData(0);

    const f0 = 20, f1 = 20000;
    const lnF0 = Math.log(f0), lnF1 = Math.log(f1);
    let phase = 0;

    for (let i = 0; i < bufferSize; i++) {
        const t = i / sampleRate;
        const instFreq = f0 * Math.exp(((lnF1 - lnF0) / sweepDuration) * t);
        phase += 2 * Math.PI * instFreq / sampleRate;
        data[i] = Math.sin(phase) * 0.8;
    }

    await audioCtx.audioWorklet.addModule('js/core/capture-processor.js');
    const captureNode = new AudioWorkletNode(audioCtx, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
    });
    captureNode.port.onmessage = (ev) => {
        if (!sweepCaptureActive || !ev.data || ev.data.type !== 'pcm') return;
        const inputData = ev.data.samples;
        for (let i = 0; i < inputData.length; i++) {
            if (sweepRecordingIdx < sweepRecordingBuffer.length) {
                sweepRecordingBuffer[sweepRecordingIdx++] = inputData[i];
            }
        }
    };

    source.connect(captureNode);
    const captureSilent = audioCtx.createGain();
    captureSilent.gain.value = 0;
    captureNode.connect(captureSilent);
    captureSilent.connect(audioCtx.destination);

    const sweepSource = audioCtx.createBufferSource();
    sweepSource.buffer = sweepBuffer;
    sweepSource.connect(audioCtx.destination);

    sweepSource.start();

    setTimeout(() => finishSweepMeasurement(), (sweepDuration + 5) * 1000);
    setTimeout(() => {
        sweepSource.stop();
        captureNode.port.postMessage({ type: 'set-active', value: false });
        captureNode.disconnect();
        captureSilent.disconnect();
    }, sweepDuration * 1000);
}

/**
 * Callback do worklet: recebe recording + reference via zero-copy.
 * Processa localmente via acoustic.worker.js e envia ao backend Python se disponível.
 */
function _onSweepWorkletDone(recording, reference, sampleRate) {
    isSweepActive = false;
    sweepCaptureActive = false;

    // Cleanup do grafo de áudio
    if (sweepNode) {
        try { sweepNode.disconnect(); } catch (_) {}
        sweepNode = null;
    }

    const summaryEl = document.getElementById('pink-measure-summary');
    if (summaryEl) summaryEl.innerText = '⚙️ Deconvoluindo IR...';

    console.log(`[Sweep] Done: rec=${recording.length} ref=${reference.length} fs=${sampleRate}`);

    // 1. Processamento local (Worker JS — sem dependência de backend)
    if (acousticWorker) {
        acousticWorker.postMessage(
            { type: 'deconvolve-sweep', data: { recording, reference, sampleRate } },
            [recording.buffer, reference.buffer]
        );
    }

    // 2. Processamento avançado no backend Python (STI + multibanda)
    SocketService.emit('analyze_sweep_ir', {
        recording: Array.from(recording),
        reference: Array.from(reference),
        sampleRate,
        sweepParams: { f0: 20, f1: 20000, duration: 10, amplitude: 0.85 }
    });
}

/** Fallback de finalização (não usado com o novo worklet, mantido para compatibilidade) */
async function finishSweepMeasurement() {
    if (!isSweepActive) return;
    isSweepActive = false;
    sweepCaptureActive = false;
    if (sweepNode) {
        try { sweepNode.port.postMessage({ type: 'stop' }); } catch (_) {}
    }
}

function _handleSweepAnalysisResult(result) {
    console.log('[SweepAnalysis Result]', result);

    if (result.error) {
        const summaryEl = document.getElementById('pink-measure-summary');
        if (summaryEl) summaryEl.innerHTML = `<span class="text-red-400">Erro: ${result.error}</span>`;
        if (audioWorkletNode) {
            triggerImpulseMeasure._fallback = true;
        }
        return;
    }

    lastRt60Result = result;
    lastRt60 = result.t30 || result.t20 || 0;

    const summaryEl = document.getElementById('pink-measure-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="space-y-2">
                <div><span class="text-cyan-300 font-bold">EDT:</span> ${result.edt}s | <span class="text-cyan-300">T20:</span> ${result.t20}s | <span class="text-cyan-300">T30:</span> ${result.t30}s</div>
                <div><span class="text-amber-300 font-bold">STI:</span> ${result.sti} (${result.sti_category}) | <span class="text-amber-300">C50:</span> ${result.c50}dB | <span class="text-amber-300">C80:</span> ${result.c80}dB</div>
                <div><span class="text-slate-400 text-[10px]">SNR: ${result.snr_db}dB | Qual.: ${result.quality_flags ? result.quality_flags.join(', ') : 'OK'}</span></div>
            </div>
        `;
    }

    const rt60El = document.getElementById('rt60-result');
    if (rt60El) {
        rt60El.classList.remove('hidden');
        rt60El.innerHTML = `
            <div class="bg-cyan-900/40 border border-cyan-500/30 p-6 rounded-2xl shadow-xl">
                <h4 class="text-xs font-black uppercase text-cyan-400 tracking-widest mb-4">Métricas Acústicas (IR Real)</h4>
                <div class="grid grid-cols-3 gap-4 mb-4">
                    <div><span class="text-[10px] text-slate-400">EDT</span><br><span class="text-2xl font-black text-white">${result.edt}s</span></div>
                    <div><span class="text-[10px] text-slate-400">T20</span><br><span class="text-2xl font-black text-cyan-300">${result.t20}s</span></div>
                    <div><span class="text-[10px] text-slate-400">T30</span><br><span class="text-2xl font-black text-cyan-300">${result.t30}s</span></div>
                </div>
                <div class="grid grid-cols-3 gap-4 mb-4">
                    <div><span class="text-[10px] text-slate-400">STI (Fala)</span><br><span class="text-2xl font-black ${result.sti >= 0.6 ? 'text-green-400' : result.sti >= 0.45 ? 'text-amber-400' : 'text-red-400'}">${result.sti}</span></div>
                    <div><span class="text-[10px] text-slate-400">C50 (Voz)</span><br><span class="text-2xl font-black ${result.c50 >= 0 ? 'text-green-400' : 'text-amber-400'}">${result.c50}</span><span class="text-xs text-slate-400">dB</span></div>
                    <div><span class="text-[10px] text-slate-400">C80 (Música)</span><br><span class="text-2xl font-black ${result.c80 >= 0 ? 'text-green-400' : 'text-amber-400'}">${result.c80}</span><span class="text-xs text-slate-400">dB</span></div>
                </div>
                <div class="flex items-baseline gap-2">
                    <span class="text-[10px] text-cyan-100/60">SNR: ${result.snr_db} dB | Cat: ${result.sti_category} | ${result.quality_flags ? result.quality_flags.join(' | ') : 'OK'}</span>
                </div>
            </div>
        `;
    }

    // Dispara o evento para renderizar a Curva de Schroeder no canvas
    document.dispatchEvent(new CustomEvent('rt60-result', {
        detail: {
            curve: result.schroeder_curve || [],
            rt60:  result.t30 || result.t20 || result.rt60_est,
            t20:   result.t20,
            t30:   result.t30,
            edt:   result.edt,
            snr:   result.snr_db,
            c50:   result.c50,
            c80:   result.c80,
            d50:   result.d50,
            sti:   result.sti,
            sti_category: result.sti_category,
        }
    }));
}

function _handleRT60Result(result) {
    console.log('[RT60 Result]', result);
    lastRt60Result = result; // ✅ Guarda para o payload da IA
    lastRt60 = result.rt60 || 0;
    lastRt60Multiband = result.multiband || {};
    const resultEl = document.getElementById('rt60-result');
    if (resultEl) {
        resultEl.classList.remove('hidden');
        resultEl.innerHTML = `
            <div class="bg-cyan-900/40 border border-cyan-500/30 p-6 rounded-2xl shadow-xl">
                <h4 class="text-xs font-black uppercase text-cyan-400 tracking-widest mb-4">Resultado RT60 (Schroeder)</h4>
                <div class="flex items-baseline gap-2">
                    <span class="text-5xl font-black text-white">${result.rt60}</span>
                    <span class="text-xl font-bold text-cyan-300">segundos</span>
                </div>
                <div class="mt-2 flex flex-col gap-1">
                    <p class="text-[10px] text-cyan-100/60">SNR: ${result.snr} dB</p>
                    ${result.warning ? `<p class="text-[10px] text-amber-400 font-bold">⚠️ ${result.warning}</p>` : ''}
                </div>
            </div>
        `;
    }

    // ✅ Dispara evento para renderizar gráfico de Schroeder na página RT60
    document.dispatchEvent(new CustomEvent('rt60-result', {
        detail: {
            curve: result.curve || [],
            rt60:  result.rt60,
            t20:   result.t20,
            t30:   result.t30,
            edt:   result.edt,
            snr:   result.snr,
            c50:   result.c50,
            c80:   result.c80,
            d50:   result.d50,
            sti:   result.sti,
            sti_category: result.sti_category,
        }
    }));
}
// Variáveis do gerador de sinais e ruído rosa declaradas no topo do IIFE (~linha 66).
// (Duplicatas removidas para evitar SyntaxError de 'let' redeclarado no mesmo escopo.)

// Helper to ensure AudioContext
function ensureAudioCtx() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

    // --- Exportação da API Pública ---
function getFreqDataSnapshot() {
    if (!freqData || !analyser || !audioCtx) return null;
    return {
        data: new Float32Array(freqData),
        sampleRate: audioCtx.sampleRate,
        fftSize: analyser.fftSize,
    };
}

window.SoundMasterAnalyzer = {
        init: initAnalyzer,
        start: startAnalyzer,
        stop: stopAnalyzer,
        toggle: toggleAnalyzer,
        triggerImpulse: triggerImpulseMeasure,
        hasAnalysis: () => lastAnalysis !== null,
        getFeedbackDetector: () => feedbackDetector,
        isAnalyzing: () => isAnalyzing,
        getLastAnalysis: () => lastAnalysis,
        getFreqData: getFreqDataSnapshot,
        getLastRt60: () => lastRt60Result,
        setMeasurementPosition: (position) => { lastMeasurementPosition = position; },
        getMeasurementPosition: () => lastMeasurementPosition,
        setWeighting: (type) => {
            if (['A', 'C', 'Z'].includes(type)) {
                currentWeighting = type;
                console.log(`[Analyzer] SPL Weighting changed to dB(${type})`);
            }
        },
        // Novos Geradores de Sinais (Bloco 5.1)
        startPinkNoise: () => startPinkNoise(false),
        stopPinkNoise: stopPinkNoise,
        startWhiteNoise: (amp) => startWhiteNoise(amp),
        stopWhiteNoise: stopWhiteNoise,
        startMLS: (order, amp) => startMLS(order, amp),
        stopMLS: stopMLS,
        startChirp: (start, end, dur, amp) => startChirp(start, end, dur, amp),
        stopChirp: stopChirp,
        startDualTone: (f1, f2, amp) => startDualTone(f1, f2, amp),
        stopDualTone: stopDualTone,
        stopAllSignals: stopAllSignals,
        isPlayingAnySignal: () => isPinkNoisePlaying || isWhiteNoisePlaying || isMLSPlaying || isChirpPlaying || isDualTonePlaying || isSineWavePlaying
    };

    // ✅ Listener Único para Áudio de Referência (Loopback)
    // Previne que múltiplas instâncias do analisador criem listeners redundantes
    SocketService.on('reference_audio_stream', (data) => {
        if (!data || !data.samples) return;
        refAudioQueue.push(...data.samples);
        if (refAudioQueue.length > 48000) {
            refAudioQueue.splice(0, refAudioQueue.length - 48000);
        }
    });

    SocketService.on('sweep_analysis_result', (result) => {
        _handleSweepAnalysisResult(result);
    });

    // ✅ Delegação de Eventos Global para Botões da Transfer Function (mais robusto para SPA)
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !btn.id) return;

        if (btn.id === 'btn-capture-tf') {
            console.log('[Analyzer] Capturando trace...');
            if (latestTFData && window.SoundMasterVisualizer) {
                window.SoundMasterVisualizer.captureCurrentTrace(
                    latestTFData.magnitude, 
                    latestTFData.phase, 
                    latestTFData.coherence,
                    { sampleRate: latestTFData.sampleRate || audioCtx?.sampleRate || 48000 }
                );
            }
        } else if (btn.id === 'btn-clear-tf-traces') {
            if (window.SoundMasterVisualizer) window.SoundMasterVisualizer.clearTraces();
        } else if (btn.id === 'btn-demo-tf') {
            isDemoMode = !isDemoMode;
            btn.classList.toggle('bg-amber-500/20', isDemoMode);
            btn.classList.toggle('text-amber-300', isDemoMode);
            console.log(`[Analyzer] Modo Demo: ${isDemoMode ? 'ON' : 'OFF'}`);
            
            if (transferFunctionNode) {
                transferFunctionNode.port.postMessage({ type: 'set-demo-mode', value: isDemoMode });
            }
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target?.id !== 'tf-avg-select') return;
        const seconds = Number(e.target.value);
        if (transferFunctionNode && Number.isFinite(seconds)) {
            transferFunctionNode.port.postMessage({ type: 'set-avg', seconds });
            console.log(`[Analyzer] TF averaging: ${seconds}s`);
        }
    });

    // Se o script for carregado e a página já for a de analyzer, inicializa
    if (document.getElementById('fft-canvas')) {
        initAnalyzer();
    }

    return {
    isAnalyzing: () => isAnalyzing,
    getFrequencyData: () => lastAnalysis ? [...lastAnalysis.fftData] : [],
    getRt60: () => lastRt60Result,
    startSweep: triggerImpulseMeasure,
    getTransferFunctionData: () => latestTFData,
    reset: () => {
        stopAnalyzer();
        isDemoMode = false;
        if (window.SoundMasterVisualizer) window.SoundMasterVisualizer.clearTraces();
    }
};


})();
