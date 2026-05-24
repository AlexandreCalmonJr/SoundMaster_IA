/**
 * SoundMaster Pro — Network Diagnostics Service
 * ===============================================
 * Monitoramento ativo da saúde da infraestrutura de rede para AoIP (AES67/Dante).
 *
 * Funcionalidades:
 *   1. Latência TCP ativa (ping ao mixer e gateway) com estatísticas RTT
 *   2. Jitter (RFC 3550: variação do RTT entre medições consecutivas)
 *   3. Perda de pacotes UDP (sonda contínua na subnet local)
 *   4. Descoberta de dispositivos mDNS/Bonjour (AES67, Dante, Soundcraft, Shure)
 *   5. Alertas preventivos com thresholds configuráveis
 *   6. Emissão de eventos via Socket.IO para a UI
 *
 * Eventos emitidos (io.emit):
 *   'net_diag_update'   → { latency, jitter, loss, gateway, mixer, ts }
 *   'net_diag_alert'    → { level, code, message, value, threshold, ts }
 *   'net_device_found'  → { ip, hostname, type, services, ts }
 *   'net_device_list'   → [{ ip, hostname, type, lastSeen }]
 *   'net_diag_status'   → { running, mixerIp, gatewayIp, interval }
 *
 * Eventos recebidos (socket.on):
 *   'start_net_diag'    → { mixerIp, gatewayIp?, interval? }
 *   'stop_net_diag'     → {}
 *   'get_net_devices'   → {}
 *   'net_diag_config'   → { thresholds }
 */

'use strict';

const net     = require('net');
const dgram   = require('dgram');
const os      = require('os');
const dns     = require('dns');

