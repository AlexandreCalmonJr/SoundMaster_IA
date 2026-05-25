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

        pm._on(pm._el('btn-calculate-rt60'), 'click', function () {
            var lastRt60 = pm._call('SoundMasterAnalyzer', 'getLastRt60');
            if (lastRt60 && window.SchroederRenderer) {
                var panel = pm._el('schroeder-chart-panel');
                if (panel) panel.classList.remove('hidden');
                window.SchroederRenderer.updateMetricCards(lastRt60);
            }
        });

        pm._on(pm._el('btn-clear-measurements'), 'click', function () { 
            pm._toggleClasses('schroeder-chart-panel', ['hidden'], []); 
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

        var _mtkBusy = false;
        pm._on(pm._el('btn-rt-rec-mtk'), 'click', function () {
            if (_mtkBusy) return;
            _mtkBusy = true;
            this.disabled = true;
            pm._call('MixerService', 'setRecording', true, 'mtk');
            pm._call('AppStore', 'setState', { isRecordingMTK: true });
            pm._call('AppStore', 'addLog', 'MTK: Gravação de Multitrack iniciada.');
            var self = this;
            setTimeout(function () { _mtkBusy = false; }, 1000);
        });
        
        pm._on(pm._el('btn-rt-stop-mtk'), 'click', function () {
            pm._call('MixerService', 'setRecording', false, 'mtk');
            pm._call('AppStore', 'setState', { isRecordingMTK: false });
            pm._call('AppStore', 'addLog', 'MTK: Gravação de Multitrack finalizada.');
        });

        // Listen for new RT60 results dispatched on parent document
        rt60Listener = handleRt60Result;
        if (window.parent && window.parent.document) {
            window.parent.document.removeEventListener('rt60-result', rt60Listener);
            window.parent.document.addEventListener('rt60-result', rt60Listener);
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
