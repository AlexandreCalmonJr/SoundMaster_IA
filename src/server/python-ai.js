const { spawn, execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Logger = require('./logger');
const http = require('http');
const { app } = require('electron');

// ✅ T10: Porta do Python configurável via .env
function getPythonPort() {
    return parseInt(process.env.PYTHON_PORT || '3002', 10);
}

let resolvedPythonCommand = 'python';

function getPythonCommand() {
    return resolvedPythonCommand;
}

const REQS_PATH = path.join(__dirname, '..', '..', 'backend', 'ai', 'requirements.txt');

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

const DEPS_STATE_PATH = path.join(__dirname, '..', '..', 'backend', 'ai', '.deps_state.json');

function _areLongPathsEnabled() {
    if (process.platform !== 'win32') return true;
    try {
        const out = execSync('reg query "HKLM\\System\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
        return out.includes('0x1');
    } catch (_) {
        return false;
    }
}

function _getFileHash(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return crypto.createHash('sha256').update(content).digest('hex');
    } catch (_) {
        return '';
    }
}

function _ensurePythonDeps() {
    const requirementsPath = REQS_PATH;
    if (!fs.existsSync(requirementsPath)) {
        console.warn('[Python AI] requirements.txt não encontrado em:', requirementsPath);
        return;
    }

    const currentHash = _getFileHash(requirementsPath);
    const longPathsEnabled = _areLongPathsEnabled();
    const statePath = DEPS_STATE_PATH;

    // Tenta ler o estado atual
    let savedState = null;
    if (fs.existsSync(statePath)) {
        try {
            savedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        } catch (_) {}
    }

    // Se o estado já for válido e bem-sucedido, ignora a instalação
    if (savedState &&
        savedState.requirementsHash === currentHash &&
        savedState.longPathsEnabled === longPathsEnabled &&
        savedState.success === true) {
        console.log('[Python AI] Dependências Python já validadas e atualizadas.');
        return;
    }

    // Procura python (prioriza venv, depois sistema)
    const venvPython = _getVenvPython(path.join(__dirname, '..', '..'));
    const candidates = [];
    if (venvPython) candidates.push(venvPython);
    candidates.push('python', 'python3');
    if (process.platform === 'win32') candidates.push('py');

    // Se as dependências de base (fastapi e multipart) já estiverem instaladas E o estado tiver gravado sucesso=false para o mesmo hash e longPaths,
    // nós não tentamos reinstalar para não travar o startup da aplicação em um loop eterno de falhas.
    if (savedState &&
        savedState.requirementsHash === currentHash &&
        savedState.longPathsEnabled === longPathsEnabled &&
        savedState.success === false) {
        // Verifica se pelo menos o fastapi e multipart estão instalados
        for (const cmd of candidates) {
            try {
                const checkResult = spawnSync(cmd, ['-c', 'import fastapi, multipart'], { stdio: 'ignore' });
                if (checkResult.status === 0) {
                    console.log(`[Python AI] Instalação anterior falhou, mas fastapi/multipart estão disponíveis (${cmd}). Iniciando em modo Lite.`);
                    return;
                }
            } catch (_) {}
        }
    }

    // Nenhum python com as dependências válidas. Vamos encontrar o executável Python
    const pythonCmd = candidates.find(c => {
        try {
            const versionResult = spawnSync(c, ['--version'], { stdio: 'ignore' });
            return versionResult.status === 0;
        } catch (_) {
            return false;
        }
    });

    if (!pythonCmd) {
        console.warn('[Python AI] Python não foi detectado no sistema. A IA local não pôde ser inicializada.');
        console.warn('[Python AI] Para utilizar as funcionalidades de IA local, por favor instale o Python e execute: pip install -r backend/ai/requirements.txt');
        return;
    }

    let installReqsPath = requirementsPath;
    let isLiteInstall = false;

    if (process.platform === 'win32' && !longPathsEnabled) {
        isLiteInstall = true;
        console.warn('[Python AI] ⚠️ Windows Long Path support is disabled (LongPathsEnabled = 0).');
        console.warn('[Python AI] Skipping heavy dependencies ("tensorflow", "tensorflow-hub", "llama-cpp-python") to prevent installation failure.');
        console.warn('[Python AI] To enable full AI features (YAMNet sound classification & local LLM chat), please:');
        console.warn('[Python AI] 1. Open PowerShell as Administrator.');
        console.warn('[Python AI] 2. Run: Set-ItemProperty -Path "HKLM:\\System\\CurrentControlSet\\Control\\FileSystem" -Name "LongPathsEnabled" -Value 1');
        console.warn('[Python AI] 3. Restart the application to trigger a full dependency installation.');

        // Gera requirements_lite.txt filtrando os pacotes problemáticos
        try {
            const content = fs.readFileSync(requirementsPath, 'utf8');
            const lines = content.split(/\r?\n/);
            const filteredLines = lines.filter(line => {
                const clean = line.trim().toLowerCase();
                return !clean.startsWith('tensorflow') && !clean.startsWith('llama-cpp-python');
            });
            const litePath = path.join(path.dirname(requirementsPath), 'requirements_lite.txt');
            fs.writeFileSync(litePath, filteredLines.join('\n'), 'utf8');
            installReqsPath = litePath;
        } catch (err) {
            console.error('[Python AI] Falha ao criar requirements_lite.txt, usando requirements.txt padrão:', err.message);
            isLiteInstall = false;
        }
    }

    console.log(`[Python AI] Instalando dependências Python (pip install -r ${path.basename(installReqsPath)})...`);
    let installSuccess = false;

    try {
        const installResult = spawnSync(pythonCmd, ['-m', 'pip', 'install', '-r', installReqsPath, '--quiet'], {
            stdio: 'inherit',
            timeout: 300000, // 5 min
        });
        if (installResult.error) throw installResult.error;
        if (installResult.status !== 0) throw new Error(`Exit code: ${installResult.status}`);
        console.log('[Python AI] Dependências instaladas com sucesso.');
        installSuccess = true;
    } catch (e) {
        console.error('[Python AI] Falha ao instalar dependências:', e.message);
        console.warn('[Python AI] Execute manualmente: pip install -r backend/ai/requirements.txt');
    } finally {
        // Limpa requirements_lite.txt se foi criado
        if (isLiteInstall && installReqsPath !== requirementsPath && fs.existsSync(installReqsPath)) {
            try {
                fs.unlinkSync(installReqsPath);
            } catch (_) {}
        }
    }

    // Salva o novo estado
    try {
        fs.writeFileSync(statePath, JSON.stringify({
            requirementsHash: currentHash,
            longPathsEnabled: longPathsEnabled,
            success: installSuccess
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
    const modelsDir = path.join(rootDir, 'models');
    const modelName = 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf';
    const modelPath = path.join(modelsDir, modelName);

    if (fs.existsSync(modelPath)) {
        console.log('[Python AI] Modelo de IA já existe em:', modelPath);
        return;
    }

    const downloadScript = path.join(rootDir, 'scripts', 'download_model.py');
    if (!fs.existsSync(downloadScript)) {
        console.warn('[Python AI] Script de download não encontrado em:', downloadScript);
        return;
    }

    const pythonCmd = _findPython();
    if (!pythonCmd) {
        console.warn('[Python AI] Python não encontrado. Não foi possível baixar o modelo de IA.');
        return;
    }

    console.log('[Python AI] Modelo de IA não encontrado. Iniciando download (~670MB) em background...');
    console.log('[Python AI] O servidor de IA iniciará sem o modelo; ele será ativado automaticamente após o download.');

    const proc = spawn(pythonCmd, [downloadScript], { stdio: 'inherit', cwd: rootDir });

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

function startPythonAI(rootDir, onExitCallback) {
    _ensurePythonDeps();
    _ensureAIModelAsync(rootDir);

    let pythonScript = path.join(rootDir, 'ai_server.py');
    if (!fs.existsSync(pythonScript)) {
        // Fallback: se o rootDir for o diretório raiz do projeto e não do backend/ai
        pythonScript = path.join(rootDir, 'backend', 'ai', 'ai_server.py');
    }

    if (!fs.existsSync(pythonScript)) {
        console.warn(`[Python AI] Script não encontrado: ${pythonScript}. IA desativada.`);
        return null;
    }

    // Detector de Ambiente Virtual (venv)
    const isWin = process.platform === 'win32';
    let venvPython = isWin 
        ? path.join(rootDir, 'venv', 'Scripts', 'python.exe')
        : path.join(rootDir, 'venv', 'bin', 'python');

    if (!fs.existsSync(venvPython)) {
        // Fallback para venv em backend/ai
        venvPython = isWin
            ? path.join(rootDir, 'backend', 'ai', 'venv', 'Scripts', 'python.exe')
            : path.join(rootDir, 'backend', 'ai', 'venv', 'bin', 'python');
    }

    if (!fs.existsSync(venvPython)) {
        // Fallback para Python portátil em userData
        venvPython = path.join(app.getPath('userData'), 'python-portable', 'python.exe');
    }

    if (!fs.existsSync(venvPython)) {
        // Fallback para Python portátil local (desenvolvimento)
        venvPython = path.join(rootDir, 'python-portable', 'python.exe');
        if (!fs.existsSync(venvPython)) {
            venvPython = path.join(rootDir, 'backend', 'ai', 'python-portable', 'python.exe');
        }
    }

    const commands = [];
    
    // 1. Prioridade: Venv local
    if (fs.existsSync(venvPython)) {
        console.log(`[Python AI] Ambiente virtual detectado em: ${venvPython}`);
        commands.push(venvPython);
    }

    // 2. Fallbacks globais
    commands.push('python');
    commands.push('python3');
    if (isWin) commands.push('py');

    console.log(`[Python AI] Tentando iniciar servidor em: ${pythonScript}`);

    let pythonProcess = null;
    for (const cmd of commands) {
        if (_checkPython(cmd)) {
            pythonProcess = _trySpawn(cmd, pythonScript, path.dirname(pythonScript), onExitCallback);
            if (pythonProcess) {
                resolvedPythonCommand = cmd;
                break;
            }
        }
    }

    if (pythonProcess) {
        pythonProcess.isReady = false;
        const healthPromise = _waitForHealth(pythonProcess).then(() => {
            setAiAvailable(true);
            return true;
        }).catch((error) => {
            console.error(`[Python AI] Health-check falhou: ${error.message}`);
            setAiAvailable(false);
            try {
                Logger.getInstance().error('PYTHON', 'PYTHON_HEALTHCHECK_FAILED', error.message);
            } catch (_) { /* Logger pode não estar inicializado ainda */ }
            throw error;
        });
        pythonProcess.healthCheck = () => healthPromise;
    } else {
        setAiAvailable(false);
    }
    return pythonProcess;
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
    try {
        const { spawnSync } = require('child_process');
        const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
        return result.status === 0;
    } catch (e) {
        return false;
    }
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