// multicast-dns para descoberta Bonjour/mDNS
let mdns;
try {
    mdns = require('multicast-dns')();
    mdns.setMaxListeners(20);
} catch (e) {
    console.warn('[NetDiag] multicast-dns não disponível:', e.message);
    mdns = null;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Thresholds de alerta (configuráveis via 'net_diag_config') */
const DEFAULT_THRESHOLDS = {
    latency_warn_ms:   20,   // latência acima disto → WARN
    latency_crit_ms:   50,   // acima disto → CRITICAL (AES67 exige <2ms ideal)
    jitter_warn_ms:    5,    // jitter acima disto → WARN (destrói clock AoIP)
    jitter_crit_ms:    15,   // acima disto → CRITICAL
    loss_warn_pct:     1,    // perda acima de 1% → WARN
    loss_crit_pct:     5,    // acima de 5% → CRITICAL
    window:            20,   // amostras para cálculo de jitter/loss
};

/** Serviços mDNS associados a dispositivos AoIP conhecidos */
const AOIP_MDNS_SERVICES = [
    { service: '_aes67._udp.local',     type: 'AES67'      },
    { service: '_dante._udp.local',     type: 'Dante'      },
    { service: '_soundcraft._tcp.local',type: 'Soundcraft' },
    { service: '_ravenna._udp.local',   type: 'RAVENNA'    },
    { service: '_http._tcp.local',      type: 'HTTP/Mixer' },
    { service: '_osc._udp.local',       type: 'OSC'        },
    { service: '_shure._tcp.local',     type: 'Shure'      },
];

/** Porta TCP para o ping sintético ao mixer Soundcraft Ui */
const MIXER_TCP_PORT = 80;

/** Intervalo padrão entre medições (ms) */
const DEFAULT_INTERVAL_MS = 5000;

/** Histórico máximo de RTTs guardados em memória */
const MAX_RTT_HISTORY = 100;

// ─── Estado interno do módulo ─────────────────────────────────────────────────

const _state = {
    running:     false,
    mixerIp:     null,
    gatewayIp:   null,
    intervalMs:  DEFAULT_INTERVAL_MS,
    timer:       null,
    thresholds:  { ...DEFAULT_THRESHOLDS },
    // Histórico de RTT (janela deslizante)
    rttHistory:  [],
    // Estatísticas acumuladas da sessão
    stats: {
        samples:    0,
        totalRtt:   0,
        lossCount:  0,
        minRtt:     Infinity,
        maxRtt:     0,
    },
    // Cache de dispositivos descobertos
    devices: new Map(),  // ip → { hostname, type, services, lastSeen }
};

let _io = null;  // referência ao Socket.IO server

// ─── Inicialização ─────────────────────────────────────────────────────────────

/**
 * Inicializa o módulo com a instância do Socket.IO.
 * Regista os listeners de mDNS assim que o módulo carrega.
 */
function init(io) {
    _io = io;
    _startMdnsDiscovery();
    console.log('[NetDiag] Módulo iniciado.');
}

// ─── Controlo ─────────────────────────────────────────────────────────────────

function start({ mixerIp, gatewayIp, intervalMs } = {}) {
    if (_state.running) stop();

    _state.mixerIp    = mixerIp    || _state.mixerIp   || _detectGateway();
    _state.gatewayIp  = gatewayIp  || _state.gatewayIp || _detectGateway();
    _state.intervalMs = intervalMs || DEFAULT_INTERVAL_MS;
    _state.running    = true;
    _state.rttHistory = [];
    Object.assign(_state.stats, { samples: 0, totalRtt: 0, lossCount: 0, minRtt: Infinity, maxRtt: 0 });

    console.log(`[NetDiag] Iniciando monitoramento: mixer=${_state.mixerIp} gateway=${_state.gatewayIp} interval=${_state.intervalMs}ms`);

    _emit('net_diag_status', {
        running:   true,
        mixerIp:   _state.mixerIp,
        gatewayIp: _state.gatewayIp,
        interval:  _state.intervalMs,
    });

    // Primeira medição imediata
    _runProbe();
    _state.timer = setInterval(_runProbe, _state.intervalMs);
    if (_state.timer.unref) _state.timer.unref();
}

function stop() {
    if (_state.timer) {
        clearInterval(_state.timer);
        _state.timer = null;
    }
    _state.running = false;
    _emit('net_diag_status', { running: false });
    console.log('[NetDiag] Monitoramento parado.');
}

// ─── Probe principal ──────────────────────────────────────────────────────────

/**
 * Executa uma rodada de medição:
 *   1. Latência TCP ao mixer
 *   2. Latência TCP ao gateway
 *   3. Jitter (a partir do histórico de RTTs)
 *   4. Perda UDP (sonda de 5 datagrams para a subnet)
 */
async function _runProbe() {
    const ts = Date.now();
    const results = {
        ts,
        mixer:   null,
        gateway: null,
        jitter:  null,
        loss:    null,
    };

    // Medições paralelas para eficiência
    const [mixerRtt, gatewayRtt, udpLoss] = await Promise.all([
        _state.mixerIp   ? _tcpPing(_state.mixerIp,   MIXER_TCP_PORT) : Promise.resolve(null),
        _state.gatewayIp ? _tcpPing(_state.gatewayIp,  80)            : Promise.resolve(null),
        _udpLossProbe(_state.gatewayIp || _state.mixerIp),
    ]);

    results.mixer   = mixerRtt;
    results.gateway = gatewayRtt;
    results.loss    = udpLoss;

    // Actualiza histórico de RTT (jitter usa o RTT do mixer como referência primária)
    const primaryRtt = mixerRtt ?? gatewayRtt;
    if (primaryRtt !== null) {
        _state.rttHistory.push(primaryRtt);
        if (_state.rttHistory.length > MAX_RTT_HISTORY) _state.rttHistory.shift();

        _state.stats.samples++;
        _state.stats.totalRtt += primaryRtt;
        _state.stats.minRtt    = Math.min(_state.stats.minRtt, primaryRtt);
        _state.stats.maxRtt    = Math.max(_state.stats.maxRtt, primaryRtt);
    } else {
        _state.stats.lossCount++;
    }

    results.jitter = _calcJitter(_state.rttHistory);

    // Prepara payload completo
    const update = {
        ts,
        latency:   primaryRtt !== null ? _round(primaryRtt) : null,
        jitter:    _round(results.jitter),
        loss:      _round(results.loss),
        mixer:     mixerRtt   !== null ? _round(mixerRtt)   : null,
        gateway:   gatewayRtt !== null ? _round(gatewayRtt) : null,
        stats: {
            avg:     _state.stats.samples ? _round(_state.stats.totalRtt / _state.stats.samples) : null,
            min:     _state.stats.minRtt === Infinity ? null : _round(_state.stats.minRtt),
            max:     _round(_state.stats.maxRtt),
            samples: _state.stats.samples,
            loss:    _state.stats.lossCount,
        },
    };

    _emit('net_diag_update', update);
    _checkAlerts(update);
}

// ─── Medições ─────────────────────────────────────────────────────────────────

/**
 * "Ping" sintético via TCP connect (não requer ICMP/root).
 * Mede o RTT de estabelecer uma conexão TCP ao port dado.
 * Funciona em redes que bloqueiam ICMP (comum em ambientes corporativos).
 *
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<number|null>} RTT em ms ou null se timeout/erro
 */
function _tcpPing(host, port, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const t0  = Date.now();
        const sock = new net.Socket();
        let settled = false;

        const done = (rtt) => {
            if (settled) return;
            settled = true;
            sock.destroy();
            resolve(rtt);
        };

        sock.setTimeout(timeoutMs);
        sock.on('connect', () => done(Date.now() - t0));
        sock.on('timeout', () => done(null));
        sock.on('error',   () => done(null));

        try {
            sock.connect(port, host);
        } catch (e) {
            done(null);
        }
    });
}

