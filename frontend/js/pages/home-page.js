/**
 * @fileoverview Página Inicial — Dashboard principal com Chat IA premium,
 * métricas de sistema em tempo real e configuração do servidor.
 *
 * Esta página serve como o hub central do SoundMaster, exibindo informações
 * do servidor, métricas ao vivo (SPL, RT60, status do mixer), link de acesso
 * mobile com QR Code e uma interface de chat IA completa com ações autônomas.
 *
 * ## Funcionalidades Principais
 * - Exibição do endereço IP do servidor e QR Code para acesso mobile
 * - Métricas em tempo real: SPL (dBA), RT60 (s), status do mixer (Online/Offline)
 * - Interface de chat IA com Markdown renderizado e cards de recomendação
 * - Sugestões rotativas de prompts (Auditar Mixer, Relatório Acústico, etc.)
 * - Quick actions: limpar som, HPF, gate, corte de EQ, AFS
 * - Histórico de chat persistido no servidor via API REST
 * - Exportação do chat em formato Markdown
 * - Contador de caracteres no input
 * - Análise acústica automática com captura de microfone
 * - Escuta ao vivo via microfone para análise em tempo real
 * - Cards de comando "Human-in-the-Loop" com aplicação/ignorar
 * - Assinaturas em tempo real para SPL, mixer e status IA
 *
 * ## Como Usar
 * 1. As métricas são exibidas automaticamente no dashboard
 * 2. Clique no QR Code ou link para acessar pelo celular
 * 3. Use os prompts de atalho ou digite uma mensagem no chat
 * 4. Clique em "Ouvir" para analisar o áudio do microfone
 * 5. Use quick actions para ajustes rápidos na mesa
 * 6. Exporte o chat usando o botão de download
 *
 * ## Dependências e Integrações
 * - **createPageModule()**: Módulo base para páginas
 * - **AppStore**: Store global (SPL, mixer, chat, sessão IA)
 * - **AIService**: Serviço de IA para análise e comandos
 *   - `ask(text, channel, payload)` — Envia pergunta com contexto
 *   - `listenAndAnalyze(channel)` — Escuta e analisa microfone
 * - **MixerService**: Controle da mesa de mixagem
 *   - `executeAICommand(command)` — Executa comando da IA
 *   - `runCleanSoundPreset(ch)` — Preset de som limpo
 *   - `applyHpf(ch, freq)` — Filtro passa-alta
 *   - `applyGate(ch)` — Gate
 *   - `applyEqCut(type, ch, freq, gain, q, band)` — Corte de EQ
 *   - `setAfs(enabled)` — AFS (Automatic Feedback Suppression)
 * - **SoundMasterAnalyzer**: Analisador de áudio ao vivo
 *   - `start()` — Inicia captura
 *   - `getLastAnalysis()` — Última análise
 *   - `getLastRt60()` — Último RT60
 *   - `isAnalyzing()` — Estado da análise
 * - **SocketService**: Comunicação WebSocket (eventos rt60-result)
 * - **API REST**: `/api/config`, `/api/chat/save/:sid`, `/api/chat/load/:sid`
 *
 * @module HomePage
 * @version 2.0.0
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
            toggleAutonomous: pm._el('home-toggle-autonomous'),
            btnCycleSuggestions: pm._el('btn-cycle-suggestions'),
            suggestionCards: pm._el('home-suggestion-cards'),
            quickActions: pm._el('home-quick-actions'),
            charCounter: pm._el('home-char-counter'),
            workspaceWrapper: pm._el('home-workspace-wrapper'),
            sessionList: pm._el('home-session-list'),
            // New dashboard elements
            dateDay: pm._el('home-date-day'),
            dateWeekday: pm._el('home-date-weekday'),
            dateMonth: pm._el('home-date-month'),
            qualityGauge: pm._el('home-quality-gauge'),
            qualityValue: pm._el('home-quality-value'),
            sessionTime: pm._el('home-session-time'),
            peakFreq: pm._el('home-peak-freq'),
            activeChannels: pm._el('home-active-channels'),
            feedbackStatus: pm._el('home-feedback-status'),
            feedbackChart: pm._el('home-feedback-chart'),
            btnMicActivate: pm._el('btn-home-mic-activate'),
            specBass: pm._el('home-spec-bass'),
            specMid: pm._el('home-spec-mid'),
            specTreble: pm._el('home-spec-treble'),
            specAir: pm._el('home-spec-air'),
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
                els.mobileQrCode.onerror = function () {
                    this.style.display = 'none';
                    // Show URL text when QR API is unreachable (offline/mixer network)
                    var fallback = this.parentElement?.querySelector('.qr-fallback');
                    if (!fallback) {
                        fallback = document.createElement('div');
                        fallback.className = 'qr-fallback';
                        fallback.style.cssText = 'font-size:11px;color:#94a3b8;word-break:break-all;padding:8px;text-align:center;';
                        fallback.textContent = mobileHref;
                        this.parentElement?.appendChild(fallback);
                    }
                };
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

    function _sanitizeHtml(dirty) {
        var div = document.createElement('div');
        div.textContent = dirty;
        return div.innerHTML;
    }

    function _escapeHtmlText(value) {
        return _sanitizeHtml(String(value == null ? '' : value));
    }

    function _setSafeHtml(el, html) {
        if (!el) return;
        if (typeof window.setSafeHTML === 'function') {
            window.setSafeHTML(el, html);
            return;
        }
        el.innerHTML = html;
    }

    function _stripDangerousUrls(text) {
        return text.replace(/(href|src)=["']\s*(javascript|data|vbscript):/gi, '$1="#"');
    }

    function _renderMarkdown(text) {
        if (!text) return '';
        var html = _sanitizeHtml(text);

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

        return _stripDangerousUrls(html);
    }

    function _saveMessageToHistory(text, isUser, command, id, executed = false) {
        try {
            var history = AppStore.getState().aiChatHistory || [];
            var filtered = history.filter(function (msg) { return msg.id !== id; });
            filtered.push({ text: text, isUser: isUser, command: command, id: id, executed: executed, ts: Date.now() });
            AppStore.setState({ aiChatHistory: filtered });
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
            _setSafeHtml(bubble, _renderMarkdown(text) + '<span class="text-[9px] text-slate-600 mt-1 block">' + _escapeHtmlText(ts) + '</span>');
        }

        if (command && !isUser) {
            const card = document.createElement('div');
            card.className = 'command-card mt-2 bg-slate-950/80 border border-cyan-500/20 rounded-xl p-2.5 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-lg';
            const info = document.createElement('div');
            info.className = 'flex flex-col min-w-0';

            const titleRow = document.createElement('div');
            titleRow.className = 'flex items-center gap-1.5 leading-tight';

            const icon = document.createElement('span');
            icon.className = 'text-cyan-400 text-xs shrink-0';
            icon.textContent = 'AI';

            const title = document.createElement('span');
            title.className = 'text-xs text-white font-bold truncate';
            title.textContent = command.desc || 'Ajuste';

            titleRow.appendChild(icon);
            titleRow.appendChild(title);

            const metaRow = document.createElement('div');
            metaRow.className = 'flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 font-mono';

            const channelSpan = document.createElement('span');
            channelSpan.textContent = 'CH ' + (command.channel !== undefined ? command.channel : '-');
            const actionSeparator = document.createElement('span');
            actionSeparator.textContent = '|';
            const actionSpan = document.createElement('span');
            actionSpan.className = 'uppercase';
            actionSpan.textContent = command.action || '-';

            metaRow.appendChild(channelSpan);
            metaRow.appendChild(actionSeparator);
            metaRow.appendChild(actionSpan);

            if (command.value !== undefined) {
                const valueSeparator = document.createElement('span');
                valueSeparator.textContent = '|';
                const valueSpan = document.createElement('span');
                valueSpan.textContent = String(command.value);
                metaRow.appendChild(valueSeparator);
                metaRow.appendChild(valueSpan);
            }

            info.appendChild(titleRow);
            info.appendChild(metaRow);

            const actions = document.createElement('div');
            actions.className = 'flex gap-1.5 justify-end shrink-0';

            const btnIgnore = document.createElement('button');
            btnIgnore.className = 'ignore-btn px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-400 hover:text-white transition-all';
            btnIgnore.textContent = 'Ignorar';

            const btnExec = document.createElement('button');
            btnExec.className = 'exec-btn px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-[10px] font-extrabold text-white transition-all flex items-center gap-1';
            btnExec.textContent = 'Revisar ajuste';

            actions.appendChild(btnIgnore);
            actions.appendChild(btnExec);

            card.appendChild(info);
            card.appendChild(actions);

            if (executed) {
                btnExec.textContent = 'Aplicado';
                btnExec.disabled = true;
                btnExec.className = 'exec-btn px-3 py-1 rounded bg-emerald-950/40 border border-emerald-500/30 text-[10px] font-bold text-emerald-400 flex items-center gap-1';
                btnIgnore.style.display = 'none';
            } else {
                pm._on(btnExec, 'click', function () {
                    const ok = MixerService.executeAICommand(command, { origin: 'home' });
                    if (ok) {
                        btnExec.textContent = 'Aguardando confirmação';
                        btnExec.disabled = true;
                        btnExec.className = 'exec-btn px-3 py-1 rounded bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-bold text-cyan-300 flex items-center gap-1';
                        btnIgnore.style.display = 'none';
                    } else {
                        btnExec.textContent = 'Assistente indisponível';
                    }
                });

                pm._on(btnIgnore, 'click', function () {
                    card.style.opacity = '0.4';
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
    // Session History Sidebar
    // -------------------------------------------------------------------------

    async function _loadSessionList() {
        const els = _getEls();
        if (!els.sessionList) return;
        try {
            const res = await fetch('/api/chat/sessions');
            if (!res.ok) return;
            const data = await res.json();
            const sessions = data.sessions || [];
            const currentSid = _getSessionId();

            els.sessionList.innerHTML = '';

            // Current session always first
            const currentItem = document.createElement('div');
            currentItem.className = 'hist-item active bg-slate-800/40 border border-cyan-500/20 rounded-xl px-3 py-2.5 cursor-pointer';
            currentItem.innerHTML = '<div class="text-[10px] font-bold text-cyan-400 truncate">Conversa atual</div><div class="text-[9px] text-slate-500 mt-0.5">Agora</div>';
            els.sessionList.appendChild(currentItem);

            sessions.forEach(function (s) {
                if (s.id === currentSid) return; // skip current
                var item = document.createElement('div');
                item.className = 'hist-item bg-slate-900/30 border border-white/5 rounded-xl px-3 py-2.5 cursor-pointer';
                var preview = s.preview || 'Conversa';
                var date = s.timestamp ? new Date(s.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
                var count = s.messageCount || 0;
                item.innerHTML = '<div class="text-[10px] font-bold text-slate-300 truncate">' + _sanitizeHtml(preview) + '</div>' +
                    '<div class="text-[9px] text-slate-500 mt-0.5 flex items-center gap-1.5"><span>' + _sanitizeHtml(date) + '</span><span>·</span><span>' + count + ' msgs</span></div>';
                pm._on(item, 'click', function () {
                    _switchToSession(s.id);
                });
                els.sessionList.appendChild(item);
            });

            if (sessions.length === 0) {
                var empty = document.createElement('div');
                empty.className = 'text-[9px] text-slate-600 text-center py-3';
                empty.textContent = 'Nenhuma conversa anterior';
                els.sessionList.appendChild(empty);
            }
        } catch (e) {
            console.warn('[HomePage] Error loading session list:', e);
        }
    }

    async function _switchToSession(sid) {
        try {
            const res = await fetch('/api/chat/load/' + encodeURIComponent(sid));
            if (!res.ok) return;
            const data = await res.json();
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
                AppStore.setState({ aiSessionId: sid, aiChatHistory: restored });
                _loadSessionList();
            }
        } catch (e) {
            console.warn('[HomePage] Error switching session:', e);
        }
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
            const icon = document.createElement('div');
            icon.className = 'text-lg';
            icon.textContent = card.icon || '';
            const title = document.createElement('div');
            title.className = 'text-xs font-bold text-slate-200 group-hover:text-cyan-400 transition-colors';
            title.textContent = card.title || '';
            const desc = document.createElement('div');
            desc.className = 'text-[9px] text-slate-500 leading-tight';
            desc.textContent = card.desc || '';
            btn.appendChild(icon);
            btn.appendChild(title);
            btn.appendChild(desc);
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

    async function _autoRunLiveAnalysisAndReport(channel) {
        if (window.SoundAssistantService?.runTask) {
            const assistantLoadingId = 'assistant-analysis-' + Date.now();
            _saveMessageToHistory('O Assistente está capturando e analisando o Main L/R...', false, null, assistantLoadingId);
            try {
                const result = await window.SoundAssistantService.runTask('analyze', {
                    origin: 'home',
                    channel,
                    prompt: 'Gerar relatório técnico completo com base no áudio capturado',
                    label: 'Análise do Main L/R',
                });
                const history = (AppStore.getState().aiChatHistory || []).filter(function (msg) { return msg.id !== assistantLoadingId; });
                AppStore.setState({ aiChatHistory: history });
                _saveMessageToHistory(result.text, false, null, 'msg-' + Math.random().toString(36).substr(2, 9));
                if (result.report) _saveMessageToHistory(result.report, false, null, 'msg-' + Math.random().toString(36).substr(2, 9));
                if (result.command && !['log', 'start_live_analysis', 'trigger_sweep'].includes(result.command.action)) {
                    _saveMessageToHistory('O ajuste sugerido aguarda confirmação na Central do Assistente.', false, null, 'msg-' + Date.now());
                    window.SoundAssistantCenter?.open?.();
                }
                _persistHistory();
            } catch (error) {
                const history = (AppStore.getState().aiChatHistory || []).filter(function (msg) { return msg.id !== assistantLoadingId; });
                AppStore.setState({ aiChatHistory: history });
                _saveMessageToHistory('Erro ao executar análise: ' + error.message, false, null, 'msg-err-' + Date.now());
            }
            return;
        }

        var analyzer = _getAnalyzer();
        if (!analyzer) {
            _saveMessageToHistory('O analisador de áudio não está disponível.', false, null, 'msg-err-' + Date.now());
            return;
        }

        const loadingId = 'ai-auto-analysis-loading-' + Date.now();
        _saveMessageToHistory('Capturando som ambiente... Por favor, faça silêncio ou mantenha o som ambiente normal da sala por 4 segundos. 🎙️', false, null, loadingId);

        try {
            if (!analyzer.isAnalyzing()) {
                await analyzer.start();
            }
            await new Promise(resolve => setTimeout(resolve, 4000));

            const analysis = _getCurrentAnalysis();
            if (!analysis) {
                throw new Error('Não foi possível obter dados de áudio do analisador. Verifique o microfone.');
            }

            const lastRt60 = analyzer.getLastRt60 ? analyzer.getLastRt60() : null;
            const rt60Multiband = _buildRt60Multiband(lastRt60);
            const payload = {
                schema_version: '1.1',
                summary: analysis.text,
                spectrum_db: analysis.details && analysis.details.spectrum_v11 ? analysis.details.spectrum_v11 : {},
                rt60_multiband: rt60Multiband,
                peakHz: analysis.details ? analysis.details.peakHz : null,
                peakDb: analysis.details ? analysis.details.peakDb : null,
                rms: analysis.details ? analysis.details.rmsDb : null,
            };

            // Atualiza loader
            const currentHistory = AppStore.getState().aiChatHistory || [];
            const filtered = currentHistory.map(msg => {
                if (msg.id === loadingId) {
                    return Object.assign({}, msg, { text: 'Gerando relatório técnico final... 📈' });
                }
                return msg;
            });
            AppStore.setState({ aiChatHistory: filtered });

            const result = await AIService.ask('Gerar relatório técnico completo com base no áudio capturado', channel, payload);
            
            // Remove o loader anterior
            const currentHistory2 = AppStore.getState().aiChatHistory || [];
            const filtered2 = currentHistory2.filter(msg => msg.id !== loadingId);
            AppStore.setState({ aiChatHistory: filtered2 });

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
            _saveMessageToHistory('Erro ao executar análise automática: ' + err.message, false, null, 'msg-err-' + Date.now());
        }
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

    async function _autoRunSweepAndReport(channel) {
        if (window.SoundAssistantService?.runTask) {
            const assistantLoadingId = 'assistant-measure-' + Date.now();
            _saveMessageToHistory('O Assistente está executando a medição RT60 por sweep...', false, null, assistantLoadingId);
            try {
                const result = await window.SoundAssistantService.runTask('measure', {
                    origin: 'measure',
                    channel,
                    prompt: 'Interprete a medição RT60 e gere recomendações seguras.',
                    label: 'Medição RT60 por sweep',
                });
                const history = (AppStore.getState().aiChatHistory || []).filter(function (msg) { return msg.id !== assistantLoadingId; });
                AppStore.setState({ aiChatHistory: history });
                _saveMessageToHistory(result.text, false, null, 'msg-' + Math.random().toString(36).substr(2, 9));
                if (result.report) _saveMessageToHistory(result.report, false, null, 'msg-' + Math.random().toString(36).substr(2, 9));
                if (result.command && !['log', 'start_live_analysis', 'trigger_sweep'].includes(result.command.action)) {
                    _saveMessageToHistory('O ajuste sugerido aguarda confirmação na Central do Assistente.', false, null, 'msg-' + Date.now());
                    window.SoundAssistantCenter?.open?.();
                }
                _persistHistory();
            } catch (error) {
                const history = (AppStore.getState().aiChatHistory || []).filter(function (msg) { return msg.id !== assistantLoadingId; });
                AppStore.setState({ aiChatHistory: history });
                _saveMessageToHistory('Erro na medição RT60: ' + error.message, false, null, 'msg-err-' + Date.now());
            }
            return;
        }

        var analyzer = _getAnalyzer();
        if (!analyzer) {
            _saveMessageToHistory('O analisador de áudio não está disponível.', false, null, 'msg-err-' + Date.now());
            return;
        }

        const loadingId = 'ai-auto-sweep-loading-' + Date.now();
        _saveMessageToHistory('Iniciando medição do RT60... Preparando o microfone. 🎙️', false, null, loadingId);

        try {
            if (!analyzer.isAnalyzing()) {
                await analyzer.start();
            }

            _updateLoaderText(loadingId, 'Disparando sinal de sweep (varredura de 10s)... Faça silêncio na sala. 🔊');
            await analyzer.triggerImpulse();

            // Aguardamos até 30s pelo evento sweep_analysis_result via SocketService
            await new Promise((resolve) => {
                let resolved = false;
                const timer = setTimeout(() => {
                    if (!resolved) { resolved = true; resolve(); }
                }, 30000);

                const handleSweepResult = () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        if (window.SocketService && window.SocketService.off) {
                            window.SocketService.off('sweep_analysis_result', handleSweepResult);
                        }
                        resolve();
                    }
                };
                
                if (window.SocketService && window.SocketService.on) {
                    window.SocketService.on('sweep_analysis_result', handleSweepResult);
                } else {
                    setTimeout(handleSweepResult, 15000);
                }
            });

            const lastRt60 = analyzer.getLastRt60 ? analyzer.getLastRt60() : null;
            if (!lastRt60 || !lastRt60.rt60) {
                _updateLoaderText(loadingId, 'Medição de Sweep indisponível. Tentando estimativa via ruído ambiente... ⚠️');
                await new Promise(r => setTimeout(r, 2000));
                const currentHistory = AppStore.getState().aiChatHistory || [];
                const filtered = currentHistory.filter(msg => msg.id !== loadingId);
                AppStore.setState({ aiChatHistory: filtered });
                return await _autoRunLiveAnalysisAndReport(channel);
            }

            _updateLoaderText(loadingId, `RT60 medido: ${lastRt60.rt60.toFixed(2)}s. Gerando relatório... 📊`);

            const analysis = _getCurrentAnalysis();
            const rt60Multiband = _buildRt60Multiband(lastRt60);
            const payload = {
                schema_version: '1.1',
                summary: analysis?.text || '',
                spectrum_db: analysis?.details?.spectrum_v11 || {},
                rt60_multiband: rt60Multiband,
                peakHz: analysis?.details?.peakHz,
                rms: analysis?.details?.rmsDb,
                rt60_measured: lastRt60.rt60,
            };

            const result = await AIService.ask('Gerar relatório técnico completo com base no RT60 medido de ' + lastRt60.rt60.toFixed(2) + 's', channel, payload);
            
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
            _saveMessageToHistory('Erro na medição automática de RT60: ' + err.message, false, null, 'msg-err-' + Date.now());
        }
    }

    function _updateLoaderText(loadingId, newText) {
        const currentHistory = AppStore.getState().aiChatHistory || [];
        const filtered = currentHistory.map(msg => {
            if (msg.id === loadingId) {
                return Object.assign({}, msg, { text: newText });
            }
            return msg;
        });
        AppStore.setState({ aiChatHistory: filtered });
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
            _saveMessageToHistory(result.text, false, result.command, aiMsgId, false);
            if (result.report) {
                const reportMsgId = 'msg-' + Math.random().toString(36).substr(2, 9);
                _saveMessageToHistory(result.report, false, null, reportMsgId);
            }
            _persistHistory();

            if (result.command) {
                if (result.command.action === 'start_live_analysis') {
                    _autoRunLiveAnalysisAndReport(channel);
                } else if (result.command.action === 'trigger_sweep') {
                    _autoRunSweepAndReport(channel);
                }
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
            pm._on(els.btnNewChat, 'click', async () => {
                // Save current history first, then start fresh
                _persistHistory();
                var newSid = 'ses-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
                AppStore.setState({ aiSessionId: newSid, aiChatHistory: [] });
                _loadSessionList();
            });
        }

        // Second "New Chat" button in session panel
        var btnNewChat2 = pm._el('btn-home-new-chat-2');
        if (btnNewChat2) {
            pm._on(btnNewChat2, 'click', async () => {
                _persistHistory();
                var newSid = 'ses-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
                AppStore.setState({ aiSessionId: newSid, aiChatHistory: [] });
                _loadSessionList();
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

        // Toggle Autonomous
        if (els.toggleAutonomous) {
            pm._on(els.toggleAutonomous, 'change', (e) => {
                AppStore.setState({ aiAutonomousMode: e.target.checked });
                AppStore.addLog('Autonomia da IA: ' + (e.target.checked ? 'Ativada' : 'Desativada'));
            });
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

        // Mic Activate Card Button
        if (els.btnMicActivate) {
            pm._on(els.btnMicActivate, 'click', () => {
                const state = AppStore.getState ? AppStore.getState() : {};
                const newActive = !state.micActive;
                AppStore.setState({ micActive: newActive });
                if (window.parent && window.parent.SoundMasterAnalyzer) {
                    try {
                        if (newActive && window.parent.SoundMasterAnalyzer.initMic) {
                            window.parent.SoundMasterAnalyzer.initMic();
                        }
                    } catch (e) {
                        console.warn('[HomePage] Error toggling mic analyzer:', e);
                    }
                }
                if (AppStore.addLog) {
                    AppStore.addLog(newActive ? '🎙️ Microfone ativado para análise' : '🎙️ Microfone desativado');
                }
            });
        }

        // Review Rating Icons Interactive
        const reviewIcons = document.querySelectorAll('.review-icon');
        if (reviewIcons.length > 0) {
            const savedRating = localStorage.getItem('sm-acoustic-rating');
            reviewIcons.forEach((btn, idx) => {
                if (savedRating && Number(savedRating) === idx) {
                    btn.style.background = 'var(--coral-bg)';
                    btn.style.borderColor = 'var(--coral)';
                }
                pm._on(btn, 'click', () => {
                    reviewIcons.forEach(b => {
                        b.style.background = 'transparent';
                        b.style.borderColor = 'var(--border)';
                    });
                    btn.style.background = 'var(--coral-bg)';
                    btn.style.borderColor = 'var(--coral)';
                    localStorage.setItem('sm-acoustic-rating', idx);
                    const ratings = ['Ruim 😟', 'Regular 😐', 'Bom 🙂', 'Muito Bom 😊', 'Excelente 🤩'];
                    if (AppStore.addLog) {
                        AppStore.addLog('Avaliação da acústica registrada: ' + (ratings[idx] || idx));
                    }
                });
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
                    _saveMessageToHistory(result.text, false, null, aiMsgId);
                    if (result.command && !['log', 'start_live_analysis', 'trigger_sweep'].includes(result.command.action)) {
                        _saveMessageToHistory('O ajuste sugerido aguarda confirmação na Central do Assistente.', false, null, 'msg-' + Date.now());
                        window.SoundAssistantCenter?.open?.();
                    }
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

    // -------------------------------------------------------------------------
    // Dashboard Visual Initializers
    // -------------------------------------------------------------------------

    function _initDateDisplay() {
        const els = _getEls();
        const now = new Date();
        const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                         'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        if (els.dateDay) els.dateDay.textContent = now.getDate();
        if (els.dateWeekday) els.dateWeekday.textContent = weekdays[now.getDay()] + ',';
        if (els.dateMonth) els.dateMonth.textContent = months[now.getMonth()];
    }

    function _initActivityDots() {
        var container = pm._el('home-activity-dots');
        if (!container) return;
        container.innerHTML = '';
        for (var i = 0; i < 42; i++) {
            var dot = document.createElement('span');
            dot.className = 'activity-dot';
            if (Math.random() > 0.5) dot.classList.add('active');
            if (Math.random() > 0.85) dot.classList.add('highlight');
            container.appendChild(dot);
        }
    }

    function _initPeakWave() {
        var container = pm._el('home-peak-wave');
        if (!container) return;
        container.innerHTML = '';
        for (var i = 0; i < 30; i++) {
            var bar = document.createElement('div');
            bar.className = 'peak-wave-bar';
            var h = 8 + Math.sin(i * 0.4) * 20 + Math.random() * 12;
            bar.style.height = h + 'px';
            if (Math.random() > 0.6) bar.classList.add('active');
            container.appendChild(bar);
        }
    }

    function _initChannelBars() {
        var container = pm._el('home-channels-chart');
        if (!container) return;
        container.innerHTML = '';
        for (var i = 0; i < 24; i++) {
            var bar = document.createElement('div');
            bar.className = 'ch-bar';
            var h = 15 + Math.random() * 55;
            bar.style.height = h + '%';
            if (h > 50) bar.classList.add('active');
            if (h > 80) bar.classList.add('hot');
            container.appendChild(bar);
        }
    }

    function _initFeedbackChart() {
        var container = pm._el('home-feedback-chart');
        if (!container) return;
        container.innerHTML = '';
        for (var i = 0; i < 20; i++) {
            var bar = document.createElement('div');
            bar.className = 'feedback-bar';
            bar.style.height = (10 + Math.random() * 30) + 'px';
            container.appendChild(bar);
        }
    }

    function _updateQualityGauge() {
        var gauge = pm._el('home-quality-gauge');
        var valueEl = pm._el('home-quality-value');
        if (!gauge || !valueEl) return;

        var score = 0;
        var state = AppStore.getState ? AppStore.getState() : {};

        if (state.mixerConnected) score += 25;
        else score += 5;

        if (state.splStats && state.splStats.leqTotal !== undefined) {
            var spl = state.splStats.leqTotal;
            if (spl >= 70 && spl <= 85) score += 35;
            else if (spl >= 60 && spl <= 90) score += 20;
            else score += 10;
        } else {
            score += 15;
        }

        // RT60 contribution
        score += 20;
        // Base score
        score += 5;
        score = Math.min(100, Math.max(0, score));

        var circumference = 2 * Math.PI * 52;
        var offset = circumference - (score / 100) * circumference;
        gauge.setAttribute('stroke-dasharray', circumference.toFixed(2));
        gauge.setAttribute('stroke-dashoffset', offset.toFixed(2));
        valueEl.textContent = score + '%';
    }

    var _sessionStartTime = Date.now();
    var _sessionTimerInterval = null;
    var _liveTickerInterval = null;
    var _tickPhase = 0;

    function _startSessionTimer() {
        var el = pm._el('home-session-time');
        if (!el) return;
        _sessionTimerInterval = setInterval(function () {
            var diff = Date.now() - _sessionStartTime;
            var mins = Math.floor(diff / 60000);
            var secs = Math.floor((diff % 60000) / 1000);
            el.textContent = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
        }, 1000);
    }

    function _startLiveTicker() {
        _liveTickerInterval = setInterval(function () {
            _tickPhase += 0.15;
            const state = AppStore.getState ? AppStore.getState() : {};
            const isConnected = !!state.mixerConnected;
            const isMic = !!state.micActive;
            const vu = state.vuData || {};

            // 1. Update 24 Channel Bars & Active Count
            const chChart = pm._el('home-channels-chart');
            const activeChEl = pm._el('home-active-channels');
            if (chChart) {
                const bars = chChart.querySelectorAll('.ch-bar');
                let activeCount = 0;
                bars.forEach((bar, idx) => {
                    const chNum = idx + 1;
                    let val = 0;

                    if (vu['ch_' + chNum] !== undefined) {
                        val = Math.min(100, Math.max(5, vu['ch_' + chNum] * 100));
                    } else if (isConnected) {
                        const levelKey = state['ch_' + chNum + '_level'];
                        val = levelKey !== undefined ? levelKey * 80 : 40;
                        val += Math.sin(_tickPhase + idx * 0.5) * 8;
                    } else if (isMic) {
                        val = 20 + Math.sin(_tickPhase + idx * 0.7) * 35 + Math.random() * 15;
                    } else {
                        // Gentle idle pulse
                        val = 12 + Math.sin(_tickPhase * 0.8 + idx * 0.4) * 10;
                    }

                    val = Math.min(100, Math.max(4, val));
                    bar.style.height = val.toFixed(1) + '%';

                    if (val > 15) activeCount++;
                    if (val > 50) bar.classList.add('active');
                    else bar.classList.remove('active');

                    if (val > 82) bar.classList.add('hot');
                    else bar.classList.remove('hot');
                });

                if (activeChEl) {
                    activeChEl.textContent = isConnected ? `${activeCount} / 24` : `${activeCount}`;
                }
            }

            // 2. Update Peak Wave & Frequency if not actively updating via FFT
            const peakWave = pm._el('home-peak-wave');
            const peakFreqEl = pm._el('home-peak-freq');
            if (peakWave && !state.mtwSpectrum) {
                const waveBars = peakWave.querySelectorAll('.peak-wave-bar');
                let maxH = 0;
                let maxIdx = 0;
                waveBars.forEach((wbar, i) => {
                    let h = 8 + Math.sin(_tickPhase + i * 0.3) * 16 + Math.random() * 6;
                    if (isMic || isConnected) h += 8 + Math.sin(_tickPhase * 1.5 + i * 0.2) * 12;
                    wbar.style.height = h.toFixed(1) + 'px';
                    if (h > maxH) { maxH = h; maxIdx = i; }
                    if (h > 20) wbar.classList.add('active');
                    else wbar.classList.remove('active');
                });

                if (peakFreqEl && (!state.feedbackHz)) {
                    if (isMic || isConnected) {
                        const calculatedFreq = Math.round(200 + maxIdx * 120 + Math.sin(_tickPhase) * 40);
                        peakFreqEl.textContent = calculatedFreq + ' Hz';
                    } else if (peakFreqEl.textContent === '—' || peakFreqEl.textContent === '') {
                        peakFreqEl.textContent = '440 Hz';
                    }
                }
            }

            // 3. Update Feedback Mini Chart
            const fbChart = pm._el('home-feedback-chart');
            if (fbChart) {
                const fbars = fbChart.querySelectorAll('.feedback-bar');
                fbars.forEach((fbar, fi) => {
                    let fh = 8 + Math.sin(_tickPhase * 0.6 + fi * 0.5) * 18;
                    if (state.feedbackHz) fh += 12;
                    fbar.style.height = fh.toFixed(1) + 'px';
                });
            }

            // 4. Periodically refresh Quality Gauge
            _updateQualityGauge();
        }, 80);
    }

    function init() {
        loadConfig();
        _initEvents();

        // Initialize dashboard visuals
        _initDateDisplay();
        _initActivityDots();
        _initPeakWave();
        _initChannelBars();
        _initFeedbackChart();
        _updateQualityGauge();
        // Start session timer & live ticker engine
        _startSessionTimer();
        _startLiveTicker();

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
            els.homeMixerStatus.style.color = initialConnected ? '#22c55e' : '#ef4444';
            els.homeMixerStatus.style.fontWeight = '800';
            els.homeMixerStatus.style.fontSize = '14px';
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
            _updateQualityGauge();
        });

        // Mixer connection status subscription
        pm._subscribe('AppStore', 'mixerConnected', (connected) => {
            const statusEl = pm._el('home-mixer-status');
            if (statusEl) {
                statusEl.innerText = connected ? 'Online' : 'Offline';
                statusEl.style.color = connected ? '#22c55e' : '#ef4444';
                statusEl.style.fontWeight = '800';
                statusEl.style.fontSize = '14px';
            }
            _updateQualityGauge();
        });

        // AI Status subscription - Updates Motor IA Card text and spinning ring
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

            const iaSub = document.querySelector('.ia-subtitle');
            const iaTitle = document.querySelector('.ia-title');
            if (iaSub) {
                if (status === 'online') {
                    iaSub.textContent = 'Gemini 3.6 · Online';
                    iaSub.style.color = 'var(--green)';
                } else if (status === 'simulation') {
                    iaSub.textContent = 'Simulação · Ativo';
                    iaSub.style.color = 'var(--coral)';
                } else if (status === 'loading') {
                    iaSub.textContent = 'Processando...';
                    iaSub.style.color = 'var(--coral-light)';
                } else {
                    iaSub.textContent = 'Local Engine · Ativo';
                    iaSub.style.color = 'var(--text-light)';
                }
            }
        });
        // Initial AI status sync
        const currentAiStatus = AppStore.getState?.().aiStatus;
        const iaSub = document.querySelector('.ia-subtitle');
        if (iaSub && currentAiStatus) {
            if (currentAiStatus === 'online') {
                iaSub.textContent = 'Gemini 3.6 · Online';
                iaSub.style.color = 'var(--green)';
            } else if (currentAiStatus === 'simulation') {
                iaSub.textContent = 'Simulação · Ativo';
                iaSub.style.color = 'var(--coral)';
            }
        }

        // Real-time Feedback Hz Subscription
        pm._subscribe('AppStore', 'feedbackHz', (hz) => {
            const fbStatus = pm._el('home-feedback-status');
            const peakFreqEl = pm._el('home-peak-freq');
            if (fbStatus) {
                if (hz) {
                    fbStatus.textContent = `🚨 ${hz} Hz`;
                    fbStatus.className = 'feedback-trend bad';
                } else {
                    fbStatus.textContent = 'Limpo';
                    fbStatus.className = 'feedback-trend good';
                }
            }
            if (hz && peakFreqEl) {
                peakFreqEl.textContent = `${hz} Hz`;
            }
            _updateQualityGauge();
        });

        // Real-time MTW Spectrum FFT Subscription
        pm._subscribe('AppStore', 'mtwSpectrum', (spec) => {
            if (!spec || !spec.magnitudes) return;
            const mags = spec.magnitudes;
            const freqs = spec.frequencies;
            const len = mags.length;

            // Calculate band energies
            let bass = 0, mid = 0, treble = 0, air = 0;
            let bassCount = 0, midCount = 0, trebleCount = 0, airCount = 0;
            let maxMag = -999;
            let peakHz = 440;

            for (let i = 0; i < len; i++) {
                const f = freqs ? freqs[i] : (i * 20000 / len);
                const m = mags[i];
                if (m > maxMag) {
                    maxMag = m;
                    peakHz = Math.round(f);
                }

                if (f <= 250) { bass += m; bassCount++; }
                else if (f <= 4000) { mid += m; midCount++; }
                else if (f <= 12000) { treble += m; trebleCount++; }
                else { air += m; airCount++; }
            }

            // Update Peak Freq
            const peakFreqEl = pm._el('home-peak-freq');
            if (peakFreqEl && peakHz > 0) {
                peakFreqEl.textContent = peakHz + ' Hz';
            }

            // Update Spectrum Labels & Concentric Rings
            const avgBass = bassCount > 0 ? (bass / bassCount) : -40;
            const avgMid = midCount > 0 ? (mid / midCount) : -40;
            const avgTreble = trebleCount > 0 ? (treble / trebleCount) : -40;
            const avgAir = airCount > 0 ? (air / airCount) : -40;

            const els = _getEls();
            if (els.specBass) els.specBass.textContent = `🔊 Graves (${avgBass.toFixed(0)} dB)`;
            if (els.specMid) els.specMid.textContent = `🎵 Médios (${avgMid.toFixed(0)} dB)`;
            if (els.specTreble) els.specTreble.textContent = `✨ Agudos (${avgTreble.toFixed(0)} dB)`;
            if (els.specAir) els.specAir.textContent = `💫 Brilho (${avgAir.toFixed(0)} dB)`;

            // Concentric rings pulse scale
            const r1 = document.querySelector('.spectrum-ring.r1');
            const r2 = document.querySelector('.spectrum-ring.r2');
            const r3 = document.querySelector('.spectrum-ring.r3');
            const r4 = document.querySelector('.spectrum-ring.r4');
            if (r1) r1.style.opacity = Math.min(1, Math.max(0.2, (avgBass + 60) / 60));
            if (r2) r2.style.opacity = Math.min(1, Math.max(0.2, (avgMid + 60) / 60));
            if (r3) r3.style.opacity = Math.min(1, Math.max(0.2, (avgTreble + 60) / 60));
            if (r4) r4.style.opacity = Math.min(1, Math.max(0.2, (avgAir + 60) / 60));
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

        // Load session history sidebar
        _loadSessionList();

        // Autonomy toggle initialization & sync
        pm._subscribe('AppStore', 'aiAutonomousMode', (val) => {
            const toggle = pm._el('home-toggle-autonomous');
            if (toggle) toggle.checked = !!val;
        });
        const initialAuto = AppStore.getState?.().aiAutonomousMode;
        const toggleEl = pm._el('home-toggle-autonomous');
        if (toggleEl) toggleEl.checked = !!initialAuto;

        // Mic Active subscription for Mic Card & Action controls
        pm._subscribe('AppStore', 'micActive', (active) => {
            const toggleDisabled = (el, disabled) => {
                if (!el) return;
                if (disabled) {
                    el.classList.add('sm-action-disabled');
                    if (!el.dataset.oldTitle) el.dataset.oldTitle = el.title || '';
                    el.title = 'Conecte o microfone primeiro (Ctrl+M)';
                } else {
                    el.classList.remove('sm-action-disabled');
                    el.title = el.dataset.oldTitle || '';
                }
            };
            
            toggleDisabled(els.btnListen, !active);
            toggleDisabled(els.btnSendAnalysis, !active);
            
            if (els.quickActions) {
                const btns = els.quickActions.querySelectorAll('button');
                btns.forEach(b => toggleDisabled(b, !active));
            }

            // Update Mic Card Button & Title
            if (els.btnMicActivate) {
                els.btnMicActivate.textContent = active ? 'Ativo' : 'Ativar';
                els.btnMicActivate.style.background = active ? 'var(--green)' : 'var(--coral)';
            }
            const micTitle = document.querySelector('.mic-verify-title');
            if (micTitle) {
                micTitle.textContent = active ? 'Microfone Ativo 🎙️' : 'Verificação do Mic';
            }
            _updateQualityGauge();
        });
        // Set initial mic state
        const micInitial = AppStore.getState?.().micActive;
        if (!micInitial && els.btnListen) els.btnListen.classList.add('sm-action-disabled');
        if (els.btnMicActivate && micInitial) {
            els.btnMicActivate.textContent = 'Ativo';
            els.btnMicActivate.style.background = 'var(--green)';
        }

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
        window._feedbackAutoCutHandler = function (e) {
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
        };
        window.addEventListener('feedback:auto-cut', window._feedbackAutoCutHandler);
    }

    function destroy() {
        if (window.parent && window.parent.document && _rt60Listener) {
            window.parent.document.removeEventListener('rt60-result', _rt60Listener);
            _rt60Listener = null;
        }
        if (window._feedbackAutoCutHandler) {
            window.removeEventListener('feedback:auto-cut', window._feedbackAutoCutHandler);
            window._feedbackAutoCutHandler = null;
        }
        if (_sessionTimerInterval) {
            clearInterval(_sessionTimerInterval);
            _sessionTimerInterval = null;
        }
        if (_liveTickerInterval) {
            clearInterval(_liveTickerInterval);
            _liveTickerInterval = null;
        }
        pm.destroy();
    }

    window.HomePage = {
        init: init,
        destroy: destroy
    };
})();
