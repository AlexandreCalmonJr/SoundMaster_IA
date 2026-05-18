/**
 * SoundMaster SPA Router
 * Manages dynamic page loading with transitions and breadcrumb data.
 */

const ROUTE_MAP = {
    'home':              { path: 'pages/home.html',              title: 'Dashboard',           category: null },
    'rt60':              { path: 'pages/rt60.html',              title: 'RT60 & Acústica',     category: 'Medir' },
    'benchmarking':      { path: 'pages/benchmarking.html',      title: 'Benchmarking',        category: 'Medir' },
    'spl-heatmap':       { path: 'pages/spl-heatmap.html',       title: 'Mapa SPL',            category: 'Medir' },
    'analyzer':          { path: 'pages/analyzer.html',          title: 'FFT & Waterfall',     category: 'Analisar' },
    'feedback-detector': { path: 'pages/feedback-detector.html', title: 'Detector Feedback',   category: 'Analisar' },
    'eq-guide':          { path: 'pages/eq-guide.html',          title: 'Guia de EQ',          category: 'Analisar' },
    'eq':                { path: 'pages/eq.html',                title: 'Equalização',         category: 'EQ' },
    'auto-eq':           { path: 'pages/auto-eq.html',           title: 'Auto-EQ / Target Curve', category: 'EQ' },
    'semantic-eq':       { path: 'pages/semantic-eq.html',       title: 'EQ Semântico',        category: 'EQ' },
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
};

class Router {
    constructor() {
        this.currentPage = null;
        this.routes = {};

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

            // ✅ T13: Dispatch page-unload para cleanup da página anterior (P24)
            if (this.currentPage) {
                // Chama destroy() do page module se existir
                const prevModule = window[this._getPageModuleName(this.currentPage)];
                if (prevModule && typeof prevModule.destroy === 'function') {
                    prevModule.destroy();
                }
                window.dispatchEvent(new CustomEvent('page-unload', { detail: { pageId: this.currentPage } }));
            }

        const container = document.getElementById('agent-workspace');
        if (!container) return;

        try {
            console.log(`[Router] Navegando para: ${pageId}`);

            // Exit animation
            container.classList.remove('page-enter');
            container.classList.add('page-exit');
            await this._wait(200);

            // Fetch new page
            const response = await fetch(this.routes[pageId]);
            if (!response.ok) throw new Error(`Erro ao carregar: ${pageId}`);

            const html = await response.text();
            
            // ✅ Sanitização básica via DOMParser
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Verificar se o parse retornou algo válido e seguro
            if (doc.body.children.length === 0 && html.trim().length > 0) {
                 container.textContent = 'Erro ao processar conteúdo da página.';
            } else {
                container.replaceChildren(...Array.from(doc.body.children).map(child => child.cloneNode(true)));
                
                // ✅ Re-executar scripts inline para garantir que a lógica da página funcione
                container.querySelectorAll('script').forEach(oldScript => {
                    const newScript = document.createElement('script');
                    Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
                    newScript.textContent = oldScript.textContent;
                    oldScript.replaceWith(newScript);
                });
            }
            
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

            // Chama init() do page module se existir
            const pageModule = window[this._getPageModuleName(pageId)];
            if (pageModule && typeof pageModule.init === 'function') {
                pageModule.init();
            }

            // Cleanup animation class after it completes
            setTimeout(() => container.classList.remove('page-enter'), 400);

        } catch (error) {
            console.error('[Router] Erro na navegação:', error);
            container.classList.remove('page-exit');
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                    <div class="text-6xl">⚠️</div>
                    <h2 class="text-2xl font-black text-white">Página não encontrada</h2>
                    <p class="text-slate-400 text-sm">Não foi possível carregar esta página.</p>
                    <button onclick="history.back()" class="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold transition-all mt-4">
                        Voltar
                    </button>
                </div>
            `;
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
            'analyzer': 'AnalyzerPage',
            'rt60': 'RT60Page',
            'auto-eq': 'AutoEqPage',
            'scene-builder': 'SceneBuilderPage',
            'semantic-eq': 'SemanticEqPage',
            'debug': 'DebugPage',
            'systems': 'SystemsPage',
            'volunteer-mode': 'VolunteerPage',
            'automixer': 'AutomixerPage',
            'mixer-git': 'MixerGitPage',
            'testbed': 'TestbedPage',
            'stage-plot': 'StagePlotPage',
        };
        return map[pageId] || null;
    }
}

window.ROUTE_MAP = ROUTE_MAP;
window.router = new Router();
