const aes67 = require('./aes67-service');

/**
 * LoopbackService - Extrai o sinal de referência da mesa via AES67
 * e o transmite via WebSockets para o frontend.
 */
class LoopbackService {
    constructor() {
        this.io = null;
        this.referenceChannel = 30; // Canal 31 (Índice 30) - Geralmente Main L na Ui24R
        this.sampleBuffer = [];
        this.maxBufferSize = 2048; // Tamanho do bloco para envio via socket
        this.simulationInterval = null;
    }

    init(io) {
        this.io = io;
        
        const mixer = require('./mixer-singleton').getMixer();
        const isSimulated = mixer && mixer.isSimulated;

        if (isSimulated) {
            console.log('[Loopback] Modo SIMULADO ativo. Gerando ruído rosa interno.');
            this.startSimulation();
        } else if (!aes67.isStreaming) {
            aes67.start();
            aes67.on('multi-channel-audio', (data) => {
                this.processAudio(data);
            });
        }

        console.log(`[Loopback] Extraindo canal de referência ${this.referenceChannel + 1} via AES67.`);
    }

    startSimulation() {
        // Limpa qualquer intervalo anterior
        this.stopSimulation();
        
        // Envia blocos de ruído a cada ~42ms (equivalente a 2048 samples a 48kHz)
        this.simulationInterval = setInterval(() => {
            if (!this.io) return;
            const simulatedSamples = new Float32Array(this.maxBufferSize);
            for (let i = 0; i < this.maxBufferSize; i++) {
                simulatedSamples[i] = (Math.random() * 2 - 1) * 0.5; // Ruído Branco simples
            }
            this.io.emit('reference_audio_stream', {
                samples: Array.from(simulatedSamples)
            });
        }, 42);
    }

    stopSimulation() {
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
            this.simulationInterval = null;
            console.log('[Loopback] Simulação interrompida.');
        }
    }

    processAudio({ buffer, channels, bitDepth }) {
        if (this.referenceChannel >= channels) {
            console.warn(`[Loopback] referenceChannel (${this.referenceChannel}) >= channels (${channels}). Ignorando.`);
            return;
        }
        const bytesPerSample = bitDepth / 8;
        const totalSamples = buffer.length / (channels * bytesPerSample);
        const MAX_BUFFER_SAMPLES = this.maxBufferSize * 4;

        for (let s = 0; s < totalSamples; s++) {
            const offset = (s * channels + this.referenceChannel) * bytesPerSample;
            if (offset + 2 >= buffer.length) break;

            let val = (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
            if (val & 0x800000) val |= 0xFF000000;
            this.sampleBuffer.push(val / 8388607.0);
        }

        if (this.sampleBuffer.length > MAX_BUFFER_SAMPLES) {
            this.sampleBuffer.splice(0, this.sampleBuffer.length - MAX_BUFFER_SAMPLES);
        }

        while (this.sampleBuffer.length >= this.maxBufferSize) {
            if (this.io) {
                this.io.emit('reference_audio_stream', {
                    samples: this.sampleBuffer.slice(0, this.maxBufferSize)
                });
            }
            this.sampleBuffer.splice(0, this.maxBufferSize);
        }
    }
}

module.exports = new LoopbackService();
