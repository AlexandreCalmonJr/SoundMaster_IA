const { z } = require('zod');

const schemas = {
    masterLevel: z.object({
        level: z.union([z.number(), z.string()]).transform(v => Number(v)).pipe(z.number().min(0).max(1))
    }),
    eqCut: z.object({
        target: z.enum(['master', 'channel']),
        channel: z.number().min(1).max(24).optional(),
        hz: z.number().min(20).max(20000),
        gain: z.number().min(-24).max(12).optional(),
        q: z.number().min(0.1).max(10).optional(),
        band: z.number().min(1).max(4).optional()
    }),
    aiCommand: z.object({
        action: z.string(),
        desc: z.string().optional(),
        target: z.string().optional(),
        channel: z.number().optional(),
        ch: z.number().optional(),
        hz: z.number().optional(),
        gain: z.number().optional(),
        q: z.number().optional(),
        band: z.number().optional(),
        ms: z.number().optional(),
        aux: z.number().optional(),
        fx: z.number().optional(),
        level: z.number().optional(),
        val: z.number().optional(),
        enabled: z.union([z.boolean(), z.number()]).optional(),
        profile: z.string().optional(),
        name: z.string().optional()
    }).passthrough(),
    channelBasic: z.object({
        channel: z.number().min(1).max(24)
    }),
    channelHpf: z.object({
        channel: z.number().min(1).max(24),
        hz: z.number().min(20).max(1000)
    }),
    channelGate: z.object({
        channel: z.number().min(1).max(24),
        enabled: z.union([z.boolean(), z.number()]).transform(v => !!v),
        threshold: z.number().min(-80).max(0).optional()
    }),
    channelComp: z.object({
        channel: z.number().min(1).max(24),
        ratio: z.number().min(1).max(20).optional(),
        threshold: z.number().min(-60).max(0).optional()
    }),
    boolEnabled: z.object({
        enabled: z.union([z.boolean(), z.number()]).transform(v => !!v)
    }),
    oscillator: z.object({
        enabled: z.union([z.boolean(), z.number()]).transform(v => !!v),
        type: z.number().min(0).max(2).optional(),
        level: z.number().min(-100).max(0).optional()
    }),
    auxFx: z.object({
        channel: z.number().min(1).max(24),
        aux: z.number().min(1).max(10).optional(),
        fx: z.number().min(1).max(4).optional(),
        level: z.number().min(0).max(1)
    }),
    delay: z.object({
        target: z.enum(['master', 'aux', 'channel', 'input']),
        id: z.number().min(1).max(24).optional(),
        ms: z.number().min(0).max(500)
    }),
    feedbackCut: z.object({
        hz: z.number().min(20).max(20000)
    }),
    phantom: z.object({
        input: z.number().min(1).max(24),
        enabled: z.union([z.boolean(), z.number()]).transform(v => !!v)
    }),
    channelName: z.object({
        channel: z.number().min(1).max(24),
        name: z.string().max(20)
    }),
    masterMute: z.object({
        mute: z.union([z.boolean(), z.number()]).transform(v => !!v)
    }),
    channelLevel: z.object({
        channel: z.number().min(1).max(24),
        level: z.union([z.number(), z.string()]).transform(v => Number(v)).pipe(z.number().min(0).max(1))
    }),
    channelMute: z.object({
        channel: z.number().min(1).max(24),
        mute: z.union([z.boolean(), z.number()]).transform(v => !!v)
    })
};

