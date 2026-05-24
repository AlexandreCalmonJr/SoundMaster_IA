const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mixerSingleton = require('./mixer-singleton');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const db = require('./database');
const authDb = require('./auth-db');
const { registerMappingsRoutes } = require('./mappings-routes');
const { registerSocketHandlers } = require('./socket-handlers');
const { registerAuthRoutes } = require('./auth.routes');
const calculationRoutes = require('./calculation-routes');
const mixerGit = require('./mixer-git');
const { createMixerActions } = require('./mixer-actions');
const tunnelService = require('./tunnel-service');
const Logger = require('./logger');

function createAppServer({ app, rootDir, localIp, port, dbDir }) {
    const logger = Logger.getInstance(dbDir);
    const expressApp = express();
    const server = http.createServer(expressApp);
    const PYTHON_PORT = parseInt(process.env.PYTHON_PORT || '3002', 10);
    const AI_API_KEY = process.env.AI_API_KEY;

    const ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        `http://${localIp}:3000`,
        `http://${localIp}:3001`,
        process.env.FRONTEND_URL || "http://localhost:3000"
    ];

    expressApp.use(cors({
        origin: ALLOWED_ORIGINS,
        credentials: true
    }));

    // Rate Limiting para a API
    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutos
        max: 100, // limite de 100 requisições por IP
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Muitas requisições vindo deste IP, tente novamente após 15 minutos' }
    });
    expressApp.use('/api/', apiLimiter);

    expressApp.use(express.static(path.join(rootDir, 'frontend')));
    expressApp.use(express.json());

    // Inicializa banco centralizado IMEDIATAMENTE (presets + mappings no mesmo diretório)
    db.initDatabase(dbDir);
    authDb.initDatabase(dbDir);
    mixerGit.init(dbDir);
    registerMappingsRoutes(expressApp, db.mappings);
    registerAuthRoutes(expressApp);
    expressApp.use('/api/calculate', calculationRoutes);

    // ── Mixer Git REST API ───────────────────────────────────────────────────
    expressApp.get('/api/git/commits', async (req, res) => {
        try { res.json(await mixerGit.list(parseInt(req.query.limit) || 50)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.get('/api/git/commits/:id', async (req, res) => {
        try {
            const c = await mixerGit.getById(req.params.id);
            if (!c) return res.status(404).json({ error: 'Commit não encontrado' });
            res.json(c);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.post('/api/git/commits', async (req, res) => {
        try {
            const { label, auto } = req.body || {};
            const state = mixerSingleton.getStateTree();
            const commit = await mixerGit.commit(label || 'Commit manual', !!auto, state);
            res.json(commit);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.delete('/api/git/commits/:id', async (req, res) => {
        try { res.json(await mixerGit.deleteById(req.params.id)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.get('/api/git/diff/:idA/:idB', async (req, res) => {
        try { res.json(await mixerGit.diffById(req.params.idA, req.params.idB)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.get('/api/git/diff/:id', async (req, res) => {
        try {
            const current = mixerSingleton.getStateTree();
            res.json(await mixerGit.diffWithCurrent(req.params.id, current));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.post('/api/git/rollback/:id', async (req, res) => {
        try {
            const { scope } = req.body || {};
            const current   = mixerSingleton.getStateTree();
            const commands  = await mixerGit.buildRollbackCommands(req.params.id, current, scope || []);
            
            // Executa cada comando diretamente na mesa (ou emulador)
            const actions = createMixerActions(() => mixerSingleton.getMixer());
            const applied = [];
            commands.forEach(cmd => {
                try {
                    let actionCmd = null;
                    if (cmd.event === 'set_master_level') {
                        actionCmd = { action: 'set_master_level', level: cmd.data.level };
                    } else if (cmd.event === 'set_master_mute') {
                        actionCmd = { action: 'master_mute', enabled: cmd.data.mute };
                    } else if (cmd.event === 'set_channel_param') {
                        const { channel, param, value } = cmd.data;
                        if (param === 'level') {
                            actionCmd = { action: 'channel_fader', channel, level: value };
                        } else if (param === 'mute') {
                            actionCmd = { action: 'channel_mute', channel, enabled: value };
                        } else if (param === 'phantom') {
                            actionCmd = { action: 'set_phantom', input: channel, enabled: value };
                        } else if (param === 'hpf') {
                            actionCmd = { action: 'apply_channel_hpf', channel, hz: value };
                        } else if (param === 'gate') {
                            actionCmd = { action: 'apply_channel_gate', channel, enabled: value };
                        } else if (param === 'delay') {
                            actionCmd = { action: 'set_delay', target: 'channel', channel, ms: value };
                        } else if (param === 'name') {
                            actionCmd = { action: 'set_channel_name', channel, name: value };
                        }
                    } else if (cmd.event === 'apply_eq_cut') {
                        actionCmd = { action: 'eq_cut', ...cmd.data };
                    } else if (cmd.event === 'set_aux_level') {
                        actionCmd = { action: 'set_aux_level', ...cmd.data };
                    }
                    
                    if (actionCmd) {
                        actions.executeMixerCommand(actionCmd);
                        applied.push(actionCmd);
                    }
                } catch (err) {
                    logger.error('rollback', 'APPLY_COMMAND_FAIL', { cmd, error: err.message });
                }
            });

            // Emite cada comando via Socket.IO para sincronização visual dos clientes
            const io = mixerSingleton.getIo();
            if (io) commands.forEach(cmd => io.emit(cmd.event, cmd.data));
            
            res.json({ commands: commands.length, applied: applied });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.get('/api/config', (req, res) => {
        res.json({ localIp, port, tunnelUrl: tunnelService.getTunnelUrl() });
    });

    expressApp.post('/api/tunnel/toggle', async (req, res) => {
        try {
            const result = await tunnelService.toggleTunnel(port);
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Rotas de Calibração (NeDB)
    expressApp.get('/api/calibration', (req, res) => {
        db.settings.findOne({ type: 'calibration' }, (err, doc) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(doc || { calibrationData: [], splOffset: 0 });
        });
    });

    expressApp.post('/api/calibration', (req, res) => {
        const { calibrationData, splOffset, name } = req.body;
        db.settings.update(
            { type: 'calibration' },
            { $set: { calibrationData, splOffset, name: name || 'Customizado', timestamp: Date.now() } },
            { upsert: true },
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            }
        );
    });

    // Proxy para IA (permite acesso mobile)
    expressApp.post('/api/ai', async (req, res) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const payload = req.body;
            const targetCh = payload.channel || (payload.analysis && payload.analysis.channel);
            const targetAux = payload.aux;
            
            payload.mixer_context = {
                master: mixerSingleton.getMasterState(),
                channel: targetCh ? mixerSingleton.getChannelState(targetCh) : null,
                aux: targetAux ? mixerSingleton.getAuxState(targetAux) : null,
                full_state: mixerSingleton.getStateTree(),
                timestamp: Date.now()
            };

            const headers = { 'Content-Type': 'application/json' };
            if (AI_API_KEY) headers['X-API-Key'] = AI_API_KEY;
            const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/chat`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeout);
            const data = await aiRes.json();
            res.json(data);
        } catch (error) {
            clearTimeout(timeout);
            if (error.name === 'AbortError') {
                res.status(504).json({ error: 'IA demorou demais para responder (timeout)' });
            } else {
                res.status(500).json({ error: 'IA offline' });
            }
        }
    });

    expressApp.get('/api/ai/health', async (req, res) => {
        try {
            const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/`);
            const data = await aiRes.json();
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'IA offline' });
        }
    });



    expressApp.post('/api/acoustic_analysis', async (req, res) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const hdrsAcoustic = { 'Content-Type': 'application/json' };
            if (AI_API_KEY) hdrsAcoustic['X-API-Key'] = AI_API_KEY;
            const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/acoustic_analysis`, {
                method: 'POST',
                headers: hdrsAcoustic,
                body: JSON.stringify(req.body),
                signal: controller.signal
            });
            clearTimeout(timeout);
            const data = await aiRes.json();
            res.json(data);
        } catch (error) {
            clearTimeout(timeout);
            if (error.name === 'AbortError') {
                res.status(504).json({ error: 'Motor de Acústica demorou demais (timeout)' });
            } else {
                res.status(500).json({ error: 'Motor de Acústica offline' });
            }
        }
    });

    // Diagnóstico Preditivo de Hardware (proxy → Python AI Engine)
    expressApp.post('/api/hardware_diagnosis', async (req, res) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
            const hdrsHw = { 'Content-Type': 'application/json' };
            if (AI_API_KEY) hdrsHw['X-API-Key'] = AI_API_KEY;
            const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/hardware_diagnosis`, {
                method:  'POST',
                headers: hdrsHw,
                body:    JSON.stringify(req.body),
                signal:  controller.signal
            });
            clearTimeout(timeout);
            res.json(await aiRes.json());
        } catch (error) {
            clearTimeout(timeout);
            res.status(error.name === 'AbortError' ? 504 : 500)
               .json({ error: error.name === 'AbortError' ? 'Timeout no diagnóstico' : 'Motor Python offline' });
        }
    });

    // Mapeamento de nomes de canais e auxiliares
    expressApp.get('/api/mixer/names', async (req, res) => {
        try {
            db.settings.findOne({ type: 'mixer_names' }, (err, doc) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(doc ? doc.names : { channels: {}, aux: {} });
            });
        } catch (error) {
            res.status(500).json({ error: 'Falha ao ler nomes' });
        }
    });

    expressApp.post('/api/mixer/names', async (req, res) => {
        try {
            const names = req.body; // { channels: {...}, aux: {...} }
            db.settings.update({ type: 'mixer_names' }, { $set: { names: names } }, { upsert: true }, (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
        } catch (error) {
            res.status(500).json({ error: 'Falha ao salvar nomes' });
        }
    });

    const io = new Server(server, {
        cors: {
            origin: ALLOWED_ORIGINS,
            methods: ['GET', 'POST'],
            credentials: true
        },
        maxHttpBufferSize: 1e6,
        pingTimeout: 60000,
        pingInterval: 25000
    });

    // ── Tópico 25/29: injeta io no singleton e inicia monitors ─────────────
    mixerSingleton.setIo(io);
    mixerSingleton.startEventLoopMonitor((msg) => logger.warn('eventloop', 'MONITOR', { msg }));
    // Middleware de Autenticação para Socket.IO - IP Allowlist (P20)
    const ALLOWED_CLIENT_IPS = (process.env.ALLOWED_CLIENT_IPS || '192.168.0.0/16,10.0.0.0/8,127.0.0.1').split(',');

    function isIpAllowed(clientIp) {
        if (!clientIp) return false;
        const cleanIp = clientIp.replace(/^::ffff:/, '');
        if (cleanIp === '127.0.0.1' || cleanIp === '::1') return true;
        
        for (const range of ALLOWED_CLIENT_IPS) {
            const [baseIp, mask] = range.split('/');
            if (!mask) {
                if (cleanIp === baseIp) return true;
                continue;
            }
            if (ipMatchesCidr(cleanIp, baseIp, parseInt(mask))) return true;
        }
        return false;
    }

    function ipMatchesCidr(ip, baseIp, mask) {
        const ipParts = ip.split('.').map(Number);
        const baseParts = baseIp.split('.').map(Number);
        const maskBits = (~((1 << (32 - mask)) - 1)) >>> 0;
        
        const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
        const baseNum = (baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3];
        
        return (ipNum & maskBits) === (baseNum & maskBits);
    }

    io.use((socket, next) => {
        const clientIp = socket.handshake.address;
        if (!isIpAllowed(clientIp)) {
            logger.warn('socketio', 'CONNECTION_REJECTED', { ip: clientIp });
            return next(new Error('IP não autorizado. Contate o administrador.'));
        }
        logger.info('socketio', 'CLIENT_AUTHORIZED', { ip: clientIp });
        next();
    });

    registerSocketHandlers(io, dbDir);

    return { server, io };
}

module.exports = { createAppServer };
