const { spawn, execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Logger = require('./logger');
const http = require('http');
const installUtils = require('./python-install-utils.js');
let app = null;
try { app = require('electron').app; } catch (_) { app = null; }

// ✅ T10: Porta do Python configurável via .env
function getPythonPort() {
    return parseInt(process.env.PYTHON_PORT || '3002', 10);
}

let resolvedPythonCommand = 'python';

function getPythonCommand() {
    return resolvedPythonCommand;
}

const REQS_PATH = installUtils.REQS_PATH;
const DEPS_STATE_PATH = path.join(__dirname, '..', '..', 'backend', 'ai', '.deps_state.json');
const CORE_IMPORT_CHECK = 'import fastapi, multipart';

function _getVenvPython(rootDir) {
    const isWin = process.platform === 'win32';
    const candidates = [
        path.join(app.getPath('userData'), 'python-portable', 'python.exe'),
        path.join(rootDir, 'venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python'),
        path.join(rootDir, 'backend', 'ai', 'venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python'),
        path.join(rootDir, 'python-portable', 'python.exe'),
        path.join(rootDir, 'backend', 'ai', 'python-portable', 'python.exe'),
    ];
    return candidates.find(fs.existsSync) || null;
}



function _getFileHash(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return crypto.createHash('sha256').update(content).digest('hex');
    } catch (_) {
        return '';
    }
}

function _pythonRuns(command, args) {
    try {
        return spawnSync(command, args, { stdio: 'ignore' }).status === 0;
    } catch (_) {
        return false;
    }
}

function _hasCoreDeps(command) {
    return _pythonRuns(command, ['-c', CORE_IMPORT_CHECK]);
}

function _isYamnetCapablePython(command) {
    return _pythonRuns(command, ['-c', 'import sys; raise SystemExit(0 if sys.version_info < (3, 13) else 1)']);
}

function _choosePython(candidates, requireCore = false) {
    const existing = candidates.filter(c => _pythonRuns(c, ['--version']));
    const usable = requireCore ? existing.filter(_hasCoreDeps) : existing;
    return usable.find(_isYamnetCapablePython) || usable[0] || null;
}

function _resolveProjectRoot(rootDir) {
    if (fs.existsSync(path.join(rootDir, 'backend', 'ai', 'ai_server.py'))) {
        return rootDir;
    }
    if (fs.existsSync(path.join(rootDir, 'ai_server.py'))) {
        return path.resolve(rootDir, '..', '..');
    }
    return rootDir;
}

function _resolveAiDir(rootDir) {
    if (fs.existsSync(path.join(rootDir, 'ai_server.py'))) {
        return rootDir;
    }
    return path.join(rootDir, 'backend', 'ai');
}

function _ensurePythonDeps() {
    if (!fs.existsSync(REQS_PATH)) {
        console.warn('[Python AI] requirements.txt não encontrado em:', REQS_PATH);
        return;
    }

    const currentHash = _getFileHash(REQS_PATH);
    const statePath = DEPS_STATE_PATH;

    const venvPython = _getVenvPython(path.join(__dirname, '..', '..'));
    const candidates = [];
    if (venvPython) candidates.push(venvPython);
    candidates.push('python', 'python3');
    if (process.platform === 'win32') candidates.push('py');

    const pythonCmd = _choosePython(candidates);

    if (!pythonCmd) {
        console.warn('[Python AI] Python nao encontrado.');
        return;
    }

    // Cache: se já validamos este hash com sucesso, não repete
    let savedState = null;
    if (fs.existsSync(statePath)) {
        try { savedState = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) {}
    }
    if (savedState && savedState.hash === currentHash && savedState.success === true && _hasCoreDeps(pythonCmd) && _isYamnetCapablePython(pythonCmd)) {
        console.log('[Python AI] Dependências Python já validadas.');
        return;
    }

    // Se o estado salvo mostra falha mas fastapi roda no Python atual, ignora reinstalação.
    if (savedState && savedState.hash === currentHash && savedState.success === false && _hasCoreDeps(pythonCmd) && _isYamnetCapablePython(pythonCmd)) {
        console.log('[Python AI] Instalação anterior falhou mas core está funcional. Modo Lite.');
        return;
    }

    console.log('[Python AI] Instalando dependências essenciais...');
    const coreOk = installUtils.installCoreReqs(pythonCmd);
    if (!coreOk || !_hasCoreDeps(pythonCmd)) {
        console.error('[Python AI] Falha ao instalar dependências essenciais. Execute manualmente:');
        console.error(`[Python AI]   ${pythonCmd} -m pip install -r backend/ai/requirements.txt`);
        return;
    }
    console.log('[Python AI] Dependências essenciais OK.');

    // Instala opcionais (falhas são apenas avisos)
    const optResults = installUtils.installOptionalReqs(pythonCmd);
    for (const r of optResults) {
        if (r.ok) {
            console.log(`[Python AI] ${r.name} instalado.`);
        } else {
            console.warn(`[Python AI] ${r.name} não disponível para esta plataforma.`);
        }
    }

    // Salva estado
    try {
        fs.writeFileSync(statePath, JSON.stringify({
            hash: currentHash,
            success: true,
            timestamp: Date.now()
        }, null, 2), 'utf8');
    } catch (_) {}
}

