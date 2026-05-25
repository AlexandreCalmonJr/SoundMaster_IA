const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updater', {
    checkUpdate: () => ipcRenderer.invoke('check-update'),
    startUpdate: (data) => ipcRenderer.invoke('start-update', data),
    onUpdateReady: (callback) => ipcRenderer.on('update-ready', callback),
    restartApp: () => ipcRenderer.send('restart-app')
});

contextBridge.exposeInMainWorld('pythonInstaller', {
    checkPython: () => ipcRenderer.invoke('check-python'),
    installPython: () => ipcRenderer.invoke('install-python'),
    onInstallProgress: (callback) => ipcRenderer.on('python-install-progress', (event, data) => callback(data))
});
