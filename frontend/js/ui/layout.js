/**
 * SoundMaster — layout.js
 * Controls the new two-panel sidebar, category flyout, breadcrumbs, and global toggles.
 */
(function () {
    'use strict';

    let _layoutController = null;

    function _el(id) {
        try {
            const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
            if (iframe && iframe.contentDocument) {
                const el = iframe.contentDocument.getElementById(id);
                if (el) return el;
            }
        } catch (_) {}
        return document.getElementById(id);
    }

    // Category → sub-items mapping
    const CATEGORIES = {
        measure: {
            title: 'Medir',
            items: [
                { id: 'rt60',         label: 'RT60' },
                { id: 'acustica',     label: 'Acústica' },
                { id: 'benchmarking', label: 'Benchmarking' },
                { id: 'spl-heatmap',  label: 'Mapa de Calor SPL' },
                { id: 'coverage-map', label: 'Mapa de Cobertura' },
            ]
        },
        analysis: {
            title: 'Analisar',
            items: [
                { id: 'analyzer',             label: 'FFT & Waterfall' },
                { id: 'analyzer-signals',     label: 'Gerador de Sinais' },
                { id: 'analyzer-calibration', label: 'Calibração' },
                { id: 'ir-measurement',       label: 'Resposta ao Impulso' },
                { id: 'feedback-detector',    label: 'Detector Feedback' },
                { id: 'eq-guide',             label: 'Guia de EQ' },
            ]
        },
        mixer: {
            title: 'Mixer',
            items: [
                { id: 'mixer-input',   label: 'Canais de Entrada' },
                { id: 'mixer-aux',     label: 'Monitores & Aux' },
                { id: 'mixer-fx',      label: 'Envios de Efeito' },
                { id: 'voice-presets', label: 'Presets de Voz' },
                { id: 'stage-plot',    label: 'Palco Virtual' },
                { id: 'ui24r-embed',   label: 'Mesa Original' },
            ]
        },
        eq: {
            title: 'EQ',
            items: [
                { id: 'eq',           label: 'Equalização' },
                { id: 'auto-eq',      label: 'Auto-EQ / Target Curve' },
                { id: 'delay-align',  label: 'Alinhamento Delay' },
            ]
        },
        automation: {
            title: 'Automação',
            items: [
                { id: 'automixer',     label: 'Auto-Mixer Dugan' },
                { id: 'scene-builder', label: 'Scene Builder' },
                { id: 'mixer-git',     label: 'Mixer Git' },
            ]
        },
        system: {
            title: 'Sistema',
            items: [
                { id: 'systems', label: 'Conexão Ui24R' },
                { id: 'hardware-diagnostics', label: 'Diagnóstico de Hardware' },
                { id: 'aes67',   label: 'Saúde de Cabos (AES67)' },
                { id: 'settings', label: 'Preferências' },
                { id: 'debug',    label: 'Console de Depuração' },
            ]
        },
    };

    let activeCategory = null;

    function initSidebar() {
        const panel = _el('category-panel');
        const panelTitle = _el('panel-title');
        const panelNav = _el('panel-nav');
        const sidebar = _el('app-sidebar');

        if (!panel || !panelNav) return;

        // Auto-close category panel when a sub-item is clicked
        panelNav.addEventListener('click', (e) => {
            const btn = e.target.closest('.panel-nav-btn');
            if (btn) {
                panel.classList.remove('open');
                sidebar?.classList.remove('panel-open');
                document.querySelectorAll('.rail-btn[data-category]').forEach(b => b.classList.remove('active'));
                activeCategory = null;
            }
        });

        // Handle rail button clicks
        document.querySelectorAll('.rail-btn').forEach(btn => {

            // Direct navigation buttons (home, tutorials, ai-chat, mobile)
            if (btn.hasAttribute('data-direct')) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const target = btn.getAttribute('data-target');

                    // Close category panel
                    panel.classList.remove('open');
                    sidebar?.classList.remove('panel-open');
                    activeCategory = null;

                    // Clear category rail active states
                    document.querySelectorAll('.rail-btn[data-category]').forEach(b => b.classList.remove('active'));

                    // Navigate
                    if (window.router) {
                        window.router.navigate(target);
                    }
                });
                return;
            }

            // Category buttons (open/close flyout panel)
            const category = btn.getAttribute('data-category');
            if (category && CATEGORIES[category]) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();

                    if (activeCategory === category) {
                        // Toggle off — close panel
                        panel.classList.remove('open');
                        sidebar?.classList.remove('panel-open');
                        btn.classList.remove('active');
                        activeCategory = null;
                        return;
                    }

                    // Open panel with this category's items
                    activeCategory = category;
                    const catData = CATEGORIES[category];

                    // Update panel title
                    if (panelTitle) panelTitle.textContent = catData.title;

                    // Build nav items
                    panelNav.innerHTML = catData.items.map(item => `
                        <button class="panel-nav-btn ${window.router?.currentPage === item.id ? 'active' : ''}" 
                                data-target="${item.id}">
                            <span class="nav-dot"></span>
                            ${item.label}
                        </button>
                    `).join('');

                    // Show panel
                    panel.classList.add('open');
                    sidebar?.classList.add('panel-open');

                    // Update rail active states
                    document.querySelectorAll('.rail-btn[data-category]').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.rail-btn[data-direct]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            }
        });
    }

    function initGlobalToggles() {
        const btnSidebar = _el('btn-toggle-sidebar');

        btnSidebar?.addEventListener('click', () => {
            const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem('sidebar-collapsed', isCollapsed);
        });

        // Restore saved states or collapse by default on small screens (<= 1024px)
        const isSmallScreen = window.innerWidth <= 1024;
        const savedSidebar = localStorage.getItem('sidebar-collapsed');

        if (savedSidebar === 'true' || (savedSidebar === null && isSmallScreen)) {
            document.body.classList.add('sidebar-collapsed');
        }
    }

    function initBreadcrumbs() {
        document.addEventListener('page-loaded', (e) => {
            const { title, category } = e.detail;
            const catEl = _el('breadcrumb-category');
            const sepEl = _el('breadcrumb-sep');
            const pageEl = _el('breadcrumb-page');

            // Fechar painel lateral ao navegar em telas menores (<= 1024px)
            if (window.innerWidth <= 1024) {
                activeCategory = null;
                const panel = _el('category-panel');
                const sidebar = _el('app-sidebar');
                panel?.classList.remove('open');
                sidebar?.classList.remove('panel-open');
                document.querySelectorAll('.rail-btn[data-category]').forEach(b => b.classList.remove('active'));
            }

            if (category) {
                if (catEl) { catEl.textContent = category; catEl.style.display = ''; }
                if (sepEl) sepEl.style.display = '';
                if (pageEl) pageEl.textContent = title;
            } else {
                if (catEl) catEl.style.display = 'none';
                if (sepEl) sepEl.style.display = 'none';
                if (pageEl) pageEl.textContent = title;
                
                // Se não há categoria, fechamos o painel e resetamos estado
                activeCategory = null;
                const panel = _el('category-panel');
                const sidebar = _el('app-sidebar');
                panel?.classList.remove('open');
                sidebar?.classList.remove('panel-open');
                document.querySelectorAll('.rail-btn[data-category]').forEach(b => b.classList.remove('active'));
            }
        }, { signal: _layoutController.signal });
    }

    // Auto-expand the correct category panel when navigating via cards/links
    function initAutoExpand() {
        document.addEventListener('page-loaded', (e) => {
            const { pageId, category } = e.detail;
            if (!category) return;

            const categoryMap = {
                'Medir': 'measure',
                'Analisar': 'analysis',
                'Mixer': 'mixer',
                'EQ': 'eq',
                'Automação': 'automation',
                'Sistema': 'system'
            };
            const catId = categoryMap[category];
            if (!catId || activeCategory === catId) return;

            // Simulate clicking the category rail button to open the panel
            const railBtn = document.querySelector(`.rail-btn[data-category="${catId}"]`);
            if (railBtn) railBtn.click();
        }, { signal: _layoutController.signal });
    }

    function initPageSpecifics() {
        // Analyzer subtabs
        document.querySelectorAll('.subtab-btn').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.subtab-btn').forEach(b => {
                    b.classList.remove('active', 'bg-slate-700', 'text-white');
                    b.classList.add('text-slate-400');
                });
                tab.classList.add('active', 'bg-slate-700', 'text-white');
                tab.classList.remove('text-slate-400');

                document.querySelectorAll('.analyzer-subtab').forEach(s => s.classList.add('hidden'));
                const target = _el(tab.getAttribute('data-subtab'));
                if (target) target.classList.remove('hidden');
            });
        });

        // Generic accordions
        document.querySelectorAll('.accordion-header').forEach(header => {
            header.addEventListener('click', () => {
                const content = header.nextElementSibling;
                if (content) {
                    content.style.display = content.style.display === 'block' ? 'none' : 'block';
                }
            });
        });
    }

    function init() {
        if (_layoutController) _layoutController.abort();
        _layoutController = new AbortController();

        initSidebar();
        initGlobalToggles();
        initBreadcrumbs();
        initAutoExpand();
        initPageSpecifics();

        document.addEventListener('page-loaded', () => {
            initPageSpecifics();
        }, { signal: _layoutController.signal });

        AppStore.subscribe('liteMode', function (liteMode) {
            const badge = _el('lite-badge');
            if (badge) {
                badge.style.display = liteMode ? 'inline' : 'none';
            }
            const aiBtn = document.querySelector('.rail-btn[data-target="ai-chat"]');
            if (aiBtn) {
                aiBtn.style.display = liteMode ? 'none' : '';
            }
        });
    }

    window.SoundMasterLayout = {
        init,
        destroy: function () { if (_layoutController) { _layoutController.abort(); _layoutController = null; } }
    };

    // NOTE: init() is called explicitly by app.js AFTER sidebar HTML is loaded.
    // Do NOT auto-init here — the sidebar DOM doesn't exist yet.
})();
