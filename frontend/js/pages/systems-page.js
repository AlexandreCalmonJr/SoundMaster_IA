/**
 * =============================================================================
 * SoundMaster — Página de Conexão do Sistema (Systems Page)
 * =============================================================================
 *
 * @description
 * Página responsável pela gestão de conexão com a mixer de áudio e pelo controle
 * do túnel de acesso remoto (tunnel). Permite ao usuário conectar-se à mixer via
 * IP, visualizar informações do dispositivo (modelo, firmware, capacidades) e
 * gerenciar o túnel para acesso externo.
 *
 * @page systems-page
 * @module SystemsPage
 *
 * @features
 * - Conexão com mixer de áudio via endereço IP (suporta Soundcraft)
 * - Ativação/desativação do túnel de acesso remoto
 * - Cópia do link do túnel para a área de transferência
 * - Exibição do modelo, firmware e capacidades da mixer em tempo real
 *
 * @dependencies
 * - createPageModule() — Módulo base de páginas com helpers de DOM e eventos
 * - MixerService — Serviço de conexão com a mixer (window.MixerService)
 * - AppStore — Store global para dados do dispositivo (window.AppStore)
 * - API /api/config — Retorna configuração do servidor (tunnelUrl)
 * - API /api/tunnel/toggle — Endpoint para alternar estado do túnel
 *
 * @events
 * - AppStore 'deviceInfo' — Atualiza display do modelo, firmware e capacidades
 *
 * @usage
 * 1. O usuário informa o IP da mixer no campo de input
 * 2. Clica em "Conectar" para iniciar a conexão via MixerService
 * 3. Use o botão de túnel para ativar/desativar acesso remoto
 * 4. Copie o link do túnel para compartilhar acesso externo
 *
 * @exposes window.SystemsPage
 *   - init()    — Inicializa a página e vincula eventos
 *   - destroy() — Destroi a página e remove subscriptions
 * =============================================================================
 */
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

        var connectBtn = pm._el('btn-reconnect-mixer');
        var ipInput = pm._el('mixer-ip-input');
        if (connectBtn) {
            pm._on(connectBtn, 'click', function () {
                var ip = ipInput ? ipInput.value.trim() : '';
                if (!ip) { alert('Informe o IP da mixer.'); return; }
                connectBtn.disabled = true;
                connectBtn.textContent = 'Conectando...';
                if (window.MixerService && typeof MixerService.connect === 'function') {
                    MixerService.connect(ip, 'soundcraft');
                }
                pm._setTimeout(function () {
                    connectBtn.disabled = false;
                    connectBtn.textContent = 'Conectar';
                }, 3000);
            });
        }

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
