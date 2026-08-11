const crypto = require('crypto');
const { z } = require('zod');

const PENDING_TTL_MS = 120000;
const COMPLETED_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING = 20;

const descField = z.string().trim().max(240).optional();
const targetField = z.enum(['master', 'channel', 'input']);

const commandSchema = z.union([
    z.object({
        action: z.literal('eq_cut'),
        desc: descField,
        target: z.enum(['master', 'channel']),
        channel: z.number().int().min(1).max(24).optional(),
        hz: z.number().min(20).max(20000),
        gain: z.number().min(-12).max(6),
        q: z.number().min(0.3).max(10),
        band: z.number().int().min(1).max(4).optional(),
    }).strict().superRefine((value, ctx) => {
        if (value.target === 'channel' && !value.channel) {
            ctx.addIssue({ code: 'custom', path: ['channel'], message: 'Canal obrigatório para EQ de canal.' });
        }
    }),
    z.object({
        action: z.literal('apply_channel_hpf'),
        desc: descField,
        channel: z.number().int().min(1).max(24),
        hz: z.number().min(20).max(400),
    }).strict(),
    z.object({
        action: z.literal('apply_channel_gate'),
        desc: descField,
        channel: z.number().int().min(1).max(24),
        enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]),
        threshold: z.number().min(-80).max(-5).optional(),
    }).strict(),
    z.object({
        action: z.literal('apply_channel_compressor'),
        desc: descField,
        channel: z.number().int().min(1).max(24),
        ratio: z.number().min(1).max(10).optional(),
        threshold: z.number().min(-60).max(-3).optional(),
    }).strict(),
    z.object({
        action: z.literal('set_master_level'),
        desc: descField,
        level: z.number().min(0).max(1),
    }).strict(),
    z.object({
        action: z.union([z.literal('set_channel_level'), z.literal('channel_fader')]),
        desc: descField,
        target: targetField.optional(),
        channel: z.number().int().min(1).max(24),
        level: z.number().min(0).max(1),
    }).strict(),
    z.object({
        action: z.literal('set_fader_level_db'),
        desc: descField,
        target: targetField,
        channel: z.number().int().min(1).max(24).optional(),
        levelDb: z.number().min(-100).max(10).optional(),
        val: z.number().min(-100).max(10).optional(),
    }).strict().superRefine((value, ctx) => {
        if (value.target !== 'master' && !value.channel) {
            ctx.addIssue({ code: 'custom', path: ['channel'], message: 'Canal obrigatório.' });
        }
        if (value.levelDb === undefined && value.val === undefined) {
            ctx.addIssue({ code: 'custom', path: ['levelDb'], message: 'Nível em dB obrigatório.' });
        }
    }),
    z.object({
        action: z.union([z.literal('volume_up'), z.literal('volume_down')]),
        desc: descField,
        target: targetField,
        channel: z.number().int().min(1).max(24).optional(),
        val: z.number().min(-6).max(6).optional(),
    }).strict().superRefine((value, ctx) => {
        if (value.target !== 'master' && !value.channel) {
            ctx.addIssue({ code: 'custom', path: ['channel'], message: 'Canal obrigatório.' });
        }
    }),
    z.object({
        action: z.literal('channel_mute'),
        desc: descField,
        target: z.literal('channel').optional(),
        channel: z.number().int().min(1).max(24),
        enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]),
    }).strict(),
    z.object({
        action: z.literal('master_mute'),
        desc: descField,
        enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]),
    }).strict(),
    z.object({
        action: z.literal('set_aux_level'),
        desc: descField,
        channel: z.number().int().min(1).max(24),
        aux: z.number().int().min(1).max(10),
        level: z.number().min(0).max(1),
    }).strict(),
    z.object({
        action: z.literal('set_delay'),
        desc: descField,
        target: z.literal('aux').optional(),
        aux: z.number().int().min(1).max(10),
        ms: z.number().min(0).max(500),
    }).strict(),
    z.object({
        action: z.literal('run_clean_sound_preset'),
        desc: descField,
        channel: z.number().int().min(1).max(24),
        hpf: z.number().min(40).max(250).optional(),
        gateThreshold: z.number().min(-80).max(-20).optional(),
        ratio: z.number().min(1).max(6).optional(),
        compThreshold: z.number().min(-60).max(-3).optional(),
        mudHz: z.number().min(120).max(500).optional(),
        mudGain: z.number().min(-6).max(0).optional(),
        harshHz: z.number().min(2000).max(6000).optional(),
        harshGain: z.number().min(-6).max(0).optional(),
    }).strict(),
]);

