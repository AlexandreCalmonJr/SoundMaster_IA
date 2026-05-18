/**
 * SoundMaster — Semantic EQ Page Module
 * Binds DOM events para a página de EQ Semântico (NLP).
 */

'use strict';

(function () {

    let _listeners = [];

    function _on(target, event, handler) {
        if (!target) return;
        target.addEventListener(event, handler);
        _listeners.push({ target, event, handler });
    }

    async function _sendCommand() {
        const input = document.getElementById('seq-input');
        const text = input?.value?.trim();
        if (!text) return;

        const channel = parseInt(document.getElementById('seq-channel')?.value) || 1;
        input.value = '';

        if (window.SemanticEqUI) {
            SemanticEqUI.addMessage('user', text);
            SemanticEqUI.setStatus('Pensando...', true);
        }

        if (window.AIService) {
            try {
                const result = await AIService.ask(text, channel);
                if (window.SemanticEqUI) {
                    SemanticEqUI.addMessage('ai', result.text);
                    if (result.command) SemanticEqUI.showPlan(result.command);
                    SemanticEqUI.setStatus('Pronto', false);
                }
            } catch (err) {
                if (window.SemanticEqUI) {
                    SemanticEqUI.addMessage('ai', 'Erro ao comunicar com a IA: ' + err.message);
                    SemanticEqUI.setStatus('Erro', false);
                }
            }
        } else {
            if (window.SemanticEqUI) {
                SemanticEqUI.addMessage('ai', 'AIService não disponível.');
                SemanticEqUI.setStatus('Offline', false);
            }
        }
    }

    function _applyToMixer() {
        const command = window.SemanticEqUI ? SemanticEqUI.getPendingCommand() : null;
        if (!command || !command.action) return;
        if (window.MixerService) {
            MixerService.executeAICommand(command);
            if (window.AppStore) AppStore.addLog('[Semantic EQ] Comando aplicado: ' + command.desc);
            SemanticEqUI.hidePlan();
        }
    }

    function init() {
        console.log('[SemanticEqPage] Initializing...');

        _on(document.getElementById('btn-seq-send'), 'click', _sendCommand);

        _on(document.getElementById('seq-input'), 'keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                _sendCommand();
            }
        });

        _on(document.getElementById('btn-seq-clear'), 'click', function () {
            if (window.SemanticEqUI) SemanticEqUI.clearChat();
        });

        _on(document.getElementById('btn-seq-apply'), 'click', _applyToMixer);

        // Category buttons
        document.querySelectorAll('.seq-category').forEach(function (btn) {
            _on(btn, 'click', function () {
                const desc = this.getAttribute('data-desc');
                const input = document.getElementById('seq-input');
                if (input) input.value = desc;
                _sendCommand();
            });
        });

        // Channel preview update
        _on(document.getElementById('seq-channel'), 'change', function () {
            const ch = parseInt(this.value) || 1;
            if (window.SemanticEqUI) SemanticEqUI.updateChannelPreview(ch);
        });

        // Initial preview
        const ch = parseInt(document.getElementById('seq-channel')?.value) || 1;
        if (window.SemanticEqUI) {
            SemanticEqUI.updateChannelPreview(ch);
            SemanticEqUI.setStatus('Pronto', false);
        }

        console.log('[SemanticEqPage] Initialized.');
    }

    function destroy() {
        _listeners.forEach(({ target, event, handler }) => {
            target.removeEventListener(event, handler);
        });
        _listeners = [];
        console.log('[SemanticEqPage] Destroyed.');
    }

    window.SemanticEqPage = { init, destroy };
})();
