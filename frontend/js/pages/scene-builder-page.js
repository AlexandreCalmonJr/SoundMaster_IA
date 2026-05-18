/**
 * SoundMaster — Scene Builder Page Module
 * Binds DOM events para a página de Scene Builder.
 */

'use strict';

(function () {

    let _listeners = [];
    let _selectedScene = null;
    let _selectedInstruments = new Set();

    function _on(target, event, handler) {
        if (!target) return;
        target.addEventListener(event, handler);
        _listeners.push({ target, event, handler });
    }

    function _escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function _formatDate(ts) {
        if (!ts) return '--';
        return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function _renderSceneList() {
        const container = document.getElementById('sb-scene-list');
        if (!container) return;
        const scenes = window.SceneBuilderService ? SceneBuilderService.loadScenes() : [];

        if (scenes.length === 0) {
            container.innerHTML = '<div class="text-center text-slate-600 text-xs py-8">Nenhuma cena salva</div>';
            return;
        }

        container.innerHTML = scenes.map(function (s, i) {
            const colorMap = { louvor: 'cyan', pregacao: 'orange', musica: 'green', transicao: 'purple', intervalo: 'slate', geral: 'slate' };
            const color = colorMap[s.genre] || 'slate';
            return '<button class="sb-scene-item w-full text-left p-3 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-white/5 hover:border-' + color + '-500/30 transition-all" data-index="' + i + '">' +
                '<div class="text-sm font-bold text-' + color + '-400">' + _escapeHtml(s.name) + '</div>' +
                '<div class="text-[10px] text-slate-500 mt-1">' + _escapeHtml(s.genre || '') + ' • ' + _formatDate(s.timestamp) + '</div>' +
                '</button>';
        }).join('');

        container.querySelectorAll('.sb-scene-item').forEach(function (btn) {
            _on(btn, 'click', function () {
                const idx = parseInt(this.getAttribute('data-index'));
                _selectSceneByIndex(idx);
            });
        });
    }

    function _renderThumbnails() {
        const container = document.getElementById('sb-thumbnails');
        if (!container) return;
        const scenes = window.SceneBuilderService ? SceneBuilderService.loadScenes() : [];

        if (scenes.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center text-slate-600 text-xs py-8">Sem miniaturas</div>';
            return;
        }

        container.innerHTML = scenes.map(function (s) {
            const colors = { louvor: '#06b6d4', pregacao: '#f97316', musica: '#22c55e', transicao: '#a855f7', intervalo: '#64748b', geral: '#64748b' };
            const color = colors[s.genre] || '#64748b';
            return '<div class="sb-thumbnail aspect-video rounded-lg cursor-pointer hover:ring-2 transition-all relative overflow-hidden" style="background: linear-gradient(135deg, ' + color + '22, ' + color + '44); border: 1px solid ' + color + '33;">' +
                '<div class="absolute inset-0 flex items-center justify-center">' +
                '<div class="w-8 h-8 rounded-full border-2" style="border-color:' + color + '66; background: ' + color + '22;"></div>' +
                '</div>' +
                '<div class="absolute bottom-1 left-1 right-1 text-[8px] font-bold text-white truncate">' + _escapeHtml(s.name) + '</div>' +
                '</div>';
        }).join('');

        container.querySelectorAll('.sb-thumbnail').forEach(function (th) {
            _on(th, 'click', function () {
                const idx = parseInt(this.getAttribute('data-index'));
                _selectSceneByIndex(idx);
            });
        });
    }

    function _selectSceneByIndex(index) {
        const scenes = window.SceneBuilderService ? SceneBuilderService.loadScenes() : [];
        _selectedScene = scenes[index] || null;
        if (!_selectedScene) return;

        const previewName = document.getElementById('sb-preview-name');
        const previewContent = document.getElementById('sb-preview-content');
        const previewActions = document.getElementById('sb-preview-actions');
        const previewMeta = document.getElementById('sb-preview-meta');

        if (previewName) previewName.textContent = _selectedScene.name;
        if (previewMeta) previewMeta.innerHTML = '<div>' + _escapeHtml(_selectedScene.genre || '') + '</div><div>' + _formatDate(_selectedScene.timestamp) + '</div>';

        if (previewContent) {
            previewContent.innerHTML = '<div class="w-full space-y-3">' +
                (_selectedScene.description ? '<p class="text-sm text-slate-400">' + _escapeHtml(_selectedScene.description) + '</p>' : '') +
                '<div class="grid grid-cols-3 gap-3">' +
                '<div class="bg-slate-800/40 rounded-xl p-3 text-center"><div class="text-xs text-slate-500 mb-1">Estilo</div><div class="text-sm font-bold text-cyan-400">' + _escapeHtml(_selectedScene.genre || '--') + '</div></div>' +
                '<div class="bg-slate-800/40 rounded-xl p-3 text-center"><div class="text-xs text-slate-500 mb-1">Canais</div><div class="text-sm font-bold text-cyan-400">' + (_selectedScene.channels || 16) + '</div></div>' +
                '<div class="bg-slate-800/40 rounded-xl p-3 text-center"><div class="text-xs text-slate-500 mb-1">Mix</div><div class="text-sm font-bold text-cyan-400">' + (_selectedScene.mixType || 'Estereo') + '</div></div>' +
                '</div>' +
                (_selectedScene.aiData ? '<div class="bg-purple-900/20 border border-purple-500/20 rounded-xl p-3 text-xs text-slate-400"><strong class="text-purple-400">IA:</strong> ' + _escapeHtml(_selectedScene.aiData) + '</div>' : '') +
                '</div>';
        }

        if (previewActions) previewActions.classList.remove('hidden');
    }

    function init() {
        console.log('[SceneBuilderPage] Initializing...');

        _on(document.getElementById('sb-new-scene'), 'click', function () {
            const modal = document.getElementById('sb-new-scene-modal');
            if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
            const nameInput = document.getElementById('sb-new-name');
            if (nameInput) nameInput.value = '';
            const descInput = document.getElementById('sb-new-desc');
            if (descInput) descInput.value = '';
        });

        _on(document.getElementById('sb-ai-generate'), 'click', function () {
            const modal = document.getElementById('sb-ai-modal');
            if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
            const promptInput = document.getElementById('sb-ai-prompt');
            if (promptInput) promptInput.value = '';
            const result = document.getElementById('sb-ai-result');
            if (result) result.classList.add('hidden');
        });

        _on(document.getElementById('sb-cancel-new'), 'click', function () {
            const modal = document.getElementById('sb-new-scene-modal');
            if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
        });

        _on(document.getElementById('sb-cancel-ai'), 'click', function () {
            const modal = document.getElementById('sb-ai-modal');
            if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
        });

        _on(document.getElementById('sb-save-new'), 'click', function () {
            const name = document.getElementById('sb-new-name')?.value?.trim();
            if (!name) return;
            if (window.SceneBuilderService) {
                SceneBuilderService.createScene({
                    name: name,
                    genre: document.getElementById('sb-new-genre')?.value || 'geral',
                    description: document.getElementById('sb-new-desc')?.value?.trim() || '',
                });
            }
            const modal = document.getElementById('sb-new-scene-modal');
            if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
            _renderSceneList();
            _renderThumbnails();
        });

        _on(document.getElementById('sb-generate-ai'), 'click', async function () {
            const prompt = document.getElementById('sb-ai-prompt')?.value?.trim();
            if (!prompt) return;
            const result = document.getElementById('sb-ai-result');
            if (result) {
                result.classList.remove('hidden');
                result.innerHTML = '<span class="text-purple-400 animate-pulse">Gerando com IA...</span>';
            }
            const insts = Array.from(_selectedInstruments).join(', ');
            try {
                if (window.SceneBuilderService) {
                    await SceneBuilderService.generateWithAI(prompt, _selectedInstruments);
                    if (result) result.innerHTML = '<span class="text-green-400">Cena gerada com sucesso!</span>';
                }
            } catch (err) {
                if (result) result.innerHTML = '<span class="text-red-400">Erro: ' + _escapeHtml(err.message) + '</span>';
            }
            _renderSceneList();
            _renderThumbnails();
        });

        _on(document.getElementById('sb-apply-scene'), 'click', function () {
            if (_selectedScene && window.SceneBuilderService) {
                SceneBuilderService.applyScene(_selectedScene);
            }
        });

        _on(document.getElementById('sb-delete-scene'), 'click', function () {
            if (!_selectedScene || !window.SceneBuilderService) return;
            SceneBuilderService.deleteScene(_selectedScene.id);
            _selectedScene = null;
            const previewName = document.getElementById('sb-preview-name');
            if (previewName) previewName.textContent = 'Selecione uma cena';
            const previewContent = document.getElementById('sb-preview-content');
            if (previewContent) previewContent.innerHTML = '<p class="text-sm">Clique em uma cena para visualizar</p>';
            const previewActions = document.getElementById('sb-preview-actions');
            if (previewActions) previewActions.classList.add('hidden');
            _renderSceneList();
            _renderThumbnails();
        });

        // Quick presets
        document.querySelectorAll('.sb-quick-preset').forEach(function (btn) {
            _on(btn, 'click', function () {
                const preset = this.getAttribute('data-preset');
                const presets = {
                    louvor: { name: 'Louvor', genre: 'louvor', description: 'Mix completo com energia', channels: 16, mixType: 'Estereo' },
                    pregacao: { name: 'Pregação', genre: 'pregacao', description: 'Foco em voz e monitor', channels: 8, mixType: 'Estereo' },
                    silencio: { name: 'Silêncio', genre: 'intervalo', description: 'Sem som', channels: 16, mixType: 'Mute' },
                    transicao: { name: 'Transição', genre: 'transicao', description: 'Fade e preparo', channels: 16, mixType: 'Estereo' }
                };
                const p = presets[preset];
                if (p && window.SceneBuilderService) {
                    SceneBuilderService.createScene(p);
                    _renderSceneList();
                    _renderThumbnails();
                }
            });
        });

        // Instrument toggles
        document.querySelectorAll('.sb-ai-inst').forEach(function (btn) {
            _on(btn, 'click', function () {
                const inst = this.getAttribute('data-inst');
                if (_selectedInstruments.has(inst)) {
                    _selectedInstruments.delete(inst);
                    this.classList.remove('bg-cyan-900/30', 'border-cyan-500/30', 'text-cyan-400');
                    this.classList.add('bg-slate-700/50', 'border-white/5', 'text-slate-300');
                } else {
                    _selectedInstruments.add(inst);
                    this.classList.add('bg-cyan-900/30', 'border-cyan-500/30', 'text-cyan-400');
                    this.classList.remove('bg-slate-700/50', 'border-white/5', 'text-slate-300');
                }
            });
        });

        _renderSceneList();
        _renderThumbnails();
        console.log('[SceneBuilderPage] Initialized.');
    }

    function destroy() {
        _listeners.forEach(({ target, event, handler }) => {
            target.removeEventListener(event, handler);
        });
        _listeners = [];
        _selectedScene = null;
        _selectedInstruments.clear();
        console.log('[SceneBuilderPage] Destroyed.');
    }

    window.SceneBuilderPage = { init, destroy };
})();
