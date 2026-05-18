'use strict';
(function () {
    let _listeners = [];
    let _vuUnsub = null;

    function _on(target, event, handler) {
        if (!target) return;
        target.addEventListener(event, handler);
        _listeners.push({ target, event, handler });
    }

    async function _updateStatus() {
        try {
            const res = await fetch('/api/config');
            const config = await res.json();
            if (config.tunnelUrl) {
                const statusText = document.getElementById('tunnel-status-text');
                const led = document.getElementById('tunnel-led');
                const btnToggle = document.getElementById('btn-toggle-tunnel');
                if (statusText) { statusText.innerText = config.tunnelUrl; statusText.classList.replace('text-slate-500', 'text-cyan-400'); }
                if (led) { led.classList.replace('bg-slate-700', 'bg-green-500'); led.classList.add('shadow-lg', 'shadow-green-900/50'); }
                if (btnToggle) { btnToggle.innerText = 'Túnel Ativo'; btnToggle.classList.replace('bg-cyan-600', 'bg-slate-700'); }
            }
        } catch (e) {}
    }

    async function _toggleTunnel() {
        const btnToggle = document.getElementById('btn-toggle-tunnel');
        if (btnToggle) btnToggle.innerText = 'Iniciando...';
        try {
            const res = await fetch('/api/tunnel/toggle', { method: 'POST' });
            const data = await res.json();
            if (data.success) setTimeout(_updateStatus, 3000);
        } catch (e) {
            if (btnToggle) btnToggle.innerText = 'Erro ao Ativar';
        }
    }

    function _copyLink() {
        const statusText = document.getElementById('tunnel-status-text');
        const url = statusText ? statusText.innerText : '';
        if (url && url !== 'Aguardando túnel...') {
            navigator.clipboard.writeText(url);
            alert('Link copiado: ' + url);
        } else {
            alert('Ative o túnel primeiro!');
        }
    }

    function init() {
        _on(document.getElementById('btn-toggle-tunnel'), 'click', _toggleTunnel);
        _on(document.getElementById('btn-copy-link'), 'click', _copyLink);

        if (window.AppStore) {
            _vuUnsub = AppStore.subscribe('deviceInfo', function (info) {
                if (!info || info.model === 'Unknown') return;
                var modelDisplay = document.getElementById('mixer-model-display');
                var fwDisplay = document.getElementById('mixer-fw-display');
                var capCh = document.getElementById('cap-ch');
                var capAux = document.getElementById('cap-aux');
                var capFx = document.getElementById('cap-fx');
                if (modelDisplay) modelDisplay.innerText = info.model;
                if (fwDisplay) fwDisplay.innerText = info.firmware;
                if (info.caps) {
                    if (capCh) capCh.innerText = info.caps.inputs || '-';
                    if (capAux) capAux.innerText = info.caps.aux || '-';
                    if (capFx) capFx.innerText = info.caps.fx || '-';
                }
            });
        }

        _updateStatus();
    }

    function destroy() {
        _listeners.forEach(function (l) { l.target.removeEventListener(l.event, l.handler); });
        _listeners = [];
        if (_vuUnsub) { _vuUnsub(); _vuUnsub = null; }
    }

    window.SystemsPage = { init: init, destroy: destroy };
})();
