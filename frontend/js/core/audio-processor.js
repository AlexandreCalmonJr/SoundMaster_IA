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

        // Telemetria estéreo leve para o Assistente de Operação Sonora.
        // Um quadro a cada 4096 amostras (~85 ms em 48 kHz).
        this._meterFrameSize = 4096;
        this._meterCount = 0;
        this._meterSumSqL = 0;
        this._meterSumSqR = 0;
        this._meterPeakL = 0;
        this._meterPeakR = 0;

        // Zero GC: buffers de trabalho pré-alocados no constructor
        this._monoBuffer = new Float32Array(128);  // max block size para mixdown estéreo
        this._accSendBuffer = new Float32Array(this._accBufferSize);  // buffer para envio raw-data
        this._windowedBuffer = new Float32Array(this._bufferSize);  // buffer para análise janelada
    }

    _flushMeterFrame() {
        const count = Math.max(1, this._meterCount);
        this.port.postMessage({
            type: 'meter-frame',
            peakL: this._meterPeakL,
            peakR: this._meterPeakR,
            rmsL: Math.sqrt(this._meterSumSqL / count),
            rmsR: Math.sqrt(this._meterSumSqR / count),
            sampleCount: count,
        });
        this._meterCount = 0;
        this._meterSumSqL = 0;
        this._meterSumSqR = 0;
        this._meterPeakL = 0;
        this._meterPeakR = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input && input.length > 0) {
            const ch0 = input[0];
            const ch1 = input[1]; // 2nd channel (stereo USB class-compliant)

            // Mix down stereo to mono para as análises existentes e preserve
            // métricas independentes de L/R para não esconder clipping em um lado.
            const mono = ch1 ? this._monoBuffer : ch0;
            const monoLen = ch0.length;
            for (let i = 0; i < monoLen; i++) {
                const left = ch0[i] || 0;
                const right = ch1 ? (ch1[i] || 0) : left;
                if (ch1) this._monoBuffer[i] = (left + right) / 2;

                this._meterSumSqL += left * left;
                this._meterSumSqR += right * right;
                this._meterPeakL = Math.max(this._meterPeakL, Math.abs(left));
                this._meterPeakR = Math.max(this._meterPeakR, Math.abs(right));
                this._meterCount++;
                if (this._meterCount >= this._meterFrameSize) this._flushMeterFrame();
            }

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
