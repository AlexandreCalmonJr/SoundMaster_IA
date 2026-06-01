/**
 * @fileoverview Módulo de Página Git do Mixer
 * @module MixerGitPage
 * @description Página de versionamento de configurações do mixer类似于 Git.
 * Permite criar commits do estado atual da mesa, visualizar diferenças,
 * comparar commits e reverter configurações específicas.
 *
 * ## Funcionalidades Principais
 * - Criar commits do estado atual da mesa com label opcional
 * - Listar commits com data/hora e indicador de commit automático
 * - Visualizar diferenças (diffs) entre commit selecionado e estado atual
 * - Modo comparação entre dois commits específicos
 * - Rollback seletivo por categoria (escopo)
 * - Deletar commits individuais
 * - Toast de confirmação para ações
 *
 * ## Como Usar
 * 1. Inicializar a página chamando `MixerGitPage.init()`
 * 2. Criar commit: digitar label (opcional) e clicar "Commit"
 * 3. Selecionar commit na lista para ver diferenças
 * 4. Usar "Modo Comparação" para comparar dois commits
 * 5. Selecionar categorias no rollback para restaurar configurações específicas
 * 6. Clicar "Reverter" para aplicar mudanças selecionadas
 *
 * ## Dependências e Integrações
 * - **API REST**: Endpoints para gerenciamento de commits:
 *   - `GET /api/git/commits` - Listar commits
 *   - `POST /api/git/commits` - Criar commit
 *   - `DELETE /api/git/commits/:id` - Deletar commit
 *   - `GET /api/git/diff/:id` - Diferenças de um commit
 *   - `GET /api/git/diff/:idA/:idB` - Comparar dois commits
 *   - `POST /api/git/rollback/:id` - Reverter para commit
 * - **MixerService**: Serviço de comunicação com o mixer (via comandos do rollback)
 * - **AppStore**: Armazenamento global
 * - **createPageModule()**: Factory de módulo de página para gerenciamento de lifecycle
 * - Eventos: Commit selection, diff rendering, scope selection
 */

