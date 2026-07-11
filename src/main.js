const path = require('path');
const fs = require('fs');

// ⚡ Fix de encoding UTF-8 no terminal Windows (evita ├│├¬├í em vez de ó,ê,á)
if (process.platform === 'win32') {
    try {
        require('child_process').execSync('chcp 65001', { stdio: 'ignore', shell: true });
    } catch (_) { /* ignora se chcp não disponível */ }
}

const { app, BrowserWindow, ipcMain } = require('electron');

// Carregador manual de .env para desenvolvimento e produção
function loadEnvironmentVariables() {
    const crypto = require('crypto');
    
    // 1. Tenta carregar do diretório raiz do projeto (desenvolvimento)
    const rootEnvPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(rootEnvPath)) {
        try {
            const envContent = fs.readFileSync(rootEnvPath, 'utf8');
            envContent.split('\n').forEach(line => {
                const [key, ...value] = line.split('=');
                if (key && value) {
                    process.env[key.trim()] = value.join('=').trim();
                }
            });
            console.log('[Main] Variáveis de ambiente carregadas do .env raiz');
        } catch (e) {
            console.warn('[Main] Falha ao carregar .env raiz:', e.message);
        }
    }

    // 2. Garante/Gera arquivo .env persistente em userData (fundamental para build em produção)
    try {
        const userDataPath = app.getPath('userData');
        const userEnvPath = path.join(userDataPath, '.env');
        
        let existingVars = {};
        if (fs.existsSync(userEnvPath)) {
            const userEnvContent = fs.readFileSync(userEnvPath, 'utf8');
            userEnvContent.split('\n').forEach(line => {
                const [key, ...value] = line.split('=');
                if (key && value) {
                    existingVars[key.trim()] = value.join('=').trim();
                }
            });
        }

        // Se chaves fundamentais estão ausentes, geramos valores persistentes
        let modified = false;
        if (!existingVars.JWT_SECRET && !process.env.JWT_SECRET) {
            existingVars.JWT_SECRET = crypto.randomBytes(32).toString('hex');
            modified = true;
        }
        if (!existingVars.AI_API_KEY && !process.env.AI_API_KEY) {
            existingVars.AI_API_KEY = crypto.randomBytes(32).toString('hex');
            modified = true;
        }
        if (!existingVars.PORT && !process.env.PORT) {
            existingVars.PORT = '3001';
            modified = true;
        }
        if (!existingVars.PYTHON_PORT && !process.env.PYTHON_PORT) {
            existingVars.PYTHON_PORT = '3002';
            modified = true;
        }

        if (modified) {
            const newEnvContent = Object.entries(existingVars)
                .map(([k, v]) => `${k}=${v}`)
                .join('\n');
            fs.writeFileSync(userEnvPath, newEnvContent, 'utf8');
            console.log('[Main] Novo arquivo .env gerado/atualizado em userData:', userEnvPath);
        }

        // Carrega as variáveis de userData no process.env (sem sobrescrever as do .env raiz)
        Object.entries(existingVars).forEach(([k, v]) => {
            if (!process.env[k]) {
                process.env[k] = v;
            }
        });
        
    } catch (e) {
        console.warn('[Main] Falha ao configurar .env em userData:', e.message);
    }
}

loadEnvironmentVariables();
const { createAppServer } = require('./server/app-server');
const { configureElectronSession, createWindow } = require('./server/electron-window');
const { getLocalIp } = require('./server/network');
const { startPythonAI, stopPythonAI } = require('./server/python-ai');
const { setupUpdater } = require('./server/updater');
const { setupPythonInstaller } = require('./server/python-installer');
const AudioCaptureService = require('./server/audio-capture-service');
const historyService = require('./server/history-service');
const aiPredictor = require('./server/ai-predictor');
const aes67Service = require('./server/aes67-service');
const multiChannelAnalyzer = require('./server/multi-channel-analyzer');


let ROOT_DIR = path.join(__dirname, '..');
const updateConfigPath = path.join(app.getPath('userData'), 'current_update.json');

if (fs.existsSync(updateConfigPath)) {
    try {
        const config = JSON.parse(fs.readFileSync(updateConfigPath, 'utf8'));
        if (fs.existsSync(config.path)) {
            // C2: Valida que o path da atualização está dentro de userData/updates/
            const resolved = path.resolve(config.path);
            const allowed = path.resolve(app.getPath('userData'), 'updates');
            if (resolved.startsWith(allowed + path.sep) || resolved === allowed) {
                ROOT_DIR = config.path;
                console.log('[Main] Usando arquivos da versão atualizada:', config.version);
            } else {
                console.error('[Main] Caminho de update inválido (fora de userData/updates/):', config.path);
            }
        }
    } catch (e) {
        console.error('[Main] Erro ao ler configuração de update:', e.message);
    }
}

// ✅ T10: Porta configurável via .env (Original #14)
const PORT = parseInt(process.env.PORT || '3001', 10);
const PYTHON_PORT = parseInt(process.env.PYTHON_PORT || '3002', 10);
const localIp = getLocalIp();

let pythonProcess = null;

function createHttpServer() {
    const dbDir = app.getPath('userData');
    return createAppServer({
        app,
        rootDir: ROOT_DIR,
        localIp,
        port: PORT,
        dbDir
    });
}

