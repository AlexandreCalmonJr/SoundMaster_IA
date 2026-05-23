/**
 * SoundMaster — layout.js
 * Controls the new two-panel sidebar, category flyout, breadcrumbs, and global toggles.
 */
(function () {
    'use strict';

    function _el(id) {
        const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
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
            ]
        },
        analysis: {
            title: 'Analisar',
            items: [
                { id: 'analyzer',             label: 'FFT & Waterfall' },
                { id: 'analyzer-signals',     label: 'Gerador de Sinais' },
                { id: 'analyzer-calibration', label: 'Calibração' },
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
            ]
        },
        eq: {
            title: 'EQ',
            items: [
                { id: 'eq',           label: 'Equalização' },
                { id: 'auto-eq',      label: 'Auto-EQ / Target Curve' },
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

        // Handle rail button clicks
        document.querySelectorAll('.rail-btn').forEach(btn => {

            // Direct navigation buttons (home, tutorials, ai-chat, mobile)
            if (btn.hasAttribute('data-direct')) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
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
        const btnMixer = _el('btn-toggle-mixer');
        const btnMain = _el('btn-toggle-main');
        const txtMixer = _el('txt-toggle-mixer');

        btnSidebar?.addEventListener('click', () => {
            const isCollapsed = document.body.classList.toggle('sidebar-collapsed');
            localStorage.setItem('sidebar-collapsed', isCollapsed);
        });

        btnMixer?.addEventListener('click', () => {
            const isCollapsed = document.body.classList.toggle('mixer-collapsed');
            if (txtMixer) {
                txtMixer.innerText = isCollapsed ? 'Mostrar' : 'Mixer';
            }
            localStorage.setItem('mixer-collapsed', isCollapsed);
        });

        btnMain?.addEventListener('click', () => {
            document.body.classList.toggle('main-collapsed');
        });

        // Restore saved states
        if (localStorage.getItem('sidebar-collapsed') === 'true') {
            document.body.classList.add('sidebar-collapsed');
        }
        if (localStorage.getItem('mixer-collapsed') === 'true') {
            document.body.classList.add('mixer-collapsed');
            if (txtMixer) txtMixer.innerText = 'Mostrar';
        }
    }

    function initBreadcrumbs() {
        document.addEventListener('page-loaded', (e) => {
            const { title, category } = e.detail;
            const catEl = _el('breadcrumb-category');
            const sepEl = _el('breadcrumb-sep');
            const pageEl = _el('breadcrumb-page');

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
        });
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
        });
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
        initSidebar();
        initGlobalToggles();
        initBreadcrumbs();
        initAutoExpand();
        initPageSpecifics();
    }

    window.SoundMasterLayout = { init };

    // NOTE: init() is called explicitly by app.js AFTER sidebar HTML is loaded.
    // Do NOT auto-init here — the sidebar DOM doesn't exist yet.

    // Re-init page-specific logic on route change
    document.addEventListener('page-loaded', () => {
        initPageSpecifics();
    });
})();
