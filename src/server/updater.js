const { app, ipcMain } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const crypto = require('crypto');

const GITHUB_REPO = 'AlexandreCalmonJr/SoundMaster_IA';
const VERSION_FILE = path.join(__dirname, '..', '..', 'version.json');

// ✅ T9: Função para calcular SHA256 do arquivo baixado (P22)
async function calculateSHA256(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

async function getLocalVersion() {
    try {
        const data = fs.readFileSync(VERSION_FILE, 'utf8');
        return JSON.parse(data).version;
    } catch (e) {
        return '1.0.0';
    }
}

async function checkForUpdates() {
    try {
        const response = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
        const latestVersion = response.data.tag_name.replace('v', '');
        const currentVersion = await getLocalVersion();

        if (latestVersion !== currentVersion) {
            // Procura pelo asset .zip que contém o bundle
            const asset = response.data.assets.find(a => a.name.endsWith('.zip'));
            if (!asset) {
                console.warn('[Updater] Nova versão encontrada, mas nenhum arquivo .zip está disponível no release.');
                return { available: false };
            }
            return {
                available: true,
                version: latestVersion,
                downloadUrl: asset.browser_download_url,
                notes: response.data.body
            };
        }
    } catch (error) {
        console.error('[Updater] Erro ao verificar atualizações:', error.message);
    }
    return { available: false };
}

async function downloadAndInstallUpdate(downloadUrl, newVersion) {
    const updateDir = path.join(app.getPath('userData'), 'updates', newVersion);
    const zipPath = path.join(app.getPath('userData'), 'update.zip');

    if (!fs.existsSync(path.dirname(updateDir))) {
        fs.mkdirSync(path.dirname(updateDir), { recursive: true });
    }

    try {
        console.log(`[Updater] Baixando atualização ${newVersion}...`);
        const response = await axios({
            method: 'get',
            url: downloadUrl,
            responseType: 'stream'
        });

        const writer = fs.createWriteStream(zipPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            response.data.on('error', (err) => {
                console.error('[Updater] Erro no stream de download:', err.message);
                writer.destroy();
                reject(err);
            });
            writer.on('error', reject);
            writer.on('finish', async () => {
                console.log('[Updater] Download concluído. Verificando integridade...');
                try {
                    // ✅ T9: Verificação de integridade SHA256 (P22)
                    const fileHash = await calculateSHA256(zipPath);
                    console.log(`[Updater] SHA256: ${fileHash.substring(0, 16)}...`);
                    
                    // Verifica se há hash esperado no .env (para produção)
                    const expectedHash = process.env.UPDATE_HASH;
                    if (expectedHash && fileHash !== expectedHash) {
                        throw new Error('Hash SHA256 inválido! Atualização pode estar comprometida.');
                    }
                    
                    console.log('[Updater] Integridade verificada. Extraindo...');
                    const zip = new AdmZip(zipPath);
                    zip.extractAllTo(updateDir, true);
                    
                    // Salva a versão atual em um arquivo de controle no userData
                    const configPath = path.join(app.getPath('userData'), 'current_update.json');
                    fs.writeFileSync(configPath, JSON.stringify({
                        version: newVersion,
                        path: updateDir
                    }));

                    fs.unlinkSync(zipPath); // Remove o zip
                    console.log('[Updater] Atualização instalada com sucesso em:', updateDir);
                    resolve(true);
                } catch (err) {
                    reject(err);
                }
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('[Updater] Erro no download:', error.message);
        return false;
    }
}

function setupUpdater(mainWindow) {
    ipcMain.handle('check-update', async () => {
        return await checkForUpdates();
    });

    ipcMain.handle('start-update', async (event, { url, version }) => {
        const success = await downloadAndInstallUpdate(url, version);
        if (success) {
            // Notifica o front que está pronto para reiniciar
            mainWindow.webContents.send('update-ready');
        }
        return success;
    });

    ipcMain.on('restart-app', () => {
        app.relaunch();
        app.exit();
    });
}

module.exports = { setupUpdater };
