/**
 * SoundMaster — RT60 Measurement Handler
 * =======================================
 * Handler Socket.IO que orquestra o fluxo de medição RT60 integrado à mesa.
 *
 * Eventos recebidos:
 *   'rt60_get_corrections'  → { metrics, roomProfile } → devolve plano de correções
 *   'rt60_apply_correction' → { actionId, channels }  → aplica uma ação na mesa
 *   'rt60_apply_all'        → { plan }                → aplica todas as ações confirmadas
 *   'rt60_save_measurement' → { metrics, roomName }   → salva no histórico
 *
 * Eventos emitidos:
 *   'rt60_corrections_ready' → { plan }
 *   'rt60_correction_applied'→ { actionId, success, changes }
 *   'rt60_error'             → { message }
 */

'use strict';

const { generateCorrections } = require('../acoustic-corrections');
const REQUIRE_ASSISTANT_CONFIRMATION = true;

function registerRt60MeasurementHandlers(io, socket, deps) {
    const { logger, mixerSingleton, actions, db } = deps;

    // ── Gera plano de correções ───────────────────────────────────────────────

    socket.on('rt60_get_corrections', (data) => {
        try {
            const { metrics, roomProfile } = data || {};

            if (!metrics || !metrics.rt60) {
                socket.emit('rt60_error', { message: 'Métricas RT60 inválidas ou ausentes.' });
                return;
            }

            const mixerState = mixerSingleton.getStateTree();
            const plan = generateCorrections(metrics, mixerState, roomProfile || {});

            logger.info(socket.id, 'RT60_CORRECTIONS_GENERATED', {
                rt60: metrics.rt60,
                sti:  metrics.sti,
                actions: plan.actions.length,
                confidence: plan.confidence,
            });

            socket.emit('rt60_corrections_ready', { plan });

        } catch (err) {
            logger.error(socket.id, 'RT60_CORRECTIONS_ERROR', { error: err.message });
            socket.emit('rt60_error', { message: `Erro ao gerar correções: ${err.message}` });
        }
    });

    // ── Aplica uma correção específica ────────────────────────────────────────

    socket.on('rt60_apply_correction', async (data) => {
        const { actionId, action, channels } = data || {};

        if (REQUIRE_ASSISTANT_CONFIRMATION) {
            logger.warn(socket.id, 'RT60_DIRECT_APPLY_BLOCKED', { actionId });
            socket.emit('rt60_error', { message: 'Correções RT60 devem ser revisadas e confirmadas na Central do Assistente.' });
            return;
        }

        if (!action) {
            socket.emit('rt60_error', { message: 'Ação inválida.' });
            return;
        }

        const mixer = mixerSingleton.getMixer();
        if (!mixer || mixer.isSimulated === false && !mixer.conn) {
            socket.emit('rt60_correction_applied', {
                actionId,
                success: false,
                message: 'Mesa não conectada. Correção não aplicada.',
            });
            return;
        }

        try {
            const applied = await _applyAction(action, channels, mixer, actions, logger, socket.id);

            logger.info(socket.id, 'RT60_CORRECTION_APPLIED', { actionId, applied });

            socket.emit('rt60_correction_applied', {
                actionId,
                success: true,
                applied,
                message: `Correção "${action.description}" aplicada com sucesso.`,
            });

        } catch (err) {
            logger.error(socket.id, 'RT60_APPLY_ERROR', { actionId, error: err.message });
            socket.emit('rt60_correction_applied', {
                actionId,
                success: false,
                message: `Erro ao aplicar: ${err.message}`,
            });
        }
    });

    // ── Aplica todas as ações do plano ────────────────────────────────────────

    socket.on('rt60_apply_all', async (data) => {
        const { plan, channels } = data || {};
        if (REQUIRE_ASSISTANT_CONFIRMATION) {
            logger.warn(socket.id, 'RT60_DIRECT_APPLY_ALL_BLOCKED', { count: plan?.actions?.length || 0 });
            socket.emit('rt60_error', { message: 'O plano RT60 deve ser convertido em ações pendentes e confirmado na Central do Assistente.' });
            return;
        }
        if (!plan || !plan.actions?.length) {
            socket.emit('rt60_error', { message: 'Plano inválido ou sem ações.' });
            return;
        }

        const mixer = mixerSingleton.getMixer();
        if (!mixer) {
            socket.emit('rt60_error', { message: 'Mesa não conectada.' });
            return;
        }

        const results = [];
        // Aplica em ordem de prioridade (menor número = maior prioridade)
        const sorted = [...plan.actions].sort((a, b) => a.priority - b.priority);

        for (const action of sorted) {
            try {
                const applied = await _applyAction(action, channels, mixer, actions, logger, socket.id);
                results.push({ actionId: action.id, success: true, applied });
                // Delay entre ações para não sobrecarregar o OSC da mesa
                await _sleep(80);
            } catch (err) {
                results.push({ actionId: action.id, success: false, error: err.message });
            }
        }

        logger.info(socket.id, 'RT60_ALL_APPLIED', {
            total: sorted.length,
            success: results.filter(r => r.success).length,
        });

        socket.emit('rt60_all_applied', { results, plan });
    });

    // ── Salva medição no histórico ────────────────────────────────────────────

    socket.on('rt60_save_measurement', async (data) => {
        const { metrics, roomName, inputDevice, outputDevice, notes } = data || {};
        if (!metrics || !metrics.rt60) return;

        try {
            if (db && typeof db.run === 'function') {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT INTO acoustic_measurements
                         (room_name, rt60, t20, t30, edt, c50, c80, d50, sti,
                          input_device, output_device, notes, measured_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                        [
                            roomName || 'Medição RT60',
                            metrics.rt60, metrics.t20, metrics.t30, metrics.edt,
                            metrics.c50, metrics.c80, metrics.d50, metrics.sti,
                            inputDevice, outputDevice, notes || '',
                        ],
                        (err) => err ? reject(err) : resolve(),
                    );
                });
                socket.emit('rt60_saved', { success: true, roomName });
                logger.info(socket.id, 'RT60_MEASUREMENT_SAVED', { roomName, rt60: metrics.rt60 });
            }
        } catch (err) {
            logger.error(socket.id, 'RT60_SAVE_ERROR', { error: err.message });
            socket.emit('rt60_saved', { success: false, error: err.message });
        }
    });
}

