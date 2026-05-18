'use strict';
(function () {
    var NUM_CH = 12;
    var animationFrameId = null;
    var fftCtx = null;
    var _listeners = [];

    function _on(target, event, handler) {
        if (!target) return;
        target.addEventListener(event, handler);
        _listeners.push({ target, event, handler });
    }

    function _log(msg, type) {
        var el = document.getElementById('sim-log');
        if (!el) return;
        var time = new Date().toLocaleTimeString('pt-BR');
        var color = type === 'error' ? 'text-red-400' : type === 'warn' ? 'text-amber-400' : 'text-green-400';
        el.innerHTML += '<div class="' + color + '">[' + time + '] ' + msg + '</div>';
        el.scrollTop = el.scrollHeight;
    }

    function _lerp(a, b, t) { return a + (b - a) * t; }

    function _buildVuGrid() {
        var grid = document.getElementById('sim-vu-grid');
        if (!grid) return;
        grid.innerHTML = '';
        for (var i = 1; i <= NUM_CH; i++) {
            var div = document.createElement('div');
            div.className = 'flex flex-col items-center gap-1';
            div.innerHTML =
                '<div class="text-[9px] text-slate-600 font-mono">' + i + '</div>' +
                '<div class="w-full h-24 bg-black/40 rounded-lg overflow-hidden relative flex flex-col justify-end" id="sim-ch-vu-' + i + '">' +
                '<div class="sim-vu-bar w-full bg-cyan-500/70 transition-all" style="height:0%"></div>' +
                '<div class="sim-vu-peak absolute left-0 right-0 h-0.5 bg-red-500 transition-all" style="bottom:0%"></div>' +
                '</div>' +
                '<div class="sim-vu-label text-[9px] text-slate-600 font-mono">-∞</div>';
            grid.appendChild(div);
        }
    }

    function _updateVuGrid() {
        if (!window.SimulationService || !SimulationService.isRunning()) return;
        var s = SimulationService.getState();
        for (var i = 1; i <= NUM_CH; i++) {
            var ch = s.channels ? s.channels[i - 1] : null;
            if (!ch) continue;
            var vu = ch.vu;
            var pct = Math.max(0, ((vu + 80) / 80) * 100);
            var container = document.getElementById('sim-ch-vu-' + i);
            if (!container) continue;
            var bar = container.querySelector('.sim-vu-bar');
            var peak = container.querySelector('.sim-vu-peak');
            var label = container.parentElement.querySelector('.sim-vu-label');
            if (bar) bar.style.height = pct + '%';
            if (peak) peak.style.bottom = Math.max(0, ((ch.vuPeak + 80) / 80) * 100) + '%';
            if (label) label.textContent = vu > -60 ? vu.toFixed(1) + 'dB' : '-∞';
        }
        var masterPct = s.master ? s.master.level * 100 : 0;
        var masterBar = document.getElementById('sim-master-bar');
        var masterLabel = document.getElementById('sim-master-label');
        if (masterBar) masterBar.style.width = masterPct + '%';
        if (masterLabel) masterLabel.textContent = (s.master && s.master.mute) ? 'MUTE' : Math.round((s.master.level - 1) * 100) + 'dB';
    }

    function _updateAcousticDisplay() {
        if (!window.SimulationService) return;
        var a = SimulationService.getFakeAnalysis();
        var rt60El = document.getElementById('sim-rt60');
        var stiEl = document.getElementById('sim-sti');
        var c50El = document.getElementById('sim-c50');
        var peakEl = document.getElementById('sim-peak');
        if (rt60El) rt60El.textContent = a.rt60.toFixed(2);
        if (stiEl) stiEl.textContent = a.sti.toFixed(2);
        if (c50El) c50El.textContent = a.c50.toFixed(1);
        if (peakEl) peakEl.textContent = a.peakHz > 0 ? a.peakHz + 'Hz' : '--';
        _drawFft(a.spectrum_db);
    }

    function _drawFft(spectrumData) {
        var canvas = document.getElementById('sim-fft-canvas');
        if (!canvas) return;
        if (!fftCtx) fftCtx = canvas.getContext('2d');
        var ctx = fftCtx;
        var w = canvas.width, h = canvas.height;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, w, h);
        if (!spectrumData || spectrumData.length === 0) return;
        var bars = spectrumData.length;
        var barW = w / bars;
        for (var i = 0; i < bars; i++) {
            var db = spectrumData[i] || 0;
            var barH = Math.max(2, ((db + 30) / 30) * h);
            var x = i * barW;
            var r = Math.round(_lerp(0, 8, i / bars));
            var g = Math.round(_lerp(100, 200, i / bars));
            var b = Math.round(_lerp(200, 80, i / bars));
            ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',0.9)';
            ctx.fillRect(x + 1, h - barH, barW - 2, barH);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(0, h * 0.66);
        ctx.lineTo(w, h * 0.66);
        ctx.stroke();
    }

    function _animate() {
        _updateVuGrid();
        animationFrameId = requestAnimationFrame(_animate);
    }

    function _addChatMessage(role, text) {
        var container = document.getElementById('sim-chat-messages');
        if (!container) return;
        var div = document.createElement('div');
        div.className = 'flex gap-2' + (role === 'user' ? ' flex-row-reverse' : '');
        var avatar = role === 'user'
            ? '<div class="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-[10px] font-bold flex-shrink-0">U</div>'
            : '<div class="w-6 h-6 rounded-full bg-cyan-600/30 border border-cyan-500/30 flex items-center justify-center text-[10px] flex-shrink-0">AI</div>';
        var bubble = role === 'user'
            ? '<div class="bg-cyan-700/40 rounded-xl rounded-tr-none px-3 py-2 text-xs text-slate-100 max-w-[85%]">' + text + '</div>'
            : '<div class="bg-slate-800/60 rounded-xl rounded-tl-none px-3 py-2 text-xs text-slate-300 max-w-[85%]">' + text.replace(/\n/g, '<br>') + '</div>';
        div.innerHTML = avatar + bubble;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function _initSceneButtons() {
        var container = document.getElementById('scene-buttons');
        if (!container || !window.SimulationService) return;
        var scenes = SimulationService.getScenes();
        Object.entries(scenes).forEach(function (entry) {
            var id = entry[0], scene = entry[1];
            var btn = document.createElement('button');
            btn.className = 'sim-scene-btn w-full text-left p-3 rounded-xl border transition-all text-xs font-bold';
            btn.setAttribute('data-scene', id);
            btn.innerHTML = '<div class="text-sm">' + scene.label + '</div><div class="text-[10px] text-slate-500 mt-1">' + scene.description + '</div>';
            if (id === 'louvor') {
                btn.className += ' bg-cyan-900/30 border-cyan-500/40 text-cyan-300';
            } else {
                btn.className += ' bg-slate-800/60 border-white/5 text-slate-300 hover:border-white/20';
            }
            _on(btn, 'click', function () {
                SimulationService.setScene(id);
                _updateSceneButtons();
                _updateAcousticDisplay();
                _log('Cenário alterado: ' + scene.label);
            });
            container.appendChild(btn);
        });
    }

    function _updateSceneButtons() {
        document.querySelectorAll('.sim-scene-btn').forEach(function (btn) {
            var isActive = btn.getAttribute('data-scene') === 'louvor';
            if (isActive) {
                btn.className = 'sim-scene-btn w-full text-left p-3 rounded-xl border transition-all text-xs font-bold bg-cyan-900/30 border-cyan-500/40 text-cyan-300';
            } else {
                btn.className = 'sim-scene-btn w-full text-left p-3 rounded-xl border transition-all text-xs font-bold bg-slate-800/60 border-white/5 text-slate-300 hover:border-white/20';
            }
        });
    }

    function _updateSimUI() {
        if (!window.SimulationService) return;
        var running = SimulationService.isRunning();
        var dot = document.getElementById('sim-dot');
        var text = document.getElementById('sim-status-text');
        var startBtn = document.getElementById('btn-sim-start');
        var stopBtn = document.getElementById('btn-sim-stop');
        if (running) {
            if (dot) { dot.className = 'w-3 h-3 rounded-full bg-green-500 animate-pulse'; }
            if (text) { text.textContent = 'ATIVO'; text.className = 'text-xs font-bold text-green-400'; }
            if (startBtn) startBtn.classList.add('hidden');
            if (stopBtn) stopBtn.classList.remove('hidden');
        } else {
            if (dot) { dot.className = 'w-3 h-3 rounded-full bg-slate-600'; }
            if (text) { text.textContent = 'PAUSADO'; text.className = 'text-xs font-bold text-slate-400'; }
            if (startBtn) startBtn.classList.remove('hidden');
            if (stopBtn) stopBtn.classList.add('hidden');
        }
    }

    function _sendChat() {
        var input = document.getElementById('sim-chat-input');
        if (!input || !window.SimulationService) return;
        var text = input.value.trim();
        if (!text) return;
        input.value = '';
        _addChatMessage('user', text);
        SimulationService.askAI(text, 1).then(function (res) {
            _addChatMessage('ai', res.text);
            if (res.command) _log('Comando gerado: ' + JSON.stringify(res.command), 'info');
        });
    }

    function init() {
        _buildVuGrid();
        _initSceneButtons();
        _updateAcousticDisplay();
        _updateSimUI();

        _on(document.getElementById('btn-sim-start'), 'click', function () {
            if (window.SimulationService) {
                SimulationService.start();
                _updateSimUI();
                _animate();
                _updateAcousticDisplay();
                _log('Simulação iniciada', 'info');
                SimulationService.askAI('status').then(function (r) { _addChatMessage('ai', r.text); });
            }
        });

        _on(document.getElementById('btn-sim-stop'), 'click', function () {
            if (window.SimulationService) {
                SimulationService.stop();
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                _updateSimUI();
                _log('Simulação pausada', 'warn');
            }
        });

        _on(document.getElementById('btn-sim-reset'), 'click', function () {
            if (window.SimulationService) {
                SimulationService.reset();
                _buildVuGrid();
                _updateAcousticDisplay();
                _updateSimUI();
                _log('Estado resetado', 'info');
            }
        });

        _on(document.getElementById('btn-sim-chat'), 'click', _sendChat);

        _on(document.getElementById('sim-chat-input'), 'keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); _sendChat(); }
        });

        _on(document.getElementById('btn-sim-mute'), 'click', function () {
            if (window.SimulationService) {
                var s = SimulationService.getState();
                SimulationService.setMasterMute(!s.master.mute);
                _log('Master ' + (!s.master.mute ? 'MUTADO' : 'DESMUTADO'), 'info');
            }
        });

        _on(document.getElementById('btn-sim-solo'), 'click', function () {
            if (window.SimulationService) {
                SimulationService.setChannelMute(1, true);
                _log('Canal 1 SOLO', 'info');
            }
        });

        _on(document.getElementById('sim-fader-ch1'), 'input', function () {
            if (window.SimulationService) {
                var val = parseInt(this.value) / 100;
                SimulationService.setChannelLevel(1, val);
                var valEl = document.getElementById('sim-fader-ch1-val');
                if (valEl) valEl.textContent = this.value + '%';
            }
        });

        _on(document.getElementById('sim-fader-ch2'), 'input', function () {
            if (window.SimulationService) {
                var val = parseInt(this.value) / 100;
                SimulationService.setChannelLevel(2, val);
                var valEl = document.getElementById('sim-fader-ch2-val');
                if (valEl) valEl.textContent = this.value + '%';
            }
        });

        _on(document.getElementById('sim-fader-master'), 'input', function () {
            if (window.SimulationService) {
                var val = parseInt(this.value) / 100;
                SimulationService.setMasterLevel(val);
                var valEl = document.getElementById('sim-fader-master-val');
                if (valEl) valEl.textContent = this.value + '%';
            }
        });

        document.querySelectorAll('.sim-cmd-btn').forEach(function (btn) {
            _on(btn, 'click', function () {
                if (!window.SimulationService) return;
                var cmd = this.getAttribute('data-cmd');
                var ch = this.getAttribute('data-ch') || '1';
                var val = this.getAttribute('data-val');
                var hz = this.getAttribute('data-hz');
                var gain = this.getAttribute('data-gain');
                switch (cmd) {
                    case 'set_master_level': SimulationService.setMasterLevel(parseFloat(val)); _log('Master: ' + (parseFloat(val) * 100) + '%'); break;
                    case 'channel_mute': SimulationService.setChannelMute(parseInt(ch), val === 'true'); _log('Canal ' + ch + (val === 'true' ? ' MUTADO' : ' DESMUTADO')); break;
                    case 'set_channel_level': SimulationService.setChannelLevel(parseInt(ch), parseFloat(val)); _log('Canal ' + ch + ': ' + (parseFloat(val) * 100) + '%'); break;
                    case 'eq_cut': _log('EQ Corte: ' + hz + 'Hz, ' + gain + 'dB'); break;
                    case 'hpf': _log('HPF Canal ' + ch + ': ' + hz + 'Hz'); break;
                    case 'comp': _log('Compressor Canal ' + ch); break;
                }
            });
        });
    }

    function destroy() {
        _listeners.forEach(function (l) { l.target.removeEventListener(l.event, l.handler); });
        _listeners = [];
        if (animationFrameId) { cancelAnimationFrame(animationFrameId); animationFrameId = null; }
        fftCtx = null;
    }

    window.TestbedPage = { init: init, destroy: destroy };
})();
