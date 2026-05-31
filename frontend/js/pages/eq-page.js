/**
 * @fileoverview Página de Equalização — Guia de equalização por instrumento.
 *
 * Esta página exibe recomendações de equalização para diferentes instrumentos
 * e fontes sonoras. O usuário seleciona um instrumento e visualiza as
 * configurações de EQ recomendadas (frequência, ganho, Q) com visualização
 * gráfica da curva de equalização.
 *
 * ## Funcionalidades Principais
 * - Seletor de instrumento com lista de instrumentos disponíveis
 * - Exibe dados de EQ (frequência, ganho, Q) para o instrumento selecionado
 * - Renderização gráfica da curva de equalização via EqDisplayService
 * - Atualização automática ao mudar o instrumento selecionado
 *
 * ## Como Usar
 * 1. Selecione o instrumento no menu dropdown
 * 2. Visualize as configurações de EQ recomendadas
 * 3. Aplique as configurações na mesa conforme necessário
 *
 * ## Dependências e Integrações
 * - **createPageModule()**: Módulo base para páginas
 * - **window.eqData**: Objeto com dados de EQ por instrumento
 *   - Estrutura: `{ [nomeInstrumento]: { freq, gain, q, ... } }`
 * - **EqDisplayService**: Serviço de renderização do display de EQ
 *   - `renderEqDisplay(element, instrument, data)` — Renderiza display
 *
 * @module EqPage
 * @version 1.0.0
 */

'use strict';

(function () {
    const pm = createPageModule();

    function updateEqDisplay() {
        const select = pm._el('eq-instrument-select');
        const display = pm._el('eq-data-display');
        if (!select || !display) return;

        const data = window.eqData ? window.eqData[select.value] : null;
        if (window.EqDisplayService) {
            EqDisplayService.renderEqDisplay(display, select.value, data);
        }
    }

    function init() {
        const select = pm._el('eq-instrument-select');
        if (select) {
            pm._on(select, 'change', updateEqDisplay);
            updateEqDisplay();
        }
    }

    function destroy() {
        pm.destroy();
    }

    window.EqPage = {
        init: init,
        destroy: destroy
    };
})();
