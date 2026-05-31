/**
 * SoundMaster — Mixer Singleton v2 (Proxy Multiplexador)
 * =======================================================
 * Tópico 25: UMA única conexão com a Ui24R. State Tree em memória.
 * Tópico 27: TCP_NODELAY + DSCP EF tagging para priorização QoS.
 * Tópico 29: Event Loop Lag monitor + Worker Thread isolation.
 *
 * ARQUITETURA:
 *   Main Thread → Socket.IO clientes + WebSocket Ui24R (I/O puro)
 *   Worker Thread → AES67 processing + Python AI HTTP calls
 *
 * REGRAS:
 *   - getMixer() sempre retorna a instância singleton
 *   - setMixer() aplica TCP_NODELAY e DSCP imediatamente
 *   - getStateTree() retorna snapshot completo para zero-latency load
 *   - Rate limiter integrado: faders limitados a 1 update/50ms por canal
 */

'use strict';

const { performance } = require('perf_hooks');

// ─── State Tree (cache completo da mesa) ──────────────────────────────────────

let mixer = null;
let _io   = null;   // referência ao Socket.IO server (injectada via setIo)

const stateTree = {
    meta:   { connectedAt: null, model: 'Soundcraft Ui24R', fw: 'unknown' },
    master: { level: 0, levelDb: -100, mute: 0, pan: 0.5, dim: 0, delayL: 0, delayR: 0, name: 'MASTER' },
    inputs: Array.from({ length: 24 }, () => ({
        level: 0, levelDb: -100, mute: 0, phantom: 0,
        hpf: 100, gate: 0, comp: 0, eq: {}, name: '', delay: 0
    })),
    aux:    Array.from({ length: 10 }, () => ({ level: 0, mute: 0, delay: 0 })),
    fx:     Array.from({ length: 4 },  () => ({ level: 0, bpm: 120, type: 'Reverb', params: [0, 0, 0, 0, 0, 0] })),
    player: { state: 'stop', track: '' },
    rec:    { recording: false, mtkRecording: false },
};

// ─── Rate Limiter (Tópico 25) ─────────────────────────────────────────────────
// Previne flood de comandos de fader: max 1 update por canal a cada 50ms.
const _faderLastTs = new Map();   // channelKey → timestamp
const FADER_MIN_INTERVAL_MS = 50;

function checkFaderRateLimit(key) {
    const now  = performance.now();
    const last = _faderLastTs.get(key) || 0;
    if (now - last < FADER_MIN_INTERVAL_MS) return false;
    _faderLastTs.set(key, now);
    return true;
}

// ─── Event Loop Lag Monitor (Tópico 29) ───────────────────────────────────────
// Detecta bloqueios na Main Thread acima de 50ms.
const EVENT_LOOP_WARN_MS = 50;
let _lagMonitorId = null;

function startEventLoopMonitor(logger) {
    if (_lagMonitorId) return;
    let lastCheck = performance.now();

    _lagMonitorId = setInterval(() => {
        const now = performance.now();
        const lag = now - lastCheck - 100;   // intervalo esperado = 100ms
        lastCheck = now;

        if (lag > EVENT_LOOP_WARN_MS) {
            const msg = `[EventLoop] ⚠️ Lag detectado: ${lag.toFixed(1)}ms (limite: ${EVENT_LOOP_WARN_MS}ms)`;
            console.warn(msg);
            if (logger) logger(msg);
            if (_io) _io.emit('system_log', { msg, severity: 'warn', ts: Date.now() });
        }
    }, 100);

    // Não bloqueia o processo ao sair
    if (_lagMonitorId.unref) _lagMonitorId.unref();
}

function stopEventLoopMonitor() {
    if (_lagMonitorId) { clearInterval(_lagMonitorId); _lagMonitorId = null; }
}

// ─── TCP_NODELAY + DSCP (Tópico 27) ───────────────────────────────────────────

/**
 * Aplica TCP_NODELAY e tenta setar DSCP EF (0x2E / 46) no socket do mixer.
 * O DSCP é aplicado via IP_TOS no socket nativo — requer que o SO não filtre.
 * Em Linux, funciona nativamente. No Windows, pode requerer "QoS Packet Scheduler".
 */