const proposalSchema = z.object({
    clientRequestId: z.string().trim().min(1).max(80),
    command: z.unknown(),
    reason: z.string().trim().max(500).optional(),
    origin: z.enum(['ai-chat', 'home', 'analyzer', 'alert-center', 'measure', 'mixer']).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
}).strict();

const idSchema = z.object({
    actionId: z.string().uuid(),
}).strict();

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isAdmin(socket) {
    return socket?.user?.role === 'admin';
}

function normalizeCommand(command) {
    const normalized = clone(command);
    if (normalized.action === 'volume_down') {
        normalized.val = -Math.abs(Number(normalized.val || 1));
    } else if (normalized.action === 'volume_up') {
        normalized.val = Math.abs(Number(normalized.val || 1));
    } else if (normalized.action === 'channel_mute') {
        normalized.target = 'channel';
        normalized.enabled = normalized.enabled === true || normalized.enabled === 1;
    } else if (normalized.action === 'master_mute') {
        normalized.enabled = normalized.enabled === true || normalized.enabled === 1;
    } else if (normalized.action === 'set_delay') {
        normalized.target = 'aux';
    }
    return normalized;
}

function riskFor(command) {
    if (command.action === 'master_mute' || command.action === 'run_clean_sound_preset') return 'high';
    if (command.action === 'set_master_level' && command.level < 0.1) return 'high';
    return 'medium';
}

function captureUndo(command, mixerSingleton) {
    const state = mixerSingleton.getStateTree();
    const master = state.master || {};
    const channel = command.channel ? (state.inputs?.[command.channel - 1] || {}) : null;

    switch (command.action) {
        case 'eq_cut': {
            const source = command.target === 'master' ? master : channel;
            const snapshot = clone(source?.eq || {});
            const band = Number(command.band || 4);
            if (!snapshot[band]) {
                snapshot[band] = { hz: command.hz, gain: 0, q: command.q || 1 };
            }
            return {
                type: 'eq_snapshot',
                target: command.target,
                channel: command.channel || null,
                snapshot,
            };
        }
        case 'set_master_level':
            return { type: 'command', command: { action: 'set_master_level', level: Number(master.level || 0), desc: 'Desfazer nível do master' } };
        case 'set_channel_level':
        case 'channel_fader':
            return { type: 'command', command: { action: 'set_channel_level', target: 'channel', channel: command.channel, level: Number(channel?.level || 0), desc: 'Desfazer nível do canal' } };
        case 'set_fader_level_db': {
            const previous = command.target === 'master' ? master.levelDb : channel?.levelDb;
            if (!Number.isFinite(Number(previous))) return null;
            return { type: 'command', command: { action: 'set_fader_level_db', target: command.target, channel: command.channel, levelDb: Number(previous), desc: 'Desfazer fader' } };
        }
        case 'volume_up':
        case 'volume_down': {
            const previous = command.target === 'master' ? master.levelDb : channel?.levelDb;
            if (!Number.isFinite(Number(previous))) return null;
            return { type: 'command', command: { action: 'set_fader_level_db', target: command.target, channel: command.channel, levelDb: Number(previous), desc: 'Desfazer ajuste de volume' } };
        }
        case 'channel_mute':
            return { type: 'command', command: { action: 'channel_mute', target: 'channel', channel: command.channel, enabled: Boolean(channel?.mute), desc: 'Desfazer mute do canal' } };
        case 'master_mute':
            return { type: 'command', command: { action: 'master_mute', enabled: Boolean(master.mute), desc: 'Desfazer mute do master' } };
        case 'apply_channel_hpf':
            return { type: 'command', command: { action: 'apply_channel_hpf', channel: command.channel, hz: Number(channel?.hpf || 100), desc: 'Desfazer HPF do canal' } };
        case 'set_aux_level': {
            const previous = state.aux?.[command.aux - 1]?.level;
            if (!Number.isFinite(Number(previous))) return null;
            return { type: 'command', command: { action: 'set_aux_level', channel: command.channel, aux: command.aux, level: Number(previous), desc: 'Desfazer nível do auxiliar' } };
        }
        case 'set_delay': {
            const previous = state.aux?.[command.aux - 1]?.delay;
            if (!Number.isFinite(Number(previous))) return null;
            return { type: 'command', command: { action: 'set_delay', target: 'aux', aux: command.aux, ms: Number(previous), desc: 'Desfazer delay do auxiliar' } };
        }
        default:
            return null;
    }
}

