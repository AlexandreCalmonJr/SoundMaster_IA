/**
 * SoundMaster — AIChatUI
 * Gerencia EXCLUSIVAMENTE o DOM do módulo "Assistente IA".
 * Toda comunicação com a IA vai para AIService.
 * Toda execução de comandos vai para MixerService.
 * Todo estado compartilhado vai para AppStore.
 */
(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // Elementos do DOM
    // -------------------------------------------------------------------------
    function _el(id) {
        const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }
    const $ = _el;

    let els = {};
    function _getEls() {
        return {
            chatMessages:    $('chat-messages'),
            chatInput:       $('chat-input'),
            btnSend:         $('btn-chat-send'),
            btnClear:        $('btn-clear-chat'),
            chatStatus:      $('chat-status'),
            aiTargetChannel: $('ai-target-channel'),
            btnSendAnalysis: $('btn-ai-send-analysis'),
            btnSendPinkReport: $('btn-ai-send-pink-report'),
            promptButtons:   document.querySelectorAll('.sound-ai-prompt'),
            btnCleanChannel: $('btn-ai-clean-channel'),
            btnHpf:          $('btn-ai-hpf'),
            btnGate:         $('btn-ai-gate'),
            btnCompressor:   $('btn-ai-compressor'),
            btnEqMud:        $('btn-ai-eq-mud'),
            btnEqHarsh:      $('btn-ai-eq-harsh'),
            btnAfsOn:        $('btn-ai-afs-on'),
            btnAfsOff:       $('btn-ai-afs-off'),
        };
    }

    // -------------------------------------------------------------------------
    // Helpers de renderização
    // -------------------------------------------------------------------------

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

    /**
     * Adiciona uma bolha de chat ao container.
     * @param {string} text
     * @param {boolean} isUser
     * @param {Object|null} command  - se presente, adiciona botão "Executar"
     */
    function _appendBubble(text, isUser, command, id) {
        if (!els.chatMessages) return;

        const bubble = document.createElement('div');
        if (id) bubble.id = id;
        bubble.className = 'chat-bubble ' + (isUser ? 'chat-user' : 'chat-assistant');
        bubble.innerText = text;

        if (command && !isUser) {
            const actions = document.createElement('div');
            actions.className = 'chat-actions';

            const btnExec = document.createElement('button');
            btnExec.className = 'action-btn primary';
            btnExec.innerText = 'Executar: ' + (command.desc || command.action);

            btnExec.addEventListener('click', function () {
                const ok = MixerService.executeAICommand(command);
                if (ok) {
                    btnExec.innerText = 'Executado ✓';
                    btnExec.disabled = true;
                    btnExec.style.background = 'var(--success)';
                } else {
                    btnExec.innerText = '⚠️ Conecte-se à mesa primeiro';
                }
            });

            actions.appendChild(btnExec);
            bubble.appendChild(actions);
        }

        els.chatMessages.appendChild(bubble);
        els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
    }

    function _clearChat() {
        if (!els.chatMessages) return;
        els.chatMessages.innerHTML = '';
        _appendBubble('Pronto para novas instruções. Explique o problema de som.', false, null);
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

        // Feedback visual de carregamento
        const loadingId = 'ai-loading-' + Date.now();
        _appendBubble('Analisando dados acústicos...', false, null, loadingId);

        try {
            const result = await AIService.ask(message, channel, payload);
            const loadingBubble = _el(loadingId);
            if (loadingBubble) loadingBubble.remove();
            
            _appendBubble(result.text, false, result.command);
            if (result.report) {
                _appendBubble(result.report, false, null);
            }
        } catch (err) {
            const loadingBubble = _el(loadingId);
            if (loadingBubble) loadingBubble.remove();
            _appendBubble('Erro ao processar análise: ' + err.message, false, null);
        }
    }

    // -------------------------------------------------------------------------
    // Envio de mensagem para IA
    // -------------------------------------------------------------------------
    async function _sendMessage(text) {
        if (!text || !text.trim()) return;

        const channel = _getTargetChannel();
        if (!channel) return;

        // Desabilitar UI durante o envio
        if (els.chatInput) els.chatInput.disabled = true;
        if (els.btnSend) els.btnSend.disabled = true;

        _appendBubble(text.trim(), true, null);
        if (els.chatInput) els.chatInput.value = '';

        const loadingId = 'msg-loading-' + Date.now();
        _appendBubble('...', false, null, loadingId);

        try {
            const result = await AIService.ask(text.trim(), channel);
            const loadingBubble = _el(loadingId);
            if (loadingBubble) loadingBubble.remove();
            
            _appendBubble(result.text, false, result.command);
            if (result.report) {
                _appendBubble(result.report, false, null);
            }
        } catch (err) {
            const loadingBubble = _el(loadingId);
            if (loadingBubble) loadingBubble.innerText = 'Erro na conexão com IA. Verifique o servidor local.';
        } finally {
            if (els.chatInput) {
                els.chatInput.disabled = false;
                els.chatInput.focus();
            }
            if (els.btnSend) els.btnSend.disabled = false;
        }
    }

    // -------------------------------------------------------------------------
    // Eventos DOM
    // -------------------------------------------------------------------------
    function _initEvents() {
        console.log('[AIChatUI] Vinculando eventos...');
        
        // Teste de clique agressivo
        if (els.btnSend) {
            els.btnSend.onclick = function() {
                console.log('[AIChatUI] Clique detectado via onclick');
                const text = els.chatInput && els.chatInput.value.trim();
                if (text) _sendMessage(text);
                else alert('O campo de texto está vazio!');
            };
        } else {
            console.error('[AIChatUI] Botão btnSend não encontrado no DOM.');
        }

        // Envio via Enter
        els.chatInput && els.chatInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter' && els.chatInput.value.trim()) {
                _sendMessage(els.chatInput.value.trim());
            }
        });

        // Limpar chat
        els.btnClear && els.btnClear.addEventListener('click', _clearChat);

        // Prompts rápidos
        els.promptButtons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                const text = btn.dataset.prompt || btn.innerText;
                if (els.chatInput) els.chatInput.value = text;
                _sendMessage(text);
            });
        });

        // Enviar análise acústica ao chat IA
        els.btnSendAnalysis && els.btnSendAnalysis.addEventListener('click', function () {
            _sendAcousticAnalysis(false);
        });
        els.btnSendPinkReport && els.btnSendPinkReport.addEventListener('click', function () {
            _sendAcousticAnalysis(true);
        });

        // Ações rápidas — MixerService direto, sem passar pela IA
        function _quickAction(btn, fn) {
            btn && btn.addEventListener('click', function () {
                const ch = _getTargetChannel();
                if (ch !== null) {
                    const ok = fn(ch);
                    if (ok === false) {
                         _appendBubble('⚠️ Conecte-se à mesa antes de realizar ações rápidas.', false, null);
                    }
                }
            });
        }

        function _quickGlobal(btn, fn) {
            btn && btn.addEventListener('click', function() {
                const ok = fn();
                if (ok === false) {
                    _appendBubble('⚠️ Mixer não conectado.', false, null);
                }
            });
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

    // -------------------------------------------------------------------------
    // Subscriptions no AppStore
    // -------------------------------------------------------------------------
    function _initSubscriptions() {
        AppStore.subscribe('aiStatus', _renderAIStatus);
    }

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------
    async function init() {
        console.log('[AIChatUI] Inicializando...');
        els = _getEls();
        
        if (!els.btnSend) {
            console.error('[AIChatUI] Erro: Botão de envio não encontrado no DOM.');
        }

        _initEvents();
        _initSubscriptions();

        // Mensagem de boas-vindas
        _appendBubble(
            'Bem-vindo ao Centro de Comando IA. Estou monitorando o sistema em tempo real. Como posso otimizar seu som agora?',
            false,
            null
        );

        // Verifica se a IA está acessível ao iniciar
        await AIService.ping();
    }

    window.SoundMasterAIChat = { 
        init,
        sendAnalysis: _sendAcousticAnalysis
    };

    // Ouvir evento do roteador
    document.addEventListener('page-loaded', (e) => {
        if (e.detail.pageId === 'ai-chat') {
            init();
        }
    });
})();
