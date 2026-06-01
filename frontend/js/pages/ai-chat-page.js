/**
 * @fileoverview Página de Chat IA — Interface de chat inteligente 100% autônoma
 * com ações automáticas de análise acústica.
 *
 * Esta página implementa um chat completo com inteligência artificial capaz de
 * realizar análises acústicas autônomas, medições RT60, classificação de áudio
 * e ajustes automáticos na mesa de mixagem. O sistema opera de forma autônoma
 * detectando intenções do usuário e executando ações sem intervenção manual.
 *
 * ## Funcionalidades Principais
 * - Chat interativo com IA (AIService) para diagnóstico acústico
 * - Ações autônomas: análise ao vivo, medição RT60, classificação de áudio
 * - Renderer Markdown para respostas formatadas com código e listas
 * - Indicador de status da IA (online/offline/processando/ouvindo)
 * - Histórico de mensagens persistido no AppStore
 * - Cards de comando "Human-in-the-Loop" com botões Aplicar/Ignorar
 * - Indicador de digitação animado durante processamento
 * - Quick actions: limpar som, HPF, gate, corte de EQ
 * - Suporte a mensagens de voz (botão "Ouvir")
 * - Prompts rápidos pré-definidos
 * - Sanitização HTML com DOMPurify para segurança
 *
 * ## Como Usar
 * 1. Digite uma mensagem descrevendo o problema de som
 * 2. A IA detectará automaticamente a intenção e executará a ação
 * 3. Para análise ao vivo: digite "Analise o som" ou clique em "Ouvir"
 * 4. Para RT60: digite "Meça o RT60" ou "Como está a reverberação?"
 * 5. Para classificação: digite "O que está soando aqui?"
 * 6. Ajuste o canal alvo usando o seletor numérico
 * 7. Use quick actions para ajustes rápidos na mesa
 *
 * ## Dependências e Integrações
 * - **createPageModule()**: Módulo base para páginas
 * - **AppStore**: Store global (histórico, status IA, sessão)
 * - **AIService**: Serviço de IA para análise e comandos
 *   - `ask(text, channel, payload)` — Envia pergunta com contexto
 *   - `classifyAudio(data, sampleRate, topK, threshold)` — Classifica áudio
 *   - `ping()` — Verifica conectividade com IA
 * - **MixerService**: Execução de comandos de mixagem
 *   - `executeAICommand(command)` — Executa comando retornado pela IA
 *   - `runCleanSoundPreset(ch)` — Aplica preset de som limpo
 *   - `applyHpf(ch, freq)` — Aplica filtro passa-alta
 *   - `applyGate(ch)` — Aplica gate
 *   - `applyEqCut(type, ch, freq, gain, q, band)` — Corte de EQ
 *   - `setAfs(enabled)` — Liga/desliga AFS
 * - **SoundMasterAnalyzer**: Analisador de áudio ao vivo
 *   - `start()` — Inicia captura de microfone
 *   - `getLastAnalysis()` — Obtém última análise
 *   - `getLastRt60()` — Obtém último RT60 medido
 *   - `getFreqData()` — Obtém dados de frequência
 *   - `triggerImpulse()` — Dispara sweep de medição
 *   - `isAnalyzing()` — Verifica se está analisando
 * - **DOMPurify**: Sanitização de HTML (opicional)
 *
 * @module AiChatPage
 * @version 2.0.0
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
            btnCleanChannel:   pm._el('btn-ai-clean-channel'),
            btnHpf:            pm._el('btn-ai-hpf'),
            btnGate:           pm._el('btn-ai-gate'),
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
            listening: { text: 'Ouvindo...',   color: '#06b6d4' },
        };
        const s = map[status] || map.offline;
        els.chatStatus.innerText = s.text;
        els.chatStatus.style.color = s.color;
    }

    // ─── Timestamp helpers ─────────────────────────────────────────────────────

    function _formatTime(ts) {
        const d = new Date(ts);
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    // ─── Markdown Renderer melhorado ───────────────────────────────────────────

    const _PURIFY_CONFIG = {
        ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'strong', 'em', 'code', 'pre', 'li', 'br', 'ul', 'ol', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'p'],
        ALLOWED_ATTR: ['class', 'colspan'],
        ALLOW_DATA_ATTR: false,
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
        FORCE_BODY: false,
    };

    function _sanitize(html) {
        if (window.DOMPurify && typeof DOMPurify.sanitize === 'function') {
            return DOMPurify.sanitize(html, _PURIFY_CONFIG);
        }
        return html.replace(/<(?!\/?(h[1-4]|strong|em|code|pre|li|br|ul|ol|table|thead|tbody|tr|th|td|span|div|p)\b)[^>]+>/gi, '');
    }

    function _renderMarkdown(text) {
        if (!text) return '';
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Code blocks (```...```)
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-black/60 font-mono px-3 py-2 rounded-lg text-cyan-300 text-xs overflow-x-auto my-2"><code>$2</code></pre>');

        // Headers
        html = html.replace(/^#### (.*?)$/gm, '<h4 class="text-sm font-bold text-cyan-400 mt-2 mb-1">$1</h4>');
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

    // ─── History persistence ───────────────────────────────────────────────────

    function _saveMessageToHistory(text, isUser, command, id, executed = false) {
        try {
            const currentHistory = AppStore.getState().aiChatHistory || [];
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
            AppStore.setState({
                aiChatHistory: currentHistory.map(msg =>
                    msg.id === id ? Object.assign({}, msg, { executed: true }) : msg
                )
            });
        } catch (e) {
            console.error('[AiChatPage] Error marking command executed:', e);
        }
    }

    // ─── Bubble rendering ──────────────────────────────────────────────────────

    function _appendBubble(text, isUser, command, id, saveToHistory = true, executed = false) {
        if (!els.chatMessages) return;

        if (!id) id = 'msg-' + Math.random().toString(36).substr(2, 9);

        const wrapper = document.createElement('div');
        wrapper.id = id;
        wrapper.className = `flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`;

        const bubble = document.createElement('div');
        bubble.className = `max-w-[85%] rounded-2xl px-4 py-3 ${
            isUser
                ? 'bg-cyan-600/20 border border-cyan-500/30 text-white'
                : 'bg-slate-800/80 border border-white/10 text-slate-200'
        }`;

        // Timestamp
        const ts = document.createElement('div');
        ts.className = `text-[10px] mb-1 ${isUser ? 'text-cyan-400/60 text-right' : 'text-slate-500'}`;
        ts.textContent = _formatTime(Date.now());
        bubble.appendChild(ts);

        // Content
        const content = document.createElement('div');
        content.className = 'text-sm leading-relaxed';
        if (text === '...' || text.startsWith('Analisando') || text.startsWith('Capturando')) {
            content.className += ' typing-dots';
            content.innerHTML = `<span class="text-slate-400">${text}</span>`;
        } else {
            content.innerHTML = _renderMarkdown(text);
        }
        bubble.appendChild(content);

        // Command card (Human-in-the-Loop)
        if (command && !isUser) {
            const card = _createCommandCard(command, id, executed);
            bubble.appendChild(card);
        }

        wrapper.appendChild(bubble);
        els.chatMessages.appendChild(wrapper);
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;

        if (saveToHistory) {
            _saveMessageToHistory(text, isUser, command, id, executed);
        }
    }

    function _createCommandCard(command, msgId, executed) {
        const card = document.createElement('div');
        card.className = 'mt-2 bg-slate-950/80 border border-cyan-500/20 rounded-xl p-2 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-2';

        const desc = (command.desc || 'Ajuste').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

        card.innerHTML = `
            <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-1.5 leading-tight">
                    <span class="text-cyan-400 text-xs shrink-0">⚡</span>
                    <span class="text-xs text-white font-bold truncate">${desc}</span>
                </div>
                <div class="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 font-mono">
                    <span>CH ${command.channel ?? '-'}</span>
                    <span>|</span>
                    <span class="uppercase">${command.action || '-'}</span>
                    ${command.value != null ? `<span>|</span><span>${command.value}</span>` : ''}
                </div>
            </div>
            <div class="flex gap-1.5 justify-end shrink-0">
                <button class="ignore-btn px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-400 hover:text-white transition-all">Ignorar</button>
                <button class="exec-btn px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-[10px] font-extrabold text-white transition-all flex items-center gap-1">
                    Aplicar
                </button>
            </div>
        `;

        const btnExec = card.querySelector('.exec-btn');
        const btnIgnore = card.querySelector('.ignore-btn');

        if (executed) {
            btnExec.innerHTML = '✓ Aplicado';
            btnExec.disabled = true;
            btnExec.className = 'exec-btn px-2.5 py-1 rounded bg-emerald-950/40 border border-emerald-500/30 text-[10px] font-bold text-emerald-400 flex items-center gap-1';
            btnIgnore.style.display = 'none';
        } else {
            pm._on(btnExec, 'click', function () {
                const ok = MixerService.executeAICommand(command);
                if (ok) {
                    btnExec.innerHTML = '✓ Aplicado';
                    btnExec.disabled = true;
                    btnExec.className = 'exec-btn px-2.5 py-1 rounded bg-emerald-950/40 border border-emerald-500/30 text-[10px] font-bold text-emerald-400 flex items-center gap-1';
                    btnIgnore.style.display = 'none';
                    _markCommandExecutedInHistory(msgId);
                } else {
                    btnExec.innerText = '⚠️ Sem conexão';
                }
            });
            pm._on(btnIgnore, 'click', function () {
                card.style.opacity = '0.4';
                btnExec.disabled = true;
                btnIgnore.disabled = true;
            });
        }

        return card;
    }

    // ─── Typing indicator ──────────────────────────────────────────────────────

    function _showTyping() {
        if (!els.chatMessages) return null;
        const id = 'typing-' + Date.now();
        const wrapper = document.createElement('div');
        wrapper.id = id;
        wrapper.className = 'flex justify-start mb-3';
        wrapper.innerHTML = `
            <div class="flex items-center gap-1.5 px-4 py-3 bg-slate-800/60 border border-white/5 rounded-2xl">
                <span class="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
                <span class="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
                <span class="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
            </div>
        `;
        els.chatMessages.appendChild(wrapper);
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
        return id;
    }

    function _removeTyping(id) {
        const el = pm._el(id);
        if (el) el.remove();
    }

    // ─── Status step indicator ─────────────────────────────────────────────────

    function _appendStep(text, icon) {
        const id = 'step-' + Date.now();
        if (!els.chatMessages) return id;
        const el = document.createElement('div');
        el.id = id;
        el.className = 'flex items-center gap-2 text-xs text-slate-400 pl-2 py-1';
        el.innerHTML = `<span class="text-cyan-500">${icon || '▸'}</span> <span>${text}</span>`;
        els.chatMessages.appendChild(el);
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
        return id;
    }

    function _updateStep(id, text, icon) {
        const el = pm._el(id);
        if (el) {
            el.innerHTML = `<span class="text-cyan-500">${icon || '✓'}</span> <span class="text-slate-300">${text}</span>`;
        }
    }

    // ─── Clear ─────────────────────────────────────────────────────────────────

    function _clearChat() {
        if (!els.chatMessages) return;
        els.chatMessages.innerHTML = '';
        AppStore.setState({ aiChatHistory: [] });
        _appendBubble('Pronto! Me conte o que está sentindo no som — posso analisar, medir e ajustar tudo automaticamente.', false, null, null, true, false);
    }

    // ─── Channel & Analysis helpers ────────────────────────────────────────────

    function _getTargetChannel() {
        let val = Number(els.aiTargetChannel && els.aiTargetChannel.value);
        if (!Number.isInteger(val) || val < 1 || val > 24) {
            val = 1;
            if (els.aiTargetChannel) els.aiTargetChannel.value = 1;
        }
        return val;
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

    // ─── Autonomous actions ────────────────────────────────────────────────────

    /**
     * Detecta intenção do usuário e executa ação autônoma.
     * Retorna true se uma ação autônoma foi disparada.
     */
    function _checkAutonomousAction(text, channel) {
        const t = text.toLowerCase();

        // RT60 / Medição Acústica / Relatório Técnico (Requer sweep de sinal / pulso acústico)
        if (/(?:rt60|reverbera|tempo.*decai|eco|vivo|morto|dura[cç][aã]o|medir|med[iç]|mensura|sweep|pulso|relat[oó]rio|resumo|estat[ií]stica|laudo|documento|auditoria|auditar|audit|verifica)/.test(t)) {
            return { type: 'rt60_measurement', prompt: text };
        }

        // Análise em tempo real / Captura espectral (Apenas RTA passivo, sem sweep de sinal)
        if (/(?:anali[sz]|como.?est[aá].*som|est[aá].*bom|est[aá].*ruim|avaliar|verificar som|check.*sound|ouvir|escutar|capturar)/.test(t)) {
            return { type: 'live_analysis', prompt: text };
        }

        // Feedback / microfonia
        if (/(?:apito|microfonia|feedback|realimenta|chiado|guincho)/.test(t)) {
            return { type: 'live_analysis', prompt: text };
        }

        // Classificação de áudio
        if (/(?:classificar|identificar.*som|o que.*soa|que som|instrumento|voz.*fala|musica)/.test(t)) {
            return { type: 'classify_audio', prompt: text };
        }

        return null;
    }

    /**
     * Ação autônoma: captura áudio ao vivo e analisa
     */
    async function _autoLiveAnalysis(channel, userPrompt) {
        const stepCapture = _appendStep('Iniciando microfone...', '🎙️');

        try {
            if (!window.SoundMasterAnalyzer) {
                _updateStep(stepCapture, 'Analisador não disponível', '❌');
                _appendBubble('O analisador de áudio não está disponível neste navegador.', false, null);
                return false;
            }

            if (!window.SoundMasterAnalyzer.isAnalyzing()) {
                _updateStep(stepCapture, 'Abrindo microfone...', '🎙️');
                await window.SoundMasterAnalyzer.start();
                // Espera o AudioContext estar pronto e ter dados
                await new Promise(r => setTimeout(r, 1500));
            }

            // Garante que temos dados antes de prosseguir
            let attempts = 0;
            let analysis = null;
            while (attempts < 6) {
                _updateStep(stepCapture, `Capturando som ambiente (${attempts + 1}/6s)...`, '⏳');
                await new Promise(r => setTimeout(r, 1000));
                analysis = window.SoundMasterAnalyzer.getLastAnalysis();
                if (analysis && analysis.details && analysis.details.peakHz > 0) break;
                attempts++;
            }

            if (!analysis) {
                _updateStep(stepCapture, 'Não foi possível capturar áudio', '❌');
                _appendBubble('Não consegui capturar dados de áudio. Verifique se o microfone está funcionando e tente novamente.', false, null);
                return false;
            }

            _updateStep(stepCapture, `Áudio capturado — pico ${analysis.details?.peakHz || '?'}Hz`, '✓');

            const stepAnalyze = _appendStep('Analisando dados acústicos...', '📊');
            const lastRt60 = window.SoundMasterAnalyzer.getLastRt60();
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

            _updateStep(stepAnalyze, 'Dados analisados com sucesso', '✓');

            const stepAI = _appendStep('Gerando resposta...', '🧠');
            const result = await AIService.ask(userPrompt, channel, payload);
            _updateStep(stepAI, 'Resposta pronta', '✓');

            _appendBubble(result.text, false, result.command);
            if (result.report) {
                _appendBubble(result.report, false, null);
            }
            return true;

        } catch (err) {
            _appendBubble('Erro na análise automática: ' + err.message, false, null);
            return false;
        }
    }

    /**
     * Ação autônoma: medir RT60 via impulse/sweep
     */
    async function _autoRT60(channel, userPrompt) {
        const step = _appendStep('Iniciando medição RT60...', '📐');

        try {
            if (!window.SoundMasterAnalyzer) {
                _updateStep(step, 'Analisador não disponível', '❌');
                return false;
            }

            if (!window.SoundMasterAnalyzer.isAnalyzing()) {
                _updateStep(step, 'Abrindo microfone...', '🎙️');
                await window.SoundMasterAnalyzer.start();
            }

            _updateStep(step, 'Gerando sweep de sinal (10s)...', '🔊');
            await window.SoundMasterAnalyzer.triggerImpulse();
            
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

            const lastRt60 = window.SoundMasterAnalyzer.getLastRt60();
            if (!lastRt60 || !lastRt60.rt60) {
                _updateStep(step, 'Medição RT60 indisponível. Tentando estimativa...', '⚠️');
                return await _autoLiveAnalysis(channel, userPrompt);
            }

            _updateStep(step, `RT60 medido: ${lastRt60.rt60.toFixed(2)}s`, '✓');

            const analysis = window.SoundMasterAnalyzer.getLastAnalysis();
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

            const result = await AIService.ask(userPrompt + ' (RT60 medido: ' + lastRt60.rt60.toFixed(2) + 's)', channel, payload);

            _appendBubble(result.text, false, result.command);
            if (result.report) _appendBubble(result.report, false, null);
            return true;

        } catch (err) {
            _appendBubble('Erro na medição RT60: ' + err.message, false, null);
            return false;
        }
    }

    /**
     * Ação autônoma: classificar tipo de som
     */
    async function _autoClassify(channel, userPrompt) {
        const step = _appendStep('Capturando áudio para classificação...', '🎤');

        try {
            if (!window.SoundMasterAnalyzer) {
                _updateStep(step, 'Analisador não disponível', '❌');
                return false;
            }

            if (!window.SoundMasterAnalyzer.isAnalyzing()) {
                await window.SoundMasterAnalyzer.start();
            }

            _updateStep(step, 'Capturando 2s de áudio...', '⏳');
            await new Promise(r => setTimeout(r, 2000));

            const freqData = window.SoundMasterAnalyzer.getFreqData();
            if (!freqData || !freqData.data) {
                _updateStep(step, 'Dados de áudio indisponíveis', '❌');
                return false;
            }

            _updateStep(step, 'Classificando sons com YAMNet...', '🧠');
            const classifyResult = await AIService.classifyAudio(Array.from(freqData.data.slice(0, 48000)), freqData.sampleRate || 48000, 5, 0.1);

            _updateStep(step, 'Classificação concluída', '✓');

            let classInfo = '';
            if (classifyResult && classifyResult.classes && classifyResult.classes.length > 0) {
                classInfo = '\n\n**Sons detectados:**\n';
                classifyResult.classes.forEach((c, i) => {
                    const pct = Math.round(c.score * 100);
                    classInfo += `- ${c.name}: ${pct}%\n`;
                });
            }

            const result = await AIService.ask(userPrompt, channel, { classification: classifyResult });
            _appendBubble(result.text + classInfo, false, result.command);
            if (result.report) _appendBubble(result.report, false, null);
            return true;

        } catch (err) {
            _appendBubble('Erro na classificação: ' + err.message, false, null);
            return false;
        }
    }

    // ─── Main send message ─────────────────────────────────────────────────────

    async function _sendMessage(text) {
        if (!text || !text.trim()) return;

        const channel = _getTargetChannel();

        if (els.chatInput) els.chatInput.disabled = true;
        if (els.btnSend) els.btnSend.disabled = true;

        _appendBubble(text.trim(), true, null);
        if (els.chatInput) els.chatInput.value = '';

        // Verificar ação autônoma
        const action = _checkAutonomousAction(text, channel);
        if (action) {
            let handled = false;
            if (action.type === 'live_analysis') {
                handled = await _autoLiveAnalysis(channel, action.prompt);
            } else if (action.type === 'rt60_measurement') {
                handled = await _autoRT60(channel, action.prompt);
            } else if (action.type === 'classify_audio') {
                handled = await _autoClassify(channel, action.prompt);
            }
            if (handled) {
                if (els.chatInput) { els.chatInput.disabled = false; els.chatInput.focus(); }
                if (els.btnSend) els.btnSend.disabled = false;
                return;
            }
        }

        // Fallback: envia para a IA normalmente
        const loadingId = _showTyping();
        try {
            const result = await AIService.ask(text.trim(), channel);
            _removeTyping(loadingId);

            // Se a IA respondeu com start_live_analysis, executar automaticamente
            if (result.command && result.command.action === 'start_live_analysis') {
                await _autoLiveAnalysis(channel, text.trim());
            } else {
                _appendBubble(result.text, false, result.command);
                if (result.report) _appendBubble(result.report, false, null);
            }
        } catch (err) {
            _removeTyping(loadingId);
            _appendBubble('Erro na conexão com IA. Verifique o servidor local.', false, null);
        } finally {
            if (els.chatInput) { els.chatInput.disabled = false; els.chatInput.focus(); }
            if (els.btnSend) els.btnSend.disabled = false;
        }
    }

    // ─── Event binding ─────────────────────────────────────────────────────────

    function _initEvents() {
        if (els.btnSend) {
            pm._on(els.btnSend, 'click', function() {
                const text = els.chatInput && els.chatInput.value.trim();
                if (text) _sendMessage(text);
            });
        }

        if (els.chatInput) {
            pm._on(els.chatInput, 'keypress', function (e) {
                if (e.key === 'Enter' && els.chatInput.value.trim()) {
                    _sendMessage(els.chatInput.value.trim());
                }
            });
        }

        if (els.btnClear) pm._on(els.btnClear, 'click', _clearChat);

        if (els.btnListen) {
            pm._on(els.btnListen, 'click', async function () {
                const channel = _getTargetChannel();
                _appendBubble('Ouvindo o microfone...', true, null);
                await _autoLiveAnalysis(channel, 'Analise o áudio capturado pelo microfone e sugira melhorias');
            });
        }

        // Quick prompts
        const promptButtons = (pm._el('ai-chat')?.querySelectorAll('.sound-ai-prompt')) || document.querySelectorAll('.sound-ai-prompt');
        if (promptButtons) {
            promptButtons.forEach(btn => {
                pm._on(btn, 'click', function () {
                    const text = btn.dataset.prompt || btn.innerText;
                    if (els.chatInput) els.chatInput.value = text;
                    _sendMessage(text);
                });
            });
        }

        // Quick actions
        function _quickAction(btn, fn) {
            if (btn) pm._on(btn, 'click', () => { const ch = _getTargetChannel(); fn(ch); });
        }
        _quickAction(els.btnCleanChannel, ch => MixerService.runCleanSoundPreset(ch));
        _quickAction(els.btnHpf,          ch => MixerService.applyHpf(ch, 100));
        _quickAction(els.btnGate,         ch => MixerService.applyGate(ch));
        _quickAction(els.btnEqMud,        ch => MixerService.applyEqCut('channel', ch, 250, -3, 1.1, 2));
        _quickAction(els.btnEqHarsh,      ch => MixerService.applyEqCut('channel', ch, 3200, -2.5, 1.5, 3));

        function _quickGlobal(btn, fn) {
            if (btn) pm._on(btn, 'click', () => fn());
        }
        _quickGlobal(els.btnAfsOn,  () => MixerService.setAfs(true));
        _quickGlobal(els.btnAfsOff, () => MixerService.setAfs(false));
    }

    // ─── Init ──────────────────────────────────────────────────────────────────

    function init() {
        els = _getEls();
        _initEvents();
        if (els.chatInput) pm._setTimeout(() => els.chatInput.focus(), 100);

        pm._subscribe('AppStore', 'aiStatus', _renderAIStatus);
        const initialStatus = AppStore.getState?.().aiStatus || 'online';
        _renderAIStatus(initialStatus);

        const history = AppStore.getState?.().aiChatHistory || [];
        if (history.length > 0) {
            if (els.chatMessages) els.chatMessages.innerHTML = '';
            history.forEach(msg => _appendBubble(msg.text, msg.isUser, msg.command, msg.id, false, msg.executed));
        } else {
            if (els.chatMessages) els.chatMessages.innerHTML = '';
            _appendBubble(
                'Olá! Sou o SoundMaster IA. Posso analisar seu som automaticamente — basta pedir!\n\n' +
                'Diga algo como:\n' +
                '- "Analise o som da sala"\n' +
                '- "Meça o RT60"\n' +
                "- 'O que está soando aqui?'\n" +
                '- "Como está o som?"',
                false, null, 'welcome-msg', true, false
            );
        }
        AIService.ping();
    }

    function destroy() { pm.destroy(); }

    window.AiChatPage = { init, destroy, sendAnalysis: () => _autoLiveAnalysis(_getTargetChannel(), 'Análise acústica completa') };
})();
