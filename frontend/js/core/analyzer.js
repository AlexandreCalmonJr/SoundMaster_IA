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
    let _isStarting = false;
    let animationId;
    let _audioResumeHandler = null;
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
    let _fastFreqDataCache = null;
    let _aeqAcc = null;

    // Refs de elementos do DOM
    let canvas, canvasCtx, rmsBar, feedbackAlert, analysisSummaryText, analysisDetailList, btnSendAnalysis, btnMeasurePink, pinkMeasureSummary, micSelect;
    let waterfallCanvasEl, waterfallCtx;
    let specCanvas, specCtx;

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
    let _sweepSafetyTimer = null;
    let _sweepResultTimeout = null;

    // YAMNet live classification
    let _classifyBuffer = [];
    let _classifyFrameCount = 0;
    let _lastClassification = null;
    let _classifyCooldown = 0;
    let _feedbackCooldown = 0;
    let _autoInitDone = false;

    // Throttle: salta rendering pesado a cada N frames (melhor em mobile)
    let _frameCount = 0;
    let _frameSkip = 2;
    let _lastWfSec = 0;

    const _CLASS_ICON_MAP = [
        { match: /speech|voice|conversation|narration/i, icon: '🎤', label: 'Fala', detail: 'Voz/fala detectada' },
        { match: /music|song|instrument|guitar|piano|drum|bass/i, icon: '🎵', label: 'Música', detail: 'Conteúdo musical' },
        { match: /feedback|howl|squeal|oscillation/i, icon: '🚨', label: 'Microfonia', detail: 'Risco de feedback detectado!' },
        { match: /applause|clap/i, icon: '👏', label: 'Aplausos', detail: 'Aplausos da plateia' },
        { match: /laughter/i, icon: '😂', label: 'Risada', detail: 'Risada da plateia' },
        { match: /silence|quiet|still/i, icon: '🔇', label: 'Silêncio', detail: 'Ambiente silencioso' },
        { match: /noise|rumble|hum/i, icon: '💨', label: 'Ruído', detail: 'Ruído ambiente' },
        { match: /wind|breath/i, icon: '🌬️', label: 'Sopro', detail: 'Sopro ou ruído de boca' },
        { match: /telephone|ring|bell/i, icon: '🔔', label: 'Campainha', detail: 'Toque de telefone/sino' },
        { match: /vehicle|car|engine|traffic/i, icon: '🚗', label: 'Trânsito', detail: 'Ruído de veículo' },
        { match: /footstep|step|walk/i, icon: '👣', label: 'Passos', detail: 'Passos no palco' },
    ];

    const _CLASS_DEFAULT_ICON = '🔊';
    const _CLASS_DEFAULT_LABEL = 'Áudio';
    const _CLASS_DEFAULT_DETAIL = 'Som detectado';

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
        } else if (btn.id === 'btn-capture-all-tf') {
            console.log('[Analyzer] Capturando todos os traces...');
            if (latestTFData && window.SoundMasterVisualizer) {
                window.SoundMasterVisualizer.captureCurrentTrace(
                    latestTFData.magnitude,
                    latestTFData.phase,
                    latestTFData.coherence,
                    { sampleRate: latestTFData.sampleRate || audioCtx?.sampleRate || 48000 }
                );
                if (window.SoundMasterAnalyzer) {
                    const snap = window.SoundMasterAnalyzer.getFreqData();
                    if (snap && snap.data && snap.sampleRate) {
                        var dummyPhase = new Float32Array(snap.data.length);
                        var dummyCoh = new Float32Array(snap.data.length).fill(100);
                        window.SoundMasterVisualizer.captureCurrentTrace(
                            snap.data, dummyPhase, dummyCoh,
                            { sampleRate: snap.sampleRate }
                        );
                    }
                }
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
    let peakPerOctave = [];
    let peakOctaveTimer = 0;

    function updatePeakPerOctave(freqData, sampleRate, fftSize) {
        if (!freqData) return;
        const octaveCenters = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        const halfStep = Math.pow(2, 1 / 6);
        peakOctaveTimer = (peakOctaveTimer || 0) + 1;
        if (peakOctaveTimer % 10 !== 0) return; // update every 10 frames
        peakOctaveTimer = 0;
        const bufferLength = freqData.length;
        if (peakPerOctave.length === 0) {
            octaveCenters.forEach(function (fc) {
                peakPerOctave.push({ fc: fc, peakDb: -120, decay: 0 });
            });
        }
        peakPerOctave.forEach(function (band) {
            const fc = band.fc;
            const freqStart = fc / halfStep;
            const freqEnd = fc * halfStep;
            const binStart = Math.max(0, Math.floor(freqStart * fftSize / sampleRate));
            const binEnd = Math.min(bufferLength, Math.ceil(freqEnd * fftSize / sampleRate));
            let maxDb = -120;
            if (binStart >= binEnd) {
                const bin = Math.max(0, Math.round(fc * fftSize / sampleRate));
                maxDb = freqData[bin] || -120;
            } else {
                for (let j = binStart; j < binEnd; j++) {
                    if (freqData[j] > maxDb) maxDb = freqData[j];
                }
            }
            if (maxDb > band.peakDb) {
                band.peakDb = maxDb;
                band.decay = 60;
            } else if (band.decay > 0) {
                band.decay--;
                if (band.decay === 0) band.peakDb = maxDb;
            }
        });
        _renderPeakPerOctave();
    }

    function _renderPeakPerOctave() {
        const container = document.getElementById('peak-octave-container');
        if (!container) return;
        container.innerHTML = '';
        peakPerOctave.forEach(function (band) {
            const el = document.createElement('div');
            el.className = 'flex flex-col items-center bg-black/30 rounded px-1.5 py-1 min-w-[36px]';
            el.innerHTML = '<span class="text-[7px] text-slate-600">' + (band.fc >= 1000 ? (band.fc / 1000).toFixed(band.fc >= 10000 ? 0 : 1) + 'k' : band.fc) + '</span>'
                + '<span class="text-[9px] font-bold text-cyan-300 leading-tight">' + (band.peakDb > -120 ? Math.round(band.peakDb) : '--') + '</span>'
                + '<span class="text-[6px] text-slate-700">dB</span>';
            container.appendChild(el);
        });
    }

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
        const sigGen = window.SignalGeneratorController;
        if (sigGen && !sigGen.isPinkNoisePlaying()) {
            sigGen.startPinkNoise(true);
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
        const sigGen = window.SignalGeneratorController;
        if (sigGen && sigGen.isPinkNoisePlaying()) {
            sigGen.stopPinkNoise();
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

    const SPECTROGRAPH_MIN_FREQ = 20;
    const SPECTROGRAPH_MAX_FREQ = 20000;
    let _specBufferCanvas = null;
    let _specBufferCtx = null;

    function _ensureSpecBuffer(w, h) {
        if (!_specBufferCanvas || _specBufferCanvas.width !== w || _specBufferCanvas.height !== h) {
            _specBufferCanvas = document.createElement('canvas');
            _specBufferCanvas.width = w;
            _specBufferCanvas.height = h;
            _specBufferCtx = _specBufferCanvas.getContext('2d');
        }
    }

    function _drawSpectrograph(freqData, sampleRate) {
        if (!specCtx || !specCanvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = specCanvas.width;
        const h = specCanvas.height;
        const axisL = 30 * dpr;
        const axisB = 14 * dpr;
        const plotW = w - axisL;
        const plotH = h - axisB;
        if (plotW <= 0 || plotH <= 0) return;

        const rangeInput = _el('spec-dynamic-range');
        const dynamicRange = rangeInput ? Math.max(10, Number(rangeInput.value) || 60) : 60;
        const speedSelect = _el('spec-speed');
        const speed = speedSelect ? Math.max(1, Number(speedSelect.value) || 2) : 2;
        const speedPx = Math.round(speed * dpr);

        const logMin = Math.log10(SPECTROGRAPH_MIN_FREQ);
        const logMax = Math.log10(SPECTROGRAPH_MAX_FREQ);
        const bufferLength = freqData.length;
        const sampleRateVal = sampleRate || (audioCtx ? audioCtx.sampleRate : 48000);
        const hzPerBin = sampleRateVal / (bufferLength * 2);

        _ensureSpecBuffer(w, h);

        _specBufferCtx.save();

        _specBufferCtx.drawImage(
            _specBufferCanvas,
            axisL + speedPx, 0, plotW - speedPx, plotH,
            axisL, 0, plotW - speedPx, plotH
        );

        _specBufferCtx.clearRect(axisL + plotW - speedPx, 0, speedPx, plotH);

        // Use ImageData for pixel-level rendering (much faster than fillRect per pixel)
        const imageData = _specBufferCtx.getImageData(axisL + plotW - speedPx, 0, speedPx, plotH);
        const data = imageData.data;

        for (let px = 0; px < speedPx; px++) {
            for (let py = 0; py < plotH; py++) {
                const normY = 1 - py / plotH;
                const logFreq = logMin + normY * (logMax - logMin);
                const freq = Math.pow(10, logFreq);
                const bin = Math.round(freq / hzPerBin);
                if (bin < 0 || bin >= bufferLength) continue;
                const db = freqData[bin];
                const val = Math.max(0, Math.min(1, (db + dynamicRange) / dynamicRange));
                let r, g, b;
                if (val < 0.25) {
                    r = 0; g = 0; b = Math.floor(val * 4 * 255);
                } else if (val < 0.5) {
                    r = 0; g = Math.floor((val - 0.25) * 4 * 255); b = 255;
                } else if (val < 0.75) {
                    r = Math.floor((val - 0.5) * 4 * 255); g = 255; b = Math.floor((1 - (val - 0.5) * 4) * 255);
                } else {
                    r = 255; g = Math.floor((1 - (val - 0.75) * 4) * 255); b = 0;
                }
                const idx = (py * speedPx + px) * 4;
                data[idx] = r;
                data[idx + 1] = g;
                data[idx + 2] = b;
                data[idx + 3] = 255;
            }
        }

        _specBufferCtx.putImageData(imageData, axisL + plotW - speedPx, 0);

        _specBufferCtx.restore();

        specCtx.clearRect(0, 0, w, h);
        specCtx.drawImage(_specBufferCanvas, 0, 0);

        specCtx.save();
        specCtx.fillStyle = 'rgba(148, 163, 184, 0.5)';
        specCtx.font = `${Math.max(7, Math.round(8 * dpr))}px monospace`;
        specCtx.textAlign = 'right';
        specCtx.textBaseline = 'middle';
        const labelFreqs = [63, 250, 1000, 4000, 16000];
        labelFreqs.forEach(f => {
            const nf = (Math.log10(f) - logMin) / (logMax - logMin);
            const y = plotH - nf * plotH;
            if (y >= 0 && y <= plotH) {
                specCtx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), axisL - 2, y);
            }
        });

        specCtx.fillStyle = 'rgba(148, 163, 184, 0.4)';
        specCtx.font = `${Math.max(6, Math.round(7 * dpr))}px monospace`;
        specCtx.textAlign = 'right';
        specCtx.textBaseline = 'bottom';
        specCtx.fillText('Agora', w - 4, h);
        specCtx.textBaseline = 'top';
        specCtx.fillText(`-${Math.round(plotW / speedPx)}fr`, w - 4, 0);
        specCtx.restore();
    }

    function _bindTfEventListeners() {
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
    }

    function _initGlobalListeners() {
        var _ss = window.SocketService;
        if (!_ss) return;
        _ss.on('reference_audio_stream', (data) => {
            if (!data || !data.samples) return;
            refAudioQueue.push(...data.samples);
            if (refAudioQueue.length > 48000) {
                refAudioQueue.splice(0, refAudioQueue.length - 48000);
            }
        });

        _ss.on('sweep_analysis_result', (result) => {
            if (_sweepResultTimeout) {
                clearTimeout(_sweepResultTimeout);
                _sweepResultTimeout = null;
            }
            _handleSweepAnalysisResult(result);
        });

        _bindTfEventListeners();

        // Evento de page-unload para limpar recursos de UI e referências DOM
        window.addEventListener('page-unload', (e) => {
            if (e.detail && e.detail.pageId === 'analyzer') {
                console.log('[Analyzer] Limpando recursos de UI no page-unload (mantendo fluxo de áudio)...');
                _isStarting = false;
                if (_audioResumeHandler) {
                    document.removeEventListener('click', _audioResumeHandler);
                    _audioResumeHandler = null;
                }
                canvas = null;
                canvasCtx = null;
                waterfallCanvasEl = null;
                waterfallCtx = null;
                specCanvas = null;
                specCtx = null;
                rmsBar = null;
                feedbackAlert = null;
                analysisSummaryText = null;
                analysisDetailList = null;
                btnSendAnalysis = null;
                btnMeasurePink = null;
                pinkMeasureSummary = null;
                micSelect = null;
                _autoInitDone = false;
            }
        });
    }

    function _resizeCanvases() {
        const dpr = window.devicePixelRatio || 1;
        const canvases = [
            { el: canvas },
            { el: waterfallCanvasEl },
            { el: specCanvas }
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

        window.removeEventListener('resize', _resizeCanvases);
        canvas.removeEventListener('mousemove', _onRtaMouseMove);
        canvas.removeEventListener('mouseleave', _onRtaMouseLeave);

        function _onRtaMouseMove(e) {
            const rect = canvas.getBoundingClientRect();
            rtaCrosshairX = (e.clientX - rect.left) * (canvas.width / rect.width);
            rtaCrosshairY = (e.clientY - rect.top) * (canvas.height / rect.height);
        }
        function _onRtaMouseLeave() {
            rtaCrosshairX = -1;
            rtaCrosshairY = -1;
        }
        canvas.addEventListener('mousemove', _onRtaMouseMove);
        canvas.addEventListener('mouseleave', _onRtaMouseLeave);

        waterfallCanvasEl = _el('waterfall-canvas');
        if (waterfallCanvasEl) waterfallCtx = waterfallCanvasEl.getContext('2d');

        specCanvas = _el('spectrograph-canvas');
        if (specCanvas) specCtx = specCanvas.getContext('2d');

        _resizeCanvases();
        window.removeEventListener('resize', _resizeCanvases);
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
        btnSendAnalysis?.removeEventListener('click', sendAnalysisToAI);
        btnMeasurePink?.removeEventListener('click', startPinkNoiseMeasurement);
        btnSendAnalysis?.addEventListener('click', sendAnalysisToAI);
        btnMeasurePink?.addEventListener('click', startPinkNoiseMeasurement);

        const peakResetBtn = _el('btn-peak-hold-reset');
        if (peakResetBtn) {
            peakResetBtn.addEventListener('click', function () {
                peakPerOctave = [];
                peakHold.db = -100;
                peakHold.hz = 0;
            });
        }

        // Popula lista de microfones
        _populateDeviceList();

        // Vincula listeners da Transfer Function para garantir funcionamento no iframe
        _bindTfEventListeners();
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

        if (_audioResumeHandler) {
            document.removeEventListener('click', _audioResumeHandler);
        }
        _audioResumeHandler = () => {
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        };
        document.addEventListener('click', _audioResumeHandler);
    }

    async function startAnalyzer() {
        if (_isStarting || isAnalyzing) return;
        _isStarting = true;
        try {
            console.log('[Analyzer] startAnalyzer()');
            const deviceId = micSelect?.value || 'default';
            const deviceLabel = micSelect?.selectedOptions?.[0]?.text || 'Padrão';
            const useStereo = deviceLabel.toLowerCase().includes('usb') || deviceLabel.toLowerCase().includes('interface');
            const constraints = {
                audio: {
                    deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: useStereo ? 2 : 1,
                    latency: 0.001
                }
            };

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('O navegador não suporta captura de áudio ou você está em uma conexão não segura (HTTP).');
            }

            stream = await navigator.mediaDevices.getUserMedia(constraints);
            silentFrameCount = 0;
            await _populateDeviceList();

            audioCtx = new (window.AudioContext || window.webkitAudioContext)({
                latencyHint: 'interactive',
                sampleRate: 48000
            });

            if (audioCtx.state === 'suspended') {
                await audioCtx.resume();
            }
            if (audioCtx.state !== 'running') {
                throw new Error('AudioContext não pôde ser iniciado.');
            }

            try {
                await audioCtx.audioWorklet.addModule(`js/core/min/audio-processor.js?t=${Date.now()}`);
                await audioCtx.audioWorklet.addModule(`js/core/min/transfer-function-processor.js?t=${Date.now()}`);

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
            
            if (window.FIRConvolution && typeof window.FIRConvolution.init === 'function') {
                window.FIRConvolution.init(audioCtx).then(() => {
                    window.FIRConvolution.connectTo(source);
                    window.FIRConvolution.connectToDestination(monitorGain);
                }).catch(e => {
                    console.warn('[Analyzer] Falha ao inicializar FIRConvolution:', e);
                    source.connect(monitorGain);
                });
            } else {
                source.connect(monitorGain);
            }
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
            _isStarting = false;

            const dot = _el('mic-status-dot');
            const text = _el('mic-status-text');
            if (dot) dot.classList.add('online');
            if (text) text.innerText = 'Mic Online';

            _resizeCanvases();
            analyze();
        } catch (err) {
            _isStarting = false;
            console.error("Erro ao acessar microfone:", err);
            alert(`Erro ao acessar o microfone: ${err.message}`);
        }
    }

    async function stopAnalyzer() {
        console.log('[Analyzer] Parando analisador...');
        isAnalyzing = false;
        _lastWfSec = 0;
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
            try { monitorGain.disconnect(); } catch (_) { }
            monitorGain = null;
        }

        analyser = null;
        analyserFast = null;
        source = null;

        if (audioWorkletNode) {
            try { audioWorkletNode.disconnect(); } catch (_) { }
            audioWorkletNode = null;
        }
        if (transferFunctionNode) {
            try { transferFunctionNode.disconnect(); } catch (_) { }
            transferFunctionNode = null;
        }
        if (refSource) {
            try { refSource.disconnect(); } catch (_) { }
            refSource = null;
        }

        if (window._refSourceFeedTimer) {
            clearInterval(window._refSourceFeedTimer);
            window._refSourceFeedTimer = null;
        }

        refAudioQueue = [];

        if (window.SplLogger) SplLogger.stop();
        if (window.MtwManager) MtwManager.stop();

        if (canvasCtx && canvas) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        if (specCtx && specCanvas) specCtx.clearRect(0, 0, specCanvas.width, specCanvas.height);

        const dot = _el('mic-status-dot');
        const text = _el('mic-status-text');
        if (dot) dot.classList.remove('online');
        if (text) text.innerText = 'Mic Offline';
    }

    async function _setupReferenceSource(ctx, targetNode) {
        try {
            await ctx.audioWorklet.addModule(`js/core/min/reference-source-processor.js?t=${Date.now()}`);
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

    let _delayHistory = [];
    let _delayStableCount = 0;

    function _updateDelayTracker(delayMs, confidence) {
        _delayHistory.push(delayMs);
        if (_delayHistory.length > 100) _delayHistory.shift();

        const fill = _el('delay-tracker-fill');
        const status = _el('delay-tracker-status');
        if (!fill || !status) return;

        if (_delayHistory.length > 10) {
            const recent = _delayHistory.slice(-20);
            const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const variance = recent.reduce((s, v) => s + (v - avg) ** 2, 0) / recent.length;
            const stdDev = Math.sqrt(variance);

            if (stdDev < 0.1 && confidence > 70) {
                _delayStableCount = Math.min(100, _delayStableCount + 1);
            } else {
                _delayStableCount = Math.max(0, _delayStableCount - 2);
            }

            const pct = Math.min(100, _delayStableCount * 2);
            fill.style.width = pct + '%';
            fill.className = 'h-full rounded-full transition-all duration-300 ' +
                (pct > 80 ? 'bg-green-400' : pct > 40 ? 'bg-cyan-400' : 'bg-amber-400');

            status.textContent = pct > 80 ? '✓ Estável' : pct > 40 ? '⋯ Estabilizando' : '⟳ Rastreando';
            status.className = 'text-[7px] font-mono ' +
                (pct > 80 ? 'text-green-500' : pct > 40 ? 'text-cyan-500' : 'text-amber-500');
        } else {
            fill.style.width = '10%';
            status.textContent = '⟳ Aguardando...';
            status.className = 'text-[7px] font-mono text-slate-600';
        }
    }

    function _handleTransferFunctionData(data) {
        latestTFData = data;
        const { magnitude, phase, coherence, wrappedPhase, delayMs, sampleRate } = data;

        const delayEl = _el('delay-finder-value');
        if (delayEl) {
            delayEl.innerText = `${delayMs.toFixed(2)} ms`;
            delayEl.style.color = delayMs > 100 ? '#facc15' : '#22d3ee';
        }

        _updateDelayTracker(data.delayMs, data.confidence);
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
                avgFrames: data.avgFrames,
                wrappedPhase: wrappedPhase || phase
            });
        }
    }

    function _mapClassification(className) {
        if (!className) return { icon: _CLASS_DEFAULT_ICON, label: _CLASS_DEFAULT_LABEL, detail: _CLASS_DEFAULT_DETAIL };
        for (const entry of _CLASS_ICON_MAP) {
            if (entry.match.test(className)) return entry;
        }
        return { icon: _CLASS_DEFAULT_ICON, label: _CLASS_DEFAULT_LABEL, detail: className };
    }

    function _renderClassification(result) {
        _lastClassification = result;
        window._lastYamnetClassification = result;
        const badge = document.getElementById('ai-classification-badge');
        const iconEl = document.getElementById('ai-classification-icon');
        const labelEl = document.getElementById('ai-classification-label');
        const scoreEl = document.getElementById('ai-classification-score');
        const detailEl = document.getElementById('ai-classification-detail');
        if (!badge || !labelEl) return;

        if (!result || !result.topClass) {
            badge.classList.add('hidden');
            return;
        }

        const mapped = _mapClassification(result.topClass);
        if (iconEl) iconEl.textContent = mapped.icon;
        labelEl.textContent = mapped.label;
        if (scoreEl) scoreEl.textContent = Math.round((result.topScore || 0) * 100) + '%';
        if (detailEl) detailEl.textContent = mapped.detail;
        badge.classList.remove('hidden');

        // Color coding based on detection
        const isFeedback = mapped.label === 'Microfonia';
        const isSilence = mapped.label === 'Silêncio';
        badge.className = 'rounded-xl p-3 flex items-center gap-3 animate-in fade-in duration-500 ' +
            (isFeedback ? 'bg-gradient-to-r from-red-900/60 to-orange-900/40 border border-red-500/30' :
                isSilence ? 'bg-gradient-to-r from-slate-900/60 to-slate-800/40 border border-slate-500/30' :
                    'bg-gradient-to-r from-indigo-900/60 to-purple-900/40 border border-indigo-500/30');
    }

    async function _runClassification(samples, sampleRate) {
        if (!window.AIService || typeof window.AIService.classifyAudio !== 'function') return;
        try {
            const result = await AIService.classifyAudio(samples, sampleRate, 3, 0.05);
            if (result && result.topClass) {
                _renderClassification(result);
            }
        } catch (_) { }
    }

    function analyze() {
        if (!isAnalyzing || !analyser || !audioCtx) return;

        try {
            animationId = requestAnimationFrame(analyze);
            var _ss = window.SocketService;

            if (!freqData || freqData.length !== analyser.frequencyBinCount) {
                bufferLength = analyser.frequencyBinCount;
                freqData = new Float32Array(bufferLength);
                timeData = new Float32Array(analyser.fftSize);
            }

            analyser.getFloatFrequencyData(freqData);

            // RAW RMS (antes da calibração) para uso exclusivo da página de calibração SPL
            let _rawSum = 0;
            for (let _i = 1; _i < freqData.length; _i++) {
                _rawSum += Math.pow(10, freqData[_i] / 10);
            }
            window._rawFreqRMS_dB = 10 * Math.log10(_rawSum + 1e-12);

            if (freqData.every(v => !isFinite(v))) {
                silentFrameCount += 1;
                if (silentFrameCount === 10) {
                    console.warn('[Analyzer] Nenhum dado de frequência recebido do microfone.');
                }
            } else {
                silentFrameCount = 0;
            }

            const fastBufferLength = analyserFast.frequencyBinCount;
            if (!_fastFreqDataCache || _fastFreqDataCache.length !== fastBufferLength) {
                _fastFreqDataCache = new Float32Array(fastBufferLength);
            }
            const fastFreqData = _fastFreqDataCache;
            analyserFast.getFloatFrequencyData(fastFreqData);

            if (window.AcousticCalibration) {
                window.AcousticCalibration.applyCalibration(freqData, audioCtx.sampleRate, analyser.fftSize);
            }

            analyser.getFloatTimeDomainData(timeData);

            if (window.SplLogger) {
                SplLogger.push(freqData, timeData, analyser.fftSize);
            }

            if (window.AutoEQ) {
                if (!_aeqAcc) {
                    _aeqAcc = { sum: new Float32Array(freqData.length), count: 0 };
                }
                const acc = _aeqAcc;
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

            // Peak per octave band
            updatePeakPerOctave(freqData, audioCtx.sampleRate, analyser.fftSize);

            // --- Renderização visual se o canvas estiver ativo ---
            // Throttle: pula rendering a cada _frameSkip frames
            // (dados do analyser continuam a ser lidos todos os frames)
            _frameCount++;
            var _shouldRender = (_frameCount % _frameSkip === 0);

            if (canvas && canvasCtx && _shouldRender) {
                const iecCenters = [
                    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
                    500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
                    6300, 8000, 10000, 12500, 16000, 20000
                ];
                const w = canvas.width;
                const h = canvas.height;
                const minDb = analyser.minDecibels;
                const maxDb = analyser.maxDecibels;
                const dbRange = maxDb - minDb;
                const halfStep = Math.pow(2, 1 / 6);
                const axisL = 32;
                const axisB = 14;
                const plotW = w - axisL;
                const plotH = h - axisB;

                canvasCtx.fillStyle = '#0a0e1a';
                canvasCtx.fillRect(0, 0, w, h);

                // Grid & axis labels
                canvasCtx.save();
                canvasCtx.beginPath();
                canvasCtx.rect(axisL, 0, plotW, plotH);
                canvasCtx.clip();

                // Vertical frequency grid
                canvasCtx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
                canvasCtx.lineWidth = 1;
                const gridFreqs = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
                const logMin = Math.log10(20);
                const logMax = Math.log10(20000);
                gridFreqs.forEach(f => {
                    const lf = Math.log10(f);
                    const x = axisL + ((lf - logMin) / (logMax - logMin)) * plotW;
                    canvasCtx.beginPath();
                    canvasCtx.moveTo(x, 0);
                    canvasCtx.lineTo(x, plotH);
                    canvasCtx.stroke();
                });

                // Horizontal dB grid
                const dbStep = 10;
                for (let db = Math.ceil(minDb / dbStep) * dbStep; db <= maxDb; db += dbStep) {
                    const y = plotH - ((db - minDb) / dbRange) * plotH;
                    canvasCtx.beginPath();
                    canvasCtx.moveTo(0, y);
                    canvasCtx.lineTo(plotW, y);
                    canvasCtx.stroke();
                }

                canvasCtx.restore();

                // dB labels
                canvasCtx.save();
                canvasCtx.fillStyle = 'rgba(148, 163, 184, 0.5)';
                canvasCtx.font = '7px monospace';
                canvasCtx.textAlign = 'right';
                canvasCtx.textBaseline = 'middle';
                for (let db = Math.ceil(minDb / dbStep) * dbStep; db <= maxDb; db += dbStep) {
                    const y = plotH - ((db - minDb) / dbRange) * plotH;
                    canvasCtx.fillText(db, axisL - 3, y);
                }

                // Frequency labels
                canvasCtx.textAlign = 'center';
                canvasCtx.textBaseline = 'top';
                gridFreqs.forEach(f => {
                    const lf = Math.log10(f);
                    const x = axisL + ((lf - logMin) / (logMax - logMin)) * plotW;
                    canvasCtx.fillText(f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)}k` : String(f), x, plotH + 1);
                });
                canvasCtx.restore();

                // Bars (suaves, opacidade controlada)
                const numBands = iecCenters.length;
                const spacing = 1;
                const barWidth = (plotW - (spacing * (numBands - 1))) / numBands;

                canvasCtx.save();
                canvasCtx.beginPath();
                canvasCtx.rect(axisL, 0, plotW, plotH);
                canvasCtx.clip();

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

                    const normalized = Math.max(0, Math.min(1, (maxDbInBin - minDb) / dbRange));
                    const barHeight = normalized * plotH;
                    const x = axisL + i * (barWidth + spacing);

                    const hue = fc < 60 ? 210 : fc < 250 ? 160 : fc < 2000 ? 45 : fc < 6000 ? 25 : 0;
                    const sat = 70 + normalized * 20;
                    const lit = 40 + normalized * 30;
                    canvasCtx.fillStyle = `hsl(${hue}, ${sat}%, ${lit}%)`;
                    canvasCtx.globalAlpha = 0.7;
                    canvasCtx.fillRect(x, plotH - barHeight, barWidth, barHeight);
                }
                canvasCtx.globalAlpha = 1;

                // Line trace overlay (Smaart "both" style)
                canvasCtx.beginPath();
                canvasCtx.strokeStyle = '#22d3ee';
                canvasCtx.lineWidth = 1.5;
                canvasCtx.shadowColor = '#22d3ee';
                canvasCtx.shadowBlur = 2;
                let lineStarted = false;
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
                    const normalized = Math.max(0, Math.min(1, (maxDbInBin - minDb) / dbRange));
                    const x = axisL + i * (barWidth + spacing) + barWidth / 2;
                    const y = plotH - normalized * plotH;
                    if (!lineStarted) { canvasCtx.moveTo(x, y); lineStarted = true; }
                    else { canvasCtx.lineTo(x, y); }
                }
                canvasCtx.stroke();
                canvasCtx.shadowBlur = 0;

                canvasCtx.restore();

                // Peak hold (Smaart-style white line with diamond)
                if (peakHold.timer > 0) {
                    let closestBandIndex = 0;
                    let minDiff = Infinity;
                    for (let i = 0; i < numBands; i++) {
                        const diff = Math.abs(iecCenters[i] - peakHold.hz);
                        if (diff < minDiff) { minDiff = diff; closestBandIndex = i; }
                    }
                    const peakX = axisL + closestBandIndex * (barWidth + spacing);
                    const peakNormalized = Math.max(0, Math.min(1, (peakHold.db - minDb) / dbRange));
                    const peakY = plotH - (peakNormalized * plotH);

                    canvasCtx.save();
                    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                    canvasCtx.lineWidth = 2;
                    canvasCtx.shadowColor = 'rgba(255, 255, 255, 0.3)';
                    canvasCtx.shadowBlur = 4;
                    canvasCtx.beginPath();
                    canvasCtx.moveTo(peakX, peakY);
                    canvasCtx.lineTo(peakX + barWidth, peakY);
                    canvasCtx.stroke();

                    canvasCtx.fillStyle = '#ffffff';
                    canvasCtx.shadowBlur = 6;
                    canvasCtx.beginPath();
                    canvasCtx.moveTo(peakX + barWidth / 2, peakY - 4);
                    canvasCtx.lineTo(peakX + barWidth / 2 + 4, peakY);
                    canvasCtx.lineTo(peakX + barWidth / 2, peakY + 4);
                    canvasCtx.lineTo(peakX + barWidth / 2 - 4, peakY);
                    canvasCtx.closePath();
                    canvasCtx.fill();
                    canvasCtx.restore();

                    // Label do pico
                    canvasCtx.save();
                    canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                    canvasCtx.font = '8px monospace';
                    canvasCtx.textAlign = 'center';
                    canvasCtx.textBaseline = 'bottom';
                    canvasCtx.fillText(`${Math.round(peakHold.hz)}Hz`, peakX + barWidth / 2, peakY - 6);
                    canvasCtx.restore();
                }

                if (rtaCrosshairX > 0 && rtaCrosshairY > 0 && window.Crosshair) {
                    Crosshair.drawRTA(canvasCtx, rtaCrosshairX, rtaCrosshairY, {
                        width: canvas.width,
                        height: canvas.height,
                        color: '#22d3ee',
                        minDb: analyser.minDecibels,
                        maxDb: analyser.maxDecibels,
                        axisOffset: 32,
                        spacing: 1,
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
                        else if (normalized < 0.5) color = `rgb(0, ${Math.floor((normalized - 0.2) * 255)}, 255)`;
                        else if (normalized < 0.8) color = `rgb(${Math.floor((normalized - 0.5) * 255)}, 255, 0)`;
                        else color = `rgb(255, ${Math.floor((1 - normalized) * 255)}, 0)`;

                        waterfallCtx.fillStyle = color;
                        waterfallCtx.fillRect(i, 0, 1, rowHeight);
                    }

                    _drawWaterfallTimeAxis(waterfallCtx, plotW, 0, axisWidth, h);

                    const nowSec = Math.floor(Date.now() / 1000);
                    if (nowSec !== _lastWfSec) {
                        _lastWfSec = nowSec;
                        waterfallCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                        waterfallCtx.fillRect(0, 0, plotW, 1);
                    }
                }
            }

            if (specCtx && specCanvas) {
                _drawSpectrograph(freqData, audioCtx.sampleRate);
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

            if (_ss && isAnalyzing && !isSweepActive && peakDb > -15) {
                if (_feedbackCooldown <= 0) {
                    _ss.emit('analyze_feedback_risk', {
                        hz: Math.round(currentFastPeakHz),
                        db: peakDb,
                        prevDb: lastAnalysis?.details?.peakDb || -100
                    });
                    _feedbackCooldown = 15; // Cerca de 250ms a 60fps (15 frames * 16.7ms = 250ms)
                }
            }
            if (_feedbackCooldown > 0) {
                _feedbackCooldown--;
            }

            // YAMNet live classification (every ~2 seconds)
            _classifyCooldown--;
            if (timeData && peakDb > -60 && audioCtx) {
                _classifyBuffer.push(...timeData);
                _classifyFrameCount++;
                const requiredFrames = Math.ceil(audioCtx.sampleRate / timeData.length) * 2;
                if (_classifyFrameCount >= requiredFrames && _classifyCooldown <= 0) {
                    const samples = _classifyBuffer.slice(0, Math.min(_classifyBuffer.length, audioCtx.sampleRate * 2));
                    _classifyBuffer = [];
                    _classifyFrameCount = 0;
                    _classifyCooldown = 300;
                    _runClassification(samples, audioCtx.sampleRate);
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
            rt60: lastRt60 > 0 ? Number(lastRt60) : null,
            rt60_multiband: rt60Payload,
            spectrum_db: lastAnalysis.details.spectrum_v11 || {},
            bands: lastAnalysis.details.bands,
            position: getCurrentMeasurementPosition(),
            crowdStatus: _el('crowd-status')?.value || 'empty',
            timestamp: new Date().toISOString()
        };

        var _ss = window.SocketService;
        if (_ss) _ss.emit('save_acoustic_snapshot', acousticSnapshot);

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
            if (aiText) aiText.innerText = result.text;

            const actionsArea = _el('analyzer-ai-actions');
            if (actionsArea && result.command) {
                actionsArea.innerHTML = '';
                const button = document.createElement('button');
                button.className = 'px-3 py-1.5 bg-cyan-600/20 text-cyan-400 border border-cyan-500/30 rounded-lg text-[10px] font-bold uppercase hover:bg-cyan-500 hover:text-white transition-all';
                button.innerText = 'Executar Correção Sugerida';
                button.addEventListener('click', () => {
                    if (window.MixerService && typeof MixerService.executeAICommand === 'function') {
                        MixerService.executeAICommand(result.command);
                    } else {
                        alert('Comando da IA recebido, mas o Mixer não está conectado.');
                    }
                });
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
            await audioCtx.audioWorklet.addModule(`js/core/min/log-sweep-processor.js?t=${Date.now()}`);
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

        if (_sweepSafetyTimer) clearTimeout(_sweepSafetyTimer);
        const safetyMs = (sweepParams.silencePre + sweepParams.duration + sweepParams.silencePost + 5) * 1000;
        _sweepSafetyTimer = setTimeout(() => {
            _sweepSafetyTimer = null;
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

        await audioCtx.audioWorklet.addModule(`js/core/min/capture-processor.js?t=${Date.now()}`);
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

        setTimeout(() => {
            sweepSource.stop();
        }, sweepDuration * 1000);

        setTimeout(() => {
            captureNode.port.postMessage({ type: 'set-active', value: false });
            captureNode.disconnect();
            captureSilent.disconnect();
            
            finishSweepMeasurement();
            
            // Envia os dados para processamento
            const validData = sweepRecordingBuffer.slice(0, sweepRecordingIdx);
            _onSweepWorkletDone(validData, null, sampleRate);
        }, captureDuration * 1000);
    }

    function _onSweepWorkletDone(recording, reference, sampleRate) {
        isSweepActive = false;
        sweepCaptureActive = false;

        if (_sweepSafetyTimer) {
            clearTimeout(_sweepSafetyTimer);
            _sweepSafetyTimer = null;
        }

        if (sweepNode) {
            try { sweepNode.disconnect(); } catch (_) { }
            sweepNode = null;
        }

        const summaryEl = _el('pink-measure-summary');
        if (summaryEl) summaryEl.innerText = '⚙️ Deconvoluindo IR...';

        // ── Downsample para reduzir payload (evitar exceder maxHttpBufferSize) ──
        var targetSr = sampleRate;
        var recArr = Array.from(recording);
        var refArr = reference ? Array.from(reference) : [];

        // Se > 24kHz, downsample por 2 para reduzir payload ~50%
        if (sampleRate > 24000) {
            var factor = 2;
            targetSr = Math.round(sampleRate / factor);
            recArr = _downsample(recArr, factor);
            refArr = refArr.length > 0 ? _downsample(refArr, factor) : [];
            console.log('[Sweep] Downsample ' + sampleRate + 'Hz → ' + targetSr + 'Hz (rec: ' + recArr.length + ' samples)');
        }

        var _ss = window.SocketService;
        var payload = {
            recording: recArr,
            reference: refArr,
            sampleRate: targetSr,
            sweepParams: { f0: 20, f1: 20000, duration: 10, amplitude: 0.85, silencePre: 0.5, sampleRate: targetSr }
        };

        _sweepResultTimeout = setTimeout(function () {
            if (summaryEl) summaryEl.innerHTML = '<span class="text-red-400">Timeout: resposta do servidor demorou mais de 60s.</span>';
        }, 65000);

        function _trySend(retries) {
            if (_ss && _ss.isConnected && _ss.isConnected()) {
                _ss.emit('analyze_sweep_ir', payload);
                return;
            }
            if (retries > 0) {
                setTimeout(function () { _trySend(retries - 1); }, 2000);
            } else {
                clearTimeout(_sweepResultTimeout);
                if (summaryEl) summaryEl.innerHTML = '<span class="text-red-400">Falha ao enviar dados. Socket offline.</span>';
            }
        }
        _trySend(5);
    }

    // Downsample simples por fator inteiro (média de amostras vizinhas)
    function _downsample(samples, factor) {
        var out = [];
        for (var i = 0; i < samples.length; i += factor) {
            var sum = 0;
            var count = 0;
            for (var j = 0; j < factor && (i + j) < samples.length; j++) {
                sum += samples[i + j];
                count++;
            }
            out.push(sum / count);
        }
        return out;
    }

    async function finishSweepMeasurement() {
        if (!isSweepActive) return;
        isSweepActive = false;
        sweepCaptureActive = false;
        if (_sweepSafetyTimer) {
            clearTimeout(_sweepSafetyTimer);
            _sweepSafetyTimer = null;
        }
        if (sweepNode) {
            try { sweepNode.port.postMessage({ type: 'stop' }); } catch (_) { }
        }
    }

    function _dispatchRt60Result(detail) {
        var eventInit = { detail: detail };
        document.dispatchEvent(new CustomEvent('rt60-result', eventInit));

        var iframe = document.getElementById('agent-workspace-iframe');
        var iframeDoc = iframe && iframe.contentDocument;
        if (iframeDoc && iframeDoc !== document) {
            iframeDoc.dispatchEvent(new CustomEvent('rt60-result', eventInit));
        }
    }

    function _normalizeSweepRt60Result(result) {
        var rt60 = result.rt60 || result.t30 || result.t20 || result.rt60_est || 0;
        var curve = result.curve || result.schroeder_curve || [];
        return Object.assign({}, result, {
            rt60: rt60,
            curve: curve,
            schroeder_curve: result.schroeder_curve || curve,
            snr: result.snr || result.snr_db,
            multiband: result.multiband || {}
        });
    }

    function _handleSweepAnalysisResult(result) {
        console.log('[Analyzer] _handleSweepAnalysisResult recebido no client:', result);
        if (result.error) {
            console.error('[Analyzer] Erro retornado na análise de sweep:', result.error);
            const summaryEl = _el('pink-measure-summary');
            if (summaryEl) summaryEl.innerHTML = `<span class="text-red-400">Erro: ${result.error}</span>`;
            _dispatchRt60Result({ error: result.error });
            return;
        }

        result = _normalizeSweepRt60Result(result);
        lastRt60Result = result;
        lastRt60 = result.rt60 || 0;

        // Auto-save sweep measurement to history for benchmarking
        try {
            const rt60Payload = buildRt60Payload(result);
            const acousticSnapshot = {
                schema_version: '1.1',
                name: `Medição Acústica (Sweep)`,
                type: 'acoustic_measurement',
                summary: `EDT: ${result.edt}s | T20: ${result.t20}s | T30: ${result.t30}s | STI: ${result.sti_category}`,
                measurementType: 'sweep',
                peakHz: result.peak_index_ms ? Math.round(result.peak_index_ms) : null,
                peakDb: null,
                rms: null,
                spl: null,
                rt60: lastRt60 > 0 ? Number(lastRt60) : null,
                rt60_multiband: rt60Payload,
                spectrum_db: {},
                bands: null,
                position: getCurrentMeasurementPosition(),
                crowdStatus: _el('crowd-status')?.value || 'empty',
                timestamp: new Date().toISOString()
            };

            const _ss = window.SocketService;
            if (_ss) {
                console.log('[Analyzer] Salvando medição de sweep no histórico:', acousticSnapshot);
                _ss.emit('save_acoustic_snapshot', acousticSnapshot);
            }
        } catch (saveErr) {
            console.error('[Analyzer] Erro ao salvar snapshot de sweep:', saveErr);
        }

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

        _dispatchRt60Result({
            curve: result.curve || [],
            rt60: result.rt60,
            t20: result.t20,
            t30: result.t30,
            edt: result.edt,
            snr: result.snr,
            c50: result.c50,
            c80: result.c80,
            d50: result.d50,
            sti: result.sti,
            sti_category: result.sti_category,
            multiband: result.multiband || {},
            fullResult: result,
        });
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

        _dispatchRt60Result({
            curve: result.curve || [],
            rt60: result.rt60,
            t20: result.t20,
            t30: result.t30,
            edt: result.edt,
            snr: result.snr,
            c50: result.c50,
            c80: result.c80,
            d50: result.d50,
            sti: result.sti,
            sti_category: result.sti_category,
            multiband: result.multiband || {},
            fullResult: result,
        });
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
        getTimeData: () => timeData ? new Float32Array(timeData) : null,
        getDelayMs: () => latestTFData ? latestTFData.delayMs : null,
        getTransferFunctionData: () => latestTFData,
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
        // Inicializa o iframe de referência imediatamente
        _analyzerIframe = document.getElementById('agent-workspace-iframe');

        // Defer global init to ensure SocketService is initialized first
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(initGlobalAnalyzer, 100);
            });
        } else {
            setTimeout(initGlobalAnalyzer, 100);
        }

        function tryInit() {
            _analyzerIframe = document.getElementById('agent-workspace-iframe') || _analyzerIframe;
            if (_el('fft-canvas')) {
                initAnalyzer();
                _autoInitDone = true;
                return true;
            }
            return false;
        }

        if (tryInit()) return;

        document.addEventListener('page-loaded', (e) => {
            if (e.detail.pageId === 'analyzer' && !_autoInitDone) {
                setTimeout(tryInit, 100);
            }
        });

        document.addEventListener('iframe-loaded', (e) => {
            if (e.detail.pageId === 'analyzer' && !_autoInitDone) {
                setTimeout(tryInit, 100);
            }
        });
    })();

    return {
        isAnalyzing: () => isAnalyzing,
        getFrequencyData: () => { const snap = getFreqDataSnapshot(); return snap ? snap.data : []; },
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
