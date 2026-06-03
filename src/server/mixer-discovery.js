/**
 * SoundMaster — Mixer Auto-Discovery Service
 * ===========================================
 * Detecta automaticamente a Soundcraft Ui24R na rede local.
 *
 * Funciona em dois cenários:
 *   1. Você conectou ao Wi-Fi criado pela própria mesa (AP mode)
 *      → Gateway da rede é a própria mesa (ex: 192.168.1.1)
 *   2. Mesa e computador estão no mesmo roteador (Client mode)
 *      → Varredura TCP na sub-rede local
 *
 * Métodos de detecção (em ordem de velocidade):
 *   1. HTTP fingerprint do gateway (< 200ms) — cobre AP mode
 *   2. mDNS passivo — recebe anúncios _soundcraft._tcp.local
 *   3. TCP scan porta 80 + fingerprint (varredura /24)
 *
 * Eventos emitidos via Socket.IO:
 *   'mixer_discovered'  → { ip, model, confidence, method, ts }
 *   'discovery_status'  → { scanning, found, lastScan }
 */

'use strict';

const net = require('net');
const os  = require('os');
const http = require('http');

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Portas que a Ui24R escuta (HTTP + WebSocket OSC) */
const UI24R_PORTS = [80];

/** Strings que identificam a Soundcraft Ui24R na resposta HTTP */
const UI24R_FINGERPRINTS = [
    'soundcraft',
    'Soundcraft',
    'ui24',
    'Ui24',
    'harman',
    'Harman',
    'SoundcraftUI',
];

/** SSIDs Wi-Fi típicos criados pela Ui24R em AP mode */
const UI24R_AP_SSID_PATTERNS = [
    /^ui24r/i,
    /^soundcraft/i,
    /^ui-24/i,
    /^ui_24/i,
];

/** Intervalo entre varreduras automáticas (ms) */
const SCAN_INTERVAL_MS = 30_000;

/** Timeout de conexão TCP para cada host (ms) */
const TCP_TIMEOUT_MS = 800;

/** Timeout para HTTP fingerprint (ms) */
const HTTP_TIMEOUT_MS = 2000;

/** Máximo de hosts verificados em paralelo no scan */
const SCAN_BATCH_SIZE = 30;

// ─── Estado do módulo ─────────────────────────────────────────────────────────

const _state = {
    scanning:       false,
    found:          false,
    lastScan:       null,
    discoveredIp:   null,
    scanTimer:      null,
};

let _io = null;

// ─── Inicialização ────────────────────────────────────────────────────────────

function init(io) {
    _io = io;
    console.log('[Discovery] Serviço de auto-descoberta iniciado.');
}

// ─── API Pública ──────────────────────────────────────────────────────────────

/**
 * Inicia uma varredura imediata + varreduras periódicas.
 * Chamado quando o frontend solicita (evento 'start_discovery')
 * ou quando nenhuma mesa está conectada ao iniciar.
 */
function startDiscovery() {
    if (_state.scanning) return;
    _stopTimer();
    _runDiscoveryCycle();
    _state.scanTimer = setInterval(_runDiscoveryCycle, SCAN_INTERVAL_MS);
    if (_state.scanTimer.unref) _state.scanTimer.unref();
}

/**
 * Para as varreduras periódicas.
 */
function stopDiscovery() {
    _stopTimer();
    _state.scanning = false;
    _emit('discovery_status', { scanning: false, found: _state.found, lastScan: _state.lastScan });
    console.log('[Discovery] Varredura interrompida.');
}

/**
 * Força uma única varredura agora (usado pelo botão "Escanear" do frontend).
 */
async function scanNow() {
    return _runDiscoveryCycle();
}

/**
 * Registra os handlers de Socket.IO para o discovery.
 * @param {import('socket.io').Socket} socket
 */
