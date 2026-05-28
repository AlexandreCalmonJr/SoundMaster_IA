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

    function renderHistoryList(history) {
        var container = pm._el('bench-history-list');
        if (!container) return;

        if (!history || history.length === 0) {
            container.innerHTML = '<div class="text-center py-6 text-slate-500 text-xs">Nenhuma medição salva ainda</div>';
            return;
        }

        var html = '';
        var sorted = history.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
        var items = sorted.slice(0, 10);

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var date = item.ts ? new Date(item.ts) : new Date();
            var dateStr = date.toLocaleDateString('pt-BR') + ' • ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            var rt60 = item.rt60 || 0;
            var name = item.name || item.label || 'Medição ' + (items.length - i);
            var rt60Str = rt60 > 0 ? 'RT60: ' + rt60.toFixed(2) + 's' : '--';

            html += '<div class="p-4 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between hover:bg-white/10 transition-all">';
            html += '  <div>';
            html += '    <span class="text-sm font-bold text-white block">' + name + '</span>';
            html += '    <span class="text-[10px] text-slate-500 uppercase">' + dateStr + '</span>';
            html += '  </div>';
            html += '  <span class="text-xs font-mono text-cyan-400">' + rt60Str + '</span>';
            html += '</div>';
        }

        container.innerHTML = html;
    }

    function handleAcousticHistory(data) {
        var emptyVal = (data && data.benchmark && data.benchmark.empty && data.benchmark.empty.rt60) || 0;
        var fullVal = (data && data.benchmark && data.benchmark.full && data.benchmark.full.rt60) || 0;
        updateRT60Visuals(emptyVal, fullVal);

        var history = (data && data.history) || [];
        renderHistoryList(history);

        var emptyEl = pm._el('bench-empty-rt60');
        var fullEl = pm._el('bench-full-rt60');
        if (emptyEl) emptyEl.classList.remove('animate-pulse');
        if (fullEl) fullEl.classList.remove('animate-pulse');

        pm._call('AppStore', 'addLog', 'Benchmarking atualizado com ' + history.length + ' medições.');
    }

    function init() {
        var socket = pm._call('SocketService', 'raw');
        if (socket) {
            socket.on('acoustic_history_data', handleAcousticHistory);
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
