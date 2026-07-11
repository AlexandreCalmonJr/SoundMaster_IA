/**
 * SoundMaster — Global Search (Ctrl+K)
 * H6: Reconhecimento em vez de memorização — busca fuzzy sobre ROUTE_MAP
 */
(function () {
    'use strict';

    let _overlayEl = null;
    let _activeIndex = 0;
    let _filteredItems = [];

    function _getAllPages() {
        const map = window.ROUTE_MAP || {};
        return Object.entries(map)
            .filter(([, data]) => !data.redirect)
            .map(([id, data]) => ({
                id,
                title: data.title || id,
                category: data.category || 'Geral',
                path: data.path
            }));
    }

    function _fuzzyMatch(text, query) {
        const lower = text.toLowerCase();
        const q = query.toLowerCase();
        if (lower.includes(q)) return true;
        let qi = 0;
        for (let i = 0; i < lower.length && qi < q.length; i++) {
            if (lower[i] === q[qi]) qi++;
        }
        return qi === q.length;
    }

    function _getIcon(page) {
        const icons = {
            'Medir': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
            'Analisar': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
            'Mixer': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
            'EQ': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
            'Automação': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,
            'Sistema': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>`,
            'home': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-8 9 8"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-5h4v5h4a1 1 0 0 0 1-1v-9"/></svg>`,
            'tutorials': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
            'volunteer-mode': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
            'testbed': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
            'mobile': `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`
        };
        return icons[page.category] || icons[page.id] || `<svg class="sm-search-icon" width="16" height="16" style="flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    }

    function _renderResults(container, items, query) {
        if (items.length === 0) {
            container.innerHTML = '<div class="sm-search-empty">Nenhuma página encontrada para "' + query + '"</div>';
            return;
        }

        const grouped = {};
        items.forEach(item => {
            const cat = item.category || 'Geral';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        let html = '';
        let globalIdx = 0;
        Object.entries(grouped).forEach(([category, pages]) => {
            html += '<div class="sm-search-item-category">' + category + '</div>';
            pages.forEach(page => {
                const isActive = globalIdx === _activeIndex ? ' active' : '';
                html += '<button class="sm-search-item' + isActive + '" data-page="' + page.id + '" data-idx="' + globalIdx + '">'
                    + _getIcon(page)
                    + '<span>' + page.title + '</span>'
                    + '</button>';
                globalIdx++;
            });
        });
        container.innerHTML = html;
    }

    function _filter(query) {
        const allPages = _getAllPages();
        if (!query) {
            _filteredItems = allPages;
        } else {
            _filteredItems = allPages.filter(p =>
                _fuzzyMatch(p.title, query) || _fuzzyMatch(p.category, query) || _fuzzyMatch(p.id, query)
            );
        }
        _activeIndex = 0;
    }

    function open() {
        if (_overlayEl) return;

        _overlayEl = document.createElement('div');
        _overlayEl.id = 'sm-search-overlay';
        _overlayEl.innerHTML = `
            <div id="sm-search-card">
                <input id="sm-search-input" type="text" placeholder="Buscar páginas, ferramentas, funcionalidades..." autocomplete="off" autofocus>
                <div id="sm-search-results"></div>
                <div id="sm-search-footer">
                    <div style="display:flex;gap:8px;align-items:center;">
                        <span class="sm-search-kbd">↑↓</span> Navegar
                        <span class="sm-search-kbd">Enter</span> Abrir
                        <span class="sm-search-kbd">Esc</span> Fechar
                    </div>
                    <span>${_getAllPages().length} páginas</span>
                </div>
            </div>
        `;
        document.body.appendChild(_overlayEl);

        const input = document.getElementById('sm-search-input');
        const results = document.getElementById('sm-search-results');

        _filter('');
        _renderResults(results, _filteredItems, '');

        input.addEventListener('input', () => {
            _filter(input.value.trim());
            _renderResults(results, _filteredItems, input.value.trim());
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                _activeIndex = Math.min(_activeIndex + 1, _filteredItems.length - 1);
                _renderResults(results, _filteredItems, input.value.trim());
                const active = results.querySelector('.sm-search-item.active');
                if (active) active.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                _activeIndex = Math.max(_activeIndex - 1, 0);
                _renderResults(results, _filteredItems, input.value.trim());
                const active = results.querySelector('.sm-search-item.active');
                if (active) active.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const item = _filteredItems[_activeIndex];
                if (item && window.router) {
                    window.router.navigate(item.id);
                    close();
                }
            }
        });

        results.addEventListener('click', (e) => {
            const btn = e.target.closest('.sm-search-item');
            if (btn) {
                const pageId = btn.getAttribute('data-page');
                if (pageId && window.router) {
                    window.router.navigate(pageId);
                    close();
                }
            }
        });

        _overlayEl.addEventListener('click', (e) => {
            if (e.target === _overlayEl) close();
        });

        requestAnimationFrame(() => input.focus());
    }

    function close() {
        if (_overlayEl) {
            _overlayEl.remove();
            _overlayEl = null;
        }
    }

    function toggle() {
        if (_overlayEl) close();
        else open();
    }

    window.SoundMasterSearch = { open, close, toggle };
})();
