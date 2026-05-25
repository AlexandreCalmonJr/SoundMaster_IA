/**
 * SoundMaster — Analisador de Áudio em Tempo Real (Web Audio API)
 * Encapsulado em IIFE para evitar poluição do escopo global.
 *
 * NOTA TÉCNICA: processamento customizado usa AudioWorklet.
 * ScriptProcessorNode foi removido dos caminhos ativos por ser deprecated.
 */
(function () {
    'use strict';

    let audioCtx;
    let analyser;
    let analyserFast; // Analisador rápido para detecção técnica
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
    let lastRt60Result = null; // Guarda o último RT60 medido para a IA
    let lastRt60 = 0;
    let lastRt60Multiband = {};
    let lastMeasurementPosition = null;

    // Arrays globais para evitar GC pressure no loop 60fps
    let freqData = null;
    let timeData = null;
    let bufferLength = 0;

    // Refs de elementos do DOM
    let canvas, canvasCtx, rmsBar, feedbackAlert, analysisSummaryText, analysisDetailList, btnSendAnalysis, btnMeasurePink, pinkMeasureSummary, micSelect;
    let waterfallCanvasEl, waterfallCtx;

    let rtaCrosshairX = -1;
    let rtaCrosshairY = -1;

    // Web Workers & Worklets

    let audioWorkletNode = null;
    let transferFunctionNode = null; // Nó de Função de Transferência
    let refSource = null; // Fonte de Referência (Loopback)
    let latestTFData = null; // Cache para snapshot
    let isDemoMode = false; // Estado de simulação digital
    let refAudioQueue = []; // Fila global de áudio de referência (singleton)
    let sweepNode = null; // Nó Log-Sine Sweep
    let sweepRecordingBuffer = null;
    let sweepRecordingIdx = 0;
    let sweepCaptureActive = false;
    let isSweepActive = false;

    function handleTfButtonClick(e) {
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
    }

    function handleTfChange(e) {
        if (e.target?.id !== 'tf-avg-select') return;
        const seconds = Number(e.target.value);
        if (transferFunctionNode && Number.isFinite(seconds)) {
            transferFunctionNode.port.postMessage({ type: 'set-avg', seconds });
            console.log(`[Analyzer] TF averaging: ${seconds}s`);
        }
    }

    // Iframe shell
    let _analyzerIframe = null;

    const WATERFALL_DEPTH = 100;
    let peakHold = { hz: 0, db: -100, timer: 0 };

    /**
     * Busca elemento pelo ID, tentando no iframe (página analyzer) e depois no parent.
     */
    function _el(id) {
        if (_analyzerIframe && _analyzerIframe.contentDocument) {
            const el = _analyzerIframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    // --- Ponderações acústicas (IEC 61672:2003) ---
    function getAWeighting(freq) {
        if (freq < 1) return -100;
        const f2 = freq * freq;
        const f4 = f2 * f2;
        const rA = (Math.pow(12194, 2) * f4) /
            ((f2 + Math.pow(20.6, 2)) * Math.sqrt((f2 + Math.pow(107.7, 2)) * (f2 + Math.pow(737.9, 2))) * (f2 + Math.pow(12194, 2)));
        return 20 * Math.log10(rA) + 2.00;
    }

    function getCWeighting(freq) {
        if (freq < 1) return -100;
        const f2 = freq * freq;
        const rC = (Math.pow(12194, 2) * f2) /
            ((f2 + Math.pow(20.6, 2)) * (f2 + Math.pow(12194, 2)));
        return 20 * Math.log10(rC) + 0.06;
    }

    function calculateAcousticMetrics(timeData, freqData, sampleRate) {
        let sumSqWeighted = 0;
        let peak = 0;
        const hzPerBin = sampleRate / (freqData.length * 2);
        const currentWeighting = window.SplDisplayModule ? window.SplDisplayModule.getWeighting() : 'A';

        for (let i = 0; i < freqData.length; i++) {
            const freq = i * hzPerBin;
            const db = freqData[i];
            let weight = 0;
            if (currentWeighting === 'A') {
                weight = getAWeighting(freq);
            } else if (currentWeighting === 'C') {
                weight = getCWeighting(freq);
            }
            const weightedDb = db + weight;
            sumSqWeighted += Math.pow(10, weightedDb / 10);
        }

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

    function formatDb(value) {
        return value.toFixed(1);
    }

    function formatBandLabel(hz) {
        if (hz >= 1000) return `${hz / 1000}kHz`;
        return `${hz}Hz`;
    }

    function getBandAverage(freqData, sampleRate, minHz, maxHz, fftSize) {
        let sum = 0;
        let count = 0;
        const hzPerBin = sampleRate / fftSize;

        for (let i = 0; i < freqData.length; i++) {
            const freq = i * hzPerBin;
            if (freq >= minHz && freq < maxHz) {
                const weight = 1.0 / Math.max(freq, 20);
                sum += freqData[i] * weight;
                count += weight;
            }
        }
        return count ? sum / count : -100;
    }

    function getPinkReference(freq, referenceDb) {
        const refHz = 250;
        if (freq <= 0) return referenceDb;
        const octaves = Math.log2(freq / refHz);
        return referenceDb - 3 * octaves;
    }

    function buildPinkNoiseReport(avgSpectrum, sampleRate) {
        const bands = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
        const refBin = Math.round(1000 * analyser.fftSize / sampleRate);
        const referenceDb = avgSpectrum[refBin] || -60;
        
        const report = [];
        const deviations = {};
        let lowSum = 0, midSum = 0, highSum = 0;
        let lowCount = 0, midCount = 0, highCount = 0;

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
        const minBin = Math.floor(20 * analyser.fftSize / audioCtx.sampleRate);
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
        return lastMeasurementPosition || null;
    }

    function startPinkNoiseMeasurement() {
        if (!audioCtx) {
            alert('Ative o microfone antes de iniciar a medição de ruído rosa.');
            return;
        }
        if (pinkMeasurementActive) return;
        if (window.SignalGeneratorController && !SignalGeneratorController.isPinkNoisePlaying()) {
            SignalGeneratorController.startPinkNoise(true);
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
        if (window.SignalGeneratorController && SignalGeneratorController.isPinkNoisePlaying()) {
            SignalGeneratorController.stopPinkNoise();
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

    function _initGlobalListeners() {
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

        // Delegação de Eventos Global para Botões da Transfer Function
        document.removeEventListener('click', handleTfButtonClick);
        document.addEventListener('click', handleTfButtonClick);

        document.removeEventListener('change', handleTfChange);
        document.addEventListener('change', handleTfChange);

        if (_analyzerIframe && _analyzerIframe.contentDocument) {
            _analyzerIframe.contentDocument.removeEventListener('click', handleTfButtonClick);
            _analyzerIframe.contentDocument.addEventListener('click', handleTfButtonClick);

            _analyzerIframe.contentDocument.removeEventListener('change', handleTfChange);
            _analyzerIframe.contentDocument.addEventListener('change', handleTfChange);
        }

        // Evento de page-unload para limpar referências locais de DOM
        window.addEventListener('page-unload', (e) => {
            if (e.detail && e.detail.pageId === 'analyzer') {
                console.log('[Analyzer] Desvinculando elementos do DOM (page-unload)...');
                canvas = null;
                canvasCtx = null;
                waterfallCanvasEl = null;
                waterfallCtx = null;
                rmsBar = null;
                feedbackAlert = null;
                analysisSummaryText = null;
                analysisDetailList = null;
                btnSendAnalysis = null;
                btnMeasurePink = null;
                pinkMeasureSummary = null;
                micSelect = null;
            }
        });
    }

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
            const el = _el(id);
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
            }
        } catch (err) {
            console.error('[Analyzer] Erro ao listar dispositivos:', err);
        }
    }

    function initAnalyzer() {
        console.log('[Analyzer] Vinculando elementos do DOM...');
        canvas = _el('fft-canvas');
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

        waterfallCanvasEl = _el('waterfall-canvas');
        if (waterfallCanvasEl) waterfallCtx = waterfallCanvasEl.getContext('2d');

        _resizeCanvases();
        window.addEventListener('resize', _resizeCanvases);

        // Inicializa serviços de controle modulares
        if (window.FeedbackDetectorModule) window.FeedbackDetectorModule.init();
        if (window.SplDisplayModule) window.SplDisplayModule.init();
        if (window.AutomixController) window.AutomixController.init();

        // Inicializa Visualizador de Transfer Function
        if (window.SoundMasterVisualizer) window.SoundMasterVisualizer.init();
        
        rmsBar = _el('rms-bar');
        feedbackAlert = _el('feedback-alert');
        analysisSummaryText = _el('acoustic-summary');
        analysisDetailList = _el('acoustic-detail-list');
        btnSendAnalysis = _el('btn-send-analysis');
        btnMeasurePink = _el('btn-measure-pink');
        pinkMeasureSummary = _el('pink-measure-summary');
        micSelect = _el('mic-select');

        // Binds
        btnSendAnalysis?.addEventListener('click', sendAnalysisToAI);
        btnMeasurePink?.addEventListener('click', startPinkNoiseMeasurement);

        // Popula lista de microfones
        _populateDeviceList();
    }

    function initGlobalAnalyzer() {
        console.log('[Analyzer] Inicializando serviços globais de áudio...');
        _initGlobalListeners();

        // Global Mic Toggle Header
        const btnMic = _el('btn-toggle-mic');
        if (btnMic) {
            btnMic.removeEventListener('click', toggleAnalyzer);
            btnMic.addEventListener('click', toggleAnalyzer);
        }


        document.addEventListener('click', () => {
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        }, { once: false });
    }

    async function startAnalyzer() {
        try {
            console.log('[Analyzer] startAnalyzer()');
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
                throw new Error('O navegador não suporta captura de áudio ou você está em uma conexão não segura (HTTP).');
            }

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            silentFrameCount = 0;
            await _populateDeviceList();
            
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
            if (audioCtx.state !== 'running') {
                throw new Error('AudioContext não pôde ser iniciado.');
            }
            
            try {
                await audioCtx.audioWorklet.addModule(`js/core/audio-processor.js?t=${Date.now()}`);
                await audioCtx.audioWorklet.addModule(`js/core/transfer-function-processor.js?t=${Date.now()}`);
                
                audioWorkletNode = new AudioWorkletNode(audioCtx, 'soundmaster-processor');
                
                transferFunctionNode = new AudioWorkletNode(audioCtx, 'transfer-function-processor', {
                    numberOfInputs: 2,
                    numberOfOutputs: 1
                });
                const avgSelect = _el('tf-avg-select');
                transferFunctionNode.port.postMessage({
                    type: 'set-avg',
                    seconds: avgSelect ? Number(avgSelect.value) : 2
                });
                transferFunctionNode.port.postMessage({
                    type: 'set-demo-mode',
                    value: isDemoMode
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
            analyser.fftSize = 32768; 
            analyser.smoothingTimeConstant = 0.8;
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
            source.connect(analyser);

            const analyserGain = audioCtx.createGain();
            analyserGain.gain.value = 0;
            analyser.connect(analyserGain);
            analyserGain.connect(audioCtx.destination);

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

            if (transferFunctionNode) {
                source.connect(transferFunctionNode, 0, 1);
                _setupReferenceSource(audioCtx, transferFunctionNode);
                
                const tfSilentGain = audioCtx.createGain();
                tfSilentGain.gain.value = 0;
                transferFunctionNode.connect(tfSilentGain);
                tfSilentGain.connect(audioCtx.destination);
            }

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

            if (window.SplLogger) {
                SplLogger.init(audioCtx.sampleRate);
                SplLogger.start();
            }

            if (window.MtwManager) {
                MtwManager.start(audioCtx, source).then(() => {
                    MtwManager.onSpectrum((spectrum) => {
                        AppStore.setState({ mtwSpectrum: spectrum });
                    });
                });
            }

            isAnalyzing = true;
            
            const dot = _el('mic-status-dot');
            const text = _el('mic-status-text');
            if (dot) dot.classList.add('online');
            if (text) text.innerText = 'Mic Online';
            
            _resizeCanvases();
            analyze();
        } catch (err) {
            console.error("Erro ao acessar microfone:", err);
            alert(`Erro ao acessar o microfone: ${err.message}`);
        }
    }

    async function stopAnalyzer() {
        console.log('[Analyzer] Parando analisador...');
        isAnalyzing = false;
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }

        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
        }

        if (audioCtx) {
            if (audioCtx.state !== 'closed') {
                try {
                    await audioCtx.close();
                } catch (e) {
                    console.warn('[Analyzer] Erro ao fechar AudioContext:', e);
                }
            }
            audioCtx = null;
        }

        if (monitorGain) {
            try { monitorGain.disconnect(); } catch (_) {}
            monitorGain = null;
        }

        analyser = null;
        analyserFast = null;
        source = null;
        audioWorkletNode = null;

        if (window._refSourceFeedTimer) {
            clearInterval(window._refSourceFeedTimer);
            window._refSourceFeedTimer = null;
        }

        if (window.SplLogger) SplLogger.stop();
        if (window.MtwManager) MtwManager.stop();

        if (canvasCtx && canvas) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        
        const dot = _el('mic-status-dot');
        const text = _el('mic-status-text');
        if (dot) dot.classList.remove('online');
        if (text) text.innerText = 'Mic Offline';
    }

    async function _setupReferenceSource(ctx, targetNode) {
        try {
            await ctx.audioWorklet.addModule(`js/core/reference-source-processor.js?t=${Date.now()}`);
            refSource = new AudioWorkletNode(ctx, 'reference-source-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [1]
            });

            const _feedWorklet = setInterval(() => {
                if (!refSource || refAudioQueue.length === 0) return;
                const chunk = refAudioQueue.splice(0, 4096);
                refSource.port.postMessage({ type: 'pcm', samples: new Float32Array(chunk) });
            }, 50);

            window._refSourceFeedTimer = _feedWorklet;
            console.log('[ReferenceSource] AudioWorklet inicializado.');
        } catch (err) {
            console.error('[ReferenceSource] Falha ao carregar AudioWorklet:', err.message);
            refSource = null;
            return;
        }

        if (!refSource) return;
        refSource.connect(targetNode, 0, 0);

        const silent = ctx.createGain();
        silent.gain.value = 0;
        refSource.connect(silent);
        silent.connect(ctx.destination);
    }

    function _handleTransferFunctionData(data) {
        latestTFData = data;
        const { magnitude, phase, coherence, delayMs, sampleRate } = data;
        
        const delayEl = _el('delay-finder-value');
        if (delayEl) {
            delayEl.innerText = `${delayMs.toFixed(2)} ms`;
            delayEl.style.color = delayMs > 100 ? '#facc15' : '#22d3ee';
        }

        const avgCoherence = coherence.reduce((a, b) => a + b, 0) / coherence.length;
        const coherenceEl = _el('coherence-value');
        if (coherenceEl) {
            coherenceEl.innerText = `${avgCoherence.toFixed(0)}%`;
            if (avgCoherence > 80) coherenceEl.style.color = '#4ade80';
            else if (avgCoherence > 50) coherenceEl.style.color = '#facc15';
            else coherenceEl.style.color = '#f87171';
        }

        if (window.SoundMasterVisualizer) {
            window.SoundMasterVisualizer.drawTransferFunction(magnitude, phase, coherence, {
                sampleRate: sampleRate || audioCtx?.sampleRate || 48000,
                avgSeconds: data.avgSeconds,
                avgFrames: data.avgFrames
            });
        }
    }

    function analyze() {
        if (!isAnalyzing) return;
        
        try {
            animationId = requestAnimationFrame(analyze);
            
            if (!freqData || freqData.length !== analyser.frequencyBinCount) {
                bufferLength = analyser.frequencyBinCount;
                freqData = new Float32Array(bufferLength);
                timeData = new Float32Array(analyser.fftSize);
            }
            
            analyser.getFloatFrequencyData(freqData);
            
            if (freqData.every(v => !isFinite(v))) {
                silentFrameCount += 1;
                if (silentFrameCount === 10) {
                    console.warn('[Analyzer] Nenhum dado de frequência recebido do microfone.');
                }
            } else {
                silentFrameCount = 0;
            }
            
            const fastBufferLength = analyserFast.frequencyBinCount;
            const fastFreqData = new Float32Array(fastBufferLength);
            analyserFast.getFloatFrequencyData(fastFreqData);

            if (window.AcousticCalibration) {
                window.AcousticCalibration.applyCalibration(freqData, audioCtx.sampleRate, analyser.fftSize);
            }
            
            analyser.getFloatTimeDomainData(timeData);

            if (window.SplLogger) {
                SplLogger.push(freqData, timeData, analyser.fftSize);
            }

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
                    acc.sum.fill(0);
                    acc.count = 0;
                }
            }

            let isClipping = false;
            for (let i = 0; i < timeData.length; i++) {
                if (Math.abs(timeData[i]) > 0.98) {
                    isClipping = true;
                    break;
                }
            }

            let peakDb = -Infinity;
            let peakIndex = 0;
            const minBin = Math.floor(20 * analyserFast.fftSize / audioCtx.sampleRate);
            for (let i = minBin; i < fastBufferLength; i++) {
                if (fastFreqData[i] > peakDb) {
                    peakDb = fastFreqData[i];
                    peakIndex = i;
                }
            }
            const currentFastPeakHz = peakIndex * audioCtx.sampleRate / analyserFast.fftSize;

            if (peakDb > peakHold.db) {
                peakHold.db = peakDb;
                peakHold.hz = currentFastPeakHz;
                peakHold.timer = 120;
            } else if (peakHold.timer > 0) {
                peakHold.timer--;
            } else {
                peakHold.db = -100;
            }

            // --- Renderização visual se o canvas estiver ativo ---
            if (canvas && canvasCtx) {
                const iecCenters = [
                    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 
                    500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 
                    6300, 8000, 10000, 12500, 16000, 20000
                ];
                
                canvasCtx.fillStyle = '#0f172a';
                canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
                
                const numBands = iecCenters.length;
                const spacing = 2;
                const barWidth = (canvas.width - (spacing * (numBands - 1))) / numBands;
                
                let x = 0;
                const halfStep = Math.pow(2, 1/6);
                
                for (let i = 0; i < numBands; i++) {
                    const fc = iecCenters[i];
                    const freqStart = fc / halfStep;
                    const freqEnd = fc * halfStep;

                    const binStart = Math.max(0, Math.floor(freqStart * analyser.fftSize / audioCtx.sampleRate));
                    const binEnd = Math.min(bufferLength, Math.ceil(freqEnd * analyser.fftSize / audioCtx.sampleRate));
                    
                    let maxDbInBin = -120;
                    if (binStart >= binEnd) {
                        const bin = Math.max(0, Math.round(fc * analyser.fftSize / audioCtx.sampleRate));
                        maxDbInBin = freqData[bin] || -120;
                    } else {
                        for (let j = binStart; j < binEnd; j++) {
                            if (freqData[j] > maxDbInBin) maxDbInBin = freqData[j];
                        }
                    }
                    
                    let fillStyle = '#64748b';
                    if (fc < 60) fillStyle = '#3b82f6';
                    else if (fc < 250) fillStyle = '#10b981';
                    else if (fc < 2000) fillStyle = '#f59e0b';
                    else if (fc < 6000) fillStyle = '#f97316';
                    else fillStyle = '#ef4444';

                    const normalized = Math.max(0, Math.min(1, (maxDbInBin - analyser.minDecibels) / (analyser.maxDecibels - analyser.minDecibels)));
                    const barHeight = normalized * canvas.height;

                    canvasCtx.fillStyle = fillStyle;
                    canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                    x += barWidth + spacing;
                }

                if (peakHold.timer > 0) {
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

                if (waterfallCtx && waterfallCanvasEl) {
                    const w = waterfallCanvasEl.width;
                    const h = waterfallCanvasEl.height;
                    const rowHeight = Math.max(1, h / WATERFALL_DEPTH);
                    const axisWidth = 34;
                    const plotW = Math.max(1, w - axisWidth);
                    
                    waterfallCtx.drawImage(waterfallCanvasEl, 0, 0, plotW, h - rowHeight, 0, rowHeight, plotW, h - rowHeight);
                    waterfallCtx.clearRect(0, 0, plotW, rowHeight);
                    
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
                        
                        let color;
                        if (normalized < 0.2) color = `rgb(0, 0, ${Math.floor(normalized * 255)})`;
                        else if (normalized < 0.5) color = `rgb(0, ${Math.floor((normalized-0.2)*255)}, 255)`;
                        else if (normalized < 0.8) color = `rgb(${Math.floor((normalized-0.5)*255)}, 255, 0)`;
                        else color = `rgb(255, ${Math.floor((1-normalized)*255)}, 0)`;
                        
                        waterfallCtx.fillStyle = color;
                        waterfallCtx.fillRect(i, 0, 1, rowHeight);
                    }
                    
                    _drawWaterfallTimeAxis(waterfallCtx, plotW, 0, axisWidth, h);

                    if (!window._lastWfSec) window._lastWfSec = 0;
                    const nowSec = Math.floor(Date.now() / 1000);
                    if (nowSec !== window._lastWfSec) {
                        window._lastWfSec = nowSec;
                        waterfallCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                        waterfallCtx.fillRect(0, 0, plotW, 1);
                    }
                }
            }

            if (window.SpatialAverager) {
                if (!SpatialAverager._primaryRegistered) {
                    SpatialAverager.addSource('primary', 'Mic Principal', '#ffffff');
                    SpatialAverager._primaryRegistered = true;
                }
                SpatialAverager.pushSource('primary', freqData);
                if (canvas && canvasCtx && SpatialAverager.getResult()?.meta?.n >= 2) {
                    SpatialAverager.drawOverlay(canvasCtx, canvas, analyser, audioCtx.sampleRate);
                }
            }

            const peakHz = peakIndex * audioCtx.sampleRate / analyser.fftSize;
            const neighborLeft = freqData[Math.max(0, peakIndex - 1)] || analyser.minDecibels;
            const neighborRight = freqData[Math.min(bufferLength - 1, peakIndex + 1)] || analyser.minDecibels;
            const neighborAvg = (neighborLeft + neighborRight) / 2;
            
            const metrics = calculateAcousticMetrics(timeData, freqData, audioCtx.sampleRate);
            const rmsDb = metrics.rmsDb;
            const crestFactor = metrics.crestFactor;
            
            window.currentGlobalRMS = Math.pow(10, rmsDb / 20); 

            // SPL Display and Leq logger delegation
            if (window.SplDisplayModule) {
                SplDisplayModule.pushLeq(rmsDb);
                SplDisplayModule.updateRmsBar(rmsDb, analyser.minDecibels, analyser.maxDecibels, isClipping);
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
            
            // Feedback detector delegation
            if (window.FeedbackDetectorModule) {
                FeedbackDetectorModule.update(currentFastPeakHz, peakDb, peakHz, neighborAvg, audioCtx.sampleRate);
            }

            if (isAnalyzing && peakDb > -15) {
                SocketService.emit('analyze_feedback_risk', { 
                    hz: Math.round(currentFastPeakHz), 
                    db: peakDb, 
                    prevDb: lastAnalysis?.details?.peakDb || -100 
                });
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

        const channelInput = _el('analyzer-ai-channel');
        const channel = channelInput ? Number(channelInput.value) : 1;
        
        const aiBox = _el('analyzer-ai-suggestions');
        const aiText = _el('analyzer-ai-suggestions-text');
        
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
            crowdStatus: _el('crowd-status')?.value || 'empty',
            timestamp: new Date().toISOString()
        };

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
            
            const actionsArea = _el('analyzer-ai-actions');
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

    function toggleAnalyzer() {
        console.log('[Analyzer] toggleAnalyzer()', isAnalyzing);
        if (isAnalyzing) {
            stopAnalyzer();
        } else {
            startAnalyzer();
        }
    }

    async function triggerImpulseMeasure() {
        console.log('[RT60] Iniciando medição via Log-Sine Sweep...');
        if (!audioCtx) {
            await startAnalyzer();
            await new Promise(r => setTimeout(r, 1000));
        } else if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        await startSweepMeasurement();
    }

    async function startSweepMeasurement() {
        if (isSweepActive) return;
        isSweepActive = true;
        sweepCaptureActive = true;

        const summaryEl = _el('pink-measure-summary');
        if (summaryEl) summaryEl.innerText = 'Iniciando Log-Sine Sweep...';

        try {
            await audioCtx.audioWorklet.addModule(`js/core/log-sweep-processor.js?t=${Date.now()}`);
        } catch (e) {
            console.warn('[Sweep] Worklet indisponível, usando fallback.', e);
            await startSweepMeasurementFallback();
            return;
        }

        sweepNode = new AudioWorkletNode(audioCtx, 'log-sweep-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1]
        });

        if (source) source.connect(sweepNode);
        sweepNode.connect(audioCtx.destination);

        sweepNode.port.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'sweep-ready') {
                if (summaryEl) summaryEl.innerText = `🎵 Log-Sine Sweep em progresso (${msg.duration}s)...`;
            }
            if (msg.type === 'progress') {
                if (summaryEl) summaryEl.innerText = `🎵 Sweep: ${msg.pct}%...`;
            }
            if (msg.type === 'sweep-done') {
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

        await audioCtx.audioWorklet.addModule(`js/core/capture-processor.js?t=${Date.now()}`);
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

    function _onSweepWorkletDone(recording, reference, sampleRate) {
        isSweepActive = false;
        sweepCaptureActive = false;

        if (sweepNode) {
            try { sweepNode.disconnect(); } catch (_) {}
            sweepNode = null;
        }

        const summaryEl = _el('pink-measure-summary');
        if (summaryEl) summaryEl.innerText = '⚙️ Deconvoluindo IR...';


        SocketService.emit('analyze_sweep_ir', {
            recording: Array.from(recording),
            reference: Array.from(reference),
            sampleRate,
            sweepParams: { f0: 20, f1: 20000, duration: 10, amplitude: 0.85 }
        });
    }

    async function finishSweepMeasurement() {
        if (!isSweepActive) return;
        isSweepActive = false;
        sweepCaptureActive = false;
        if (sweepNode) {
            try { sweepNode.port.postMessage({ type: 'stop' }); } catch (_) {}
        }
    }

    function _handleSweepAnalysisResult(result) {
        if (result.error) {
            const summaryEl = _el('pink-measure-summary');
            if (summaryEl) summaryEl.innerHTML = `<span class="text-red-400">Erro: ${result.error}</span>`;
            return;
        }

        lastRt60Result = result;
        lastRt60 = result.t30 || result.t20 || 0;

        const summaryEl = _el('pink-measure-summary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <div class="space-y-2">
                    <div><span class="text-cyan-300 font-bold">EDT:</span> ${result.edt}s | <span class="text-cyan-300">T20:</span> ${result.t20}s | <span class="text-cyan-300">T30:</span> ${result.t30}s</div>
                    <div><span class="text-amber-300 font-bold">STI:</span> ${result.sti} (${result.sti_category}) | <span class="text-amber-300">C50:</span> ${result.c50}dB | <span class="text-amber-300">C80:</span> ${result.c80}dB</div>
                    <div><span class="text-slate-400 text-[10px]">SNR: ${result.snr_db}dB</span></div>
                </div>
            `;
        }

        const rt60El = _el('rt60-result');
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
                        <span class="text-[10px] text-cyan-100/60">SNR: ${result.snr_db} dB | Cat: ${result.sti_category}</span>
                    </div>
                </div>
            `;
        }

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
        lastRt60Result = result;
        lastRt60 = result.rt60 || 0;
        lastRt60Multiband = result.multiband || {};
        const resultEl = _el('rt60-result');
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

    function getFreqDataSnapshot() {
        if (!freqData || !analyser || !audioCtx) return null;
        return {
            data: new Float32Array(freqData),
            sampleRate: audioCtx.sampleRate,
            fftSize: analyser.fftSize,
        };
    }

    // --- Exportação da API Pública ---
    window.SoundMasterAnalyzer = {
        init: initAnalyzer,
        start: startAnalyzer,
        stop: stopAnalyzer,
        toggle: toggleAnalyzer,
        triggerImpulse: triggerImpulseMeasure,
        hasAnalysis: () => lastAnalysis !== null,
        isAnalyzing: () => isAnalyzing,
        getLastAnalysis: () => lastAnalysis,
        getFreqData: getFreqDataSnapshot,
        getLastRt60: () => lastRt60Result,
        getAudioContext: () => audioCtx,
        startPinkNoiseMeasurement: startPinkNoiseMeasurement,
        finishPinkNoiseMeasurement: finishPinkNoiseMeasurement,
        stopPinkNoiseMeasurement: stopPinkNoiseMeasurement,
        setMeasurementPosition: (position) => { lastMeasurementPosition = position; },
        getMeasurementPosition: () => lastMeasurementPosition,
        setWeighting: (type) => {
            if (window.SplDisplayModule) {
                window.SplDisplayModule.setWeighting(type);
            }
        },
        setDecibelsRange: (min, max) => {
            if (analyser && analyserFast) {
                analyser.minDecibels = min;
                analyser.maxDecibels = max;
                analyserFast.minDecibels = min;
                analyserFast.maxDecibels = max;
            }
        }
    };

    // Expose sendAnalysisToAI globally for iframe pages
    window._sendAnalysisToAI = sendAnalysisToAI;

    // Auto-init
    (function autoInit() {
        function tryInit() {
            _analyzerIframe = document.getElementById('agent-workspace-iframe');
            if (_el('fft-canvas')) {
                initGlobalAnalyzer();
                initAnalyzer();
                return true;
            }
            return false;
        }

        if (tryInit()) return;

        document.addEventListener('page-loaded', (e) => {
            if (e.detail.pageId === 'analyzer') {
                setTimeout(tryInit, 100);
            }
        });

        document.addEventListener('iframe-loaded', (e) => {
            if (e.detail.pageId === 'analyzer') {
                setTimeout(tryInit, 100);
            }
        });
    })();

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
