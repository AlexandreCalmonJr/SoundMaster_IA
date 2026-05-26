/**
 * SoundMaster Iframe Shell Router
 * Manages dynamic page loading inside an isolated iframe with transitions and breadcrumb data.
 */

'use strict';

const ROUTE_MAP = {
    'home':              { path: 'pages/home.html',              title: 'Dashboard',           category: null },
    'rt60':              { path: 'pages/rt60.html',              title: 'RT60',                category: 'Medir' },
    'acustica':          { path: 'pages/acustica.html',          title: 'Acústica',            category: 'Medir' },
    'benchmarking':      { path: 'pages/benchmarking.html',      title: 'Benchmarking',        category: 'Medir' },
    'spl-heatmap':       { path: 'pages/spl-heatmap.html',       title: 'Mapa SPL',            category: 'Medir' },
    'analyzer':             { path: 'pages/analyzer.html',             title: 'FFT & Waterfall',     category: 'Analisar' },
    'analyzer-signals':     { path: 'pages/analyzer-signals.html',     title: 'Gerador de Sinais',   category: 'Analisar' },
    'analyzer-calibration': { path: 'pages/analyzer-calibration.html', title: 'Calibração',          category: 'Analisar' },
    'feedback-detector':    { path: 'pages/feedback-detector.html',    title: 'Detector Feedback',   category: 'Analisar' },
    'eq-guide':             { path: 'pages/eq-guide.html',             title: 'Guia de EQ',          category: 'Analisar' },
    'eq':                { path: 'pages/eq.html',                title: 'Equalização',         category: 'EQ' },
    'auto-eq':           { path: 'pages/auto-eq.html',           title: 'Auto-EQ / Target Curve', category: 'EQ' },
    'mixer-git':         { path: 'pages/mixer-git.html',         title: 'Mixer Git',           category: 'Automação' },
    'mixer-input':       { path: 'pages/mixer-input.html',       title: 'Canais de Entrada',   category: 'Mixer' },
    'mixer-aux':         { path: 'pages/mixer-aux.html',         title: 'Monitores & Aux',     category: 'Mixer' },
    'mixer-fx':          { path: 'pages/mixer-fx.html',          title: 'Envios de Efeito',   category: 'Mixer' },
    'voice-presets':     { path: 'pages/voice-presets.html',     title: 'Presets de Voz',      category: 'Mixer' },
    'stage-plot':        { path: 'pages/stage-plot.html',        title: 'Palco Virtual',       category: 'Mixer' },
    'automixer':         { path: 'pages/automixer.html',         title: 'Auto-Mixer Dugan',   category: 'Automação' },
    'scene-builder':     { path: 'pages/scene-builder.html',     title: 'Scene Builder',       category: 'Automação' },
    'systems':           { path: 'pages/systems.html',           title: 'Conexão Ui24R',       category: 'Sistema' },
    'aes67':             { path: 'pages/aes67.html',             title: 'Saúde de Cabos',      category: 'Sistema' },
    'debug':             { path: 'pages/debug.html',             title: 'Console de Depuração', category: 'Sistema' },
    'settings':          { path: 'pages/settings.html',          title: 'Preferências',        category: 'Sistema' },
    'ai-chat':           { path: 'pages/ai-chat.html',           title: 'Assistente IA',       category: null },
    'mobile':            { path: 'pages/mobile.html',            title: 'Modo Remoto',         category: null },
    'volunteer-mode':    { path: 'pages/volunteer-mode.html',  title: 'Modo Voluntário',     category: null },
    'testbed':           { path: 'pages/testbed.html',          title: 'Testbed',             category: null },
    'tutorials':         { path: 'pages/tutorials.html',        title: 'Tutoriais',           category: null },
};

