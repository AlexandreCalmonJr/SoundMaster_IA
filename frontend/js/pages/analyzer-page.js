/**
 * =============================================================================
 * SoundMaster — Página Principal do Analisador
 * =============================================================================
 *
 * Descrição:
 *     Módulo principal da página de análise de áudio. Todos os bindings do 
 *     DOM e controles do gráfico/RTA são tratados diretamente pelos módulos 
 *     core dedicados (analyzer.js, tf-visualizer.js, spl-display.js, etc.).
 *
 * Uso:
 *     Para inicializar a página: AnalyzerPage.init()
 *     Para destruir a página: AnalyzerPage.destroy()
 * =============================================================================
 */

'use strict';

(function () {
    var pm = createPageModule();

    function init() {
        console.log('[AnalyzerPage] Inicializado.');
    }

    function destroy() {
        pm.destroy();
        console.log('[AnalyzerPage] Destruído.');
    }

    window.AnalyzerPage = { init: init, destroy: destroy };
})();
