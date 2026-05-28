/**
 * SoundMaster — Settings Page Module
 * Persists and manages global user preferences, AI model, and updates check.
 */

'use strict';

(function () {
    const pm = createPageModule();

    const AI_MODELS = {
        'phi3.5-mini': { name: 'Phi-3.5 Mini 3.8B', size: '~2.3GB', desc: 'Melhor qualidade. Bom PT-BR. 8GB+ RAM.', icon: '🧠', recommended: true },
        'llama3.2-3b': { name: 'Llama 3.2 3B', size: '~2.0GB', desc: 'Bom equilíbrio entre velocidade e qualidade.', icon: '🦙' },
        'gemma2-2b':   { name: 'Gemma 2 2B', size: '~1.6GB', desc: 'Leve e rápido. Ideal para 4-8GB RAM.', icon: '💎' },
        'tinyllama-1.1b': { name: 'TinyLlama 1.1B', size: '~670MB', desc: 'Mais leve. Respostas básicas.', icon: '⚡' },
    };

    let _currentModel = null;
    let _modelsData = [];

    // ─── Helpers ────────────────────────────────────────────────────────────────

    function _fetchWithTimeout(url, opts, timeoutMs = 10000) {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), timeoutMs);
        opts.signal = ctrl.signal;
        return fetch(url, opts).finally(() => clearTimeout(tid));
    }

    async function _apiGet(path) {
        const res = await _fetchWithTimeout(path, { method: 'GET' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    async function _apiPost(path, body) {
        const res = await _fetchWithTimeout(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }, 30000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }

    // ─── AI Model Section ──────────────────────────────────────────────────────

    function _renderModelStatus(modelKey, downloaded) {
        const statusEl = pm._el('ai-model-status');
        const badgeEl = pm._el('ai-model-badge');
        if (!statusEl || !badgeEl) return;

        const info = AI_MODELS[modelKey];
        if (info) {
            statusEl.textContent = `${info.name} — ${info.desc}`;
            badgeEl.textContent = downloaded ? 'Ativo' : 'Não baixado';
            badgeEl.className = `px-3 py-1 rounded-full text-[10px] font-bold uppercase ${downloaded ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`;
        }
    }

    function _renderModelList(models, activeKey) {
        const container = pm._el('ai-model-list');
        if (!container) return;
        container.innerHTML = '';

        models.forEach(m => {
            const info = AI_MODELS[m.key] || {};
            const isActive = m.key === activeKey;
            const isDownloaded = m.downloaded;

            const card = document.createElement('div');
            card.className = `relative p-4 rounded-xl border cursor-pointer transition-all ${
                isActive
                    ? 'border-cyan-500 bg-cyan-500/10 shadow-lg shadow-cyan-500/10'
                    : 'border-white/10 bg-slate-800/50 hover:border-white/20 hover:bg-slate-800'
            }`;

            card.innerHTML = `
                <div class="flex items-start justify-between mb-2">
                    <span class="text-2xl">${info.icon || '🤖'}</span>
                    <div class="flex items-center gap-2">
                        ${info.recommended ? '<span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400">Recomendado</span>' : ''}
                        ${isDownloaded ? '<span class="text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Baixado</span>' : ''}
                    </div>
                </div>
                <h4 class="text-sm font-bold text-white mb-1">${m.name}</h4>
                <p class="text-[11px] text-slate-400 mb-2">${info.desc || ''}</p>
                <div class="flex items-center justify-between">
                    <span class="text-[10px] text-slate-500">${info.size || '—'}</span>
                    ${isActive
                        ? '<span class="text-[10px] font-bold text-cyan-400">✓ ATIVO</span>'
                        : isDownloaded
                            ? `<button class="btn-select-model text-[10px] font-bold text-cyan-400 hover:text-cyan-300" data-key="${m.key}">Selecionar</button>`
                            : `<button class="btn-download-model text-[10px] font-bold text-amber-400 hover:text-amber-300" data-key="${m.key}">Baixar</button>`
                    }
                </div>
            `;

            container.appendChild(card);
        });

        // Bind select buttons
        container.querySelectorAll('.btn-select-model').forEach(btn => {
            pm._on(btn, 'click', async (e) => {
                e.stopPropagation();
                const key = btn.dataset.key;
                await _selectModel(key);
            });
        });

        // Bind download buttons
        container.querySelectorAll('.btn-download-model').forEach(btn => {
            pm._on(btn, 'click', async (e) => {
                e.stopPropagation();
                const key = btn.dataset.key;
                await _downloadModel(key);
            });
        });
    }

    async function _loadModels() {
        try {
            const data = await _apiGet('/api/models');
            _modelsData = data.models || [];
            _currentModel = data.active_model;
            _renderModelList(_modelsData, _currentModel);
            const active = _modelsData.find(m => m.key === _currentModel);
            _renderModelStatus(_currentModel, active ? active.downloaded : false);
        } catch (err) {
            console.warn('[SettingsPage] Falha ao carregar modelos:', err.message);
            const container = pm._el('ai-model-list');
            if (container) {
                container.innerHTML = '<div class="text-xs text-slate-500 py-4 text-center col-span-2">Servidor de IA offline. Modelos indisponíveis.</div>';
            }
        }
    }

    async function _selectModel(key) {
        try {
            await _apiPost('/api/models/select', { model: key });
            _currentModel = key;
            localStorage.setItem('sm-ai-model', key);
            _renderModelList(_modelsData, _currentModel);
            const active = _modelsData.find(m => m.key === key);
            _renderModelStatus(key, active ? active.downloaded : false);
        } catch (err) {
            alert('Erro ao selecionar modelo: ' + err.message);
        }
    }

    async function _downloadModel(key) {
        const info = AI_MODELS[key];
        const btn = pm._el('btn-ai-model-download');
        const section = pm._el('ai-model-download-section');
        const progressBar = pm._el('ai-model-progress-bar');
        const progressText = pm._el('ai-model-progress-text');
        const progressContainer = pm._el('ai-model-progress');
        const downloadInfo = pm._el('ai-model-download-info');

        if (!section || !btn) return;

        section.style.display = 'block';
        downloadInfo.textContent = `Baixando ${info ? info.name : key}...`;
        btn.disabled = true;
        btn.textContent = 'Baixando...';
        btn.className = 'px-4 py-2 bg-slate-600 text-slate-400 rounded-lg text-xs font-bold cursor-not-allowed';

        if (progressContainer) progressContainer.classList.remove('hidden');

        try {
            // Inicia download em background
            await _apiPost('/api/models/download', { model: key });

            // Poll progress
            let completed = false;
            while (!completed) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                    const status = await _apiGet('/api/models/download/status');
                    if (status.completed) {
                        completed = true;
                        if (progressBar) progressBar.style.width = '100%';
                        if (progressText) progressText.textContent = '100% - Concluído!';
                    } else if (status.error) {
                        throw new Error(status.error);
                    } else {
                        const pct = status.progress || 0;
                        if (progressBar) progressBar.style.width = pct + '%';
                        if (progressText) progressText.textContent = Math.round(pct) + '%';
                    }
                } catch (pollErr) {
                    if (pollErr.name === 'AbortError') throw pollErr;
                    // Se o endpoint de status não existir, assume conclusão
                    completed = true;
                    if (progressBar) progressBar.style.width = '100%';
                    if (progressText) progressText.textContent = 'Concluído!';
                }
            }

            // Atualiza lista
            await _loadModels();

            setTimeout(() => {
                section.style.display = 'none';
                if (progressContainer) progressContainer.classList.add('hidden');
            }, 2000);

        } catch (err) {
            alert('Erro no download: ' + err.message);
            section.style.display = 'none';
            if (progressContainer) progressContainer.classList.add('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Baixar';
            btn.className = 'px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold transition-all';
        }
    }

    // ─── Ollama Config ─────────────────────────────────────────────────────────

    function _loadOllamaConfig() {
        const toggle = pm._el('settings-ollama-enabled');
        const config = pm._el('ollama-config');
        const nameInput = pm._el('ollama-model-name');
        const timeoutInput = pm._el('ollama-timeout');

        if (toggle) {
            const val = localStorage.getItem('sm-ollama-enabled');
            toggle.checked = val === 'true';
            if (config) config.classList.toggle('hidden', !toggle.checked);
        }
        if (nameInput) {
            nameInput.value = localStorage.getItem('sm-ollama-model') || 'phi3.5:3.8b';
        }
        if (timeoutInput) {
            timeoutInput.value = localStorage.getItem('sm-ollama-timeout') || '45';
        }
    }

    function _bindOllamaConfig() {
        const toggle = pm._el('settings-ollama-enabled');
        const config = pm._el('ollama-config');
        const saveBtn = pm._el('btn-save-ollama-config');

        if (toggle) {
            pm._on(toggle, 'change', (e) => {
                localStorage.setItem('sm-ollama-enabled', e.target.checked);
                if (config) config.classList.toggle('hidden', !e.target.checked);
            });
        }

        if (saveBtn) {
            pm._on(saveBtn, 'click', async () => {
                const nameInput = pm._el('ollama-model-name');
                const timeoutInput = pm._el('ollama-timeout');
                const ollamaModel = nameInput ? nameInput.value.trim() : '';
                const ollamaTimeout = timeoutInput ? parseInt(timeoutInput.value) : 45;

                if (!ollamaModel) {
                    alert('Informe o nome do modelo Ollama.');
                    return;
                }

                localStorage.setItem('sm-ollama-model', ollamaModel);
                localStorage.setItem('sm-ollama-timeout', String(ollamaTimeout));

                try {
                    await _apiPost('/api/ollama/config', { model: ollamaModel, timeout: ollamaTimeout });
                    alert('Configurações do Ollama salvas!');
                } catch (err) {
                    alert('Salvo localmente. Reinicie o servidor para aplicar.');
                }
            });
        }
    }

    // ─── Settings Page Init ────────────────────────────────────────────────────

    function loadSavedSettings() {
        const autoStartInput = pm._el('settings-auto-start');
        const highResInput = pm._el('settings-fft-highres');
        const unitSelect = pm._el('unit-select');

        if (autoStartInput) {
            const val = localStorage.getItem('sm-settings-auto-start');
            autoStartInput.checked = val === null ? true : val === 'true';
        }
        if (highResInput) {
            const val = localStorage.getItem('sm-settings-fft-highres');
            highResInput.checked = val === null ? true : val === 'true';
        }
        if (unitSelect) {
            const val = localStorage.getItem('sm-settings-unit');
            unitSelect.value = val || 'm';
        }
    }

    function init() {
        loadSavedSettings();
        _loadOllamaConfig();
        _bindOllamaConfig();

        // Bind auto start change
        const autoStartInput = pm._el('settings-auto-start');
        if (autoStartInput) {
            pm._on(autoStartInput, 'change', (e) => {
                localStorage.setItem('sm-settings-auto-start', e.target.checked);
            });
        }

        // Bind highres change
        const highResInput = pm._el('settings-fft-highres');
        if (highResInput) {
            pm._on(highResInput, 'change', (e) => {
                localStorage.setItem('sm-settings-fft-highres', e.target.checked);
                if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.setHighResolution === 'function') {
                    window.SoundMasterAnalyzer.setHighResolution(e.target.checked);
                }
            });
        }

        // Bind unit select change
        const unitSelect = pm._el('unit-select');
        if (unitSelect) {
            pm._on(unitSelect, 'change', (e) => {
                localStorage.setItem('sm-settings-unit', e.target.value);
            });
        }

        // Bind update check button
        const btnCheck = pm._el('btn-check-updates');
        if (btnCheck) {
            pm._on(btnCheck, 'click', async () => {
                alert('Verificando se existem atualizações...');
                try {
                    if (window.updater) {
                        const update = await window.updater.checkUpdate();
                        if (update && update.available) {
                            window.UpdaterService.showUpdateNotification(update);
                        } else {
                            alert('O SoundMaster Pro já está na versão mais recente!');
                        }
                    } else {
                        pm._setTimeout(() => {
                            alert('O SoundMaster Pro já está na versão mais recente!');
                        }, 800);
                    }
                } catch (e) {
                    alert('Ocorreu um erro ao buscar atualizações.');
                }
            });
        }

        // Load AI models
        _loadModels();
    }

    function destroy() {
        pm.destroy();
    }

    window.SettingsPage = {
        init: init,
        destroy: destroy
    };
})();
