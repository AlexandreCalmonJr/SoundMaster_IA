/**
 * SoundMaster — MixerPanelUI
 * Responsável EXCLUSIVAMENTE pela manipulação do DOM do painel do mixer (lado direito).
 * Toda lógica de negócio vai para MixerService. Todo estado vai para AppStore.
 *
 * Este módulo:
 *  1. Registra listeners de eventos DOM (botões, sliders, inputs)
 *  2. Assina o AppStore para atualizar a UI quando o estado mudar
 *  3. NUNCA emite eventos Socket.IO diretamente
 */
(function () {
    'use strict';

    let _panelController = null;
    const _socketHandlers = {};

    // -------------------------------------------------------------------------
    // Elementos do DOM
    // -------------------------------------------------------------------------
    const $ = function (id) { return document.getElementById(id); };

    let els = {};
    
    function _getEls() {
        return {
            btnConnect:       $('btn-connect-mixer'),
            btnDisconnect:    $('btn-disconnect-mixer'),
            ipInput:          $('mixer-ip'),
            brandSelect:      $('mixer-brand'),
            iframe:           $('mixer-iframe'),
            placeholder:      $('mixer-placeholder'),
            statusBadge:      $('mixer-status-badge'),
            statusText:       $('mixer-current-status'),
            ipDisplay:        $('mixer-ip-display'),
            masterLevelText:  $('mixer-master-level'),
            masterDbLabel:    $('mixer-master-db'),
            masterSlider:     $('master-volume-slider'),
            masterDown:       $('btn-master-volume-down'),
            masterUp:         $('btn-master-volume-up'),
            logBox:           $('mixer-log'),
            suggestionsList:  $('ai-suggestions-list'),
            quickChannel:     $('quick-channel-number'),
            btnQuickHpf:      $('btn-quick-hpf'),
            btnQuickGate:     $('btn-quick-gate'),
            btnAfsOn:         $('btn-quick-afs-enable'),
            btnAfsOff:        $('btn-quick-afs-disable'),
            tabButtons:       document.querySelectorAll('.mixer-tab-btn'),
            tabSections:      document.querySelectorAll('.mixer-panel-section'),
            btnPinkNoiseMain: $('btn-pink-noise-main'),
            pinkNoiseStatus:  $('pink-noise-status'),
            btnUndo:          $('btn-undo'),
            btnRedo:          $('btn-redo'),
            btnSavePreset:    $('btn-save-preset'),
            presetNameInput:  $('preset-name'),
            presetsList:      $('presets-list'),
            mixBtns:          document.querySelectorAll('.mix-selector-btn-desktop'),
            meterMaster:      $('meter-master'),
            recStatusBadge:   $('rec-status-badge'),
            fxBpmInput:       $('fx-bpm-input'),
            btnSyncBpm:       $('btn-sync-bpm'),
            // Novos
            hwInputNum:       $('hw-input-num'),
            hwGainSlider:     $('hw-gain-slider'),
            hwGainVal:        $('hw-gain-val'),
            hwPhantom:        $('btn-hw-phantom'),
            btnSyncShows:     $('btn-sync-shows'),
            btnNewShow:       $('btn-new-show'),
            nativeShowsList:  $('native-shows-list')
        };
    }

    let currentMix = { type: 'master', id: null };

    // ─── Optimistic UI helpers (T28) ────────────────────────────────────────
    // _lerpTo: anima suavemente o slider do valor local para o valor real da mesa
    // quando o lock expirar, evitando o salto brusco (rubber-banding).
    let _lerpAnimId = null;
    function _lerpTo(slider, targetPct, durationMs = 120) {
        if (!slider) return;
        if (_lerpAnimId) cancelAnimationFrame(_lerpAnimId);
        const startPct = Number(slider.value);
        const delta    = targetPct - startPct;
        if (Math.abs(delta) < 0.5) { slider.value = targetPct; return; }  // diff negligível
        const startTs  = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - startTs) / durationMs);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - t, 3);
            slider.value = String(Math.round(startPct + delta * eased));
            if (t < 1) _lerpAnimId = requestAnimationFrame(step);
            else        _lerpAnimId = null;
        };
        _lerpAnimId = requestAnimationFrame(step);
    }

    // -------------------------------------------------------------------------
    // Helpers de renderização
    // -------------------------------------------------------------------------

    function _renderMixerStatus(connected, msg) {
        if (!els.statusBadge || !els.statusText || !els.btnConnect) return;

        els.statusBadge.classList.toggle('online', connected);
        els.statusBadge.classList.toggle('offline', !connected);
        els.statusBadge.innerText = connected ? 'Conectado' : 'Offline';
        els.statusText.innerText = msg || (connected ? 'Conectado' : 'Offline');
        els.btnConnect.innerText = connected ? 'Atualizar' : 'Conectar';
        els.btnConnect.style.background = connected ? 'var(--success)' : '';
        els.btnConnect.style.color      = connected ? '#000' : '';

        if (els.btnDisconnect) {
            els.btnDisconnect.style.display = 'inline-block';
        }
    }

    function _renderMasterLevel(level, db) {
        const pct = Math.round(_clamp01(level) * 100);
        if (els.masterSlider)    els.masterSlider.value = String(pct);
        if (els.masterLevelText) els.masterLevelText.innerText = pct + '%';
        if (els.masterDbLabel) {
            els.masterDbLabel.innerText = typeof db === 'number'
                ? '(' + db.toFixed(1) + ' dB)'
                : '(-∞ dB)';
        }
    }

    function _renderLog(logs) {
        if (!els.logBox || !Array.isArray(logs)) return;
        els.logBox.innerHTML = '';
        logs.slice().reverse().forEach(function (entry) {
            const div = document.createElement('div');
            div.className = 'mixer-log-entry';
            div.innerText = entry.time + ' — ' + entry.text;
            els.logBox.appendChild(div);
        });
    }

    function _renderAISuggestions(suggestions) {
        if (!els.suggestionsList) return;
        els.suggestionsList.innerHTML = '';

        if (!suggestions || suggestions.length === 0) {
            els.suggestionsList.innerHTML =
                '<div class="mixer-suggestion-item" style="color:var(--text-muted)">Nenhuma sugestão ainda.</div>';
            return;
        }

        suggestions.forEach(function (s) {
            const item = document.createElement('div');
            item.className = 'mixer-suggestion-item';

            const caption = document.createElement('span');
            caption.innerText = s.desc || 'Comando IA';

            const btn = document.createElement('button');
            btn.className = 'mixer-suggestion-btn';
            btn.innerText = 'Executar';
            btn.addEventListener('click', function () {
                MixerService.executeAICommand(s.command);
                btn.innerText = 'Executado ✓';
                btn.disabled = true;
            });

            item.appendChild(caption);
            item.appendChild(btn);
            els.suggestionsList.prepend(item);
        });
    }

    function _clamp01(v) { return Math.min(1, Math.max(0, Number(v) || 0)); }

    function _getQuickChannel() {
        const val = Number(els.quickChannel && els.quickChannel.value);
        if (!Number.isInteger(val) || val < 1 || val > 24) {
            alert('Informe um canal válido entre 1 e 24.');
            return null;
        }
        return val;
    }

    function _renderPresets(presets) {
        if (!els.presetsList) return;
        els.presetsList.innerHTML = '';
        if (!presets || presets.length === 0) {
            els.presetsList.innerHTML = '<div class="mixer-log-entry">Nenhum preset salvo.</div>';
            return;
        }
        presets.forEach(p => {
            const div = document.createElement('div');
            div.className = 'mixer-log-entry';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.innerHTML = '<span>' + p.name.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]}) + ' <small style="color:var(--text-muted)">(' + new Date(p.timestamp).toLocaleTimeString() + ')</small></span>\n                <button class="action-btn primary small" style="padding: 4px 8px;">Carregar</button>';
            div.querySelector('button').onclick = () => MixerService.loadPreset(p._id);
            els.presetsList.appendChild(div);
        });
    }

    // -------------------------------------------------------------------------
    // Tabs do painel do mixer
    // -------------------------------------------------------------------------
    function _initTabs() {
        els.tabButtons.forEach(function (tab) {
            tab.addEventListener('click', function () {
                // Update buttons
                els.tabButtons.forEach(function (b) { 
                    b.classList.remove('active', 'bg-white/10', 'text-white');
                    b.classList.add('text-slate-500');
                });
                tab.classList.add('active', 'bg-white/10', 'text-white');
                tab.classList.remove('text-slate-500');

                // Update sections
                els.tabSections.forEach(function (s) { s.classList.add('hidden'); });
                const target = document.getElementById(tab.getAttribute('data-tab'));
                if (target) target.classList.remove('hidden');
            }, { signal: _panelController.signal });
        });
    }

    // -------------------------------------------------------------------------
    // Listeners de eventos DOM
    // -------------------------------------------------------------------------
    function _initEvents() {
        // Conexão
        els.btnConnect && els.btnConnect.addEventListener('click', function () {
            const ip = els.ipInput ? els.ipInput.value.trim() : '';
            const brand = els.brandSelect ? els.brandSelect.value : 'soundcraft';
            if (!ip) { alert('Insira o IP da mesa.'); return; }

            // Abre iframe (apenas se não for modo simulado interno)
            if (els.placeholder) els.placeholder.style.display = 'none';
            if (els.iframe) {
                els.iframe.style.display = 'block';
                let targetUrl = ip.startsWith('http') ? ip : 'http://' + ip;
                
                // Se for simulação, usa o demo oficial da Soundcraft como visual
                if (ip.toLowerCase() === 'simulado' || ip === '127.0.0.1') {
                    targetUrl = 'https://www.soundcraft.com/ui-demo/mixer.html';
                }
                
                els.iframe.src = targetUrl;
            }
            if (els.ipDisplay) els.ipDisplay.innerText = ip;

            // Navega para aba de interface
            const ifaceTab = document.querySelector('[data-tab="mixer-interface"]');
            if (ifaceTab) ifaceTab.click();

            MixerService.connect(ip, brand);
        }, { signal: _panelController.signal });

        els.btnDisconnect && els.btnDisconnect.addEventListener('click', function () {
            MixerService.disconnect();
        }, { signal: _panelController.signal });



        // Slider master — Optimistic UI (T28)
        // Input: bloqueia updates externos + atualiza UI otimisticamente
        // Change: envia comando à mesa + inicia debounce de unlock
        let _masterDebounce = null;

        els.masterSlider && els.masterSlider.addEventListener('pointerdown', () => {
            const level = Number(els.masterSlider.value) / 100;
            if (window.SocketService) SocketService.lockFader('master', level);
        }, { signal: _panelController.signal });

        els.masterSlider && els.masterSlider.addEventListener('input', function () {
            const level = Number(els.masterSlider.value) / 100;
            // Atualiza UI imediatamente (otimismo)
            if (window.SocketService) SocketService.lockFader('master', level);
            _renderMasterLevel(level, AppStore.getState().masterDb);
        }, { signal: _panelController.signal });

        els.masterSlider && els.masterSlider.addEventListener('change', function () {
            const level = Number(els.masterSlider.value) / 100;
            if (currentMix.type === 'master') {
                MixerService.setMasterLevel(level);
            } else if (currentMix.type === 'aux') {
                const ch = _getQuickChannel();
                if (ch) MixerService.setAuxLevel(ch, currentMix.id, level);
            } else if (currentMix.type === 'fx') {
                const ch = _getQuickChannel();
                if (ch) MixerService.setFxLevel(ch, currentMix.id, level);
            }
            // Debounce: liberta lock 300ms após o utilizador soltar
            clearTimeout(_masterDebounce);
            _masterDebounce = setTimeout(() => {
                if (window.SocketService) SocketService.unlockFader('master');
            }, 300);
        }, { signal: _panelController.signal });

        els.masterSlider && els.masterSlider.addEventListener('pointercancel', () => {
            clearTimeout(_masterDebounce);
            if (window.SocketService) SocketService.unlockFader('master');
        }, { signal: _panelController.signal });

        els.masterSlider && els.masterSlider.addEventListener('pointerleave', () => {
            clearTimeout(_masterDebounce);
            if (window.SocketService) SocketService.unlockFader('master');
        }, { signal: _panelController.signal });

        // Botões +1% / -1%
        els.masterDown && els.masterDown.addEventListener('click', function () {
            MixerService.adjustMasterLevel(-1);
        }, { signal: _panelController.signal });
        els.masterUp && els.masterUp.addEventListener('click', function () {
            MixerService.adjustMasterLevel(1);
        }, { signal: _panelController.signal });

        // Ações rápidas de canal
        els.btnQuickHpf && els.btnQuickHpf.addEventListener('click', function () {
            const ch = _getQuickChannel(); if (ch) MixerService.applyHpf(ch, 100);
        }, { signal: _panelController.signal });

        els.btnQuickGate && els.btnQuickGate.addEventListener('click', function () {
            const ch = _getQuickChannel(); if (ch) MixerService.applyGate(ch);
        }, { signal: _panelController.signal });

        els.btnAfsOn && els.btnAfsOn.addEventListener('click', function () {
            MixerService.setAfs(true);
        }, { signal: _panelController.signal });

        els.btnAfsOff && els.btnAfsOff.addEventListener('click', function () {
            MixerService.setAfs(false);
        }, { signal: _panelController.signal });

        // Ruído Rosa
        let isPinkActive = false;
        els.btnPinkNoiseMain && els.btnPinkNoiseMain.addEventListener('click', function () {
            isPinkActive = !isPinkActive;
            MixerService.setOscillator(isPinkActive);
            els.btnPinkNoiseMain.classList.toggle('active', isPinkActive);
            if (els.pinkNoiseStatus) {
                els.pinkNoiseStatus.innerText = isPinkActive ? 'LIGADO' : 'Desligado';
                els.pinkNoiseStatus.style.color = isPinkActive ? 'var(--accent-primary)' : 'var(--text-muted)';
            }
        }, { signal: _panelController.signal });

        // Undo / Redo
        els.btnUndo && els.btnUndo.addEventListener('click', () => MixerService.undo(), { signal: _panelController.signal });

        // Presets
        els.btnSavePreset && els.btnSavePreset.addEventListener('click', () => {
            const name = els.presetNameInput?.value.trim();
            if (!name) { alert('Dê um nome ao preset!'); return; }
            MixerService.savePreset(name);
            if (els.presetNameInput) els.presetNameInput.value = '';
        }, { signal: _panelController.signal });

        const presetsTab = document.querySelector('[data-tab="mixer-presets"]');
        presetsTab?.addEventListener('click', () => MixerService.listPresets(), { signal: _panelController.signal });

        // Mix Selector
        els.mixBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                els.mixBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentMix.type = btn.getAttribute('data-mix-type');
                currentMix.id = btn.getAttribute('data-mix-id');
                AppStore.addLog(`Mix Desktop alterado para: ${currentMix.type.toUpperCase()} ${currentMix.id || ''}`);
            }, { signal: _panelController.signal });
        });

        // BPM Control
        els.fxBpmInput && els.fxBpmInput.addEventListener('change', function() {
            const bpm = parseInt(els.fxBpmInput.value);
            MixerService.setFxBpm(1, bpm); // Ajusta o FX 1 por padrão
        }, { signal: _panelController.signal });

        // TAP BPM
        els.btnSyncBpm && els.btnSyncBpm.addEventListener('click', function() {
            const current = parseInt(els.fxBpmInput.value) || 120;
            const next = current > 140 ? 120 : current + 8;
            els.fxBpmInput.value = next;
            MixerService.setFxBpm(1, next);
        }, { signal: _panelController.signal });

        // ✅ Novo: Mute Groups
        document.querySelectorAll('.mute-group-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const groupId = btn.dataset.group;
                const isActive = btn.classList.contains('active');
                SocketService.emit('mute_group', { groupId: groupId, enabled: isActive ? 0 : 1 });
                AppStore.addLog('Mute Group ' + groupId + ': ' + (isActive ? 'OFF' : 'ON'));
                btn.classList.toggle('active', !isActive);
                btn.classList.toggle('bg-red-600', !isActive && groupId === 'all');
                btn.classList.toggle('bg-cyan-600', !isActive && groupId !== 'all');
            }, { signal: _panelController.signal });
        });

        // ✅ Novo: Hardware Gain
        els.hwGainSlider?.addEventListener('input', (e) => {
            const val = e.target.value;
            if (els.hwGainVal) els.hwGainVal.innerText = val + '%';
            MixerService.setHwGain(els.hwInputNum.value, val / 100);
        }, { signal: _panelController.signal });

        // ✅ Novo: Phantom Power
        els.hwPhantom?.addEventListener('change', (e) => {
            MixerService.setPhantomPower(els.hwInputNum.value, e.target.checked);
        }, { signal: _panelController.signal });

        // ✅ Novo: Shows & Snapshots
        els.btnSyncShows?.addEventListener('click', () => {
            MixerService.showControl('list');
            els.btnSyncShows.innerText = '⌛...';
        }, { signal: _panelController.signal });

        els.btnNewShow?.addEventListener('click', () => {
            const name = prompt('Nome do novo Show:');
            if (name) MixerService.showControl('save', name);
        }, { signal: _panelController.signal });

        // Esconde botão desconectar inicialmente
        if (els.btnDisconnect) els.btnDisconnect.style.display = 'none';
    }

    // -------------------------------------------------------------------------
    // Subscriptions no AppStore
    // -------------------------------------------------------------------------
    function _initSubscriptions() {
        AppStore.subscribe('mixerConnected', function (connected) {
            _renderMixerStatus(connected, AppStore.getState().mixerStatusMsg);
        });

        AppStore.subscribe('mixerStatusMsg', function (msg) {
            _renderMixerStatus(AppStore.getState().mixerConnected, msg);
        });

        AppStore.subscribe('masterLevel', function (level) {
            if (window.SocketService && SocketService.isFaderLocked('master')) return;
            const targetPct = Math.round(_clamp01(level) * 100);
            _lerpTo(els.masterSlider, targetPct);
            _renderMasterLevel(level, AppStore.getState().masterDb);
        });

        AppStore.subscribe('masterDb', function (db) {
            _renderMasterLevel(AppStore.getState().masterLevel, db);
        });

        AppStore.subscribe('mixerLog', function (logs) {
            _renderLog(logs);
        });

        AppStore.subscribe('aiSuggestions', function (suggestions) {
            _renderAISuggestions(suggestions);
        });

        AppStore.subscribe('vuData', function (data) {
            if (data && data.master && els.meterMaster) {
                // ✅ Correção Auditoria: Usar escala logarítmica (dB) para altura do VU
                const height = MixerService.vuToHeight(data.master.vuPostFader || 0);
                els.meterMaster.style.height = height + '%';
            }
            if (data && data.channels) {
                for (let i = 1; i <= 24; i++) {
                    const meter = document.getElementById(`meter-ch-${i}`);
                    if (meter) {
                        const chData = data.channels[i];
                        if (chData) {
                            // ✅ Correção Auditoria: Usar escala logarítmica (dB)
                            const height = MixerService.vuToHeight(chData.vuPostFader || 0);
                            meter.style.height = height + '%';
                        }
                    }
                }
            }
        });

        AppStore.subscribe('recording', function (isRecording) {
            if (els.recStatusBadge) {
                els.recStatusBadge.classList.toggle('hidden', !isRecording);
            }
        });

        _socketHandlers.presets_list = (presets) => _renderPresets(presets);
        _socketHandlers.preset_saved = () => MixerService.listPresets();
        SocketService.on('presets_list', _socketHandlers.presets_list);
        SocketService.on('preset_saved', _socketHandlers.preset_saved);
    }

    // -------------------------------------------------------------------------
    // Init
    // -------------------------------------------------------------------------
    function destroy() {
        if (_panelController) {
            _panelController.abort();
            _panelController = null;
        }
        Object.keys(_socketHandlers).forEach(function (event) {
            SocketService.off(event, _socketHandlers[event]);
        });
    }

    function init() {
        if (_panelController) _panelController.abort();
        _panelController = new AbortController();

        els = _getEls();
        _initTabs();
        _initEvents();
        _initSubscriptions();
    }

    window.SoundMasterMixerPanel = { init, destroy };
})();
