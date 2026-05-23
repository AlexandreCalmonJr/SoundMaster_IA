const { z } = require('zod');
const { SoundcraftUI, ConnectionStatus } = require('soundcraft-ui-connection');
const { createMixerActions } = require('./mixer-actions');
const db = require('./database');
const historyService = require('./history-service');
const aiPredictor = require('./ai-predictor');
const Logger = require('./logger');
const mixerSingleton = require('./mixer-singleton');
const loopbackService = require('./loopback-service');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const netDiag = require('./network');

// ✅ T10: Porta do Python configurável via .env
const PYTHON_PORT = parseInt(process.env.PYTHON_PORT || '3002', 10);

// --- Esquemas de Validação ---
// ... (esquemas omitidos para brevidade, mantidos no arquivo)
const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const schemas = {
    connect: z.string().regex(ipRegex).or(z.enum(['offline', 'simulado', '127.0.0.1'])),
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
        action: z.string(), // Permite qualquer ação, validaremos no roteador
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

function registerSocketHandlers(io, appDataDir = './logs') {
    const logger = Logger.getInstance(appDataDir);
    
    logger.onLog = (entry) => {
        io.emit('system_log', entry);
    };

    // ── Diagnóstico de Rede e Descoberta mDNS ─────────────────────────────
    netDiag.init(io);

    // ✅ Inicializa a extração de áudio Loopback (AES67 -> WebSocket)
    loopbackService.init(io);
    
    let activeConnections = 0;
    let feedbackCooldowns = new Map();
    let automaticCutState = new Map();
    const FEEDBACK_COOLDOWN_MS = 5000;
    const MAX_AUTOMATIC_CUTS = 3;
    const RAW_MESSAGE_PREFIX_WHITELIST = ['SETD^', 'SETS^', 'BMSG^', 'NODE^'];

    let globalHistoryStack = [];
    let globalRedoStack = [];

    // ✅ T6: Cleanup periódico de Maps para evitar crescimento indefinido (P18)
    setInterval(() => {
        const now = Date.now();
        const TTL_MS = 3600000; // 1 hora
        
        for (const [k, v] of feedbackCooldowns) {
            if (now - v > TTL_MS) feedbackCooldowns.delete(k);
        }
        for (const [k, v] of automaticCutState) {
            if (now - v.timestamp > TTL_MS) automaticCutState.delete(k);
        }
        
        if (feedbackCooldowns.size > 0 || automaticCutState.size > 0) {
            console.log(`[SocketHandlers] Maps limpos. feedbackCooldowns: ${feedbackCooldowns.size}, automaticCutState: ${automaticCutState.size}`);
        }
    }, 300000); // A cada 5 minutos

    function createThrottle(fn, ms) {
        let lastTime = 0;
        return function(...args) {
            const now = Date.now();
            if (now - lastTime >= ms) {
                lastTime = now;
                return fn.apply(this, args);
            }
        };
    }
    
    io.on('connection', (socket) => {
        activeConnections++;
        
        function addToHistory(cmd) {
            globalHistoryStack.push(cmd);
            if (globalHistoryStack.length > 50) globalHistoryStack.shift();
            globalRedoStack = [];
        }

        function normalizeAutoCutFrequency(hz) {
            return Math.round(Number(hz) || 0);
        }

        function canApplyAutomaticCut(hz) {
            const now = Date.now();
            const roundedHz = normalizeAutoCutFrequency(hz);
            const lastCut = feedbackCooldowns.get(roundedHz) || 0;
            if (now - lastCut < FEEDBACK_COOLDOWN_MS) {
                return { allowed: false, reason: 'cooldown', roundedHz };
            }
            const activeCuts = Array.from(automaticCutState.values()).filter(entry => now - entry.timestamp < FEEDBACK_COOLDOWN_MS);
            if (activeCuts.length >= MAX_AUTOMATIC_CUTS) {
                return { allowed: false, reason: 'limit', roundedHz };
            }
            return { allowed: true, roundedHz };
        }
        
        const actions = createMixerActions(() => mixerSingleton.getMixer());
        
        const throttledSetMaster = createThrottle((level) => {
            const m = mixerSingleton.getMixer();
            if (!m) return;
            m.master.setFaderLevel(level);
            if (m.isSimulated) {
                m.conn.sendMessage(`SETD^m.value^${level}`);
            }
        }, 50);

        logger.info(socket.id, 'CLIENT_CONNECTED', { activeConnections });

        // ── T25: Zero-latency State Tree load ─────────────────────────────────
        // Novo cliente recebe imediatamente o cache completo da mesa.
        // Não é preciso pedir dados à Ui24R — elimina round-trip e stress.
        mixerSingleton.dispatchStateTreeTo(socket);

        // ── Handlers de diagnóstico de rede ───────────────────────────────────
        netDiag.registerNetDiagHandlers(socket);

        // ── T26: Delta Update (reconexão passiva) ─────────────────────────────
        // O cliente reconectado solicita apenas o que mudou. O State Tree é
        // sempre actual no servidor (proxy singleton), pelo que respondemos com
        // o snapshot completo marcado como delta. O cliente aplica com Lerp.
        socket.on('request_state_delta', ({ windowSecs } = {}) => {
            const stateTree = mixerSingleton.getStateTree();
            socket.emit('mixer_state_full', {
                ...stateTree,
                _source:    'delta',
                _windowSecs: windowSecs || 10,
                _ts:         Date.now(),
            });
            logger.info(socket.id, 'STATE_DELTA_SENT', { windowSecs });
        });

        socket.on('connect_mixer', async (ip) => {
            try {
                const validatedIp = schemas.connect.parse(ip);
                logger.info(socket.id, 'MIXER_CONNECT_ATTEMPT', { ip: validatedIp });
                
                const currentMixer = mixerSingleton.getMixer();

                if (currentMixer && currentMixer.targetIp === validatedIp) {
                    logger.info(socket.id, 'MIXER_SINGLETON_REUSE');
                    socket.emit('mixer_status', { connected: true, msg: `Reutilizando conexão em ${validatedIp}` });
                    socket.emit('mixer_state_full', mixerSingleton.getState());
                    return;
                }

                if (currentMixer) {
                    try {
                        logger.info(socket.id, 'MIXER_CLEANUP_PREVIOUS');
                        currentMixer.disconnect(); 
                    } catch(e) {}
                    mixerSingleton.setMixer(null);
                }

                const newMixer = validatedIp === 'offline' || validatedIp === 'simulado' || validatedIp === '127.0.0.1'
                    ? {
                        isSimulated: true,
                        targetIp: validatedIp,
                        conn: { sendMessage: (msg) => socket.emit('mixer_log', `RAW: ${msg}`) },
                        master: {
                            faderLevel$: { subscribe: () => {} },
                            faderLevelDB$: { subscribe: () => {} },
                            setFaderLevel: (v) => socket.emit('mixer_log', `[Sim] Master Fader -> ${Math.round(v*100)}%`),
                            changeFaderLevelDB: (v) => socket.emit('mixer_log', `[Sim] Master Fader -> ${v}dB`),
                            mute: () => socket.emit('mixer_log', '[Sim] Master MUTADO'),
                            unmute: () => socket.emit('mixer_log', '[Sim] Master ATIVADO'),
                            eq: () => ({
                                band: (b) => ({
                                    setFreq: (f) => socket.emit('mixer_log', `[Sim] Master EQ B${b} Freq -> ${f}Hz`),
                                    setGain: (g) => socket.emit('mixer_log', `[Sim] Master EQ B${b} Gain -> ${g}dB`),
                                    setQ: (q) => socket.emit('mixer_log', `[Sim] Master EQ B${b} Q -> ${q}`),
                                    setType: (t) => socket.emit('mixer_log', `[Sim] Master EQ B${b} Type -> ${t}`)
                                })
                            }),
                            afs: () => ({ enable: () => {}, disable: () => {} }),
                            toggleDim: () => {},
                            setPan: (v) => socket.emit('mixer_log', `[Sim] Master Pan -> ${v}`),
                            setDelayL: (ms) => socket.emit('mixer_log', `[Sim] Master Delay L -> ${ms}ms`),
                            setDelayR: (ms) => socket.emit('mixer_log', `[Sim] Master Delay R -> ${ms}ms`)
                        },
                        input: (id) => ({
                            setFaderLevel: (v) => socket.emit('mixer_log', `[Sim] Canal ${id} Fader -> ${Math.round(v * 100)}%`),
                            mute: () => socket.emit('mixer_log', `[Sim] Canal ${id} MUTADO`),
                            unmute: () => socket.emit('mixer_log', `[Sim] Canal ${id} ATIVADO`),
                            setPan: (v) => socket.emit('mixer_log', `[Sim] Canal ${id} Pan -> ${v}`),
                            toggleSolo: () => socket.emit('mixer_log', `[Sim] Canal ${id} SOLO alternado`),
                            setDelay: (ms) => socket.emit('mixer_log', `[Sim] Canal ${id} Delay -> ${ms}ms`),
                            fadeTo: (v, ms) => socket.emit('mixer_log', `[Sim] Canal ${id} Fade -> ${Math.round(v * 100)}% em ${ms}ms`),
                            setName: (name) => socket.emit('mixer_log', `[Sim] Canal ${id} Nome -> ${name}`),
                            multiTrackSelect: () => socket.emit('mixer_log', `[Sim] Canal ${id} adicionado ao MTK`),
                            multiTrackUnselect: () => socket.emit('mixer_log', `[Sim] Canal ${id} removido do MTK`),
                            automixAssignGroup: (group) => socket.emit('mixer_log', `[Sim] Canal ${id} Automix -> ${group}`),
                            automixSetWeight: (weight) => socket.emit('mixer_log', `[Sim] Canal ${id} Peso Automix -> ${weight}`),
                            eq: () => ({
                                setHpfFreq: (f) => socket.emit('mixer_log', `[Sim] Canal ${id} HPF -> ${f}Hz`),
                                setHpfSlope: (s) => socket.emit('mixer_log', `[Sim] Canal ${id} HPF Slope -> ${s}`),
                                band: (b) => ({
                                    setFreq: (f) => socket.emit('mixer_log', `[Sim] Canal ${id} EQ B${b} Freq -> ${f}Hz`),
                                    setGain: (g) => socket.emit('mixer_log', `[Sim] Canal ${id} EQ B${b} Gain -> ${g}dB`),
                                    setQ: (q) => socket.emit('mixer_log', `[Sim] Canal ${id} EQ B${b} Q -> ${q}`),
                                    setType: (t) => socket.emit('mixer_log', `[Sim] Canal ${id} EQ B${b} Type -> ${t}`)
                                })
                            }),
                            gate: () => ({
                                enable: () => socket.emit('mixer_log', `[Sim] Canal ${id} Gate ON`),
                                disable: () => socket.emit('mixer_log', `[Sim] Canal ${id} Gate OFF`),
                                setThreshold: (threshold) => socket.emit('mixer_log', `[Sim] Canal ${id} Gate Thresh -> ${threshold}`)
                            }),
                            compressor: () => ({
                                enable: () => socket.emit('mixer_log', `[Sim] Canal ${id} Compressor ON`),
                                setRatio: (ratio) => socket.emit('mixer_log', `[Sim] Canal ${id} Compressor Ratio -> ${ratio}`),
                                setThreshold: (threshold) => socket.emit('mixer_log', `[Sim] Canal ${id} Compressor Thresh -> ${threshold}`),
                                setAttack: (attack) => socket.emit('mixer_log', `[Sim] Canal ${id} Compressor Attack -> ${attack}`),
                                setRelease: (release) => socket.emit('mixer_log', `[Sim] Canal ${id} Compressor Release -> ${release}`)
                            }),
                            aux: (auxId) => ({
                                setFaderLevel: (v) => socket.emit('mixer_log', `[Sim] Canal ${id} AUX ${auxId} -> ${Math.round(v * 100)}%`),
                                setPost: (post) => socket.emit('mixer_log', `[Sim] Canal ${id} AUX ${auxId} Post -> ${post}`),
                                setPostProc: (postProc) => socket.emit('mixer_log', `[Sim] Canal ${id} AUX ${auxId} PostProc -> ${postProc}`),
                                setPan: (v) => socket.emit('mixer_log', `[Sim] Canal ${id} AUX ${auxId} Pan -> ${v}`)
                            }),
                            fx: (fxId) => ({
                                setFaderLevel: (v) => socket.emit('mixer_log', `[Sim] Canal ${id} FX ${fxId} -> ${Math.round(v * 100)}%`),
                                setPost: (post) => socket.emit('mixer_log', `[Sim] Canal ${id} FX ${fxId} Post -> ${post}`)
                            }),
                            faderLevel$: { subscribe: () => {} },
                            mute$: { subscribe: () => {} },
                            name$: { subscribe: () => {} }
                        }),
                        aux: (id) => ({
                            setDelay: (ms) => socket.emit('mixer_log', `[Sim] Aux ${id} Delay -> ${ms}ms`)
                        }),
                        hw: (id) => ({
                            setGain: (v) => socket.emit('mixer_log', `[Sim] HW ${id} Gain -> ${v}`),
                            phantomOn: () => socket.emit('mixer_log', `[Sim] HW ${id} Phantom ON`),
                            phantomOff: () => socket.emit('mixer_log', `[Sim] HW ${id} Phantom OFF`),
                            oscillator: () => ({
                                enable: () => socket.emit('mixer_log', '[Sim] Oscillator ON'),
                                disable: () => socket.emit('mixer_log', '[Sim] Oscillator OFF'),
                                setType: (type) => socket.emit('mixer_log', `[Sim] Oscillator Type -> ${type}`),
                                setFaderLevel: (level) => socket.emit('mixer_log', `[Sim] Oscillator Level -> ${level}dB`)
                            })
                        }),
                        recorderDualTrack: { recording$: { subscribe: () => {} } },
                        recorderMultiTrack: { recording$: { subscribe: () => {} } },
                        automix: { groups: { a: { state$: { subscribe: () => {} } }, b: { state$: { subscribe: () => {} } } }, responseTimeMs$: { subscribe: () => {} } },
                        deviceInfo: { firmware$: { subscribe: () => {} }, capabilities$: { subscribe: () => {} } },
                        shows: { currentShow$: { subscribe: () => {} }, currentSnapshot$: { subscribe: () => {} }, currentCue$: { subscribe: () => {} } },
                        vuProcessor: { vuData$: { subscribe: () => {} } },
                        channelSync: {
                            getSelectedChannel: () => ({ subscribe: () => {} }),
                            selectChannel: (type, number, syncId) => socket.emit('mixer_log', `[Sim] Select ${type} ${number || ''} (${syncId})`)
                        },
                        player: { state$: { subscribe: () => {} }, track$: { subscribe: () => {} } },
                        muteGroup: () => ({ state$: { subscribe: () => {} }, mute: () => {}, unmute: () => {} }),
                        volume: { solo: { setFaderLevel: () => {} }, headphone: () => ({ setFaderLevel: () => {} }) },
                        disconnect: () => { mixerSingleton.setMixer(null); }
                    }
                    : new SoundcraftUI(validatedIp);

                mixerSingleton.setMixer(newMixer);
                
                if (newMixer.isSimulated) {
                    socket.emit('mixer_status', { connected: true, isSimulated: true, msg: 'Modo Simulado Ativo' });
                    return;
                }

                newMixer.status$.subscribe(status => {
                    const statusMap = {
                        [ConnectionStatus.Open]:        { connected: true,  msg: 'Conectado à Soundcraft Ui!' },
                        [ConnectionStatus.Close]:       { connected: false, msg: 'Desconectado da mesa.' },
                        [ConnectionStatus.Error]:       { connected: false, msg: 'Erro na conexão com a mesa.' },
                        [ConnectionStatus.Reconnecting]:{ connected: false, msg: 'Reconectando...' }
                    };
                    const s = statusMap[status];
                    if (s) socket.emit('mixer_status', s);
                });

                await newMixer.connect();
                logger.info(socket.id, 'MIXER_CONNECT_COMMAND_SENT', { ip });

                if (!newMixer.isSubscribed) {
                    newMixer.isSubscribed = true;
                    const mState = mixerSingleton.getState();

                    newMixer.master.faderLevel$.subscribe(level => {
                        mixerSingleton.updateMasterState({ level });
                        io.emit('master_level', level);
                    });
                    newMixer.master.faderLevelDB$.subscribe(levelDb => {
                        mixerSingleton.updateMasterState({ levelDb });
                        io.emit('master_level_db', levelDb);
                    });

                    newMixer.vuProcessor.vuData$.subscribe(vuData => {
                        const mapped = { master: null, channels: {} };
                        if (vuData['master']) mapped.master = vuData['master'];
                        for (let i = 1; i <= 24; i++) {
                            if (vuData[`i.${i-1}`]) mapped.channels[i] = vuData[`i.${i-1}`];
                        }
                        io.emit('vu_data', mapped);
                    });

                    newMixer.deviceInfo.firmware$.subscribe(fw => io.emit('device_info', { firmware: fw }));
                    newMixer.deviceInfo.capabilities$.subscribe(caps => {
                        io.emit('device_info', { 
                            model: newMixer.deviceInfo.model,
                            caps: { inputs: caps.inputChannels, aux: caps.auxBusses, fx: caps.fxChannels, sub: caps.subGroups, vca: caps.vcaGroups }
                        });
                    });

                    newMixer.automix.groups.a.state$.subscribe(state => io.emit('automix_state', { group: 'a', enabled: !!state }));
                    newMixer.automix.groups.b.state$.subscribe(state => io.emit('automix_state', { group: 'b', enabled: !!state }));
                    newMixer.automix.responseTimeMs$.subscribe(ms => io.emit('automix_response_time', { ms }));

                    newMixer.recorderDualTrack.recording$.subscribe(isRec => io.emit('recorder_status', { recording: !!isRec, mtkRecording: false }));
                    newMixer.recorderMultiTrack.recording$.subscribe(isMtkRec => io.emit('recorder_status', { recording: false, mtkRecording: !!isMtkRec }));

                    newMixer.player.state$.subscribe(state => io.emit('player_status', { state }));
                    newMixer.player.track$.subscribe(track => io.emit('player_track', { track }));

                    newMixer.shows.currentShow$.subscribe(show => io.emit('show_status', { show }));
                    newMixer.shows.currentSnapshot$.subscribe(snapshot => io.emit('snapshot_status', { snapshot }));
                    newMixer.shows.currentCue$.subscribe(cue => io.emit('cue_status', { cue }));

                    for (let i = 1; i <= 24; i++) {
                        const input = newMixer.input(i);
                        input.name$.subscribe(name => io.emit('channel_name_update', { channel: i, name }));
                        
                        // ✅ Sincronização de Fader e Mute para o Singleton
                        input.faderLevel$.subscribe(level => {
                            mixerSingleton.updateChannelState(i, { level });
                            io.emit('channel_level', { channel: i, level });
                        });
                        input.mute$.subscribe(mute => {
                            mixerSingleton.updateChannelState(i, { mute });
                            io.emit('channel_mute', { channel: i, mute });
                        });
                    }

                    ['all', '1', '2', '3', '4', 'fx'].forEach(groupId => {
                        newMixer.muteGroup(groupId).state$.subscribe(state => io.emit('mute_group_state', { groupId, enabled: !!state }));
                    });

                    newMixer.channelSync.getSelectedChannel('SYNC_ID').subscribe(selection => {
                        io.emit('channel_selected_external', selection);
                    });
                }
            } catch (error) {
                logger.error(socket.id, 'MIXER_CONNECT_ERROR', { error: error.message });
                socket.emit('mixer_status', { connected: false, msg: `Erro de conexao: ${error.message}` });
            }
        });

        socket.on('disconnect_mixer', () => {
            const m = mixerSingleton.getMixer();
            if (m) {
                m.disconnect();
                mixerSingleton.setMixer(null);
                console.log('Mesa desconectada a pedido do usuario.');
                io.emit('mixer_status', { connected: false, msg: 'Desconectado.' });
            }
        });

        socket.on('set_master_level', (data) => {
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
            try {
                const { hz } = schemas.feedbackCut.parse(data);
                const now = Date.now();
                const lastCut = feedbackCooldowns.get(Math.round(hz)) || 0;

                if (now - lastCut < FEEDBACK_COOLDOWN_MS) {
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

        // ✅ Correção Auditoria: Handler dedicado para Phantom Power
        socket.on('set_phantom_power', (data) => {
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

        // ✅ Correção Auditoria: Sincronização de nome de canal com a mesa
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

        socket.on('save_acoustic_snapshot', async (data) => {
            try {
                const doc = await historyService.saveSnapshot(data);
                io.emit('snapshot_saved', doc); // Broadcast para todos
            } catch (e) {
                console.error('Erro ao salvar snapshot:', e.message);
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
                console.error('Erro ao salvar heatmap:', e.message);
            }
        });

        socket.on('get_acoustic_history', async () => {
            try {
                const docs = await historyService.getComparison();
                const benchmark = await historyService.getBenchmark();
                socket.emit('acoustic_history_data', { history: docs, benchmark });
            } catch (e) {
                console.error('Erro ao buscar histórico:', e.message);
            }
        });

        socket.on('analyze_feedback_risk', async (data) => {
            try {
                const risk = await aiPredictor.predictRisk(data.hz, data.db, data.prevDb, data.gain || 0);
                socket.emit('feedback_risk_result', { hz: data.hz, risk });
                
                // Se o risco for altíssimo (> 0.9), podemos disparar um corte preventivo
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
                console.error('Erro na previsão de IA:', e.message);
            }
        });


        socket.on('analyze_sweep_ir', async (data) => {
            const { recording, sweepParams } = data;

            if (!recording || !Array.isArray(recording) || recording.length < 4800) {
                socket.emit('sweep_analysis_result', { error: 'Recording too short or missing.' });
                return;
            }

            // ✅ FIX 1: Usa diretório dentro do projeto em vez de os.tmpdir()
            // os.tmpdir() em Windows pode retornar paths com espaços
            // (ex: C:\Users\Nome Sobrenome\AppData\Local\Temp), quebrando o spawn silenciosamente.
            const { mkdirSync, writeFileSync } = require('fs');
            const tmpDir = path.join(__dirname, '..', '..', 'data', 'tmp');
            try { mkdirSync(tmpDir, { recursive: true }); } catch (_) {}
            const tmpWav = path.join(tmpDir, `sweep_${Date.now()}.wav`);

            // ✅ FIX 2: sampleRate vem do frontend (44100) — não hardcode 48000
            // Um header WAV com sampleRate errado faz o Python calcular T60 com base de tempo incorreta
            const sampleRate = (sweepParams?.sampleRate && Number.isFinite(sweepParams.sampleRate))
                ? sweepParams.sampleRate
                : 44100;

            try {
                const int16Data = new Int16Array(recording.map(v => Math.max(-32768, Math.min(32767, Math.round(v * 32768)))));

                // Monta header WAV (RIFF PCM 16-bit mono)
                const header = Buffer.alloc(44);
                const dv = new DataView(header.buffer);
                dv.setUint32(0,  0x52494646, false); // "RIFF"
                dv.setUint32(4,  36 + int16Data.byteLength, false);
                dv.setUint32(8,  0x57415645, false); // "WAVE"
                dv.setUint32(12, 0x666D7420, false); // "fmt "
                dv.setUint32(16, 16,         false); // PCM chunk size
                dv.setUint16(20, 1,          false); // PCM format
                dv.setUint16(22, 1,          false); // mono
                dv.setUint32(24, sampleRate,           false); // ✅ sampleRate correto
                dv.setUint32(28, sampleRate * 2,       false); // byteRate
                dv.setUint16(32, 2,          false); // blockAlign
                dv.setUint16(34, 16,         false); // bitsPerSample
                dv.setUint32(36, 0x64617461, false); // "data"
                dv.setUint32(40, int16Data.byteLength, false);

                writeFileSync(tmpWav, Buffer.concat([header, Buffer.from(int16Data.buffer)]));

                const analyzerPy = path.join(__dirname, '..', '..', 'backend', 'ai', 'acoustics', 'sweep_analyzer.py');

                const result = await new Promise((resolve, reject) => {
                    // ✅ FIX 3: shell:true garante que paths com caracteres especiais são tratados
                    const py = spawn('python', [analyzerPy, tmpWav], {
                        cwd:   path.dirname(analyzerPy),
                        shell: true,
                    });

                    let stdout = '';
                    let stderr = '';

                    py.stdout.on('data', (d) => { stdout += d.toString(); });
                    py.stderr.on('data', (d) => { stderr += d.toString(); });

                    py.on('close', (code) => {
                        try { require('fs').unlinkSync(tmpWav); } catch (_) {}
                        if (code !== 0) {
                            reject(new Error(stderr || `Python exited with code ${code}`));
                        } else {
                            try {
                                resolve(JSON.parse(stdout));
                            } catch (e) {
                                reject(new Error(`JSON parse error: ${stdout}`));
                            }
                        }
                    });
                });

                socket.emit('sweep_analysis_result', result);

            } catch (error) {
                console.error('[SweepAnalyzer] Error:', error.message);
                socket.emit('sweep_analysis_result', { error: error.message });
            }
        });

        // --- Gerenciamento de Presets ---
        socket.on('save_preset', (data) => {
            const preset = {
                name: data.name || `Preset ${new Date().toLocaleString()}`,
                timestamp: Date.now(),
                state: JSON.parse(JSON.stringify(mixerSingleton.getState()))
            };
            db.presets.insert(preset, (err, doc) => {
                if (err) {
                    logger.error(socket.id, 'SAVE_PRESET_ERROR', { error: err.message });
                    socket.emit('mixer_status', { connected: true, msg: 'Erro ao salvar preset' });
                } else {
                    logger.info(socket.id, 'PRESET_SAVED', { name: preset.name });
                    socket.emit('preset_saved', doc);
                }
            });
        });

        socket.on('list_presets', () => {
            db.presets.find({}).sort({ timestamp: -1 }).exec((err, docs) => {
                if (!err) socket.emit('presets_list', docs);
            });
        });

        socket.on('load_preset', (id) => {
            if (!actions.ensureMixer(socket)) return;
            db.presets.findOne({ _id: id }, (err, doc) => {
                if (!err && doc) {
                    try {
                        logger.info(socket.id, 'LOAD_PRESET_START', { name: doc.name });
                        // Restaurar Master
                        if (doc.state.master) {
                            const mixer = mixerSingleton.getMixer();
                            mixer.master.setFaderLevel(doc.state.master.level);
                        }
                        
                        // Restaurar Canais (Exemplo: Volumes)
                        if (doc.state.inputs && Array.isArray(doc.state.inputs)) {
                            doc.state.inputs.forEach((inputState, idx) => {
                                const ch = idx + 1;
                                if (ch > 24) return; // Segurança: limite de canais
                                
                                const mixer = mixerSingleton.getMixer();
                                const input = mixer.input(ch);
                                if (!input) return;

                                // Restauração de Volume e Mute
                                if (inputState.level !== undefined) input.setFaderLevel(inputState.level);
                                if (inputState.mute !== undefined) {
                                    if (inputState.mute) input.mute(); else input.unmute();
                                }
                            });
                        }
                        
                        logger.info(socket.id, 'LOAD_PRESET_SUCCESS', { name: doc.name });
                        socket.emit('feedback_cut_success', { msg: `Preset "${doc.name}" carregado com sucesso!` });
                        socket.emit('mixer_log', `Preset "${doc.name}" aplicado.`);
                    } catch (e) {
                        logger.error(socket.id, 'LOAD_PRESET_ERROR', { name: doc.name, error: e.message });
                        socket.emit('mixer_status', { connected: true, msg: 'Erro ao aplicar preset: ' + e.message });
                    }
                }
            });
        });

        socket.on('undo_command', () => {
            const cmd = globalHistoryStack.pop();
            if (cmd) {
                globalRedoStack.push(cmd);
                socket.emit('mixer_log', 'Undo: Comando revertido (Simulado/Visual)');
            }
        });

        socket.on('send_raw_message', (data) => {
            try {
                const mixer = mixerSingleton.getMixer();
                if (!mixer) return;
                const message = String(data?.message || '').trim();
                const isAllowed = RAW_MESSAGE_PREFIX_WHITELIST.some(prefix => message.startsWith(prefix));
                if (!isAllowed) {
                    logger.warn(socket.id, 'RAW_MESSAGE_REJECTED', { message });
                    socket.emit('mixer_status', { connected: true, msg: 'Comando RAW rejeitado pela política de segurança.' });
                    return;
                }
                if (mixer.conn && typeof mixer.conn.sendMessage === 'function') {
                    mixer.conn.sendMessage(message);
                    logger.info(socket.id, 'RAW_MESSAGE_SENT', { message });
                    socket.emit('mixer_log', `RAW enviado: ${message}`);
                }
            } catch (error) {
                console.error('Erro ao enviar mensagem RAW:', error.message);
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
            const channel = Number(data?.channel) || 1;
            const group = data?.group || 'none';
            const weight = Number(data?.weight) || 0.5;
            const msg = actions.automixAssignChannel(channel, group, weight);
            socket.emit('mixer_log', msg);
        });

        socket.on('ping_mixer', () => {
            socket.emit('pong_mixer');
        });

        // ── Diagnóstico Preditivo de Hardware ─────────────────────────────────────
        socket.on('get_hardware_diagnosis', async (data = {}) => {
            const channel = data.channel || 'Canal 1';
            const months  = Math.max(1, Math.min(24, Number(data.months) || 6));

            try {
                // Busca snapshots do canal no NeDB (últimos 24 meses como tecto)
                const cutoffMs = Date.now() - months * 30 * 86400 * 1000;
                const docs = await new Promise((resolve, reject) => {
                    historyService.db.find(
                        { name: { $regex: new RegExp(channel, 'i') } }
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

                // Chama o motor Python
                const aiRes = await fetch(`http://127.0.0.1:${PYTHON_PORT}/hardware_diagnosis`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.AI_API_KEY || '' },
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

        socket.on('disconnect', () => {
            activeConnections--;
            // Comentário intencional: a conexão com a Ui24R permanece singleton no backend e não cai quando um cliente mobile sai.
            console.log(`[Socket] Frontend desconectado (${activeConnections} cliente(s) restante(s))`);
        });
    });
}

module.exports = { registerSocketHandlers };
