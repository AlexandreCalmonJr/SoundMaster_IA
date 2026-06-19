const { spawn, spawnSync } = require('child_process');
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

// Cache do comando Python resolvido — evita múltiplos spawnSync no startup
const PYTHON_CMD_CACHE_PATH = path.join(__dirname, '..', '..', 'node_modules', '.python-cmd-cache.json');

function _readPythonCmdCache() {
    try {
        const data = JSON.parse(fs.readFileSync(PYTHON_CMD_CACHE_PATH, 'utf8'));
        // Cache válido por 24h
        if (data && data.cmd && Date.now() - (data.ts || 0) < 86400000) {
            return data.cmd;
        }
    } catch { /* cache ausente ou corrompido */ }
    return null;
}

function _writePythonCmdCache(cmd) {
    try {
        fs.writeFileSync(PYTHON_CMD_CACHE_PATH, JSON.stringify({ cmd, ts: Date.now() }), 'utf8');
    } catch { /* falha silenciosa */ }
}
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
        return spawnSync(command, args, { stdio: 'ignore', timeout: 5000 }).status === 0;
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

/**
 * Resolve o melhor comando Python disponível de forma ASSÍNCRONA.
 * Usa cache em disco para evitar spawnSync repetido no startup.
 * @param {string[]} candidates
 * @returns {Promise<string|null>}
 */
