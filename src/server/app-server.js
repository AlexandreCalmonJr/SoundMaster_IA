const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const mixerSingleton = require('./mixer-singleton');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const db = require('./database');
const authDb = require('./auth-db');
const { registerMappingsRoutes } = require('./mappings-routes');
const { registerSocketHandlers } = require('./socket-handlers');
const { registerAuthRoutes, extractToken } = require('./auth.routes');
const { JWT_SECRET } = require('./jwt-config');
const calculationRoutes = require('./calculation-routes');
const mixerGit = require('./mixer-git');
const { createMixerActions } = require('./mixer-actions');
const tunnelService = require('./tunnel-service');
const Logger = require('./logger');
const fs = require('fs');
const multer = require('multer');

function createAppServer({ rootDir, localIp, port, dbDir }) {
    const logger = Logger.getInstance(dbDir);
    Logger.installConsoleProxy();
    const expressApp = express();
    const server = http.createServer(expressApp);
    const PYTHON_PORT = parseInt(process.env.PYTHON_PORT || '3002', 10);
    const AI_API_KEY = process.env.AI_API_KEY;

    const uploadsDir = path.join(dbDir, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const upload = multer({ dest: uploadsDir, limits: { fileSize: 50 * 1024 * 1024 } });

    // M21: Extensões de áudio permitidas (somente WAV — Python só aceita RIFF/WAVE)
    const AUDIO_EXTENSIONS = ['.wav'];

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

    expressApp.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
                scriptSrcAttr: ["'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "blob:", "https://api.qrserver.com"],
                connectSrc: ["'self'", "ws:", "wss:", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
                upgradeInsecureRequests: null,
            }
        },
        hsts: false
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

    // Rota raiz → auth.html (gate de autenticação standalone ou JSON de status para mobile)
    expressApp.get('/', (req, res) => {
        if (req.headers['accept'] && req.headers['accept'].includes('application/json')) {
            return res.json({ status: "online", version: "1.0.0", message: "SoundMaster Pro Backend" });
        }
        res.sendFile(path.join(rootDir, 'frontend', 'auth.html'));
    });

    expressApp.use(express.static(path.join(rootDir, 'frontend')));
    expressApp.use('/docs', express.static(path.join(rootDir, 'docs')));
    expressApp.use(express.json({ limit: '50mb' }));
    expressApp.use(express.urlencoded({ limit: '50mb', extended: true }));

    // Middleware de autenticação JWT (lê do header Authorization OU do cookie httpOnly)
    const { authenticateToken } = require('./auth.routes');

    // Inicializa banco centralizado IMEDIATAMENTE (presets + mappings no mesmo diretório)
    db.initDatabase(dbDir);
    authDb.initDatabase(dbDir);
    mixerGit.init(dbDir);
    registerMappingsRoutes(expressApp, db.mappings, authenticateToken);
    registerAuthRoutes(expressApp);
    expressApp.use('/api/calculate', calculationRoutes);

    // ── Mixer Git REST API (protegidas) ──────────────────────────────────────
    expressApp.get('/api/git/commits', authenticateToken, async (req, res) => {
        try { res.json(await mixerGit.list(parseInt(req.query.limit) || 50)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.get('/api/git/commits/:id', authenticateToken, async (req, res) => {
        try {
            const c = await mixerGit.getById(req.params.id);
            if (!c) return res.status(404).json({ error: 'Commit não encontrado' });
            res.json(c);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.post('/api/git/commits', authenticateToken, async (req, res) => {
        try {
            const { label, auto } = req.body || {};
            const state = mixerSingleton.getStateTree();
            const commit = await mixerGit.commit(label || 'Commit manual', !!auto, state);
            res.json(commit);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.delete('/api/git/commits/:id', authenticateToken, async (req, res) => {
        try { res.json(await mixerGit.deleteById(req.params.id)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.get('/api/git/diff/:idA/:idB', authenticateToken, async (req, res) => {
        try { res.json(await mixerGit.diffById(req.params.idA, req.params.idB)); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.get('/api/git/diff/:id', authenticateToken, async (req, res) => {
        try {
            const current = mixerSingleton.getStateTree();
            res.json(await mixerGit.diffWithCurrent(req.params.id, current));
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    expressApp.post('/api/git/rollback/:id', authenticateToken, async (req, res) => {
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

    expressApp.post('/api/tunnel/toggle', authenticateToken, async (req, res) => {
        try {
            const result = await tunnelService.toggleTunnel(port);
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Rotas de Calibração (NeDB)
    expressApp.get('/api/calibration', authenticateToken, (req, res) => {
        db.settings.findOne({ type: 'calibration' }, (err, doc) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(doc || { calibrationData: [], splOffset: 0 });
        });
    });

    expressApp.post('/api/calibration', authenticateToken, (req, res) => {
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
    expressApp.post('/api/ai', authenticateToken, async (req, res) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        try {
            const payload = req.body;
            const targetCh = payload.channel || (payload.analysis && payload.analysis.channel);
            const targetAux = payload.aux;
            
            payload.mixer_context = {
                master: mixerSingleton.getMasterState(),
                channel: targetCh ? mixerSingleton.getChannelState(targetCh) : null,
                aux: targetAux ? mixerSingleton.getAuxState(targetAux) : null,
                full_state: mixerSingleton.getStateTree(),
                all_vus: mixerSingleton.getState().vuData || null,
                classification: payload.analysis?.live_mic?.classification || null,
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

    expressApp.get('/api/ai/health', authenticateToken, async (req, res) => {
        try {
            const hdrs = {};
            if (AI_API_KEY) hdrs['X-API-Key'] = AI_API_KEY;
            const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/`, { headers: hdrs });
            const data = await aiRes.json();
            res.status(aiRes.status).json(data);
        } catch (error) {
            res.status(500).json({ error: 'IA offline' });
        }
    });

    expressApp.get('/api/ai/diagnose', authenticateToken, async (req, res) => {
        try {
            const hdrs = {};
            if (AI_API_KEY) hdrs['X-API-Key'] = AI_API_KEY;
            const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/diagnose`, { headers: hdrs });
            const data = await aiRes.json();
            res.status(aiRes.status).json(data);
        } catch (error) {
            res.status(500).json({ error: 'IA offline' });
        }
    });

    expressApp.post('/api/ai/classify', authenticateToken, async (req, res) => {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (AI_API_KEY) headers['X-API-Key'] = AI_API_KEY;
            const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/api/ai/classify`, {
                method: 'POST',
                headers,
                body: JSON.stringify(req.body),
                signal: AbortSignal.timeout(10000)
            });
            const data = await aiRes.json();
            res.status(aiRes.status).json(data);
        } catch (error) {
            res.status(500).json({ error: 'Classify offline' });
        }
    });

    // ── AI Model Management Proxy ──────────────────────────────────────────────
    const _proxyAIModel = async (method, pythonPath, body) => {
        const headers = { 'Content-Type': 'application/json' };
        if (AI_API_KEY) headers['X-API-Key'] = AI_API_KEY;
        const opts = { method, headers, signal: AbortSignal.timeout(30000) };
        if (body) opts.body = JSON.stringify(body);
        const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}${pythonPath}`, opts);
        return aiRes.json();
    };

    expressApp.get('/api/models', authenticateToken, async (req, res) => {
        try { res.json(await _proxyAIModel('GET', '/api/models')); }
        catch (e) { res.status(500).json({ error: 'IA offline' }); }
    });

    expressApp.post('/api/models/select', authenticateToken, async (req, res) => {
        try {
            const result = await _proxyAIModel('POST', '/api/models/select', req.body);
            // Reinicia o servidor Python para aplicar o novo modelo
            if (result.success) {
                const pythonAi = require('./python-ai');
                // Não mata o processo — o Python detecta a mudança no próximo request
                console.log('[AppServer] Modelo alterado para:', req.body.model);
            }
            res.json(result);
        } catch (e) { res.status(500).json({ error: 'IA offline' }); }
    });

    expressApp.post('/api/models/download', authenticateToken, async (req, res) => {
        try { res.json(await _proxyAIModel('POST', '/api/models/download', req.body)); }
        catch (e) { res.status(500).json({ error: 'IA offline' }); }
    });

    expressApp.get('/api/models/download/status', authenticateToken, async (req, res) => {
        try { res.json(await _proxyAIModel('GET', '/api/models/download/status')); }
        catch (e) { res.json({ active: false, completed: false, error: 'IA offline' }); }
    });

    expressApp.post('/api/ollama/config', authenticateToken, async (req, res) => {
        try { res.json(await _proxyAIModel('POST', '/api/ollama/config', req.body)); }
        catch (e) { res.status(500).json({ error: 'IA offline' }); }
    });

    // Chat History Persistence (NeDB)
    expressApp.post('/api/chat/save/:session_id', authenticateToken, (req, res) => {
        try {
            const { session_id } = req.params;
            const { messages } = req.body;
            if (!Array.isArray(messages)) {
                return res.status(400).json({ error: 'messages must be an array' });
            }
            db.settings.update(
                { type: 'chat_history_' + session_id },
                { $set: { messages: messages.slice(-100), timestamp: Date.now() } },
                { upsert: true },
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                }
            );
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    expressApp.get('/api/chat/load/:session_id', authenticateToken, (req, res) => {
        try {
            const { session_id } = req.params;
            db.settings.findOne({ type: 'chat_history_' + session_id }, (err, doc) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(doc || { messages: [] });
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // Rota de Healthcheck (única)
    expressApp.get('/api/health', (req, res) => {
        res.json({ status: "online", message: "Healthy" });
    });

    // Rota de Processamento de Áudio
    expressApp.post('/api/audio/process', authenticateToken, upload.single('file'), async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }
        // M21: Valida extensão do arquivo
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!AUDIO_EXTENSIONS.includes(ext)) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: 'Formato de áudio não suportado. Envie WAV, MP3, AIFF, FLAC, OGG, M4A ou AAC.' });
        }
        try {
            const { effect, intensity } = req.body;
            
            const formData = new FormData();
            const blob = new Blob([fs.readFileSync(req.file.path)], { type: req.file.mimetype });
            formData.append('file', blob, req.file.originalname);
            formData.append('effect', effect || 'denoise');
            if (intensity !== undefined) {
                formData.append('intensity', intensity.toString());
            }

            const headers = {};
            if (AI_API_KEY) headers['X-API-Key'] = AI_API_KEY;

            const response = await fetch(`http://127.0.0.1:${PYTHON_PORT}/process`, {
                method: 'POST',
                headers,
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Python server error (${response.status}): ${errText}`);
            }

            res.setHeader('Content-Type', 'audio/wav');
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            res.send(buffer);
        } catch (error) {
            logger.error('appserver', 'AUDIO_PROCESS_ERROR', { error: error.message });
            res.status(500).json({ error: error.message });
        } finally {
            fs.unlink(req.file.path, () => {});
        }
    });

    // Rota de Realce de Áudio (Enhance)
    expressApp.post('/api/audio/enhance', authenticateToken, upload.single('file'), async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!AUDIO_EXTENSIONS.includes(ext)) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: 'Formato de áudio não suportado.' });
        }
        try {
            const { effect } = req.body;
            
            const formData = new FormData();
            const blob = new Blob([fs.readFileSync(req.file.path)], { type: req.file.mimetype });
            formData.append('file', blob, req.file.originalname);
            formData.append('effect', effect || 'denoise');

            const headers = {};
            if (AI_API_KEY) headers['X-API-Key'] = AI_API_KEY;

            const response = await fetch(`http://127.0.0.1:${PYTHON_PORT}/enhance`, {
                method: 'POST',
                headers,
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Python server error (${response.status}): ${errText}`);
            }

            res.setHeader('Content-Type', 'audio/wav');
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            res.send(buffer);
        } catch (error) {
            logger.error('appserver', 'AUDIO_ENHANCE_ERROR', { error: error.message });
            res.status(500).json({ error: error.message });
        } finally {
            fs.unlink(req.file.path, () => {});
        }
    });

    // Rota de Transcrição de Áudio (Transcribe)
    expressApp.post('/api/audio/transcribe', authenticateToken, upload.single('file'), async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!AUDIO_EXTENSIONS.includes(ext)) {
            fs.unlink(req.file.path, () => {});
            return res.status(400).json({ error: 'Formato de áudio não suportado.' });
        }
        try {
            const formData = new FormData();
            const blob = new Blob([fs.readFileSync(req.file.path)], { type: req.file.mimetype });
            formData.append('file', blob, req.file.originalname);

            const headers = {};
            if (AI_API_KEY) headers['X-API-Key'] = AI_API_KEY;

            const response = await fetch(`http://127.0.0.1:${PYTHON_PORT}/transcribe`, {
                method: 'POST',
                headers,
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Python server error (${response.status}): ${errText}`);
            }

            const data = await response.json();
            res.json(data);
        } catch (error) {
            logger.error('appserver', 'AUDIO_TRANSCRIBE_ERROR', { error: error.message });
            res.status(500).json({ error: error.message });
        } finally {
            fs.unlink(req.file.path, () => {});
        }
    });



    expressApp.post('/api/acoustic_analysis', authenticateToken, async (req, res) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
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
    expressApp.post('/api/hardware_diagnosis', authenticateToken, async (req, res) => {
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

    // Proxy para /train e /api/ai/train (feedback do usuário → Python AI Engine)
    // Ambas as rotas injetam X-API-Key automaticamente antes de chamar o Python.
    async function _proxyTrain(req, res) {
        try {
            const hdrs = { 'Content-Type': 'application/json' };
            if (AI_API_KEY) hdrs['X-API-Key'] = AI_API_KEY;
            const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/train`, {
                method: 'POST',
                headers: hdrs,
                body: JSON.stringify(req.body),
                signal: AbortSignal.timeout(10000)
            });
            res.status(aiRes.status).json(await aiRes.json());
        } catch (error) {
            res.status(500).json({ error: 'Treinamento offline' });
        }
    }
    expressApp.post('/train', authenticateToken, _proxyTrain);
    expressApp.post('/api/ai/train', authenticateToken, _proxyTrain);

    // Mapeamento de nomes de canais e auxiliares
    expressApp.get('/api/mixer/names', authenticateToken, async (req, res) => {
        try {
            db.settings.findOne({ type: 'mixer_names' }, (err, doc) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(doc ? doc.names : { channels: {}, aux: {} });
            });
        } catch (error) {
            res.status(500).json({ error: 'Falha ao ler nomes' });
        }
    });

    expressApp.post('/api/mixer/names', authenticateToken, async (req, res) => {
        try {
            const names = req.body;
            if (!names || typeof names !== 'object' || Array.isArray(names)) {
                return res.status(400).json({ error: 'Corpo deve ser um objeto JSON' });
            }
            const valid = { channels: {}, aux: {} };
            for (const section of ['channels', 'aux']) {
                const input = names[section];
                if (input && typeof input === 'object' && !Array.isArray(input)) {
                    for (const [key, val] of Object.entries(input)) {
                        if (typeof key !== 'string' || key.length > 50) continue;
                        const sanitized = typeof val === 'string'
                            ? val.replace(/<[^>]*>/g, '').slice(0, 100)
                            : '';
                        valid[section][key] = sanitized;
                    }
                }
            }
            db.settings.update({ type: 'mixer_names' }, { $set: { names: valid } }, { upsert: true }, (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            });
        } catch (error) {
            res.status(500).json({ error: 'Falha ao salvar nomes' });
        }
    });

    expressApp.post('/api/mixer/command', authenticateToken, express.json(), (req, res) => {
        try {
            const cmd = req.body;
            const actions = createMixerActions(() => mixerSingleton.getMixer());
            const result = actions.executeMixerCommand(cmd);
            const socketIo = mixerSingleton.getIo();
            if (socketIo) {
                if (cmd.action === 'set_master_level' || cmd.action === 'master_level') {
                    socketIo.emit('set_master_level', { level: cmd.level });
                } else if (cmd.action === 'channel_fader' || cmd.action === 'channel_level' || cmd.action === 'set_channel_level') {
                    socketIo.emit('set_channel_level', { channel: cmd.channel || cmd.ch || 1, level: cmd.level });
                } else if (cmd.action === 'channel_mute') {
                    socketIo.emit('set_channel_mute', { channel: cmd.channel || cmd.ch || 1, mute: cmd.enabled });
                } else if (cmd.action === 'master_mute') {
                    socketIo.emit('set_master_mute', { mute: cmd.enabled });
                }
            }
            res.json({ success: true, result });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    const io = new Server(server, {
        cors: {
            origin: ALLOWED_ORIGINS,
            methods: ['GET', 'POST'],
            credentials: true
        },
        maxHttpBufferSize: 5e7, // 50MB — sweep RT60 envia ~10-15MB de amostras (recording + reference)
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
        if (!ip.includes('.')) return false;
        const ipParts = ip.split('.').map(Number);
        const baseParts = baseIp.split('.').map(Number);
        const maskBits = (~((1 << (32 - mask)) - 1)) >>> 0;
        
        const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
        const baseNum = (baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3];
        
        return (ipNum & maskBits) === (baseNum & maskBits);
    }

    function extractSocketToken(socket) {
        const headers = Object.assign({}, socket.handshake?.headers || {});
        const authToken = socket.handshake?.auth?.token;
        const queryToken = socket.handshake?.query?.token;

        if (!headers.authorization && typeof authToken === 'string' && authToken.trim()) {
            headers.authorization = `Bearer ${authToken.trim()}`;
        }
        if (!headers.authorization && typeof queryToken === 'string' && queryToken.trim()) {
            headers.authorization = `Bearer ${queryToken.trim()}`;
        }

        return extractToken({ headers });
    }

    io.use((socket, next) => {
        const clientIp = socket.handshake.address;
        if (!isIpAllowed(clientIp)) {
            logger.warn('socketio', 'CONNECTION_REJECTED', { ip: clientIp });
            return next(new Error('IP não autorizado. Contate o administrador.'));
        }

        const token = extractSocketToken(socket);
        if (!token) {
            logger.warn('socketio', 'MISSING_TOKEN', { ip: clientIp });
            return next(new Error('Autenticação obrigatória para Socket.IO.'));
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.mustChangePassword === true) {
                logger.warn('socketio', 'BLOCKED_MUST_CHANGE_PASSWORD', { ip: clientIp, userId: decoded.id });
                return next(new Error('Senha precisa ser alterada antes de usar o tempo real.'));
            }
            socket.user = decoded;
            logger.info('socketio', 'CLIENT_AUTHENTICATED', { ip: clientIp, user: decoded.username });
        } catch (err) {
            logger.warn('socketio', 'INVALID_TOKEN', { ip: clientIp });
            return next(new Error('Token inválido ou expirado.'));
        }

        logger.info('socketio', 'CLIENT_AUTHORIZED', { ip: clientIp });
        next();
    });

    registerSocketHandlers(io, dbDir);

    return { server, io };
}

module.exports = { createAppServer };
