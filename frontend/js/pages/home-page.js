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
            mobileQrCode: pm._el('mobile-qr-code'),
            
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
        bubble.className = 'chat-bubble ' + (isUser ? 'chat-user' : 'chat-assistant') + ' mb-3 p-4 rounded-2xl max-w-[85%] ' + 
                           (isUser ? 'ml-auto text-right text-white' : 'mr-auto text-left text-slate-300');
        
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
                <p class="text-xs text-white font-semibold mb-2">${command.desc || 'Ajuste de Mixer'}</p>
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
            // Auto-resize textarea and toggle clear button visibility on input
            pm._on(els.chatInput, 'input', function () {
                els.chatInput.style.height = 'auto';
                els.chatInput.style.height = els.chatInput.scrollHeight + 'px';
                
                if (els.btnClear) {
                    els.btnClear.style.display = els.chatInput.value.trim() ? 'flex' : 'none';
                }
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
        if (els.homeRt60Val && lastRt && lastRt.rt60 !== undefined && lastRt.rt60 !== null) {
            els.homeRt60Val.innerText = `${lastRt.rt60.toFixed(2)}s`;
        } else if (els.homeRt60Val) {
            try {
                const saved = localStorage.getItem('rt60_mapping_points');
                if (saved) {
                    const points = JSON.parse(saved);
                    if (points && points.length > 0) {
                        const avg = points.reduce((s, p) => s + p.rt60, 0) / points.length;
                        els.homeRt60Val.innerText = `${avg.toFixed(2)}s`;
                    }
                }
            } catch (e) {
                console.warn('[HomePage] Error loading initial RT60:', e);
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
