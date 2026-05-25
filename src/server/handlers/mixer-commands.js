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
            if (validated.mute) {
                mixer.master.mute();
                mixerSingleton.updateMasterState({ mute: 1 });
            } else {
                mixer.master.unmute();
                mixerSingleton.updateMasterState({ mute: 0 });
            }
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
            mixer.input(validated.channel).setFaderLevel(validated.level);
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
            const input = mixer.input(validated.channel);
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
}

module.exports = { registerMixerCommandHandlers };