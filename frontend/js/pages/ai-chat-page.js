/**
 * SoundMaster — AI Chat Page Module
 * Bridges the AI command center logic to the dynamic page module system.
 */

'use strict';

(function () {
    const pm = createPageModule();

    let els = {};
    function _getEls() {
        return {
            chatMessages:      pm._el('chat-messages'),
            chatInput:         pm._el('chat-input'),
            btnSend:           pm._el('btn-chat-send'),
            btnClear:          pm._el('btn-clear-chat'),
            btnListen:         pm._el('btn-ai-listen'),
            chatStatus:        pm._el('chat-status'),
            aiTargetChannel:   pm._el('ai-target-channel'),
            btnSendAnalysis:   pm._el('btn-ai-send-analysis'),
            btnSendPinkReport: pm._el('btn-ai-send-pink-report'),
            btnCleanChannel:   pm._el('btn-ai-clean-channel'),
            btnHpf:            pm._el('btn-ai-hpf'),
            btnGate:           pm._el('btn-ai-gate'),
            btnCompressor:     pm._el('btn-ai-compressor'),
            btnEqMud:          pm._el('btn-ai-eq-mud'),
            btnEqHarsh:        pm._el('btn-ai-eq-harsh'),
            btnAfsOn:          pm._el('btn-ai-afs-on'),
            btnAfsOff:         pm._el('btn-ai-afs-off'),
        };
    }

    function _renderAIStatus(status) {
        if (!els.chatStatus) return;
        const map = {
            online:  { text: 'Online',        color: 'var(--success)' },
            offline: { text: 'Offline',        color: 'var(--danger)'  },
            loading: { text: 'Processando...', color: 'var(--warning)' },
        };
        const s = map[status] || map.offline;
        els.chatStatus.innerText = s.text;
        els.chatStatus.style.color = s.color;
    }

    // Config DOMPurify — usada em _renderMarkdown.
    // Allowlist explícita: apenas tags e atributos gerados pelo próprio renderizador.
    const _PURIFY_CONFIG = {
        ALLOWED_TAGS: ['h1', 'h2', 'h3', 'strong', 'em', 'code', 'li', 'br'],
        ALLOWED_ATTR: ['class'],
        ALLOW_DATA_ATTR: false,
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
        FORCE_BODY: false,
    };

    function _sanitize(html) {
        if (window.DOMPurify && typeof DOMPurify.sanitize === 'function') {
            return DOMPurify.sanitize(html, _PURIFY_CONFIG);
        }
        // Fallback seguro: remove qualquer tag restante se DOMPurify não estiver disponível
        return html.replace(/<(?!\/?(h[123]|strong|em|code|li|br)\b)[^>]+>/gi, '');
    }

    function _renderMarkdown(text) {
        if (!text) return '';
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Headers
        html = html.replace(/^### (.*?)$/gm, '<h3 class="text-base font-bold text-cyan-400 mt-2 mb-1">$1</h3>');
        html = html.replace(/^## (.*?)$/gm, '<h2 class="text-lg font-bold text-cyan-400 mt-3 mb-2">$1</h2>');
        html = html.replace(/^# (.*?)$/gm, '<h1 class="text-xl font-bold text-cyan-400 mt-4 mb-2">$1</h1>');

        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-white">$1</strong>');

        // Italic
        html = html.replace(/\*(.*?)\*/g, '<em class="italic text-slate-300">$1</em>');

        // Inline Code
        html = html.replace(/`(.*?)`/g, '<code class="bg-black/60 font-mono px-1 rounded text-cyan-300 text-xs">$1</code>');

        // List items
        html = html.replace(/^[-\*] (.*?)$/gm, '<li class="ml-4 list-disc text-sm text-slate-300">$1</li>');

        // New lines
        html = html.replace(/\n/g, '<br>');

        return _sanitize(html);
    }

    function _saveMessageToHistory(text, isUser, command, id, executed = false) {
        try {
            const currentHistory = AppStore.getState().aiChatHistory || [];
            // Remove duplicates of same message ID if existing
            const filtered = currentHistory.filter(msg => msg.id !== id);
            const updatedHistory = filtered.concat({
                text, isUser, command, id, executed, ts: Date.now()
            });
            AppStore.setState({ aiChatHistory: updatedHistory });
        } catch (e) {
            console.error('[AiChatPage] Error saving message to history:', e);
        }
    }

    function _markCommandExecutedInHistory(id) {
        try {
            const currentHistory = AppStore.getState().aiChatHistory || [];
            const updatedHistory = currentHistory.map(msg => {
                if (msg.id === id) {
                    return Object.assign({}, msg, { executed: true });
                }
                return msg;
            });
            AppStore.setState({ aiChatHistory: updatedHistory });
        } catch (e) {
            console.error('[AiChatPage] Error marking command executed:', e);
        }
    }

    function _appendBubble(text, isUser, command, id, saveToHistory = true, executed = false) {
        if (!els.chatMessages) return;

        if (!id) {
            id = 'msg-' + Math.random().toString(36).substr(2, 9);
        }

        const bubble = document.createElement('div');
        bubble.id = id;
        bubble.className = 'chat-bubble ' + (isUser ? 'chat-user' : 'chat-assistant');
        
        // Render raw dots or loading states as plain text, others as markdown
        if (text === '...' || text === 'Analisando dados acústicos...' || text === 'Analisando áudio ao vivo...') {
            bubble.innerText = text;
        } else {
            bubble.innerHTML = _renderMarkdown(text);
        }

        if (command && !isUser) {
            const card = document.createElement('div');
            card.className = 'mt-3 bg-slate-950/80 border border-cyan-500/30 rounded-xl p-4 shadow-lg transition-all hover:border-cyan-500/50 text-left';
            
            card.innerHTML = `
                <div class="flex items-center justify-between mb-2">
                    <span class="text-[10px] uppercase font-bold tracking-wider text-cyan-400">Recomendação da IA</span>
                    <span class="text-[9px] font-mono bg-cyan-950 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/20">Human-In-The-Loop</span>
                </div>
                <p class="text-xs text-white font-semibold mb-2">${(command.desc || 'Ajuste de Mixer').replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; })}</p>
                <div class="grid grid-cols-3 gap-2 bg-slate-900/60 p-2 rounded-lg mb-3 border border-white/5 font-mono text-[10px] text-slate-400">
                    <div>Canal: <span class="text-cyan-300">${command.channel !== undefined ? command.channel : '-'}</span></div>
                    <div>Ação: <span class="text-cyan-300">${command.action || '-'}</span></div>
                    <div>Valor: <span class="text-cyan-300">${command.value !== undefined ? command.value : '-'}</span></div>
                </div>
                <div class="flex gap-2 justify-end">
                    <button class="ignore-btn px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-400 hover:text-white transition-all">Ignorar</button>
                    <button class="exec-btn px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[10px] font-bold text-white transition-all shadow-md shadow-cyan-950/50 flex items-center gap-1">
                        <span>⚡</span> Aplicar Ajuste
                    </button>
                </div>
            `;

            const btnExec = card.querySelector('.exec-btn');
            const btnIgnore = card.querySelector('.ignore-btn');

            if (executed) {
                btnExec.innerText = 'Executado ✓';
                btnExec.disabled = true;
                btnExec.style.background = 'var(--success)';
                btnIgnore.style.display = 'none';
            } else {
                pm._on(btnExec, 'click', function () {
                    const ok = MixerService.executeAICommand(command);
                    if (ok) {
                        btnExec.innerText = 'Executado ✓';
                        btnExec.disabled = true;
                        btnExec.style.background = 'var(--success)';
                        btnIgnore.style.display = 'none';
                        _markCommandExecutedInHistory(id);
                    } else {
                        btnExec.innerText = '⚠️ Conecte-se à mesa primeiro';
                    }
                });

                pm._on(btnIgnore, 'click', function () {
                    card.style.opacity = '0.5';
                    btnExec.disabled = true;
                    btnIgnore.disabled = true;
                });
            }

            bubble.appendChild(card);
        }

        els.chatMessages.appendChild(bubble);
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

        if (saveToHistory) {
            _saveMessageToHistory(text, isUser, command, id, executed);
        }
    }

    function _clearChat() {
        if (!els.chatMessages) return;
        els.chatMessages.innerHTML = '';
        AppStore.setState({ aiChatHistory: [] });
        _appendBubble('Pronto para novas instruções. Explique o problema de som.', false, null, null, true, false);
    }

    function _getTargetChannel() {
        let val = Number(els.aiTargetChannel && els.aiTargetChannel.value);
        if (!Number.isInteger(val) || val < 1 || val > 24) {
            val = 1;
            if (els.aiTargetChannel) els.aiTargetChannel.value = 1;
        }
        return val;
    }

    function _getCurrentAnalysis() {
        if (!window.SoundMasterAnalyzer || !window.SoundMasterAnalyzer.hasAnalysis()) {
            alert('Ative o analisador e aguarde alguns segundos antes de enviar a análise.');
            return null;
        }
        return window.SoundMasterAnalyzer.getLastAnalysis();
    }

    function _buildRt60Multiband(lastRt60) {
        if (!lastRt60) return null;
        if (lastRt60.multiband && typeof lastRt60.multiband === 'object' && Object.keys(lastRt60.multiband).length) {
            return lastRt60.multiband;
        }
        const value = Number(lastRt60.rt60);
        if (!Number.isFinite(value)) return null;
        return {
            '125': value,
            '500': value,
            '1000': value,
            '4000': value
        };
    }

    async function _sendAcousticAnalysis(usePinkReport) {
        const channel = _getTargetChannel();
        if (!channel) return;

        const analysis = _getCurrentAnalysis();
        if (!analysis) return;
        if (usePinkReport && !analysis.pinkReport) {
            alert('Não há relatório de ruído rosa. Faça a medição rosa antes de enviar.');
            return;
        }

        const message = usePinkReport ? 'Relatório de ruído rosa do salão' : 'Análise acústica do salão';
        _appendBubble(message, true, null);

        const lastRt60 = window.SoundMasterAnalyzer?.getLastRt60();
        const rt60Multiband = _buildRt60Multiband(lastRt60);
        const payload = {
            schema_version: '1.1',
            summary: analysis.text,
            spectrum_db: analysis.details?.spectrum_v11 || {},
            rt60_multiband: rt60Multiband,
            peakHz: analysis.details?.peakHz,
            peakDb: analysis.details?.peakDb,
            rms: analysis.details?.rmsDb,
        };

        if (analysis.pinkReport) {
            payload.pinkReport = analysis.pinkReport;
        }

        const loadingId = 'ai-loading-' + Date.now();
        _appendBubble('Analisando dados acústicos...', false, null, loadingId, false);

        try {
            const result = await AIService.ask(message, channel, payload);
            const loadingBubble = pm._el(loadingId);
            if (loadingBubble) loadingBubble.remove();
            
            _appendBubble(result.text, false, result.command);
            if (result.report) {
                _appendBubble(result.report, false, null);
            }
        } catch (err) {
            const loadingBubble = pm._el(loadingId);
            if (loadingBubble) loadingBubble.remove();
            _appendBubble('Erro ao processar análise: ' + err.message, false, null);
        }
    }

    async function _sendMessage(text) {
        if (!text || !text.trim()) return;

        const channel = _getTargetChannel();
        if (!channel) return;

        if (els.chatInput) els.chatInput.disabled = true;
        if (els.btnSend) els.btnSend.disabled = true;

        _appendBubble(text.trim(), true, null);
        if (els.chatInput) els.chatInput.value = '';

        const loadingId = 'msg-loading-' + Date.now();
        _appendBubble('...', false, null, loadingId, false);

        try {
            const result = await AIService.ask(text.trim(), channel);
            const loadingBubble = pm._el(loadingId);
            if (loadingBubble) loadingBubble.remove();
            
            _appendBubble(result.text, false, result.command);
            if (result.report) {
                _appendBubble(result.report, false, null);
            }
        } catch (err) {
            const loadingBubble = pm._el(loadingId);
            if (loadingBubble) loadingBubble.innerText = 'Erro na conexão com IA. Verifique o servidor local.';
        } finally {
            if (els.chatInput) {
                els.chatInput.disabled = false;
                els.chatInput.focus();
            }
            if (els.btnSend) els.btnSend.disabled = false;
        }
    }

    function _initEvents() {
        if (els.btnSend) {
            pm._on(els.btnSend, 'click', function() {
                const text = els.chatInput && els.chatInput.value.trim();
                if (text) _sendMessage(text);
                else alert('O campo de texto está vazio!');
            });
        }

        if (els.chatInput) {
            pm._on(els.chatInput, 'keypress', function (e) {
                if (e.key === 'Enter' && els.chatInput.value.trim()) {
                    _sendMessage(els.chatInput.value.trim());
                }
            });
        }

        if (els.btnClear) {
            pm._on(els.btnClear, 'click', _clearChat);
        }

        if (els.btnListen) {
            pm._on(els.btnListen, 'click', async function () {
                var channel = _getTargetChannel();
                _appendBubble('IA ouvindo o microfone...', true, null);

                var loadingId = 'ai-listen-loading-' + Date.now();
                _appendBubble('Analisando áudio ao vivo...', false, null, loadingId, false);

                try {
                    var result = await AIService.listenAndAnalyze(channel);
                    var loadingBubble = pm._el(loadingId);
                    if (loadingBubble) loadingBubble.remove();
                    _appendBubble(result.text, false, result.command);
                    if (result.report) {
                        _appendBubble(result.report, false, null);
                    }
                } catch (err) {
                    var loadingBubble = pm._el(loadingId);
                    if (loadingBubble) loadingBubble.remove();
                    _appendBubble('Erro ao ouvir microfone: ' + err.message, false, null);
                }
            });
        }

        // Fast prompts delegation via parent container or global selector inside iframe
        const promptButtons = pm._el('ai-chat')?.querySelectorAll('.sound-ai-prompt') || document.querySelectorAll('.sound-ai-prompt');
        if (promptButtons) {
            promptButtons.forEach(function (btn) {
                pm._on(btn, 'click', function () {
                    const text = btn.dataset.prompt || btn.innerText;
                    if (els.chatInput) els.chatInput.value = text;
                    _sendMessage(text);
                });
            });
        }

        if (els.btnSendAnalysis) {
            pm._on(els.btnSendAnalysis, 'click', function () {
                _sendAcousticAnalysis(false);
            });
        }
        if (els.btnSendPinkReport) {
            pm._on(els.btnSendPinkReport, 'click', function () {
                _sendAcousticAnalysis(true);
            });
        }

        function _quickAction(btn, fn) {
            if (btn) {
                pm._on(btn, 'click', function () {
                    const ch = _getTargetChannel();
                    if (ch !== null) {
                        const ok = fn(ch);
                        if (ok === false) {
                            _appendBubble('⚠️ Conecte-se à mesa antes de realizar ações rápidas.', false, null);
                        }
                    }
                });
            }
        }

        function _quickGlobal(btn, fn) {
            if (btn) {
                pm._on(btn, 'click', function() {
                    const ok = fn();
                    if (ok === false) {
                        _appendBubble('⚠️ Mixer não conectado.', false, null);
                    }
                });
            }
        }

        _quickAction(els.btnCleanChannel, function (ch) { return MixerService.runCleanSoundPreset(ch); });
        _quickAction(els.btnHpf,          function (ch) { return MixerService.applyHpf(ch, 100);       });
        _quickAction(els.btnGate,         function (ch) { return MixerService.applyGate(ch);            });
        _quickAction(els.btnCompressor,   function (ch) { return MixerService.applyCompressor(ch);      });
        _quickAction(els.btnEqMud,        function (ch) { return MixerService.applyEqCut('channel', ch, 250, -3, 1.1, 2); });
        _quickAction(els.btnEqHarsh,      function (ch) { return MixerService.applyEqCut('channel', ch, 3200, -2.5, 1.5, 3); });

        _quickGlobal(els.btnAfsOn,  function () { 
            const ok = MixerService.setAfs(true);
            if (ok) {
                els.btnAfsOn.classList.add('bg-cyan-500', 'text-white');
                els.btnAfsOff.classList.remove('bg-red-500', 'text-white');
            }
            return ok;
        });
        _quickGlobal(els.btnAfsOff, function () { 
            const ok = MixerService.setAfs(false);
            if (ok) {
                els.btnAfsOff.classList.add('bg-red-500', 'text-white');
                els.btnAfsOn.classList.remove('bg-cyan-500', 'text-white');
            }
            return ok;
        });
    }

    function init() {
        console.log('[AiChatPage] Inicializando...');
        els = _getEls();
        _initEvents();

        if (els.chatInput) {
            pm._setTimeout(function () { els.chatInput.focus(); }, 100);
        }

        pm._subscribe('AppStore', 'aiStatus', _renderAIStatus);

        // Set initial AI status
        const initialStatus = AppStore.getState?.().aiStatus || 'online';
        _renderAIStatus(initialStatus);

        // Carregar histórico ou mensagem inicial
        const history = AppStore.getState?.().aiChatHistory || [];
        if (history.length > 0) {
            if (els.chatMessages) els.chatMessages.innerHTML = '';
            history.forEach(msg => {
                _appendBubble(msg.text, msg.isUser, msg.command, msg.id, false, msg.executed);
            });
        } else {
            if (els.chatMessages) els.chatMessages.innerHTML = '';
            _appendBubble(
                'Bem-vindo ao Centro de Comando IA. Estou monitorando o sistema em tempo real. Como posso otimizar seu som agora?',
                false,
                null,
                'welcome-msg',
                true,
                false
            );
        }

        AIService.ping();
    }

    function destroy() {
        pm.destroy();
    }

    window.AiChatPage = {
        init: init,
        destroy: destroy,
        sendAnalysis: _sendAcousticAnalysis
    };
})();
