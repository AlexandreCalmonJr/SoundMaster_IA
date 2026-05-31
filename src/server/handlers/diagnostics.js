const path = require('path');
const { spawn } = require('child_process');
const { getPythonCommand } = require('../python-ai');

const PYTHON_PORT = parseInt(process.env.PYTHON_PORT || '3002', 10);
const AI_API_KEY = process.env.AI_API_KEY;

function registerDiagnosticHandlers(io, socket, deps) {
    const { actions, logger, mixerSingleton, historyService, aiPredictor, feedbackCooldowns, automaticCutState, canApplyAutomaticCut } = deps;

    socket.on('save_acoustic_snapshot', async (data) => {
        try {
            const doc = await historyService.saveSnapshot(data);
            io.emit('snapshot_saved', doc);
        } catch (e) {
            logger.error(socket.id, 'SNAPSHOT_SAVE_ERROR', { error: e.message });
        }
    });

    socket.on('save_heatmap_snapshot', async (data) => {
        try {
            const payload = Object.assign({ type: 'heatmap' }, data.snapshot || {}, data);
            const doc = data._id
                ? await historyService.updateSnapshot(data._id, payload)
                : await historyService.saveSnapshot(payload);
            io.emit('heatmap_updated', doc);
        } catch (e) {
            logger.error(socket.id, 'HEATMAP_SAVE_ERROR', { error: e.message });
        }
    });

    socket.on('get_acoustic_history', async () => {
        try {
            const docs = await historyService.getComparison();
            const benchmark = await historyService.getBenchmark();
            socket.emit('acoustic_history_data', { history: docs, benchmark });
        } catch (e) {
            logger.error(socket.id, 'HISTORY_FETCH_ERROR', { error: e.message });
        }
    });

    socket.on('analyze_feedback_risk', async (data) => {
        try {
            const risk = await aiPredictor.predictRisk(data.hz, data.db, data.prevDb, data.gain || 0);
            socket.emit('feedback_risk_result', { hz: data.hz, risk });
            if (risk > 0.9) {
                const gate = canApplyAutomaticCut(data.hz);
                if (!gate.allowed) {
                    logger.info(socket.id, 'AUTO_CUT_SKIPPED', { hz: data.hz, reason: gate.reason });
                    return;
                }
                feedbackCooldowns.set(gate.roundedHz, Date.now());
                automaticCutState.set(gate.roundedHz, { timestamp: Date.now() });
                const msg = actions.applyEqCut('master', null, data.hz, -3, 10, 4);
                socket.emit('feedback_cut_success', { hz: data.hz, msg: `[IA Preditiva] Corte preventivo de -3dB: ${msg}` });
            }
        } catch (e) {
            logger.error(socket.id, 'AI_PREDICTION_ERROR', { error: e.message });
        }
    });

    function _writeWav(filePath, samples, sampleRate) {
        const { writeFileSync } = require('fs');
        const int16Data = new Int16Array(samples.map(v => Math.max(-32768, Math.min(32767, Math.round(v * 32768)))));
        const header = Buffer.alloc(44);
        const dv = new DataView(header.buffer);
        dv.setUint32(0,  0x52494646, false); // 'RIFF' (Big Endian)
        dv.setUint32(4,  36 + int16Data.byteLength, true);
        dv.setUint32(8,  0x57415645, false); // 'WAVE' (Big Endian)
        dv.setUint32(12, 0x666D7420, false); // 'fmt ' (Big Endian)
        dv.setUint32(16, 16,         true);
        dv.setUint16(20, 1,          true);
        dv.setUint16(22, 1,          true);
        dv.setUint32(24, sampleRate, true);
        dv.setUint32(28, sampleRate * 2, true);
        dv.setUint16(32, 2,          true);
        dv.setUint16(34, 16,         true);
        dv.setUint32(36, 0x64617461, false); // 'data' (Big Endian)
        dv.setUint32(40, int16Data.byteLength, true);
        writeFileSync(filePath, Buffer.concat([header, Buffer.from(int16Data.buffer)]));
    }

    socket.on('analyze_sweep_ir', async (data) => {
        const { recording, reference, sweepParams } = data;

        if (!recording || !Array.isArray(recording) || recording.length < 4800) {
            socket.emit('sweep_analysis_result', { error: 'Recording too short or missing.' });
            return;
        }

        const { mkdirSync } = require('fs');
        const tmpDir = path.join(__dirname, '..', '..', '..', 'data', 'tmp');
        try { mkdirSync(tmpDir, { recursive: true }); } catch (_) { console.warn('[Diagnostics] Falha ao criar diretório temporário:', _.message); }
        const ts = Date.now();
        const recWav = path.join(tmpDir, `sweep_rec_${ts}.wav`);
        const refWav = path.join(tmpDir, `sweep_ref_${ts}.wav`);

        const sampleRate = (sweepParams?.sampleRate && Number.isFinite(sweepParams.sampleRate))
            ? sweepParams.sampleRate
            : 44100;

        try {
            _writeWav(recWav, recording, sampleRate);
            if (reference && Array.isArray(reference) && reference.length > 0) {
                _writeWav(refWav, reference, sampleRate);
            }

            const analyzerPy = path.join(__dirname, '..', '..', '..', 'backend', 'ai', 'acoustics', 'sweep_analyzer.py');
            const pyArgs = [analyzerPy, recWav];
            if (require('fs').existsSync(refWav)) {
                pyArgs.push('--reference', refWav);
            }
            if (sweepParams) {
                pyArgs.push('--sweep-params', JSON.stringify(sweepParams));
            }

            logger.info(socket.id, 'SWEEP_ANALYSIS_START', { recLen: recording.length, refLen: reference?.length || 0, cmd: getPythonCommand(), args: pyArgs });

            const result = await new Promise((resolve, reject) => {
                const py = spawn(getPythonCommand(), pyArgs, {
                    cwd:   path.dirname(analyzerPy),
                });

                let stdout = '';
                let stderr = '';

                py.stdout.on('data', (d) => { stdout += d.toString(); });
                py.stderr.on('data', (d) => { stderr += d.toString(); });

                py.on('close', (code) => {
                    logger.info(socket.id, 'SWEEP_ANALYSIS_PY_CLOSE', { code, stdoutLen: stdout.length, stderrLen: stderr.length });
                    if (stderr) {
                        logger.warn(socket.id, 'SWEEP_ANALYSIS_PY_STDERR', { stderr: stderr.trim() });
                    }
                    try { require('fs').unlinkSync(recWav); } catch (_) {}
                    try { require('fs').unlinkSync(refWav); } catch (_) {}
                    if (code !== 0) {
                        reject(new Error(stderr || `Python exited with code ${code}`));
                    } else {
                        try {
                            const result = JSON.parse(stdout);
                            if (result && result.error) {
                                logger.error(socket.id, 'SWEEP_ANALYSIS_PY_ERROR_JSON', { error: result.error, stdout });
                            }
                            resolve(result);
                        } catch (e) {
                            logger.error(socket.id, 'SWEEP_ANALYSIS_JSON_PARSE_ERROR', { error: e.message, stdout });
                            reject(new Error(`JSON parse error: ${stdout}`));
                        }
                    }
                });
            });

            socket.emit('sweep_analysis_result', result);

        } catch (error) {
            logger.error(socket.id, 'SWEEP_ANALYSIS_ERROR', { error: error.message });
            socket.emit('sweep_analysis_result', { error: error.message });
        }
    });

    socket.on('get_hardware_diagnosis', async (data = {}) => {
        const channel = data.channel || 'Canal 1';
        const months  = Math.max(1, Math.min(24, Number(data.months) || 6));

        if (!historyService.db) {
            logger.error(socket.id, 'HARDWARE_DIAGNOSIS_ERROR', { channel, error: 'historyService.db não inicializado' });
            socket.emit('hardware_diagnosis_result', {
                channel, code: 'ERRO', severity: 'ok', confidence: 0,
                summary: 'Banco de dados de histórico não está disponível.',
                recommendations: ['Verificar inicialização do banco de dados.'],
                bands: [], stats: { n_snapshots: 0 }
            });
            return;
        }

        try {
            const safeChannel = String(channel || 'Canal 1').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const docs = await new Promise((resolve, reject) => {
                historyService.db.find(
                    { name: { $regex: new RegExp(safeChannel, 'i') } }
                )
                .sort({ timestamp: 1 })
                .exec((err, d) => err ? reject(err) : resolve(d || []));
            });

            if (docs.length === 0) {
                socket.emit('hardware_diagnosis_result', {
                    channel,
                    code: 'DADOS_INSUFICIENTES',
                    severity: 'ok',
                    confidence: 0,
                    summary: `Sem snapshots para o canal "${channel}" na base de dados.`,
                    recommendations: ['Salvar medições acústicas regularmente com o nome do canal.'],
                    bands: [],
                    stats: { n_snapshots: 0 },
                });
                return;
            }

            const hdrs = { 'Content-Type': 'application/json' };
            if (AI_API_KEY) {
                hdrs['X-API-Key'] = AI_API_KEY;
                logger.info(socket.id, 'AI_API_KEY_SENT', { sent: true });
            }
            const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/hardware_diagnosis`, {
                method:  'POST',
                headers: hdrs,
                body:    JSON.stringify({ channel, snapshots: docs, months }),
            });

            if (!aiRes.ok) throw new Error(`Python engine: ${aiRes.status}`);
            const result = await aiRes.json();

            logger.info(socket.id, 'HARDWARE_DIAGNOSIS', { channel, code: result.code, severity: result.severity });
            socket.emit('hardware_diagnosis_result', result);

        } catch (err) {
            logger.error(socket.id, 'HARDWARE_DIAGNOSIS_ERROR', { channel, error: err.message });
            socket.emit('hardware_diagnosis_result', {
                channel,
                code: 'ERRO',
                severity: 'ok',
                confidence: 0,
                summary: `Erro ao analisar: ${err.message}`,
                recommendations: ['Verificar se o servidor Python (porta 3002) está online.'],
                bands: [],
                stats: { n_snapshots: 0 },
            });
        }
    });
}

module.exports = { registerDiagnosticHandlers };