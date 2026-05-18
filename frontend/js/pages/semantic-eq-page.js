'use strict';
(function () {
    var pm = createPageModule();

    async function _sendCommand() {
        var input = pm._el('seq-input'), text = input ? input.value.trim() : '';
        if (!text) return;
        var channel = parseInt(pm._el('seq-channel') ? pm._el('seq-channel').value : 1) || 1;
        input.value = '';
        pm._safeCall('SemanticEqUI', 'addMessage', 'user', text);
        pm._safeCall('SemanticEqUI', 'setStatus', 'Pensando...', true);
        if (window.AIService) {
            try {
                var result = await AIService.ask(text, channel);
                pm._safeCall('SemanticEqUI', 'addMessage', 'ai', result.text);
                if (result.command) pm._safeCall('SemanticEqUI', 'showPlan', result.command);
                pm._safeCall('SemanticEqUI', 'setStatus', 'Pronto', false);
            } catch (err) { pm._safeCall('SemanticEqUI', 'addMessage', 'ai', 'Erro ao comunicar com a IA: ' + err.message); pm._safeCall('SemanticEqUI', 'setStatus', 'Erro', false); }
        } else { pm._safeCall('SemanticEqUI', 'addMessage', 'ai', 'AIService n\u00E3o dispon\u00EDvel.'); pm._safeCall('SemanticEqUI', 'setStatus', 'Offline', false); }
    }

    function _applyToMixer() {
        var command = pm._safeCall('SemanticEqUI', 'getPendingCommand');
        if (!command || !command.action) return;
        if (window.MixerService) { MixerService.executeAICommand(command); pm._safeCall('AppStore', 'addLog', '[Semantic EQ] Comando aplicado: ' + command.desc); pm._safeCall('SemanticEqUI', 'hidePlan'); }
    }

    function init() {
        pm._on(pm._el('btn-seq-send'), 'click', _sendCommand);
        pm._on(pm._el('seq-input'), 'keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendCommand(); } });
        pm._on(pm._el('btn-seq-clear'), 'click', function () { pm._safeCall('SemanticEqUI', 'clearChat'); });
        pm._on(pm._el('btn-seq-apply'), 'click', _applyToMixer);
        document.querySelectorAll('.seq-category').forEach(function (btn) { pm._on(btn, 'click', function () { var desc = this.getAttribute('data-desc'), input = pm._el('seq-input'); if (input) input.value = desc; _sendCommand(); }); });
        pm._on(pm._el('seq-channel'), 'change', function () { var ch = parseInt(this.value) || 1; pm._safeCall('SemanticEqUI', 'updateChannelPreview', ch); });
        var ch = parseInt(pm._el('seq-channel') ? pm._el('seq-channel').value : 1) || 1;
        pm._safeCall('SemanticEqUI', 'updateChannelPreview', ch);
        pm._safeCall('SemanticEqUI', 'setStatus', 'Pronto', false);
    }

    function destroy() { pm.destroy(); }

    window.SemanticEqPage = { init: init, destroy: destroy };
})();
