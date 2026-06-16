const { app, ipcMain } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { spawn, execSync, spawnSync } = require('child_process');

const PYTHON_ZIP_URL = 'https://www.python.org/ftp/python/3.10.11/python-3.10.11-embed-amd64.zip';
const EXPECTED_PYTHON_SHA256 = '608619f8619075629c9c69f361352a0da6ed7e62f83a0e19c63e0ea32eb7629d';
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
const EXPECTED_GETPIP_SHA256 = process.env.EXPECTED_GETPIP_SHA256 || '';

async function _verifyChecksum(filePath, expectedHash, label) {
    if (!expectedHash) {
        throw new Error(`Checksum não configurado para ${label}. Instalação bloqueada por política de integridade.`);
    }
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    await new Promise((resolve, reject) => {
        stream.on('data', d => hash.update(d));
        stream.on('end', resolve);
        stream.on('error', reject);
    });
    const actual = hash.digest('hex');
    if (actual !== expectedHash) {
        throw new Error(`Checksum inválido para ${label}: esperado=${expectedHash}, obtido=${actual}`);
    }
    console.log(`[Python Installer] Checksum OK para ${label}: ${actual.substring(0, 16)}...`);
    return true;
}

function _checkPython(command, importCheck = 'import fastapi, multipart') {
    const result = spawnSync(command, [
        '-c',
        `import sys; ${importCheck}; sys.exit(0 if sys.version_info < (3, 13) else 2)`,
    ], { stdio: 'ignore' });
    return result.status;
}

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
                const checkStatus = _checkPython(pythonExePath);
                if (checkStatus === 0) {
                    return { installed: true, path: pythonExePath };
                } else {
                    return { installed: false, needsRequirements: true, incompatiblePython: checkStatus === 2, path: pythonExePath };
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
                const checkStatus = _checkPython(cmd);
                if (checkStatus === 0) {
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

                // C5: Verifica checksum do Python zip
                await _verifyChecksum(zipPath, EXPECTED_PYTHON_SHA256, 'Python 3.10.11 embed');

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

                // C5: Verifica checksum do get-pip.py
                await _verifyChecksum(getPipPath, EXPECTED_GETPIP_SHA256, 'get-pip.py');

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

            // 6. Instalação de dependências (core obrigatório + opcionais separadamente)
            const installUtils = require('./python-install-utils.js');
            sendProgress('installing-requirements', 10, 'Instalando dependências essenciais (FastAPI, NumPy, SciPy...)...');
            const coreOk = installUtils.installCoreReqs(pythonExePath, (msg) => {
                sendProgress('installing-requirements', 30, msg);
            });

            if (!coreOk) {
                throw new Error('Falha na instalação dos pacotes Python essenciais. Verifique sua conexão com a internet.');
            }
            sendProgress('installing-requirements', 60, 'Dependências essenciais instaladas.');

            sendProgress('installing-requirements', 70, 'Instalando dependências opcionais (TensorFlow, classificação de áudio)...');
            const optResults = installUtils.installOptionalReqs(pythonExePath, (msg) => {
                sendProgress('installing-requirements', 80, msg);
            });
            const failed = optResults.filter(r => !r.ok);
            if (failed.length > 0) {
                console.warn('[Python Installer] Pacotes opcionais que não puderam ser instalados:');
                for (const f of failed) {
                    console.warn(`  - ${f.name}: ${f.error}`);
                }
            }

            sendProgress('completed', 100, 'Instalação completa! IA pronta para uso.');
            if (onCompleteCallback) {
                onCompleteCallback();
            }
            return true;

        } catch (error) {
            console.error('[Python Installer Error]:', error);
            sendProgress('error', 0, `Erro durante a instalação: ${error.message}`);
            return false;
        }
    });
}

module.exports = { setupPythonInstaller };
