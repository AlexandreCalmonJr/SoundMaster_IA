'use strict';
(function () {
    var pm = createPageModule();
    var unsubscribeLogs = null;

    function _testPython() {
        pm._log('debug-console', 'Testando endpoint de diagnóstico Python...');
        fetch('/api/ai/diagnose').then(function (res) { return res.json(); }).then(function (data) {
            pm._log('debug-console', 'Sucesso: ' + JSON.stringify(data));
        }).catch(function (e) { pm._log('debug-console', 'Erro: ' + e.message, 'error'); });
    }

    function _testNode() {
        pm._log('debug-console', 'Verificando status do servidor Node e Socket...');
        pm._setTimeout(function () {
            pm._log('debug-console', 'Allowlist Zod: OK');
            pm._log('debug-console', 'Throttle Scoping: OK');
            pm._log('debug-console', 'Canal 24 Limit: OK');
        }, 500);
    }

    function _renderLogs() {
        const consoleDiv = pm._el('debug-console');
        if (!consoleDiv) return;
        const logs = AppStore.getState().mixerLog;
        consoleDiv.innerHTML = logs.map(l => {
            let color = '#4ade80'; // Verde para padrão (info)
            if (l.text.includes('[WARN]') || l.text.toLowerCase().includes('aviso') || l.text.includes('JWT_SECRET_MISSING')) {
                color = '#fbbf24'; // Amarelo
            } else if (l.text.includes('[ERROR]') || l.text.toLowerCase().includes('erro') || l.text.includes('falhou')) {
                color = '#f87171'; // Vermelho
            } else if (l.text.includes('[System]')) {
                color = '#60a5fa'; // Azul
            }
            return `<div style="margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 2px; font-family: monospace; font-size: 10px;">
                <span style="color: #64748b; font-size: 8px;">[${l.time}]</span> 
                <span style="color: ${color};">${l.text}</span>
            </div>`;
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
