/**
 * SoundMaster — RT60 Page Module
 * Binds DOM events para a página de acústica e RT60.
 */

'use strict';

(function () {

    let _listeners = [];

    function _on(target, event, handler) {
        if (!target) return;
        target.addEventListener(event, handler);
        _listeners.push({ target, event, handler });
    }

    function init() {
        console.log('[RT60Page] Initializing...');

        _on(document.getElementById('btn-trigger-pulse'), 'click', function () {
            if (window.SoundMasterAnalyzer) SoundMasterAnalyzer.triggerImpulse();
        });

        _on(document.getElementById('btn-calculate-rt60'), 'click', function () {
            if (window.SoundMasterAnalyzer) SoundMasterAnalyzer.triggerImpulse();
        });

        _on(document.getElementById('btn-clear-measurements'), 'click', function () {
            const resultEl = document.getElementById('rt60-result');
            const chartPanel = document.getElementById('schroeder-chart-panel');
            if (resultEl) { resultEl.classList.add('hidden'); resultEl.innerHTML = ''; }
            if (chartPanel) chartPanel.classList.add('hidden');
            console.log('[RT60Page] Measurements cleared.');
        });

        _on(document.getElementById('btn-calc-rt60'), 'click', function () {
            const length = parseFloat(document.getElementById('rt-length')?.value) || 20;
            const width = parseFloat(document.getElementById('rt-width')?.value) || 10;
            const height = parseFloat(document.getElementById('rt-height')?.value) || 5;
            const absorption = parseFloat(document.getElementById('rt-absorption')?.value) || 0.15;
            const dist = parseFloat(document.getElementById('rt-delay-dist')?.value) || 0;

            const volume = length * width * height;
            const surfaceArea = 2 * (length * width + length * height + width * height);
            const rt60 = 0.161 * volume / (surfaceArea * absorption);

            const resultEl = document.getElementById('rt60-result');
            if (resultEl) {
                resultEl.classList.remove('hidden');
                resultEl.innerHTML = `
                    <div class="bg-slate-800/60 border border-white/10 rounded-2xl p-6">
                        <h3 class="text-xs font-black uppercase tracking-widest text-slate-500 mb-4">Resultado Estimado</h3>
                        <div class="grid grid-cols-2 gap-4">
                            <div class="bg-black/40 rounded-xl p-4 text-center">
                                <div class="text-[9px] text-slate-500 uppercase font-bold">Volume</div>
                                <div class="text-xl font-black text-cyan-400">${volume.toFixed(0)} m³</div>
                            </div>
                            <div class="bg-black/40 rounded-xl p-4 text-center">
                                <div class="text-[9px] text-slate-500 uppercase font-bold">RT60 Estimado</div>
                                <div class="text-xl font-black ${rt60 > 1.6 ? 'text-red-400' : rt60 > 1.4 ? 'text-green-400' : 'text-amber-400'}">${rt60.toFixed(2)}s</div>
                            </div>
                        </div>
                        <p class="text-[10px] text-slate-400 mt-4">Fórmula de Sabine: RT60 = 0.161 × V / (S × α)</p>
                    </div>`;
            }

            if (dist > 0) {
                const delayMs = (dist / 343) * 1000;
                const delayInfo = document.createElement('div');
                delayInfo.className = 'bg-black/30 rounded-xl p-3 mt-3 text-center';
                delayInfo.innerHTML = `<span class="text-[9px] text-slate-500 uppercase font-bold">Delay Auxiliar:</span> <span class="text-sm font-black text-purple-400">${delayMs.toFixed(1)} ms</span>`;
                resultEl.appendChild(delayInfo);
            }
        });

        _on(document.getElementById('btn-import-floorplan'), 'click', function () {
            const input = document.getElementById('input-floorplan');
            if (input) input.click();
        });

        _on(document.getElementById('input-floorplan'), 'change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (ev) {
                const img = document.getElementById('heatmap-bg');
                if (img) {
                    img.src = ev.target.result;
                    img.classList.remove('hidden');
                }
                const placeholder = document.getElementById('heatmap-placeholder');
                if (placeholder) placeholder.classList.add('hidden');
            };
            reader.readAsDataURL(file);
        });

        _on(document.getElementById('btn-clear-mapping'), 'click', function () {
            const canvas = document.getElementById('mapping-canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        });

        _on(document.getElementById('btn-export-mapping'), 'click', function () {
            console.log('[RT60Page] Export mapping (TODO).');
        });

        _on(document.getElementById('btn-rt-rec-mtk'), 'click', function () {
            const dot = document.getElementById('rt-rec-dot');
            const text = document.getElementById('rt-rec-text');
            const stopBtn = document.getElementById('btn-rt-stop-mtk');
            const startBtn = document.getElementById('btn-rt-rec-mtk');

            if (dot) { dot.classList.remove('bg-slate-500'); dot.classList.add('bg-red-500'); }
            if (text) text.textContent = 'REC';
            if (stopBtn) { stopBtn.disabled = false; stopBtn.classList.remove('cursor-not-allowed', 'text-slate-500'); stopBtn.classList.add('text-white'); }
            if (startBtn) startBtn.disabled = true;
        });

        _on(document.getElementById('btn-rt-stop-mtk'), 'click', function () {
            const dot = document.getElementById('rt-rec-dot');
            const text = document.getElementById('rt-rec-text');
            const stopBtn = document.getElementById('btn-rt-stop-mtk');
            const startBtn = document.getElementById('btn-rt-rec-mtk');

            if (dot) { dot.classList.remove('bg-red-500'); dot.classList.add('bg-slate-500'); }
            if (text) text.textContent = 'OFFLINE';
            if (stopBtn) { stopBtn.disabled = true; stopBtn.classList.add('cursor-not-allowed', 'text-slate-500'); stopBtn.classList.remove('text-white'); }
            if (startBtn) startBtn.disabled = false;
        });

        // Listen for RT60 result events
        document.addEventListener('rt60-result', function (e) {
            const { curve, rt60, t20, t30, edt, c50, c80, d50, sti, sti_category } = e.detail || {};

            if (curve && curve.length > 0 && window.SchroederRenderer) {
                const canvas = document.getElementById('schroeder-canvas');
                const panel = document.getElementById('schroeder-chart-panel');
                if (panel) panel.classList.remove('hidden');
                SchroederRenderer.draw(canvas, curve, { rt60, t20, t30, edt });
                SchroederRenderer.updateMetricCards({ rt60, t20, t30, edt, c50, c80, d50, sti, sti_category });
            }
        });

        console.log('[RT60Page] Initialized.');
    }

    function destroy() {
        _listeners.forEach(({ target, event, handler }) => {
            target.removeEventListener(event, handler);
        });
        _listeners = [];
        console.log('[RT60Page] Destroyed.');
    }

    window.RT60Page = { init, destroy };
})();
