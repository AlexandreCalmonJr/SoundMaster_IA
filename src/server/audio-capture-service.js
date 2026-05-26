const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class AudioCaptureService extends EventEmitter {
    constructor() {
        super();
        this._process = null;
        this._active = false;
        this._sampleRate = 48000;
        this._channels = 2;
        this._bufferSize = 256;
        this._deviceIndex = null;
    }

    async listDevices() {
        try {
            const pythonCmd = this._findPython();
            if (!pythonCmd) return this._getFallbackDevices();

            const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'list_audio_devices.py');
            if (!fs.existsSync(scriptPath)) return this._getFallbackDevices();

            return new Promise((resolve) => {
                const proc = spawn(pythonCmd, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
                let output = '';
                proc.stdout.on('data', (d) => { output += d.toString(); });
                proc.on('close', () => {
                    try {
                        const devices = JSON.parse(output);
                        resolve(devices);
                    } catch {
                        resolve(this._getFallbackDevices());
                    }
                });
                proc.on('error', () => resolve(this._getFallbackDevices()));
            });
        } catch {
            return this._getFallbackDevices();
        }
    }

    async startCapture(options = {}) {
        if (this._active) return;
        this._sampleRate = options.sampleRate || this._sampleRate;
        this._channels = options.channels || this._channels;
        this._bufferSize = options.bufferSize || this._bufferSize;
        this._deviceIndex = options.deviceIndex !== undefined ? options.deviceIndex : null;

        try {
            const pythonCmd = this._findPython();
            if (!pythonCmd) throw new Error('Python não disponível');

            const captureScript = path.join(__dirname, '..', '..', 'scripts', 'wasapi_capture.py');
            if (!fs.existsSync(captureScript)) throw new Error('Script WASAPI não encontrado');

            const args = [
                captureScript,
                '--rate', String(this._sampleRate),
                '--channels', String(this._channels),
                '--buffer', String(this._bufferSize)
            ];
            if (this._deviceIndex !== null) {
                args.push('--device', String(this._deviceIndex));
            }

            this._process = spawn(pythonCmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

            let buffer = Buffer.alloc(0);
            this._process.stdout.on('data', (data) => {
                buffer = Buffer.concat([buffer, data]);
                const FLOAT_SIZE = 4;
                const frameSize = FLOAT_SIZE * this._channels;
                while (buffer.length >= frameSize * 256) {
                    const chunk = buffer.subarray(0, frameSize * 256);
                    buffer = buffer.subarray(frameSize * 256);
                    const floats = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / FLOAT_SIZE);
                    this.emit('audio', floats, this._sampleRate, this._channels);
                }
            });

            this._process.stderr.on('data', (data) => {
                console.warn(`[AudioCapture] stderr:`, data.toString().trim());
            });

            this._process.on('close', (code) => {
                this._active = false;
                this.emit('stop', { code });
            });

            this._process.on('error', (err) => {
                console.error(`[AudioCapture] Erro:`, err.message);
                this._active = false;
                this.emit('error', err);
            });

            this._active = true;
            console.log(`[AudioCapture] Captura iniciada WASAPI/Python (${this._sampleRate}Hz, ${this._channels}ch)`);
            this.emit('start', { sampleRate: this._sampleRate, channels: this._channels });
        } catch (err) {
            console.warn(`[AudioCapture] Fallback para browser getUserMedia:`, err.message);
            this.emit('fallback', { reason: err.message, method: 'getUserMedia' });
        }
    }

    stopCapture() {
        if (this._process && !this._process.killed) {
            this._process.kill();
            this._process = null;
        }
        this._active = false;
        this.emit('stop', { code: 0 });
    }

    get active() { return this._active; }

    _findPython() {
        const isWin = process.platform === 'win32';
        const candidates = ['python', 'python3'];
        if (isWin) candidates.push('py');
        const { execSync } = require('child_process');
        for (const cmd of candidates) {
            try {
                execSync(`${cmd} -c "import sys; print(sys.version)"`, { stdio: 'ignore' });
                return cmd;
            } catch { continue; }
        }
        return null;
    }

    _getFallbackDevices() {
        return [
            { id: 'browser', name: 'Padrão do Navegador (getUserMedia)', channels: 1, isDefault: true },
            { id: 'wasapi-fallback', name: 'Sistema (WASAPI via Python)', channels: 2, isDefault: false }
        ];
    }
}

module.exports = AudioCaptureService;
