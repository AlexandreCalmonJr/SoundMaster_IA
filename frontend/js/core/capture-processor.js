// capture-processor.js
// Envia audio PCM de entrada para a thread principal sem usar ScriptProcessorNode.
// Zero GC: pool de buffers pré-alocados com triple-buffering e Transferable.

class CaptureProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._bufLen = 4096;
        // Zero GC: pool de 3 buffers para cycling com Transferable
        this._pool = [
            new Float32Array(this._bufLen),
            new Float32Array(this._bufLen),
            new Float32Array(this._bufLen)
        ];
        this._poolIdx = 0;
        this._idx = 0;
        this._active = true;

        this.port.onmessage = (event) => {
            if (event.data && event.data.type === 'set-active') {
                this._active = !!event.data.value;
            }
        };
    }

    process(inputs, outputs) {
        const output = outputs[0]?.[0];
        if (output) output.fill(0);

        const input = inputs[0]?.[0];
        if (!this._active || !input) return true;

        let buf = this._pool[this._poolIdx];
        const cap = this._bufLen;

        for (let i = 0; i < input.length; i++) {
            buf[this._idx++] = input[i];
            if (this._idx >= cap) {
                // Transfere o buffer cheio (zero-copy)
                this.port.postMessage({ type: 'pcm', samples: buf }, [buf.buffer]);
                // Avança no pool
                this._poolIdx = (this._poolIdx + 1) % this._pool.length;
                // Se o próximo buffer ainda está detached, re-cria
                const next = this._pool[this._poolIdx];
                if (next.byteLength === 0) {
                    this._pool[this._poolIdx] = new Float32Array(cap);
                }
                buf = this._pool[this._poolIdx];
                this._idx = 0;
            }
        }

        return true;
    }
}

registerProcessor('capture-processor', CaptureProcessor);
