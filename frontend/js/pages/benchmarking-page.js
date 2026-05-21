'use strict';
(function () {
    var pm = createPageModule();

    function updateRT60Visuals(emptyVal, fullVal) {
        var emptyEl = pm._el('bench-empty-rt60');
        var fullEl = pm._el('bench-full-rt60');
        var emptyBar = pm._el('bench-empty-bar');
        var fullBar = pm._el('bench-full-bar');

        if (emptyEl) {
            emptyEl.innerText = emptyVal > 0 ? emptyVal.toFixed(2) + 's' : 'Sem dados';
        }
        if (fullEl) {
            fullEl.innerText = fullVal > 0 ? fullVal.toFixed(2) + 's' : 'Sem dados';
        }

        // Adjust bar heights dynamically. Max value scale is 3.0s.
        var scaleMax = 3.0;
        if (emptyBar) {
            var emptyPct = emptyVal > 0 ? Math.min(100, (emptyVal / scaleMax) * 100) : 0;
            emptyBar.style.height = emptyPct > 0 ? emptyPct + '%' : '10%';
        }
        if (fullBar) {
            var fullPct = fullVal > 0 ? Math.min(100, (fullVal / scaleMax) * 100) : 0;
            fullBar.style.height = fullPct > 0 ? fullPct + '%' : '10%';
        }
    }

    function handleAcousticHistory(data) {
        var emptyVal = (data && data.benchmark && data.benchmark.empty && data.benchmark.empty.rt60) || 0;
        var fullVal = (data && data.benchmark && data.benchmark.full && data.benchmark.full.rt60) || 0;
        updateRT60Visuals(emptyVal, fullVal);
        pm._call('AppStore', 'addLog', 'Benchmarking atualizado via histórico acústico real.');
    }

    function init() {
        var socket = pm._call('SocketService', 'raw');
        if (socket) {
            socket.on('acoustic_history_data', handleAcousticHistory);
            // Request data immediately on load
            pm._call('SocketService', 'emit', 'get_acoustic_history');
        }

        pm._on(pm._el('btn-refresh-history'), 'click', function () {
            var socket = pm._call('SocketService', 'raw');
            if (socket) {
                pm._call('SocketService', 'emit', 'get_acoustic_history');

                var emptyEl = pm._el('bench-empty-rt60');
                var fullEl = pm._el('bench-full-rt60');
                if (emptyEl) emptyEl.classList.add('animate-pulse');
                if (fullEl) fullEl.classList.add('animate-pulse');

                pm._setTimeout(function () {
                    if (emptyEl) emptyEl.classList.remove('animate-pulse');
                    if (fullEl) fullEl.classList.remove('animate-pulse');
                }, 1000);
            } else {
                alert('SocketService não disponível.');
            }
        });
    }

    function destroy() {
        var socket = pm._call('SocketService', 'raw');
        if (socket) {
            socket.off('acoustic_history_data', handleAcousticHistory);
        }
        pm.destroy();
    }

    window.BenchmarkingPage = {
        init: init,
        destroy: destroy
    };
})();