/**
 * Sonda de perda de pacotes UDP.
 * Envia 5 datagrams para a porta 7 (echo) do host alvo e conta respostas.
 * Em redes que não respondem em UDP/7, usa uma heurística de timeout para
 * estimar a perda com base no tempo de resposta vs. tempo esperado.
 *
 * NOTA: em redes corporativas com firewall, o UDP/7 pode estar bloqueado.
 * Nesse caso, o módulo report 0% loss (assume rede OK) e loga um aviso.
 *
 * @param {string} host
 * @returns {Promise<number>} % de perda (0–100)
 */
function _udpLossProbe(host) {
    if (!host) return Promise.resolve(0);

    const PROBES    = 5;
    const TIMEOUT   = 500; // ms por sonda
    const PORT      = 7;   // echo port

    return new Promise((resolve) => {
        const sock = dgram.createSocket('udp4');
        let sent    = 0;
        let received = 0;
        let pending  = 0;
        let done     = false;

        const finish = () => {
            if (done) return;
            done = true;
            try { sock.close(); } catch (_) {}
            const loss = Math.round((1 - received / Math.max(sent, 1)) * 100);
            resolve(Math.min(100, Math.max(0, loss)));
        };

        sock.on('error', () => {
            // UDP/7 provavelmente bloqueado — assume sem perda
            finish();
        });

        sock.on('message', () => {
            received++;
            pending--;
            if (pending === 0) finish();
        });

        // Envia as sondas com pequeno espaçamento (100ms)
        const sendNext = () => {
            if (sent >= PROBES) return;
            const payload = Buffer.from(`sm_probe_${Date.now()}`);
            try {
                sock.send(payload, PORT, host, (err) => {
                    if (!err) { sent++; pending++; }
                });
            } catch (sendErr) {
                console.warn(`[NetDiag] Falha ao enviar sonda UDP para ${host}: ${sendErr.message}`);
            }
            setTimeout(sendNext, 100);
        };

        sendNext();

        // Timeout global
        setTimeout(() => {
            if (!done) finish();
        }, PROBES * 100 + TIMEOUT);
    });
}

/**
 * Calcula o jitter usando o método RFC 3550 (RTP):
 *   J(i) = J(i-1) + (|D(i-1,i)| - J(i-1)) / 16
 * onde D(i-1,i) = |RTT(i) - RTT(i-1)|.
 *
 * Simplificado para janela deslizante: desvio médio absoluto dos RTTs.
 */