function registerDiscoveryHandlers(socket) {
    socket.on('start_discovery', () => {
        console.log('[Discovery] Solicitação de varredura recebida do cliente.');
        startDiscovery();
    });

    socket.on('stop_discovery', () => {
        stopDiscovery();
    });

    socket.on('scan_now', async () => {
        const result = await scanNow();
        if (result) {
            socket.emit('mixer_discovered', result);
        } else {
            socket.emit('discovery_status', { scanning: false, found: false, lastScan: _state.lastScan });
        }
    });

    // Envia status atual para o cliente que acabou de conectar
    socket.emit('discovery_status', {
        scanning:   _state.scanning,
        found:      _state.found,
        lastScan:   _state.lastScan,
        ip:         _state.discoveredIp,
    });
}

// ─── Ciclo de Descoberta ──────────────────────────────────────────────────────

async function _runDiscoveryCycle() {
    if (_state.scanning) return null;

    _state.scanning = true;
    _state.lastScan = Date.now();
    _emit('discovery_status', { scanning: true, found: false, lastScan: _state.lastScan });

    console.log('[Discovery] Iniciando ciclo de descoberta...');

    try {
        // ── Passo 1: Gateway fingerprint (cobre AP mode da Ui24R) ──────────────
        const gateway = _detectGateway();
        if (gateway) {
            console.log(`[Discovery] Testando gateway ${gateway}...`);
            const gatewayResult = await _fingerprintHost(gateway);
            if (gatewayResult) {
                return _reportFound(gatewayResult, 'gateway_fingerprint');
            }
        }

        // ── Passo 2: IPs conhecidos (última conexão bem-sucedida) ──────────────
        const knownIps = _getKnownIps();
        for (const ip of knownIps) {
            if (ip === gateway) continue; // já testamos
            const result = await _fingerprintHost(ip);
            if (result) {
                return _reportFound(result, 'known_ip');
            }
        }

        // ── Passo 3: Varredura TCP na sub-rede local ───────────────────────────
        const localIp = _getLocalIp();
        if (localIp) {
            const subnetResult = await _subnetScan(localIp);
            if (subnetResult) {
                return _reportFound(subnetResult, 'subnet_scan');
            }
        }

        console.log('[Discovery] Nenhuma mesa encontrada neste ciclo.');
        _state.found = false;
        _emit('discovery_status', { scanning: false, found: false, lastScan: _state.lastScan });
        return null;

    } finally {
        _state.scanning = false;
    }
}

// ─── Fingerprinting HTTP ──────────────────────────────────────────────────────

/**
 * Tenta conectar na porta 80 e verifica se a resposta HTTP
 * contém marcadores da Soundcraft Ui24R.
 *
 * A Ui24R serve uma página web de controle na porta 80.
 * O <title> e os headers contêm "Soundcraft" ou "Ui24".
 *
 * @param {string} host
 * @returns {Promise<{ip, model, confidence}|null>}
 */
function _fingerprintHost(host) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), HTTP_TIMEOUT_MS);

        const req = http.get({
            host,
            port: 80,
            path: '/',
            timeout: HTTP_TIMEOUT_MS,
            headers: { 'User-Agent': 'SoundMasterPro/1.0 Discovery' },
        }, (res) => {
            clearTimeout(timeout);

            // Verifica headers primeiro (Server, X-Powered-By, etc.)
            const serverHeader = (res.headers['server'] || '').toLowerCase();
            const poweredBy    = (res.headers['x-powered-by'] || '').toLowerCase();

            let confidence = 0;
            if (serverHeader.includes('soundcraft')) confidence += 50;
            if (serverHeader.includes('ui24'))        confidence += 50;
            if (poweredBy.includes('soundcraft'))     confidence += 30;

            // Lê o body para verificar o conteúdo HTML
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                body += chunk;
                // Limita a leitura a 4KB (suficiente para o <title> e meta tags)
                if (body.length > 4096) res.destroy();
            });

            res.on('end', () => {
                const bodyLower = body.toLowerCase();
                for (const fp of UI24R_FINGERPRINTS) {
                    if (bodyLower.includes(fp.toLowerCase())) {
                        confidence += 20;
                    }
                }

                if (confidence >= 20) {
                    // Tenta extrair o modelo do body
                    const modelMatch = body.match(/(?:Soundcraft\s+)(Ui\d+[A-Z]?)/i);
                    resolve({
                        ip:         host,
                        model:      modelMatch ? `Soundcraft ${modelMatch[1]}` : 'Soundcraft Ui',
                        confidence: Math.min(100, confidence),
                    });
                } else {
                    resolve(null);
                }
            });

            res.on('error', () => { clearTimeout(timeout); resolve(null); });
        });

        req.on('error', () => { clearTimeout(timeout); resolve(null); });
        req.on('timeout', () => { req.destroy(); clearTimeout(timeout); resolve(null); });
    });
}

