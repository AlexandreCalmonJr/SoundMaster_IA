/**
 * SoundMaster Pro - AudioWorkletProcessor
 * Processamento de alta performance em thread dedicada.
 * Zero GC allocation no hot path — todos os buffers pré-alocados no constructor.
 */
class SoundMasterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._bufferSize = 32768; // FFT Size
        this._buffer = new Float32Array(this._bufferSize);
        this._writeIndex = 0;
        
        // Pré-calcula a Janela de Hann para performance
        this._hannWindow = new Float32Array(this._bufferSize);
        for (let i = 0; i < this._bufferSize; i++) {
            this._hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this._bufferSize - 1)));
        }

        // ✅ Correção Auditoria: Acumular amostras para reduzir o volume de postMessage (throttle nativo)
        this._accBufferSize = 4096;
        this._accBuffer = new Float32Array(this._accBufferSize);
        this._accIdx = 0;

        // Zero GC: buffers de trabalho pré-alocados no constructor
        this._monoBuffer = new Float32Array(128);  // max block size para mixdown estéreo
        this._accSendBuffer = new Float32Array(this._accBufferSize);  // buffer para envio raw-data
        this._windowedBuffer = new Float32Array(this._bufferSize);  // buffer para análise janelada
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const ch0 = input[0];
            const ch1 = input[1]; // 2nd channel (stereo USB class-compliant)

            // Mix down stereo to mono for measurement — sem alocação
            const mono = ch1 ? this._monoBuffer : ch0;
            if (ch1) {
                const len = ch0.length;
                for (let i = 0; i < len; i++) {
                    this._monoBuffer[i] = (ch0[i] + ch1[i]) / 2;
                }
            }

            const monoLen = ch1 ? this._monoBuffer.length : ch0.length;
            for (let i = 0; i < monoLen; i++) {
                this._accBuffer[this._accIdx++] = mono[i];
                if (this._accIdx >= this._accBufferSize) {
                    this._accSendBuffer.set(this._accBuffer);
                    this.port.postMessage({
                        type: 'raw-data',
                        buffer: this._accSendBuffer
                    });
                    this._accIdx = 0;
                }
            }

            for (let i = 0; i < monoLen; i++) {
                this._buffer[this._writeIndex] = mono[i];
                this._writeIndex++;

                if (this._writeIndex >= this._bufferSize) {
                    this._writeIndex = 0;

                    for (let j = 0; j < this._bufferSize; j++) {
                        this._windowedBuffer[j] = this._buffer[j] * this._hannWindow[j];
                    }

                    this.port.postMessage({
                        type: 'analysis-data',
                        buffer: this._windowedBuffer
                    });
                }
            }
        }
        return true;
    }
}

registerProcessor('soundmaster-processor', SoundMasterProcessor);
