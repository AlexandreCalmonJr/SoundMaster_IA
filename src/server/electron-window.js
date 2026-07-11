const { BrowserWindow, session } = require('electron');
const path = require('path');

async function configureElectronSession() {
    const ALLOWED_PERMISSIONS = ['media', 'audioCapture', 'notifications'];

    try {
        await session.defaultSession.clearCache();
        console.log('[Electron] Cache HTTP limpo com sucesso no início.');
    } catch (err) {
        console.warn('[Electron] Falha ao limpar o cache:', err.message);
    }

    function isAllowedOrigin(url) {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        } catch (_) {
            return false;
        }
    }

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const origin = webContents.getURL();
        callback(ALLOWED_PERMISSIONS.includes(permission) && isAllowedOrigin(origin));
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        if (!webContents) return ALLOWED_PERMISSIONS.includes(permission);
        const origin = webContents.getURL();
        return ALLOWED_PERMISSIONS.includes(permission) && isAllowedOrigin(origin);
    });
}

function createWindow(port) {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, '..', 'preload.js')
        },
        autoHideMenuBar: true
    });

    win.webContents.session.clearCache();
    win.loadURL(`http://localhost:${port}`);
    if (process.env.NODE_ENV === 'development') {
        win.webContents.openDevTools();
    }
    return win;
}

module.exports = { configureElectronSession, createWindow };