function _resolvePythonAsync(candidates) {
    return new Promise((resolve) => {
        // 1. Tenta o cache primeiro (caminho rápido — sem spawnSync)
        const cached = _readPythonCmdCache();
        if (cached && candidates.some(c => c === cached || cached.includes(path.basename(c, '.exe')))) {
            resolve(cached);
            return;
        }

        // 2. Resolve em background sem bloquear o Event Loop
        setImmediate(() => {
            const cmd = _choosePython(candidates);
            if (cmd) {
                _writePythonCmdCache(cmd);
                console.log(`[Python AI] Comando Python resolvido e cacheado: ${cmd}`);
            }
            resolve(cmd);
        });
    });
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

/**
 * Valida e instala dependências Python de forma ASSÍNCRONA (não-bloqueante).
 * Toda a lógica de verificação e instalação roda em background via setImmediate.
 */
function _ensurePythonDeps() {
    if (!fs.existsSync(REQS_PATH)) {
        console.warn('[Python AI] requirements.txt não encontrado em:', REQS_PATH);
        return;
    }

    const currentHash = _getFileHash(REQS_PATH);
    const statePath = DEPS_STATE_PATH;

    // Verificação rápida via cache de estado (leitura de arquivo — não-bloqueante)
    let savedState = null;
    if (fs.existsSync(statePath)) {
        try { savedState = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) {}
    }

    // ✅ Caminho rápido: hash idêntico + instalação bem-sucedida anterior → skip imediato
    if (savedState && savedState.hash === currentHash && savedState.success === true) {
        console.log('[Python AI] Dependências Python já validadas.');
        return;
    }

    // ✅ Caminho rápido: hash idêntico + falha anterior mas core OK → Modo Lite
    if (savedState && savedState.hash === currentHash && savedState.success === false) {
        console.log('[Python AI] Instalação anterior incompleta. Iniciando em Modo Lite.');
        return;
    }

    // Instalação necessária — executa em background para não bloquear o Event Loop
    console.log('[Python AI] Verificando dependências em background...');
    setImmediate(() => {
        const venvPython = _getVenvPython(path.join(__dirname, '..', '..'));
        const candidates = [];
        if (venvPython) candidates.push(venvPython);
        candidates.push('python', 'python3');
        if (process.platform === 'win32') candidates.push('py');

        const pythonCmd = _choosePython(candidates);

        if (!pythonCmd) {
            console.warn('[Python AI] Python não encontrado. IA desativada.');
            return;
        }

        console.log('[Python AI] Instalando dependências essenciais...');
        const coreOk = installUtils.installCoreReqs(pythonCmd);
        if (!coreOk || !_hasCoreDeps(pythonCmd)) {
            console.error('[Python AI] Falha ao instalar dependências essenciais. Execute manualmente:');
            console.error(`[Python AI]   ${pythonCmd} -m pip install -r backend/ai/requirements.txt`);
            try {
                fs.writeFileSync(statePath, JSON.stringify({
                    hash: currentHash, success: false, timestamp: Date.now()
                }, null, 2), 'utf8');
            } catch (_) {}
            return;
        }

        const optResults = installUtils.installOptionalReqs(pythonCmd);
        for (const r of optResults) {
            if (r.ok) {
                console.log(`[Python AI] ${r.name} instalado.`);
            } else {
                console.warn(`[Python AI] ${r.name} não disponível para esta plataforma.`);
            }
        }

        try {
            fs.writeFileSync(statePath, JSON.stringify({
                hash: currentHash, success: true, timestamp: Date.now()
            }, null, 2), 'utf8');
        } catch (_) {}
    });
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

    // Validação de deps em background — não bloqueia o startup
    _ensurePythonDeps();
    _ensureAIModelAsync(rootDir);

    const projectRoot = _resolveProjectRoot(rootDir);
    const aiDir = _resolveAiDir(rootDir);
    const pythonScript = path.join(aiDir, 'ai_server.py');

    if (!fs.existsSync(pythonScript)) {
        console.warn(`[Python AI] Script não encontrado: ${pythonScript}. IA desativada.`);
        return null;
    }

    const isWin = process.platform === 'win32';

    // Resolução do venv Python (apenas verificações de fs.existsSync — rápidas)
    const venvCandidates = [
        isWin ? path.join(projectRoot, 'venv', 'Scripts', 'python.exe')
              : path.join(projectRoot, 'venv', 'bin', 'python'),
        isWin ? path.join(aiDir, 'venv', 'Scripts', 'python.exe')
              : path.join(aiDir, 'venv', 'bin', 'python'),
        path.join(app.getPath('userData'), 'python-portable', 'python.exe'),
        path.join(projectRoot, 'python-portable', 'python.exe'),
        path.join(aiDir, 'python-portable', 'python.exe'),
    ];

    const venvPython = venvCandidates.find(fs.existsSync) || null;
    if (venvPython) {
        console.log(`[Python AI] Ambiente virtual detectado em: ${venvPython}`);
    }

    // Monta lista de candidatos — venv primeiro, depois sistema
    const allCandidates = [];
    if (venvPython) allCandidates.push(venvPython);
    allCandidates.push('python', 'python3');
    if (isWin) allCandidates.push('py');

    console.log(`[Python AI] Tentando iniciar servidor em: ${pythonScript}`);

    // ✅ OTIMIZAÇÃO: lê o comando Python do cache (sem spawnSync no caminho crítico)
    //    A resolução completa ocorre de forma assíncrona
    const cachedCmd = _readPythonCmdCache();
    const cachedCandidates = cachedCmd ? [cachedCmd] : [];
    const prioritizedCandidates = [...cachedCandidates, ...allCandidates];

    // Spawn imediato com o candidato mais provável (cache hit → 0 spawnSync)
    // Se falhar, tenta os próximos candidatos com backoff
    function _spawnAttempt(candidateList) {
        if (_backoffStopping) return null;

        for (const cmd of candidateList) {
            const proc = _trySpawn(cmd, pythonScript, path.dirname(pythonScript), (code) => {
                setAiAvailable(false);
                if (onExitCallback) onExitCallback(code);
                // No restart, usar a lista completa (não só o cache)
                _scheduleRestart(() => _spawnWithValidation(allCandidates));
            });
            if (proc) {
                resolvedPythonCommand = cmd;
                if (cmd !== cachedCmd) {
                    _writePythonCmdCache(cmd);
                }
                return proc;
            }
        }
        return null;
    }

    // Versão com validação completa (para restarts após falha)
    function _spawnWithValidation(candidates) {
        if (_backoffStopping) return null;
        const valid = candidates.filter(_checkPython);
        const sorted = [
            ...valid.filter(_isYamnetCapablePython),
            ...valid.filter(c => !_isYamnetCapablePython(c)),
        ];
        return _spawnAttempt(sorted.length > 0 ? sorted : candidates);
    }

    function _onProcessReady() {
        _backoffRetryCount = 0;
        clearTimeout(_backoffStableTimer);
        _backoffStableTimer = setTimeout(_resetBackoff, _BACKOFF_RESET_AFTER_MS);
    }

    // Primeiro spawn: usa cache ou venv diretamente (sem validação bloqueante)
    let pythonProcess = _spawnAttempt(prioritizedCandidates);

    if (!pythonProcess && !cachedCmd) {
        // Fallback: resolução com spawnSync (apenas se cache vazio e spawn direto falhou)
        console.log('[Python AI] Fallback: validando candidatos Python...');
        pythonProcess = _spawnWithValidation(allCandidates);
    }

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
        _scheduleRestart(() => _spawnWithValidation(allCandidates));
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
            const msg = data.toString('utf8').trim();
            if (!msg) return;
            if (msg.includes('READY')) {
                console.log('✅ [Python AI] Servidor de IA está PRONTO e operacional.');
            }
            // Logger.info já emite console.log internamente — não duplicar
            Logger.getInstance().info('PYTHON', 'PYTHON_STDOUT', msg);
        });

        proc.stderr.on('data', (data) => {
            const msg = data.toString('utf8').trim();
            if (!msg) return;
            // uvicorn imprime info no stderr — não tratar como erro fatal
            if (msg.includes('Uvicorn running') || msg.includes('Started') || msg.startsWith('INFO:')) {
                started = true;
                Logger.getInstance().info('PYTHON', 'PYTHON_STDOUT', msg);
            } else if (msg.includes('DeprecationWarning') || msg.includes('UserWarning')) {
                // Silenciar avisos de depreciação para não poluir o log
                Logger.getInstance().warn('PYTHON', 'PYTHON_WARN', msg);
            } else {
                // Erros reais — visível no console
                console.error(`[Python AI ERRO]: ${msg}`);
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
