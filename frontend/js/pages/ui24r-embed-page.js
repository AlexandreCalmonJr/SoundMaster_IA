/**
 * =============================================================================
 * SoundMaster — Página do Mixer Original (Ui24R Embed)
 * =============================================================================
 *
 * @description
 * Carrega a interface nativa da Soundcraft Ui24R em tela cheia via iframe,
 * com sincronização reativa ao status online/offline da mesa de som.
 *
 * @page ui24r-embed-page
 * @module Ui24rEmbedPage
 *
 * @features
 * - IFrame reativo que exibe a interface original da mesa (Ui24R)
 * - Botão de recarga rápida para re-sincronização do IFrame
 * - Placeholder de aviso em caso de mesa offline
 * - Atalho direto para a página de conectividade para configurar o IP
 *
 * @dependencies
 * - createPageModule() — Helper de módulos de página
 * - AppStore — Store global do aplicativo
 * - Router — Navegação entre telas do aplicativo
 */
'use strict';

(function () {
    var pm = createPageModule();
    var _statusUnsub = null;
    var _ipUnsub = null;
    var _lastLoadedIp = null;

    function _updateMixerState(isOnline, currentIp) {
        var statusDot = pm._el('ui24r-status-dot');
        var statusText = pm._el('ui24r-status-text');
        var iframeContainer = pm._el('ui24r-iframe-container');
        var offlinePlaceholder = pm._el('ui24r-offline-placeholder');
        var iframe = pm._el('ui24r-iframe');
        var btnReload = pm._el('btn-ui24r-reload');

        if (!statusDot || !statusText || !iframeContainer || !offlinePlaceholder || !iframe) {
            return;
        }

        if (isOnline && currentIp) {
            // Mesa Online: Atualizar status para Verde (Online)
            pm._toggleClasses(statusDot, ['bg-green-500'], ['bg-red-500']);
            pm._toggleClasses(statusText, ['text-green-400'], ['text-red-400']);
            statusText.textContent = 'Online';

            // Alternar visibilidade
            iframeContainer.classList.remove('hidden');
            offlinePlaceholder.classList.add('hidden');

            if (btnReload) btnReload.disabled = false;

            // Carregar o iframe apenas se o IP mudou ou se não estava carregado
            var targetSrc = 'http://' + currentIp;
            if (_lastLoadedIp !== currentIp || !iframe.src || iframe.src === 'about:blank') {
                console.log('[Ui24rEmbed] Carregando interface nativa no iframe:', targetSrc);
                iframe.src = targetSrc;
                _lastLoadedIp = currentIp;
            }
        } else {
            // Mesa Offline: Atualizar status para Vermelho (Offline)
            pm._toggleClasses(statusDot, ['bg-red-500'], ['bg-green-500']);
            pm._toggleClasses(statusText, ['text-red-400'], ['text-green-400']);
            statusText.textContent = 'Offline';

            // Alternar visibilidade
            iframeContainer.classList.add('hidden');
            offlinePlaceholder.classList.remove('hidden');

            if (btnReload) btnReload.disabled = true;

            // Parar o iframe para liberar recursos
            if (iframe.src && iframe.src !== 'about:blank') {
                iframe.src = 'about:blank';
            }
            _lastLoadedIp = null;
        }
    }

    function init() {
        console.log('[Ui24rEmbedPage] Inicializando controlador...');

        var btnReload = pm._el('btn-ui24r-reload');
        var btnReconnect = pm._el('btn-ui24r-reconnect');
        var iframe = pm._el('ui24r-iframe');

        if (btnReload && iframe) {
            pm._on(btnReload, 'click', function () {
                var currentIp = AppStore.get('mixerIp');
                if (currentIp && AppStore.get('mixerOnline')) {
                    console.log('[Ui24rEmbedPage] Recarregando iframe da mesa...');
                    iframe.src = 'http://' + currentIp;
                }
            });
        }

        if (btnReconnect) {
            pm._on(btnReconnect, 'click', function () {
                if (window.router) {
                    window.router.navigate('systems');
                }
            });
        }

        // Inscrever no estado do AppStore
        if (window.AppStore) {
            var handleStoreUpdate = function () {
                var isOnline = !!AppStore.get('mixerOnline');
                var currentIp = AppStore.get('mixerIp');
                _updateMixerState(isOnline, currentIp);
            };

            _statusUnsub = AppStore.subscribe('mixerOnline', handleStoreUpdate);
            _ipUnsub = AppStore.subscribe('mixerIp', handleStoreUpdate);

            // Trigger inicial
            handleStoreUpdate();
        }
    }

    function destroy() {
        console.log('[Ui24rEmbedPage] Destruindo controlador...');
        pm.destroy();

        if (_statusUnsub) {
            _statusUnsub();
            _statusUnsub = null;
        }
        if (_ipUnsub) {
            _ipUnsub();
            _ipUnsub = null;
        }
        _lastLoadedIp = null;
    }

    window.Ui24rEmbedPage = { init: init, destroy: destroy };
})();
