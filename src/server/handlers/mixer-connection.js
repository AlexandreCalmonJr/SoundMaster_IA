const { ConnectionStatus } = require('soundcraft-ui-connection');
const { createMixer, isSimulatedIp } = require('../mixers/mixer-factory');
const { encodeVuData, encodeMasterLevel, encodeMasterLevelDb, encodeChannelLevel } = require('../codecs/binary');

const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const connectSchema = require('zod').string().regex(ipRegex).or(require('zod').enum(['offline', 'simulado', '127.0.0.1']));

function registerMixerConnectionHandlers(io, socket, deps) {
    const { logger, mixerSingleton } = deps;

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

    socket.on('connect_mixer', async (data) => {
        logger.info(socket.id, 'CONNECT_MIXER_RAW_DATA', { data });
        try {
            let ip, brand;
            if (typeof data === 'string') {
                ip = data;
            } else if (typeof data === 'object' && data !== null) {
                ip = data.ip;
                brand = data.brand;
            } else {
                throw new Error('Dados de conexão inválidos');
            }

            const validatedIp = connectSchema.parse(ip);
            logger.info(socket.id, 'MIXER_CONNECT_ATTEMPT', { ip: validatedIp, brand });

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
                } catch (e) { console.warn('[MixerConnection] Erro ao desconectar mixer anterior:', e.message); }
                mixerSingleton.setMixer(null);
            }

            const newMixer = createMixer(validatedIp, { socket, mixerSingleton, brand });

            mixerSingleton.setMixer(newMixer);

            if (newMixer.isSimulated) {
                socket.emit('mixer_status', { connected: true, isSimulated: true, msg: 'Modo Simulado Ativo' });
                return;
            }

            newMixer.status$.subscribe(status => {
                const brandName = newMixer.brand === 'behringer' ? 'Behringer X32' : 'Soundcraft Ui24R';
                const statusMap = {
                    [ConnectionStatus.Open]:        { connected: true,  msg: `Conectado à ${brandName}!` },
                    [ConnectionStatus.Close]:       { connected: false, msg: 'Desconectado da mesa.' },
                    [ConnectionStatus.Error]:       { connected: false, msg: 'Erro na conexão com a mesa.' },
                    [ConnectionStatus.Reconnecting]:{ connected: false, msg: 'Reconectando...' }
                };
                const s = statusMap[status];
                if (s) {
                    socket.emit('mixer_status', s);
                } else if (status === 0 || status === 'open') {
                    socket.emit('mixer_status', { connected: true, msg: `Conectado à ${brandName}!` });
                } else if (status === 2 || status === 'error') {
                    socket.emit('mixer_status', { connected: false, msg: 'Erro na conexão com a mesa.' });
                }
            });

            await newMixer.connect();
            logger.info(socket.id, 'MIXER_CONNECT_COMMAND_SENT', { ip });

            if (!newMixer.master || typeof newMixer.master.input !== 'function') {
                throw new Error('Instância do Mixer incompleta pós-conexão. Verifique a acessibilidade da mesa.');
            }

            if (!newMixer.isSubscribed) {
                newMixer.isSubscribed = true;

                const safeSubscribe = (observable$, handler, description) => {
                    try {
                        if (observable$ && typeof observable$.subscribe === 'function') {
                            observable$.subscribe(handler);
                        } else {
                            logger.warn(socket.id, `OBSERVABLE_MISSING`, { desc: description });
                        }
                    } catch (err) {
                        logger.error(socket.id, `SUBSCRIBE_ERROR`, { desc: description, error: err.message });
                    }
                };

                safeSubscribe(newMixer.master.faderLevel$, level => {
                    mixerSingleton.updateMasterState({ level });
                    io.emit('master_level', encodeMasterLevel(level));
                }, 'master.faderLevel$');

                safeSubscribe(newMixer.master.faderLevelDB$, levelDb => {
                    mixerSingleton.updateMasterState({ levelDb });
                    io.emit('master_level_db', encodeMasterLevelDb(levelDb));
                }, 'master.faderLevelDB$');

                safeSubscribe(newMixer.master.pan$, pan => {
                    mixerSingleton.updateMasterState({ pan });
                    io.emit('master_pan', { pan });
                }, 'master.pan$');

                safeSubscribe(newMixer.master.dim$, dim => {
                    mixerSingleton.updateMasterState({ dim });
                    io.emit('master_dim', { dim });
                }, 'master.dim$');

                safeSubscribe(newMixer.master.delayL$, delayL => {
                    mixerSingleton.updateMasterState({ delayL });
                    io.emit('master_delay_l', { delayL });
                }, 'master.delayL$');

                safeSubscribe(newMixer.master.delayR$, delayR => {
                    mixerSingleton.updateMasterState({ delayR });
                    io.emit('master_delay_r', { delayR });
                }, 'master.delayR$');

                safeSubscribe(newMixer.master.name$, name => {
                    mixerSingleton.updateMasterState({ name });
                    io.emit('master_name', { name });
                }, 'master.name$');

                safeSubscribe(newMixer.vuProcessor.vuData$, vuData => {
                    const mapped = { master: null, channels: {} };
                    if (vuData['master']) mapped.master = vuData['master'];
                    for (let i = 1; i <= 24; i++) {
                        if (vuData[`i.${i-1}`]) mapped.channels[i] = vuData[`i.${i-1}`];
                    }
                    io.emit('vu_data', encodeVuData(mapped));
                }, 'vuProcessor.vuData$');

                safeSubscribe(newMixer.vuProcessor.master(), vuMaster => {
                    io.emit('vu_master_individual', vuMaster);
                }, 'vuProcessor.master()');

                for (let i = 1; i <= 24; i++) {
                    try {
                        const vuStream$ = newMixer.vuProcessor.input(i);
                        safeSubscribe(vuStream$, vuInput => {
                            io.emit(`vu_channel_${i}`, vuInput);
                        }, `vuProcessor.input(${i})`);
                    } catch (err) {
                        // Omissão silenciosa se o canal de VU não existir
                    }
                }

                safeSubscribe(newMixer.deviceInfo.firmware$, fw => io.emit('device_info', { firmware: fw }), 'deviceInfo.firmware$');

                let cachedModel = newMixer.brand === 'soundcraft' ? 'Soundcraft Ui' : undefined;
                safeSubscribe(newMixer.deviceInfo.model$, model => {
                    cachedModel = model;
                    io.emit('device_info', { model });
                }, 'deviceInfo.model$');

                safeSubscribe(newMixer.deviceInfo.capabilities$, caps => {
                    io.emit('device_info', {
                        model: cachedModel,
                        caps: { inputs: caps.inputChannels, aux: caps.auxBusses, fx: caps.fxChannels, sub: caps.subGroups, vca: caps.vcaGroups }
                    });
                }, 'deviceInfo.capabilities$');

                safeSubscribe(newMixer.automix.groups.a.state$, state => io.emit('automix_state', { group: 'a', enabled: !!state }), 'automix.groups.a.state$');
                safeSubscribe(newMixer.automix.groups.b.state$, state => io.emit('automix_state', { group: 'b', enabled: !!state }), 'automix.groups.b.state$');
                safeSubscribe(newMixer.automix.responseTimeMs$, ms => io.emit('automix_response_time', { ms }), 'automix.responseTimeMs$');

                safeSubscribe(newMixer.recorderDualTrack.recording$, isRec => io.emit('recorder_status', { recording: !!isRec, mtkRecording: false }), 'recorderDualTrack.recording$');
                safeSubscribe(newMixer.recorderMultiTrack.recording$, isMtkRec => io.emit('recorder_status', { recording: false, mtkRecording: !!isMtkRec }), 'recorderMultiTrack.recording$');

                safeSubscribe(newMixer.player.state$, state => io.emit('player_status', { state }), 'player.state$');
                safeSubscribe(newMixer.player.playlist$, playlist => io.emit('player_playlist', { playlist }), 'player.playlist$');
                safeSubscribe(newMixer.player.track$, track => io.emit('player_track', { track }), 'player.track$');
                safeSubscribe(newMixer.player.length$, length => io.emit('player_length', { length }), 'player.length$');
                safeSubscribe(newMixer.player.elapsedTime$, elapsed => io.emit('player_elapsed', { elapsed }), 'player.elapsedTime$');
                safeSubscribe(newMixer.player.remainingTime$, remaining => io.emit('player_remaining', { remaining }), 'player.remainingTime$');
                safeSubscribe(newMixer.player.shuffle$, shuffle => io.emit('player_shuffle', { shuffle: !!shuffle }), 'player.shuffle$');

                safeSubscribe(newMixer.shows.currentShow$, show => io.emit('show_status', { show }), 'shows.currentShow$');
                safeSubscribe(newMixer.shows.currentSnapshot$, snapshot => io.emit('snapshot_status', { snapshot }), 'shows.currentSnapshot$');
                safeSubscribe(newMixer.shows.currentCue$, cue => io.emit('cue_status', { cue }), 'shows.currentCue$');

                for (let i = 1; i <= 24; i++) {
                    try {
                        const input = newMixer.master.input(i);
                        if (input) {
                            safeSubscribe(input.name$, name => io.emit('channel_name_update', { channel: i, name }), `input(${i}).name$`);
                            safeSubscribe(input.faderLevel$, level => {
                                mixerSingleton.updateChannelState(i, { level });
                                io.emit('channel_level', encodeChannelLevel(i, level));
                            }, `input(${i}).faderLevel$`);
                            safeSubscribe(input.mute$, mute => {
                                mixerSingleton.updateChannelState(i, { mute });
                                io.emit('channel_mute', { channel: i, mute });
                            }, `input(${i}).mute$`);
                            safeSubscribe(input.solo$, solo => {
                                mixerSingleton.updateChannelState(i, { solo });
                                io.emit('channel_solo', { channel: i, solo });
                            }, `input(${i}).solo$`);
                            safeSubscribe(input.delay$, delay => {
                                mixerSingleton.updateChannelState(i, { delay });
                                io.emit('channel_delay_feedback', { channel: i, delay });
                            }, `input(${i}).delay$`);
                            safeSubscribe(input.automixGroup$, automixGroup => {
                                mixerSingleton.updateChannelState(i, { automixGroup });
                                io.emit('channel_automix_group', { channel: i, group: automixGroup });
                            }, `input(${i}).automixGroup$`);
                            safeSubscribe(input.automixWeight$, automixWeight => {
                                mixerSingleton.updateChannelState(i, { automixWeight });
                                io.emit('channel_automix_weight', { channel: i, weight: automixWeight });
                            }, `input(${i}).automixWeight$`);
                            safeSubscribe(input.automixWeightDB$, automixWeightDB => {
                                mixerSingleton.updateChannelState(i, { automixWeightDB });
                                io.emit('channel_automix_weight_db', { channel: i, weightDb: automixWeightDB });
                            }, `input(${i}).automixWeightDB$`);
                            safeSubscribe(input.multiTrackSelected$, multiTrackSelected => {
                                mixerSingleton.updateChannelState(i, { multiTrackSelected });
                                io.emit('channel_multitrack_selected', { channel: i, selected: !!multiTrackSelected });
                            }, `input(${i}).multiTrackSelected$`);
                        }
                    } catch (err) {
                        logger.warn(socket.id, `FALHA_OBTER_CANAL_${i}`, { error: err.message });
                    }
                }

                for (let f = 1; f <= 4; f++) {
                    try {
                        const fxBus = newMixer.fx(f);
                        if (fxBus) {
                            safeSubscribe(fxBus.fxType$, fxType => io.emit('fx_type', { fx: f, type: fxType }), `fx(${f}).fxType$`);
                            safeSubscribe(fxBus.bpm$, bpm => io.emit('fx_bpm_feedback', { fx: f, bpm }), `fx(${f}).bpm$`);
                            for (let p = 1; p <= 6; p++) {
                                safeSubscribe(fxBus.getParam(p), val => io.emit('fx_param_feedback', { fx: f, param: p, val }), `fx(${f}).getParam(${p})`);
                            }
                        }
                    } catch (err) {
                        logger.warn(socket.id, `FALHA_OBTER_FX_${f}`, { error: err.message });
                    }
                }

                for (let h = 1; h <= 24; h++) {
                    try {
                        const hw = newMixer.hw(h);
                        if (hw) {
                            safeSubscribe(hw.phantom$, phantom => io.emit('hw_phantom', { input: h, phantom: !!phantom }), `hw(${h}).phantom$`);
                            safeSubscribe(hw.gain$, gain => io.emit('hw_gain_feedback', { input: h, gain }), `hw(${h}).gain$`);
                            safeSubscribe(hw.gainDB$, gainDb => io.emit('hw_gain_db_feedback', { input: h, gainDb }), `hw(${h}).gainDB$`);
                        }
                    } catch (err) {
                        // Omissão silenciosa
                    }
                }

                ['all', '1', '2', '3', '4', 'fx'].forEach(groupId => {
                    try {
                        const mg = newMixer.muteGroup(groupId);
                        safeSubscribe(mg.state$, state => io.emit('mute_group_state', { groupId, enabled: !!state }), `muteGroup(${groupId}).state$`);
                    } catch (err) {
                        logger.warn(socket.id, `FALHA_OBTER_MUTEGROUP_${groupId}`, { error: err.message });
                    }
                });

                safeSubscribe(newMixer.channelSync.getSelectedChannel('SYNC_ID'), selection => {
                    io.emit('channel_selected_external', selection);
                }, 'channelSync.getSelectedChannel');
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
            logger.info(socket.id, 'MIXER_DISCONNECTED');
            io.emit('mixer_status', { connected: false, msg: 'Desconectado.' });
        }
    });


}

module.exports = { registerMixerConnectionHandlers };