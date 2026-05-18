'use strict';
(function () {
    var pm = createPageModule();
    var _vuUnsub = null;

    async function _updateStatus() {
        try {
            var res = await fetch('/api/config');
            var config = await res.json();
            if (config.tunnelUrl) {
                pm._setText('tunnel-status-text', config.tunnelUrl);
                pm._toggleClasses('tunnel-status-text', ['text-cyan-400'], ['text-slate-500']);
                pm._toggleClasses('tunnel-led', ['bg-green-500', 'shadow-lg', 'shadow-green-900/50'], ['bg-slate-700']);
                pm._setText('btn-toggle-tunnel', 'Túnel Ativo');
                pm._toggleClasses('btn-toggle-tunnel', ['bg-slate-700'], ['bg-cyan-600']);
            }
        } catch (e) {}
    }

    async function _toggleTunnel() {
        pm._setText('btn-toggle-tunnel', 'Iniciando...');
        try {
            var res = await fetch('/api/tunnel/toggle', { method: 'POST' });
            var data = await res.json();
            if (data.success) pm._setTimeout(_updateStatus, 3000);
        } catch (e) { pm._setText('btn-toggle-tunnel', 'Erro ao Ativar'); }
    }

    function _copyLink() {
        var url = pm._el('tunnel-status-text') ? pm._el('tunnel-status-text').innerText : '';
        if (url && url !== 'Aguardando túnel...') { navigator.clipboard.writeText(url); alert('Link copiado: ' + url); }
        else { alert('Ative o túnel primeiro!'); }
    }

    function init() {
        pm._on(pm._el('btn-toggle-tunnel'), 'click', _toggleTunnel);
        pm._on(pm._el('btn-copy-link'), 'click', _copyLink);

        if (window.AppStore) {
            _vuUnsub = AppStore.subscribe('deviceInfo', function (info) {
                if (!info || info.model === 'Unknown') return;
                pm._setText('mixer-model-display', info.model);
                pm._setText('mixer-fw-display', info.firmware);
                if (info.caps) {
                    pm._setText('cap-ch', info.caps.inputs || '-');
                    pm._setText('cap-aux', info.caps.aux || '-');
                    pm._setText('cap-fx', info.caps.fx || '-');
                }
            });
        }
        _updateStatus();
    }

    function destroy() {
        pm.destroy();
        if (_vuUnsub) { _vuUnsub(); _vuUnsub = null; }
    }

    window.SystemsPage = { init: init, destroy: destroy };
})();
