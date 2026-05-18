'use strict';
(function () {
    var _commits = [];
    var _selectedId = null;
    var _diffData = null;
    var _selectedScope = new Set();
    var _compareMode = false;
    var _listeners = [];

    function _on(target, event, handler) {
        if (!target) return;
        target.addEventListener(event, handler);
        _listeners.push({ target, event, handler });
    }

    async function _api(method, path, body) {
        var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        var res = await fetch(path, opts);
        if (!res.ok) {
            var e = await res.json().catch(function () { return { error: res.statusText }; });
            throw new Error(e.error || res.statusText);
        }
        return res.json();
    }

    function _esc(s) {
        return String(s != null ? s : '').replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    async function _loadCommits() {
        _commits = await _api('GET', '/api/git/commits');
        var countBadge = document.getElementById('git-count-badge');
        if (countBadge) countBadge.textContent = _commits.length;
        _renderCommitList();
        _populateCompareSelects();
    }

    function _renderCommitList() {
        var commitList = document.getElementById('git-commit-list');
        if (!commitList) return;
        if (_commits.length === 0) {
            commitList.innerHTML = '<div class="empty-state"><div class="icon">📭</div>Sem commits ainda.<br>Clique em "Commit" para guardar o estado atual da mesa.</div>';
            return;
        }
        commitList.innerHTML = _commits.map(function (c) {
            var date = new Date(c.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            var active = c._id === _selectedId ? 'active' : '';
            var autoCls = c.auto ? 'auto-badge' : '';
            return '<div class="commit-item ' + active + ' ' + autoCls + '" data-id="' + c._id + '">' +
                '<span class="commit-hash">' + _esc(c.hash) + '</span>' +
                '<span class="commit-label">' + _esc(c.label) + '</span>' +
                '<span class="commit-ts">' + date + '</span>' +
                '</div>';
        }).join('');

        commitList.querySelectorAll('.commit-item').forEach(function (el) {
            _on(el, 'click', function () { _selectCommit(el.dataset.id); });
        });
    }

    function _populateCompareSelects() {
        var compareA = document.getElementById('git-compare-a');
        var compareB = document.getElementById('git-compare-b');
        if (!compareA || !compareB) return;
        var opts = _commits.map(function (c) {
            return '<option value="' + c._id + '">' + _esc(c.hash) + ' — ' + _esc(c.label) + '</option>';
        }).join('');
        compareA.innerHTML = opts;
        compareB.innerHTML = opts;
        if (_commits.length > 1) compareB.selectedIndex = 1;
    }

    async function _selectCommit(id) {
        _selectedId = id;
        var deleteBtn = document.getElementById('git-delete-btn');
        if (deleteBtn) deleteBtn.disabled = false;
        _renderCommitList();
        try {
            var diffs = await _api('GET', '/api/git/diff/' + id);
            _diffData = diffs;
            _renderDiff(diffs);
            _renderRollbackScope(diffs);
        } catch (e) {
            var diffContent = document.getElementById('git-diff-content');
            if (diffContent) diffContent.innerHTML = '<div class="diff-empty">❌ Erro: ' + _esc(e.message) + '</div>';
        }
    }

    function _renderDiff(diffs) {
        var diffContent = document.getElementById('git-diff-content');
        var diffBadge = document.getElementById('git-diff-badge');
        var rollbackCard = document.getElementById('git-rollback-card');
        if (!diffContent) return;

        if (diffBadge) {
            diffBadge.textContent = diffs.length;
            diffBadge.className = 'badge ' + (diffs.length > 0 ? 'badge-red' : 'badge-green');
        }

        if (diffs.length === 0) {
            diffContent.innerHTML = '<div class="diff-empty">✅ Sem diferenças — o estado atual é igual ao commit selecionado.</div>';
            if (rollbackCard) rollbackCard.style.display = 'none';
            return;
        }

        var groups = {};
        diffs.forEach(function (d) {
            if (!groups[d.category]) groups[d.category] = [];
            groups[d.category].push(d);
        });

        var html = '';
        Object.entries(groups).sort(function (a, b) { return a[0].localeCompare(b[0]); }).forEach(function (entry) {
            var cat = entry[0], items = entry[1];
            html += '<div class="diff-group"><div class="diff-group-title">' + _esc(cat) + ' <span style="color:var(--accent);font-weight:400">(' + items.length + ')</span></div>';
            items.forEach(function (d) {
                html += '<div class="diff-row">' +
                    '<span class="diff-param">' + _esc(d.label) + '</span>' +
                    '<span class="diff-from">' + _esc(d.fromFmt) + '</span>' +
                    '<span class="diff-arrow">→</span>' +
                    '<span class="diff-to">' + _esc(d.toFmt) + '</span>' +
                    '</div>';
            });
            html += '</div>';
        });

        diffContent.innerHTML = html;
        if (rollbackCard) rollbackCard.style.display = '';
    }

    function _renderRollbackScope(diffs) {
        var scopeGrid = document.getElementById('git-scope-grid');
        var rollbackResult = document.getElementById('git-rollback-result');
        if (!scopeGrid) return;
        var cats = Array.from(new Set(diffs.map(function (d) { return d.category; }))).sort();
        _selectedScope.clear();
        scopeGrid.innerHTML = cats.map(function (c) {
            return '<span class="scope-tag" data-cat="' + _esc(c) + '">' + _esc(c) + '</span>';
        }).join('');
        scopeGrid.querySelectorAll('.scope-tag').forEach(function (tag) {
            _on(tag, 'click', function () {
                var cat = tag.dataset.cat;
                if (_selectedScope.has(cat)) { _selectedScope.delete(cat); tag.classList.remove('selected'); }
                else { _selectedScope.add(cat); tag.classList.add('selected'); }
            });
        });
        if (rollbackResult) rollbackResult.textContent = '';
    }

    function _showToast(msg, err) {
        var t = document.getElementById('git-toast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'git-toast';
            Object.assign(t.style, {
                position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%) translateY(80px)',
                padding: '8px 20px', borderRadius: '999px', fontSize: '12px', fontWeight: '700',
                zIndex: '9999', transition: 'transform .3s cubic-bezier(.34,1.56,.64,1)', pointerEvents: 'none',
                backdropFilter: 'blur(8px)', boxShadow: '0 4px 24px rgba(0,0,0,.4)', color: '#fff',
            });
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.background = err ? 'rgba(248,81,73,.92)' : 'rgba(63,185,80,.92)';
        t.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(t._tmr);
        t._tmr = setTimeout(function () { t.style.transform = 'translateX(-50%) translateY(80px)'; }, 2800);
    }

    function init() {
        var labelInput = document.getElementById('git-label-input');
        var commitBtn = document.getElementById('git-commit-btn');
        var refreshBtn = document.getElementById('git-refresh-btn');
        var compareToggle = document.getElementById('git-compare-toggle-btn');
        var compareToolbar = document.getElementById('git-compare-toolbar');
        var compareA = document.getElementById('git-compare-a');
        var compareB = document.getElementById('git-compare-b');
        var doCompareBtn = document.getElementById('git-do-compare-btn');
        var deleteBtn = document.getElementById('git-delete-btn');
        var rollbackClear = document.getElementById('git-rollback-clear-btn');
        var rollbackBtn = document.getElementById('git-rollback-btn');

        _on(commitBtn, 'click', async function () {
            commitBtn.disabled = true;
            try {
                var label = labelInput ? labelInput.value.trim() || undefined : undefined;
                await _api('POST', '/api/git/commits', { label: label });
                if (labelInput) labelInput.value = '';
                await _loadCommits();
                _showToast('✅ Commit guardado!');
            } catch (e) { _showToast('❌ ' + e.message, true); }
            finally { commitBtn.disabled = false; }
        });

        _on(refreshBtn, 'click', _loadCommits);

        _on(deleteBtn, 'click', async function () {
            if (!_selectedId || !confirm('Apagar este commit?')) return;
            await _api('DELETE', '/api/git/commits/' + _selectedId);
            _selectedId = null;
            deleteBtn.disabled = true;
            var diffContent = document.getElementById('git-diff-content');
            if (diffContent) diffContent.innerHTML = '<div class="diff-empty">Commit apagado.</div>';
            var rollbackCard = document.getElementById('git-rollback-card');
            if (rollbackCard) rollbackCard.style.display = 'none';
            await _loadCommits();
        });

        _on(compareToggle, 'click', function () {
            _compareMode = !_compareMode;
            if (compareToolbar) compareToolbar.style.display = _compareMode ? '' : 'none';
            compareToggle.textContent = _compareMode ? '✕ Fechar Comparação' : '⚡ Modo Comparação';
        });

        _on(doCompareBtn, 'click', async function () {
            var idA = compareA ? compareA.value : '';
            var idB = compareB ? compareB.value : '';
            if (!idA || !idB || idA === idB) { _showToast('Selecione dois commits diferentes.', true); return; }
            try {
                var diffs = await _api('GET', '/api/git/diff/' + idA + '/' + idB);
                _diffData = diffs;
                _renderDiff(diffs);
                _renderRollbackScope(diffs);
                _selectedId = idA;
                if (deleteBtn) deleteBtn.disabled = false;
            } catch (e) { _showToast('❌ ' + e.message, true); }
        });

        _on(rollbackClear, 'click', function () {
            _selectedScope.clear();
            document.querySelectorAll('.scope-tag').forEach(function (t) { t.classList.remove('selected'); });
        });

        _on(rollbackBtn, 'click', async function () {
            if (!_selectedId) return;
            rollbackBtn.disabled = true;
            var rollbackResult = document.getElementById('git-rollback-result');
            if (rollbackResult) { rollbackResult.textContent = 'Aplicando…'; rollbackResult.className = 'rollback-result'; }
            try {
                var scope = Array.from(_selectedScope);
                var res = await _api('POST', '/api/git/rollback/' + _selectedId, { scope: scope });
                if (rollbackResult) { rollbackResult.textContent = '✅ ' + res.commands + ' comando(s) enviados à mesa.'; rollbackResult.className = 'rollback-result ok'; }
                setTimeout(function () { _selectCommit(_selectedId); }, 800);
            } catch (e) {
                if (rollbackResult) { rollbackResult.textContent = '❌ ' + e.message; rollbackResult.className = 'rollback-result err'; }
            } finally { rollbackBtn.disabled = false; }
        });

        _loadCommits();
    }

    function destroy() {
        _listeners.forEach(function (l) { l.target.removeEventListener(l.event, l.handler); });
        _listeners = [];
        _commits = [];
        _selectedId = null;
        _diffData = null;
        _selectedScope.clear();
        _compareMode = false;
    }

    window.MixerGitPage = { init: init, destroy: destroy };
})();