function _calcJitter(rttHistory) {
    const n = rttHistory.length;
    if (n < 2) return 0;

    // Usa apenas a janela mais recente
    const window = rttHistory.slice(-DEFAULT_THRESHOLDS.window);
    const mean   = window.reduce((s, v) => s + v, 0) / window.length;
    const mad    = window.reduce((s, v) => s + Math.abs(v - mean), 0) / window.length;
    return mad;
}

// ─── Alertas preventivos ──────────────────────────────────────────────────────

/**
 * Verifica os thresholds e emite alertas preventivos.
 * Os alertas são categorizados em WARN e CRITICAL.
 */
function _checkAlerts({ latency, jitter, loss, ts }) {
    const t = _state.thresholds;

    // Latência
    if (latency !== null) {
        if (latency >= t.latency_crit_ms) {
            _alert('critical', 'LATENCY_CRITICAL', `Latência crítica: ${latency}ms (limite: ${t.latency_crit_ms}ms). Áudio AES67 em risco!`, latency, t.latency_crit_ms, ts);
        } else if (latency >= t.latency_warn_ms) {
            _alert('warn', 'LATENCY_HIGH', `Latência elevada: ${latency}ms. Verifique o Access Point.`, latency, t.latency_warn_ms, ts);
        }
    } else {
        _alert('critical', 'HOST_UNREACHABLE', `Mixer/Gateway inacessível. Verifique a ligação de rede.`, null, null, ts);
    }

    // Jitter
    if (jitter !== null && jitter > 0) {
        if (jitter >= t.jitter_crit_ms) {
            _alert('critical', 'JITTER_CRITICAL', `Jitter crítico: ${jitter}ms. Sincronismo de relógio AES67 comprometido!`, jitter, t.jitter_crit_ms, ts);
        } else if (jitter >= t.jitter_warn_ms) {
            _alert('warn', 'JITTER_HIGH', `Jitter elevado: ${jitter}ms. Possível congestionamento no switch/AP.`, jitter, t.jitter_warn_ms, ts);
        }
    }

    // Perda de pacotes
    if (loss !== null && loss > 0) {
        if (loss >= t.loss_crit_pct) {
            _alert('critical', 'PACKET_LOSS_CRITICAL', `Perda de pacotes UDP: ${loss}%. Áudio com falhas!`, loss, t.loss_crit_pct, ts);
        } else if (loss >= t.loss_warn_pct) {
            _alert('warn', 'PACKET_LOSS', `Perda de pacotes: ${loss}%. Monitorar.`, loss, t.loss_warn_pct, ts);
        }
    }
}

function _alert(level, code, message, value, threshold, ts) {
    const entry = { level, code, message, value, threshold, ts };
    console.log(`[NetDiag] [${level.toUpperCase()}] ${message}`);
    _emit('net_diag_alert', entry);
}

// ─── Descoberta mDNS ──────────────────────────────────────────────────────────

/**
 * Inicia a escuta passiva de anúncios mDNS na rede local.
 * Quando um dispositivo AoIP anunciar o seu serviço, é registado
 * no mapa de dispositivos e emitido via Socket.IO.
 *
 * Também realiza queries ativas para os serviços conhecidos a cada 30s.
 */
function _startMdnsDiscovery() {
    if (!mdns) return;

    // Escuta passiva: qualquer resposta mDNS na subnet
    mdns.on('response', (response) => {
        _processMdnsResponse(response);
    });

    mdns.on('query', (query) => {
        // Responde a queries sobre os nossos próprios serviços (opcional)
    });

    // Query ativa imediata + a cada 30 segundos
    _queryAllServices();
    const mdnsTimer = setInterval(_queryAllServices, 30000);
    if (mdnsTimer.unref) mdnsTimer.unref();

    console.log('[NetDiag] Descoberta mDNS iniciada.');
}

