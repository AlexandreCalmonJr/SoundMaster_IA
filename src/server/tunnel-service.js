const { spawn } = require('child_process');

let tunnelProcess = null;
let tunnelUrl = null;

function startTunnel(port) {
    return new Promise((resolve) => {
        if (tunnelProcess) {
            resolve({ success: true, url: tunnelUrl });
            return;
        }
        try {
            const cp = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let started = false;
            cp.stdout.on('data', (data) => {
                const text = data.toString();
                const match = text.match(/https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/);
                if (match && !started) {
                    started = true;
                    tunnelUrl = match[0];
                    tunnelProcess = cp;
                    resolve({ success: true, url: tunnelUrl });
                }
            });
            cp.on('error', () => {
                resolve({ success: false, error: 'cloudflared não encontrado' });
            });
            cp.on('exit', () => {
                tunnelProcess = null;
                tunnelUrl = null;
            });
            setTimeout(() => {
                if (!started) {
                    cp.kill();
                    resolve({ success: false, error: 'Timeout ao conectar túnel' });
                }
            }, 15000);
        } catch (e) {
            resolve({ success: false, error: e.message });
        }
    });
}

function stopTunnel() {
    if (tunnelProcess) {
        tunnelProcess.kill();
        tunnelProcess = null;
        tunnelUrl = null;
    }
    return { success: true };
}

function toggleTunnel(port) {
    if (tunnelProcess) {
        stopTunnel();
        return Promise.resolve({ success: true, active: false });
    }
    return startTunnel(port).then(result => ({
        ...result,
        active: !!result.url
    }));
}

function getTunnelUrl() {
    return tunnelUrl;
}

module.exports = { startTunnel, stopTunnel, toggleTunnel, getTunnelUrl };