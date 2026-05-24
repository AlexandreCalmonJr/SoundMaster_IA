const path = require('path');
const fs = require('fs');

// ✅ Novo: Carregador manual de .env para garantir sincronia de chaves com a IA
try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const [key, ...value] = line.split('=');
            if (key && value) {
                process.env[key.trim()] = value.join('=').trim();
            }
        });
        console.log('[Main] Variáveis de ambiente carregadas do .env');
    }
} catch (e) {
    console.warn('[Main] Falha ao carregar .env:', e.message);
}

const { app, BrowserWindow, ipcMain } = require('electron');
const { createAppServer } = require('./server/app-server');
const { configureElectronSession, createWindow } = require('./server/electron-window');
const { getLocalIp } = require('./server/network');
const { startPythonAI, stopPythonAI } = require('./server/python-ai');
const { setupUpdater } = require('./server/updater');
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
            ROOT_DIR = config.path;
            console.log('[Main] Usando arquivos da versão atualizada:', config.version);
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

function startServer() {
    const { server, io } = createHttpServer();
    ioInstance = io;

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`[Main] Erro: A porta ${PORT} já está em uso por outro processo.`);
            console.error('[Main] Feche outros apps que possam estar usando esta porta e tente novamente.');
            app.quit();
        } else {
            console.error('[Main] Erro inesperado no servidor:', err.message);
        }
    });

    server.listen(PORT, () => {
        console.log('====================================');
        console.log('SoundMaster Backend Rodando!');
        console.log(`IP Local para acesso: http://${localIp}:${PORT}`);
        console.log('====================================');
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
        }
    });
}

app.whenReady().then(async () => {
    if (isInitialized) return;
    isInitialized = true;
    
    // Inicia servidor primeiro para ter ioInstance disponível
    startServer();
    
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

    // Log de Performance (A cada 60s para não poluir)
    setInterval(() => {
        const usage = process.memoryUsage();
        console.log(`[Status] Memória: ${Math.round(usage.heapUsed / 1024 / 1024)}MB | CPU: ${Math.round(process.cpuUsage().user / 1000000)}s`);
    }, 60000);

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
