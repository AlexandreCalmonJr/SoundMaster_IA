/**
 * SoundMaster — Home Page Module
 * Displays server configuration, local network link, live system metrics, and premium AI Chat interface.
 */

'use strict';

(function () {
    const pm = createPageModule();
    let _rt60Listener = null;

    function _getEls() {
        return {
            homeSplVal: pm._el('home-spl-val'),
            homeRt60Val: pm._el('home-rt60-val'),
            homeMixerStatus: pm._el('home-mixer-status'),
            localIpCard: pm._el('local-ip-card'),
            serverIpDisplay: pm._el('server-ip-display'),
            mobileLink: pm._el('mobile-link'),
            mobileQrCode: pm._el('home-mobile-qr-code'),
            
            btnToggleIp: pm._el('btn-toggle-ip'),
            aiRing: pm._el('home-ai-ring'),
            introContainer: pm._el('home-intro-container'),
            chatContainer: pm._el('home-chat-container'),
            chatMessages: pm._el('home-chat-messages'),
            btnNewChat: pm._el('btn-home-new-chat'),
            promptPills: pm._el('home-prompt-pills'),
            targetChannel: pm._el('home-target-channel'),
            chatInput: pm._el('home-chat-input'),
            btnListen: pm._el('btn-home-listen'),
            btnSend: pm._el('btn-home-send'),
            btnClear: pm._el('btn-home-clear'),
            btnSendAnalysis: pm._el('btn-home-send-analysis'),
            btnExportChat: pm._el('btn-home-export-chat'),
            btnCycleSuggestions: pm._el('btn-cycle-suggestions'),
            suggestionCards: pm._el('home-suggestion-cards'),
            quickActions: pm._el('home-quick-actions'),
            charCounter: pm._el('home-char-counter'),
            workspaceWrapper: pm._el('home-workspace-wrapper')
        };
    }

    async function loadConfig() {
        try {
            const res = await fetch('/api/config');
            if (!res.ok) return;

            const config = await res.json();
            const els = _getEls();

            const serverUrl = `http://${config.localIp}:${config.port}`;
            if (els.serverIpDisplay) els.serverIpDisplay.innerText = serverUrl;
            
            const mobileHref = `${serverUrl}/mobile/index.html?mode=mobile`;
            if (els.mobileLink) {
                els.mobileLink.href = mobileHref;
            }
            
            if (els.mobileQrCode) {
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(mobileHref)}`;
                els.mobileQrCode.src = qrUrl;
                console.log('[HomePage] QR Code set to:', mobileHref);
            }
        } catch (e) {
            console.error('[HomePage] Error loading config:', e);
        }
    }

    // -------------------------------------------------------------------------
    // AI Chat Renderers and Utilities
    // -------------------------------------------------------------------------

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
        html = html.replace(/`/g, '`').replace(/`(.*?)`/g, '<code class="bg-black/60 font-mono px-1 rounded text-cyan-300 text-xs">$1</code>');

        // List items
        html = html.replace(/^[-\*] (.*?)$/gm, '<li class="ml-4 list-disc text-sm text-slate-300">$1</li>');

        // New lines
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    function _saveMessageToHistory(text, isUser, command, id, executed = false) {
        try {
            const currentHistory = AppStore.getState().aiChatHistory || [];
            const filtered = currentHistory.filter(msg => msg.id !== id);
            const updatedHistory = filtered.concat({
                text, isUser, command, id, executed, ts: Date.now()
            });
            AppStore.setState({ aiChatHistory: updatedHistory });
        } catch (e) {
            console.error('[HomePage] Error saving message to history:', e);
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
            console.error('[HomePage] Error marking command executed:', e);
        }
    }

    function _appendBubbleToDom(text, isUser, command, id, executed = false) {
        const els = _getEls();
        if (!els.chatMessages) return;

        const bubble = document.createElement('div');
        bubble.id = id;
        bubble.className = 'chat-bubble ' + (isUser ? 'chat-user' : 'chat-assistant');
        
        if (text === '...' || text === 'Analisando dados acústicos...' || text === 'Analisando áudio ao vivo...') {
            bubble.innerText = text;
        } else {
            const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            bubble.innerHTML = _renderMarkdown(text) + '<span class="text-[9px] text-slate-600 mt-1 block">' + ts + '</span>';
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
    }

    function _renderHistory(history) {
        const els = _getEls();
        if (!els.chatMessages) return;
        
        const hasConversation = history && history.length > 0 && !(history.length === 1 && history[0].id === 'welcome-msg');
        
        if (els.promptPills) {
            if (hasConversation) {
                els.promptPills.classList.add('collapsed');
            } else {
                els.promptPills.classList.remove('collapsed');
            }
        }
        
        if (!hasConversation) {
            if (els.introContainer) els.introContainer.style.display = 'flex';
            if (els.chatContainer) {
                els.chatContainer.classList.add('hidden');
                els.chatContainer.classList.remove('flex');
            }
            if (els.workspaceWrapper) {
                els.workspaceWrapper.classList.remove('chat-active');
                els.workspaceWrapper.classList.add('justify-center');
            }
            return;
        }
        
        if (els.introContainer) els.introContainer.style.display = 'none';
        if (els.chatContainer) {
            els.chatContainer.classList.remove('hidden');
            els.chatContainer.classList.add('flex');
        }
        if (els.workspaceWrapper) {
            els.workspaceWrapper.classList.add('chat-active');
            els.workspaceWrapper.classList.remove('justify-center');
        }
        
        els.chatMessages.innerHTML = '';
        history.forEach(msg => {
            _appendBubbleToDom(msg.text, msg.isUser, msg.command, msg.id, msg.executed);
        });
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    }

    // -------------------------------------------------------------------------
    // Session ID
    // -------------------------------------------------------------------------

    function _getSessionId() {
        let sid = AppStore.getState().aiSessionId;
        if (!sid) {
            sid = 'ses-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            AppStore.setState({ aiSessionId: sid });
        }
        return sid;
    }

    // -------------------------------------------------------------------------
    // Suggestion Cards
    // -------------------------------------------------------------------------

    const _suggestionSets = [
        [
            { icon: '🔍', title: 'Auditar Mixer', desc: 'Verificar canais, mutes e HPF', prompt: 'auditar mixer' },
            { icon: '📐', title: 'Relatório Acústico', desc: 'Análise detalhada da sala', prompt: 'relatório acústico detalhado' },
            { icon: '🚨', title: 'Resolver Microfonia', desc: 'Encontrar e cortar feedback', prompt: 'resolver apito microfonia' },
            { icon: '🔊', title: 'Clarear Voz', desc: 'Otimizar EQ da voz principal', prompt: 'clarear voz principal' },
        ],
        [
            { icon: '🎚️', title: 'Ajustar EQ Canal', desc: 'Equalizar canal específico', prompt: 'ajustar equalização canal' },
            { icon: '🎤', title: 'Preset de Voz', desc: 'Aplicar preset vocal IA', prompt: 'aplicar preset de voz' },
            { icon: '⚡', title: 'HPF Automático', desc: 'Filtrar graves em vozes', prompt: 'aplicar hpf nos vocais' },
            { icon: '📊', title: 'Análise RT60', desc: 'Calcular reverberação da sala', prompt: 'analisar rt60 da sala' },
        ],
        [
            { icon: '🔧', title: 'Diagnóstico', desc: 'Verificar saúde do sistema', prompt: 'diagnosticar sistema' },
            { icon: '🎯', title: 'Calibrar PA', desc: 'Otimizar sistema principal', prompt: 'calibrar sistema pa' },
            { icon: '📋', title: 'Relatório', desc: 'Relatório técnico completo', prompt: 'relatório técnico completo' },
            { icon: '🔇', title: 'Verificar Mutes', desc: 'Checar canais mutados', prompt: 'verificar canais mutados' },
        ],
    ];

    let _currentSetIndex = 0;

    function _renderSuggestionCards(setIndex) {
        const els = _getEls();
        const container = pm._el('home-suggestion-cards');
        if (!container) return;
        const set = _suggestionSets[setIndex] || _suggestionSets[0];
        container.innerHTML = '';
        set.forEach(function (card, i) {
            const btn = document.createElement('button');
            btn.className = 'suggestion-card flex flex-col items-start gap-1.5 bg-slate-900/40 border border-white/5 hover:border-cyan-500/30 hover:bg-slate-800/30 p-3.5 rounded-2xl text-left transition-all group cursor-pointer suggestion-card-enter';
            btn.dataset.prompt = card.prompt;
            btn.innerHTML = `
                <div class="text-lg">${card.icon}</div>
                <div class="text-xs font-bold text-slate-200 group-hover:text-cyan-400 transition-colors">${card.title}</div>
                <div class="text-[9px] text-slate-500 leading-tight">${card.desc}</div>
            `;
            container.appendChild(btn);
            pm._setTimeout(function () {
                btn.classList.add('suggestion-card-enter-active');
            }, i * 50);
        });
    }

    function _cycleSuggestions() {
        _currentSetIndex = (_currentSetIndex + 1) % _suggestionSets.length;
        _renderSuggestionCards(_currentSetIndex);
    }

    // -------------------------------------------------------------------------
    // Character Counter
    // -------------------------------------------------------------------------

    function _updateCharCounter() {
        const els = _getEls();
        const counter = pm._el('home-char-counter');
        const input = els.chatInput;
        if (counter && input) {
            const len = input.value.length;
            counter.textContent = len + '/5000';
            counter.style.color = len > 4500 ? 'rgb(239, 68, 68)' : len > 4000 ? 'rgb(234, 179, 8)' : 'rgb(100, 116, 139)';
        }
    }

    // -------------------------------------------------------------------------
    // Acoustic Analysis
    // -------------------------------------------------------------------------

    function _getCurrentAnalysis() {
        var analyzer = (window.parent || window).SoundMasterAnalyzer;
        if (analyzer && analyzer.hasAnalysis && analyzer.hasAnalysis()) {
            return analyzer.getLastAnalysis();
        }
        return null;
    }

    function _getAnalyzer() {
        return (window.parent || window).SoundMasterAnalyzer;
    }

    function _buildRt60Multiband(lastRt60) {
        if (!lastRt60) return null;
        if (lastRt60.multiband && typeof lastRt60.multiband === 'object' && Object.keys(lastRt60.multiband).length) {
            return lastRt60.multiband;
        }
        const value = Number(lastRt60.rt60);
        if (!Number.isFinite(value)) return null;
        return { '125': value, '500': value, '1000': value, '4000': value };
    }

    async function _sendAcousticAnalysis() {
        const els = _getEls();
        const channel = Number(els.targetChannel ? els.targetChannel.value : 1);
        const analysis = _getCurrentAnalysis();
        if (!analysis) {
            _saveMessageToHistory('Ative o analisador e aguarde alguns segundos antes de enviar a análise.', false, null, 'msg-err-' + Date.now());
            return;
        }

        _saveMessageToHistory('📎 Análise acústica enviada para IA', true, null, 'msg-' + Math.random().toString(36).substr(2, 9));

        var analyzer = _getAnalyzer();
        var lastRt60 = analyzer && analyzer.getLastRt60 ? analyzer.getLastRt60() : null;
        var rt60Multiband = _buildRt60Multiband(lastRt60);
        const payload = {
            schema_version: '1.1',
            summary: analysis.text,
            spectrum_db: analysis.details && analysis.details.spectrum_v11 ? analysis.details.spectrum_v11 : {},
            rt60_multiband: rt60Multiband,
            peakHz: analysis.details ? analysis.details.peakHz : null,
            peakDb: analysis.details ? analysis.details.peakDb : null,
            rms: analysis.details ? analysis.details.rmsDb : null,
        };

        const loadingId = 'msg-loading-' + Date.now();
        _saveMessageToHistory('Analisando dados acústicos...', false, null, loadingId);

        try {
            const result = await AIService.ask('Análise acústica do salão', channel, payload);
            const currentHistory = AppStore.getState().aiChatHistory || [];
            const filtered = currentHistory.filter(function (msg) { return msg.id !== loadingId; });
            AppStore.setState({ aiChatHistory: filtered });
            const aiMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
            _saveMessageToHistory(result.text, false, result.command, aiMsgId);
            if (result.report) {
                _saveMessageToHistory(result.report, false, null, 'msg-' + Math.random().toString(36).substr(2, 9));
            }
            _persistHistory();
        } catch (err) {
            const currentHistory = AppStore.getState().aiChatHistory || [];
            const filtered = currentHistory.filter(function (msg) { return msg.id !== loadingId; });
            AppStore.setState({ aiChatHistory: filtered });
            _saveMessageToHistory('Erro ao processar análise: ' + err.message, false, null, 'msg-err-' + Date.now());
        }
    }

    // -------------------------------------------------------------------------
    // History Persistence
    // -------------------------------------------------------------------------

    function _persistHistory() {
        var sid = _getSessionId();
        var history = AppStore.getState().aiChatHistory || [];
        var payload = history.map(function (msg) {
            return { role: msg.isUser ? 'user' : 'assistant', content: msg.text, ts: msg.ts / 1000 };
        });
        fetch('/api/chat/save/' + encodeURIComponent(sid), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: payload })
        }).catch(function () {});
    }

    // -------------------------------------------------------------------------
    // Export Chat
    // -------------------------------------------------------------------------

    function _exportChat() {
        const history = AppStore.getState().aiChatHistory || [];
        if (!history.length) return;
        const lines = [];
        history.forEach(function (msg) {
            if (msg.id === 'welcome-msg') return;
            const role = msg.isUser ? 'Você' : 'IA';
            const time = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';
            lines.push('**' + role + '** (' + time + '):\n' + msg.text + '\n');
        });
        const md = lines.join('\n---\n\n');
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chat-soundmaster-' + new Date().toISOString().slice(0, 10) + '.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // -------------------------------------------------------------------------
    // Quick Actions
    // -------------------------------------------------------------------------

    function _quickAction(fn) {
        const ok = fn();
        if (ok === false) {
            _saveMessageToHistory('⚠️ Conecte-se à mesa antes de realizar ações rápidas.', false, null, 'msg-err-' + Date.now());
        }
        return ok;
    }

    async function _sendMessage(text) {
        if (!text || !text.trim()) return;
        const els = _getEls();
        const channel = Number(els.targetChannel ? els.targetChannel.value : 1);
        
        if (els.chatInput) els.chatInput.disabled = true;
        if (els.btnSend) els.btnSend.disabled = true;
        
        const textTrimmed = text.trim();
        if (els.chatInput) {
            els.chatInput.value = '';
            els.chatInput.style.height = 'auto';
        }
        if (els.btnClear) {
            els.btnClear.style.display = 'none';
        }
        
        const userMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
        _saveMessageToHistory(textTrimmed, true, null, userMsgId);
        
        const loadingId = 'msg-loading-' + Date.now();
        _saveMessageToHistory('...', false, null, loadingId);
        
        try {
            const result = await AIService.ask(textTrimmed, channel);
            
            // Remove o loader
            const currentHistory = AppStore.getState().aiChatHistory || [];
            const filtered = currentHistory.filter(msg => msg.id !== loadingId);
            AppStore.setState({ aiChatHistory: filtered });
            
            const aiMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
            _saveMessageToHistory(result.text, false, result.command, aiMsgId);
            if (result.report) {
                const reportMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
                _saveMessageToHistory(result.report, false, null, reportMsgId);
            }
            _persistHistory();
        } catch (err) {
            const currentHistory = AppStore.getState().aiChatHistory || [];
            const filtered = currentHistory.filter(msg => msg.id !== loadingId);
            AppStore.setState({ aiChatHistory: filtered });
            
            const errorMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
            _saveMessageToHistory('Erro na conexão com a IA. Verifique o servidor local.', false, null, errorMsgId);
        } finally {
            if (els.chatInput) {
                els.chatInput.disabled = false;
                els.chatInput.focus();
            }
            if (els.btnSend) els.btnSend.disabled = false;
        }
    }

    function _initEvents() {
        const els = _getEls();

        if (els.btnSend) {
            pm._on(els.btnSend, 'click', function() {
                const text = els.chatInput && els.chatInput.value.trim();
                if (text) _sendMessage(text);
            });
        }

        if (els.chatInput) {
            // Auto-resize textarea, toggle clear button, update char counter
            pm._on(els.chatInput, 'input', function () {
                els.chatInput.style.height = 'auto';
                els.chatInput.style.height = els.chatInput.scrollHeight + 'px';
                
                if (els.btnClear) {
                    els.btnClear.style.display = els.chatInput.value.trim() ? 'flex' : 'none';
                }
                _updateCharCounter();
            });

            // Enter key sends message, Shift+Enter adds newline
            pm._on(els.chatInput, 'keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const text = els.chatInput.value.trim();
                    if (text) _sendMessage(text);
                }
            });
        }

        if (els.btnClear) {
            pm._on(els.btnClear, 'click', function () {
                if (els.chatInput) {
                    els.chatInput.value = '';
                    els.chatInput.style.height = 'auto';
                    els.chatInput.focus();
                }
                els.btnClear.style.display = 'none';
            });
        }

        if (els.btnNewChat) {
            pm._on(els.btnNewChat, 'click', () => {
                AppStore.setState({ aiChatHistory: [] });
            });
        }

        // Delegar click dos pills de atalho
        if (els.promptPills) {
            const pills = els.promptPills.querySelectorAll('.home-prompt-pill');
            pills.forEach(pill => {
                pm._on(pill, 'click', () => {
                    const text = pill.dataset.prompt || pill.innerText;
                    _sendMessage(text);
                });
            });
        }

        // Suggestion Cards Cycling
        if (els.btnCycleSuggestions) {
            pm._on(els.btnCycleSuggestions, 'click', _cycleSuggestions);
        }

        // Suggestion Cards click delegation
        if (els.suggestionCards) {
            pm._on(els.suggestionCards, 'click', function (e) {
                var card = e.target.closest('[data-prompt]');
                if (card) {
                    var prompt = card.dataset.prompt;
                    if (prompt) _sendMessage(prompt);
                }
            });
        }

        // Send Acoustic Analysis
        if (els.btnSendAnalysis) {
            pm._on(els.btnSendAnalysis, 'click', function () {
                _sendAcousticAnalysis();
            });
        }

        // Export Chat
        if (els.btnExportChat) {
            pm._on(els.btnExportChat, 'click', _exportChat);
        }

        // Quick Actions
        if (els.quickActions) {
            pm._on(els.quickActions, 'click', function (e) {
                var btn = e.target.closest('[data-action]');
                if (!btn) return;
                var action = btn.dataset.action;
                var channel = Number(els.targetChannel ? els.targetChannel.value : 1);
                var ok = false;

                if (action === 'clean') {
                    ok = _quickAction(function () { return MixerService.runCleanSoundPreset(channel); });
                } else if (action === 'hpf') {
                    ok = _quickAction(function () { return MixerService.applyHpf(channel, 100); });
                } else if (action === 'gate') {
                    ok = _quickAction(function () { return MixerService.applyGate(channel); });
                } else if (action === 'eq250') {
                    ok = _quickAction(function () { return MixerService.applyEqCut('channel', channel, 250, -3, 1.1, 2); });
                } else if (action === 'eq3k') {
                    ok = _quickAction(function () { return MixerService.applyEqCut('channel', channel, 3200, -2.5, 1.5, 3); });
                } else if (action === 'afs') {
                    ok = _quickAction(function () { return MixerService.setAfs(true); });
                }

                if (ok) {
                    btn.classList.add('active-pill');
                    pm._setTimeout(function () { btn.classList.remove('active-pill'); }, 1500);
                }
            });
        }

        // Toggle IP Card
        if (els.btnToggleIp) {
            pm._on(els.btnToggleIp, 'click', () => {
                if (els.localIpCard) {
                    const isHidden = els.localIpCard.classList.contains('hidden');
                    if (isHidden) {
                        els.localIpCard.classList.remove('hidden');
                        els.localIpCard.scrollIntoView({ behavior: 'smooth' });
                    } else {
                        els.localIpCard.classList.add('hidden');
                    }
                }
            });
        }

        // Mic live listener
        if (els.btnListen) {
            pm._on(els.btnListen, 'click', async () => {
                const ch = Number(els.targetChannel ? els.targetChannel.value : 1);
                
                const userMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
                _saveMessageToHistory('IA ouvindo o microfone...', true, null, userMsgId);
                
                const loadingId = 'msg-loading-' + Date.now();
                _saveMessageToHistory('Analisando áudio ao vivo...', false, null, loadingId);
                
                try {
                    const result = await AIService.listenAndAnalyze(ch);
                    
                    const currentHistory = AppStore.getState().aiChatHistory || [];
                    const filtered = currentHistory.filter(msg => msg.id !== loadingId);
                    AppStore.setState({ aiChatHistory: filtered });
                    
                    const aiMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
                    _saveMessageToHistory(result.text, false, result.command, aiMsgId);
                    if (result.report) {
                        const reportMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
                        _saveMessageToHistory(result.report, false, null, reportMsgId);
                    }
                    _persistHistory();
                } catch (err) {
                    const currentHistory = AppStore.getState().aiChatHistory || [];
                    const filtered = currentHistory.filter(msg => msg.id !== loadingId);
                    AppStore.setState({ aiChatHistory: filtered });
                    
                    const errorMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
                    _saveMessageToHistory('Erro ao ouvir microfone: ' + err.message, false, null, errorMsgId);
                }
            });
        }
    }

    function init() {
        loadConfig();
        _initEvents();

        const els = _getEls();
        if (els.chatInput) {
            pm._setTimeout(function () { els.chatInput.focus(); }, 100);
        }

        // Carregar valores iniciais imediatamente para evitar skeletons vazios
        // 1. SPL
        const initialSpl = AppStore.getState?.().splStats;
        if (els.homeSplVal && initialSpl && initialSpl.leqTotal !== undefined) {
            els.homeSplVal.innerText = `${initialSpl.leqTotal.toFixed(1)} dBA`;
        }

        // 2. Status do Mixer
        const initialConnected = AppStore.getState?.().mixerConnected;
        if (els.homeMixerStatus) {
            els.homeMixerStatus.innerText = initialConnected ? 'Online' : 'Offline';
            els.homeMixerStatus.className = initialConnected ? 'text-green-400 font-bold' : 'text-red-400 font-bold';
        }

        // 3. RT60
        const parentWin = window.parent || window;
        const analyzer = parentWin.SoundMasterAnalyzer;
        const lastRt = analyzer?.getLastRt60 ? analyzer.getLastRt60() : null;
        const rt60Val = lastRt ? (lastRt.rt60 ?? lastRt.t30 ?? lastRt.t20 ?? lastRt.rt60_est) : null;
        if (els.homeRt60Val && rt60Val !== null && rt60Val !== undefined) {
            els.homeRt60Val.innerText = `${Number(rt60Val).toFixed(2)}s`;
        } else if (els.homeRt60Val) {
            try {
                const saved = localStorage.getItem('rt60_mapping_points');
                if (saved) {
                    const points = JSON.parse(saved);
                    if (points && points.length > 0) {
                        const avg = points.reduce((s, p) => s + p.rt60, 0) / points.length;
                        els.homeRt60Val.innerText = `${avg.toFixed(2)}s`;
                    } else {
                        els.homeRt60Val.innerText = '---';
                    }
                } else {
                    els.homeRt60Val.innerText = '---';
                }
            } catch (e) {
                console.warn('[HomePage] Error loading initial RT60:', e);
                els.homeRt60Val.innerText = '---';
            }
        }

        // SPL Metrics subscription
        pm._subscribe('AppStore', 'splStats', (stats) => {
            const splValEl = pm._el('home-spl-val');
            if (splValEl && stats && stats.leqTotal !== undefined) {
                splValEl.innerText = `${stats.leqTotal.toFixed(1)} dBA`;
            }
        });

        // Mixer connection status subscription
        pm._subscribe('AppStore', 'mixerConnected', (connected) => {
            const statusEl = pm._el('home-mixer-status');
            if (statusEl) {
                statusEl.innerText = connected ? 'Online' : 'Offline';
                statusEl.className = connected ? 'text-green-400 font-bold' : 'text-red-400 font-bold';
            }
        });

        // AI Status (thinking / loading) subscription to animate the spinning avatar
        pm._subscribe('AppStore', 'aiStatus', (status) => {
            const ringEl = pm._el('home-ai-ring');
            if (ringEl) {
                if (status === 'loading') {
                    ringEl.classList.remove('spin-slow');
                    ringEl.classList.add('spin-fast');
                } else {
                    ringEl.classList.remove('spin-fast');
                    ringEl.classList.add('spin-slow');
                }
            }
        });

        // Chat History subscription for real-time sync
        pm._subscribe('AppStore', 'aiChatHistory', (history) => {
            _renderHistory(history);
        });

        // Initial history render
        const history = AppStore.getState?.().aiChatHistory || [];
        _renderHistory(history);

        // Render initial suggestion cards
        _renderSuggestionCards(0);

        // Load persisted history from server
        (function () {
            var sid = _getSessionId();
            fetch('/api/chat/load/' + encodeURIComponent(sid)).then(function (r) { return r.json(); }).then(function (data) {
                if (data && data.messages && data.messages.length > 0) {
                    var restored = data.messages.map(function (msg) {
                        return {
                            text: msg.content,
                            isUser: msg.role === 'user',
                            command: null,
                            id: 'hist-' + msg.ts + '-' + Math.random().toString(36).substr(2, 4),
                            executed: false,
                            ts: msg.ts * 1000
                        };
                    });
                    if (restored.length > 0) {
                        AppStore.setState({ aiChatHistory: restored });
                    }
                }
            }).catch(function () {});
        })();

        // Listen for new RT60 results
        _rt60Listener = (e) => {
            const rtValEl = pm._el('home-rt60-val');
            if (rtValEl && e.detail && e.detail.rt60 !== undefined) {
                rtValEl.innerText = `${e.detail.rt60.toFixed(2)}s`;
            }
        };
        if (window.parent && window.parent.document) {
            window.parent.document.addEventListener('rt60-result', _rt60Listener);
        }

        // Listen for Feedback Detector auto-cut events and persist to AI history
        window.addEventListener('feedback:auto-cut', function (e) {
            var sid = _getSessionId();
            var detail = e.detail || {};
            var sysMsg = {
                role: 'system',
                content: 'Feedback Detector: corte automático aplicado em ' + detail.freq + 'Hz (' + (detail.gain || -3) + 'dB).' + (detail.peakDb !== undefined ? ' Pico: ' + detail.peakDb.toFixed(1) + 'dB.' : ''),
                ts: Date.now() / 1000
            };
            fetch('/api/chat/save/' + encodeURIComponent(sid), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [sysMsg] })
            }).catch(function () {});
        });
    }

    function destroy() {
        if (window.parent && window.parent.document && _rt60Listener) {
            window.parent.document.removeEventListener('rt60-result', _rt60Listener);
            _rt60Listener = null;
        }
        pm.destroy();
    }

    window.HomePage = {
        init: init,
        destroy: destroy
    };
})();
