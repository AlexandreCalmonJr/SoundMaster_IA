/**
 * @fileoverview Página de Benchmarking — Comparação de medições acústicas
 * entre cenários (sala vazia vs. lotada) e histórico de medições.
 *
 * Esta página permite comparar métricas acústicas (RT60) entre diferentes
 * configurações do ambiente, como sala vazia e sala lotada, além de exibir
 * um histórico cronológico das medições realizadas.
 *
 * ## Funcionalidades Principais
 * - Visualização comparativa de RT60: sala vazia vs. sala lotada
 * - Barras proporcionais com escala máxima de 3.0 segundos
 * - Lista cronológica das últimas 10 medições salvas
 * - Botão de atualização para buscar novos dados do servidor
 * - Indicadores visuais de carregamento (animate-pulse)
 * - Integração com SocketService para dados em tempo real
 *
 * ## Como Usar
 * 1. Os dados são carregados automaticamente ao iniciar a página
 * 2. Clique em "Atualizar" para buscar medições mais recentes
 * 3. Compare visualmente os valores de RT60 entre cenários
 * 4. Revise o histórico de medições na lista abaixo
 *
 * ## Dependências e Integrações
 * - **createPageModule()**: Módulo base para páginas
 * - **SocketService**: Comunicação WebSocket
 *   - `on('acoustic_history_data', handler)` — Recebe dados históricos
 *   - `emit('get_acoustic_history')` — Solicita dados do servidor
 * - **AppStore**: Store global (logs)
 *   - `addLog(message)` — Adiciona log ao sistema
 *
 * @module BenchmarkingPage
 * @version 1.0.0
 */

'use strict';
(function () {
    var pm = createPageModule();

    function _esc(value) {
        if (typeof window.escapeHTMLText === 'function') return window.escapeHTMLText(value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

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
        var sorted = history.slice().sort(function (a, b) {
            var timeA = a.timestamp ? new Date(a.timestamp).getTime() : (a.ts || 0);
            var timeB = b.timestamp ? new Date(b.timestamp).getTime() : (b.ts || 0);
            return timeB - timeA;
        });
        var items = sorted.slice(0, 10);

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var date = item.timestamp ? new Date(item.timestamp) : (item.ts ? new Date(item.ts) : new Date());
            var dateStr = date.toLocaleDateString('pt-BR') + ' • ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            var rt60 = item.rt60 || 0;
            var name = item.name || item.label || 'Medição ' + (items.length - i);
            var rt60Str = rt60 > 0 ? 'RT60: ' + rt60.toFixed(2) + 's' : '--';

            html += '<div class="p-4 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between hover:bg-white/10 transition-all">';
            html += '  <div>';
            html += '    <span class="text-sm font-bold text-white block">' + _esc(name) + '</span>';
            html += '    <span class="text-[10px] text-slate-500 uppercase">' + _esc(dateStr) + '</span>';
            html += '  </div>';
            html += '  <span class="text-xs font-mono text-cyan-400">' + _esc(rt60Str) + '</span>';
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
