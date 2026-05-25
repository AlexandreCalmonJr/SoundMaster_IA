const { app, ipcMain } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { spawn, execSync, spawnSync } = require('child_process');

const PYTHON_ZIP_URL = 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

function setupPythonInstaller(mainWindow, onCompleteCallback) {
    const userDataPath = app.getPath('userData');
    const portableDir = path.join(userDataPath, 'python-portable');
    const zipPath = path.join(userDataPath, 'python-portable.zip');
    const getPipPath = path.join(portableDir, 'get-pip.py');
    const pythonExePath = path.join(portableDir, 'python.exe');

    // O requirements.txt fica no pacote estático (somente leitura) da aplicação
    const appAiDir = path.join(app.getAppPath(), 'backend', 'ai');
    const reqsTxtPath = path.join(appAiDir, 'requirements.txt');

    const sendProgress = (stage, percent, msg) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('python-install-progress', { stage, percent, msg });
        }
    };

    ipcMain.handle('check-python', async () => {
        // 1. Verifica se a versão portátil já está instalada
        if (fs.existsSync(pythonExePath)) {
            try {
                // Testa se o python portátil e o fastapi/multipart estão funcionando
                const checkResult = spawnSync(pythonExePath, ['-c', 'import fastapi, multipart'], { stdio: 'ignore' });
                if (checkResult.status === 0) {
                    return { installed: true, path: pythonExePath };
                } else {
                    return { installed: false, needsRequirements: true, path: pythonExePath };
                }
            } catch (_) {
                console.warn('[Python Installer] Falha ao verificar dependências do Python portátil:', _.message);
                // Se existe o exe mas falha ao carregar fastapi, necessita reparo/instalação
                return { installed: false, needsRequirements: true, path: pythonExePath };
            }
        }

        // 2. Verifica candidatos globais como fallback
        const globalCandidates = ['python', 'python3'];
        if (process.platform === 'win32') globalCandidates.push('py');

        for (const cmd of globalCandidates) {
            try {
                const checkResult = spawnSync(cmd, ['-c', 'import fastapi, multipart'], { stdio: 'ignore' });
                if (checkResult.status === 0) {
                    return { installed: true, path: cmd };
                }
            } catch (_) { console.warn('[Python Installer] Falha ao verificar Python global:', _.message); }
        }

        return { installed: false, path: null };
    });

    ipcMain.handle('install-python', async () => {
        try {
            // Garantir que o diretório de destino do Python portátil existe
            if (!fs.existsSync(portableDir)) {
                fs.mkdirSync(portableDir, { recursive: true });
            }

            // 1. Download do Python Zip
            if (!fs.existsSync(pythonExePath)) {
                sendProgress('downloading-python', 0, 'Iniciando download do Python 3.10 portátil...');
                
                const response = await axios({
                    method: 'get',
                    url: PYTHON_ZIP_URL,
                    responseType: 'stream'
                });

                const totalBytes = parseInt(response.headers['content-length'], 10) || 10500000;
                let downloadedBytes = 0;

                const writer = fs.createWriteStream(zipPath);
                response.data.pipe(writer);

                await new Promise((resolve, reject) => {
                    response.data.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        const percent = Math.min(Math.round((downloadedBytes / totalBytes) * 100), 99);
                        sendProgress('downloading-python', percent, `Baixando interpretador Python... (${percent}%)`);
                    });
                    
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                    response.data.on('error', reject);
                });

                sendProgress('downloading-python', 100, 'Download do Python concluído.');

                // 2. Extração do Zip
                sendProgress('extracting-python', 0, 'Extraindo arquivos do Python portátil...');
                if (!fs.existsSync(portableDir)) {
                    fs.mkdirSync(portableDir, { recursive: true });
                }

                const zip = new AdmZip(zipPath);
                zip.extractAllTo(portableDir, true);
                
                try {
                    fs.unlinkSync(zipPath);
                } catch (_) { console.warn('[Python Installer] Falha ao remover zip após extração:', _.message); }

                sendProgress('extracting-python', 100, 'Extração concluída.');

                // 3. Patch no arquivo ._pth do Python portátil (crucial para o pip funcionar)
                sendProgress('patching-pth', 50, 'Configurando caminhos de sistema do Python...');
                const files = fs.readdirSync(portableDir);
                const pthFile = files.find(f => f.endsWith('._pth'));
                if (pthFile) {
                    const pthPath = path.join(portableDir, pthFile);
                    let pthContent = fs.readFileSync(pthPath, 'utf8');
                    // Descomenta 'import site'
                    pthContent = pthContent.replace(/#\s*import site/, 'import site');
                    fs.writeFileSync(pthPath, pthContent, 'utf8');
                }
                sendProgress('patching-pth', 100, 'Caminhos de sistema configurados.');
            }

            // 4. Download do get-pip.py se necessário
            const pipCheckPath = path.join(portableDir, 'Scripts', 'pip.exe');
            if (!fs.existsSync(pipCheckPath)) {
                sendProgress('downloading-pip', 0, 'Baixando instalador do pip...');
                
                const pipRes = await axios({
                    method: 'get',
                    url: GET_PIP_URL,
                    responseType: 'stream'
                });

                const pipWriter = fs.createWriteStream(getPipPath);
                pipRes.data.pipe(pipWriter);

                await new Promise((resolve, reject) => {
                    pipWriter.on('finish', resolve);
                    pipWriter.on('error', reject);
                    pipRes.data.on('error', reject);
                });

                sendProgress('downloading-pip', 100, 'Download do pip concluído.');

                // 5. Instalação do pip
                sendProgress('installing-pip', 50, 'Bootstraping pip no interpretador portátil...');
                const pipResult = spawnSync(pythonExePath, [getPipPath, '--quiet'], { cwd: portableDir });
                if (pipResult.error) {
                    throw pipResult.error;
                }
                if (pipResult.status !== 0) {
                    throw new Error(`Bootstrap do pip falhou com código ${pipResult.status}`);
                }
                
                try {
                    fs.unlinkSync(getPipPath);
                } catch (_) { console.warn('[Python Installer] Falha ao remover get-pip.py:', _.message); }
                sendProgress('installing-pip', 100, 'Gerenciador pip instalado com sucesso.');
            }

            // 6. Instalação de dependências do requirements.txt
            if (fs.existsSync(reqsTxtPath)) {
                sendProgress('installing-requirements', 10, 'Instalando dependências de IA (FastAPI, NumPy, SciPy...) - Isso pode demorar de 1 a 3 minutos...');
                
                return new Promise((resolve, reject) => {
                    const pipProcess = spawn(pythonExePath, ['-m', 'pip', 'install', '-r', reqsTxtPath, '--quiet'], {
                        cwd: portableDir
                    });

                    let progressPercent = 10;
                    const progressInterval = setInterval(() => {
                        if (progressPercent < 90) {
                            progressPercent += 5;
                            sendProgress('installing-requirements', progressPercent, `Instalando pacotes de IA... (Aproximadamente ${progressPercent}%)`);
                        }
                    }, 5000);

                    pipProcess.on('close', (code) => {
                        clearInterval(progressInterval);
                        if (code === 0) {
                            sendProgress('completed', 100, 'Instalação completa! IA pronta para uso.');
                            if (onCompleteCallback) {
                                onCompleteCallback();
                            }
                            resolve(true);
                        } else {
                            reject(new Error(`Falha na instalação dos pacotes Python (Código de saída: ${code})`));
                        }
                    });

                    pipProcess.on('error', (err) => {
                        clearInterval(progressInterval);
                        reject(err);
                    });
                });
            } else {
                sendProgress('completed', 100, 'Instalação completa! requirements.txt não encontrado.');
                if (onCompleteCallback) {
                    onCompleteCallback();
                }
                return true;
            }

        } catch (error) {
            console.error('[Python Installer Error]:', error);
            sendProgress('error', 0, `Erro durante a instalação: ${error.message}`);
            return false;
        }
    });
}

module.exports = { setupPythonInstaller };
