const { SoundcraftUI, ConnectionStatus } = require('soundcraft-ui-connection');

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

    socket.on('connect_mixer', async (ip) => {
        try {
            const validatedIp = connectSchema.parse(ip);
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
                } catch (e) { console.warn('[MixerConnection] Erro ao desconectar mixer anterior:', e.message); }
                mixerSingleton.setMixer(null);
            }

            const newMixer = validatedIp === 'offline' || validatedIp === 'simulado' || validatedIp === '127.0.0.1'
                ? buildSimulatedMixer(socket)
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
            logger.info(socket.id, 'MIXER_DISCONNECTED');
            io.emit('mixer_status', { connected: false, msg: 'Desconectado.' });
        }
    });

    function buildSimulatedMixer(socket) {
        return {
            isSimulated: true,
            targetIp: 'simulado',
            conn: { sendMessage: (msg) => socket.emit('mixer_log', `RAW: ${msg}`) },
            master: {
                faderLevel$: { subscribe: () => {} },
                faderLevelDB$: { subscribe: () => {} },
                setFaderLevel: (v) => socket.emit('mixer_log', `[Sim] Master Fader -> ${Math.round(v*100)}%`),
                changeFaderLevelDB: (v) => socket.emit('mixer_log', `[Sim] Master Fader -> ${v}dB`),
                mute: () => socket.emit('mixer_log', '[Sim] Master MUTADO'),
                unmute: () => socket.emit('mixer_log', '[Sim] Master ATIVADO'),
                fadeTo: (v, ms) => socket.emit('mixer_log', `[Sim] Master Fade -> ${Math.round(v*100)}% em ${ms}ms`),
                eq: () => ({ band: () => ({ setFreq: () => {}, setGain: () => {}, setQ: () => {}, setType: () => {} }) }),
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
                changeFaderLevelDB: (d) => socket.emit('mixer_log', `[Sim] Canal ${id} Volume -> ${d}dB`),
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
                gate: () => ({ enable: () => {}, disable: () => {}, setThreshold: () => {} }),
                compressor: () => ({ enable: () => {}, setRatio: () => {}, setThreshold: () => {}, setAttack: () => {}, setRelease: () => {} }),
                aux: () => ({ setFaderLevel: () => {}, setPost: () => {}, setPostProc: () => {}, setPan: () => {} }),
                fx: () => ({ setFaderLevel: () => {}, setPost: () => {} }),
                faderLevel$: { subscribe: () => {} },
                mute$: { subscribe: () => {} },
                name$: { subscribe: () => {} }
            }),
            aux: (id) => ({ setDelay: (ms) => socket.emit('mixer_log', `[Sim] Aux ${id} Delay -> ${ms}ms`) }),
            hw: (id) => ({
                setGain: (v) => socket.emit('mixer_log', `[Sim] HW ${id} Gain -> ${v}`),
                phantomOn: () => socket.emit('mixer_log', `[Sim] HW ${id} Phantom ON`),
                phantomOff: () => socket.emit('mixer_log', `[Sim] HW ${id} Phantom OFF`),
                oscillator: () => ({ enable: () => {}, disable: () => {}, setType: () => {}, setFaderLevel: () => {} })
            }),
            recorderDualTrack: { recording$: { subscribe: () => {} } },
            recorderMultiTrack: { recording$: { subscribe: () => {} } },
            automix: { groups: { a: { state$: { subscribe: () => {} } }, b: { state$: { subscribe: () => {} } } }, responseTimeMs$: { subscribe: () => {} } },
            deviceInfo: { firmware$: { subscribe: () => {} }, capabilities$: { subscribe: () => {} } },
            shows: { currentShow$: { subscribe: () => {} }, currentSnapshot$: { subscribe: () => {} }, currentCue$: { subscribe: () => {} } },
            vuProcessor: { vuData$: { subscribe: () => {} } },
            channelSync: { getSelectedChannel: () => ({ subscribe: () => {} }), selectChannel: () => {} },
            player: { state$: { subscribe: () => {} }, track$: { subscribe: () => {} }, play: () => {}, pause: () => {}, stop: () => {}, next: () => {}, prev: () => {}, setShuffle: () => {}, setAuto: () => {}, setManual: () => {}, loadPlaylist: () => {} },
            muteGroup: () => ({ state$: { subscribe: () => {} }, mute: () => {}, unmute: () => {} }),
            clearMuteGroups: () => {},
            volume: { solo: { setFaderLevel: () => {} }, headphone: () => ({ setFaderLevel: () => {} }) },
            fx: () => ({ setBpm: () => {}, setParam: () => {} }),
            disconnect: () => { mixerSingleton.setMixer(null); },
            connect: async () => {}
        };
    }
}

module.exports = { registerMixerConnectionHandlers };