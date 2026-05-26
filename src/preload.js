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

contextBridge.exposeInMainWorld('audioCapture', {
    listDevices: () => ipcRenderer.invoke('audio-capture-list-devices'),
    startCapture: (opts) => ipcRenderer.invoke('audio-capture-start', opts),
    stopCapture: () => ipcRenderer.invoke('audio-capture-stop'),
    onAudioData: (callback) => ipcRenderer.on('audio-capture-data', (event, data) => callback(data)),
    onStart: (callback) => ipcRenderer.on('audio-capture-started', (event, data) => callback(data)),
    onStop: (callback) => ipcRenderer.on('audio-capture-stopped', (event, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('audio-capture-error', (event, err) => callback(err))
});
