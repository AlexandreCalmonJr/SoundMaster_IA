'use strict';
(function () {
    var pm = createPageModule();

    function init() {
        pm._on(pm._el('btn-trigger-pulse'), 'click', function () { pm._safeCall('SoundMasterAnalyzer', 'triggerImpulse'); });
        pm._on(pm._el('btn-calculate-rt60'), 'click', function () { pm._safeCall('SoundMasterAnalyzer', 'triggerImpulse'); });

        pm._on(pm._el('btn-clear-measurements'), 'click', function () { pm._toggleClasses('rt60-result', ['hidden'], []); pm._setHTML('rt60-result', ''); pm._toggleClasses('schroeder-chart-panel', ['hidden'], []); });

        pm._on(pm._el('btn-calc-rt60'), 'click', function () {
            var length = parseFloat(pm._el('rt-length') ? pm._el('rt-length').value : 20) || 20;
            var width = parseFloat(pm._el('rt-width') ? pm._el('rt-width').value : 10) || 10;
            var height = parseFloat(pm._el('rt-height') ? pm._el('rt-height').value : 5) || 5;
            var absorption = parseFloat(pm._el('rt-absorption') ? pm._el('rt-absorption').value : 0.15) || 0.15;
            var dist = parseFloat(pm._el('rt-delay-dist') ? pm._el('rt-delay-dist').value : 0) || 0;
            var volume = length * width * height;
            var surfaceArea = 2 * (length * width + length * height + width * height);
            var rt60 = 0.161 * volume / (surfaceArea * absorption);
            var color = rt60 > 1.6 ? 'text-red-400' : rt60 > 1.4 ? 'text-green-400' : 'text-amber-400';
            pm._setHTML('rt60-result', '<div class="bg-slate-800/60 border border-white/10 rounded-2xl p-6"><h3 class="text-xs font-black uppercase tracking-widest text-slate-500 mb-4">Resultado Estimado</h3><div class="grid grid-cols-2 gap-4"><div class="bg-black/40 rounded-xl p-4 text-center"><div class="text-[9px] text-slate-500 uppercase font-bold">Volume</div><div class="text-xl font-black text-cyan-400">' + volume.toFixed(0) + ' m\u00B3</div></div><div class="bg-black/40 rounded-xl p-4 text-center"><div class="text-[9px] text-slate-500 uppercase font-bold">RT60 Estimado</div><div class="text-xl font-black ' + color + '">' + rt60.toFixed(2) + 's</div></div></div><p class="text-[10px] text-slate-400 mt-4">F\u00F3rmula de Sabine: RT60 = 0.161 \u00D7 V / (S \u00D7 \u03B1)</p></div>');
            if (dist > 0) { var delayMs = (dist / 343) * 1000; var el = pm._el('rt60-result'); if (el) { var delayInfo = document.createElement('div'); delayInfo.className = 'bg-black/30 rounded-xl p-3 mt-3 text-center'; delayInfo.innerHTML = '<span class="text-[9px] text-slate-500 uppercase font-bold">Delay Auxiliar:</span> <span class="text-sm font-black text-cyan-400">' + delayMs.toFixed(1) + ' ms</span>'; el.appendChild(delayInfo); } }
        });

        pm._on(pm._el('btn-import-floorplan'), 'click', function () { var input = pm._el('input-floorplan'); if (input) input.click(); });
        pm._on(pm._el('input-floorplan'), 'change', function (e) { var file = e.target.files[0]; if (!file) return; var reader = new FileReader(); reader.onload = function (ev) { var img = pm._el('heatmap-bg'); if (img) { img.src = ev.target.result; img.classList.remove('hidden'); } var ph = pm._el('heatmap-placeholder'); if (ph) ph.classList.add('hidden'); }; reader.readAsDataURL(file); });

        pm._on(pm._el('btn-clear-mapping'), 'click', function () { var canvas = pm._el('mapping-canvas'); if (canvas) { var ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); } });
        pm._on(pm._el('btn-export-mapping'), 'click', function () { console.log('[RT60Page] Export mapping (TODO).'); });

        pm._on(pm._el('btn-rt-rec-mtk'), 'click', function () { pm._toggleClasses('rt-rec-dot', ['bg-red-500'], ['bg-slate-500']); pm._setText('rt-rec-text', 'REC'); pm._toggleClasses('btn-rt-stop-mtk', ['text-white'], ['cursor-not-allowed', 'text-slate-500']); var sb = pm._el('btn-rt-stop-mtk'); if (sb) { sb.disabled = false; } var sa = pm._el('btn-rt-rec-mtk'); if (sa) sa.disabled = true; });
        pm._on(pm._el('btn-rt-stop-mtk'), 'click', function () { pm._toggleClasses('rt-rec-dot', ['bg-slate-500'], ['bg-red-500']); pm._setText('rt-rec-text', 'OFFLINE'); pm._toggleClasses('btn-rt-stop-mtk', ['cursor-not-allowed', 'text-slate-500'], ['text-white']); var sb = pm._el('btn-rt-stop-mtk'); if (sb) { sb.disabled = true; } var sa = pm._el('btn-rt-rec-mtk'); if (sa) sa.disabled = false; });

        document.addEventListener('rt60-result', function (e) {
            var detail = e.detail || {};
            if (detail.curve && detail.curve.length > 0 && window.SchroederRenderer) {
                var canvas = pm._el('schroeder-canvas'), panel = pm._el('schroeder-chart-panel');
                if (panel) panel.classList.remove('hidden');
                SchroederRenderer.draw(canvas, detail.curve, { rt60: detail.rt60, t20: detail.t20, t30: detail.t30, edt: detail.edt });
                SchroederRenderer.updateMetricCards({ rt60: detail.rt60, t20: detail.t20, t30: detail.t30, edt: detail.edt, c50: detail.c50, c80: detail.c80, d50: detail.d50, sti: detail.sti, sti_category: detail.sti_category });
            }
        });
    }

    function destroy() { pm.destroy(); }

    window.RT60Page = { init: init, destroy: destroy };
})();
