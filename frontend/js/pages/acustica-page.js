'use strict';
(function () {
    var pm = createPageModule();

    function init() {
        // Eyring & Sabine Acoustic Calculator
        pm._on(pm._el('btn-calc-rt60'), 'click', async function () {
            var length = parseFloat(pm._el('rt-length') ? pm._el('rt-length').value : 20) || 20;
            var width = parseFloat(pm._el('rt-width') ? pm._el('rt-width').value : 10) || 10;
            var height = parseFloat(pm._el('rt-height') ? pm._el('rt-height').value : 5) || 5;
            var absorption = parseFloat(pm._el('rt-absorption') ? pm._el('rt-absorption').value : 0.15) || 0.15;
            var dist = parseFloat(pm._el('rt-delay-dist') ? pm._el('rt-delay-dist').value : 0) || 0;
            
            var volume = length * width * height;
            var surfaceArea = 2 * (length * width + length * height + width * height);
            
            var rt60 = 0;
            var formula = 'Sabine (Local Fallback)';
            var classification = '';

            // Attempt to call Eyring from Python AI Engine if available
            if (window.AIService && typeof window.AIService.calculateAcoustics === 'function') {
                try {
                    var aiResult = await window.AIService.calculateAcoustics(volume, surfaceArea, absorption);
                    if (aiResult) {
                        rt60 = aiResult.rt60;
                        formula = 'Eyring (AI Engine)';
                        classification = aiResult.classification;
                    }
                } catch (err) {
                    console.warn('[AcusticaPage] Failed to calculate RT60 via AIService, falling back to local formulas:', err);
                }
            }

            // Fallback calculation locally
            if (rt60 === 0) {
                var alpha = Math.min(0.99, absorption);
                // Eyring Formula: RT60 = -0.161 * V / (S * ln(1 - alpha))
                rt60 = (-0.161 * volume) / (surfaceArea * Math.log(1 - alpha));
                formula = 'Eyring (Local Fallback)';
            }

            var delayMs = dist > 0 ? (dist / 343) * 1000 : 0;
            var color = rt60 > 1.6 ? 'text-red-400' : rt60 > 1.4 ? 'text-green-400' : 'text-amber-400';
            
            var resultHtml = '<div class="bg-slate-800/60 border border-white/10 rounded-2xl p-6">' +
                '<h3 class="text-xs font-black uppercase tracking-widest text-slate-500 mb-4">Resultado Estimado</h3>' +
                '<div class="grid grid-cols-2 gap-4">' +
                '<div class="bg-black/40 rounded-xl p-4 text-center">' +
                '<div class="text-[9px] text-slate-500 uppercase font-bold">Volume</div>' +
                '<div class="text-xl font-black text-cyan-400">' + volume.toFixed(0) + ' m³</div>' +
                '</div>' +
                '<div class="bg-black/40 rounded-xl p-4 text-center">' +
                '<div class="text-[9px] text-slate-500 uppercase font-bold">RT60 Estimado</div>' +
                '<div class="text-xl font-black ' + color + '">' + rt60.toFixed(2) + 's</div>' +
                '</div>' +
                '</div>' +
                '<p class="text-[10px] text-slate-400 mt-4">Fórmula: ' + formula + '</p>' +
                '</div>';
                
            pm._setHTML('rt60-result', resultHtml);
            
            var resultContainer = pm._el('rt60-result');
            if (resultContainer) {
                resultContainer.classList.remove('hidden');
            }
            
            if (dist > 0) {
                var el = pm._el('rt60-result');
                if (el) {
                    var delayInfo = document.createElement('div');
                    delayInfo.className = 'bg-black/30 rounded-xl p-3 mt-3 text-center';
                    delayInfo.innerHTML = '<span class="text-[9px] text-slate-500 uppercase font-bold">Delay Auxiliar:</span> <span class="text-sm font-black text-cyan-400">' + delayMs.toFixed(1) + ' ms</span>';
                    el.appendChild(delayInfo);
                }
            }

            // Update spatial mapping width and length if window.SoundMasterMapping is loaded
            var smm = window.SoundMasterMapping;
            if (smm && typeof smm.updateDimensions === 'function') {
                smm.updateDimensions(width, length);
            }
        });

        // Floorplan and canvas mapping elements
        pm._on(pm._el('btn-import-floorplan'), 'click', function () { 
            var input = pm._el('input-floorplan'); 
            if (input) input.click(); 
        });

        // If RT60Mapping module exists, initialize it too
        var rtm = window.RT60Mapping;
        if (rtm && typeof rtm.init === 'function') {
            var canvas = pm._el('mapping-canvas');
            var container = pm._el('mapping-container');
            if (canvas) {
                rtm.init(canvas, container);
            }
        }
    }

    function destroy() {
        pm.destroy();
    }

    window.AcusticaPage = { init: init, destroy: destroy };
})();
