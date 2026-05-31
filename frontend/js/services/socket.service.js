/**
 * SoundMaster — SocketService v2 (Resilient)
 * ============================================
 * T26: Reconexão Passiva + Reconciliação de Estado (Offline Queue)
 * T28: Optimistic UI — registo de locks de fader para rubber-band fix
 */
(function () {
    'use strict';

    let _socket = null;
    let _initialized = false;

    // ─── Offline Command Queue (T26) ─────────────────────────────────────────
    const _offlineQueue = [];
    const MAX_QUEUE_SIZE = 100;
    let   _isOnline      = false;
    let   _reconnectTs   = null;

    // ─── Optimistic UI Lock Registry (T28) ───────────────────────────────────
    const _faderLocks    = new Map();
    const LOCK_DURATION_MS = 300;

    // ─── Toast não intrusivo ──────────────────────────────────────────────────
    let _toastEl = null;
    function _showToast(msg, type = 'warn') {
        if (!_toastEl) {
            _toastEl = document.createElement('div');
            _toastEl.id = 'sm-reconnect-toast';
            Object.assign(_toastEl.style, {
                position: 'fixed', bottom: '20px', left: '50%',
                transform: 'translateX(-50%) translateY(80px)',
                color: '#fff', padding: '8px 20px', borderRadius: '999px',
                fontSize: '12px', fontWeight: '700', fontFamily: 'Inter,sans-serif',
                zIndex: '99999', transition: 'transform .3s cubic-bezier(.34,1.56,.64,1)',
                pointerEvents: 'none', backdropFilter: 'blur(8px)',
                boxShadow: '0 4px 24px rgba(0,0,0,.4)',
            });
            document.body.appendChild(_toastEl);
        }
        _toastEl.textContent = msg;
        _toastEl.style.background = type === 'ok'
            ? 'rgba(16,185,129,.92)'
            : type === 'err'
            ? 'rgba(239,68,68,.92)'
            : 'rgba(245,158,11,.92)';
        _toastEl.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(_toastEl._timer);
        _toastEl._timer = setTimeout(() => {
            if (_toastEl) _toastEl.style.transform = 'translateX(-50%) translateY(80px)';
        }, 3000);
    }

    // ─── Flush da fila offline ────────────────────────────────────────────────
    function _flushQueue() {
        if (!_socket || !_isOnline || _offlineQueue.length === 0) return;
        console.log(`[SocketService] Flushing ${_offlineQueue.length} comando(s) offline...`);
        _offlineQueue.splice(0).forEach(({ event, data }) => _socket.emit(event, data));
    }

    // ─── Emit com suporte a fila offline ─────────────────────────────────────
    function emit(event, data) {
        if (!_socket) {
            console.warn('[SocketService] Socket não inicializado.');
            return false;
        }
        if (!_isOnline) {
            if (_offlineQueue.length < MAX_QUEUE_SIZE) {
                _offlineQueue.push({ event, data, ts: Date.now() });
                console.log(`[SocketService] Offline. Enfileirado: ${event} (fila: ${_offlineQueue.length})`);
            }
            return false;
        }
        _socket.emit(event, data);
        return true;
    }

    // ─── Optimistic UI helpers (T28) ─────────────────────────────────────────

    function lockFader(channelKey, localValue) {
        _faderLocks.set(channelKey, {
            lockedUntil: Date.now() + LOCK_DURATION_MS,
            localValue,
        });
    }

    function isFaderLocked(channelKey) {
        const lock = _faderLocks.get(channelKey);
        if (!lock) return false;
        if (Date.now() > lock.lockedUntil) { _faderLocks.delete(channelKey); return false; }
        return true;
    }

    function unlockFader(channelKey) { _faderLocks.delete(channelKey); }

    const _pendingListeners = [];

    // ─── Inicialização ────────────────────────────────────────────────────────
    function init() {
        if (_initialized) return;
        _initialized = true;

        if (typeof io === 'undefined') {
            console.warn('[SocketService] socket.io não disponível.');
            return;
        }

        _socket = io({
            reconnection:         true,
            reconnectionAttempts: Infinity,
            reconnectionDelay:    1000,
            reconnectionDelayMax: 10000,
            randomizationFactor:  0.4,
        });

        _pendingListeners.forEach(item => {
            _socket.on(item.event, item.cb);
        });
        _pendingListeners.length = 0;

        _socket.on('connect', () => {
            _isOnline = true;
            AppStore.addLog('✅ Conectado ao servidor.');
            _socket.emit('get_ai_status');

            if (_reconnectTs !== null) {
                const secondsOffline = Math.round((Date.now() - _reconnectTs) / 1000);
                _reconnectTs = null;
                _showToast('✅ Reconectado!', 'ok');
                _flushQueue();
                const deltaWindow = Math.max(10, secondsOffline + 2);
                _socket.emit('request_state_delta', { windowSecs: deltaWindow });
                AppStore.addLog(`♻️ Delta solicitado: últimos ${secondsOffline}s.`);
            }
        });

        _socket.on('disconnect', (reason) => {
            _isOnline    = false;
            _reconnectTs = Date.now();
            AppStore.setState({ mixerConnected: false, mixerStatusMsg: 'Reconectando...' });
            AppStore.addLog(`⚠️ Desconectado: ${reason}`);
            _showToast('⚠️ Sincronizando...', 'warn');
        });

        _socket.on('connect_error', (err) => {
            console.warn('[SocketService] Erro de conexão:', err.message);
        });

        _socket.on('mixer_status', (data) => {
            AppStore.setState({
                mixerConnected: !!data.connected,
                mixerStatusMsg: data.msg || (data.connected ? 'Conectado' : 'Offline')
            });
            if (data.msg) AppStore.addLog(data.msg);
        });

        _socket.on('master_level', (data) => {
            var level = data instanceof ArrayBuffer ? BinaryCodec.decodeMasterLevel(data) : data;
            if (!isFaderLocked('master')) AppStore.setState({ masterLevel: level });
        });

        _socket.on('master_level_db',  (data) => {
            var db = data instanceof ArrayBuffer ? BinaryCodec.decodeMasterLevelDb(data) : data;
            AppStore.setState({ masterDb: db });
        });
        _socket.on('vu_data',          (data) => {
            var vuData = data instanceof ArrayBuffer ? BinaryCodec.decodeVuData(data) : data;
            AppStore.setState({ vuData: vuData });
        });
        _socket.on('recorder_status',  (data) => AppStore.setState({ recording: !!data.recording, mtkRecording: !!data.mtkRecording }));
        _socket.on('device_info',      (info) => {
            const current = AppStore.getState().deviceInfo || {};
            AppStore.setState({ deviceInfo: Object.assign({}, current, info) });
        });
        _socket.on('player_status',    (data) => AppStore.setState({ playerState: data.state }));
        _socket.on('player_track',     (data) => AppStore.setState({ playerTrack: data.track }));
        _socket.on('show_status',      (data) => AppStore.setState({ currentShow: data.show }));
        _socket.on('snapshot_status',  (data) => AppStore.setState({ currentSnapshot: data.snapshot }));
        _socket.on('cue_status',       (data) => AppStore.setState({ currentCue: data.cue }));
        _socket.on('ai_status', (data) => {
            AppStore.setState({
                aiAvailable: !!data.available,
                liteMode: !!data.lite
            });
        });
        _socket.on('system_log',       (data) => AppStore.addLog(`[System] ${data.msg || data}`));
        _socket.on('mixer_log',        (msg)  => AppStore.addLog(`[Mixer] ${msg}`));
        _socket.on('snapshot_saved',   (data) => AppStore.addLog(`✅ Snapshot: ${data.name || 'OK'}`));
        _socket.on('pong_mixer',       ()     => AppStore.addLog('🏓 Mesa respondeu.'));

        _socket.on('automix_state', (data) => {
            AppStore.setState({ automix: Object.assign({}, AppStore.getState().automix || {}, { [data.group]: data.enabled }) });
        });

        _socket.on('mute_group_state', (data) => {
            const mg = Object.assign({}, AppStore.getState().muteGroups || {}, { [data.groupId]: data.enabled });
            AppStore.setState({ muteGroups: mg });
        });

        _socket.on('channel_name_update', (data) => {
            const names = Object.assign({}, AppStore.getState().mixerNames || { channels: {}, aux: {} });
            names.channels[data.channel] = data.name;
            AppStore.setState({ mixerNames: names });
        });

        _socket.on('channel_level', (data) => {
            var decoded = data instanceof ArrayBuffer ? BinaryCodec.decodeChannelLevel(data) : data;
            if (!isFaderLocked(`ch_${decoded.channel}`)) {
                AppStore.setState({ [`ch_${decoded.channel}_level`]: decoded.level });
            }
        });

        _socket.on('channel_mute', (data) => {
            AppStore.setState({ [`mute_ch_${data.channel}`]: !!data.mute });
        });

        // --- Novos Eventos Sincronizados ---
        _socket.on('master_pan', (data) => AppStore.setState({ master_pan: Number(data?.pan ?? 0) }));
        _socket.on('master_dim', (data) => AppStore.setState({ master_dim: !!data?.dim }));
        _socket.on('master_delay_l', (data) => AppStore.setState({ master_delay_l: Number(data?.delayL ?? 0) }));
        _socket.on('master_delay_r', (data) => AppStore.setState({ master_delay_r: Number(data?.delayR ?? 0) }));
        
        _socket.on('channel_solo', (data) => AppStore.setState({ [`ch_${data.channel}_solo`]: !!data.solo }));
        _socket.on('channel_delay_feedback', (data) => AppStore.setState({ [`ch_${data.channel}_delay`]: Number(data.delay ?? 0) }));
        _socket.on('channel_automix_group', (data) => AppStore.setState({ [`ch_${data.channel}_automix_group`]: data.group || 'none' }));
        _socket.on('channel_automix_weight', (data) => AppStore.setState({ [`ch_${data.channel}_automix_weight`]: Number(data.weight ?? 0.5) }));
        _socket.on('channel_automix_weight_db', (data) => AppStore.setState({ [`ch_${data.channel}_automix_weight_db`]: Number(data.weightDb ?? 0) }));
        _socket.on('channel_multitrack_selected', (data) => AppStore.setState({ [`ch_${data.channel}_mtk_selected`]: !!data.selected }));
        _socket.on('channel_eq_band_type', (data) => AppStore.setState({ [`ch_${data.channel}_eq_band_${data.band}_type`]: data.type }));
        
        _socket.on('automix_response_time', (data) => AppStore.setState({ automix_response_time: Number(data.ms ?? 20) }));
        _socket.on('automix_response_time_linear', (data) => AppStore.setState({ automix_response_time_linear: Number(data.val ?? 0) }));

        _socket.on('recorder_busy', (data) => AppStore.setState({ [`recorder_busy_${data.mtk ? 'mtk' : 'dual'}`]: !!data.busy }));
        _socket.on('mtk_state', (data) => AppStore.setState({ mtk_state: data.state }));
        _socket.on('mtk_session', (data) => AppStore.setState({ mtk_session: data.session }));
        _socket.on('mtk_soundcheck', (data) => AppStore.setState({ mtk_soundcheck: !!data.soundcheck }));
        _socket.on('mtk_length', (data) => AppStore.setState({ mtk_length: Number(data.length ?? 0) }));
        _socket.on('mtk_elapsed_time', (data) => AppStore.setState({ mtk_elapsed_time: Number(data.elapsedTime ?? 0) }));
        _socket.on('mtk_remaining_time', (data) => AppStore.setState({ mtk_remaining_time: Number(data.remainingTime ?? 0) }));
        _socket.on('mtk_recording_time', (data) => AppStore.setState({ mtk_recording_time: Number(data.recordingTime ?? 0) }));

        _socket.on('bus_name_update', (data) => {
            const names = Object.assign({}, AppStore.getState().mixerNames || { channels: {}, aux: {} });
            if (!names[data.busType]) names[data.busType] = {};
            names[data.busType][data.channel] = data.name;
            AppStore.setState({ mixerNames: names });
        });
        _socket.on('bus_level', (data) => {
            AppStore.setState({ [`bus_${data.busType}_${data.channel}_level`]: Number(data.level ?? 0) });
            if (data.busType === 'aux') {
                AppStore.setState({ [`aux_${data.channel}_level`]: Number(data.level ?? 0) });
            }
            if (data.busType === 'fx') {
                AppStore.setState({ [`fx_${data.channel}_level`]: Number(data.level ?? 0) });
            }
        });
        _socket.on('bus_mute', (data) => {
            AppStore.setState({ [`bus_${data.busType}_${data.channel}_mute`]: !!data.mute });
            if (data.busType === 'aux') {
                AppStore.setState({ [`mute_aux_${data.channel}`]: !!data.mute });
            }
            if (data.busType === 'fx') {
                AppStore.setState({ [`mute_fx_${data.channel}`]: !!data.mute });
            }
        });
        _socket.on('bus_solo', (data) => AppStore.setState({ [`bus_${data.busType}_${data.channel}_solo`]: !!data.solo }));
        _socket.on('bus_pan', (data) => AppStore.setState({ [`bus_${data.busType}_${data.channel}_pan`]: Number(data.pan ?? 0) }));
        _socket.on('bus_delay', (data) => {
            AppStore.setState({ [`bus_${data.busType}_${data.channel}_delay`]: Number(data.delay ?? 0) });
            if (data.busType === 'aux') {
                AppStore.setState({ [`aux_${data.channel}_delay`]: Number(data.delay ?? 0) });
            }
        });

        _socket.on('fx_type', (data) => AppStore.setState({ [`fx_${data.fx}_type`]: data.type }));
        _socket.on('fx_bpm_feedback', (data) => AppStore.setState({ [`fx_${data.fx}_bpm`]: Number(data.bpm ?? 120) }));
        _socket.on('fx_param_feedback', (data) => AppStore.setState({ [`fx_${data.fx}_param_${data.param}`]: Number(data.val ?? 0) }));

        _socket.on('aux_send_post', (data) => {
            AppStore.setState({ [`aux_${data.aux}_send_${data.channelType}_${data.channel}_post`]: !!data.post });
        });
        _socket.on('fx_send_post', (data) => {
            AppStore.setState({ [`fx_${data.fx}_send_${data.channelType}_${data.channel}_post`]: !!data.post });
        });

        _socket.on('hw_phantom', (data) => AppStore.setState({ [`hw_${data.input}_phantom`]: !!data.phantom }));
        _socket.on('hw_gain_feedback', (data) => AppStore.setState({ [`hw_${data.input}_gain`]: Number(data.gain ?? 0) }));
        _socket.on('hw_gain_db_feedback', (data) => AppStore.setState({ [`hw_${data.input}_gain_db`]: Number(data.gainDb ?? 0) }));

        _socket.on('solo_volume', (data) => AppStore.setState({ solo_volume: Number(data.level ?? 0) }));
        _socket.on('solo_volume_db', (data) => AppStore.setState({ solo_volume_db: Number(data.levelDb ?? 0) }));
        _socket.on('headphone_volume', (data) => AppStore.setState({ [`headphone_${data.hp}_volume`]: Number(data.level ?? 0) }));
        _socket.on('headphone_volume_db', (data) => AppStore.setState({ [`headphone_${data.hp}_volume_db`]: Number(data.levelDb ?? 0) }));

        _socket.on('player_playlist', (data) => AppStore.setState({ player_playlist: data.playlist }));
        _socket.on('player_length', (data) => AppStore.setState({ player_length: Number(data.length ?? 0) }));
        _socket.on('player_elapsed', (data) => AppStore.setState({ player_elapsed: Number(data.elapsed ?? 0) }));
        _socket.on('player_remaining', (data) => AppStore.setState({ player_remaining: Number(data.remaining ?? 0) }));
        _socket.on('player_shuffle', (data) => AppStore.setState({ player_shuffle: !!data.shuffle }));

        // Full state + delta reconciliation (respeita locks de fader)
        _socket.on('mixer_state_full', (data) => {
            const patch = {};
            if (data.master) {
                if (!isFaderLocked('master')) patch.masterLevel = data.master.level ?? 0;
                patch.masterDb   = data.master.levelDb ?? null;
                patch.masterMute = !!data.master.mute;
                patch.master_pan = data.master.pan ?? 0;
                patch.master_dim = !!data.master.dim;
                patch.master_delay_l = data.master.delayL ?? 0;
                patch.master_delay_r = data.master.delayR ?? 0;
            }
            if (Array.isArray(data.inputs)) {
                data.inputs.forEach((input, idx) => {
                    const ch = idx + 1;
                    if (!isFaderLocked(`ch_${ch}`)) patch[`ch_${ch}_level`] = input.level ?? 0;
                    patch[`mute_ch_${ch}`]    = !!input.mute;
                    patch[`phantom_ch_${ch}`] = !!input.phantom;
                    patch[`hw_${ch}_phantom`] = !!input.phantom;
                    patch[`ch_${ch}_solo`]    = !!input.solo;
                    patch[`ch_${ch}_delay`]   = input.delay ?? 0;
                    patch[`ch_${ch}_automix_group`] = input.automixGroup || 'none';
                    patch[`ch_${ch}_automix_weight`] = input.automixWeight ?? 0.5;
                    patch[`ch_${ch}_automix_weight_db`] = input.automixWeightDB ?? 0;
                    patch[`ch_${ch}_mtk_selected`] = !!input.multiTrackSelected;
                });
            }
            if (Array.isArray(data.aux)) {
                data.aux.forEach((aux, idx) => {
                    const a = idx + 1;
                    patch[`bus_aux_${a}_level`] = aux.level ?? 0;
                    patch[`aux_${a}_level`] = aux.level ?? 0;
                    patch[`mute_aux_${a}`] = !!aux.mute;
                    patch[`bus_aux_${a}_mute`] = !!aux.mute;
                    patch[`aux_${a}_delay`] = aux.delay ?? 0;
                    patch[`bus_aux_${a}_delay`] = aux.delay ?? 0;
                });
            }
            if (Array.isArray(data.fx)) {
                data.fx.forEach((fx, idx) => {
                    const f = idx + 1;
                    patch[`bus_fx_${f}_level`] = fx.level ?? 0;
                    patch[`fx_${f}_level`] = fx.level ?? 0;
                    patch[`fx_${f}_bpm`] = fx.bpm ?? 120;
                    if (fx.type) patch[`fx_${f}_type`] = fx.type;
                    if (Array.isArray(fx.params)) {
                        fx.params.forEach((val, pIdx) => {
                            patch[`fx_${f}_param_${pIdx + 1}`] = val ?? 0;
                        });
                    }
                });
            }
            if (data.player) {
                patch.playerState = data.player.state;
                patch.playerTrack = data.player.track;
            }
            if (data.rec) {
                patch.recording = !!data.rec.recording;
                patch.mtkRecording = !!data.rec.mtkRecording;
            }
            AppStore.setState(patch);
        });

        _socket.on('feedback_cut_success',  (data) => { if (data?.msg) AppStore.addLog(data.msg); });
        _socket.on('channel_selected_external', (s) => AppStore.addLog(`Canal externo: ${s.type} ${s.number}`));
        _socket.on('feedback_risk_result', (data) => {
            if (data.risk > 0.7) AppStore.addLog(`⚠️ Risco feedback ${data.hz}Hz: ${Math.round(data.risk * 100)}%`);
        });

        window.addEventListener('beforeunload', () => { if (_socket) _socket.disconnect(); });
    }

    function isConnected() { return _socket !== null && _socket.connected; }
    function raw()         { return _socket; }
    function on(event, cb) {
        if (!_socket) {
            _pendingListeners.push({ event, cb });
            return;
        }
        _socket.on(event, cb);
    }

    function off(event, cb) {
        if (!_socket) {
            for (let i = _pendingListeners.length - 1; i >= 0; i--) {
                if (_pendingListeners[i].event === event && _pendingListeners[i].cb === cb) {
                    _pendingListeners.splice(i, 1);
                }
            }
            return;
        }
        _socket.off(event, cb);
    }

    function destroy() {
        _initialized = false;
        if (_socket) { _socket.disconnect(); _socket = null; }
    }

    window.SocketService = {
        init, emit, isConnected, raw, on, off, destroy,
        lockFader, unlockFader, isFaderLocked,
        getQueueLength: () => _offlineQueue.length,
    };
})();
