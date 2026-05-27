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
        _socket.on('device_info',      (info) => AppStore.setState({ deviceInfo: info }));
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

        // Full state + delta reconciliation (respeita locks de fader)
        _socket.on('mixer_state_full', (data) => {
            const patch = {};
            if (data.master) {
                if (!isFaderLocked('master')) patch.masterLevel = data.master.level ?? 0;
                patch.masterDb   = data.master.levelDb ?? null;
                patch.masterMute = !!data.master.mute;
            }
            if (Array.isArray(data.inputs)) {
                data.inputs.forEach((input, idx) => {
                    const ch = idx + 1;
                    if (!isFaderLocked(`ch_${ch}`)) patch[`ch_${ch}_level`] = input.level ?? 0;
                    patch[`mute_ch_${ch}`]    = !!input.mute;
                    patch[`phantom_ch_${ch}`] = !!input.phantom;
                });
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
        if (!_socket) { console.warn('[SocketService] Socket não inicializado para .on()'); return; }
        _socket.on(event, cb);
    }

    function off(event, cb) {
        if (!_socket) { return; }
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
