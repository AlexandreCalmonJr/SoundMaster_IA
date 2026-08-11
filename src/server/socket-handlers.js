const { createMixerActions } = require('./mixer-actions');
const db = require('./database');
const historyService = require('./history-service');
const aiPredictor = require('./ai-predictor');
const Logger = require('./logger');
const mixerSingleton = require('./mixer-singleton');
const loopbackService = require('./loopback-service');
const netDiag = require('./network');
const mixerDiscovery = require('./mixer-discovery');
const { registerMixerCommandHandlers } = require('./handlers/mixer-commands');
const { registerPresetHandlers } = require('./handlers/presets');
const { registerDiagnosticHandlers } = require('./handlers/diagnostics');
const { registerMixerConnectionHandlers } = require('./handlers/mixer-connection');
const { registerRt60MeasurementHandlers } = require('./handlers/rt60-measurement');
const { registerSoundAssistantHandlers } = require('./handlers/sound-assistant');
const { isAiAvailable, isLiteMode, setAiAvailable } = require('./python-ai');

const PYTHON_PORT = parseInt(process.env.PYTHON_PORT || '3002', 10);

// H5: Prefixos permitidos para send_raw_message
const RAW_MESSAGE_PREFIX_WHITELIST = ['NODE^', 'SETD|']; // Consultas de estado + comandos de mixer