function executeUndo(undo, actions) {
    if (!undo) throw new Error('Esta ação não possui desfazer seguro.');
    if (undo.type === 'eq_snapshot') {
        return actions.restoreEqSnapshot(undo.target, undo.channel, undo.snapshot).msg;
    }
    if (undo.type === 'command') {
        const validated = normalizeCommand(commandSchema.parse(undo.command));
        return actions.executeMixerCommand(validated, { source: 'ai' });
    }
    throw new Error('Descritor de desfazer inválido.');
}

function publicEntry(entry) {
    return {
        actionId: entry.actionId,
        clientRequestId: entry.clientRequestId,
        command: clone(entry.command),
        reason: entry.reason,
        origin: entry.origin,
        evidence: clone(entry.evidence),
        risk: entry.risk,
        status: entry.status,
        createdAt: entry.createdAt,
        expiresAt: entry.expiresAt,
        completedAt: entry.completedAt || null,
        result: entry.result || null,
        error: entry.error || null,
        undoAvailable: Boolean(entry.undo && entry.status === 'completed'),
        undoneAt: entry.undoneAt || null,
    };
}

function registerSoundAssistantHandlers(io, socket, deps) {
    const { actions, logger, mixerSingleton, rateLimiter, addToHistory } = deps;
    const entries = new Map();

    function cleanup() {
        const now = Date.now();
        for (const [id, entry] of entries) {
            const ageLimit = entry.status === 'pending' ? entry.expiresAt : (entry.completedAt || entry.createdAt) + COMPLETED_TTL_MS;
            if (now > ageLimit) entries.delete(id);
        }
    }

    function emitState() {
        cleanup();
        socket.emit('sound_assistant_state', {
            actions: Array.from(entries.values()).map(publicEntry),
            serverTime: Date.now(),
        });
    }

    socket.on('sound_assistant_propose_action', (payload) => {
        if (!rateLimiter(socket, 'sound_assistant_propose_action')) return;
        try {
            if (!isAdmin(socket)) throw new Error('Apenas administradores podem preparar ajustes da IA.');
            const payloadBytes = Buffer.byteLength(JSON.stringify(payload || {}), 'utf8');
            if (payloadBytes > 64 * 1024) throw new Error('Proposta excede o limite de 64KB.');
            cleanup();
            const pendingCount = Array.from(entries.values()).filter((entry) => entry.status === 'pending').length;
            if (pendingCount >= MAX_PENDING) throw new Error('Limite de ações pendentes atingido.');

            const proposal = proposalSchema.parse(payload);
            const command = normalizeCommand(commandSchema.parse(proposal.command));
            const actionId = crypto.randomUUID();
            const now = Date.now();
            const entry = {
                actionId,
                clientRequestId: proposal.clientRequestId,
                command,
                reason: proposal.reason || command.desc || 'Ajuste sugerido pela IA.',
                origin: proposal.origin || 'ai-chat',
                evidence: clone(proposal.evidence || {}),
                risk: riskFor(command),
                status: 'pending',
                createdAt: now,
                expiresAt: now + PENDING_TTL_MS,
                undo: null,
            };
            entries.set(actionId, entry);
            logger.info(socket.id, 'SOUND_ASSISTANT_ACTION_PROPOSED', {
                actionId,
                action: command.action,
                risk: entry.risk,
                origin: entry.origin,
            });
            socket.emit('sound_assistant_action_pending', publicEntry(entry));
            emitState();
        } catch (error) {
            logger.warn(socket.id, 'SOUND_ASSISTANT_PROPOSAL_REJECTED', { error: error.message });
            socket.emit('sound_assistant_action_rejected', {
                clientRequestId: payload?.clientRequestId || null,
                status: 'rejected',
                error: error.message,
            });
        }
    });

    socket.on('sound_assistant_confirm_action', (payload) => {
        if (!rateLimiter(socket, 'sound_assistant_confirm_action')) return;
        let entry;
        try {
            if (!isAdmin(socket)) throw new Error('Apenas administradores podem confirmar ajustes da IA.');
            const { actionId } = idSchema.parse(payload);
            cleanup();
            entry = entries.get(actionId);
            if (!entry) throw new Error('Ação pendente não encontrada ou expirada.');
            if (entry.status !== 'pending') throw new Error('Ação já processada.');
            if (Date.now() > entry.expiresAt) {
                entry.status = 'expired';
                throw new Error('Ação expirada. Solicite uma nova análise.');
            }
            if (!actions.ensureMixer(socket)) throw new Error('Mesa não conectada.');

            entry.status = 'processing';
            socket.emit('sound_assistant_action_result', publicEntry(entry));
            entry.undo = captureUndo(entry.command, mixerSingleton);
            const result = actions.executeMixerCommand(entry.command, { source: 'ai' });
            entry.status = 'completed';
            entry.completedAt = Date.now();
            entry.result = typeof result === 'string' ? result : (result?.msg || JSON.stringify(result));
            addToHistory({
                type: 'sound_assistant_confirmed_action',
                actionId,
                data: clone(entry.command),
                undo: clone(entry.undo),
            });
            logger.info(socket.id, 'SOUND_ASSISTANT_ACTION_COMPLETED', {
                actionId,
                action: entry.command.action,
                result: entry.result,
                undoAvailable: Boolean(entry.undo),
            });
            socket.emit('sound_assistant_action_result', publicEntry(entry));
            emitState();
        } catch (error) {
            if (entry && entry.status === 'processing') {
                entry.status = 'failed';
                entry.error = error.message;
                entry.completedAt = Date.now();
            }
            logger.error(socket.id, 'SOUND_ASSISTANT_ACTION_FAILED', { actionId: payload?.actionId, error: error.message });
            socket.emit('sound_assistant_action_result', entry
                ? publicEntry(entry)
                : { actionId: payload?.actionId || null, status: 'failed', error: error.message });
        }
    });

    socket.on('sound_assistant_reject_action', (payload) => {
        if (!rateLimiter(socket, 'sound_assistant_reject_action')) return;
        try {
            if (!isAdmin(socket)) throw new Error('Apenas administradores podem rejeitar ajustes da IA.');
            const { actionId } = idSchema.parse(payload);
            const entry = entries.get(actionId);
            if (!entry || entry.status !== 'pending') throw new Error('Ação pendente não encontrada.');
            entry.status = 'rejected';
            entry.completedAt = Date.now();
            logger.info(socket.id, 'SOUND_ASSISTANT_ACTION_REJECTED', { actionId, action: entry.command.action });
            socket.emit('sound_assistant_action_result', publicEntry(entry));
            emitState();
        } catch (error) {
            socket.emit('sound_assistant_action_result', { actionId: payload?.actionId || null, status: 'failed', error: error.message });
        }
    });

    socket.on('sound_assistant_undo_action', (payload) => {
        if (!rateLimiter(socket, 'sound_assistant_undo_action')) return;
        let entry;
        try {
            if (!isAdmin(socket)) throw new Error('Apenas administradores podem desfazer ajustes da IA.');
            const { actionId } = idSchema.parse(payload);
            entry = entries.get(actionId);
            if (!entry || entry.status !== 'completed') throw new Error('Ação concluída não encontrada.');
            if (entry.undoneAt) throw new Error('Ação já desfeita.');
            if (!actions.ensureMixer(socket)) throw new Error('Mesa não conectada.');

            const result = executeUndo(entry.undo, actions);
            entry.undoneAt = Date.now();
            entry.result = `${entry.result} | Desfeito: ${result}`;
            logger.info(socket.id, 'SOUND_ASSISTANT_ACTION_UNDONE', { actionId, action: entry.command.action, result });
            socket.emit('sound_assistant_action_result', publicEntry(entry));
            emitState();
        } catch (error) {
            logger.error(socket.id, 'SOUND_ASSISTANT_UNDO_FAILED', { actionId: payload?.actionId, error: error.message });
            socket.emit('sound_assistant_action_result', entry
                ? { ...publicEntry(entry), error: error.message }
                : { actionId: payload?.actionId || null, status: 'failed', error: error.message });
        }
    });

    socket.on('sound_assistant_get_state', emitState);
}

module.exports = {
    registerSoundAssistantHandlers,
    commandSchema,
    proposalSchema,
    normalizeCommand,
    captureUndo,
};