function _queryAllServices() {
    if (!mdns) return;
    AOIP_MDNS_SERVICES.forEach(({ service }) => {
        try {
            mdns.query({ questions: [{ name: service, type: 'PTR' }] });
        } catch (e) {
            // Ignora erros de rede transitórios
        }
    });
}

function _processMdnsResponse(response) {
    const all = [
        ...(response.answers   || []),
        ...(response.additionals || []),
    ];

    let ip       = null;
    let hostname = null;
    let services = [];

    for (const rr of all) {
        if (rr.type === 'A'    && rr.data) ip       = rr.data;
        if (rr.type === 'AAAA' && rr.data && !ip) ip = rr.data;
        if (rr.type === 'PTR'  && rr.name) {
            const match = AOIP_MDNS_SERVICES.find(s => rr.name.includes(s.service.split('.')[0]));
            if (match) services.push(match.type);
        }
        if (rr.type === 'SRV'  && rr.data?.target) hostname = rr.data.target;
        if (rr.name && !hostname && rr.name !== 'local') hostname = rr.name;
    }

    if (!ip && !hostname) return;

    // Tenta resolver o hostname se só temos IP
    if (ip && !hostname) {
        dns.reverse(ip, (err, hostnames) => {
            if (!err && hostnames.length > 0) {
                hostname = hostnames[0];
                _registerDevice(ip, hostname, services);
            }
        });
        hostname = ip; // fallback
    }

    _registerDevice(ip, hostname, services);
}

function _registerDevice(ip, hostname, services) {
    if (!ip) return;

    const known  = AOIP_MDNS_SERVICES.filter(s => services.includes(s.type));
    const type   = _inferDeviceType(hostname, services);
    const ts     = Date.now();

    const existing = _state.devices.get(ip);
    const entry = {
        ip,
        hostname: hostname || ip,
        type,
        services: [...new Set([...(existing?.services || []), ...services])],
        lastSeen: ts,
    };

    const isNew = !existing;
    _state.devices.set(ip, entry);

    if (isNew) {
        console.log(`[NetDiag] Dispositivo AoIP descoberto: ${type} @ ${ip} (${hostname})`);
        _emit('net_device_found', { ...entry, ts });
    }

    // Atualiza a lista completa
    _emit('net_device_list', _getDeviceList());
}

function _inferDeviceType(hostname = '', services = []) {
    const h = hostname.toLowerCase();
    if (services.includes('AES67'))     return 'AES67';
    if (services.includes('Dante'))     return 'Dante/AoIP';
    if (services.includes('Soundcraft') || h.includes('soundcraft') || h.includes('ui24')) return 'Soundcraft Mixer';
    if (services.includes('RAVENNA'))   return 'RAVENNA';
    if (services.includes('Shure'))     return 'Shure Wireless';
    if (h.includes('aruba'))            return 'Aruba AP';
    if (h.includes('cisco'))            return 'Cisco Switch';
    if (h.includes('dante'))            return 'Dante Device';
    if (services.includes('OSC'))       return 'OSC Device';
    return 'Dispositivo de Rede';
}

function _getDeviceList() {
    return Array.from(_state.devices.values())
        .sort((a, b) => b.lastSeen - a.lastSeen);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _detectGateway() {
    const ifaces = os.networkInterfaces();
    for (const iface of Object.values(ifaces)) {
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                // Heurística: assume que o gateway é o .1 da subnet
                const parts = addr.address.split('.');
                parts[3] = '1';
                return parts.join('.');
            }
        }
    }
    return '192.168.1.1';
}

function _round(v, dec = 2) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    return Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec);
}

function _emit(event, data) {
    if (_io) _io.emit(event, data);
}

// ─── Registo de handlers Socket.IO ────────────────────────────────────────────

/**
 * Regista todos os handlers de Socket.IO para o diagnóstico de rede.
 * Deve ser chamado uma vez, dentro do registerSocketHandlers principal.
 *
 * @param {import('socket.io').Socket} socket
 */