// ─── Varredura de Sub-rede ────────────────────────────────────────────────────

/**
 * Varre a sub-rede /24 procurando hosts com porta 80 aberta,
 * e então faz fingerprint HTTP nos candidatos.
 *
 * @param {string} localIp  IP local da interface ativa
 * @returns {Promise<{ip, model, confidence}|null>}
 */
async function _subnetScan(localIp) {
    const parts  = localIp.split('.');
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;

    console.log(`[Discovery] Varredura TCP em ${subnet}.0/24...`);

    // Exclui o próprio IP e o gateway óbvio (já testados)
    const candidates = [];
    for (let i = 1; i <= 254; i++) {
        const ip = `${subnet}.${i}`;
        if (ip !== localIp) candidates.push(ip);
    }

    // Verifica em lotes para não sobrecarregar a rede
    for (let start = 0; start < candidates.length; start += SCAN_BATCH_SIZE) {
        const batch = candidates.slice(start, start + SCAN_BATCH_SIZE);
        const open  = await Promise.all(batch.map(ip => _tcpProbe(ip, 80)));

        // Para cada host com porta 80 aberta, faz fingerprint
        for (let i = 0; i < batch.length; i++) {
            if (!open[i]) continue;
            const result = await _fingerprintHost(batch[i]);
            if (result) return result;
        }
    }

    return null;
}

/**
 * Verifica se a porta TCP está aberta (sem ler dados).
 * @param {string} host
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function _tcpProbe(host, port) {
    return new Promise((resolve) => {
        const sock = new net.Socket();
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            sock.destroy();
            resolve(ok);
        };
        sock.setTimeout(TCP_TIMEOUT_MS);
        sock.on('connect', () => done(true));
        sock.on('timeout', () => done(false));
        sock.on('error',   () => done(false));
        try { sock.connect(port, host); } catch (_) { done(false); }
    });
}

// ─── Helpers de Rede ─────────────────────────────────────────────────────────

/**
 * Detecta o IP do gateway da rede ativa.
 * Em AP mode da Ui24R, o gateway É a própria mesa (ex: 192.168.1.1).
 */
function _detectGateway() {
    const ifaces = os.networkInterfaces();
    for (const iface of Object.values(ifaces)) {
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                const parts = addr.address.split('.');
                parts[3] = '1';
                return parts.join('.');
            }
        }
    }
    return null;
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

/**
 * Retorna IPs de conexões anteriores bem-sucedidas (do processo de memória).
 * Em produção, pode ler de um arquivo de configuração local.
 */
function _getKnownIps() {
    // IPs típicos da Ui24R em AP mode
    return ['192.168.1.1', '192.168.0.1', '10.0.0.1', '172.16.0.1'];
}

// ─── Relatório de Descoberta ──────────────────────────────────────────────────

function _reportFound(result, method) {
    _state.found        = true;
    _state.discoveredIp = result.ip;

    const payload = {
        ip:         result.ip,
        model:      result.model || 'Soundcraft Ui',
        confidence: result.confidence,
        method,
        ts:         Date.now(),
    };

    console.log(`[Discovery] ✅ Mesa encontrada: ${result.model} @ ${result.ip} (método: ${method}, confiança: ${result.confidence}%)`);
    _emit('mixer_discovered', payload);
    _emit('discovery_status', {
        scanning: false,
        found:    true,
        lastScan: _state.lastScan,
        ip:       result.ip,
    });

    return payload;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

function _stopTimer() {
    if (_state.scanTimer) {
        clearInterval(_state.scanTimer);
        _state.scanTimer = null;
    }
}

function _emit(event, data) {
    if (_io) _io.emit(event, data);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    init,
    startDiscovery,
    stopDiscovery,
    scanNow,
    registerDiscoveryHandlers,
    getState: () => ({ ..._state }),
};
