'use strict';
(function () {
    var pm = createPageModule();
    var esc = function (s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    var NUM_CHANNELS = 16;
    var channelState = {};
    var groupAssignments = { a: new Set(), b: new Set() };

    function _buildChannelGrid() {
        var grid = pm._el('am-channels-grid');
        if (!grid) return;
        grid.innerHTML = '';
        for (var i = 1; i <= NUM_CHANNELS; i++) {
            channelState[i] = { enabled: false, group: 'none', weight: 0.5, reduction: 0 };
            var card = document.createElement('div');
            card.className = 'am-channel-card bg-slate-900/50 border border-white/5 rounded-xl p-3 flex flex-col items-center gap-2 transition-all cursor-pointer hover:border-white/15';
            card.id = 'am-ch-' + i;
            card.innerHTML = '<div class="w-8 h-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-xs font-bold text-slate-400" data-ch="' + i + '">' + i + '</div>' + '<div class="w-full h-16 bg-black/30 rounded-lg overflow-hidden relative flex flex-col justify-end" title="Redu\u00E7\u00E3o de ganho">' + '<div class="am-reduction-bar absolute inset-0 bg-red-500/0 transition-all" style="width:0%"></div>' + '<div class="am-level-fill w-full bg-cyan-500/60 transition-all" style="height:0%"></div>' + '</div>' + '<div class="w-full flex gap-1 justify-center">' + '<button class="am-group-btn w-6 h-6 rounded text-[8px] font-bold border border-slate-600 bg-slate-800 text-slate-500 hover:bg-cyan-900/50 hover:border-cyan-500/50 hover:text-cyan-400 transition-all" data-ch="' + i + '" data-group="a" title="Grupo A">A</button>' + '<button class="am-group-btn w-6 h-6 rounded text-[8px] font-bold border border-slate-600 bg-slate-800 text-slate-500 hover:bg-emerald-900/50 hover:border-emerald-500/50 hover:text-emerald-400 transition-all" data-ch="' + i + '" data-group="b" title="Grupo B">B</button>' + '</div>' + '<div class="w-full"><input type="range" class="am-weight-slider w-full h-1 bg-slate-700 rounded-full appearance-none cursor-pointer accent-cyan-500" data-ch="' + i + '" min="0" max="100" value="50"></div>' + '<div class="am-reduction-text text-[9px] text-slate-600 font-mono">0dB</div>';
            (function (ch) {
                pm._on(card, 'click', function (e) {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
                    _toggleChannel(ch);
                });
            })(i);
            grid.appendChild(card);
        }
    }

    function _buildGroups() {
        var container = pm._el('am-groups');
        if (!container) return;
        container.innerHTML = '';
        ['a', 'b'].forEach(function (g) {
            var group = document.createElement('div');
            group.className = 'bg-slate-900/50 border border-white/5 rounded-xl p-4';
            group.innerHTML = '<div class="flex items-center justify-between mb-3">' + '<span class="text-sm font-bold text-' + (g === 'a' ? 'cyan' : 'emerald') + '-400">Grupo ' + g.toUpperCase() + '</span>' + '<button class="am-activate-group text-[10px] font-bold px-3 py-1 rounded-lg bg-' + (g === 'a' ? 'cyan' : 'emerald') + '-900/30 border border-' + (g === 'a' ? 'cyan' : 'emerald') + '-500/30 text-' + (g === 'a' ? 'cyan' : 'emerald') + '-400 hover:bg-' + (g === 'a' ? 'cyan' : 'emerald') + '-900/50 transition-all" data-group="' + g + '">Ativar Canais</button>' + '</div>' + '<div class="text-xs text-slate-500 mb-2">Canais: <span id="am-group-' + g + '-ch-list" class="text-slate-300">nenhum</span></div>' + '<div class="text-xs text-slate-500">Total de redu\u00E7\u00E3o: <span id="am-group-' + g + '-total-reduction" class="text-red-400 font-mono">0dB</span></div>';
            container.appendChild(group);
        });
        document.querySelectorAll('.am-activate-group').forEach(function (btn) {
            pm._on(btn, 'click', function () {
                var g = this.getAttribute('data-group');
                var enabled = groupAssignments[g].size > 0;
                groupAssignments[g].forEach(function (ch) { channelState[ch].enabled = !enabled; });
                _updateChannelStates();
                _sendAutomixUpdate();
            });
        });
    }

    function _toggleChannel(ch) { channelState[ch].enabled = !channelState[ch].enabled; _updateChannelStates(); _sendAutomixUpdate(); }

    function _assignChannelGroup(ch, group) {
        if (channelState[ch].group === group) { channelState[ch].group = 'none'; groupAssignments.a.delete(ch); groupAssignments.b.delete(ch); }
        else { channelState[ch].group = group; groupAssignments.a.delete(ch); groupAssignments.b.delete(ch); groupAssignments[group].add(ch); }
        _updateChannelStates(); _sendAutomixUpdate();
    }

    function _updateChannelStates() {
        for (var i = 1; i <= NUM_CHANNELS; i++) {
            var s = channelState[i];
            var card = pm._el('am-ch-' + i);
            if (!card) continue;
            card.classList.toggle('am-enabled', s.enabled);
            if (s.enabled) card.classList.add('border-cyan-500/30'); else card.classList.remove('border-cyan-500/30');
            document.querySelectorAll('.am-group-btn').forEach(function (btn) {
                if (parseInt(btn.getAttribute('data-ch')) === i) {
                    var g = btn.getAttribute('data-group');
                    var isActive = s.group === g;
                    btn.style.backgroundColor = isActive ? (g === 'a' ? 'rgba(8,145,178,0.3)' : 'rgba(5,150,105,0.3)') : '';
                    btn.style.borderColor = isActive ? (g === 'a' ? '#06b6d4' : '#10b981') : '';
                    btn.style.color = isActive ? (g === 'a' ? '#22d3ee' : '#34d399') : '';
                }
            });
            var reduction = s.enabled ? (1 - s.weight) * 20 : 0;
            var bar = card.querySelector('.am-reduction-bar');
            var text = card.querySelector('.am-reduction-text');
            if (bar) bar.style.height = reduction + '%';
            if (text) text.textContent = '-' + reduction.toFixed(1) + 'dB';
        }
        _updateGroupDisplays();
    }

    function _updateGroupDisplays() {
        ['a', 'b'].forEach(function (g) {
            var list = Array.from(groupAssignments[g]).join(', ') || 'nenhum';
            pm._setText('am-group-' + g + '-ch-list', list);
        });
    }

    function _sendAutomixUpdate() {
        if (!window.MixerService) return;
        var response = parseInt(pm._el('am-response') ? pm._el('am-response').value : 500);
        pm._safeCall('MixerService', 'automixControl', 'set_response', response);
        for (var i = 1; i <= NUM_CHANNELS; i++) {
            var s = channelState[i];
            var grp = (s.group !== 'none' && s.enabled) ? s.group : 'none';
            var w = (s.group !== 'none' && s.enabled) ? s.weight : 0.5;
            pm._safeCall('SocketService', 'emit', 'automix_assign', { channel: i, group: grp, weight: w });
        }
    }

    function _toggleGroup(group) {
        var btn = pm._el('am-toggle-' + group);
        var dot = pm._el('am-' + group + '-dot');
        if (!btn) return;
        var isActive = btn.classList.contains('active');
        if (isActive) { btn.classList.remove('active'); btn.style.backgroundColor = ''; if (dot) { dot.classList.remove('bg-green-500'); dot.classList.add('bg-slate-600'); } }
        else { btn.classList.add('active'); btn.style.backgroundColor = group === 'a' ? 'rgba(6,182,212,0.3)' : 'rgba(16,185,129,0.3)'; if (dot) { dot.classList.remove('bg-slate-600'); dot.classList.add('bg-green-500'); } }
        pm._safeCall('MixerService', 'automixControl', isActive ? 'disable_' + group : 'enable_' + group, null);
    }

    function init() {
        _buildChannelGrid(); _buildGroups();
        pm._on(pm._el('am-toggle-a'), 'click', function () { _toggleGroup('a'); });
        pm._on(pm._el('am-toggle-b'), 'click', function () { _toggleGroup('b'); });
        pm._on(pm._el('am-response'), 'input', function () { pm._setText('am-response-val', parseInt(this.value) + 'ms'); _sendAutomixUpdate(); });
        pm._on(pm._el('am-master-weight'), 'input', function () { pm._setText('am-master-weight-val', this.value + '%'); });
        document.querySelectorAll('.am-group-btn').forEach(function (btn) { pm._on(btn, 'click', function () { _assignChannelGroup(parseInt(this.getAttribute('data-ch')), this.getAttribute('data-group')); }); });
        document.querySelectorAll('.am-weight-slider').forEach(function (slider) { pm._on(slider, 'input', function () { channelState[parseInt(this.getAttribute('data-ch'))].weight = parseInt(this.value) / 100; _updateChannelStates(); _sendAutomixUpdate(); }); });
        pm._on(pm._el('am-activate-all'), 'click', function () { for (var i = 1; i <= NUM_CHANNELS; i++) channelState[i].enabled = true; _updateChannelStates(); _sendAutomixUpdate(); });
        pm._on(pm._el('am-deactivate-all'), 'click', function () { for (var i = 1; i <= NUM_CHANNELS; i++) channelState[i].enabled = false; _updateChannelStates(); _sendAutomixUpdate(); });
        pm._on(pm._el('am-reset'), 'click', function () { for (var i = 1; i <= NUM_CHANNELS; i++) { channelState[i].weight = 0.5; channelState[i].reduction = 0; var slider = document.querySelector('.am-weight-slider[data-ch="' + i + '"]'); if (slider) slider.value = 50; } _updateChannelStates(); _sendAutomixUpdate(); });
        _updateChannelStates();
    }

    function destroy() { pm.destroy(); channelState = {}; groupAssignments = { a: new Set(), b: new Set() }; }

    window.AutomixerPage = { init: init, destroy: destroy };
})();