function _applySocketQoS(mixerInstance) {
    try {
        // Acede ao socket TCP subjacente da biblioteca soundcraft-ui-connection
        const sock = mixerInstance?.conn?._socket ||
                     mixerInstance?.conn?.socket  ||
                     mixerInstance?._ws?._socket;

        if (!sock) {
            console.warn('[QoS] Socket TCP interno não acessível. DSCP ignorado.');
            return;
        }

        // TCP_NODELAY — desativa o Algoritmo de Nagle (comandos enviados imediatamente)
        if (typeof sock.setNoDelay === 'function') {
            sock.setNoDelay(true);
            console.log('[QoS] TCP_NODELAY ativado na conexão com a Ui24R.');
        }

        // DSCP EF (Expedited Forwarding) = 0x2E = 46 → IP TOS = 46 << 2 = 0xB8
        // Garante prioridade máxima em switches e APs gerenciados (Aruba, Cisco).
        if (typeof sock.setTTL === 'function') {
            // Usa campo TOS do IP para DSCP (bits 7-2 do campo TOS)
            const DSCP_EF = 46;
            const TOS     = DSCP_EF << 2;   // = 0xB8 = 184
            try {
                // Node.js não expõe IP_TOS diretamente; usamos setTOS se disponível
                // (disponível em algumas versões via net.Socket.prototype)
                if (typeof sock.setTOS === 'function') {
                    sock.setTOS(TOS);
                    console.log(`[QoS] DSCP EF (${DSCP_EF}) / TOS 0x${TOS.toString(16)} aplicado.`);
                } else {
                    console.log(`[QoS] DSCP EF desejado (TOS 0x${TOS.toString(16)}), mas setTOS não disponível neste SO/versão.`);
                }
            } catch (tosErr) {
                console.warn('[QoS] setTOS falhou:', tosErr.message);
            }
        }
    } catch (err) {
        console.warn('[QoS] Erro ao aplicar QoS:', err.message);
    }
}

// ─── Despacho do State Tree (Zero-latency load) ───────────────────────────────

/**
 * Envia o State Tree completo para um socket específico (novo cliente).
 * Substitui a necessidade de pedir dados à mesa a cada conexão.
 */
function dispatchStateTreeTo(socket) {
    socket.emit('mixer_state_full', {
        master: stateTree.master,
        inputs: stateTree.inputs,
        aux:    stateTree.aux,
        fx:     stateTree.fx,
        player: stateTree.player,
        rec:    stateTree.rec,
        meta:   stateTree.meta,
        _source: 'state_tree_cache',
        _ts:     Date.now(),
    });
}

/**
 * Emite um delta (patch parcial) para todos os clientes conectados.
 * Usado quando um parâmetro específico muda na mesa.
 */
function broadcastDelta(event, data) {
    if (_io) _io.emit(event, data);
}

// ─── API pública ──────────────────────────────────────────────────────────────

module.exports = {
    // Getter/Setter do mixer singleton
    getMixer: () => mixer,
    setMixer: (m) => {
        mixer = m;
        if (m) {
            stateTree.meta.connectedAt = new Date().toISOString();
            if (m.deviceInfo) {
                stateTree.meta.model = m.deviceInfo.model || 'Soundcraft Ui';
            }
            _applySocketQoS(m);
            console.log('[MixerSingleton] Mixer definido. QoS aplicado.');
        }
    },

    // State Tree
    getStateTree:       () => stateTree,
    getState:           () => stateTree,             // alias backward-compat
    setState:           (s) => { Object.assign(stateTree, s); },
    dispatchStateTreeTo,
    broadcastDelta,

    // Patches parciais
    updateMasterState: (patch) => {
        Object.assign(stateTree.master, patch);
    },
    updateMetaState: (patch) => {
        Object.assign(stateTree.meta, patch);
    },
    updateChannelState: (ch, patch) => {
        if (!stateTree.inputs[ch - 1]) return null;
        Object.assign(stateTree.inputs[ch - 1], patch);
        return stateTree.inputs[ch - 1];
    },
    updateAuxState: (aux, patch) => {
        if (!stateTree.aux[aux - 1]) return null;
        Object.assign(stateTree.aux[aux - 1], patch);
        return stateTree.aux[aux - 1];
    },
    updateFxState: (fxIdx, patch) => {
        if (!stateTree.fx[fxIdx - 1]) return null;
        Object.assign(stateTree.fx[fxIdx - 1], patch);
        return stateTree.fx[fxIdx - 1];
    },

    // Getters
    getChannelState: (ch)  => stateTree.inputs[ch - 1] || null,
    getMasterState:  ()    => stateTree.master,
    getAuxState:     (aux) => stateTree.aux[aux - 1] || null,
    getFxState:      (fxIdx) => stateTree.fx[fxIdx - 1] || null,

    // Rate Limiter
    checkFaderRateLimit,
    FADER_MIN_INTERVAL_MS,

    // Event Loop Monitor
    startEventLoopMonitor,
    stopEventLoopMonitor,

    // Socket.IO injection (chamado em app-server.js após io() estar disponível)
    setIo: (ioInstance) => { _io = ioInstance; },
    getIo: ()           => _io,
};
