/**
 * @fileoverview Página de Heatmap SPL — Visualização de mapa de calor de
 * Sound Pressure Level (SPL) para análise de cobertura sonora.
 *
 * Esta página delega toda a lógica de configuração e renderização do
 * heatmap para o módulo SoundMasterHeatmap. O heatmap mostra a distribuição
 * de SPL em um mapa espacial do ambiente, permitindo identificar áreas
 * com cobertura insuficiente ou excessiva.
 *
 * ## Funcionalidades Principais
 * - Mapa de calor de SPL (Sound Pressure Level) em tempo real
 * - Visualização espacial da distribuição de volume sonoro
 * - Identificação de áreas com cobertura irregular
 * - Integração com medições ao vivo do analisador
 *
 * ## Como Usar
 * 1. A página inicializa automaticamente o heatmap
 * 2. O mapa é atualizado com dados de SPL em tempo real
 * 3. Cores quentes indicam alto SPL, cores frias indicam baixo SPL
 *
 * ## Dependências e Integrações
 * - **SoundMasterHeatmap**: Módulo principal de renderização
 *   - `init()` — Inicializa o heatmap e suas dependências
 *   - `destroy()` — Limpa recursos e event listeners
 * - **SoundMasterAnalyzer**: Fonte de dados de SPL ao vivo
 *
 * @module SplHeatmapPage
 * @version 1.0.0
 */

/**
 * SoundMaster — SPL Heatmap Page Module
 * Delegates heatmap configuration and spatial averaging rendering to SoundMasterHeatmap.
 */

'use strict';

(function () {
    function init() {
        if (window.SoundMasterHeatmap && typeof window.SoundMasterHeatmap.init === 'function') {
            window.SoundMasterHeatmap.init();
        } else {
            console.error('[SplHeatmapPage] SoundMasterHeatmap not found.');
        }
    }

    function destroy() {
        if (window.SoundMasterHeatmap && typeof window.SoundMasterHeatmap.destroy === 'function') {
            window.SoundMasterHeatmap.destroy();
        }
    }

    window.SplHeatmapPage = {
        init: init,
        destroy: destroy
    };
})();
