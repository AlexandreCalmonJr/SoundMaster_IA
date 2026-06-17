'use strict';

/**
 * @fileoverview Scene builder page for creating, previewing, and applying mixer scenes.
 */
(function () {
    var pm = createPageModule();
    var _selectedScene = null;
    var _selectedInstruments = new Set();
    var _genreColorMap = {
        louvor: 'cyan',
        pregacao: 'orange',
        musica: 'green',
        transicao: 'amber',
        intervalo: 'slate',
        geral: 'slate'
    };
    var _genreHexMap = {
        louvor: '#06b6d4',
        pregacao: '#f97316',
        musica: '#22c55e',
        transicao: '#fbbf24',
        intervalo: '#64748b',
        geral: '#64748b'
    };

    function _formatDate(ts) {
        if (!ts) return '--';
        return new Date(ts).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function _getScenes() {
        return window.SceneBuilderService ? SceneBuilderService.loadScenes() : [];
    }

    function _renderEmptyState(el, text, className) {
        if (!el) return;
        el.textContent = '';
        var div = document.createElement('div');
        div.className = className;
        div.textContent = text;
        el.appendChild(div);
    }

    function _renderAiStatus(el, text, className) {
        if (!el) return;
        el.classList.remove('hidden');
        el.textContent = '';
        var span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        el.appendChild(span);
    }

    function _createPreviewMetric(label, value) {
        var card = document.createElement('div');
        card.className = 'bg-slate-800/40 rounded-xl p-3 text-center';

        var labelEl = document.createElement('div');
        labelEl.className = 'text-xs text-slate-500 mb-1';
        labelEl.textContent = label;

        var valueEl = document.createElement('div');
        valueEl.className = 'text-sm font-bold text-cyan-400';
        valueEl.textContent = value;

        card.appendChild(labelEl);
        card.appendChild(valueEl);
        return card;
    }

    function _resetPreview() {
        pm._setText('sb-preview-name', 'Selecione uma cena');

        var meta = pm._el('sb-preview-meta');
        if (meta) {
            meta.textContent = '';
        }

        var content = pm._el('sb-preview-content');
        if (content) {
            content.textContent = '';
            var empty = document.createElement('p');
            empty.className = 'text-sm';
            empty.textContent = 'Clique em uma cena para visualizar';
            content.appendChild(empty);
        }

        pm._toggleClasses('sb-preview-actions', ['hidden'], []);
    }

    function _renderSceneList() {
        var container = pm._el('sb-scene-list');
        if (!container) return;

        var scenes = _getScenes();
        if (scenes.length === 0) {
            _renderEmptyState(container, 'Nenhuma cena salva', 'text-center text-slate-600 text-xs py-8');
            return;
        }

        container.textContent = '';
        scenes.forEach(function (scene, index) {
            var color = _genreColorMap[scene.genre] || 'slate';
            var btn = document.createElement('button');
            btn.className =
                'sb-scene-item w-full text-left p-3 rounded-xl bg-slate-800/60 hover:bg-slate-700/60 border border-white/5 ' +
                'hover:border-' + color + '-500/30 transition-all';
            btn.setAttribute('data-index', String(index));

            var title = document.createElement('div');
            title.className = 'text-sm font-bold text-' + color + '-400';
            title.textContent = scene.name || '';

            var meta = document.createElement('div');
            meta.className = 'text-[10px] text-slate-500 mt-1';
            meta.textContent = (scene.genre || '') + ' • ' + _formatDate(scene.timestamp);

            btn.appendChild(title);
            btn.appendChild(meta);
            pm._on(btn, 'click', function () {
                _selectSceneByIndex(index);
            });
            container.appendChild(btn);
        });
    }

    function _renderThumbnails() {
        var container = pm._el('sb-thumbnails');
        if (!container) return;

        var scenes = _getScenes();
        if (scenes.length === 0) {
            _renderEmptyState(container, 'Sem miniaturas', 'col-span-full text-center text-slate-600 text-xs py-8');
            return;
        }

        container.textContent = '';
        scenes.forEach(function (scene, index) {
            var color = _genreHexMap[scene.genre] || '#64748b';
            var thumb = document.createElement('div');
            thumb.className = 'sb-thumbnail aspect-video rounded-lg cursor-pointer hover:ring-2 transition-all relative overflow-hidden';
            thumb.setAttribute('data-index', String(index));
            thumb.style.background = 'linear-gradient(135deg, ' + color + '22, ' + color + '44)';
            thumb.style.border = '1px solid ' + color + '33';

            var center = document.createElement('div');
            center.className = 'absolute inset-0 flex items-center justify-center';

            var dot = document.createElement('div');
            dot.className = 'w-8 h-8 rounded-full border-2';
            dot.style.borderColor = color + '66';
            dot.style.background = color + '22';

            var label = document.createElement('div');
            label.className = 'absolute bottom-1 left-1 right-1 text-[8px] font-bold text-white truncate';
            label.textContent = scene.name || '';

            center.appendChild(dot);
            thumb.appendChild(center);
            thumb.appendChild(label);
            pm._on(thumb, 'click', function () {
                _selectSceneByIndex(index);
            });
            container.appendChild(thumb);
        });
    }

    function _selectSceneByIndex(index) {
        var scenes = _getScenes();
        _selectedScene = scenes[index] || null;
        if (!_selectedScene) return;

        pm._setText('sb-preview-name', _selectedScene.name || 'Cena');

        var meta = pm._el('sb-preview-meta');
        if (meta) {
            meta.textContent = '';

            var genre = document.createElement('div');
            genre.textContent = _selectedScene.genre || '';

            var date = document.createElement('div');
            date.textContent = _formatDate(_selectedScene.timestamp);

            meta.appendChild(genre);
            meta.appendChild(date);
        }

        var content = pm._el('sb-preview-content');
        if (content) {
            content.textContent = '';

            var wrapper = document.createElement('div');
            wrapper.className = 'w-full space-y-3';

            if (_selectedScene.description) {
                var description = document.createElement('p');
                description.className = 'text-sm text-slate-400';
                description.textContent = _selectedScene.description;
                wrapper.appendChild(description);
            }

            var grid = document.createElement('div');
            grid.className = 'grid grid-cols-3 gap-3';
            grid.appendChild(_createPreviewMetric('Estilo', _selectedScene.genre || '--'));
            grid.appendChild(_createPreviewMetric('Canais', String(_selectedScene.channels || 16)));
            grid.appendChild(_createPreviewMetric('Mix', _selectedScene.mixType || 'Estereo'));
            wrapper.appendChild(grid);

            if (_selectedScene.aiData) {
                var aiCard = document.createElement('div');
                aiCard.className = 'bg-cyan-900/20 border border-cyan-500/20 rounded-xl p-3 text-xs text-slate-400';

                var aiLabel = document.createElement('strong');
                aiLabel.className = 'text-cyan-400';
                aiLabel.textContent = 'IA:';

                aiCard.appendChild(aiLabel);
                aiCard.appendChild(document.createTextNode(' ' + _selectedScene.aiData));
                wrapper.appendChild(aiCard);
            }

            content.appendChild(wrapper);
        }

        pm._toggleClasses('sb-preview-actions', [], ['hidden']);
    }

    function _showModal(id) {
        var modal = pm._el(id);
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    function _hideModal(id) {
        var modal = pm._el(id);
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    function init() {
        pm._on(pm._el('sb-new-scene'), 'click', function () {
            _showModal('sb-new-scene-modal');
            var nameInput = pm._el('sb-new-name');
            var descInput = pm._el('sb-new-desc');
            if (nameInput) nameInput.value = '';
            if (descInput) descInput.value = '';
        });

        pm._on(pm._el('sb-ai-generate'), 'click', function () {
            _showModal('sb-ai-modal');
            var promptInput = pm._el('sb-ai-prompt');
            var result = pm._el('sb-ai-result');
            if (promptInput) promptInput.value = '';
            if (result) result.classList.add('hidden');
        });

        pm._on(pm._el('sb-cancel-new'), 'click', function () {
            _hideModal('sb-new-scene-modal');
        });

        pm._on(pm._el('sb-cancel-ai'), 'click', function () {
            _hideModal('sb-ai-modal');
        });

        pm._on(pm._el('sb-save-new'), 'click', function () {
            var name = pm._el('sb-new-name') ? pm._el('sb-new-name').value.trim() : '';
            if (!name) return;

            pm._safeCall('SceneBuilderService', 'createScene', {
                name: name,
                genre: pm._el('sb-new-genre') ? pm._el('sb-new-genre').value : 'geral',
                description: pm._el('sb-new-desc') ? pm._el('sb-new-desc').value.trim() : ''
            });

            _hideModal('sb-new-scene-modal');
            _renderSceneList();
            _renderThumbnails();
        });

        pm._on(pm._el('sb-generate-ai'), 'click', async function () {
            var prompt = pm._el('sb-ai-prompt') ? pm._el('sb-ai-prompt').value.trim() : '';
            if (!prompt) return;

            var result = pm._el('sb-ai-result');
            if (result) {
                _renderAiStatus(result, 'Gerando com IA...', 'text-cyan-400 animate-pulse');
            }

            try {
                var instArray = Array.from(_selectedInstruments);
                if (window.SceneBuilderService && typeof SceneBuilderService.generateWithAI === 'function') {
                    await SceneBuilderService.generateWithAI(prompt, instArray);
                }
                if (result) {
                    _renderAiStatus(result, 'Cena gerada com sucesso!', 'text-green-400');
                }
                _renderSceneList();
                _renderThumbnails();
            } catch (err) {
                if (result) {
                    _renderAiStatus(result, 'Erro: ' + (err && err.message ? err.message : 'Falha ao gerar cena'), 'text-red-400');
                }
            }
        });

        pm._on(pm._el('sb-apply-scene'), 'click', function () {
            if (_selectedScene) {
                pm._safeCall('SceneBuilderService', 'applyScene', _selectedScene);
            }
        });

        pm._on(pm._el('sb-delete-scene'), 'click', function () {
            if (!_selectedScene) return;
            pm._safeCall('SceneBuilderService', 'deleteScene', _selectedScene.id);
            _selectedScene = null;
            _resetPreview();
            _renderSceneList();
            _renderThumbnails();
        });

        document.querySelectorAll('.sb-quick-preset').forEach(function (btn) {
            pm._on(btn, 'click', function () {
                var preset = this.getAttribute('data-preset');
                var presets = {
                    louvor: { name: 'Louvor', genre: 'louvor', description: 'Mix completo com energia', channels: 16, mixType: 'Estereo' },
                    pregacao: { name: 'Pregacao', genre: 'pregacao', description: 'Foco em voz e monitor', channels: 8, mixType: 'Estereo' },
                    silencio: { name: 'Silencio', genre: 'intervalo', description: 'Sem som', channels: 16, mixType: 'Mute' },
                    transicao: { name: 'Transicao', genre: 'transicao', description: 'Fade e preparo', channels: 16, mixType: 'Estereo' }
                };
                var data = presets[preset];
                if (data) {
                    pm._safeCall('SceneBuilderService', 'createScene', data);
                    _renderSceneList();
                    _renderThumbnails();
                }
            });
        });

        document.querySelectorAll('.sb-ai-inst').forEach(function (btn) {
            pm._on(btn, 'click', function () {
                var inst = this.getAttribute('data-inst');
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
        if (!_selectedScene) {
            _resetPreview();
        }
    }

    function destroy() {
        pm.destroy();
        _selectedScene = null;
        _selectedInstruments.clear();
    }

    window.SceneBuilderPage = {
        init: init,
        destroy: destroy
    };
})();
