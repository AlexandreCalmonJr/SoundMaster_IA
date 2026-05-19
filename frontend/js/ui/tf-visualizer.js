/**
 * SoundMaster Pro - Transfer Function Visualizer
 * Renders magnitude, unwrapped phase, and captured trace stacks.
 */
(function () {
    'use strict';

    /**
     * Busca elemento pelo ID, tentando primeiro no iframe e depois no parent.
     */
    function _el(id) {
        const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    let magCanvas, magCtx, phaseCanvas, phaseCtx;
    const minFreq = 20;
    const maxFreq = 20000;
    const traceLimit = 5;
    const traceColors = ['#f97316', '#22c55e', '#38bdf8', '#f43f5e', '#eab308'];
    let capturedTraces = [];
    let crosshairX = -1;
    let crosshairYMag = -1;
    let crosshairYPhase = -1;
    let zoomMag = 40;
    let zoomPhase = 720;

    function init() {
        console.log('[TF-Visualizer] Inicializando canvases...');
        magCanvas = _el('tf-magnitude-canvas');
        phaseCanvas = _el('tf-phase-canvas');
        if (magCanvas) magCtx = magCanvas.getContext('2d');
        if (phaseCanvas) phaseCtx = phaseCanvas.getContext('2d');

        if (!magCanvas || !phaseCanvas) {
            console.warn('[TF-Visualizer] Canvases nao encontrados no DOM.');
        }

        window.removeEventListener('resize', resize);
        window.addEventListener('resize', resize);
        resize();

        bindInteractivity(magCanvas, 'mag');
        bindInteractivity(phaseCanvas, 'phase');
        updateTraceCount();
    }

    function bindInteractivity(canvas, type) {
        if (!canvas) return;
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            crosshairX = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            if (type === 'mag') crosshairYMag = y;
            if (type === 'phase') crosshairYPhase = y;
        });
        canvas.addEventListener('mouseleave', () => {
            crosshairX = -1;
            crosshairYMag = -1;
            crosshairYPhase = -1;
        });
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = Math.sign(e.deltaY);
            if (type === 'mag') {
                zoomMag = Math.max(10, Math.min(120, zoomMag + delta * 5));
            } else {
                zoomPhase = Math.max(180, Math.min(1440, zoomPhase + delta * 30));
            }
        }, { passive: false });
    }

    function phaseLooksWrapped(phaseArray) {
        for (let i = 1; i < phaseArray.length; i++) {
            if (Math.abs(phaseArray[i] - phaseArray[i - 1]) > Math.PI) return true;
        }
        return false;
    }

    function unwrapPhase(phaseArray) {
        if (!phaseArray || phaseArray.length === 0) return new Float32Array(0);
        if (!phaseLooksWrapped(phaseArray)) return new Float32Array(phaseArray);

        const unwrapped = new Float32Array(phaseArray.length);
        let correction = 0;
        unwrapped[0] = phaseArray[0];

        for (let i = 1; i < phaseArray.length; i++) {
            const diff = phaseArray[i] - phaseArray[i - 1];
            if (diff > Math.PI) correction -= 2 * Math.PI;
            else if (diff < -Math.PI) correction += 2 * Math.PI;
            unwrapped[i] = phaseArray[i] + correction;
        }
        return unwrapped;
    }

    function captureCurrentTrace(magnitude, phase, coherence, meta = {}) {
        if (!magnitude || !phase || !coherence) return;
        if (capturedTraces.length >= traceLimit) capturedTraces.shift();

        const color = traceColors[capturedTraces.length % traceColors.length];
        capturedTraces.push({
            magnitude: new Float32Array(magnitude),
            phase: unwrapPhase(new Float32Array(phase)),
            coherence: new Float32Array(coherence),
            sampleRate: meta.sampleRate || 48000,
            timestamp: new Date().toLocaleTimeString(),
            color
        });
        updateTraceCount();
    }

    function clearTraces() {
        capturedTraces = [];
        updateTraceCount();
    }

    function updateTraceCount() {
        const btn = _el('btn-capture-tf');
        if (btn) btn.title = `${capturedTraces.length}/${traceLimit} traces capturados`;
    }

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        if (magCanvas) {
            magCanvas.width = magCanvas.clientWidth * dpr;
            magCanvas.height = magCanvas.clientHeight * dpr;
        }
        if (phaseCanvas) {
            phaseCanvas.width = phaseCanvas.clientWidth * dpr;
            phaseCanvas.height = phaseCanvas.clientHeight * dpr;
        }
    }

    function freqToX(freq, width) {
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const logFreq = Math.log10(Math.max(minFreq, freq));
        return ((logFreq - logMin) / (logMax - logMin)) * width;
    }

    function drawGrids(ctx, width, height, type) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.lineWidth = 1;
        ctx.font = '8px Inter, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';

        const freqs = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        freqs.forEach(f => {
            const x = freqToX(f, width);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, height - 5);
        });

        ctx.beginPath();
        if (type === 'magnitude') {
            const step = zoomMag > 60 ? 12 : 6;
            for (let db = -Math.floor(zoomMag / 2); db <= Math.floor(zoomMag / 2); db += step) {
                const y = height / 2 - (db * (height / zoomMag));
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
            }
        } else {
            const step = zoomPhase > 720 ? 180 : 90;
            for (let deg = -Math.floor(zoomPhase / 2); deg <= Math.floor(zoomPhase / 2); deg += step) {
                const y = height / 2 - (deg * (height / zoomPhase));
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
            }
        }
        ctx.stroke();
    }

    function drawTraceLine(ctx, data, width, height, type, hzPerBin, color, isLive = false) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = isLive ? 2 : 1;
        ctx.setLineDash(isLive ? [] : [4, 4]);

        let started = false;
        for (let i = 0; i < data.length; i++) {
            const freq = i * hzPerBin;
            if (freq < minFreq) continue;
            if (freq > maxFreq) break;

            const x = freqToX(freq, width);
            const y = type === 'magnitude'
                ? height / 2 - (data[i] * (height / zoomMag))
                : height / 2 - ((data[i] * 180 / Math.PI) * (height / zoomPhase));

            if (!Number.isFinite(y)) continue;
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function drawTraceLegend(ctx, width) {
        if (capturedTraces.length === 0) return;
        ctx.save();
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        capturedTraces.forEach((trace, idx) => {
            ctx.globalAlpha = 0.78;
            ctx.fillStyle = trace.color;
            ctx.fillText(`T${idx + 1} ${trace.timestamp}`, width - 8, 8 + idx * 12);
        });
        ctx.restore();
    }

    function drawCrosshair(ctx, yPos, type, color, scaleRange, width, height) {
        if (crosshairX <= 0) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(crosshairX, 0);
        ctx.lineTo(crosshairX, height);
        ctx.stroke();

        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const xPercent = crosshairX / width;
        const freqAtCursor = Math.pow(10, logMin + xPercent * (logMax - logMin));

        let valStr = '';
        if (yPos > 0) {
            ctx.beginPath();
            ctx.moveTo(0, yPos);
            ctx.lineTo(width, yPos);
            ctx.stroke();

            const val = ((height / 2 - yPos) / height) * scaleRange;
            valStr = type === 'mag' ? ` | ${val.toFixed(1)} dB` : ` | ${val.toFixed(1)} deg`;
        }

        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(crosshairX + 5, 5, 92, 16);
        ctx.fillStyle = color;
        ctx.font = '10px monospace';
        ctx.fillText(`${Math.round(freqAtCursor)}Hz${valStr}`, crosshairX + 8, 16);
        ctx.restore();
    }

    function drawTransferFunction(magnitude, phase, coherence, meta = {}) {
        if (!magCtx || !phaseCtx || !magnitude || !phase) return;

        const w = magCanvas.width;
        const h = magCanvas.height;
        const sampleRate = meta.sampleRate || 48000;
        const hzPerBin = sampleRate / (magnitude.length * 2);

        magCtx.clearRect(0, 0, w, h);
        phaseCtx.clearRect(0, 0, w, h);

        drawGrids(magCtx, w, h, 'magnitude');
        drawGrids(phaseCtx, w, h, 'phase');

        capturedTraces.forEach((trace, idx) => {
            const traceHzPerBin = trace.sampleRate / (trace.magnitude.length * 2);
            const alpha = Math.max(0.25, 0.65 - idx * 0.08);
            magCtx.globalAlpha = alpha;
            phaseCtx.globalAlpha = alpha;
            drawTraceLine(magCtx, trace.magnitude, w, h, 'magnitude', traceHzPerBin, trace.color);
            drawTraceLine(phaseCtx, trace.phase, w, h, 'phase', traceHzPerBin, trace.color);
        });
        magCtx.globalAlpha = 1;
        phaseCtx.globalAlpha = 1;

        const livePhase = unwrapPhase(phase);
        drawTraceLine(magCtx, magnitude, w, h, 'magnitude', hzPerBin, '#22d3ee', true);
        drawTraceLine(phaseCtx, livePhase, w, h, 'phase', hzPerBin, '#a855f7', true);
        drawTraceLegend(phaseCtx, w);

        drawCrosshair(magCtx, crosshairYMag, 'mag', '#22d3ee', zoomMag, w, h);
        drawCrosshair(phaseCtx, crosshairYPhase, 'phase', '#a855f7', zoomPhase, w, h);
    }

    window.SoundMasterVisualizer = {
        init,
        drawTransferFunction,
        captureCurrentTrace,
        clearTraces,
        unwrapPhase
    };
})();