let ioInstance = null;

function setupConsoleBridge(io) {
    let isLogging = false;
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const handleLog = (type, originalFn, ...args) => {
        originalFn.apply(console, args);
        if (isLogging) return;
        isLogging = true;
        try {
            const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
            if (io) {
                io.emit('system_log', {
                    msg: msg,
                    severity: type,
                    ts: Date.now()
                });
            }
        } catch (_) {}
        isLogging = false;
    };

    console.log = (...args) => handleLog('info', originalLog, ...args);
    console.warn = (...args) => handleLog('warn', originalWarn, ...args);
    console.error = (...args) => handleLog('error', originalError, ...args);
}

function startServer() {
    return new Promise((resolve, reject) => {
        const { server, io } = createHttpServer();
        ioInstance = io;
        setupConsoleBridge(io);

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`[Main] Erro: A porta ${PORT} já está em uso por outro processo.`);
                console.error('[Main] Feche outros apps que possam estar usando esta porta e tente novamente.');
                app.quit();
            } else {
                console.error('[Main] Erro inesperado no servidor:', err.message);
            }
            reject(err);
        });

        server.listen(PORT, () => {
            console.log('====================================');
            console.log('SoundMaster Backend Rodando!');
            console.log(`IP Local para acesso: http://${localIp}:${PORT}`);
            console.log('====================================');
            resolve();
        });
    });
}

let isInitialized = false;

function triggerPythonAI() {
    if (pythonProcess && !pythonProcess.killed) return;
    const aiPath = path.join(ROOT_DIR, 'backend', 'ai');
    pythonProcess = startPythonAI(aiPath, (code) => {
        console.error(`[Main] ⚠️ IA OFFLINE (código ${code})`);
        if (ioInstance) {
            ioInstance.emit('system_log', { 
                msg: `⚠️ IA OFFLINE. Código: ${code}. Execute 'npm run start' para reiniciar.`, 
                severity: 'error',
                ts: Date.now()
            });
            ioInstance.emit('ai_status', { available: false, lite: true });
        }
    });

    if (!pythonProcess) {
        if (ioInstance) {
            ioInstance.emit('ai_status', { available: false, lite: true, msg: 'Python não detectado — rodando em Modo Lite. IA indisponível.' });
        }
    }

    if (pythonProcess) {
        pythonProcess.healthCheck().catch(() => {
            if (ioInstance) {
                ioInstance.emit('ai_status', { available: false, lite: true, msg: 'Servidor Python não respondeu — Modo Lite ativado.' });
            }
        });
    }
}

function setupAudioCapture(mainWindow, audioCaptureService) {
    ipcMain.handle('audio-capture-list-devices', async () => {
        return await audioCaptureService.listDevices();
    });

    ipcMain.handle('audio-capture-start', async (event, options) => {
        await audioCaptureService.startCapture(options);
        if (!audioCaptureService.active) return { fallback: true };

        audioCaptureService.on('audio', (samples, sampleRate, channels) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('audio-capture-data', {
                    samples: Array.from(samples),
                    sampleRate,
                    channels
                });
            }
        });
        audioCaptureService.on('stop', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('audio-capture-stopped', data);
            }
        });
        audioCaptureService.on('error', (err) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('audio-capture-error', { message: err.message });
            }
        });
        audioCaptureService.on('fallback', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('audio-capture-started', { method: data.method, reason: data.reason });
            }
        });

        mainWindow.webContents.send('audio-capture-started', { method: 'wasapi', sampleRate: options.sampleRate || 48000 });
        return { active: true };
    });

    ipcMain.handle('audio-capture-stop', () => {
        audioCaptureService.stopCapture();
        return { stopped: true };
    });
}

app.whenReady().then(async () => {
    if (isInitialized) return;
    isInitialized = true;
    
    // Inicia servidor primeiro e aguarda estar pronto
    await startServer();
    
    triggerPythonAI();
    await configureElectronSession();
    
    const mainWindow = createWindow(PORT);
    
    // Inicializa Serviços de Engenharia
    historyService.init(app.getPath('userData'));
    await aiPredictor.init();
    
    // Inicia receptor de rede e analisador multi-canal
    if (ioInstance) {
        multiChannelAnalyzer.init(ioInstance);
    }
    // aes67Service.start(); 

    // Configura o sistema de update
    setupUpdater(mainWindow);

    // Configura o instalador de Python portátil
    setupPythonInstaller(mainWindow, () => triggerPythonAI());

    // Configura captura WASAPI/ASIO via Electron IPC
    const audioCaptureService = new AudioCaptureService();
    setupAudioCapture(mainWindow, audioCaptureService);

    // Log de Performance (A cada 60s para não poluir)
    const perfInterval = setInterval(() => {
        const usage = process.memoryUsage();
        console.log(`[Status] Memória: ${Math.round(usage.heapUsed / 1024 / 1024)}MB | CPU: ${Math.round(process.cpuUsage().user / 1000000)}s`);
    }, 60000);
    perfInterval.unref();

    app.on('activate', () => {
        triggerPythonAI();
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow(PORT);
        }
    });
});

app.on('window-all-closed', () => {
    stopPythonAI(pythonProcess);
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('quit', () => {
    stopPythonAI(pythonProcess);
});
