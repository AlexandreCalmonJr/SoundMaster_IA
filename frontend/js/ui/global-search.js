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
            html += '<div class="sm-search-item-category" style="padding: 8px 12px 4px;">' + category + '</div>';
            pages.forEach(page => {
                const isActive = globalIdx === _activeIndex ? ' active' : '';
                html += '<button class="sm-search-item' + isActive + '" data-page="' + page.id + '" data-idx="' + globalIdx + '">'
                    + '<span style="font-size: 14px;">📄</span>'
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