class Router {
    constructor() {
        this.currentPage = null;
        this.routes = {};

        // Script paths mapping for dynamic import in iframe
        this.scriptPaths = {
            'home': 'js/pages/home-page.js',
            'rt60': 'js/pages/rt60-page.js',
            'acustica': 'js/pages/acustica-page.js',
            'benchmarking': 'js/pages/benchmarking-page.js',
            'spl-heatmap': 'js/pages/spl-heatmap-page.js',
            'analyzer': 'js/pages/analyzer-page.js',
            'analyzer-signals': 'js/pages/analyzer-signals-page.js',
            'analyzer-calibration': 'js/pages/analyzer-calibration-page.js',
            'feedback-detector': 'js/pages/feedback-detector-page.js',
            'eq-guide': 'js/pages/eq-guide-page.js',
            'eq': 'js/pages/eq-page.js',
            'auto-eq': 'js/pages/auto-eq-page.js',
            'mixer-git': 'js/pages/mixer-git-page.js',
            'mixer-input': 'js/pages/mixer-input-page.js',
            'mixer-aux': 'js/pages/mixer-aux-page.js',
            'mixer-fx': 'js/pages/mixer-fx-page.js',
            'voice-presets': 'js/pages/voice-presets-page.js',
            'stage-plot': 'js/pages/stage-plot-page.js',
            'automixer': 'js/pages/automixer-page.js',
            'scene-builder': 'js/pages/scene-builder-page.js',
            'systems': 'js/pages/systems-page.js',
            'aes67': 'js/pages/aes67-page.js',
            'debug': 'js/pages/debug-page.js',
            'settings': 'js/pages/settings-page.js',
            'ai-chat': 'js/pages/ai-chat-page.js',
            'mobile': 'js/pages/mobile-page.js',
            'volunteer-mode': 'js/pages/volunteer-page.js',
            'testbed': 'js/pages/testbed-page.js',
            'tutorials': 'js/pages/tutorials-page.js',
        };

        // Page-specific CSS mapping
        this.cssPerPage = {
            'auto-eq':    ['css/auto-eq.css'],
            'mixer-git':  ['css/mixer-git.css'],
            'stage-plot': ['css/stage-plot.css'],
        };

        // Build simple route map for backward compat
        for (const [id, data] of Object.entries(ROUTE_MAP)) {
            this.routes[id] = data.path;
        }

        // Click delegation for nav buttons
        document.addEventListener('click', (e) => {
            const navBtn = e.target.closest('[data-target]');
            if (navBtn && this.routes[navBtn.getAttribute('data-target')]) {
                const target = navBtn.getAttribute('data-target');
                this.navigate(target);
            }
        });
    }

    async navigate(pageId) {
        if (this.currentPage === pageId) return;
        if (!ROUTE_MAP[pageId]) {
            console.warn(`[Router] Rota desconhecida: ${pageId}`);
            return;
        }

        if (window.AuthService && !AuthService.isAuthenticated()) {
            console.log('[Router] Redirecionando para auth.html (não autenticado)');
            window.location.replace('auth.html');
            return;
        }

        // ✅ T13: Dispatch page-unload para cleanup da página anterior (P24)
        if (this.currentPage) {
            const iframe = document.getElementById('agent-workspace-iframe');
            if (iframe && iframe.contentWindow) {
                const prevModule = iframe.contentWindow[this._getPageModuleName(this.currentPage)];
                if (prevModule && typeof prevModule.destroy === 'function') {
                    try {
                        prevModule.destroy();
                    } catch (e) {
                        console.error('[Router] Erro ao destruir modulo anterior:', e);
                    }
                }
            }
            window.dispatchEvent(new CustomEvent('page-unload', { detail: { pageId: this.currentPage } }));
        }

        const container = document.getElementById('agent-workspace');
        const iframe = document.getElementById('agent-workspace-iframe');
        if (!container || !iframe) return;

        try {
            console.log(`[Router] Navegando para: ${pageId}`);

            // Exit animation
            container.classList.remove('page-enter');
            container.classList.add('page-exit');
            await this._wait(200);

            // Fetch new page HTML fragment
            const response = await fetch(this.routes[pageId]);
            if (!response.ok) throw new Error(`Erro ao carregar: ${pageId}`);
            const html = await response.text();

            // Prepare the HTML content with styles and page bridge
            const scriptPath = this._getPageScriptPath(pageId);
            const moduleName = this._getPageModuleName(pageId);

            // Generate conditional CSS link tags
            let conditionalCssTags = '';
            const pageCss = this.cssPerPage[pageId];
            if (pageCss) {
                pageCss.forEach(href => {
                    conditionalCssTags += `<link rel="stylesheet" href="${href}">\n`;
                });
            }

            let scriptTags = `
                <script src="js/core/page-bridge.js"></script>
                <script src="js/core/page-utils.js"></script>
            `;
            if (scriptPath) {
                scriptTags += `<script src="${scriptPath}"></script>`;
            }

            const pageDepsMap = {
                'analyzer-calibration': [
                    'js/services/calibration.js'
                ]
            };

            const deps = pageDepsMap[pageId];
            if (deps) {
                deps.forEach(dep => {
                    scriptTags += `<script src="${dep}"></script>`;
                });
            }

            // Inline script inside the iframe to trigger init and notify parent
            scriptTags += `
                <script>
                    document.addEventListener('DOMContentLoaded', () => {
                        const moduleName = '${moduleName || ''}';
                        if (moduleName && window[moduleName] && typeof window[moduleName].init === 'function') {
                            try {
                                window[moduleName].init();
                            } catch (e) {
                                console.error('[Iframe] Erro ao inicializar modulo ' + moduleName + ':', e);
                            }
                        }
                        
                        // Notify parent router that the page is fully loaded and initialized
                        const event = new CustomEvent('iframe-loaded', {
                            detail: { pageId: '${pageId}' }
                        });
                        window.parent.document.dispatchEvent(event);
                    });
                </script>
            `;

            const fullHtml = `
            <!DOCTYPE html>
            <html lang="pt-br">
            <head>
                <meta charset="UTF-8">
                <link rel="stylesheet" href="css/styles.css">
                ${conditionalCssTags}
                <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400&display=swap" rel="stylesheet">
                ${scriptTags}
            </head>
            <body class="bg-transparent text-slate-200" style="margin: 0; padding: 0; overflow-x: hidden;">
                ${html}
            </body>
            </html>
            `;

            // We set up a one-time listener for the custom 'iframe-loaded' event
            const loadPromise = new Promise((resolve) => {
                const onIframeLoaded = (e) => {
                    if (e.detail.pageId === pageId) {
                        document.removeEventListener('iframe-loaded', onIframeLoaded);
                        resolve();
                    }
                };
                document.addEventListener('iframe-loaded', onIframeLoaded);
            });

            // Write full HTML content to iframe
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            iframeDoc.open();
            iframeDoc.write(fullHtml);
            iframeDoc.close();

            // Wait for the DOMContentLoaded and script init to complete inside the iframe
            await loadPromise;

            this.currentPage = pageId;

            // Enter animation
            container.classList.remove('page-exit');
            container.classList.add('page-enter');

            // Update sidebar active states
            this.updateActiveLinks(pageId);

            // Dispatch page-loaded event with route metadata
            const routeData = ROUTE_MAP[pageId];
            document.dispatchEvent(new CustomEvent('page-loaded', {
                detail: {
                    pageId,
                    title: routeData.title,
                    category: routeData.category
                }
            }));

            // Cleanup animation class after it completes
            setTimeout(() => container.classList.remove('page-enter'), 400);

        } catch (error) {
            console.error('[Router] Erro na navegação:', error);
            container.classList.remove('page-exit');
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            iframeDoc.open();
            iframeDoc.write(`
                <html lang="pt-br">
                <head>
                    <link rel="stylesheet" href="css/styles.css">
                </head>
                <body class="bg-transparent text-slate-200 flex flex-col items-center justify-center min-h-[60vh] gap-4">
                    <div class="text-6xl">⚠️</div>
                    <h2 class="text-2xl font-black text-white">Página não encontrada</h2>
                    <p class="text-slate-400 text-sm">Não foi possível carregar esta página.</p>
                    <button onclick="window.parent.history.back()" class="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold transition-all mt-4">
                        Voltar
                    </button>
                </body>
                </html>
            `);
            iframeDoc.close();
        }
    }

