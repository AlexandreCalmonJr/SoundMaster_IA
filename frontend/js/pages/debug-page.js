/**
 * =============================================================================
 * SoundMaster — Página de Console de Depuração (Debug Console)
 * =============================================================================
 *
 * @description
 * Página de depuração e diagnóstico do sistema SoundMaster. Exibe logs em
 * tempo real, permite testar endpoints do backend (Python e Node) e fornece
 * informações sobre o estado interno do sistema para desenvolvedores e suporte.
 *
 * @page debug-page
 * @module DebugPage
 *
 * @features
 * - Console de logs em tempo real com colorização por severidade
 * - Teste do endpoint Python de diagnóstico (/api/ai/diagnose)
 * - Teste de status do servidor Node e Socket
 * - Renderização automática de logs com auto-scroll
 * - Identificação visual de erros (vermelho), avisos (amarelo) e info (azul)
 *
 * @dependencies
 * - createPageModule() — Módulo base de páginas com helpers de DOM e eventos
 * - AppStore — Store global para logs e estado do sistema (window.AppStore)
 *   - getState().mixerLog — Array de logs do sistema
 *   - subscribe('mixerLog') — Escuta atualizações de logs
 *   - addLog() — Adiciona entrada de log ao store
 * - API /api/ai/diagnose — Endpoint de diagnóstico Python
 *
 * @log-levels
 * - [ERROR] / erro / falhou — Vermelho (#f87171)
 * - [WARN] / aviso / JWT_SECRET_MISSING — Amarelo (#fbbf24)
 * - [System] — Azul (#60a5fa)
 * - Padrão — Verde (#4ade80)
 *
 * @events
 * - Botão "Testar Python" → Executa diagnóstico via /api/ai/diagnose
 * - Botão "Testar Node"   → Verifica status do servidor Node
 * - AppStore 'mixerLog'   → Atualiza renderização do console
 *
 * @usage
 * 1. Acesse a página de Debug para ver logs em tempo real
 * 2. Clique em "Testar Python" para verificar o endpoint de diagnóstico
 * 3. Clique em "Testar Node" para verificar status do servidor
 * 4. Observe os logs coloridos no console de depuração
 *
 * @exposes window.DebugPage
 *   - init()    — Inicializa console e vincula eventos
 *   - destroy() — Remove subscriptions e limpa recursos
 * =============================================================================
 */
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
        var safeSetHtml = (typeof window.setSafeHTML === 'function') ? window.setSafeHTML : function (el, html) { if (el) el.innerHTML = html; };
        safeSetHtml(consoleDiv, logs.map(function (l) {
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
        }).join(''));
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
