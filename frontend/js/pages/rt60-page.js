'use strict';
(function () {
    var pm = createPageModule();
    var rt60Listener = null;

    function handleAcousticHistory(data) {
        var emptyVal = (data && data.benchmark && data.benchmark.empty && data.benchmark.empty.rt60) || 0;
        var fullVal = (data && data.benchmark && data.benchmark.full && data.benchmark.full.rt60) || 0;
        
        var emptyEl = pm._el('rt60-empty-rt60');
        var fullEl = pm._el('rt60-full-rt60');
        
        if (emptyEl) {
            emptyEl.innerText = emptyVal > 0 ? emptyVal.toFixed(2) + 's' : 'Sem dados';
        }
        if (fullEl) {
            fullEl.innerText = fullVal > 0 ? fullVal.toFixed(2) + 's' : 'Sem dados';
        }
    }

    function updateMtkUI(isRec) {
        var btnRec = pm._el('btn-rt-rec-mtk');
        var btnStop = pm._el('btn-rt-stop-mtk');
        var recDot = pm._el('rt-rec-dot');
        var recText = pm._el('rt-rec-text');
        
        if (isRec) {
            if (recDot) {
                recDot.classList.remove('bg-slate-500');
                recDot.classList.add('bg-red-500');
            }
            if (recText) {
                recText.innerText = 'REC';
                recText.classList.remove('text-slate-500');
                recText.classList.add('text-red-500');
            }
            if (btnRec) btnRec.disabled = true;
            if (btnStop) {
                btnStop.disabled = false;
                btnStop.classList.remove('cursor-not-allowed', 'text-slate-500');
                btnStop.classList.add('text-white');
            }
        } else {
            if (recDot) {
                recDot.classList.remove('bg-red-500');
                recDot.classList.add('bg-slate-500');
            }
            if (recText) {
                recText.innerText = 'OFFLINE';
                recText.classList.remove('text-red-500');
                recText.classList.add('text-slate-500');
            }
            if (btnRec) btnRec.disabled = false;
            if (btnStop) {
                btnStop.disabled = true;
                btnStop.classList.add('cursor-not-allowed', 'text-slate-500');
                btnStop.classList.remove('text-white');
            }
        }
    }

    function handleRt60Result(e) {
        var detail = e.detail || {};
        if (detail.curve && detail.curve.length > 0 && window.SchroederRenderer) {
            var canvas = pm._el('schroeder-canvas'), panel = pm._el('schroeder-chart-panel');
            if (panel) panel.classList.remove('hidden');
            window.SchroederRenderer.draw(canvas, detail.curve, { rt60: detail.rt60, t20: detail.t20, t30: detail.t30, edt: detail.edt });
            window.SchroederRenderer.updateMetricCards({ rt60: detail.rt60, t20: detail.t20, t30: detail.t30, edt: detail.edt, c50: detail.c50, c80: detail.c80, d50: detail.d50, sti: detail.sti, sti_category: detail.sti_category });
        }
    }

    function init() {
        pm._on(pm._el('btn-trigger-pulse'), 'click', function () { pm._safeCall('SoundMasterAnalyzer', 'triggerImpulse'); });
        pm._on(pm._el('btn-calculate-rt60'), 'click', function () { pm._safeCall('SoundMasterAnalyzer', 'triggerImpulse'); });

        pm._on(pm._el('btn-clear-measurements'), 'click', function () { 
            pm._toggleClasses('rt60-result', ['hidden'], []); 
            pm._setHTML('rt60-result', ''); 
            pm._toggleClasses('schroeder-chart-panel', ['hidden'], []); 
        });

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
                    console.warn('[RT60Page] Failed to calculate RT60 via AIService, falling back to local formulas:', err);
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
        pm._on(pm._el('input-floorplan'), 'change', function (e) { 
            var file = e.target.files[0]; 
            if (!file) return; 
            var reader = new FileReader(); 
            reader.onload = function (ev) { 
                var img = pm._el('heatmap-bg'); 
                if (img) { 
                    img.src = ev.target.result; 
                    img.classList.remove('hidden'); 
                } 
                var ph = pm._el('heatmap-placeholder'); 
                if (ph) ph.classList.add('hidden'); 
            }; 
            reader.readAsDataURL(file); 
        });

        pm._on(pm._el('btn-clear-mapping'), 'click', function () { 
            var canvas = pm._el('mapping-canvas'); 
            if (canvas) { 
                var ctx = canvas.getContext('2d'); 
                ctx.clearRect(0, 0, canvas.width, canvas.height); 
            } 
        });
        pm._on(pm._el('btn-export-mapping'), 'click', function () { 
            console.log('[RT60Page] Export mapping (TODO).'); 
        });

        // Socket integration for historical benchmarking
        var socket = pm._call('SocketService', 'raw');
        if (socket) {
            socket.on('acoustic_history_data', handleAcousticHistory);
            pm._call('SocketService', 'emit', 'get_acoustic_history');
        }

        // AppStore integration for Virtual Soundcheck (MTK) status
        var store = pm._call('AppStore', 'raw') || window.AppStore;
        if (store) {
            var state = store.getState ? store.getState() : {};
            updateMtkUI(state.isRecordingMTK);
            
            if (store.subscribe) {
                pm._subscribe('AppStore', 'isRecordingMTK', function (isRec) {
                    updateMtkUI(isRec);
                });
            }
        }

        pm._on(pm._el('btn-rt-rec-mtk'), 'click', function () {
            pm._call('MixerService', 'setRecording', true, 'mtk');
            pm._call('AppStore', 'setState', { isRecordingMTK: true });
            pm._call('AppStore', 'addLog', 'MTK: Gravação de Multitrack iniciada.');
        });
        
        pm._on(pm._el('btn-rt-stop-mtk'), 'click', function () {
            pm._call('MixerService', 'setRecording', false, 'mtk');
            pm._call('AppStore', 'setState', { isRecordingMTK: false });
            pm._call('AppStore', 'addLog', 'MTK: Gravação de Multitrack finalizada.');
        });

        // Listen for new RT60 results dispatched on parent document
        rt60Listener = handleRt60Result;
        if (window.parent && window.parent.document) {
            window.parent.document.addEventListener('rt60-result', rt60Listener);
        }

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
        var socket = pm._call('SocketService', 'raw');
        if (socket) {
            socket.off('acoustic_history_data', handleAcousticHistory);
        }
        if (window.parent && window.parent.document && rt60Listener) {
            window.parent.document.removeEventListener('rt60-result', rt60Listener);
        }
        pm.destroy();
    }

    window.RT60Page = { init: init, destroy: destroy };
})();
