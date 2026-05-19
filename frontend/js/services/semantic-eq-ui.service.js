/**
 * SoundMaster — Semantic EQ UI Service
 * Gerencia a interface de chat do EQ Semântico (NLP).
 *
 * API Pública (window.SemanticEqUI):
 *   .addMessage(role, text, isHtml)
 *   .escapeHtml(str) → string
 *   .setStatus(text, isLoading)
 *   .showPlan(command)
 *   .hidePlan()
 *   .updateChannelPreview(channelNum)
 *   .clearChat()
 */

'use strict';

(function () {

    let _pendingCommand = null;

    function addMessage(role, text, isHtml) {
        const container = document.getElementById('seq-messages');
        if (!container) return;

        const div = document.createElement('div');
        div.className = 'flex gap-3' + (role === 'user' ? ' flex-row-reverse' : '');

        const avatar = role === 'user'
            ? '<div class="w-8 h-8 rounded-full bg-slate-600/50 border border-white/10 flex-shrink-0 flex items-center justify-center text-xs font-bold text-slate-300">U</div>'
            : '<div class="w-8 h-8 rounded-full bg-cyan-600/30 border border-cyan-500/30 flex-shrink-0 flex items-center justify-center text-xs">AI</div>';

        const bubble = role === 'user'
            ? `<div class="bg-cyan-700/40 rounded-2xl rounded-tr-none px-4 py-3 text-sm text-slate-100 max-w-[85%]">${isHtml ? text : escapeHtml(text)}</div>`
            : `<div class="bg-slate-800/60 rounded-2xl rounded-tl-none px-4 py-3 text-sm text-slate-300 max-w-[85%]">${isHtml ? text : escapeHtml(text)}</div>`;

        div.innerHTML = avatar + bubble;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function setStatus(text, isLoading) {
        const dot = document.getElementById('seq-status-dot');
        const status = document.getElementById('seq-status');
        if (dot) dot.className = 'w-2 h-2 rounded-full ' + (isLoading ? 'bg-yellow-500 animate-pulse' : 'bg-green-500');
        if (status) status.textContent = text;
    }

    function showPlan(command) {
        _pendingCommand = command;
        const container = document.getElementById('seq-plan-container');
        const planText = document.getElementById('seq-plan-text');
        if (container && command && command.desc) {
            planText.innerHTML = '<strong>Comando:</strong> ' + escapeHtml(command.desc);
            container.classList.remove('hidden');
        } else if (container) {
            container.classList.add('hidden');
        }
    }

    function hidePlan() {
        _pendingCommand = null;
        const container = document.getElementById('seq-plan-container');
        if (container) container.classList.add('hidden');
    }

    function getPendingCommand() {
        return _pendingCommand;
    }

    function updateChannelPreview(ch) {
        const state = window.AppStore ? AppStore.getState() : {};
        const previewCh = document.getElementById('seq-preview-ch');
        const previewLevel = document.getElementById('seq-preview-level');
        const previewMute = document.getElementById('seq-preview-mute');
        const previewHpf = document.getElementById('seq-preview-hpf');
        const previewGate = document.getElementById('seq-preview-gate');

        if (previewCh) previewCh.textContent = ch;
        if (previewLevel) {
            const level = state[`ch_${ch}_level`];
            previewLevel.textContent = level != null ? Math.round(level * 100) + '%' : '--';
        }
        if (previewMute) {
            const mute = state[`mute_ch_${ch}`];
            previewMute.textContent = mute ? 'SIM' : 'Não';
        }
        if (previewHpf) {
            const hpf = state[`hpf_ch_${ch}`];
            previewHpf.textContent = hpf ? hpf + 'Hz' : '--';
        }
        if (previewGate) {
            const gate = state[`gate_ch_${ch}`];
            previewGate.textContent = gate ? 'Ativo' : 'Off';
        }
    }

    function clearChat() {
        const container = document.getElementById('seq-messages');
        if (container) container.innerHTML = '';
        hidePlan();
        addMessage('ai', 'Olá! Descreva o problema de som no campo abaixo. Por exemplo: "a voz está abafada e metálica" ou "o retorno está vazando no altar".');
    }

    window.SemanticEqUI = {
        addMessage,
        escapeHtml,
        setStatus,
        showPlan,
        hidePlan,
        getPendingCommand,
        updateChannelPreview,
        clearChat,
    };

    console.log('[SemanticEqUI] Carregado.');
})();
