const dgram = require('dgram');
const { EventEmitter } = require('events');

/**
 * AES67 Receptor Simplificado
 * Ouve pacotes RTP na porta padrão (ou configurada)
 */
class AES67Receiver extends EventEmitter {
    constructor(port = 5004) {
        super();
        this.port = port;
        this.server = null;
        this.isStreaming = false;
    }

    start() {
        // Cria o socket dinamicamente no start()
        this.server = dgram.createSocket('udp4');

        this.server.on('error', (err) => {
            console.error(`[AES67] Erro: ${err.stack}`);
            this.server.close();
            this.server = null;
            this.isStreaming = false;
        });

        this.server.on('message', (msg, rinfo) => {
            const payload = msg.slice(12);
            
            this.emit('multi-channel-audio', {
                buffer: payload,
                channels: 32,
                bitDepth: 24,
                sampleRate: 48000
            });
        });

        this.server.on('listening', () => {
            const address = this.server.address();
            console.log(`[AES67] Receptor Ativo em ${address.address}:${address.port}`);
        });

        try {
            this.server.bind(this.port);
            this.isStreaming = true;
        } catch (e) {
            console.error('[AES67] Falha ao iniciar receptor:', e.message);
            this.isStreaming = false;
            this.server = null;
        }
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        if (this.isStreaming) {
            this.isStreaming = false;
            console.log('[AES67] Receptor parado.');
        }
    }
}

module.exports = new AES67Receiver();
