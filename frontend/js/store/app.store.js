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

        // Analyzer
        micActive: false,
        feedbackHz: null,     // Hz do pico detectado ou null

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
    };

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
                }, '*');
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

    window.AppStore = { subscribe, setState, getState, addLog, addAISuggestion, defineComputed };

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
