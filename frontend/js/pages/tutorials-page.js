'use strict';

(function () {
    var pm = createPageModule();
    var STORAGE_KEY = 'sm_tutorial_progress';

    function _getProgress() {
        try {
            var data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            return {};
        }
    }

    function _saveProgress(progress) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
        } catch (e) {}
    }

    function _countSteps(card) {
        return card.querySelectorAll('.tut-step').length;
    }

    function _countCompleted(card, progress) {
        var flow = card.getAttribute('data-flow');
        var steps = card.querySelectorAll('.tut-step');
        var done = 0;
        steps.forEach(function (step) {
            var idx = step.getAttribute('data-step');
            if (progress[flow] && progress[flow][idx]) done++;
        });
        return done;
    }

    function _updateCardProgress(card) {
        var progress = _getProgress();
        var total = _countSteps(card);
        var done = _countCompleted(card, progress);
        var pct = total > 0 ? Math.round((done / total) * 100) : 0;

        var pctEl = card.querySelector('.tut-progress');
        if (pctEl) pctEl.textContent = done + '/' + total;

        var checks = card.querySelectorAll('.tut-step');
        checks.forEach(function (step) {
            var idx = step.getAttribute('data-step');
            var flow = card.getAttribute('data-flow');
            var isDone = progress[flow] && progress[flow][idx];
            var btn = step.querySelector('.step-check');
            if (btn) {
                btn.style.background = isDone ? 'var(--success, #10b981)' : 'transparent';
                btn.style.borderColor = isDone ? 'var(--success, #10b981)' : 'var(--slate-600, #475569)';
                if (isDone) {
                    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                } else {
                    btn.innerHTML = '';
                }
            }
            if (isDone) {
                step.classList.add('opacity-60');
            } else {
                step.classList.remove('opacity-60');
            }
        });

        _updateGlobalProgress();
    }

    function _updateGlobalProgress() {
        var cards = document.querySelectorAll('.tut-card');
        var totalSteps = 0;
        var totalDone = 0;
        var progress = _getProgress();

        cards.forEach(function (card) {
            totalSteps += _countSteps(card);
            totalDone += _countCompleted(card, progress);
        });

        var pct = totalSteps > 0 ? Math.round((totalDone / totalSteps) * 100) : 0;
        var bar = pm._el('tut-progress-bar');
        var pctEl = pm._el('tut-progress-pct');
        if (bar) bar.style.width = pct + '%';
        if (pctEl) pctEl.textContent = pct + '%';
    }

    function _toggleCard(header) {
        var card = header.closest('.tut-card');
        var body = card.querySelector('.tut-body');
        var toggle = header.querySelector('.tut-toggle');
        if (!body || !toggle) return;

        var isOpen = !body.classList.contains('hidden');
        if (isOpen) {
            body.classList.add('hidden');
            toggle.style.transform = 'rotate(0deg)';
        } else {
            body.classList.remove('hidden');
            toggle.style.transform = 'rotate(180deg)';
        }
    }

    function _toggleStep(btn) {
        var step = btn.closest('.tut-step');
        var card = step.closest('.tut-card');
        var flow = card.getAttribute('data-flow');
        var idx = step.getAttribute('data-step');
        var progress = _getProgress();

        if (!progress[flow]) progress[flow] = {};
        progress[flow][idx] = !progress[flow][idx];
        _saveProgress(progress);
        _updateCardProgress(card);
    }

    function _resetProgress() {
        localStorage.removeItem(STORAGE_KEY);
        document.querySelectorAll('.tut-card').forEach(function (card) {
            _updateCardProgress(card);
        });
    }

    function _sanitize(html) {
        var div = document.createElement('div');
        div.textContent = html;
        return div.innerHTML;
    }

    function _renderMarkdown(md) {
        if (typeof marked !== 'undefined') {
            return marked.parse(md, { breaks: true, gfm: true });
        }
        return '<pre class="text-xs text-slate-400 whitespace-pre-wrap">' + _sanitize(md) + '</pre>';
    }

    function _openDocViewer(card) {
        var docUrl = card.getAttribute('data-doc');
        if (!docUrl) return;
        var title = card.querySelector('.tut-header h3');
        var modal = pm._el('tut-doc-modal');
        var content = pm._el('tut-doc-content');
        var titleEl = pm._el('tut-doc-title');
        if (!modal || !content) return;

        if (titleEl) titleEl.textContent = title ? title.textContent : 'Documentação';
        content.innerHTML = '<div class="flex items-center justify-center py-16"><div class="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full"></div><span class="ml-3 text-slate-400">Carregando documentação...</span></div>';
        modal.classList.remove('hidden');

        fetch(docUrl)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            })
            .then(function (md) {
                var html = _renderMarkdown(md);
                html = html.replace(/<img /g, '<img class="rounded-xl border border-white/10 max-w-full my-4" ');
                var flowDir = docUrl.substring(0, docUrl.lastIndexOf('/'));
                html = html.replace(/src="([^"]+)"/g, function (m, src) {
                    if (src.startsWith('http') || src.startsWith('/')) return m;
                    return 'src="' + flowDir + '/' + src + '"';
                });
                content.innerHTML = html;
            })
            .catch(function (err) {
                content.innerHTML = '<div class="text-red-400 text-center py-8"><p class="text-lg font-bold mb-2">Erro ao carregar</p><p class="text-sm text-slate-400">' + _sanitize(err.message) + '</p></div>';
            });
    }

    function _closeDocViewer() {
        var modal = pm._el('tut-doc-modal');
        if (modal) modal.classList.add('hidden');
    }

    function init() {
        var cards = document.querySelectorAll('.tut-card');

        cards.forEach(function (card) {
            var header = card.querySelector('.tut-header');
            if (header) {
                pm._on(header, 'click', function (e) {
                    if (e.target.closest('.step-check') || e.target.closest('[data-nav]') || e.target.closest('.tut-doc-btn')) return;
                    _toggleCard(header);
                });
            }

            var checks = card.querySelectorAll('.step-check');
            checks.forEach(function (btn) {
                pm._on(btn, 'click', function () {
                    _toggleStep(btn);
                });
            });

            var docBtns = card.querySelectorAll('.tut-doc-btn');
            docBtns.forEach(function (btn) {
                pm._on(btn, 'click', function (e) {
                    e.stopPropagation();
                    _openDocViewer(card);
                });
            });

            _updateCardProgress(card);
        });

        var resetBtn = pm._el('tut-reset');
        if (resetBtn) {
            pm._on(resetBtn, 'click', _resetProgress);
        }

        var closeBtn = pm._el('tut-doc-close');
        if (closeBtn) {
            pm._on(closeBtn, 'click', _closeDocViewer);
        }

        var overlay = pm._el('tut-doc-overlay');
        if (overlay) {
            pm._on(overlay, 'click', _closeDocViewer);
        }

        pm._on(document, 'keydown', function (e) {
            if (e.key === 'Escape') _closeDocViewer();
        });

        var navBtns = document.querySelectorAll('[data-target]');
        navBtns.forEach(function (btn) {
            pm._on(btn, 'click', function () {
                var target = btn.getAttribute('data-target');
                if (target && window.parent && window.parent.router) {
                    window.parent.router.navigate(target);
                }
            });
        });
    }

    function destroy() {
        pm.destroy();
    }

    window.TutorialsPage = {
        init: init,
        destroy: destroy
    };
})();