function _findPython() {
    const candidates = ['python', 'python3'];
    if (process.platform === 'win32') candidates.push('py');
    for (const cmd of candidates) {
        try {
            const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
            if (r.status === 0) return cmd;
        } catch (_) {}
    }
    return null;
}

function _ensureAIModelAsync(rootDir) {
    const projectRoot = _resolveProjectRoot(rootDir);
    const aiDir = _resolveAiDir(rootDir);
    const modelsDir = path.join(aiDir, 'models');
    
    // Lê a configuração do modelo (AI_MODEL do .env ou fallback)
    const modelKey = process.env.AI_MODEL || 'phi3.5-mini';
    
    // Mapeamento de chaves para arquivos GGUF
    const modelFiles = {
        'phi3.5-mini': 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
        'llama3.2-3b': 'llama-3.2-3b-instruct.Q4_K_M.gguf',
        'gemma2-2b': 'gemma-2-2b-it.Q4_K_M.gguf',
        'tinyllama-1.1b': 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
    };

    const modelName = modelFiles[modelKey] || modelFiles['phi3.5-mini'];
    const modelPath = path.join(modelsDir, modelName);

    if (fs.existsSync(modelPath)) {
        console.log(`[Python AI] Modelo '${modelKey}' já existe em: ${modelPath}`);
        return;
    }

    const downloadScript = path.join(aiDir, 'scripts', 'download_model.py');
    if (!fs.existsSync(downloadScript)) {
        console.warn('[Python AI] Script de download não encontrado em:', downloadScript);
        return;
    }

    const pythonCmd = _findPython();
    if (!pythonCmd) {
        console.warn('[Python AI] Python não encontrado. Não foi possível baixar o modelo de IA.');
        return;
    }

    console.log(`[Python AI] Modelo '${modelKey}' não encontrado. Iniciando download em background...`);
    console.log('[Python AI] O servidor de IA iniciará sem o modelo; ele será ativado automaticamente após o download.');

    const proc = spawn(pythonCmd, [downloadScript, modelKey], {
        stdio: 'inherit',
        cwd: projectRoot,
        env: {
            ...process.env,
            PYTHONUTF8: '1',
            PYTHONIOENCODING: 'utf-8',
        },
    });

    proc.on('close', (code) => {
        if (code === 0) {
            console.log('[Python AI] ✅ Modelo baixado com sucesso! O chat IA local será ativado na próxima requisição.');
        } else {
            console.warn(`[Python AI] ⚠️ Download do modelo falhou (código ${code}). O chat IA funcionará sem LLM local.`);
        }
    });
    proc.on('error', (err) => {
        console.warn(`[Python AI] ⚠️ Erro ao iniciar download do modelo: ${err.message}`);
    });
}

let _backoffStopping = false;
let _backoffRetryCount = 0;
let _backoffTimer = null;
let _backoffStableTimer = null;
const _BACKOFF_BASE_MS = 1000;
const _BACKOFF_MAX_MS = 30000;
const _BACKOFF_RESET_AFTER_MS = 60000;