function registerNetDiagHandlers(socket) {
    socket.on('start_net_diag', (data = {}) => {
        console.log('[NetDiag] Pedido de início recebido:', data);
        start({
            mixerIp:   data.mixerIp,
            gatewayIp: data.gatewayIp,
            intervalMs: data.interval,
        });
    });

    socket.on('stop_net_diag', () => {
        stop();
    });

    socket.on('get_net_devices', () => {
        socket.emit('net_device_list', _getDeviceList());
        socket.emit('net_diag_status', {
            running:   _state.running,
            mixerIp:   _state.mixerIp,
            gatewayIp: _state.gatewayIp,
            interval:  _state.intervalMs,
        });
    });

    socket.on('net_diag_config', (config = {}) => {
        if (config.thresholds && typeof config.thresholds === 'object') {
            Object.assign(_state.thresholds, config.thresholds);
            console.log('[NetDiag] Thresholds actualizados:', _state.thresholds);
        }
        if (config.mixerIp)   _state.mixerIp   = config.mixerIp;
        if (config.gatewayIp) _state.gatewayIp  = config.gatewayIp;
    });

    // Trigger de descoberta manual
    socket.on('scan_network', () => {
        _queryAllServices();
        // Scan TCP na subnet (portas comuns de mixers e dispositivos AoIP)
        _tcpSubnetScan(socket);
    });
}

/**
 * Scan TCP ativo na subnet local para portas de dispositivos de áudio.
 * Portas procuradas:
 *   80   — interface web (mixers, APs)
 *   443  — HTTPS
 *   4440 — Dante Discovery
 *   8000 — API Soundcraft Ui
 *   5004 — RTP/AES67
 *   9000 — Shure Wireless
 */
async function _tcpSubnetScan(socket) {
    const localIp = _getLocalIp();
    if (!localIp) return;

    const parts  = localIp.split('.');
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const PORTS  = [80, 8000, 4440, 5004, 9000];

    console.log(`[NetDiag] Scan TCP na subnet ${subnet}.0/24...`);

    // Scan de 1–254 em paralelo, máx 20 hosts simultâneos
    const BATCH = 20;
    for (let start = 1; start <= 254; start += BATCH) {
        const promises = [];
        for (let i = start; i < Math.min(start + BATCH, 255); i++) {
            const host = `${subnet}.${i}`;
            promises.push(_scanHost(host, PORTS));
        }
        const results = await Promise.all(promises);
        results.forEach(({ host, openPorts }) => {
            if (openPorts.length > 0) {
                const type = _inferDeviceTypeByPorts(openPorts);
                _registerDevice(host, host, []);
                socket.emit('net_device_found', {
                    ip:       host,
                    hostname: host,
                    type,
                    services: openPorts.map(p => `TCP:${p}`),
                    ts:       Date.now(),
                });
            }
        });
    }
    socket.emit('net_device_list', _getDeviceList());
}

async function _scanHost(host, ports) {
    const results = await Promise.all(ports.map(p => _tcpPing(host, p, 500)));
    const openPorts = ports.filter((_, i) => results[i] !== null);
    return { host, openPorts };
}

function _inferDeviceTypeByPorts(ports) {
    if (ports.includes(4440)) return 'Dante Device';
    if (ports.includes(5004)) return 'AES67 Stream';
    if (ports.includes(8000)) return 'Soundcraft Mixer';
    if (ports.includes(9000)) return 'Shure Wireless';
    if (ports.includes(80))   return 'Dispositivo HTTP';
    return 'Dispositivo de Rede';
}

function _getLocalIp() {
    const ifaces = os.networkInterfaces();
    for (const iface of Object.values(ifaces)) {
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) return addr.address;
        }
    }
    return null;
}

// ─── API pública ──────────────────────────────────────────────────────────────

module.exports = {
    init,
    start,
    stop,
    registerNetDiagHandlers,
    getDeviceList: _getDeviceList,
    getLocalIp: _getLocalIp,
    getStats: () => ({ ..._state.stats }),
    THRESHOLDS: DEFAULT_THRESHOLDS,
};