function registerMixerCommandHandlers(io, socket, deps) {
    const { actions, logger, mixerSingleton, throttledSetMaster, rateLimiter, addToHistory, feedbackCooldowns, automaticCutState, canApplyAutomaticCut } = deps;

    socket.on('set_master_level', (data) => {
        if (!rateLimiter(socket, 'set_master_level')) return;
        if (!mixerSingleton.getMixer()) {
            socket.emit('mixer_status', { connected: false, msg: 'Conecte-se a mesa primeiro!' });
            return;
        }
        try {
            const validated = schemas.masterLevel.parse(data);
            throttledSetMaster(validated.level);
            logger.info(socket.id, 'SET_MASTER_LEVEL', { level: validated.level });
            socket.emit('mixer_status', { connected: true, msg: `Master ajustado para ${Math.round(validated.level * 100)}%` });
        } catch (error) {
            logger.error(socket.id, 'SET_MASTER_LEVEL_VALIDATION_ERROR', { error: error.message });
            socket.emit('mixer_status', { connected: true, msg: `Dados inválidos: ${error.message}` });
        }
    });

    socket.on('cut_feedback', (data) => {
        if (!rateLimiter(socket, 'cut_feedback')) return;
        try {
            const { hz } = schemas.feedbackCut.parse(data);
            const now = Date.now();
            const lastCut = feedbackCooldowns.get(Math.round(hz)) || 0;
            if (now - lastCut < 5000) {
                logger.info(socket.id, 'FEEDBACK_CUT_COOLDOWN', { hz });
                return;
            }
            feedbackCooldowns.set(Math.round(hz), now);
            const result = actions.cutFeedback(hz);
            io.emit('mixer_log', `[AUTO] ${result}`);
        } catch (err) {
            logger.error(socket.id, 'FEEDBACK_CUT_ERROR', err.message);
        }
    });

    socket.on('execute_ai_command', (cmd) => {
        if (!rateLimiter(socket, 'execute_ai_command')) return;
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.aiCommand.parse(cmd);
            const result = actions.executeMixerCommand(validated);
            addToHistory({ type: 'ai_command', data: validated });
            logger.info(socket.id, 'AI_COMMAND_EXECUTED', { action: validated.action, result });
            socket.emit('feedback_cut_success', { hz: validated.hz || 0, msg: `${validated.desc || 'Comando IA'}: ${result}` });
        } catch (error) {
            logger.error(socket.id, 'AI_COMMAND_ERROR', { error: error.message });
            socket.emit('mixer_status', { connected: true, msg: `Erro IA: ${error.message}` });
        }
    });

    socket.on('apply_channel_hpf', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.channelHpf.parse(data);
            socket.emit('feedback_cut_success', { msg: actions.applyChannelHpf(validated.channel, validated.hz) });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('apply_channel_gate', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.channelGate.parse(data);
            socket.emit('feedback_cut_success', { msg: actions.applyChannelGate(validated.channel, validated.enabled, validated.threshold) });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('apply_channel_compressor', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.channelComp.parse(data);
            socket.emit('feedback_cut_success', { msg: actions.applyChannelCompressor(validated.channel, validated.ratio, validated.threshold) });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('apply_eq_cut', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.eqCut.parse(data);
            socket.emit('feedback_cut_success', { msg: actions.applyEqCut(validated.target, validated.channel, validated.hz, validated.gain, validated.q, validated.band) });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('apply_eq_batch', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const { target, channel, bands } = data;
            if (!bands || !Array.isArray(bands) || bands.length === 0) {
                socket.emit('mixer_status', { connected: true, msg: 'Nenhum filtro para aplicar.' });
                return;
            }
            const ch = target === 'channel' ? (channel || 1) : null;
            const result = actions.batchApplyEq(target, ch, bands);
            if (addToHistory) addToHistory({ type: 'eq_batch', target, channel: ch, snapshot: result.snapshot });
            socket.emit('feedback_cut_success', { msg: result.msg, canUndo: true });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('undo_eq_correction', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const entries = globalHistoryStack || [];
            const idx = entries.map((e, i) => ({ e, i })).filter(x => x.e.type === 'eq_batch').pop();
            if (!idx) {
                socket.emit('mixer_status', { connected: true, msg: 'Nada para desfazer.' });
                return;
            }
            const entry = idx.e;
            actions.restoreEqSnapshot(entry.target, entry.channel, entry.snapshot);
            globalHistoryStack.splice(idx.i, 1);
            socket.emit('feedback_cut_success', { msg: 'EQ restaurado (undo).' });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: `Erro undo: ${error.message}` });
        }
    });

    socket.on('set_phantom_power', (data) => {
        if (!rateLimiter(socket, 'set_phantom_power')) return;
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.phantom.parse(data);
            const msg = actions.setPhantom(validated.input, validated.enabled);
            logger.warn(socket.id, 'PHANTOM_POWER_CHANGE', { input: validated.input, enabled: validated.enabled });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: `Erro Phantom: ${error.message}` });
        }
    });

    socket.on('set_channel_name', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.channelName.parse(data);
            const msg = actions.setChannelName(validated.channel, validated.name);
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_afs_enabled', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.boolEnabled.parse(data);
            socket.emit('feedback_cut_success', { msg: actions.setAfs(validated.enabled) });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: `Erro AFS: ${error.message}` });
        }
    });

    socket.on('set_oscillator', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.oscillator.parse(data);
            socket.emit('feedback_cut_success', { msg: actions.applyOscillator(validated.enabled, validated.type, validated.level) });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: `Erro oscilador: ${error.message}` });
        }
    });

    socket.on('set_aux_level', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.auxFx.parse(data);
            const msg = actions.setAuxLevel(validated.channel, validated.aux, validated.level);
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_fx_level', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.auxFx.parse(data);
            const msg = actions.setFxLevel(validated.channel, validated.fx, validated.level);
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_delay', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.delay.parse(data);
            const msg = actions.setDelay(validated.target, validated.id, validated.ms);
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_master_mute', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.masterMute.parse(data);
            const mixer = mixerSingleton.getMixer();
            // master.mute()/unmute() nao existem em soundcraft-ui-connection v6 (MasterBus nao implementa mute). Enviar OSC cru.
            mixer.conn.sendMessage(`SETD^m.mute^${validated.mute ? 1 : 0}`);
            mixerSingleton.updateMasterState({ mute: validated.mute ? 1 : 0 });
            logger.info(socket.id, 'SET_MASTER_MUTE', { mute: validated.mute });
        } catch (error) {
            logger.error(socket.id, 'SET_MASTER_MUTE_ERROR', { error: error.message });
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_channel_level', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.channelLevel.parse(data);
            const mixer = mixerSingleton.getMixer();
            mixer.master.input(validated.channel).setFaderLevel(validated.level);
            mixerSingleton.updateChannelState(validated.channel, { level: validated.level });
            logger.info(socket.id, 'SET_CHANNEL_LEVEL', { channel: validated.channel, level: validated.level });
        } catch (error) {
            logger.error(socket.id, 'SET_CHANNEL_LEVEL_ERROR', { error: error.message });
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_channel_mute', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const validated = schemas.channelMute.parse(data);
            const mixer = mixerSingleton.getMixer();
            const input = mixer.master.input(validated.channel);
            if (validated.mute) {
                input.mute();
                mixerSingleton.updateChannelState(validated.channel, { mute: 1 });
            } else {
                input.unmute();
                mixerSingleton.updateChannelState(validated.channel, { mute: 0 });
            }
            logger.info(socket.id, 'SET_CHANNEL_MUTE', { channel: validated.channel, mute: validated.mute });
        } catch (error) {
            logger.error(socket.id, 'SET_CHANNEL_MUTE_ERROR', { error: error.message });
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_aux_delay', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const aux = Number(data.aux);
            const ms = Number(data.ms);
            const msg = actions.setDelay('aux', aux, ms);
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('apply_parametric_eq', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const channel = Number(data.channel);
            const hz = Number(data.freq);
            const gain = Number(data.gain);
            const q = Number(data.q);
            const msg = actions.applyEqCut('channel', channel, hz, gain, q, 2);
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('apply_notch_filter', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const channel = Number(data.channel);
            const hz = Number(data.freq);
            const gain = Number(data.gain);
            const q = Number(data.q);
            const msg = actions.applyEqCut('channel', channel, hz, gain, q, 4);
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('run_clean_sound_preset', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const channel = Number(data.channel) || 1;
            const steps = [
                actions.applyChannelHpf(channel, data.hpf || 100),
                actions.applyChannelGate(channel, 1, data.gateThreshold || -52),
                actions.applyChannelCompressor(channel, data.ratio || 2.5, data.compThreshold || -18),
                actions.applyEqCut('channel', channel, data.mudHz || 250, data.mudGain || -3, 1.2, 2),
                actions.applyEqCut('channel', channel, data.harshHz || 3200, data.harshGain || -2, 1.5, 3)
            ];
            addToHistory({ type: 'clean_preset', data });
            socket.emit('feedback_cut_success', { msg: `Preset de som limpo aplicado no canal ${channel}: ${steps.join(' ')}` });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('automix_cmd', (data) => {
        const action_type = data?.action_type;
        try {
            if (!actions.ensureMixer(socket)) return;
            const result = actions.executeMixerCommand({ action: 'automix_cmd', action_type, val: data?.val });
            socket.emit('mixer_log', result);
        } catch (err) {
            socket.emit('mixer_status', { connected: true, msg: err.message });
        }
    });

    socket.on('automix_assign', (data) => {
        if (!actions.ensureMixer(socket)) return;
        const channel = Number(data?.channel) || 1;
        const group = data?.group || 'none';
        const weight = Number(data?.weight) || 0.5;
        const msg = actions.automixAssignChannel(channel, group, weight);
        socket.emit('mixer_log', msg);
    });

    socket.on('set_master_dim', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const enabled = data?.enabled !== false && data?.val !== 0;
            const msg = actions.executeMixerCommand({ action: 'set_master_dim', enabled });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('fade_master_db', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const levelDb = Number(data?.levelDb || data?.val || 0);
            const time = Number(data?.time || 2000);
            const msg = actions.executeMixerCommand({ action: 'fade_master_db', levelDb, time });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('fade_channel_db', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const target = data?.target || 'channel';
            const chType = data?.channelType || data?.type || 'input';
            const ch = Number(data?.channel || data?.ch || 1);
            const levelDb = Number(data?.levelDb || data?.val || 0);
            const time = Number(data?.time || 2000);
            const msg = actions.executeMixerCommand({ action: 'fade_channel_db', target, channelType: chType, channel: ch, levelDb, time });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_aux_post', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const ch = Number(data?.channel || data?.ch || 1);
            const aux = Number(data?.aux || 1);
            const enabled = data?.enabled !== false && data?.val !== 0;
            const msg = actions.executeMixerCommand({ action: 'set_aux_post', channel: ch, aux, enabled });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_aux_pan', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const ch = Number(data?.channel || data?.ch || 1);
            const aux = Number(data?.aux || 1);
            const val = Number(data?.val || 0.5);
            const msg = actions.executeMixerCommand({ action: 'set_aux_pan', channel: ch, aux, val });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_fx_bpm', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const fx = Number(data?.fx || 1);
            const val = Number(data?.val || 120);
            const msg = actions.executeMixerCommand({ action: 'set_fx_bpm', fx, val });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_fx_param', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const fx = Number(data?.fx || 1);
            const param = Number(data?.param || 1);
            const val = Number(data?.val || 0.5);
            const msg = actions.executeMixerCommand({ action: 'set_fx_param', fx, param, val });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_channel_pan', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const target = data?.target || 'channel';
            const chType = data?.channelType || data?.type || 'input';
            const ch = Number(data?.channel || data?.ch || 1);
            const val = Number(data?.val || 0.5);
            const msg = actions.executeMixerCommand({ action: 'set_channel_pan', target, channelType: chType, channel: ch, val });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('set_monitor_volume', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const target = data?.target || 'hp1';
            const val = Number(data?.val || 0.5);
            const msg = actions.executeMixerCommand({ action: 'set_monitor_volume', target, val });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('player_cmd', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const action_type = data?.action_type || data?.action;
            const val = data?.val;
            const msg = actions.executeMixerCommand({ action: 'player_cmd', action_type, val });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('recorder_cmd', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const action_type = data?.action_type || data?.action;
            const msg = actions.executeMixerCommand({ action: 'recorder_cmd', action_type });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('mtk_cmd', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const action_type = data?.action_type || data?.action;
            const val = data?.val !== undefined ? data?.val : data?.value;
            const msg = actions.executeMixerCommand({ action: 'mtk_cmd', action_type, val });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('show_cmd', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const action_type = data?.action_type || data?.action;
            const show = data?.show;
            const target = data?.target;
            const msg = actions.executeMixerCommand({ action: 'show_cmd', action_type, show, target });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });

    socket.on('mute_group_cmd', (data) => {
        if (!actions.ensureMixer(socket)) return;
        try {
            const id = data?.id || 'all';
            const action_type = data?.action_type || data?.action;
            const enabled = data?.enabled !== false && data?.val !== 0;
            const msg = actions.executeMixerCommand({ action: 'mute_group_cmd', id, action_type, enabled });
            socket.emit('feedback_cut_success', { msg });
        } catch (error) {
            socket.emit('mixer_status', { connected: true, msg: error.message });
        }
    });
}

module.exports = { registerMixerCommandHandlers };