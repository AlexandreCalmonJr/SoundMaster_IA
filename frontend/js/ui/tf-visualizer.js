(function () {
    'use strict';

    function _el(id) {
        try {
            const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
            if (iframe && iframe.contentDocument) {
                const el = iframe.contentDocument.getElementById(id);
                if (el) return el;
            }
        } catch (_) { }
        return document.getElementById(id);
    }

    let magCanvas, magCtx, phaseCanvas, phaseCtx, lirCanvas, lirCtx;
    const minFreq = 20;
    const maxFreq = 20000;
    const traceLimit = 5;
    const traceColors = ['#f97316', '#22c55e', '#38bdf8', '#f43f5e', '#eab308'];
    let capturedTraces = [];
    let crosshairX = -1;
    let crosshairYMag = -1;
    let crosshairYPhase = -1;
    let zoomMag = 40;
    let zoomPhase = 360;
    let zoomFreqMin = minFreq;
    let zoomFreqMax = maxFreq;
    let rubberBand = null;
    let lockedCursorFreq = -1;
    let lockedCursor2Freq = -1;
    let _lastPolarityCheck = 0;
    let traceFolders = [];
    let phaseMode = 'wrapped';
    let showGroupDelay = false;
    let showCoherence = true;
    let smoothing = 0;
    let coherenceSquared = false;
    let blankingThreshold = 20;
    let targetCurve = null;
    let showTarget = false;
    let showMultiSpectrum = false;
    let rtaSpectrumData = null;
    let lirVisible = false;
    let lirData = null;
    let lirViewType = 'etc';
    let lirTimeMs = 20;
    let lirFrameCount = 0;
    let _abortCtrl = null;

    const GRID_COLOR = 'rgba(148, 163, 184, 0.08)';
    const GRID_LABEL_COLOR = 'rgba(148, 163, 184, 0.5)';
    const BG_COLOR = '#0a0e1a';
    const COHERENCE_FILL = 'rgba(239, 68, 68, 0.15)';
    const COHERENCE_LINE = 'rgba(239, 68, 68, 0.6)';
    const ZERO_LINE_COLOR = 'rgba(255, 255, 255, 0.15)';
    const TARGET_COLOR = 'rgba(255, 200, 0, 0.7)';

    const AXIS_MARGIN_LEFT = 38;
    const AXIS_MARGIN_BOTTOM = 14;

    function wrapPhase(phaseArray) {
        const out = new Float32Array(phaseArray.length);
        const twoPi = 2 * Math.PI;
        for (let i = 0; i < phaseArray.length; i++) {
            out[i] = ((phaseArray[i] + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
        }
        return out;
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

    function computeGroupDelay(unwrappedPhase, sampleRate, fftSize) {
        if (!unwrappedPhase || unwrappedPhase.length < 3) return new Float32Array(0);
        const gd = new Float32Array(unwrappedPhase.length);
        const deltaF = sampleRate / fftSize;
        const twoPiDeltaF = 2 * Math.PI * deltaF;
        for (let i = 1; i < unwrappedPhase.length - 1; i++) {
            gd[i] = -((unwrappedPhase[i + 1] - unwrappedPhase[i - 1]) / (2 * twoPiDeltaF)) * 1000;
        }
        gd[0] = gd[1];
        gd[unwrappedPhase.length - 1] = gd[unwrappedPhase.length - 2];
        return gd;
    }

    function _fftRadix2(re, im) {
        const n = re.length;
        let bits = 0;
        while ((1 << bits) < n) bits++;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) {
                const tr = re[i]; re[i] = re[j]; re[j] = tr;
                const ti = im[i]; im[i] = im[j]; im[j] = ti;
            }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const half = len >> 1;
            const wAng = -2 * Math.PI / len;
            for (let i = 0; i < n; i += len) {
                for (let j = 0; j < half; j++) {
                    const wRe = Math.cos(wAng * j);
                    const wIm = Math.sin(wAng * j);
                    const uRe = re[i + j];
                    const uIm = im[i + j];
                    const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
                    const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
                    re[i + j] = uRe + vRe;
                    im[i + j] = uIm + vIm;
                    re[i + j + half] = uRe - vRe;
                    im[i + j + half] = uIm - vIm;
                }
            }
        }
    }

    function computeImpulseResponse(magnitudeDb, unwrappedPhase, sampleRate) {
        const numBins = magnitudeDb.length;
        const fftSize = 1;
        let fftSize2 = 1;
        while (fftSize2 < numBins * 2) fftSize2 <<= 1;
        const n = fftSize2;
        const re = new Float64Array(n);
        const im = new Float64Array(n);
        for (let i = 0; i < numBins; i++) {
            const magLin = Math.pow(10, magnitudeDb[i] / 20);
            re[i] = magLin * Math.cos(unwrappedPhase[i]);
            im[i] = magLin * Math.sin(unwrappedPhase[i]);
        }
        for (let i = 1; i < numBins; i++) {
            re[n - i] = re[i];
            im[n - i] = -im[i];
        }
        _fftRadix2(re, im);
        const scale = 1 / n;
        const ir = new Float32Array(n);
        for (let i = 0; i < n; i++) ir[i] = re[i] * scale;
        return { ir, sampleRate };
    }

    function fractionalOctaveSmoothing(data, sampleRate, fraction) {
        if (!fraction || fraction <= 0 || !data || data.length < 4) return data;
        const out = new Float32Array(data.length);
        const hzPerBin = sampleRate / (data.length * 2);
        const octaveRatio = Math.pow(2, 0.5 / fraction);
        for (let i = 0; i < data.length; i++) {
            const fc = i * hzPerBin;
            if (fc < 20) { out[i] = data[i]; continue; }
            const fLow = fc / octaveRatio;
            const fHigh = fc * octaveRatio;
            let sum = 0, count = 0;
            const loBin = Math.max(0, Math.floor(fLow / hzPerBin));
            const hiBin = Math.min(data.length - 1, Math.ceil(fHigh / hzPerBin));
            for (let j = loBin; j <= hiBin; j++) {
                const w = 1 - Math.abs(j - i) / (hiBin - loBin + 1);
                sum += data[j] * w;
                count += w;
            }
            out[i] = count > 0 ? sum / count : data[i];
        }
        return out;
    }

    function init() {
        if (_abortCtrl) _abortCtrl.abort();
        _abortCtrl = new AbortController();
        var sig = _abortCtrl.signal;
        magCanvas = _el('tf-magnitude-canvas');
        phaseCanvas = _el('tf-phase-canvas');
        if (magCanvas) magCtx = magCanvas.getContext('2d');
        if (phaseCanvas) phaseCtx = phaseCanvas.getContext('2d');
        lirCanvas = _el('lir-canvas');
        if (lirCanvas) lirCtx = lirCanvas.getContext('2d');
        if (!magCanvas || !phaseCanvas) {
            console.warn('[TF-Visualizer] Canvases nao encontrados no DOM.');
        }
        window.addEventListener('resize', resize, { signal: sig });
        resize();
        bindInteractivity(magCanvas, 'mag', sig);
        bindInteractivity(phaseCanvas, 'phase', sig);
        _updateTraceCount();
        bindPhaseToggle(sig);
        bindCoherenceToggle(sig);
        bindGroupDelayToggle(sig);
        bindLirToggle(sig);
        bindAutoScale(sig);
        bindMultiSpectrum(sig);
        bindFreqRange(sig);
        bindTraceMath(sig);
        bindSmoothing(sig);
        bindCoherenceSquared(sig);
        bindBlankingThreshold(sig);
        bindTargetCurve(sig);
        bindHotkeys(sig);
        var metaClose = _el('btn-trace-meta-close');
        if (metaClose) {
            metaClose.addEventListener('click', function () {
                var panel = _el('trace-metadata-panel');
                if (panel) panel.classList.add('hidden');
            }, { signal: sig });
        }
        bindPlotPresets(sig);
        bindTraceFolders(sig);
    }

    function destroy() {
        if (_abortCtrl) { _abortCtrl.abort(); _abortCtrl = null; }
        capturedTraces = [];
        targetCurve = null;
        rtaSpectrumData = null;
        lirData = null;
        lirFrameCount = 0;
        crosshairX = -1;
        rubberBand = null;
        lockedCursorFreq = -1;
        lockedCursor2Freq = -1;
    }

    function bindSmoothing(sig) {
        var sel = _el('tf-smoothing-select');
        if (!sel) return;
        sel.addEventListener('change', function () {
            smoothing = Number(this.value);
        }, { signal: sig });
    }

    function bindCoherenceSquared(sig) {
        var chk = _el('tf-coherence-squared');
        if (!chk) return;
        chk.addEventListener('change', function () {
            coherenceSquared = this.checked;
        }, { signal: sig });
    }

    function bindBlankingThreshold(sig) {
        var slider = _el('tf-blanking-threshold');
        if (!slider) return;
        slider.addEventListener('input', function () {
            blankingThreshold = Number(this.value);
        }, { signal: sig });
    }

    let lastMagnitude = null;
    let lastPhase = null;
    let lastSampleRate = 48000;

    function autoScaleMag() {
        if (!lastMagnitude) return;
        const sr = lastSampleRate;
        const fftSize = lastMagnitude.length * 2;
        const minIdx = Math.max(0, Math.floor(zoomFreqMin * fftSize / sr));
        const maxIdx = Math.min(lastMagnitude.length - 1, Math.ceil(zoomFreqMax * fftSize / sr));
        let minVal = Infinity, maxVal = -Infinity;
        for (let i = minIdx; i <= maxIdx; i++) {
            if (isFinite(lastMagnitude[i])) {
                if (lastMagnitude[i] < minVal) minVal = lastMagnitude[i];
                if (lastMagnitude[i] > maxVal) maxVal = lastMagnitude[i];
            }
        }
        if (isFinite(minVal) && isFinite(maxVal)) {
            const range = maxVal - minVal;
            zoomMag = Math.max(6, Math.min(120, Math.ceil((range + 12) / 6) * 6));
        }
    }

    function autoScalePhase() {
        if (!lastPhase) return;
        const sr = lastSampleRate;
        const fftSize = lastPhase.length * 2;
        const minIdx = Math.max(0, Math.floor(zoomFreqMin * fftSize / sr));
        const maxIdx = Math.min(lastPhase.length - 1, Math.ceil(zoomFreqMax * fftSize / sr));
        let minVal = Infinity, maxVal = -Infinity;
        for (let i = minIdx; i <= maxIdx; i++) {
            if (isFinite(lastPhase[i])) {
                if (lastPhase[i] < minVal) minVal = lastPhase[i];
                if (lastPhase[i] > maxVal) maxVal = lastPhase[i];
            }
        }
        if (isFinite(minVal) && isFinite(maxVal)) {
            if (showGroupDelay) {
                const range = maxVal - minVal;
                zoomPhase = Math.max(5, Math.min(500, Math.ceil((range + 5) / 5) * 5));
            } else {
                const range = maxVal - minVal;
                zoomPhase = Math.max(45, Math.min(1440, Math.ceil((range + 45) / 45) * 45));
            }
        }
    }

    function bindFreqRange(sig) {
        var minEl = _el('freq-range-min');
        var maxEl = _el('freq-range-max');
        if (minEl) {
            minEl.addEventListener('change', function () {
                var v = Number(this.value);
                if (v > 0 && v < zoomFreqMax) zoomFreqMin = v;
            }, { signal: sig });
        }
        if (maxEl) {
            maxEl.addEventListener('change', function () {
                var v = Number(this.value);
                if (v > zoomFreqMin && v <= 24000) zoomFreqMax = v;
            }, { signal: sig });
        }
    }

    function bindMultiSpectrum(sig) {
        var btn = _el('btn-multispectrum');
        if (!btn) return;
        btn.addEventListener('click', function () {
            showMultiSpectrum = !showMultiSpectrum;
            if (showMultiSpectrum && window.SoundMasterAnalyzer) {
                var snap = window.SoundMasterAnalyzer.getFreqData();
                if (snap) rtaSpectrumData = snap;
            }
            btn.className = showMultiSpectrum
                ? 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                : 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-slate-700 text-slate-500 border-white/10';
            btn.title = showMultiSpectrum ? 'Ocultar RTA' : 'Sobrepor RTA';
        }, { signal: sig });
    }

    function bindAutoScale(sig) {
        var magBtn = _el('btn-autoscale-mag');
        if (magBtn) {
            magBtn.addEventListener('click', function () { window.SoundMasterVisualizer.autoScaleMag(); }, { signal: sig });
        }
        var phaseBtn = _el('btn-autoscale-phase');
        if (phaseBtn) {
            phaseBtn.addEventListener('click', function () { window.SoundMasterVisualizer.autoScalePhase(); }, { signal: sig });
        }
    }

    function _updateTraceMathSelects() {
        const selA = _el('trace-math-a');
        const selB = _el('trace-math-b');
        if (!selA && !selB) return;
        const opts = [{ idx: -1, label: 'Live' }];
        capturedTraces.forEach((t, i) => {
            opts.push({ idx: i, label: 'T' + (i + 1) + ' ' + t.timestamp });
        });
        [selA, selB].forEach((sel) => {
            if (!sel) return;
            const prevVal = sel.value;
            sel.innerHTML = '';
            opts.forEach((o) => {
                const opt = document.createElement('option');
                opt.value = String(o.idx);
                opt.textContent = o.label;
                sel.appendChild(opt);
            });
            if ([...sel.options].some(o => o.value === prevVal)) sel.value = prevVal;
        });
    }

    function applyTraceMath() {
        const op = _el('trace-math-op')?.value || 'subtract';
        const idxA = parseInt(_el('trace-math-a')?.value || '-1');
        const idxB = parseInt(_el('trace-math-b')?.value || '-1');

        const getTraceData = (idx) => {
            if (idx === -1) {
                return lastMagnitude && lastPhase ? {
                    magnitude: new Float32Array(lastMagnitude),
                    phase: unwrapPhase(lastPhase),
                    sampleRate: lastSampleRate
                } : null;
            }
            if (idx >= 0 && idx < capturedTraces.length) {
                return {
                    magnitude: new Float32Array(capturedTraces[idx].magnitude),
                    phase: new Float32Array(capturedTraces[idx].phase),
                    sampleRate: capturedTraces[idx].sampleRate
                };
            }
            return null;
        };

        const dataA = getTraceData(idxA);
        const dataB = getTraceData(idxB);
        if (!dataA || !dataB) return;

        const len = Math.min(dataA.magnitude.length, dataB.magnitude.length);
        const newMag = new Float32Array(len);
        const newPhase = new Float32Array(len);
        const newCoh = new Float32Array(len);

        for (let i = 0; i < len; i++) {
            if (op === 'subtract') {
                newMag[i] = dataA.magnitude[i] - dataB.magnitude[i];
                newPhase[i] = dataA.phase[i] - dataB.phase[i];
            } else if (op === 'normalize') {
                newMag[i] = dataA.magnitude[i] - dataB.magnitude[i];
                newPhase[i] = dataA.phase[i] - dataB.phase[i];
            } else if (op === 'average') {
                let count = 0, sumMag = 0, sumPhase = 0;
                const indices = [idxA, idxB];
                indices.forEach((idxc) => {
                    const d = getTraceData(idxc);
                    if (d && i < d.magnitude.length) {
                        sumMag += d.magnitude[i];
                        sumPhase += d.phase[i];
                        count++;
                    }
                });
                if (count > 0) {
                    newMag[i] = sumMag / count;
                    newPhase[i] = sumPhase / count;
                } else {
                    newMag[i] = dataA.magnitude[i];
                    newPhase[i] = dataA.phase[i];
                }
            }
            newCoh[i] = 100;
        }

        if (capturedTraces.length >= traceLimit) capturedTraces.shift();
        const color = traceColors[capturedTraces.length % traceColors.length];
        const opLabels = { subtract: 'Sub', normalize: 'Norm', average: 'Avg' };
        capturedTraces.push({
            magnitude: newMag,
            phase: unwrapPhase(newPhase),
            coherence: newCoh,
            sampleRate: dataA.sampleRate,
            timestamp: opLabels[op] || 'Math',
            color
        });
        _updateTraceCount();
        _updateTraceMathSelects();
    }

    function bindTraceMath(sig) {
        var btn = _el('btn-trace-math-apply');
        if (btn) btn.addEventListener('click', applyTraceMath, { signal: sig });
    }

    function bindTargetCurve(sig) {
        var btnCap = _el('btn-capture-target');
        var btnToggle = _el('btn-toggle-target');
        var btnClear = _el('btn-clear-target');
        if (btnCap) {
            btnCap.addEventListener('click', function () {
                if (window.SoundMasterAnalyzer) {
                    var snap = SoundMasterAnalyzer.getFreqData();
                    if (snap) {
                        targetCurve = { data: new Float32Array(snap.data), sampleRate: snap.sampleRate };
                        showTarget = true;
                        if (btnToggle) {
                            btnToggle.textContent = 'Ocultar';
                            btnToggle.className = 'text-[8px] px-2 py-1 bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded font-bold uppercase hover:bg-amber-500/50 transition-all';
                        }
                    }
                }
            }, { signal: sig });
        }
        if (btnToggle) {
            btnToggle.addEventListener('click', function () {
                showTarget = !showTarget;
                btnToggle.textContent = showTarget ? 'Ocultar' : 'Mostrar';
                btnToggle.className = showTarget
                    ? 'text-[8px] px-2 py-1 bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded font-bold uppercase hover:bg-amber-500/50 transition-all'
                    : 'text-[8px] px-2 py-1 bg-slate-700 text-slate-400 border border-white/10 rounded font-bold uppercase hover:bg-slate-600 transition-all';
            }, { signal: sig });
        }
        if (btnClear) {
            btnClear.addEventListener('click', function () {
                targetCurve = null;
                showTarget = false;
                if (btnToggle) {
                    btnToggle.textContent = 'Mostrar';
                    btnToggle.className = 'text-[8px] px-2 py-1 bg-slate-700 text-slate-400 border border-white/10 rounded font-bold uppercase hover:bg-slate-600 transition-all';
                }
            }, { signal: sig });
        }
    }

    function bindCoherenceToggle(sig) {
        var btn = _el('btn-toggle-coherence');
        if (!btn) return;
        btn.addEventListener('click', onCoherenceToggle, { signal: sig });
        updateCoherenceBtn(btn);
    }

    function onCoherenceToggle() {
        showCoherence = !showCoherence;
        var btn = _el('btn-toggle-coherence');
        updateCoherenceBtn(btn);
    }

    function updateCoherenceBtn(btn) {
        if (!btn) return;
        if (showCoherence) {
            btn.textContent = 'Coherence';
            btn.className = 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-red-500/20 text-red-300 border-red-500/30';
        } else {
            btn.textContent = 'Coherence';
            btn.className = 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-slate-700 text-slate-500 border-white/10';
        }
    }

    function bindPhaseToggle(sig) {
        var btn = _el('btn-toggle-phase-mode');
        if (!btn) return;
        btn.addEventListener('click', onPhaseToggle, { signal: sig });
        updatePhaseToggleBtn(btn);
    }

    function onPhaseToggle() {
        if (showGroupDelay) {
            showGroupDelay = false;
            phaseMode = 'wrapped';
        } else {
            phaseMode = phaseMode === 'wrapped' ? 'unwrapped' : 'wrapped';
        }
        zoomPhase = showGroupDelay ? 50 : 360;
        const btn = _el('btn-toggle-phase-mode');
        updatePhaseToggleBtn(btn);
        if (phaseCanvas && phaseCtx) {
            phaseCtx.clearRect(0, 0, phaseCanvas.width, phaseCanvas.height);
        }
    }

    function updatePhaseToggleBtn(btn) {
        if (!btn) return;
        if (showGroupDelay) {
            btn.textContent = 'Group Delay';
            btn.className = 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-violet-500/20 text-violet-300 border-violet-500/30';
        } else if (phaseMode === 'wrapped') {
            btn.textContent = 'Wrapped';
            btn.className = 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-amber-500/20 text-amber-300 border-amber-500/30';
        } else {
            btn.textContent = 'Unwrapped';
            btn.className = 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-slate-700 text-slate-300 border-white/20';
        }
    }

    function bindGroupDelayToggle(sig) {
        var btn = _el('btn-toggle-group-delay');
        if (!btn) return;
        btn.addEventListener('click', onGroupDelayToggle, { signal: sig });
        updateGroupDelayBtn(btn);
    }

    function onGroupDelayToggle() {
        showGroupDelay = !showGroupDelay;
        zoomPhase = showGroupDelay ? 50 : 360;
        const btn = _el('btn-toggle-group-delay');
        updateGroupDelayBtn(btn);
        const phaseBtn = _el('btn-toggle-phase-mode');
        updatePhaseToggleBtn(phaseBtn);
        const unit = _el('tf-phase-unit');
        if (unit) {
            unit.textContent = showGroupDelay ? 'ms / Hz' : 'Deg / Hz';
            unit.className = showGroupDelay
                ? 'text-[10px] font-mono text-violet-400 font-bold bg-violet-950/40 px-2 py-0.5 rounded border border-violet-500/10'
                : 'text-[10px] font-mono text-amber-400 font-bold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/10';
        }
        if (phaseCanvas && phaseCtx) {
            phaseCtx.clearRect(0, 0, phaseCanvas.width, phaseCanvas.height);
        }
    }

    function updateGroupDelayBtn(btn) {
        if (!btn) return;
        if (showGroupDelay) {
            btn.textContent = 'Group Delay';
            btn.className = 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-violet-500/20 text-violet-300 border-violet-500/30';
        } else {
            btn.textContent = 'Group Delay';
            btn.className = 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-slate-700 text-slate-500 border-white/10';
        }
    }

    function bindInteractivity(canvas, type, sig) {
        if (!canvas) return;
        var dragStart = null;
        var isDragging = false;

        canvas.addEventListener('mousedown', function (e) {
            var rect = canvas.getBoundingClientRect();
            var cx = (e.clientX - rect.left) * (canvas.width / rect.width);
            var cy = (e.clientY - rect.top) * (canvas.height / rect.height);
            dragStart = { x: cx, y: cy };
            isDragging = false;
        }, { signal: sig });

        canvas.addEventListener('mousemove', function (e) {
            var rect = canvas.getBoundingClientRect();
            var cx = (e.clientX - rect.left) * (canvas.width / rect.width);
            var cy = (e.clientY - rect.top) * (canvas.height / rect.height);
            crosshairX = cx;
            if (type === 'mag') crosshairYMag = cy;
            if (type === 'phase') crosshairYPhase = cy;

            if (dragStart) {
                var dx = cx - dragStart.x;
                var dy = cy - dragStart.y;
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                    isDragging = true;
                    rubberBand = { x1: dragStart.x, y1: dragStart.y, x2: cx, y2: cy, type: type };
                }
            }
        }, { signal: sig });

        canvas.addEventListener('mouseup', function (e) {
            if (isDragging && rubberBand) {
                var rect = canvas.getBoundingClientRect();
                var w = canvas.width;
                var h = canvas.height;
                var offX = AXIS_MARGIN_LEFT;
                var plotL = offX;
                var plotR = w;
                var plotT = 0;
                var plotB = h - AXIS_MARGIN_BOTTOM;
                var plotW = plotR - plotL;
                var plotH = plotB - plotT;

                var x1 = Math.max(plotL, Math.min(rubberBand.x1, rubberBand.x2));
                var x2 = Math.min(plotR, Math.max(rubberBand.x1, rubberBand.x2));
                var y1 = Math.min(rubberBand.y1, rubberBand.y2);
                var y2 = Math.max(rubberBand.y1, rubberBand.y2);

                if (x2 - x1 > 10 && y2 - y1 > 10) {
                    var logMin = Math.log10(minFreq);
                    var logMax = Math.log10(maxFreq);
                    var f1 = Math.pow(10, logMin + ((x1 - plotL) / plotW) * (logMax - logMin));
                    var f2 = Math.pow(10, logMin + ((x2 - plotL) / plotW) * (logMax - logMin));
                    zoomFreqMin = Math.max(minFreq, Math.min(f1, f2));
                    zoomFreqMax = Math.min(maxFreq, Math.max(f1, f2));

                    if (type === 'mag') {
                        var dbRange = ((plotT + plotH / 2 - y2) / plotH) * zoomMag * 2;
                        zoomMag = Math.max(6, Math.min(120, dbRange));
                    } else if (type === 'phase') {
                        var degRange = ((y2 - y1) / plotH) * zoomPhase;
                        zoomPhase = Math.max(45, Math.min(1440, degRange * 1.5));
                    }
                }
                rubberBand = null;
                isDragging = false;
                dragStart = null;
                canvas.style.cursor = 'crosshair';
            } else {
                dragStart = null;
                isDragging = false;
            }
        }, { signal: sig });

        canvas.addEventListener('mouseleave', function () {
            crosshairX = -1;
            crosshairYMag = -1;
            crosshairYPhase = -1;
            if (!isDragging) {
                dragStart = null;
                rubberBand = null;
            }
        }, { signal: sig });

        canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            var delta = Math.sign(e.deltaY);
            if (e.shiftKey) {
                if (delta > 0) { zoomFreqMin = Math.max(minFreq, zoomFreqMin * 1.1); zoomFreqMax = Math.min(maxFreq, zoomFreqMax * 0.9); }
                else { zoomFreqMin = Math.max(minFreq, zoomFreqMin / 1.1); zoomFreqMax = Math.min(maxFreq, zoomFreqMax / 0.9); }
                _syncFreqRangeInputs();
            } else if (type === 'mag') {
                zoomMag = Math.max(6, Math.min(120, zoomMag + delta * 5));
            } else {
                var step = showGroupDelay ? 10 : (phaseMode === 'wrapped' ? 30 : 90);
                zoomPhase = Math.max(showGroupDelay ? 5 : 180, Math.min(showGroupDelay ? 500 : 1440, zoomPhase + delta * step));
            }
        }, { signal: sig, passive: false });

        canvas.addEventListener('dblclick', function () {
            zoomFreqMin = minFreq;
            zoomFreqMax = maxFreq;
            zoomMag = 40;
            zoomPhase = showGroupDelay ? 50 : 360;
            _syncFreqRangeInputs();
        }, { signal: sig });

        canvas.addEventListener('mouseup', function () {
            _syncFreqRangeInputs();
        }, { signal: sig });

        canvas.addEventListener('click', function (e) {
            if (isDragging) return;
            if (dragStart) { dragStart = null; return; }
            var _dpr = window.devicePixelRatio || 1;
            var _w = canvas.width;
            var _rect = canvas.getBoundingClientRect();
            var _mx = (e.clientX - _rect.left) * _dpr;
            var _my = (e.clientY - _rect.top) * _dpr;
            var legendX = _w - 8 - (AXIS_MARGIN_LEFT || 0);
            var legendY = 8;
            if (_mx > legendX - 80 && _mx <= legendX + 10 && _my >= legendY && _my <= legendY + capturedTraces.length * 12) {
                var idx = Math.floor((_my - legendY) / 12);
                if (idx >= 0 && idx < capturedTraces.length) {
                    var trace = capturedTraces[idx];
                    var metaEl = _el('trace-metadata-panel');
                    if (metaEl) {
                        var elIdx = _el('meta-trace-idx');
                        if (elIdx) elIdx.textContent = 'T' + (idx + 1);
                        var elTs = _el('meta-timestamp');
                        if (elTs) elTs.textContent = trace.timestamp || '--';
                        var elSr = _el('meta-samplerate');
                        if (elSr) elSr.textContent = trace.sampleRate + ' Hz';
                        var elFft = _el('meta-fftsize');
                        if (elFft) elFft.textContent = trace.magnitude ? (trace.magnitude.length * 2) : '--';
                        var elCol = _el('meta-color');
                        if (elCol) { elCol.textContent = trace.color || '--'; elCol.style.color = trace.color || 'inherit'; }
                        metaEl.classList.remove('hidden');
                    }
                    return;
                }
            }
            if (e.shiftKey && crosshairX > 0) {
                var offX = AXIS_MARGIN_LEFT;
                var plotL = offX;
                var plotR = _w;
                var plotW = plotR - plotL;
                var xFrac = (crosshairX - plotL) / plotW;
                var logMinC = Math.log10(minFreq);
                var logMaxC = Math.log10(maxFreq);
                var freq = Math.pow(10, logMinC + xFrac * (logMaxC - logMinC));
                if (lockedCursorFreq < 0) {
                    lockedCursorFreq = freq;
                } else if (lockedCursor2Freq < 0) {
                    lockedCursor2Freq = freq;
                } else {
                    lockedCursorFreq = freq;
                    lockedCursor2Freq = -1;
                }
            }
        }, { signal: sig });
        canvas.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            lockedCursorFreq = -1;
            lockedCursor2Freq = -1;
        }, { signal: sig });
    }

    function _getActiveFolder() {
        const sel = _el('trace-folder-select');
        if (!sel) return '';
        return sel.value || '';
    }

    function _populateFolderSelect() {
        const sel = _el('trace-folder-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">— Sem pasta —</option>';
        traceFolders.forEach(function (f) {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            sel.appendChild(opt);
        });
    }

    function captureCurrentTrace(magnitude, phase, coherence, meta) {
        if (!magnitude || !phase || !coherence) return;
        if (capturedTraces.length >= traceLimit) capturedTraces.shift();
        const color = traceColors[capturedTraces.length % traceColors.length];
        capturedTraces.push({
            magnitude: new Float32Array(magnitude),
            phase: unwrapPhase(new Float32Array(phase)),
            coherence: new Float32Array(coherence),
            sampleRate: meta.sampleRate || 48000,
            timestamp: new Date().toLocaleTimeString(),
            color,
            folder: _getActiveFolder()
        });
        _updateTraceCount();
    }

    function clearTraces() {
        capturedTraces = [];
        _updateTraceCount();
    }

    function _updateTraceCount() {
        const btn = _el('btn-capture-tf');
        if (btn) btn.title = `${capturedTraces.length}/${traceLimit} traces capturados`;
        _updateTraceMathSelects();
    }

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        [magCanvas, phaseCanvas, lirCanvas].forEach(c => {
            if (!c) return;
            const cssW = c.clientWidth;
            const cssH = c.clientHeight;
            const w = Math.floor(cssW * dpr);
            const h = Math.floor(cssH * dpr);
            if (c.width !== w || c.height !== h) {
                c.width = w;
                c.height = h;
                c.style.width = cssW + 'px';
                c.style.height = cssH + 'px';
            }
        });
    }

    function freqToX(freq, width, offset) {
        const plotW = width - (offset || 0);
        const logMin = Math.log10(zoomFreqMin);
        const logMax = Math.log10(zoomFreqMax);
        const logFreq = Math.log10(Math.max(zoomFreqMin, freq));
        return (offset || 0) + ((logFreq - logMin) / (logMax - logMin)) * plotW;
    }

    function drawBackground(ctx, w, h) {
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, w, h);
    }

    function drawGrid(ctx, w, h, type, offsetX) {
        const plotL = offsetX || AXIS_MARGIN_LEFT;
        const plotR = w;
        const plotT = 0;
        const plotB = h - AXIS_MARGIN_BOTTOM;
        const plotW = plotR - plotL;
        const plotH = plotB - plotT;

        ctx.save();
        ctx.beginPath();
        ctx.rect(plotL, plotT, plotW, plotH);
        ctx.clip();

        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;

        const freqs = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
        freqs.forEach(f => {
            const x = freqToX(f, w, plotL);
            ctx.beginPath();
            ctx.moveTo(x, plotT);
            ctx.lineTo(x, plotB);
            ctx.stroke();
        });

        ctx.beginPath();
        if (type === 'magnitude') {
            const step = zoomMag > 60 ? 12 : 6;
            for (let db = -Math.floor(zoomMag / 2); db <= Math.floor(zoomMag / 2); db += step) {
                const y = plotT + plotH / 2 - (db * (plotH / zoomMag));
                ctx.moveTo(plotL, y);
                ctx.lineTo(plotR, y);
            }
            ctx.stroke();

            ctx.strokeStyle = ZERO_LINE_COLOR;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            const zeroY = plotT + plotH / 2;
            ctx.beginPath();
            ctx.moveTo(plotL, zeroY);
            ctx.lineTo(plotR, zeroY);
            ctx.stroke();
            ctx.setLineDash([]);
        } else if (type === 'groupdelay') {
            const msRange = zoomPhase;
            const step = msRange > 100 ? 20 : msRange > 50 ? 10 : 5;
            for (let ms = 0; ms <= msRange; ms += step) {
                const y = plotT + plotH - (ms / msRange) * plotH;
                ctx.moveTo(plotL, y);
                ctx.lineTo(plotR, y);
            }
            ctx.stroke();
        } else {
            let gridLines;
            if (phaseMode === 'wrapped') {
                gridLines = [-180, -90, 0, 90, 180];
            } else {
                const step = zoomPhase > 720 ? 180 : 90;
                gridLines = [];
                for (let deg = -Math.floor(zoomPhase / 2); deg <= Math.floor(zoomPhase / 2); deg += step) {
                    gridLines.push(deg);
                }
            }
            gridLines.forEach(deg => {
                const y = plotT + plotH / 2 - (deg * (plotH / zoomPhase));
                ctx.moveTo(plotL, y);
                ctx.lineTo(plotR, y);
            });
            ctx.stroke();

            const isCenter = d => (phaseMode === 'wrapped' && d === 0) || (phaseMode !== 'wrapped' && Math.abs(d) < 1);
            ctx.strokeStyle = ZERO_LINE_COLOR;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            gridLines.forEach(deg => {
                if (isCenter(deg)) {
                    const cy = plotT + plotH / 2 - (deg * (plotH / zoomPhase));
                    ctx.beginPath();
                    ctx.moveTo(plotL, cy);
                    ctx.lineTo(plotR, cy);
                    ctx.stroke();
                }
            });
            ctx.setLineDash([]);

            if (phaseMode === 'wrapped') {
                ctx.save();
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                [-180, 180].forEach(deg => {
                    const y = plotT + plotH / 2 - (deg * (plotH / zoomPhase));
                    if (y >= plotT && y <= plotB) {
                        ctx.beginPath();
                        ctx.moveTo(plotL, y);
                        ctx.lineTo(plotR, y);
                        ctx.stroke();
                    }
                });
                ctx.setLineDash([]);
                ctx.restore();
            }
        }

        ctx.restore();

        ctx.save();
        ctx.font = '8px monospace';
        ctx.fillStyle = GRID_LABEL_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        freqs.forEach(f => {
            if (f < zoomFreqMin || f > zoomFreqMax) return;
            const x = freqToX(f, w, plotL);
            if (x >= plotL && x <= plotR) {
                ctx.fillText(f >= 1000 ? `${(f/1000).toFixed(f>=10000?0:1)}k` : String(f), x, plotB + 2);
            }
        });

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        if (type === 'magnitude') {
            const step = zoomMag > 60 ? 12 : 6;
            for (let db = -Math.floor(zoomMag / 2); db <= Math.floor(zoomMag / 2); db += step) {
                const y = plotT + plotH / 2 - (db * (plotH / zoomMag));
                if (y >= plotT && y <= plotB) {
                    ctx.fillText(`${db > 0 ? '+' : ''}${db}`, plotL - 3, y);
                }
            }
        } else if (type === 'groupdelay') {
            const msRange = zoomPhase;
            const step = msRange > 100 ? 20 : msRange > 50 ? 10 : 5;
            for (let ms = 0; ms <= msRange; ms += step) {
                const y = plotT + plotH - (ms / msRange) * plotH;
                if (y >= plotT && y <= plotB) {
                    ctx.fillText(`${ms}ms`, plotL - 3, y);
                }
            }
        } else {
            let labels;
            if (phaseMode === 'wrapped') {
                labels = [-180, -90, 0, 90, 180];
            } else {
                const step = zoomPhase > 720 ? 180 : 90;
                labels = [];
                for (let deg = -Math.floor(zoomPhase / 2); deg <= Math.floor(zoomPhase / 2); deg += step) {
                    labels.push(deg);
                }
            }
            labels.forEach(deg => {
                const y = plotT + plotH / 2 - (deg * (plotH / zoomPhase));
                if (y >= plotT && y <= plotB) {
                    ctx.fillText(`${deg > 0 ? '+' : ''}${deg}°`, plotL - 3, y);
                }
            });
        }
        ctx.restore();
    }

    function drawCoherence(ctx, coherence, w, h, hzPerBin, offsetX) {
        if (!showCoherence || !coherence || coherence.length === 0) return;
        const plotL = offsetX || AXIS_MARGIN_LEFT;
        const plotR = w;
        const plotT = 0;
        const plotB = h - AXIS_MARGIN_BOTTOM;
        const plotW = plotR - plotL;
        const plotH = plotB - plotT;
        const cohBandH = plotH * 0.2;

        let cohData = coherence;
        if (coherenceSquared) {
            cohData = new Float32Array(coherence.length);
            for (let i = 0; i < coherence.length; i++) cohData[i] = (coherence[i] / 100) ** 2 * 100;
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(plotL, plotT, plotW, cohBandH);
        ctx.clip();

        ctx.fillStyle = COHERENCE_FILL;
        ctx.beginPath();
        ctx.moveTo(plotL, cohBandH);
        for (let i = 0; i < cohData.length; i++) {
            const freq = i * hzPerBin;
            if (freq < minFreq) continue;
            if (freq > maxFreq) break;
            const x = freqToX(freq, w, plotL);
            const norm = Math.max(0, Math.min(1, cohData[i] / 100));
            const y = cohBandH - norm * cohBandH;
            ctx.lineTo(x, y);
        }
        ctx.lineTo(plotR, cohBandH);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = COHERENCE_LINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < cohData.length; i++) {
            const freq = i * hzPerBin;
            if (freq < minFreq) continue;
            if (freq > maxFreq) break;
            const x = freqToX(freq, w, plotL);
            const norm = Math.max(0, Math.min(1, cohData[i] / 100));
            const y = cohBandH - norm * cohBandH;
            if (!started) { ctx.moveTo(x, y); started = true; }
            else { ctx.lineTo(x, y); }
        }
        ctx.stroke();

        ctx.restore();

        ctx.save();
        ctx.fillStyle = GRID_LABEL_COLOR;
        ctx.font = '7px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(coherenceSquared ? '100%²' : '100%', plotL + 2, 2);
        ctx.fillText('0%', plotL + 2, cohBandH - 8);
        ctx.textAlign = 'right';
        ctx.fillText('Coherence', plotR - 4, 2);
        ctx.restore();
    }

    function drawTargetCurve(ctx, w, h, offsetX) {
        if (!targetCurve || !showTarget) return;
        const plotL = offsetX || AXIS_MARGIN_LEFT;
        const plotR = w;
        const plotB = h - AXIS_MARGIN_BOTTOM;
        const plotW = plotR - plotL;
        const plotH = plotB;
        const offsetEl = _el('target-offset');
        const dbOffset = offsetEl ? Number(offsetEl.value) || 0 : 0;
        const sr = targetCurve.sampleRate || 48000;
        const hzPerBin = sr / (targetCurve.data.length * 2);

        ctx.save();
        ctx.beginPath();
        ctx.rect(plotL, 0, plotW, plotH);
        ctx.clip();

        ctx.strokeStyle = TARGET_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.shadowColor = TARGET_COLOR;
        ctx.shadowBlur = 4;

        const minDb = -120;
        const maxDb = -10;
        const dbRange = maxDb - minDb;

        ctx.beginPath();
        let started = false;
        for (let i = 0; i < targetCurve.data.length; i++) {
            const freq = i * hzPerBin;
            if (freq < minFreq) continue;
            if (freq > maxFreq) break;
            const x = freqToX(freq, w, plotL);
            const dbVal = Math.max(minDb, Math.min(maxDb, targetCurve.data[i] + dbOffset));
            const normalized = Math.max(0, Math.min(1, (dbVal - minDb) / dbRange));
            const y = plotH - normalized * plotH;
            if (!started) { ctx.moveTo(x, y); started = true; }
            else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);

        ctx.fillStyle = TARGET_COLOR;
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Target', plotL + 4, 4);

        ctx.restore();
    }

    function drawTraceLine(ctx, data, w, h, type, hzPerBin, color, isLive, offsetX) {
        if (!data || data.length === 0) return;
        const plotL = offsetX || AXIS_MARGIN_LEFT;
        const plotR = w;
        const plotT = 0;
        const plotB = h - AXIS_MARGIN_BOTTOM;
        const plotW = plotR - plotL;
        const plotH = plotB - plotT;

        let plotData = data;
        if (isLive && smoothing > 0) {
            plotData = fractionalOctaveSmoothing(data, hzPerBin * data.length * 2, smoothing);
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(plotL, plotT, plotW, plotH);
        ctx.clip();

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = isLive ? 2 : 1;
        ctx.setLineDash(isLive ? [] : [4, 4]);
        ctx.globalAlpha = isLive ? 1 : 0.5;

        if (isLive) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 3;
        }

        let started = false;
        for (let i = 0; i < plotData.length; i++) {
            const freq = i * hzPerBin;
            if (freq < minFreq) continue;
            if (freq > maxFreq) break;
            const x = freqToX(freq, w, plotL);
            let val = plotData[i];
            if (type === 'phase') val *= 180 / Math.PI;
            const y = type === 'magnitude'
                ? plotT + plotH / 2 - (plotData[i] * (plotH / zoomMag))
                : type === 'groupdelay'
                    ? plotT + plotH - (Math.max(0, val) * (plotH / zoomPhase))
                    : plotT + plotH / 2 - (val * (plotH / zoomPhase));
            if (!Number.isFinite(y)) continue;
            if (!started) { ctx.moveTo(x, y); started = true; }
            else { ctx.lineTo(x, y); }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);
        ctx.restore();
    }

    function drawTraceLegend(ctx, w, offsetX) {
        if (capturedTraces.length === 0) return;
        ctx.save();
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        // Group by folder
        var folderGroups = {};
        capturedTraces.forEach(function (trace, idx) {
            var f = trace.folder || '';
            if (!folderGroups[f]) folderGroups[f] = [];
            folderGroups[f].push({ trace: trace, idx: idx });
        });
        var lineY = 8;
        Object.keys(folderGroups).sort(function (a, b) {
            if (a === '' && b !== '') return 1;
            if (b === '' && a !== '') return -1;
            return 0;
        }).forEach(function (folder) {
            if (folder) {
                ctx.globalAlpha = 0.45;
                ctx.fillStyle = '#64748b';
                ctx.font = '7px monospace';
                ctx.fillText('[' + folder + ']', w - 8, lineY);
                lineY += 10;
                ctx.font = '9px monospace';
            }
            folderGroups[folder].forEach(function (entry) {
                ctx.globalAlpha = 0.78;
                ctx.fillStyle = entry.trace.color;
                ctx.fillText('T' + (entry.idx + 1) + ' ' + entry.trace.timestamp, w - 8, lineY);
                lineY += 12;
            });
        });
        ctx.restore();
    }

    function _drawLir(ctx, irData, sampleRate) {
        if (!ctx || !irData || irData.length < 4) return;
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const dpr = window.devicePixelRatio || 1;
        const axisL = 40 * dpr;
        const axisB = 18 * dpr;
        const plotT = 6 * dpr;
        const plotW = w - axisL;
        const plotH = h - axisB - plotT;
        if (plotW <= 0 || plotH <= 0) return;

        const irLen = irData.length;
        const timeMax = (irLen / sampleRate) * 1000;
        const viewMs = Math.min(lirTimeMs, timeMax);
        const viewSamples = Math.floor((viewMs / 1000) * sampleRate);
        const viewLen = Math.min(viewSamples, irLen);

        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.beginPath();
        ctx.rect(axisL, plotT, plotW, plotH);
        ctx.clip();

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
        ctx.lineWidth = 1;
        const tStep = viewMs > 100 ? 20 : viewMs > 50 ? 10 : viewMs > 20 ? 5 : 2;
        for (let t = tStep; t < viewMs; t += tStep) {
            const x = axisL + (t / viewMs) * plotW;
            ctx.beginPath();
            ctx.moveTo(x, plotT);
            ctx.lineTo(x, plotT + plotH);
            ctx.stroke();
        }

        let peakVal = 0;
        let peakIdx = 0;
        for (let i = 0; i < viewLen; i++) {
            const absVal = Math.abs(irData[i]);
            if (absVal > peakVal) { peakVal = absVal; peakIdx = i; }
        }

        if (lirViewType === 'lin') {
            const ampMax = Math.max(0.01, peakVal * 1.1);
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let i = 0; i < viewLen; i++) {
                const x = axisL + (i / viewLen) * plotW;
                const y = plotT + plotH / 2 - (irData[i] / ampMax) * (plotH / 2);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();

            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(axisL, plotT + plotH / 2);
            ctx.lineTo(w, plotT + plotH / 2);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = 'rgba(148,163,184,0.5)';
            ctx.font = `${Math.max(6, Math.round(7 * dpr))}px monospace`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', axisL - 3, plotT + 2);
            ctx.fillText('0', axisL - 3, plotT + plotH / 2);
            ctx.fillText('-', axisL - 3, plotT + plotH - 2);
        } else {
            const minDb = -60;
            const maxDb = 0;
            const dbRange = maxDb - minDb;
            const irDb = new Float32Array(viewLen);
            for (let i = 0; i < viewLen; i++) {
                const env = Math.abs(irData[i]);
                irDb[i] = env > 1e-12 ? 20 * Math.log10(env / peakVal) : minDb;
            }
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 1.5;
            ctx.shadowColor = '#22d3ee';
            ctx.shadowBlur = 3;
            ctx.beginPath();
            for (let i = 0; i < viewLen; i++) {
                const x = axisL + (i / viewLen) * plotW;
                const db = Math.max(minDb, Math.min(maxDb, irDb[i]));
                const y = plotT + plotH - ((db - minDb) / dbRange) * plotH;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            const dbStep = 10;
            ctx.strokeStyle = 'rgba(148,163,184,0.06)';
            ctx.lineWidth = 1;
            for (let db = Math.ceil(minDb / dbStep) * dbStep; db <= maxDb; db += dbStep) {
                const y = plotT + plotH - ((db - minDb) / dbRange) * plotH;
                ctx.beginPath();
                ctx.moveTo(axisL, y);
                ctx.lineTo(w, y);
                ctx.stroke();
            }

            ctx.fillStyle = 'rgba(148,163,184,0.5)';
            ctx.font = `${Math.max(6, Math.round(7 * dpr))}px monospace`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            for (let db = Math.ceil(minDb / dbStep) * dbStep; db <= maxDb; db += dbStep) {
                const y = plotT + plotH - ((db - minDb) / dbRange) * plotH;
                ctx.fillText(`${db}dB`, axisL - 3, y);
            }

            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(axisL, plotT + plotH);
            ctx.lineTo(w, plotT + plotH);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        const peakTimeMs = (peakIdx / sampleRate) * 1000;
        const peakDbVal = peakVal > 1e-12 ? 20 * Math.log10(Math.abs(irData[peakIdx]) / 1e-12) : -100;
        const peakInfo = _el('lir-peak-info');
        if (peakInfo) {
            peakInfo.textContent = `Pico: ${peakDbVal.toFixed(1)} dBFS | t: ${peakTimeMs.toFixed(2)} ms`;
        }

        ctx.restore();

        ctx.save();
        ctx.fillStyle = 'rgba(148,163,184,0.5)';
        ctx.font = `${Math.max(6, Math.round(7 * dpr))}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const tStep2 = viewMs > 100 ? 20 : viewMs > 50 ? 10 : viewMs > 20 ? 5 : 2;
        for (let t = tStep2; t < viewMs; t += tStep2) {
            const x = axisL + (t / viewMs) * plotW;
            ctx.fillText(`${t.toFixed(t < 1 ? 2 : 0)}ms`, x, plotT + plotH + 2);
        }
        ctx.restore();
    }

    function exportIrWav() {
        if (!lirData || !lirData.ir || lirData.ir.length < 4) return;
        const ir = lirData.ir;
        const sr = lirData.sampleRate;
        const numSamples = ir.length;
        const numChannels = 1;
        const bitsPerSample = 32;
        const byteRate = sr * numChannels * (bitsPerSample / 8);
        const dataSize = numSamples * numChannels * (bitsPerSample / 8);
        const buf = new ArrayBuffer(44 + dataSize);
        const dv = new DataView(buf);

        const writeStr = (off, str) => {
            for (let i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i));
        };
        writeStr(0, 'RIFF');
        dv.setUint32(4, 36 + dataSize, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        dv.setUint32(16, 16, true);
        dv.setUint16(20, 3, true); // IEEE float
        dv.setUint16(22, numChannels, true);
        dv.setUint32(24, sr, true);
        dv.setUint32(28, byteRate, true);
        dv.setUint16(32, numChannels * (bitsPerSample / 8), true);
        dv.setUint16(34, bitsPerSample, true);
        writeStr(36, 'data');
        dv.setUint32(40, dataSize, true);

        for (let i = 0; i < numSamples; i++) {
            const offset = 44 + i * 4;
            dv.setFloat32(offset, ir[i], true);
        }

        const blob = new Blob([buf], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'lir-' + new Date().toISOString().slice(0, 19).replace(/[:]/g, '-') + '.wav';
        a.click();
        URL.revokeObjectURL(url);
    }

    function bindLirToggle(sig) {
        var btn = _el('btn-toggle-lir');
        var section = _el('lir-section');
        if (!btn || !section) return;
        btn.addEventListener('click', function () {
            lirVisible = !lirVisible;
            section.classList.toggle('hidden', !lirVisible);
            btn.className = lirVisible
                ? 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-violet-500/20 text-violet-300 border-violet-500/30'
                : 'text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-all cursor-pointer bg-slate-700 text-slate-500 border-white/10';
        }, { signal: sig });
        var viewSel = _el('lir-view-type');
        if (viewSel) {
            viewSel.addEventListener('change', function () { lirViewType = this.value; }, { signal: sig });
        }
        var timeSel = _el('lir-time-range');
        if (timeSel) {
            timeSel.addEventListener('change', function () { lirTimeMs = Number(this.value); }, { signal: sig });
        }
        var wavBtn = _el('btn-export-ir-wav');
        if (wavBtn) {
            wavBtn.addEventListener('click', exportIrWav, { signal: sig });
        }
    }

    function drawCrosshair(ctx, yPos, type, color, scaleRange, w, h, offsetX) {
        if (crosshairX <= 0) return;
        const plotL = offsetX || AXIS_MARGIN_LEFT;
        const plotR = w;
        const plotT = 0;
        const plotB = h - AXIS_MARGIN_BOTTOM;
        const plotW = plotR - plotL;

        ctx.save();
        ctx.beginPath();
        ctx.rect(plotL, plotT, plotW, plotB - plotT);
        ctx.clip();

        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(crosshairX, plotT);
        ctx.lineTo(crosshairX, plotB);
        ctx.stroke();

        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const xPercent = (crosshairX - plotL) / plotW;
        const freqAtCursor = Math.pow(10, logMin + xPercent * (logMax - logMin));

        let valStr = '';
        if (yPos > 0) {
            ctx.beginPath();
            ctx.moveTo(plotL, yPos);
            ctx.lineTo(plotR, yPos);
            ctx.stroke();
            const val = type === 'groupdelay'
                ? ((plotB - yPos) / (plotB - plotT)) * scaleRange
                : ((plotT + (plotB - plotT) / 2 - yPos) / (plotB - plotT)) * scaleRange;
            valStr = type === 'mag' ? ` | ${val.toFixed(1)} dB` : type === 'groupdelay' ? ` | ${val.toFixed(2)}ms` : ` | ${val.toFixed(1)}°`;
        }

        ctx.setLineDash([]);
        ctx.restore();

        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        const labelW = 110;
        const labelX = Math.min(crosshairX + 8, w - labelW - 4);
        ctx.fillRect(labelX, 5, labelW, 16);
        ctx.fillStyle = color;
        ctx.font = '10px monospace';
        ctx.fillText(`${Math.round(freqAtCursor)}Hz${valStr}`, labelX + 4, 16);
        ctx.restore();
    }

    function drawTransferFunction(magnitude, phase, coherence, meta) {
        magCanvas = _el('tf-magnitude-canvas');
        phaseCanvas = _el('tf-phase-canvas');
        if (!magCanvas || !phaseCanvas) return;
        magCtx = magCanvas.getContext('2d');
        phaseCtx = phaseCanvas.getContext('2d');
        if (!magCtx || !phaseCtx || !magnitude || !phase) return;

        const w = magCanvas.width;
        const h = magCanvas.height;
        const pw = phaseCanvas.width;
        const ph = phaseCanvas.height;
        const sampleRate = meta.sampleRate || 48000;
        lastMagnitude = magnitude;
        lastPhase = phase;
        lastSampleRate = sampleRate;
        const hzPerBin = sampleRate / (magnitude.length * 2);
        const phHzPerBin = sampleRate / (phase.length * 2);
        const offX = AXIS_MARGIN_LEFT;

        drawBackground(magCtx, w, h);
        drawBackground(phaseCtx, pw, ph);

        drawGrid(magCtx, w, h, 'magnitude', offX);
        drawGrid(phaseCtx, pw, ph, showGroupDelay ? 'groupdelay' : 'phase', offX);

        if (coherence) {
            drawCoherence(magCtx, coherence, w, h, hzPerBin, offX);
        }

        drawTargetCurve(magCtx, w, h, offX);

        if (showMultiSpectrum) {
            if (!rtaSpectrumData || lirFrameCount === 0) {
                const snap = window.SoundMasterAnalyzer && window.SoundMasterAnalyzer.getFreqData && window.SoundMasterAnalyzer.getFreqData();
                if (snap) rtaSpectrumData = snap;
            }
        }
        if (showMultiSpectrum && rtaSpectrumData && rtaSpectrumData.data) {
            const rtaHz = rtaSpectrumData.sampleRate / (rtaSpectrumData.data.length * 2);
            drawTraceLine(magCtx, rtaSpectrumData.data, w, h, 'magnitude', rtaHz, 'rgba(74, 222, 128, 0.5)', false, offX);
            magCtx.save();
            magCtx.fillStyle = 'rgba(74, 222, 128, 0.6)';
            magCtx.font = '8px monospace';
            magCtx.textAlign = 'left';
            magCtx.textBaseline = 'bottom';
            magCtx.fillText('RTA', offX + 4, h - AXIS_MARGIN_BOTTOM - 2);
            magCtx.restore();
        }

        capturedTraces.forEach((trace) => {
            const tHz = trace.sampleRate / (trace.magnitude.length * 2);
            drawTraceLine(magCtx, trace.magnitude, w, h, 'magnitude', tHz, trace.color, false, offX);
            if (showGroupDelay) {
                const gd = computeGroupDelay(trace.phase, trace.sampleRate, trace.magnitude.length * 2);
                drawTraceLine(phaseCtx, gd, pw, ph, 'groupdelay', tHz, trace.color, false, offX);
            } else {
                const tPhase = phaseMode === 'wrapped' ? wrapPhase(trace.phase) : trace.phase;
                drawTraceLine(phaseCtx, tPhase, pw, ph, 'phase', tHz, trace.color, false, offX);
            }
        });

        let magData = magnitude;
        if (smoothing > 0) {
            magData = fractionalOctaveSmoothing(magnitude, sampleRate, smoothing);
        }
        let phaseData = phase;
        if (smoothing > 0) {
            phaseData = fractionalOctaveSmoothing(phase, sampleRate, smoothing);
        }

        drawTraceLine(magCtx, magData, w, h, 'magnitude', hzPerBin, '#22d3ee', true, offX);
        const livePhase = phaseMode === 'wrapped' ? wrapPhase(phaseData) : unwrapPhase(phaseData);
        if (showGroupDelay) {
            const gd = computeGroupDelay(unwrapPhase(phaseData), sampleRate, phase.length * 2);
            drawTraceLine(phaseCtx, gd, pw, ph, 'groupdelay', phHzPerBin, '#a855f7', true, offX);
        } else {
            drawTraceLine(phaseCtx, livePhase, pw, ph, 'phase', phHzPerBin, '#a855f7', true, offX);
        }

        function _drawLockedCursor(ctx, freq, color, label, w2, h2, offX2) {
            if (freq <= 0) return;
            const plotL2 = offX2 || AXIS_MARGIN_LEFT;
            const plotR2 = w2;
            const plotB2 = h2 - AXIS_MARGIN_BOTTOM;
            const plotW2 = plotR2 - plotL2;
            const x = freqToX(freq, w2, plotL2);
            if (x < plotL2 || x > plotR2) return;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, plotB2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = color;
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(label + ' ' + Math.round(freq) + 'Hz', x, plotB2 - 2);
            ctx.restore();
        }

        _drawLockedCursor(magCtx, lockedCursorFreq, 'rgba(255,255,255,0.6)', 'L1', w, h, offX);
        _drawLockedCursor(phaseCtx, lockedCursorFreq, 'rgba(255,255,255,0.6)', 'L1', pw, ph, offX);
        if (lockedCursor2Freq > 0) {
            _drawLockedCursor(magCtx, lockedCursor2Freq, 'rgba(251, 191, 36, 0.6)', 'L2', w, h, offX);
            _drawLockedCursor(phaseCtx, lockedCursor2Freq, 'rgba(251, 191, 36, 0.6)', 'L2', pw, ph, offX);
        }

        if (rubberBand) {
            const rCtx = rubberBand.type === 'mag' ? magCtx : phaseCtx;
            const rW = rubberBand.type === 'mag' ? w : pw;
            const rH = rubberBand.type === 'mag' ? h : ph;
            rCtx.save();
            rCtx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            rCtx.lineWidth = 1;
            rCtx.setLineDash([4, 4]);
            const rx = Math.min(rubberBand.x1, rubberBand.x2);
            const ry = Math.min(rubberBand.y1, rubberBand.y2);
            const rw = Math.abs(rubberBand.x2 - rubberBand.x1);
            const rh = Math.abs(rubberBand.y2 - rubberBand.y1);
            rCtx.strokeRect(rx, ry, rw, rh);
            rCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            rCtx.fillRect(rx, ry, rw, rh);
            rCtx.setLineDash([]);
            rCtx.restore();
        }

        _lastPolarityCheck++;
        if (_lastPolarityCheck % 15 === 0 && phase && phase.length > 10) {
            const polEl = _el('polarity-indicator');
            if (polEl) {
                const idx100 = Math.round(100 * phase.length * 2 / sampleRate);
                const idx1k = Math.round(1000 * phase.length * 2 / sampleRate);
                if (idx100 > 0 && idx100 < phase.length && idx1k > 0 && idx1k < phase.length) {
                    const phase100 = phase[idx100] * (180 / Math.PI);
                    const phase1k = phase[idx1k] * (180 / Math.PI);
                    const diff = Math.abs(phase100 - phase1k);
                    if (diff < 30) {
                        if (Math.abs(phase100) > 150) {
                            polEl.textContent = 'Polarity: INVERTED';
                            polEl.className = 'ml-auto text-[9px] font-mono font-bold px-2 py-0.5 rounded border bg-red-900/30 text-red-400 border-red-500/30';
                        } else {
                            polEl.textContent = 'Polarity: Normal';
                            polEl.className = 'ml-auto text-[9px] font-mono font-bold px-2 py-0.5 rounded border bg-green-900/30 text-green-400 border-green-500/30';
                        }
                    } else {
                        polEl.textContent = 'Polarity: ---';
                        polEl.className = 'ml-auto text-[9px] font-mono font-bold px-2 py-0.5 rounded border bg-slate-800 text-slate-600 border-white/10';
                    }
                }
            }
        }

        drawTraceLegend(phaseCtx, pw, offX);
        drawCrosshair(magCtx, crosshairYMag, 'mag', '#22d3ee', zoomMag, w, h, offX);
        drawCrosshair(phaseCtx, crosshairYPhase, showGroupDelay ? 'groupdelay' : 'phase', '#a855f7', zoomPhase, pw, ph, offX);

        if (lirVisible) {
            lirCanvas = _el('lir-canvas');
            if (lirCanvas) lirCtx = lirCanvas.getContext('2d');
        }
        if (lirVisible && lirCtx && lirCanvas) {
            const lirDpr = window.devicePixelRatio || 1;
            if (lirCanvas.clientWidth > 0 && lirCanvas.clientHeight > 0) {
                const lirW = Math.floor(lirCanvas.clientWidth * lirDpr);
                const lirH = Math.floor(lirCanvas.clientHeight * lirDpr);
                if (lirCanvas.width !== lirW || lirCanvas.height !== lirH) {
                    lirCanvas.width = lirW;
                    lirCanvas.height = lirH;
                }
                lirFrameCount = (lirFrameCount + 1) % 15;
                if (lirFrameCount === 0 || !lirData) {
                    lirData = computeImpulseResponse(magnitude, unwrapPhase(phase), sampleRate);
                }
                _drawLir(lirCtx, lirData.ir, lirData.sampleRate);
            }
        }
    }

    function _populatePresetList() {
        const sel = _el('preset-list');
        if (!sel) return;
        let presets = {};
        try { presets = JSON.parse(localStorage.getItem('sm_plot_presets') || '{}'); } catch (e) {}
        sel.innerHTML = '<option value="">— selecione um preset —</option>';
        Object.keys(presets).forEach(function (name) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
    }

    function bindPlotPresets(sig) {
        _populatePresetList();
        var btnSave = _el('btn-preset-save');
        var btnLoad = _el('btn-preset-load');
        var btnDel = _el('btn-preset-delete');
        if (btnSave) {
            btnSave.addEventListener('click', function () {
                var name = (_el('preset-name') ? _el('preset-name').value : '').trim();
                if (!name) return;
                var state = {
                    zoomFreqMin: zoomFreqMin, zoomFreqMax: zoomFreqMax, zoomMag: zoomMag, zoomPhase: zoomPhase,
                    showGroupDelay: showGroupDelay, showCoherence: showCoherence, showMultiSpectrum: showMultiSpectrum, phaseMode: phaseMode,
                    smoothing: smoothing, coherenceSquared: coherenceSquared, blankingThreshold: blankingThreshold
                };
                var presets = {};
                try { presets = JSON.parse(localStorage.getItem('sm_plot_presets') || '{}'); } catch (e) {}
                presets[name] = state;
                localStorage.setItem('sm_plot_presets', JSON.stringify(presets));
                _populatePresetList();
                var pn = _el('preset-name');
                if (pn) pn.value = '';
            }, { signal: sig });
        }
        if (btnLoad) {
            btnLoad.addEventListener('click', function () {
                var sel = _el('preset-list');
                if (!sel || !sel.value) return;
                var presets = {};
                try { presets = JSON.parse(localStorage.getItem('sm_plot_presets') || '{}'); } catch (e) {}
                var state = presets[sel.value];
                if (!state) return;
                zoomFreqMin = state.zoomFreqMin || minFreq;
                zoomFreqMax = state.zoomFreqMax || maxFreq;
                zoomMag = state.zoomMag || 40;
                zoomPhase = state.zoomPhase || 360;
                _syncFreqRangeInputs();
                if (window.SoundMasterVisualizer) {
                    if (state.showGroupDelay !== undefined) window.SoundMasterVisualizer.setShowGroupDelay(state.showGroupDelay);
                    if (state.showCoherence !== undefined) window.SoundMasterVisualizer.setShowCoherence(state.showCoherence);
                    if (state.phaseMode !== undefined) window.SoundMasterVisualizer.setPhaseMode(state.phaseMode);
                }
                showMultiSpectrum = state.showMultiSpectrum || false;
                smoothing = state.smoothing || 0;
                coherenceSquared = state.coherenceSquared || false;
                blankingThreshold = state.blankingThreshold || 20;
                var smoothSel = _el('tf-smoothing-select');
                if (smoothSel) smoothSel.value = String(smoothing);
                var cohChk = _el('tf-coherence-squared');
                if (cohChk) cohChk.checked = coherenceSquared;
                var blankSlider = _el('tf-blanking-threshold');
                if (blankSlider) blankSlider.value = String(blankingThreshold);
            }, { signal: sig });
        }
        if (btnDel) {
            btnDel.addEventListener('click', function () {
                var sel = _el('preset-list');
                if (!sel || !sel.value) return;
                var presets = {};
                try { presets = JSON.parse(localStorage.getItem('sm_plot_presets') || '{}'); } catch (e) {}
                delete presets[sel.value];
                localStorage.setItem('sm_plot_presets', JSON.stringify(presets));
                _populatePresetList();
            }, { signal: sig });
        }
    }

    function bindTraceFolders(sig) {
        _populateFolderSelect();
        var btnCreate = _el('btn-folder-create');
        var btnDelete = _el('btn-folder-delete');
        if (btnCreate) {
            btnCreate.addEventListener('click', function () {
                var name = (_el('trace-folder-name') ? _el('trace-folder-name').value : '').trim();
                if (!name) return;
                if (traceFolders.indexOf(name) === -1) {
                    traceFolders.push(name);
                    _populateFolderSelect();
                    var tfn = _el('trace-folder-name');
                    if (tfn) tfn.value = '';
                }
            }, { signal: sig });
        }
        if (btnDelete) {
            btnDelete.addEventListener('click', function () {
                var sel = _el('trace-folder-select');
                if (!sel || !sel.value) return;
                var idx = traceFolders.indexOf(sel.value);
                if (idx >= 0) traceFolders.splice(idx, 1);
                capturedTraces.forEach(function (t) {
                    if (t.folder === sel.value) t.folder = '';
                });
                _populateFolderSelect();
            }, { signal: sig });
        }
    }

    function bindHotkeys(sig) {
        document.addEventListener('keydown', function (e) {
            var tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            var key = e.key.toLowerCase();
            var shift = e.shiftKey;

            if (key === 'c') {
                e.preventDefault();
                if (shift) {
                    var btn = _el('btn-capture-all-tf');
                    if (btn) btn.click();
                } else {
                    var btn = _el('btn-capture-tf');
                    if (btn) btn.click();
                }
            } else if (key === 'r') {
                e.preventDefault();
                var mag = _el('tf-magnitude-canvas');
                if (mag) mag.dispatchEvent(new MouseEvent('dblclick'));
            } else if (key === 'g') {
                e.preventDefault();
                var btn = _el('btn-toggle-group-delay');
                if (btn) btn.click();
            } else if (key === 'l') {
                e.preventDefault();
                var btn = _el('btn-toggle-lir');
                if (btn) btn.click();
            } else if (key === 'w') {
                e.preventDefault();
                var btn = _el('btn-toggle-phase-mode');
                if (btn) btn.click();
            } else if (key === 'z') {
                e.preventDefault();
                var magBtn = _el('btn-autoscale-mag');
                if (magBtn) magBtn.click();
                var phaseBtn = _el('btn-autoscale-phase');
                if (phaseBtn) phaseBtn.click();
            } else if (key === 'm') {
                e.preventDefault();
                var btn = _el('btn-multispectrum');
                if (btn) btn.click();
            } else if (key === 'arrowleft' || key === 'arrowright') {
                e.preventDefault();
                var dir = key === 'arrowright' ? 1 : -1;
                var shiftF = shift ? 0.3 : 0.08;
                var bw = zoomFreqMax - zoomFreqMin;
                var step = bw * shiftF;
                var newMin = Math.max(minFreq, zoomFreqMin + step * dir);
                var newMax = newMin + bw;
                if (newMax <= maxFreq && newMin >= minFreq) {
                    zoomFreqMin = newMin;
                    zoomFreqMax = newMax;
                    _syncFreqRangeInputs();
                }
            } else if (key === 'arrowup' || key === 'arrowdown') {
                e.preventDefault();
                var factor = key === 'arrowup' ? 0.85 : 1.18;
                var magEl = _el('tf-magnitude-canvas');
                if (magEl) {
                    zoomMag = Math.max(6, Math.min(200, zoomMag * factor));
                }
                var phaseEl = _el('tf-phase-canvas');
                if (phaseEl) {
                    zoomPhase = Math.max(showGroupDelay ? 5 : 45, Math.min(showGroupDelay ? 500 : 3600, zoomPhase * factor));
                }
            } else if (key === 'escape') {
                e.preventDefault();
                if (lockedCursorFreq >= 0 || lockedCursor2Freq >= 0) {
                    lockedCursorFreq = -1;
                    lockedCursor2Freq = -1;
                }
            }
        }, { signal: sig });
    }

    function _syncFreqRangeInputs() {
        const minEl = _el('freq-range-min');
        const maxEl = _el('freq-range-max');
        if (minEl) minEl.value = String(Math.round(zoomFreqMin));
        if (maxEl) maxEl.value = String(Math.round(zoomFreqMax));
    }

    window.SoundMasterVisualizer = {
        init,
        destroy,
        drawTransferFunction,
        captureCurrentTrace,
        clearTraces,
        unwrapPhase,
        wrapPhase,
        fractionalOctaveSmoothing,
        computeGroupDelay,
        getPhaseMode: () => phaseMode,
        setPhaseMode: (mode) => {
            if (mode === 'wrapped' || mode === 'unwrapped') {
                phaseMode = mode;
                zoomPhase = 360;
                const btn = _el('btn-toggle-phase-mode');
                updatePhaseToggleBtn(btn);
            }
        },
        getShowGroupDelay: () => showGroupDelay,
        autoScaleMag,
        autoScalePhase,
        setShowGroupDelay: (v) => {
            showGroupDelay = !!v;
            zoomPhase = showGroupDelay ? 50 : 360;
            const btn = _el('btn-toggle-group-delay');
            updateGroupDelayBtn(btn);
            const phaseBtn = _el('btn-toggle-phase-mode');
            updatePhaseToggleBtn(phaseBtn);
            const unit = _el('tf-phase-unit');
            if (unit) {
                unit.textContent = showGroupDelay ? 'ms / Hz' : 'Deg / Hz';
                unit.className = showGroupDelay
                    ? 'text-[10px] font-mono text-violet-400 font-bold bg-violet-950/40 px-2 py-0.5 rounded border border-violet-500/10'
                    : 'text-[10px] font-mono text-amber-400 font-bold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/10';
            }
        },
        setShowCoherence: (v) => { showCoherence = !!v; },
        getTargetCurve: () => targetCurve,
        setTargetCurve: (tc) => { targetCurve = tc; },
        getLirData: () => lirData
    };
})();