/**
 * =============================================================================
 * SoundMaster — Página de Guia de Equalização (EQ)
 * =============================================================================
 *
 * Descrição:
 *     Módulo de orientação para equalização de instrumentos. Fornece dados
 *     de EQ pré-configurados para diferentes instrumentos e integra com
 *     IA para sugestões dinâmicas de equalização em tempo real.
 *
 * Funcionalidades:
 *     - Seleção de instrumento com dados de EQ pré-configurados
 *     - Configuração de canal (1-24) e auxiliar para envio
 *     - Exibição visual dos parâmetros de EQ (frequência, ganho, Q)
 *     - Sincronização com IA para sugestões de equalização
 *     - Renderização dinâmica dos dados de EQ via EqDisplayService
 *     - Geração automática de prompt para IA baseado em instrumento/canal
 *
 * Dados de EQ:
 *     Os dados são carregados de window.eqData e incluem:
 *     - Frequências centrais dos filtros
 *     - Ganhos em dB
 *     - Fatores de qualidade (Q)
 *     - Recomendações por instrumento
 *
 * Dependências:
 *     - eqData: Dados de EQ por instrumento (window.eqData)
 *     - EqDisplayService: Serviço de renderização de EQ
 *     - AIService: Serviço de inteligência artificial para sugestões
 *     - createPageModule(): Módulo base de páginas
 *
 * Integrações:
 *     - Integra com AIService para consultas de equalização
 *     - Conecta-se ao EqDisplayService para renderização
 *     - Suporta 24 canais de mixer e múltiplos auxiliares
 *
 * Uso:
 *     Para inicializar: EqGuidePage.init()
 *     Para destruir: EqGuidePage.destroy()
 *
 * Variável Global:
 *     window.EqGuidePage - Objeto público com init() e destroy()
 * =============================================================================
 */

'use strict';

(function () {
    const pm = createPageModule();

    function updateEqDisplay() {
        const select = pm._el('eq-guide-instrument-select');
        const display = pm._el('eq-data-display');
        if (!select || !display) return;

        const data = window.eqData ? window.eqData[select.value] : null;
        if (window.EqDisplayService) {
            EqDisplayService.renderEqDisplay(display, select.value, data);
        }
    }

    function init() {
        const select = pm._el('eq-guide-instrument-select');
        const channelSelect = pm._el('eq-guide-channel');
        const auxSelect = pm._el('eq-guide-aux');

        if (channelSelect) {
            channelSelect.innerHTML = '';
            for (var i = 1; i <= 24; i++) {
                var opt = document.createElement('option');
                opt.value = i;
                opt.className = 'bg-slate-900';
                opt.innerText = i.toString().padStart(2, '0');
                channelSelect.appendChild(opt);
            }
        }

        if (select) {
            pm._on(select, 'change', updateEqDisplay);
            updateEqDisplay();
        }

        const btnSync = pm._el('btn-sync-eq-ai');
        if (btnSync && select) {
            pm._on(btnSync, 'click', async () => {
                var instrument = select.options[select.selectedIndex].text;
                var channel = channelSelect ? channelSelect.value : 1;
                var aux = auxSelect ? auxSelect.value : 1;

                if (window.AIService) {
                    var msg = 'Equalizar ' + instrument + ' no canal ' + channel + ' e aux ' + aux + '. Verifique os niveis de EQ tanto no canal quanto no envio de aux.';
                    try {
                        await window.AIService.ask(msg, channel);
                        alert('🚀 Enviado para a IA: "' + msg + '"');
                    } catch (err) {
                        console.error('[EQGuidePage] AI call failed:', err);
                        alert('⚠️ Falha ao consultar a IA. Tente novamente.');
                    }
                } else {
                    console.error('[EQGuidePage] AIService not found.');
                }
            });
        }
    }

    function destroy() {
        pm.destroy();
    }

    window.EqGuidePage = {
        init: init,
        destroy: destroy
    };
})();