// ─── Motor de Aplicação de Ações ─────────────────────────────────────────────

/**
 * Aplica uma ação de correção na mesa.
 *
 * @param {Object} action   - Ação do plano de correções
 * @param {number[]} channels - Canais alvo (para ações de canal)
 * @param {Object} mixer    - Instância do mixer
 * @param {Object} actions  - MixerActions (wrappers OSC)
 * @param {Object} logger
 * @param {string} socketId
 */
async function _applyAction(action, channels, mixer, actions, logger, socketId) {
    const applied = [];

    for (const change of (action.changes || [])) {
        switch (change.type) {
            case 'peaking':
            case 'shelf': {
                if (action.target === 'master') {
                    // EQ no master via OSC direto
                    _sendOsc(mixer, `SETD^m.eq.${_eqBandIndex(change.hz)}.gain^${change.gain}`);
                    _sendOsc(mixer, `SETD^m.eq.${_eqBandIndex(change.hz)}.freq^${change.hz}`);
                    applied.push({ target: 'master', change });
                }
                break;
            }

            case 'hpf': {
                // HPF nos canais de microfone
                const targetChannels = channels?.length ? channels : action.affectedChannels || [];
                for (const ch of targetChannels) {
                    const chIdx = ch - 1;
                    _sendOsc(mixer, `SETD^i.${chIdx}.hpf.enable^1`);
                    _sendOsc(mixer, `SETD^i.${chIdx}.hpf.freq^${change.hz}`);
                    await _sleep(30);
                    applied.push({ target: `ch${ch}`, change });
                }
                break;
            }

            case 'compressor': {
                if (action.target === 'master') {
                    _sendOsc(mixer, `SETD^m.comp.enable^1`);
                    _sendOsc(mixer, `SETD^m.comp.ratio^${change.ratio}`);
                    _sendOsc(mixer, `SETD^m.comp.threshold^${change.threshold}`);
                    applied.push({ target: 'master', change });
                }
                break;
            }

            case 'gate': {
                const targetChannels = channels?.length ? channels : action.affectedChannels || [];
                for (const ch of targetChannels) {
                    const chIdx = ch - 1;
                    _sendOsc(mixer, `SETD^i.${chIdx}.gate.enable^1`);
                    _sendOsc(mixer, `SETD^i.${chIdx}.gate.threshold^${change.threshold}`);
                    await _sleep(30);
                    applied.push({ target: `ch${ch}`, change });
                }
                break;
            }

            default:
                logger.warn(socketId, 'RT60_UNKNOWN_CHANGE_TYPE', { type: change.type });
        }
    }

    return applied;
}

/**
 * Mapeia frequência → índice de banda do GEQ de 31 bandas da Ui24R.
 * As bandas ISO são: 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200,
 * 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150,
 * 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
 */
function _eqBandIndex(hz) {
    const bands = [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,
                   630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,
                   8000,10000,12500,16000,20000];
    let closest = 0;
    let minDist  = Infinity;
    bands.forEach((f, i) => {
        const dist = Math.abs(f - hz);
        if (dist < minDist) { minDist = dist; closest = i; }
    });
    return closest;
}

function _sendOsc(mixer, message) {
    if (mixer?.conn?.sendMessage) {
        mixer.conn.sendMessage(message);
    }
}

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { registerRt60MeasurementHandlers };
