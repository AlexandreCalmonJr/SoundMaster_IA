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

                safeSubscribe(newMixer.vuProcessor.vuData$, vuData => {
                    const mapped = { master: null, channels: {} };
                    if (vuData['master']) mapped.master = vuData['master'];
                    for (let i = 1; i <= 24; i++) {
                        if (vuData[`i.${i-1}`]) mapped.channels[i] = vuData[`i.${i-1}`];
                    }
                    io.emit('vu_data', encodeVuData(mapped));
                }, 'vuProcessor.vuData$');

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
                safeSubscribe(newMixer.player.track$, track => io.emit('player_track', { track }), 'player.track$');

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
                        }
                    } catch (err) {
                        logger.warn(socket.id, `FALHA_OBTER_CANAL_${i}`, { error: err.message });
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