function _getBackoffDelay() {
    const delay = Math.min(_BACKOFF_BASE_MS * Math.pow(2, _backoffRetryCount), _BACKOFF_MAX_MS);
    _backoffRetryCount++;
    return delay;
}

function _resetBackoff() {
    _backoffRetryCount = 0;
    console.log('[Python AI] Backoff resetado — processo estável.');
}

function _scheduleRestart(fn) {
    if (_backoffStopping) return;
    const delay = _getBackoffDelay();
    console.log(`[Python AI] Reiniciando em ${delay}ms (tentativa #${_backoffRetryCount})...`);
    _backoffTimer = setTimeout(fn, delay);
}

function startPythonAI(rootDir, onExitCallback) {
    _backoffStopping = false;
    _backoffRetryCount = 0;

    _ensurePythonDeps();
    _ensureAIModelAsync(rootDir);

    const projectRoot = _resolveProjectRoot(rootDir);
    const aiDir = _resolveAiDir(rootDir);
    let pythonScript = path.join(aiDir, 'ai_server.py');
    if (!fs.existsSync(pythonScript)) {
        pythonScript = path.join(aiDir, 'ai_server.py');
    }

    if (!fs.existsSync(pythonScript)) {
        console.warn(`[Python AI] Script não encontrado: ${pythonScript}. IA desativada.`);
        return null;
    }

    const isWin = process.platform === 'win32';
    let venvPython = isWin 
        ? path.join(projectRoot, 'venv', 'Scripts', 'python.exe')
        : path.join(projectRoot, 'venv', 'bin', 'python');

    if (!fs.existsSync(venvPython)) {
        venvPython = isWin
            ? path.join(aiDir, 'venv', 'Scripts', 'python.exe')
            : path.join(aiDir, 'venv', 'bin', 'python');
    }

    if (!fs.existsSync(venvPython)) {
        venvPython = path.join(app.getPath('userData'), 'python-portable', 'python.exe');
    }

    if (!fs.existsSync(venvPython)) {
        venvPython = path.join(projectRoot, 'python-portable', 'python.exe');
        if (!fs.existsSync(venvPython)) {
            venvPython = path.join(aiDir, 'python-portable', 'python.exe');
        }
    }

    const commands = [];
    if (fs.existsSync(venvPython)) {
        console.log(`[Python AI] Ambiente virtual detectado em: ${venvPython}`);
        commands.push(venvPython);
    }

    commands.push('python');
    commands.push('python3');
    if (isWin) commands.push('py');

    console.log(`[Python AI] Tentando iniciar servidor em: ${pythonScript}`);

    const validCommands = commands.filter(_checkPython);
    const sortedCommands = [
        ...validCommands.filter(_isYamnetCapablePython),
        ...validCommands.filter(c => !_isYamnetCapablePython(c)),
    ];

    function _spawnAttempt() {
        if (_backoffStopping) return null;
        for (const cmd of sortedCommands) {
            const proc = _trySpawn(cmd, pythonScript, path.dirname(pythonScript), (code) => {
                setAiAvailable(false);
                if (onExitCallback) onExitCallback(code);
                _scheduleRestart(_spawnAttempt);
            });
            if (proc) {
                resolvedPythonCommand = cmd;
                return proc;
            }
        }
        return null;
    }

    function _onProcessReady() {
        _backoffRetryCount = 0;
        clearTimeout(_backoffStableTimer);
        _backoffStableTimer = setTimeout(_resetBackoff, _BACKOFF_RESET_AFTER_MS);
    }

    let pythonProcess = _spawnAttempt();

    if (pythonProcess) {
        pythonProcess.isReady = false;
        const healthPromise = _waitForHealth(pythonProcess).then(() => {
            setAiAvailable(true);
            _onProcessReady();
            return true;
        }).catch((error) => {
            console.error(`[Python AI] Health-check falhou: ${error.message}`);
            setAiAvailable(false);
            try {
                Logger.getInstance().error('PYTHON', 'PYTHON_HEALTHCHECK_FAILED', error.message);
            } catch (_) {}
            throw error;
        });
        pythonProcess.healthCheck = () => healthPromise;
    } else {
        setAiAvailable(false);
        _scheduleRestart(_spawnAttempt);
    }
    return pythonProcess;
}