    updateActiveLinks(pageId) {
        // Update panel nav buttons
        document.querySelectorAll('.panel-nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-target') === pageId);
        });

        // Update rail buttons (direct links)
        document.querySelectorAll('.rail-btn[data-direct]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-target') === pageId);
        });

        // Find which category this page belongs to and highlight rail icon
        const routeData = ROUTE_MAP[pageId];
        if (routeData && routeData.category) {
            const categoryMap = {
                'Medir': 'measure',
                'Analisar': 'analysis',
                'Mixer': 'mixer',
                'EQ': 'eq',
                'Automação': 'automation',
                'Sistema': 'system'
            };
            const catId = categoryMap[routeData.category];
            document.querySelectorAll('.rail-btn[data-category]').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-category') === catId);
            });
        }
    }

    getRouteData(pageId) {
        return ROUTE_MAP[pageId] || null;
    }

    _wait(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    _getPageModuleName(pageId) {
        const map = {
            'home': 'HomePage',
            'rt60': 'RT60Page',
            'acustica': 'AcusticaPage',
            'benchmarking': 'BenchmarkingPage',
            'spl-heatmap': 'SplHeatmapPage',
            'analyzer': 'AnalyzerPage',
            'analyzer-signals': 'AnalyzerSignalsPage',
            'analyzer-calibration': 'AnalyzerCalibrationPage',
            'feedback-detector': 'FeedbackDetectorPage',
            'eq-guide': 'EqGuidePage',
            'eq': 'EqPage',
            'auto-eq': 'AutoEqPage',
            'mixer-git': 'MixerGitPage',
            'mixer-input': 'MixerInputPage',
            'mixer-aux': 'MixerAuxPage',
            'mixer-fx': 'MixerFxPage',
            'voice-presets': 'VoicePresetsPage',
            'stage-plot': 'StagePlotPage',
            'automixer': 'AutomixerPage',
            'scene-builder': 'SceneBuilderPage',
            'systems': 'SystemsPage',
            'aes67': 'Aes67Page',
            'debug': 'DebugPage',
            'settings': 'SettingsPage',
            'ai-chat': 'AiChatPage',
            'mobile': 'MobilePage',
            'volunteer-mode': 'VolunteerPage',
            'testbed': 'TestbedPage',
            'tutorials': 'TutorialsPage',
        };
        return map[pageId] || null;
    }

    _getPageScriptPath(pageId) {
        return this.scriptPaths[pageId] || null;
    }
}

window.ROUTE_MAP = ROUTE_MAP;
window.router = new Router();
