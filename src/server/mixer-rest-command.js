const { z } = require('zod');

const boolish = z.union([z.boolean(), z.number()]).transform((value) => !!value);
const level01 = z.union([z.number(), z.string()]).transform((value) => Number(value)).pipe(z.number().min(0).max(1));
const integerChannel = z.union([z.number(), z.string()]).transform((value) => Number(value)).pipe(z.number().int().min(1).max(24));
const integerAux = z.union([z.number(), z.string()]).transform((value) => Number(value)).pipe(z.number().int().min(1).max(10));
const integerFx = z.union([z.number(), z.string()]).transform((value) => Number(value)).pipe(z.number().int().min(1).max(4));
const boundedNumber = (min, max) => z.union([z.number(), z.string()]).transform((value) => Number(value)).pipe(z.number().min(min).max(max));

const restCommandSchemas = {
    set_master_level: z.object({
        action: z.enum(['set_master_level', 'master_level']),
        level: level01
    }).strict(),

    master_mute: z.object({
        action: z.enum(['master_mute', 'mute_master']),
        enabled: boolish
    }).strict(),

    set_channel_level: z.object({
        action: z.enum(['set_channel_level', 'channel_fader', 'channel_level']),
        channel: integerChannel,
        level: level01
    }).strict(),

    channel_mute: z.object({
        action: z.literal('channel_mute'),
        channel: integerChannel,
        enabled: boolish
    }).strict(),

    set_aux_level: z.object({
        action: z.literal('set_aux_level'),
        channel: integerChannel,
        aux: integerAux,
        level: level01
    }).strict(),

    set_fx_level: z.object({
        action: z.literal('set_fx_level'),
        channel: integerChannel,
        fx: integerFx,
        level: level01
    }).strict(),

    set_delay: z.object({
        action: z.literal('set_delay'),
        target: z.enum(['master', 'aux', 'channel', 'input']),
        channel: integerChannel.optional(),
        aux: integerAux.optional(),
        id: z.union([z.number(), z.string()]).transform((value) => Number(value)).pipe(z.number().int().min(1).max(24)).optional(),
        ms: boundedNumber(0, 500)
    }).strict().superRefine((value, ctx) => {
        if ((value.target === 'channel' || value.target === 'input') && value.channel == null && value.id == null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['channel'],
                message: 'channel ou id e obrigatorio para target channel/input'
            });
        }
        if (value.target === 'aux' && value.aux == null && value.id == null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['aux'],
                message: 'aux ou id e obrigatorio para target aux'
            });
        }
    }),

    eq_cut: z.object({
        action: z.literal('eq_cut'),
        target: z.enum(['master', 'channel']),
        channel: integerChannel.optional(),
        hz: boundedNumber(20, 20000),
        gain: boundedNumber(-24, 12).optional(),
        q: boundedNumber(0.1, 10).optional(),
        band: boundedNumber(1, 4).optional()
    }).strict().superRefine((value, ctx) => {
        if (value.target === 'channel' && value.channel == null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['channel'],
                message: 'channel e obrigatorio quando target=channel'
            });
        }
    }),

    apply_channel_hpf: z.object({
        action: z.literal('apply_channel_hpf'),
        channel: integerChannel,
        hz: boundedNumber(20, 1000)
    }).strict(),

    apply_channel_gate: z.object({
        action: z.literal('apply_channel_gate'),
        channel: integerChannel,
        enabled: boolish,
        threshold: boundedNumber(-80, 0).optional()
    }).strict(),

    apply_channel_compressor: z.object({
        action: z.literal('apply_channel_compressor'),
        channel: integerChannel,
        ratio: boundedNumber(1, 20).optional(),
        threshold: boundedNumber(-60, 0).optional()
    }).strict(),

    set_phantom: z.object({
        action: z.enum(['set_phantom', 'set_phantom_power']),
        input: integerChannel.optional(),
        channel: integerChannel.optional(),
        enabled: boolish
    }).strict().superRefine((value, ctx) => {
        if (value.input == null && value.channel == null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['input'],
                message: 'input ou channel e obrigatorio'
            });
        }
    }),

    set_channel_name: z.object({
        action: z.literal('set_channel_name'),
        channel: integerChannel,
        name: z.string().trim().min(1).max(20)
    }).strict()
};

const ACTION_KEY_BY_ALIAS = new Map([
    ['set_master_level', 'set_master_level'],
    ['master_level', 'set_master_level'],
    ['master_mute', 'master_mute'],
    ['mute_master', 'master_mute'],
    ['set_channel_level', 'set_channel_level'],
    ['channel_fader', 'set_channel_level'],
    ['channel_level', 'set_channel_level'],
    ['channel_mute', 'channel_mute'],
    ['set_aux_level', 'set_aux_level'],
    ['set_fx_level', 'set_fx_level'],
    ['set_delay', 'set_delay'],
    ['eq_cut', 'eq_cut'],
    ['apply_channel_hpf', 'apply_channel_hpf'],
    ['apply_channel_gate', 'apply_channel_gate'],
    ['apply_channel_compressor', 'apply_channel_compressor'],
    ['set_phantom', 'set_phantom'],
    ['set_phantom_power', 'set_phantom'],
    ['set_channel_name', 'set_channel_name']
]);

function parseRestMixerCommand(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Payload do comando deve ser um objeto JSON.');
    }

    const action = typeof input.action === 'string' ? input.action : '';
    const actionKey = ACTION_KEY_BY_ALIAS.get(action);
    if (!actionKey) {
        throw new Error(`Acao nao permitida na API REST: ${action || '(ausente)'}`);
    }

    const parsed = restCommandSchemas[actionKey].parse(input);

    if (actionKey === 'set_master_level') {
        return { action: 'set_master_level', level: parsed.level };
    }
    if (actionKey === 'master_mute') {
        return { action: 'master_mute', enabled: parsed.enabled };
    }
    if (actionKey === 'set_channel_level') {
        return { action: 'set_channel_level', channel: parsed.channel, level: parsed.level };
    }
    if (actionKey === 'set_phantom') {
        return { action: 'set_phantom', input: parsed.input || parsed.channel, enabled: parsed.enabled };
    }
    return Object.assign({ action: actionKey }, parsed);
}

function buildRestMixerBroadcast(command) {
    switch (command.action) {
        case 'set_master_level':
            return { event: 'set_master_level', data: { level: command.level } };
        case 'set_channel_level':
            return { event: 'set_channel_level', data: { channel: command.channel, level: command.level } };
        case 'channel_mute':
            return { event: 'set_channel_mute', data: { channel: command.channel, mute: command.enabled } };
        case 'master_mute':
            return { event: 'set_master_mute', data: { mute: command.enabled } };
        default:
            return null;
    }
}

module.exports = {
    parseRestMixerCommand,
    buildRestMixerBroadcast
};