function stopPythonAI(pythonProcess) {
    _backoffStopping = true;
    clearTimeout(_backoffTimer);
    clearTimeout(_backoffStableTimer);
    if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill();
    }
}

function _waitForHealth(proc, timeoutMs = 15000, intervalMs = 1000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const attempt = () => {
            if (!proc || proc.killed) {
                return reject(new Error('Processo Python encerrado antes do health-check.'));
            }
            const port = getPythonPort();
            const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
                if (res.statusCode === 200) {
                    proc.isReady = true;
                    Logger.getInstance().info('PYTHON', 'PYTHON_HEALTHCHECK_READY', 'Health-check OK');
                    res.resume();
                    return resolve(true);
                }
                res.resume();
                if (Date.now() - startedAt >= timeoutMs) {
                    return reject(new Error(`Timeout aguardando /health (${res.statusCode})`));
                }
                setTimeout(attempt, intervalMs);
            });
            req.on('error', () => {
                if (Date.now() - startedAt >= timeoutMs) {
                    return reject(new Error('Timeout aguardando servidor Python responder.'));
                }
                setTimeout(attempt, intervalMs);
            });
            req.setTimeout(1500, () => {
                req.destroy();
                req.destroyed = true;
            });
            req.on('close', () => {
                if (req.destroyed && Date.now() - startedAt >= timeoutMs) {
                    reject(new Error('Timeout aguardando servidor Python responder.'));
                }
            });
        };
        attempt();
    });
}

function _checkPython(command) {
    return _pythonRuns(command, ['--version']) && _hasCoreDeps(command);
}

function _trySpawn(command, scriptPath, rootDir, onExitCallback) {
    try {
        const proc = spawn(command, [scriptPath], { 
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: rootDir 
        });
        let started = false;

        proc.on('error', (err) => {
            if (!started) {
                console.warn(`[Python AI] '${command}' não disponível: ${err.message}`);
            }
        });

        proc.stdout.on('data', (data) => {
            started = true;
            const msg = data.toString().trim();
            if (msg.includes('READY')) {
                console.log('✅ [Python AI] Servidor de IA está PRONTO e operacional.');
            }
            console.log(`[Python AI]: ${msg}`);
            Logger.getInstance().info('PYTHON', 'PYTHON_STDOUT', msg);
        });

        proc.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            // uvicorn imprime info no stderr — não tratar como erro fatal
            if (msg.includes('Uvicorn running') || msg.includes('Started') || msg.startsWith('INFO:')) {
                started = true;
                console.log(`[Python AI]: ${msg}`);
                Logger.getInstance().info('PYTHON', 'PYTHON_STDOUT', msg);
            } else if (msg.includes('DeprecationWarning')) {
                // Silenciar ou baixar nível de avisos de depreciação para não assustar o usuário
                Logger.getInstance().warn('PYTHON', 'PYTHON_WARN', msg);
            } else {
                console.error(`[Python AI ERRO]: ${msg}`);
                Logger.getInstance().error('PYTHON', 'PYTHON_STDERR', msg);
            }
        });

        proc.on('exit', (code) => {
            if (code !== null && code !== 0) {
                console.error(`[Python AI] Processo encerrado com código ${code}`);
                if (onExitCallback) {
                    onExitCallback(code);
                }
            }
        });

        return proc;
    } catch (_) {
        console.warn(`[Python AI] Falha ao spawnar processo Python: ${_.message}`);
        return null;
    }
}

function stopPythonAI(pythonProcess) {
    if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill();
    }
}

let _aiAvailable = false;
let _liteMode = false;

function setAiAvailable(v) { _aiAvailable = v; if (!v) _liteMode = true; }
function isAiAvailable() { return _aiAvailable; }
function isLiteMode() { return _liteMode; }

module.exports = { startPythonAI, stopPythonAI, getPythonPort, getPythonCommand, setAiAvailable, isAiAvailable, isLiteMode };
