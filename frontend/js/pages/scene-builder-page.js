'use strict';
(function () {
    var pm = createPageModule();
    var _selectedScene = null, _selectedInstruments = new Set();

    function _escapeHtml(str) { return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function _formatDate(ts) { if (!ts) return '--'; return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }

    function _renderSceneList() {
        var container = pm._el('sb-scene-list'); if (!container) return;
        var scenes = window.SceneBuilderService ? SceneBuilderService.loadScenes() : [];
        if (scenes.length === 0) { pm._setHTML('sb-scene-list', '<div class="text-center text-slate-600 text-xs py-8">Nenhuma cena salva</div>'); return; }
        container.innerHTML = scenes.map(function (s, i) { var colorMap = { louvor: 'cyan', pregacao: 'orange', musica: 'green', transicao: 'amber', intervalo: 'slate', geral: 'slate' }; var color = colorMap[s.genre] || 'slate'; return '<button class="sb-scene-item w-full text-left p-3 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-white/5 hover:border-' + color + '-500/30 transition-all" data-index="' + i + '"><div class="text-sm font-bold text-' + color + '-400">' + _escapeHtml(s.name) + '</div><div class="text-[10px] text-slate-500 mt-1">' + _escapeHtml(s.genre || '') + ' \u2022 ' + _formatDate(s.timestamp) + '</div></button>'; }).join('');
        container.querySelectorAll('.sb-scene-item').forEach(function (btn) { pm._on(btn, 'click', function () { _selectSceneByIndex(parseInt(this.getAttribute('data-index'))); }); });
    }

    function _renderThumbnails() {
        var container = pm._el('sb-thumbnails'); if (!container) return;
        var scenes = window.SceneBuilderService ? SceneBuilderService.loadScenes() : [];
        if (scenes.length === 0) { pm._setHTML('sb-thumbnails', '<div class="col-span-full text-center text-slate-600 text-xs py-8">Sem miniaturas</div>'); return; }
        container.innerHTML = scenes.map(function (s, i) { var colors = { louvor: '#06b6d4', pregacao: '#f97316', musica: '#22c55e', transicao: '#fbbf24', intervalo: '#64748b', geral: '#64748b' }; var color = colors[s.genre] || '#64748b'; return '<div class="sb-thumbnail aspect-video rounded-lg cursor-pointer hover:ring-2 transition-all relative overflow-hidden" data-index="' + i + '" style="background: linear-gradient(135deg, ' + color + '22, ' + color + '44); border: 1px solid ' + color + '33;"><div class="absolute inset-0 flex items-center justify-center"><div class="w-8 h-8 rounded-full border-2" style="border-color:' + color + '66; background: ' + color + '22;"></div></div><div class="absolute bottom-1 left-1 right-1 text-[8px] font-bold text-white truncate">' + _escapeHtml(s.name) + '</div></div>'; }).join('');
        container.querySelectorAll('.sb-thumbnail').forEach(function (th) { pm._on(th, 'click', function () { _selectSceneByIndex(parseInt(this.getAttribute('data-index'))); }); });
    }

    function _selectSceneByIndex(index) {
        var scenes = window.SceneBuilderService ? SceneBuilderService.loadScenes() : [];
        _selectedScene = scenes[index] || null; if (!_selectedScene) return;
        pm._setText('sb-preview-name', _selectedScene.name);
        pm._setHTML('sb-preview-meta', '<div>' + _escapeHtml(_selectedScene.genre || '') + '</div><div>' + _formatDate(_selectedScene.timestamp) + '</div>');
        pm._setHTML('sb-preview-content', '<div class="w-full space-y-3">' + (_selectedScene.description ? '<p class="text-sm text-slate-400">' + _escapeHtml(_selectedScene.description) + '</p>' : '') + '<div class="grid grid-cols-3 gap-3"><div class="bg-slate-800/40 rounded-xl p-3 text-center"><div class="text-xs text-slate-500 mb-1">Estilo</div><div class="text-sm font-bold text-cyan-400">' + _escapeHtml(_selectedScene.genre || '--') + '</div></div><div class="bg-slate-800/40 rounded-xl p-3 text-center"><div class="text-xs text-slate-500 mb-1">Canais</div><div class="text-sm font-bold text-cyan-400">' + (_selectedScene.channels || 16) + '</div></div><div class="bg-slate-800/40 rounded-xl p-3 text-center"><div class="text-xs text-slate-500 mb-1">Mix</div><div class="text-sm font-bold text-cyan-400">' + (_selectedScene.mixType || 'Estereo') + '</div></div></div>' + (_selectedScene.aiData ? '<div class="bg-cyan-900/20 border border-cyan-500/20 rounded-xl p-3 text-xs text-slate-400"><strong class="text-cyan-400">IA:</strong> ' + _escapeHtml(_selectedScene.aiData) + '</div>' : '') + '</div>');
        pm._toggleClasses('sb-preview-actions', [], ['hidden']);
    }

    function _showModal(id) { var m = pm._el(id); if (m) { m.classList.remove('hidden'); m.classList.add('flex'); } }
    function _hideModal(id) { var m = pm._el(id); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } }

    function init() {
        pm._on(pm._el('sb-new-scene'), 'click', function () { _showModal('sb-new-scene-modal'); var ni = pm._el('sb-new-name'); if (ni) ni.value = ''; var di = pm._el('sb-new-desc'); if (di) di.value = ''; });
        pm._on(pm._el('sb-ai-generate'), 'click', function () { _showModal('sb-ai-modal'); var pi = pm._el('sb-ai-prompt'); if (pi) pi.value = ''; var r = pm._el('sb-ai-result'); if (r) r.classList.add('hidden'); });
        pm._on(pm._el('sb-cancel-new'), 'click', function () { _hideModal('sb-new-scene-modal'); });
        pm._on(pm._el('sb-cancel-ai'), 'click', function () { _hideModal('sb-ai-modal'); });
        pm._on(pm._el('sb-save-new'), 'click', function () { var name = pm._el('sb-new-name') ? pm._el('sb-new-name').value.trim() : ''; if (!name) return; pm._safeCall('SceneBuilderService', 'createScene', { name: name, genre: pm._el('sb-new-genre') ? pm._el('sb-new-genre').value : 'geral', description: pm._el('sb-new-desc') ? pm._el('sb-new-desc').value.trim() : '' }); _hideModal('sb-new-scene-modal'); _renderSceneList(); _renderThumbnails(); });
        pm._on(pm._el('sb-generate-ai'), 'click', async function () { var prompt = pm._el('sb-ai-prompt') ? pm._el('sb-ai-prompt').value.trim() : ''; if (!prompt) return; var result = pm._el('sb-ai-result'); if (result) { result.classList.remove('hidden'); result.innerHTML = '<span class="text-cyan-400 animate-pulse">Gerando com IA...</span>'; } try { pm._safeCall('SceneBuilderService', 'generateWithAI', prompt, _selectedInstruments); if (result) result.innerHTML = '<span class="text-green-400">Cena gerada com sucesso!</span>'; } catch (err) { if (result) result.innerHTML = '<span class="text-red-400">Erro: ' + _escapeHtml(err.message) + '</span>'; } _renderSceneList(); _renderThumbnails(); });
        pm._on(pm._el('sb-apply-scene'), 'click', function () { if (_selectedScene) pm._safeCall('SceneBuilderService', 'applyScene', _selectedScene); });
        pm._on(pm._el('sb-delete-scene'), 'click', function () { if (!_selectedScene) return; pm._safeCall('SceneBuilderService', 'deleteScene', _selectedScene.id); _selectedScene = null; pm._setText('sb-preview-name', 'Selecione uma cena'); pm._setHTML('sb-preview-content', '<p class="text-sm">Clique em uma cena para visualizar</p>'); pm._toggleClasses('sb-preview-actions', ['hidden'], []); _renderSceneList(); _renderThumbnails(); });
        document.querySelectorAll('.sb-quick-preset').forEach(function (btn) { pm._on(btn, 'click', function () { var preset = this.getAttribute('data-preset'), presets = { louvor: { name: 'Louvor', genre: 'louvor', description: 'Mix completo com energia', channels: 16, mixType: 'Estereo' }, pregacao: { name: 'Prega\u00E7\u00E3o', genre: 'pregacao', description: 'Foco em voz e monitor', channels: 8, mixType: 'Estereo' }, silencio: { name: 'Sil\u00EAncio', genre: 'intervalo', description: 'Sem som', channels: 16, mixType: 'Mute' }, transicao: { name: 'Transi\u00E7\u00E3o', genre: 'transicao', description: 'Fade e preparo', channels: 16, mixType: 'Estereo' } }, p = presets[preset]; if (p) pm._safeCall('SceneBuilderService', 'createScene', p); _renderSceneList(); _renderThumbnails(); }); });
        document.querySelectorAll('.sb-ai-inst').forEach(function (btn) { pm._on(btn, 'click', function () { var inst = this.getAttribute('data-inst'); if (_selectedInstruments.has(inst)) { _selectedInstruments.delete(inst); this.classList.remove('bg-cyan-900/30', 'border-cyan-500/30', 'text-cyan-400'); this.classList.add('bg-slate-700/50', 'border-white/5', 'text-slate-300'); } else { _selectedInstruments.add(inst); this.classList.add('bg-cyan-900/30', 'border-cyan-500/30', 'text-cyan-400'); this.classList.remove('bg-slate-700/50', 'border-white/5', 'text-slate-300'); } }); });
        _renderSceneList(); _renderThumbnails();
    }

    function destroy() { pm.destroy(); _selectedScene = null; _selectedInstruments.clear(); }

    window.SceneBuilderPage = { init: init, destroy: destroy };
})();
