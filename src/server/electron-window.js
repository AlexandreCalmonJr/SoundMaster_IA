const { BrowserWindow, session } = require('electron');
const path = require('path');

async function configureElectronSession() {
    await session.defaultSession.clearStorageData();

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ['media', 'audioCapture', 'notifications'];
        callback(allowed.includes(permission));
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        const allowed = ['media', 'audioCapture', 'notifications'];
        return allowed.includes(permission);
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

    win.loadURL(`http://localhost:${port}`);
    return win;
}

module.exports = { configureElectronSession, createWindow };
