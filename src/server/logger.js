const fs = require('fs');
const path = require('path');

class Logger {
    static instance = null;

    static getInstance(logDir = './logs') {
        if (!Logger.instance) {
            Logger.instance = new Logger(logDir);
        }
        return Logger.instance;
    }

    constructor(logDir) {
        this.logFile = path.join(logDir, `audit_${new Date().toISOString().split('T')[0]}.log`);
        if (!fs.existsSync(logDir)) {
            try { fs.mkdirSync(logDir, { recursive: true }); } catch(e) {}
        }
        this.onLog = null;
        this._buffer = [];
        this._bufferSize = 50;
        this._flushInterval = null;
        this._startFlushTimer();
    }

    _startFlushTimer() {
        this._flushInterval = setInterval(() => this._flush(), 5000);
        if (this._flushInterval && this._flushInterval.unref) {
            this._flushInterval.unref();
        }
    }

    _flush() {
        if (this._buffer.length === 0) return;
        const lines = this._buffer.splice(0).join('\n') + '\n';
        fs.appendFile(this.logFile, lines, (err) => {
            if (err) console.error('[Logger] Falha ao escrever log:', err.message);
        });
    }

    log(level, socketId, event, data) {
        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            level: level.toUpperCase(),
            socketId: socketId || 'SYSTEM',
            event,
            data
        };
        const logString = JSON.stringify(entry);
        
        const colors = {
            info: '\x1b[32m',
            warn: '\x1b[33m',
            error: '\x1b[31m',
            system: '\x1b[36m'
        };
        const color = colors[level] || '\x1b[37m';
        
        // Log para console
        console.log(`${color}[${timestamp}] [${level.toUpperCase()}] [${socketId || 'SYSTEM'}] ${event}\x1b[0m`, data || '');

        // Buffer para persistência assíncrona
        this._buffer.push(logString);
        if (this._buffer.length >= this._bufferSize) {
            this._flush();
        }

        // Broadcast
        if (this.onLog) this.onLog(entry);
    }

    info(socketId, event, data) { this.log('info', socketId, event, data); }
    warn(socketId, event, data) { this.log('warn', socketId, event, data); }
    error(socketId, event, data) { this.log('error', socketId, event, data); }
    system(event, data) { this.log('system', 'SYSTEM', event, data); }

    destroy() {
        if (this._flushInterval) {
            clearInterval(this._flushInterval);
            this._flushInterval = null;
        }
        this._flush();
    }
}

module.exports = Logger;
