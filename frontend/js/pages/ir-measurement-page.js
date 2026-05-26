(function () {
    'use strict';
    var pm = createPageModule();
    var _capturedIR = null;
    var _inverseFilter = null;

    function _gotoStep(n) {
        for (var i = 1; i <= 3; i++) {
            var p = pm._el('ir-panel-' + i);
            if (p) p.classList.toggle('hidden', i !== n);
            var s = pm._el('ir-step-' + i);
            if (s) { s.classList.remove('bg-purple-500', 'bg-slate-700'); s.classList.add(i <= n ? 'bg-purple-500' : 'bg-slate-700'); }
        }
    }

    function _drawWaveform(canvas, data) {
        if (!canvas || !data) return;
        canvas.width = canvas.parentElement.clientWidth * (window.devicePixelRatio || 1);
        canvas.height = canvas.parentElement.clientHeight * (window.devicePixelRatio || 1);
        var ctx = canvas.getContext('2d');
        var w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        var step = Math.max(1, Math.floor(data.length / w));
        for (var x = 0; x < w; x++) {
            var idx = Math.min(Math.floor(x * data.length / w), data.length - 1);
            var val = data[idx];
            var y = h / 2 - (val * h / 2);
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    function _drawETC(canvas, ir) {
        if (!canvas || !ir) return;
        var rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * (window.devicePixelRatio || 1);
        canvas.height = rect.height * (window.devicePixelRatio || 1);
        var ctx = canvas.getContext('2d');
        var w = canvas.width, h = canvas.height;

        var etc = new Float32Array(ir.length);
        for (var i = 0; i < ir.length; i++) etc[i] = 20 * Math.log10(Math.abs(ir[i]) + 1e-10);

        var maxDb = -Infinity;
        for (var i = 0; i < etc.length; i++) if (etc[i] > maxDb) maxDb = etc[i];
        var minDb = maxDb - 60;

        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        var len = Math.min(etc.length, Math.round(w * 3));
        for (var x = 0; x < w; x++) {
            var idx = Math.min(Math.floor(x * len / w), etc.length - 1);
            var norm = (etc[idx] - minDb) / (maxDb - minDb);
            var y = h - Math.max(0, Math.min(h, norm * h));
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        for (var t = 0; t <= 100; t += 20) {
            var label = t + 'ms';
            var xPos = Math.floor(t / 2.5);
            ctx.fillText(label, xPos, h - 3);
        }
    }

    function _drawDecay(canvas, ir, sampleRate) {
        if (!canvas || !ir) return;
        var rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * (window.devicePixelRatio || 1);
        canvas.height = rect.height * (window.devicePixelRatio || 1);
        var ctx = canvas.getContext('2d');
        var w = canvas.width, h = canvas.height;

        var fftSize = 512;
        var hopSize = Math.floor(ir.length / 120);
        var freqBands = [125, 250, 500, 1000, 2000, 4000, 8000];
        var colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7'];

        ctx.clearRect(0, 0, w, h);
        var bandColors = {};
        freqBands.forEach(function (f, i) {
            var bin = Math.round(f * fftSize / (sampleRate || 48000));
            var envelope = [];
            for (var t = 0; t < ir.length; t += hopSize) {
                var e = 0;
                for (var s = 0; s < fftSize && t + s < ir.length; s++) {
                    e += ir[t + s] * ir[t + s];
                }
                envelope.push(20 * Math.log10(Math.sqrt(e / fftSize) + 1e-10));
            }
            var maxEnv = Math.max.apply(null, envelope);
            ctx.strokeStyle = colors[i % colors.length];
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (var x = 0; x < w; x++) {
                var idx = Math.min(Math.floor(x * envelope.length / w), envelope.length - 1);
                var norm = envelope[idx] - maxEnv + 40;
                var y = h - Math.max(0, Math.min(h, (norm / 40) * h));
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        });
    }

    function _captureIR() {
        var tfData = null;
        if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.getTransferFunctionData === 'function') {
            tfData = window.SoundMasterAnalyzer.getTransferFunctionData();
        }
        if (!tfData || !tfData.lir) {
            var status = pm._el('ir-status');
            if (status) { status.textContent = '❌ Ative o TF no Analyzer'; status.style.color = '#ef4444'; }
            return;
        }
        _capturedIR = new Float32Array(tfData.lir);
        var status = pm._el('ir-status');
        if (status) { status.textContent = _capturedIR.length + ' samples ✓'; status.style.color = '#22c55e'; }

        _drawWaveform(pm._el('ir-wave-canvas'), _capturedIR);

        var btn = pm._el('ir-next-1');
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
    }

    function _generateInverse() {
        if (!_capturedIR) return;
        var method = pm._el('ir-inverse-method') ? pm._el('ir-inverse-method').value : 'minimum-phase';
        var status = pm._el('ir-generate-status');
        if (status) status.textContent = 'Gerando...';

        setTimeout(function () {
            if (window.FIRConvolution && typeof window.FIRConvolution.generateInverse === 'function') {
                _inverseFilter = window.FIRConvolution.generateInverse(_capturedIR, method);
            } else {
                var n = _capturedIR.length;
                _inverseFilter = new Float32Array(n);
                for (var i = 0; i < n; i++) _inverseFilter[i] = _capturedIR[n - 1 - i];
            }
            _drawWaveform(pm._el('ir-inverse-canvas'), _inverseFilter);
            if (status) status.textContent = 'Filtro inverso gerado (' + _inverseFilter.length + ' taps, ' + method + ')';
            pm._el('ir-export-wav-btn').disabled = false;
            pm._el('ir-export-inverse-btn').disabled = false;
            pm._el('ir-apply-convolution-btn').disabled = false;
            [].forEach.call(document.querySelectorAll('#ir-export-wav-btn, #ir-export-inverse-btn, #ir-apply-convolution-btn'), function (b) {
                b.classList.remove('cursor-not-allowed');
            });
        }, 100);
    }

    function _exportWav(data, filename) {
        var numChannels = 1;
        var sampleRate = 48000;
        var bitsPerSample = 32;
        var bytesPerSample = bitsPerSample / 8;
        var dataSize = data.length * numChannels * bytesPerSample;
        var buffer = new ArrayBuffer(44 + dataSize);
        var view = new DataView(buffer);

        function writeString(offset, str) { for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); }
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 3, true); // float
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
        view.setUint16(32, numChannels * bytesPerSample, true);
        view.setUint16(34, bitsPerSample, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);
        var offset = 44;
        for (var i = 0; i < data.length; i++) {
            view.setFloat32(offset, data[i], true);
            offset += bytesPerSample;
        }
        var blob = new Blob([buffer], { type: 'audio/wav' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
    }

    function _applyConvolution() {
        if (!_inverseFilter && !_capturedIR) return;
        var filter = _inverseFilter || _capturedIR;
        if (window.FIRConvolution && typeof window.FIRConvolution.loadIRFromArray === 'function') {
            window.FIRConvolution.loadIRFromArray(Array.from(filter)).then(function () {
                var s = pm._el('ir-generate-status');
                if (s) s.textContent = '✅ Filtro carregado no convolver em tempo real!';
            }).catch(function (e) {
                var s = pm._el('ir-generate-status');
                if (s) s.textContent = 'Erro: ' + e.message;
            });
        } else {
            var s = pm._el('ir-generate-status');
            if (s) s.textContent = 'Convolver não disponível. Carregue manualmente.';
        }
    }

    function init() {
        pm._on(pm._el('ir-capture-btn'), 'click', _captureIR);
        pm._on(pm._el('ir-next-1'), 'click', function () {
            _gotoStep(2);
            if (_capturedIR) {
                _drawETC(pm._el('ir-etc-canvas'), _capturedIR);
                _drawDecay(pm._el('ir-decay-canvas'), _capturedIR, 48000);
            }
        });
        pm._on(pm._el('ir-back-1'), 'click', function () { _gotoStep(1); });
        pm._on(pm._el('ir-next-2'), 'click', function () {
            _gotoStep(3);
            if (_capturedIR) _drawWaveform(pm._el('ir-wave-canvas'), _capturedIR);
            // re-layout canvas
            if (pm._el('ir-wave-canvas')) { var c = pm._el('ir-wave-canvas'); c.width = c.parentElement.clientWidth * (window.devicePixelRatio || 1); _drawWaveform(c, _capturedIR); }
        });
        pm._on(pm._el('ir-back-2'), 'click', function () { _gotoStep(2); });
        pm._on(pm._el('ir-generate-btn'), 'click', _generateInverse);
        pm._on(pm._el('ir-export-wav-btn'), 'click', function () { if (_capturedIR) _exportWav(_capturedIR, 'ir-measured.wav'); });
        pm._on(pm._el('ir-export-inverse-btn'), 'click', function () { if (_inverseFilter) _exportWav(_inverseFilter, 'ir-inverse.wav'); });
        pm._on(pm._el('ir-apply-convolution-btn'), 'click', _applyConvolution);
        pm._on(pm._el('ir-finish'), 'click', function () { _gotoStep(1); });
    }

    function destroy() { pm.destroy(); _capturedIR = null; _inverseFilter = null; }
    window.IRMeasurementPage = { init: init, destroy: destroy };
})();
