const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Logger = require('./logger');
const http = require('http');

// ✅ T10: Porta do Python configurável via .env
function getPythonPort() {
    return parseInt(process.env.PYTHON_PORT || '3002', 10);
}

let resolvedPythonCommand = 'python';

function getPythonCommand() {
    return resolvedPythonCommand;
}

function startPythonAI(rootDir, onExitCallback) {
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
        // Fallback
        venvPython = isWin
            ? path.join(rootDir, 'backend', 'ai', 'venv', 'Scripts', 'python.exe')
            : path.join(rootDir, 'backend', 'ai', 'venv', 'bin', 'python');
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
        pythonProcess.healthCheck = () => pythonProcess.isReady;
        _waitForHealth(pythonProcess).catch((error) => {
            console.error(`[Python AI] Health-check falhou: ${error.message}`);
            Logger.getInstance().error('PYTHON', 'PYTHON_HEALTHCHECK_FAILED', error.message);
        });
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
            req.setTimeout(1500, () => req.destroy());
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
        return null;
    }
}

function stopPythonAI(pythonProcess) {
    if (pythonProcess && !pythonProcess.killed) {
        pythonProcess.kill();
    }
}

module.exports = { startPythonAI, stopPythonAI, getPythonPort, getPythonCommand };
