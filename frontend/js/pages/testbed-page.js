'use strict';
(function () {
    var pm = createPageModule();
    var NUM_CH = 12;
    var animationFrameId = null;
    var fftCtx = null;

    function _buildVuGrid() {
        var grid = pm._el('sim-vu-grid');
        if (!grid) return;
        grid.innerHTML = '';
        for (var i = 1; i <= NUM_CH; i++) {
            var div = document.createElement('div');
            div.className = 'flex flex-col items-center gap-1';
            div.innerHTML = '<div class="text-[9px] text-slate-600 font-mono">' + i + '</div>' + '<div class="w-full h-24 bg-black/40 rounded-lg overflow-hidden relative flex flex-col justify-end" id="sim-ch-vu-' + i + '">' + '<div class="sim-vu-bar w-full bg-cyan-500/70 transition-all" style="height:0%"></div>' + '<div class="sim-vu-peak absolute left-0 right-0 h-0.5 bg-red-500 transition-all" style="bottom:0%"></div>' + '</div>' + '<div class="sim-vu-label text-[9px] text-slate-600 font-mono">-\u221E</div>';
            grid.appendChild(div);
        }
    }

    function _updateVuGrid() {
        if (!window.SimulationService || !SimulationService.isRunning()) return;
        var s = SimulationService.getState();
        for (var i = 1; i <= NUM_CH; i++) {
            var ch = s.channels ? s.channels[i - 1] : null;
            if (!ch) continue;
            var vu = ch.vu ?? -80;
            var pct = Math.max(0, ((vu + 80) / 80) * 100);
            var container = pm._el('sim-ch-vu-' + i);
            if (!container) continue;
            var bar = container.querySelector('.sim-vu-bar');
            var peak = container.querySelector('.sim-vu-peak');
            var label = container.parentElement.querySelector('.sim-vu-label');
            if (bar) bar.style.height = pct + '%';
            if (peak) peak.style.bottom = Math.max(0, ((ch.vuPeak ?? -80) + 80) / 80 * 100) + '%';
            if (label) label.textContent = vu > -60 ? vu.toFixed(1) + 'dB' : '-\u221E';
        }
        var masterPct = s.master ? s.master.level * 100 : 0;
        pm._el('sim-master-bar').style.width = masterPct + '%';
        var ml = pm._el('sim-master-label');
        if (ml) ml.textContent = (s.master && s.master.mute) ? 'MUTE' : Math.round(((s.master ? s.master.level : 1) - 1) * 100) + 'dB';
    }

    function _updateAcousticDisplay() {
        if (!window.SimulationService) return;
        var a = SimulationService.getFakeAnalysis();
        pm._setText('sim-rt60', a.rt60.toFixed(2));
        pm._setText('sim-sti', a.sti.toFixed(2));
        pm._setText('sim-c50', a.c50.toFixed(1));
        pm._setText('sim-peak', a.peakHz > 0 ? a.peakHz + 'Hz' : '--');
        _drawFft(a.spectrum_db);
    }

    function _drawFft(spectrumData) {
        var canvas = pm._el('sim-fft-canvas');
        if (!canvas) return;
        if (!fftCtx) fftCtx = canvas.getContext('2d');
        var ctx = fftCtx, w = canvas.width, h = canvas.height;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, w, h);
        if (!spectrumData || spectrumData.length === 0) return;
        var bars = spectrumData.length, barW = w / bars;
        var lerp = function (a, b, t) { return Math.round(a + (b - a) * t); };
        for (var i = 0; i < bars; i++) {
            var db = spectrumData[i] || 0, barH = Math.max(2, ((db + 30) / 30) * h), x = i * barW;
            var r = lerp(0, 8, i / bars), g = lerp(100, 200, i / bars), b = lerp(200, 80, i / bars);
            ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.9)';
            ctx.fillRect(x + 1, h - barH, barW - 2, barH);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, h * 0.66); ctx.lineTo(w, h * 0.66); ctx.stroke();
    }

    function _animate() { _updateVuGrid(); animationFrameId = pm._requestAnimationFrame(_animate); }

    function _addChatMessage(role, text) {
        var container = pm._el('sim-chat-messages');
        if (!container) return;
        var div = document.createElement('div');
        div.className = 'flex gap-2' + (role === 'user' ? ' flex-row-reverse' : '');
        var avatar = role === 'user' ? '<div class="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">U</div>' : '<div class="w-6 h-6 rounded-full bg-cyan-600/30 border border-cyan-500/30 flex items-center justify-center text-[10px] flex-shrink-0">AI</div>';
        var esc = text.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]});
        var bubble = role === 'user' ? '<div class="bg-cyan-700/40 rounded-xl rounded-tr-none px-3 py-2 text-xs text-slate-100 max-w-[85%]">' + esc + '</div>' : '<div class="bg-slate-800/60 rounded-xl rounded-tl-none px-3 py-2 text-xs text-slate-300 max-w-[85%]">' + esc.replace(/\n/g, '<br>') + '</div>';
        div.innerHTML = avatar + bubble; container.appendChild(div); container.scrollTop = container.scrollHeight;
    }

    function _initSceneButtons() {
        var container = pm._el('scene-buttons');
        if (!container || !window.SimulationService) return;
        var scenes = SimulationService.getScenes();
        Object.entries(scenes).forEach(function (entry) {
            var id = entry[0], scene = entry[1];
            var btn = document.createElement('button');
            btn.className = 'sim-scene-btn w-full text-left p-3 rounded-xl border transition-all text-xs font-bold';
            btn.setAttribute('data-scene', id);
            btn.innerHTML = '<div class="text-sm">' + scene.label + '</div><div class="text-[10px] text-slate-500 mt-1">' + scene.description + '</div>';
            btn.className += (id === 'louvor' ? ' bg-cyan-900/30 border-cyan-500/40 text-cyan-300' : ' bg-slate-800/60 border-white/5 text-slate-300 hover:border-white/20');
            pm._on(btn, 'click', function () { SimulationService.setScene(id); _updateSceneButtons(); _updateAcousticDisplay(); pm._log('sim-log', 'Cen\u00E1rio alterado: ' + scene.label); });
            container.appendChild(btn);
        });
    }

    function _updateSceneButtons() {
        document.querySelectorAll('.sim-scene-btn').forEach(function (btn) {
            var isActive = btn.getAttribute('data-scene') === 'louvor';
            btn.className = 'sim-scene-btn w-full text-left p-3 rounded-xl border transition-all text-xs font-bold ' + (isActive ? 'bg-cyan-900/30 border-cyan-500/40 text-cyan-300' : 'bg-slate-800/60 border-white/5 text-slate-300 hover:border-white/20');
        });
    }

    function _updateSimUI() {
        var running = pm._safeCall('SimulationService', 'isRunning');
        pm._toggleClasses('sim-dot', running ? ['bg-green-500', 'animate-pulse'] : ['bg-slate-600'], running ? ['bg-slate-600'] : ['bg-green-500', 'animate-pulse']);
        pm._setText('sim-status-text', running ? 'ATIVO' : 'PAUSADO');
        pm._toggleClasses('sim-status-text', running ? ['text-green-400'] : ['text-slate-400'], running ? ['text-slate-400'] : ['text-green-400']);
        pm._toggleClasses('btn-sim-start', running ? ['hidden'] : [], running ? [] : ['hidden']);
        pm._toggleClasses('btn-sim-stop', running ? [] : ['hidden'], running ? ['hidden'] : []);
    }

    function _sendChat() {
        var input = pm._el('sim-chat-input');
        if (!input || !window.SimulationService) return;
        var text = input.value.trim(); if (!text) return;
        input.value = ''; _addChatMessage('user', text);
        SimulationService.askAI(text, 1).then(function (res) { _addChatMessage('ai', res.text); if (res.command) pm._log('sim-log', 'Comando gerado: ' + JSON.stringify(res.command)); });
    }

    function init() {
        _buildVuGrid(); _initSceneButtons(); _updateAcousticDisplay(); _updateSimUI();

        pm._on(pm._el('btn-sim-start'), 'click', function () { if (window.SimulationService) { SimulationService.start(); _updateSimUI(); _animate(); _updateAcousticDisplay(); pm._log('sim-log', 'Simula\u00E7\u00E3o iniciada'); SimulationService.askAI('status').then(function (r) { _addChatMessage('ai', r.text); }); } });
        pm._on(pm._el('btn-sim-stop'), 'click', function () { if (window.SimulationService) { SimulationService.stop(); if (animationFrameId) cancelAnimationFrame(animationFrameId); _updateSimUI(); pm._log('sim-log', 'Simula\u00E7\u00E3o pausada', 'warn'); } });
        pm._on(pm._el('btn-sim-reset'), 'click', function () { if (window.SimulationService) { SimulationService.reset(); _buildVuGrid(); _updateAcousticDisplay(); _updateSimUI(); pm._log('sim-log', 'Estado resetado'); } });
        pm._on(pm._el('btn-sim-chat'), 'click', _sendChat);
        pm._on(pm._el('sim-chat-input'), 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); _sendChat(); } });
        pm._on(pm._el('btn-sim-mute'), 'click', function () { var s = SimulationService.getState(); pm._safeCall('SimulationService', 'setMasterMute', !s.master.mute); pm._log('sim-log', 'Master ' + (!s.master.mute ? 'MUTADO' : 'DESMUTADO')); });
        pm._on(pm._el('btn-sim-solo'), 'click', function () { pm._safeCall('SimulationService', 'setChannelMute', 1, true); pm._log('sim-log', 'Canal 1 SOLO'); });
        pm._on(pm._el('sim-fader-ch1'), 'input', function () { pm._safeCall('SimulationService', 'setChannelLevel', 1, parseInt(this.value) / 100); pm._setText('sim-fader-ch1-val', this.value + '%'); });
        pm._on(pm._el('sim-fader-ch2'), 'input', function () { pm._safeCall('SimulationService', 'setChannelLevel', 2, parseInt(this.value) / 100); pm._setText('sim-fader-ch2-val', this.value + '%'); });
        pm._on(pm._el('sim-fader-master'), 'input', function () { pm._safeCall('SimulationService', 'setMasterLevel', parseInt(this.value) / 100); pm._setText('sim-fader-master-val', this.value + '%'); });
        document.querySelectorAll('.sim-cmd-btn').forEach(function (btn) {
            pm._on(btn, 'click', function () {
                var cmd = this.getAttribute('data-cmd'), ch = this.getAttribute('data-ch') || '1', val = this.getAttribute('data-val'), hz = this.getAttribute('data-hz'), gain = this.getAttribute('data-gain');
                switch (cmd) {
                    case 'set_master_level': pm._safeCall('SimulationService', 'setMasterLevel', parseFloat(val)); pm._log('sim-log', 'Master: ' + (parseFloat(val) * 100) + '%'); break;
                    case 'channel_mute': pm._safeCall('SimulationService', 'setChannelMute', parseInt(ch), val === 'true'); pm._log('sim-log', 'Canal ' + ch + (val === 'true' ? ' MUTADO' : ' DESMUTADO')); break;
                    case 'set_channel_level': pm._safeCall('SimulationService', 'setChannelLevel', parseInt(ch), parseFloat(val)); pm._log('sim-log', 'Canal ' + ch + ': ' + (parseFloat(val) * 100) + '%'); break;
                    case 'eq_cut': pm._log('sim-log', 'EQ Corte: ' + hz + 'Hz, ' + gain + 'dB'); break;
                    case 'hpf': pm._log('sim-log', 'HPF Canal ' + ch + ': ' + hz + 'Hz'); break;
                    case 'comp': pm._log('sim-log', 'Compressor Canal ' + ch); break;
                }
            });
        });
    }

    function destroy() { fftCtx = null; pm.destroy(); }

    window.TestbedPage = { init: init, destroy: destroy };
})();
