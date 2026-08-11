/**
 * SoundMaster — AppStore
 * Estado global reativo com observer pattern.
 * Substitui a passagem de callbacks entre módulos (appendMixerLog, appendAISuggestion, etc.)
 *
 * FEATURES:
 *   - Subscribe por chave com unsubscribe
 *   - setState patch com notificação automática
 *   - Persistência declarativa em localStorage
 *   - Deep clone em getState() para evitar mutação acidental
 *   - Cross-frame sync via postMessage (parent ↔ iframe)
 *
 * USO:
 *   AppStore.subscribe('mixerConnected', (val) => { ... });
 *   AppStore.setState({ mixerConnected: true });
 *   const { masterLevel } = AppStore.getState();
 */
(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // Persistência declarativa
    // -------------------------------------------------------------------------
    const PERSIST_KEYS = [
        'userMode', 'volunteerChannels', 'faderCeiling',
        'autoEqTarget', 'mtwWindow', 'splWeighting', 'aiChatHistory',
        'soundAssistantSettings',
    ];

    function _loadPersisted(key, fallback) {
        try {
            const v = localStorage.getItem('sm-' + key);
            return v !== null ? JSON.parse(v) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function _persist(patch) {
        Object.keys(patch).forEach(function (key) {
            if (PERSIST_KEYS.includes(key)) {
                try {
                    localStorage.setItem('sm-' + key, JSON.stringify(patch[key]));
                } catch (e) {
                    console.warn('[AppStore] Falha ao persistir', key, e);
                }
            }
        });
    }

    // -------------------------------------------------------------------------
    // Deep clone para getState()
    // -------------------------------------------------------------------------
    function _deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Float32Array) return new Float32Array(obj);
        if (Array.isArray(obj)) return obj.map(_deepClone);
        const clone = {};
        for (const k of Object.keys(obj)) clone[k] = _deepClone(obj[k]);
        return clone;
    }

    // -------------------------------------------------------------------------
    // Estado inicial
    // -------------------------------------------------------------------------
    const _state = {
        // Mixer
        mixerConnected: false,
        mixerIp: '10.10.1.1',
        mixerStatusMsg: 'Offline',
        masterLevel: 0,       // 0.0 – 1.0
        masterDb: null,       // número ou null
        masterMute: false,
        vuData: {},           // dados de VU em tempo real por canal
        recording: false,     // estado do gravador 2-track
        mtkRecording: false,  // estado do multitrack
        deviceInfo: {
            model: 'Unknown',
            firmware: 'N/A',
            caps: {}
        },

        // IA
        aiAvailable: false,   // Python AI server disponível
        liteMode: true,       // Modo Lite (sem Python)
        aiStatus: 'offline',  // 'online' | 'offline' | 'loading'
        aiSuggestions: [],    // [{ desc, command }]
        aiChatHistory: _loadPersisted('aiChatHistory', []), // [{ text, isUser, command, id, ts }]
        aiAutonomousMode: false, // legado: execução autônoma desativada; confirmação é obrigatória

        // Analyzer
        micActive: false,
        feedbackHz: null,     // Hz do pico detectado ou null

        // Assistente de operação sonora (modo sombra por padrão)
        soundAssistantMode: 'shadow',
        soundAssistantSource: 'main-lr',
        soundAssistantAlerts: [],
        soundAssistantActiveCount: 0,
        soundAssistantActions: [],
        soundAssistantPendingCount: 0,
        soundAssistantTask: null,
        soundAssistantSettings: _loadPersisted('soundAssistantSettings', {
            sourceMode: 'main-lr',
            sensitivity: 'balanced',
            confirmationPolicy: 'always',
            categories: { clipping: true, feedback: true, noise: true, signal: true, dynamics: true, eq: true }
        }),

        // SPL Logger (IEC 61672)
        splWeighting: _loadPersisted('splWeighting', 'A'),    // 'A' | 'C' | 'Z'
        splStats: null,       // { leqTotal, leq1, leq10, lmax, lmin, ldose, dose8h, lden, elapsedSec }
        splAlert: null,       // { level, message, ts } ou null
        splHistory: null,     // referência ao getter — não guarda array aqui

        // MTW Spectrum (Multi-Time Windowing)
        mtwSpectrum: null,    // { frequencies: Float32Array, magnitudes: Float32Array }
        mtwWindow: _loadPersisted('mtwWindow', 'blackman'), // janela activa

        // Auto-EQ / Target Curve Matching
        autoEqTarget: _loadPersisted('autoEqTarget', 'flat'),  // curva alvo activa
        autoEqResult: null,    // { peq, geq, curve, diff, stats }

        // Spatial Averaging
        spatialAvgResult: null, // { avg, variance, sources, meta }

        // Logs
        mixerLog: [],         // [{ time, text }]

        // Modo de Permissão (Tópico 15)
        userMode: _loadPersisted('userMode', 'technician'),
        volunteerChannels: _loadPersisted('volunteerChannels', [1, 2, 3, 4]),
        faderCeiling: _loadPersisted('faderCeiling', 0.85),

        // Chaves adicionais do Master
        master_pan: 0.5,
        master_dim: false,
        master_delay_l: 0,
        master_delay_r: 0,
        master_name: 'MASTER',

        // Player e Gravador
        player_playlist: '',
        player_length: 0,
        player_elapsed: 0,
        player_remaining: 0,
        player_shuffle: false,

        // Multitrack e Gravador busy
        mtk_state: 'stop',
        mtk_session: '',
        mtk_soundcheck: false,
        mtk_length: 0,
        mtk_elapsed_time: 0,
        mtk_remaining_time: 0,
        mtk_recording_time: 0,
        recorder_busy_mtk: false,
        recorder_busy_dual: false,

        // Volumes de monitoramento
        solo_volume: 0.0,
        solo_volume_db: -99.0,

        // Automixer
        automix: {
            a: false,
            b: false
        },
        automix_response_time: 50,
        automix_response_time_linear: 0.5,
        muteGroups: {}
    };

    // Inicialização dinâmica para chaves repetitivas
    // 1. Canais (1 a 24)
    for (let i = 1; i <= 24; i++) {
        _state[`ch_${i}_level`] = 0.75;
        _state[`mute_ch_${i}`] = false;
        _state[`phantom_ch_${i}`] = false;
        _state[`hw_${i}_phantom`] = false;
        _state[`ch_${i}_solo`] = false;
        _state[`ch_${i}_delay`] = 0;
        _state[`ch_${i}_pan`] = 0.5;
        _state[`ch_${i}_automix_group`] = 'none';
        _state[`ch_${i}_automix_weight`] = 0.5;
        _state[`ch_${i}_automix_weight_db`] = 0;
        _state[`ch_${i}_mtk_selected`] = false;
        _state[`ch_${i}_name`] = `CANAL ${i}`;
        
        for (let b = 1; b <= 4; b++) {
            _state[`ch_${i}_eq_band_${b}_type`] = 'peq';
        }

        // Preamps de Hardware
        _state[`hw_${i}_gain`] = 0.0;
        _state[`hw_${i}_gain_db`] = -99.0;
    }

    // 2. Motores de Efeitos (1 a 4) e Parâmetros (1 a 6)
    for (let i = 1; i <= 4; i++) {
        _state[`fx_${i}_type`] = 'Reverb';
        _state[`fx_${i}_bpm`] = 120;
        _state[`fx_${i}_level`] = 0.5;
        _state[`mute_fx_${i}`] = false;
        for (let p = 1; p <= 6; p++) {
            _state[`fx_${i}_param_${p}`] = 0.0;
        }
    }

    // 3. Fones de Ouvido (1 a 2)
    for (let hp = 1; hp <= 2; hp++) {
        _state[`headphone_${hp}_volume`] = 0.5;
        _state[`headphone_${hp}_volume_db`] = -12.0;
    }

    // 4. Barramentos e Roteamento
    const busTypes = ['line', 'player', 'aux', 'fx', 'sub', 'vca'];
    busTypes.forEach(type => {
        const count = type === 'aux' ? 10 : (type === 'fx' ? 4 : 6);
        for (let i = 1; i <= count; i++) {
            _state[`bus_${type}_${i}_level`] = 0.75;
            _state[`bus_${type}_${i}_mute`] = false;
            _state[`bus_${type}_${i}_solo`] = false;
            _state[`bus_${type}_${i}_pan`] = 0.5;
            _state[`bus_${type}_${i}_name`] = `${type.toUpperCase()} ${i}`;
            if (type === 'aux') {
                _state[`aux_${i}_level`] = 0.75;
                _state[`mute_aux_${i}`] = false;
                _state[`aux_${i}_delay`] = 0;
            }
        }
    });

    // 5. Roteamento de Envios Aux e FX (aux 1 a 10, fx 1 a 4, canais/entradas 1 a 24)
    for (let a = 1; a <= 10; a++) {
        for (let i = 1; i <= 24; i++) {
            _state[`aux_${a}_send_input_${i}_post`] = false; // false = pre, true = post
            _state[`aux_${a}_ch_${i}_level`] = 0.70;
        }
    }
    for (let f = 1; f <= 4; f++) {
        for (let i = 1; i <= 24; i++) {
            _state[`fx_${f}_send_input_${i}_post`] = true; // fx sends are post-fader by default
        }
    }

    // -------------------------------------------------------------------------
    // Computed State Registry (auto-derived properties)
    // -------------------------------------------------------------------------
    const _computed = {}; // { key: { deps: string[], fn: Function, cache: any } }

    function _recomputeDependents(changedKeys) {
        const recomputed = {};
        const entries = Object.entries(_computed);
        for (let ei = 0; ei < entries.length; ei++) {
            const [key, comp] = entries[ei];
            const dependsOnChanged = comp.deps.some(function (d) { return changedKeys.includes(d); });
            if (!dependsOnChanged) continue;
            const depValues = comp.deps.map(function (d) { return _state[d]; });
            const newVal = comp.fn.apply(null, depValues);
            if (newVal !== comp.cache) {
                comp.cache = newVal;
                _state[key] = newVal;
                recomputed[key] = newVal;
            }
        }
        const keys = Object.keys(recomputed);
        for (let ki = 0; ki < keys.length; ki++) {
            _notify(keys[ki], recomputed);
        }
    }

    /**
     * Define uma propriedade computada que é recalculada automaticamente
     * quando suas dependências mudam.
     * @param {string} key     - Nome da propriedade computada
     * @param {string[]} deps  - Lista de chaves das quais depende
     * @param {Function} fn    - Função que recebe os valores das deps e retorna o valor computado
     */
    function defineComputed(key, deps, fn) {
        if (_computed[key]) {
            console.warn('[AppStore] Computed "' + key + '" já definido — sobrescrevendo');
        }
        const depValues = deps.map(function (d) { return _state[d]; });
        const initial = fn.apply(null, depValues);
        _computed[key] = { deps: deps, fn: fn, cache: initial };
        _state[key] = initial;
    }

    // -------------------------------------------------------------------------
    // Listeners por chave
    // -------------------------------------------------------------------------
    const _listeners = {};

    // -------------------------------------------------------------------------
    // API pública
    // -------------------------------------------------------------------------

    /**
     * Assinar mudanças em uma chave específica do estado.
     * @param {string} key  - Chave do estado (ex: 'mixerConnected')
     * @param {Function} fn - Callback chamado com o novo valor
     * @returns {Function}  - Função de unsubscribe
     */
    function subscribe(key, fn) {
        if (!_listeners[key]) _listeners[key] = [];
        _listeners[key].push(fn);
        return function unsubscribe() {
            _listeners[key] = _listeners[key].filter(function (f) { return f !== fn; });
        };
    }

    /**
     * Notificar subscribers de uma chave.
     * @param {string} key
     * @param {Object} patch
     */
    function _notify(key, patch) {
        if (_listeners[key]) {
            _listeners[key].forEach(function (fn) {
                try { fn(_state[key], _state); } catch (e) {
                    console.error('[AppStore] Erro no subscriber de "' + key + '":', e);
                }
            });
        }
    }

    /**
     * Atualizar uma ou mais chaves do estado e notificar subscribers.
     * @param {Object} patch - Objeto parcial com as mudanças
     */
    function setState(patch) {
        Object.assign(_state, patch);
        _persist(patch);

        const keys = Object.keys(patch);
        keys.forEach(function (key) { _notify(key, patch); });

        // Recomputar propriedades derivadas cujas dependências mudaram
        _recomputeDependents(keys);

        // Cross-frame: notificar iframe ativo sobre a mudança
        const iframe = document.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentWindow) {
            try {
                const allKeys = keys.concat(Object.keys(_computed).filter(function (k) {
                    return _computed[k].deps.some(function (d) { return keys.includes(d); });
                }));
                iframe.contentWindow.postMessage({
                    type: 'APPSTORE_UPDATE',
                    keys: allKeys,
                    patch: patch,
                }, window.location.origin);
            } catch (e) {
                console.warn('[AppStore] Falha ao notificar iframe:', e);
            }
        }
    }

    /**
     * Retorna uma cópia profunda do estado atual.
     * @returns {Object}
     */
    function getState() {
        return _deepClone(_state);
    }

    /**
     * Retorna o valor de uma chave específica sem clonar todo o estado.
     * Mais eficiente que getState() para acessos frequentes.
     * @param {string} key - Chave do estado
     * @returns {*} Valor da chave (cópia rasa se for objeto)
     */
    function get(key) {
        const val = _state[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            return Object.assign({}, val);
        }
        return val;
    }

    /**
     * Atalho: adicionar entrada ao log do mixer (max 50 entradas).
     * @param {string} text
     */
    function addLog(text) {
        const entry = {
            time: new Date().toLocaleTimeString('pt-BR'),
            text: String(text)
        };
        const logs = _state.mixerLog.concat(entry).slice(-50);
        setState({ mixerLog: logs });
    }

    /**
     * Atalho: adicionar sugestão de IA (mantém as 10 mais recentes).
     * @param {{ desc: string, command: Object }} suggestion
     */
    function addAISuggestion(suggestion) {
        const list = [suggestion].concat(_state.aiSuggestions).slice(0, 10);
        setState({ aiSuggestions: list });
    }

    // -------------------------------------------------------------------------
    // Cross-frame: escutar patches vindos do iframe
    // -------------------------------------------------------------------------
    window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'APPSTORE_PATCH') {
            setState(e.data.patch);
        }
        if (e.data && e.data.type === 'APPSTORE_SYNC_REQUEST') {
            e.source.postMessage({ type: 'APPSTORE_UPDATE', patch: getState(), keys: Object.keys(getState()) }, e.origin);
        }
    });

    window.AppStore = { subscribe, setState, getState, get, addLog, addAISuggestion, defineComputed };

    // ─── Computed properties padrão ─────────────────────────────────────────
    defineComputed('mixerOnline', ['mixerConnected', 'mixerStatusMsg'], function (connected, statusMsg) {
        return !!(connected && statusMsg && statusMsg !== 'Offline' && statusMsg !== 'Disconnected');
    });

    defineComputed('hasFeedbackRisk', ['feedbackHz', 'micActive'], function (hz, micActive) {
        return !!(hz && hz > 0 && micActive);
    });

    defineComputed('masterLevelPercent', ['masterLevel'], function (level) {
        return Math.round((level || 0) * 100);
    });
})();
