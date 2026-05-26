/**
 * SoundMaster — Worker Thread Pool (Tópico 29)
 * =============================================
 * Isola processamento pesado da Main Thread para proteger
 * o Keep-Alive da Ui24R e o Event Loop de Socket.IO.
 *
 * Tarefas delegadas para workers:
 *   - AES67 multi-channel audio processing
 *   - HTTP calls para o servidor Python (AI / RT60)
 *   - Operações de I/O de disco (NeDB snapshots pesados)
 *
 * A Main Thread permanece exclusivamente para:
 *   - Socket.IO (clientes browser)
 *   - WebSocket Ui24R (soundcraft-ui-connection)
 *   - Rate limiting e despacho de State Tree
 */

'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');

// ─── Worker Task Types ────────────────────────────────────────────────────────

const TASK = {
    AES67_PROCESS:  'aes67_process',
    PYTHON_HTTP:    'python_http',
    DISK_IO:        'disk_io',
    SWEEP_DECONV:   'sweep_deconv',
};

// ─── Pool de Workers ──────────────────────────────────────────────────────────

class WorkerPool {
    constructor(size = 2) {
        this._size    = size;
        this._workers = [];
        this._queue   = [];
        this._pending = new Map();  // taskId → { resolve, reject, timeout }
        this._nextId  = 1;
        this._init();
    }

    _init() {
        for (let i = 0; i < this._size; i++) {
            this._spawnWorker(i);
        }
    }

    _spawnWorker(index) {
        const worker = new Worker(__filename, {
            workerData: { workerIndex: index },
            // Limita memória do worker a 256MB
            resourceLimits: { maxOldGenerationSizeMb: 256 }
        });

        worker._busy = false;
        worker._index = index;

        worker.on('message', (msg) => {
            worker._busy = false;
            const pending = this._pending.get(msg.taskId);
            if (pending) {
                clearTimeout(pending.timeout);
                this._pending.delete(msg.taskId);
                if (msg.error) pending.reject(new Error(msg.error));
                else           pending.resolve(msg.result);
            }
            // Processa próximo da fila
            this._drain(worker);
        });

        worker.on('error', (err) => {
            console.error(`[WorkerPool] Worker ${index} erro:`, err.message);
            worker._busy = false;
            this._rejectPending(`Worker ${index} error: ${err.message}`);
            // Re-spawna worker morto
            setTimeout(() => this._spawnWorker(index), 1000);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.warn(`[WorkerPool] Worker ${index} saiu com código ${code}. Re-spawning...`);
                this._rejectPending(`Worker ${index} saiu com código ${code}`);
                setTimeout(() => this._spawnWorker(index), 500);
            }
        });

        this._workers[index] = worker;
        this._drain(worker);
    }

    _rejectPending(reason) {
        for (const [taskId, pending] of this._pending) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(`[WorkerPool] ${reason}`));
        }
        this._pending.clear();
    }

    _drain(worker) {
        if (worker._busy || this._queue.length === 0) return;
        const { task, taskId } = this._queue.shift();
        worker._busy = true;
        worker.postMessage({ task, taskId });
    }

    /**
     * Executa uma tarefa em background.
     * @param {string} type  — TASK.*
     * @param {object} data  — payload da tarefa
     * @param {number} timeoutMs — timeout (default 30s)
     * @returns {Promise}
     */
    run(type, data, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            const taskId = this._nextId++;
            const task   = { type, data };

            const timeoutHandle = setTimeout(() => {
                this._pending.delete(taskId);
                reject(new Error(`[WorkerPool] Task ${type} timeout após ${timeoutMs}ms`));
            }, timeoutMs);

            this._pending.set(taskId, { resolve, reject, timeout: timeoutHandle });

            // Encontra worker livre
            const free = this._workers.find(w => w && !w._busy);
            if (free) {
                free._busy = true;
                free.postMessage({ task, taskId });
            } else {
                // Encaminha para a fila
                this._queue.push({ task, taskId });
            }
        });
    }

    shutdown() {
        this._workers.forEach(w => w?.terminate());
    }
}

// ─── Lógica do Worker (roda numa thread separada) ─────────────────────────────

if (!isMainThread) {
    // ✅ T15: Usa fetch nativo do Node.js 18+ (P23)
    const fetch = globalThis.fetch;

    parentPort.on('message', async ({ task, taskId }) => {
        let result, error;
        try {
            result = await _executeTask(task);
        } catch (err) {
            error = err.message;
        }
        parentPort.postMessage({ taskId, result, error });
    });

    async function _executeTask(task) {
        switch (task.type) {

            case TASK.PYTHON_HTTP: {
                // Chamada HTTP para o servidor Python (AI / RT60 / Predictive Maintenance)
                const { url, method = 'POST', body, headers = {}, timeoutMs = 25000 } = task.data;
                const ctrl = new AbortController();
                const tmo  = setTimeout(() => ctrl.abort(), timeoutMs);
                try {
                    const res = await fetch(url, {
                        method,
                        headers: { 'Content-Type': 'application/json', ...headers },
                        body:    body ? JSON.stringify(body) : undefined,
                        signal:  ctrl.signal,
                    });
                    clearTimeout(tmo);
                    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                    return await res.json();
                } finally {
                    clearTimeout(tmo);
                }
            }

            case TASK.AES67_PROCESS: {
                // Processamento de métricas AES67 (jitter, latência, estatísticas)
                const { samples, sampleRate } = task.data;
                // Cálculo de RMS e peak num Float32Array passado via SharedArrayBuffer
                const arr = new Float32Array(samples);
                let sumSq = 0, peak = 0;
                for (let i = 0; i < arr.length; i++) {
                    sumSq += arr[i] * arr[i];
                    if (Math.abs(arr[i]) > peak) peak = Math.abs(arr[i]);
                }
                const rms   = Math.sqrt(sumSq / arr.length);
                const rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));
                return { rms, rmsDb, peak, samples: arr.length, sampleRate };
            }

            case TASK.DISK_IO: {
                // Operações de disco pesadas (ler/escrever snapshots grandes)
                const fs = require('fs').promises;
                const { op, filePath, allowedDir, data: fileData } = task.data;
                // C4: Restringe operações de disco ao diretório permitido
                const resolved = path.resolve(filePath);
                if (!allowedDir || !resolved.startsWith(path.resolve(allowedDir) + path.sep)) {
                    throw new Error(`Acesso a disco negado: caminho fora do diretório permitido.`);
                }
                if (op === 'read')  return JSON.parse(await fs.readFile(resolved, 'utf8'));
                if (op === 'write') { await fs.writeFile(resolved, JSON.stringify(fileData, null, 2)); return { ok: true }; }
                throw new Error(`Operação desconhecida: ${op}`);
            }

            case TASK.SWEEP_DECONV: {
                // Deconvolução simples de sweep (placeholder para Python)
                // Em produção, envia para Python via TASK.PYTHON_HTTP
                const { recording, reference } = task.data;
                return { ok: true, samples: recording?.length, ref: reference?.length };
            }

            default:
                throw new Error(`Task desconhecida: ${task.type}`);
        }
    }
}

// ─── Singleton do pool (apenas na Main Thread) ────────────────────────────────

let _pool = null;

function getPool() {
    if (!isMainThread) return null;
    if (!_pool) {
        const cpus = Math.max(2, Math.min(4, require('os').cpus().length - 1));
        _pool = new WorkerPool(cpus);
        console.log(`[WorkerPool] Pool iniciado com ${cpus} worker(s).`);
    }
    return _pool;
}

module.exports = isMainThread
    ? { getPool, TASK, WorkerPool }
    : {};