'use strict';
(function () {
    var pm = createPageModule();
    var _commits = [], _selectedId = null, _diffData = null, _selectedScope = new Set(), _compareMode = false, _selecting = false;

    async function _api(method, path, body) {
        var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
        if (body) opts.body = JSON.stringify(body);
        var res = await fetch(path, opts);
        if (!res.ok) { var e = await res.json().catch(function () { return { error: res.statusText }; }); throw new Error(e.error || res.statusText); }
        return res.json();
    }

    async function _loadCommits() {
        try {
            _commits = await _api('GET', '/api/git/commits');
            pm._setText('git-count-badge', _commits.length);
            _renderCommitList(); _populateCompareSelects();
        } catch (e) {
            _showToast('\u274C Erro ao carregar commits: ' + e.message, true);
        }
    }

    function _renderCommitList() {
        var commitList = pm._el('git-commit-list');
        if (!commitList) return;
        if (_commits.length === 0) { pm._setHTML('git-commit-list', '<div class="empty-state"><div class="icon">\uD83D\uDEC2</div>Sem commits ainda.<br>Clique em "Commit" para guardar o estado atual da mesa.</div>'); return; }
        commitList.innerHTML = _commits.map(function (c) {
            var date = new Date(c.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            return '<div class="commit-item ' + (c._id === _selectedId ? 'active' : '') + ' ' + (c.auto ? 'auto-badge' : '') + '" data-id="' + pm._esc(c._id) + '">' + '<span class="commit-hash">' + pm._esc(c.hash) + '</span>' + '<span class="commit-label">' + pm._esc(c.label) + '</span>' + '<span class="commit-ts">' + date + '</span></div>';
        }).join('');
        commitList.querySelectorAll('.commit-item').forEach(function (el) { pm._on(el, 'click', function () { _selectCommit(el.dataset.id); }); });
    }

    function _populateCompareSelects() {
        var compareA = pm._el('git-compare-a'), compareB = pm._el('git-compare-b');
        if (!compareA || !compareB) return;
        var opts = _commits.map(function (c) { return '<option value="' + pm._esc(c._id) + '">' + pm._esc(c.hash) + ' \u2014 ' + pm._esc(c.label) + '</option>'; }).join('');
        compareA.innerHTML = opts; compareB.innerHTML = opts;
        if (_commits.length > 1) compareB.selectedIndex = 1;
    }

    async function _selectCommit(id) {
        if (_selecting) return;
        _selecting = true;
        try {
            _selectedId = id;
            var deleteBtn = pm._el('git-delete-btn');
            if (deleteBtn) deleteBtn.disabled = false;
            _renderCommitList();
            var diffs = await _api('GET', '/api/git/diff/' + id);
            _diffData = diffs;
            _renderDiff(diffs);
            _renderRollbackScope(diffs);
        } catch (e) {
            pm._setHTML('git-diff-content', '<div class="git-diff-empty">\u274C Erro: ' + pm._esc(e.message) + '</div>');
        } finally {
            _selecting = false;
        }
    }

    function _renderDiff(diffs) {
        var diffContent = pm._el('git-diff-content'), diffBadge = pm._el('git-diff-badge'), rollbackCard = pm._el('git-rollback-card');
        if (!diffContent) return;
        if (diffBadge) { diffBadge.textContent = diffs.length; diffBadge.className = 'badge ' + (diffs.length > 0 ? 'badge-red' : 'badge-green'); }
        if (diffs.length === 0) { pm._setHTML('git-diff-content', '<div class="diff-empty">\u2705 Sem diferen\u00E7as \u2014 o estado atual \u00E9 igual ao commit selecionado.</div>'); if (rollbackCard) rollbackCard.style.display = 'none'; return; }
        var groups = {};
        diffs.forEach(function (d) { if (!groups[d.category]) groups[d.category] = []; groups[d.category].push(d); });
        var html = '';
        Object.entries(groups).sort(function (a, b) { return a[0].localeCompare(b[0]); }).forEach(function (entry) {
            var cat = entry[0], items = entry[1];
            html += '<div class="diff-group"><div class="diff-group-title">' + pm._esc(cat) + ' <span style="color:var(--accent);font-weight:400">(' + items.length + ')</span></div>';
            items.forEach(function (d) { html += '<div class="diff-row"><span class="diff-param">' + pm._esc(d.label) + '</span><span class="diff-from">' + pm._esc(d.fromFmt) + '</span><span class="diff-arrow">\u2192</span><span class="diff-to">' + pm._esc(d.toFmt) + '</span></div>'; });
            html += '</div>';
        });
        diffContent.innerHTML = html; if (rollbackCard) rollbackCard.style.display = '';
    }

    function _renderRollbackScope(diffs) {
        var scopeGrid = pm._el('git-scope-grid'), rollbackResult = pm._el('git-rollback-result');
        if (!scopeGrid) return;
        var cats = Array.from(new Set(diffs.map(function (d) { return d.category; }))).sort();
        _selectedScope.clear();
        scopeGrid.innerHTML = cats.map(function (c) { return '<span class="scope-tag" data-cat="' + pm._esc(c) + '">' + pm._esc(c) + '</span>'; }).join('');
        scopeGrid.querySelectorAll('.scope-tag').forEach(function (tag) { pm._on(tag, 'click', function () { var cat = tag.dataset.cat; if (_selectedScope.has(cat)) { _selectedScope.delete(cat); tag.classList.remove('selected'); } else { _selectedScope.add(cat); tag.classList.add('selected'); } }); });
        if (rollbackResult) rollbackResult.textContent = '';
    }

    function _showToast(msg, err) {
        var t = pm._el('git-toast');
        if (!t) { t = document.createElement('div'); t.id = 'git-toast'; Object.assign(t.style, { position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%) translateY(80px)', padding: '8px 20px', borderRadius: '9999px', fontSize: '12px', fontWeight: '700', zIndex: '9999', transition: 'transform .3s cubic-bezier(.34,1.56,.64,1)', pointerEvents: 'none', backdropFilter: 'blur(8px)', boxShadow: '0 4px 24px rgba(0,0,0,.4)', color: '#fff' }); document.body.appendChild(t); }
        t.textContent = msg; t.style.background = err ? 'rgba(248,81,73,.92)' : 'rgba(63,185,80,.92)'; t.style.transform = 'translateX(-50%) translateY(0)'; clearTimeout(t._tmr); t._tmr = pm._setTimeout(function () { t.style.transform = 'translateX(-50%) translateY(80px)'; }, 2800);
    }

    function init() {
        var labelInput = pm._el('git-label-input'), commitBtn = pm._el('git-commit-btn'), refreshBtn = pm._el('git-refresh-btn'), compareToggle = pm._el('git-compare-toggle-btn'), compareToolbar = pm._el('git-compare-toolbar'), compareA = pm._el('git-compare-a'), compareB = pm._el('git-compare-b'), doCompareBtn = pm._el('git-do-compare-btn'), deleteBtn = pm._el('git-delete-btn'), rollbackClear = pm._el('git-rollback-clear-btn'), rollbackBtn = pm._el('git-rollback-btn');

        pm._on(commitBtn, 'click', async function () { commitBtn.disabled = true; try { await _api('POST', '/api/git/commits', { label: labelInput ? labelInput.value.trim() || undefined : undefined }); if (labelInput) labelInput.value = ''; await _loadCommits(); _showToast('\u2705 Commit guardado!'); } catch (e) { _showToast('\u274C ' + e.message, true); } finally { commitBtn.disabled = false; } });
        pm._on(refreshBtn, 'click', _loadCommits);
        pm._on(deleteBtn, 'click', async function () { 
            if (!_selectedId || !confirm('Apagar este commit?')) return; 
            try {
                await _api('DELETE', '/api/git/commits/' + _selectedId); 
                _selectedId = null; 
                deleteBtn.disabled = true; 
                pm._setHTML('git-diff-content', '<div class="diff-empty">Commit apagado.</div>'); 
                var rc = pm._el('git-rollback-card'); 
                if (rc) rc.style.display = 'none'; 
                await _loadCommits(); 
            } catch (e) {
                _showToast('\u274C ' + e.message, true);
            }
        });
        pm._on(compareToggle, 'click', function () { _compareMode = !_compareMode; if (compareToolbar) compareToolbar.style.display = _compareMode ? '' : 'none'; compareToggle.textContent = _compareMode ? '\u2715 Fechar Compara\u00E7\u00E3o' : '\u26A1 Modo Compara\u00E7\u00E3o'; });
        pm._on(doCompareBtn, 'click', async function () { var idA = compareA ? compareA.value : '', idB = compareB ? compareB.value : ''; if (!idA || !idB || idA === idB) { _showToast('Selecione dois commits diferentes.', true); return; } try { var diffs = await _api('GET', '/api/git/diff/' + idA + '/' + idB); _diffData = diffs; _renderDiff(diffs); _renderRollbackScope(diffs); _selectedId = idA; if (deleteBtn) deleteBtn.disabled = false; } catch (e) { _showToast('\u274C ' + e.message, true); } });
        pm._on(rollbackClear, 'click', function () { _selectedScope.clear(); document.querySelectorAll('.git-scope-tag').forEach(function (t) { t.classList.remove('selected'); }); });
        pm._on(rollbackBtn, 'click', async function () { if (!_selectedId) return; rollbackBtn.disabled = true; var rr = pm._el('git-rollback-result'); if (rr) { rr.textContent = 'Aplicando\u2026'; rr.className = 'git-rollback-result'; } try { var res = await _api('POST', '/api/git/rollback/' + _selectedId, { scope: Array.from(_selectedScope) }); if (rr) { rr.textContent = '\u2705 ' + res.commands + ' comando(s) enviados \u00E0 mesa.'; rr.className = 'git-rollback-result ok'; } pm._setTimeout(function () { _selectCommit(_selectedId); }, 800); } catch (e) { if (rr) { rr.textContent = '\u274C ' + e.message; rr.className = 'git-rollback-result err'; } } finally { rollbackBtn.disabled = false; } });
        _loadCommits();
    }

    function destroy() { pm.destroy(); _commits = []; _selectedId = null; _diffData = null; _selectedScope.clear(); _compareMode = false; var t = document.getElementById('git-toast'); if (t) t.remove(); }

    window.MixerGitPage = { init: init, destroy: destroy };
})();
