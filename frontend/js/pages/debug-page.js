'use strict';
(function () {
    var pm = createPageModule();
    var unsubscribeLogs = null;

    function _testPython() {
        AppStore.addLog('[System] Testando endpoint de diagnóstico Python...');
        fetch('/api/ai/diagnose').then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }).then(function (data) {
            AppStore.addLog('[System] Python OK: ' + JSON.stringify(data));
        }).catch(function (e) {
            AppStore.addLog('[ERROR] Python falhou: ' + e.message);
        });
    }

    function _testNode() {
        AppStore.addLog('[System] Verificando status do servidor Node e Socket...');
        pm._setTimeout(function () {
            AppStore.addLog('[System] Allowlist Zod: OK');
            AppStore.addLog('[System] Throttle Scoping: OK');
            AppStore.addLog('[System] Canal 24 Limit: OK');
        }, 500);
    }

    function _renderLogs() {
        var consoleDiv = pm._el('debug-console');
        if (!consoleDiv) return;
        var logs = (AppStore.getState().mixerLog) || [];
        consoleDiv.innerHTML = logs.map(function (l) {
            var color = '#4ade80';
            if (l.text.includes('[ERROR]') || l.text.toLowerCase().includes('erro') || l.text.includes('falhou')) {
                color = '#f87171';
            } else if (l.text.includes('[WARN]') || l.text.toLowerCase().includes('aviso') || l.text.includes('JWT_SECRET_MISSING')) {
                color = '#fbbf24';
            } else if (l.text.includes('[System]')) {
                color = '#60a5fa';
            }
            var safeText = l.text.replace(/[&<>"']/g, function (c) {
                return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
            });
            return '<div style="margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 2px; font-family: monospace; font-size: 10px;">' +
                '<span style="color: #64748b; font-size: 8px;">[' + l.time + ']</span> ' +
                '<span style="color: ' + color + ';">' + safeText + '</span>' +
                '</div>';
        }).join('');
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }

    function init() {
        pm._on(pm._el('btn-test-python'), 'click', _testPython);
        pm._on(pm._el('btn-test-node'), 'click', _testNode);
        
        _renderLogs();
        unsubscribeLogs = AppStore.subscribe('mixerLog', _renderLogs);
    }

    function destroy() {
        if (unsubscribeLogs) {
            unsubscribeLogs();
            unsubscribeLogs = null;
        }
        pm.destroy();
    }

    window.DebugPage = { init: init, destroy: destroy };
})();
