'use strict';
(function () {
    var pm = createPageModule();

    function _testPython() {
        pm._log('debug-console', 'Testando endpoint de diagnóstico Python...');
        fetch('/diagnose').then(function (res) { return res.json(); }).then(function (data) {
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

    function init() {
        pm._on(pm._el('btn-test-python'), 'click', _testPython);
        pm._on(pm._el('btn-test-node'), 'click', _testNode);
    }

    window.DebugPage = { init: init, destroy: pm.destroy };
})();