function registerSocketHandlers(io, appDataDir = './logs') {
    const logger = Logger.getInstance(appDataDir);

    logger.onLog = (entry) => {
        io.emit('system_log', entry);
    };

    netDiag.init(io);

    // ⚡ Defer serviços não-críticos para após o Event Loop estar livre
    setImmediate(() => {
        loopbackService.init(io);
        mixerDiscovery.init(io);
    });

    // Auto-descoberta: aguarda 5s para dar tempo ao servidor estabilizar
    setTimeout(() => {
        if (!mixerSingleton.getMixer()) {
            console.log('[SocketHandlers] Nenhuma mesa conectada — iniciando auto-descoberta...');
            mixerDiscovery.startDiscovery();
        }
    }, 5000);

    let activeConnections = 0;
    let feedbackCooldowns = new Map();
    let automaticCutState = new Map();
    const FEEDBACK_COOLDOWN_MS = 5000;
    const MAX_AUTOMATIC_CUTS = 3;

    let globalHistoryStack = [];
    let globalRedoStack = [];

    let cleanupTimer = null;

    function startCleanupTimer() {
        cleanupTimer = setInterval(() => {
            const now = Date.now();
            const TTL_MS = 3600000;
            for (const [k, v] of feedbackCooldowns) {
                if (now - v > TTL_MS) feedbackCooldowns.delete(k);
            }
            for (const [k, v] of automaticCutState) {
                if (now - v.timestamp > TTL_MS) automaticCutState.delete(k);
            }
            if (feedbackCooldowns.size > 0 || automaticCutState.size > 0) {
                logger.info('sockethandlers', 'MAP_CLEANUP', { feedbackCooldowns: feedbackCooldowns.size, automaticCutState: automaticCutState.size });
            }
        }, 300000);
        if (cleanupTimer.unref) cleanupTimer.unref();
    }

    function stopCleanupTimer() {
        if (cleanupTimer) {
            clearInterval(cleanupTimer);
            cleanupTimer = null;
        }
    }

    startCleanupTimer();

    function createThrottle(fn, ms) {
        let lastTime = 0;
        return function (...args) {
            const now = Date.now();
            if (now - lastTime >= ms) {
                lastTime = now;
                return fn.apply(this, args);
            }
        };
    }

    function createSocketRateLimiter(windowMs, maxRequests) {
        const hits = new Map();
        const cleanupInterval = setInterval(() => {
            const cutoff = Date.now() - windowMs;
            for (const [key, timestamps] of hits) {
                const recent = timestamps.filter(ts => ts > cutoff);
                if (recent.length === 0) hits.delete(key);
                else hits.set(key, recent);
            }
        }, windowMs);
        if (cleanupInterval.unref) cleanupInterval.unref();
        return (socket, eventName) => {
            const key = `${socket.id}:${eventName}`;
            const now = Date.now();
            let timestamps = hits.get(key);
            if (!timestamps) {
                timestamps = [];
                hits.set(key, timestamps);
            }
            const recent = timestamps.filter(ts => now - ts < windowMs);
            if (recent.length >= maxRequests) {
                logger.warn(socket.id, 'RATE_LIMIT_EXCEEDED', { event: eventName });
                socket.emit('mixer_status', { connected: true, msg: `Limite de taxa excedido para ${eventName}. Aguarde.` });
                return false;
            }
            timestamps.push(now);
            return true;
        };
    }

    io.on('connection', (socket) => {
        activeConnections++;

        const actions = createMixerActions(() => mixerSingleton.getMixer());

        const throttledSetMaster = createThrottle((level) => {
            const m = mixerSingleton.getMixer();
            if (!m) return;
            m.master.setFaderLevel(level);
            if (m.isSimulated) {
                m.conn.sendMessage(`SETD^m.value^${level}`);
            }
        }, 50);

        const rateLimiter = createSocketRateLimiter(1000, 10);

        let _historyLock = false;
        function addToHistory(cmd) {
            if (_historyLock) return;
            _historyLock = true;
            try {
                globalHistoryStack.push(cmd);
                if (globalHistoryStack.length > 50) globalHistoryStack.shift();
                globalRedoStack.length = 0;
            } finally {
                _historyLock = false;
            }
        }

        function normalizeAutoCutFrequency(hz) {
            return Math.round(Number(hz) || 0);
        }

        function canApplyAutomaticCut(hz) {
            const now = Date.now();
            const roundedHz = normalizeAutoCutFrequency(hz);
            const lastCut = feedbackCooldowns.get(roundedHz) || 0;
            if (now - lastCut < FEEDBACK_COOLDOWN_MS) {
                return { allowed: false, reason: 'cooldown', roundedHz };
            }
            const activeCuts = Array.from(automaticCutState.values()).filter(entry => now - entry.timestamp < FEEDBACK_COOLDOWN_MS);
            if (activeCuts.length >= MAX_AUTOMATIC_CUTS) {
                return { allowed: false, reason: 'limit', roundedHz };
            }
            return { allowed: true, roundedHz };
        }

        logger.info(socket.id, 'CLIENT_CONNECTED', { activeConnections });

        mixerSingleton.dispatchStateTreeTo(socket);
        netDiag.registerNetDiagHandlers(socket);
        mixerDiscovery.registerDiscoveryHandlers(socket);

        const deps = {
            actions, logger, mixerSingleton, throttledSetMaster, rateLimiter,
            addToHistory, feedbackCooldowns, automaticCutState, canApplyAutomaticCut,
            historyService, aiPredictor, db, globalHistoryStack, globalRedoStack
        };

        registerMixerConnectionHandlers(io, socket, deps);
        registerMixerCommandHandlers(io, socket, deps);
        registerPresetHandlers(io, socket, deps);
        registerDiagnosticHandlers(io, socket, deps);
        registerRt60MeasurementHandlers(io, socket, deps);
        registerSoundAssistantHandlers(io, socket, deps);

        socket.on('send_raw_message', (data) => {
            if (!rateLimiter(socket, 'send_raw_message')) return;
            try {
                const mixer = mixerSingleton.getMixer();
                if (!mixer) return;
                const message = String(data?.message || '').trim();
                const isAllowed = RAW_MESSAGE_PREFIX_WHITELIST.some(prefix => message.startsWith(prefix));
                if (!isAllowed) {
                    logger.warn(socket.id, 'RAW_MESSAGE_REJECTED', { message });
                    socket.emit('mixer_status', { connected: true, msg: 'Comando RAW rejeitado pela política de segurança.' });
                    return;
                }
                if (mixer.conn && typeof mixer.conn.sendMessage === 'function') {
                    mixer.conn.sendMessage(message);
                    logger.info(socket.id, 'RAW_MESSAGE_SENT', { message });
                    socket.emit('mixer_log', `RAW enviado: ${message}`);
                }
            } catch (error) {
                logger.error(socket.id, 'RAW_MESSAGE_ERROR', { error: error.message });
            }
        });

        socket.on('get_ai_status', () => {
            socket.emit('ai_status', {
                available: isAiAvailable(),
                lite: isLiteMode()
            });
        });

        socket.on('ping_mixer', () => {
            socket.emit('pong_mixer');
        });

        socket.on('disconnect', () => {
            activeConnections--;
            logger.info(socket.id, 'CLIENT_DISCONNECTED', { activeConnections });
        });
    });
}

module.exports = { registerSocketHandlers };