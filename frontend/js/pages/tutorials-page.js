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

    function init() {
        var cards = document.querySelectorAll('.tut-card');

        cards.forEach(function (card) {
            var header = card.querySelector('.tut-header');
            if (header) {
                pm._on(header, 'click', function (e) {
                    if (e.target.closest('.step-check') || e.target.closest('[data-nav]')) return;
                    _toggleCard(header);
                });
            }

            var checks = card.querySelectorAll('.step-check');
            checks.forEach(function (btn) {
                pm._on(btn, 'click', function () {
                    _toggleStep(btn);
                });
            });

            _updateCardProgress(card);
        });

        var resetBtn = pm._el('tut-reset');
        if (resetBtn) {
            pm._on(resetBtn, 'click', _resetProgress);
        }

        var navBtns = document.querySelectorAll('[data-nav]');
        navBtns.forEach(function (btn) {
            pm._on(btn, 'click', function () {
                var target = btn.getAttribute('data-nav');
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
