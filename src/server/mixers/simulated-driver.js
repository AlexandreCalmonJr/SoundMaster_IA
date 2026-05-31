function buildSimulatedMixer(socket, mixerSingleton) {
    const log = (msg) => {
        if (socket) socket.emit('mixer_log', msg);
    };

    const mockChannel = (type, id) => {
        const displayName = type === 'input' ? 'Canal' : type;
        return {
            setFaderLevel: (v) => log(`[Sim] ${displayName} ${id} Fader -> ${Math.round(v * 100)}%`),
            mute: () => log(`[Sim] ${displayName} ${id} MUTADO`),
            unmute: () => log(`[Sim] ${displayName} ${id} ATIVADO`),
            setPan: (v) => log(`[Sim] ${displayName} ${id} Pan -> ${v}`),
            changePan: (v) => log(`[Sim] ${displayName} ${id} Pan relativo -> ${v}`),
            toggleSolo: () => log(`[Sim] ${displayName} ${id} SOLO alternado`),
            setDelay: (ms) => log(`[Sim] ${displayName} ${id} Delay -> ${ms}ms`),
            fadeTo: (v, ms) => log(`[Sim] ${displayName} ${id} Fade -> ${Math.round(v * 100)}% em ${ms}ms`),
            fadeToDB: (v, ms) => log(`[Sim] ${displayName} ${id} Fade -> ${v}dB em ${ms}ms`),
            setName: (name) => log(`[Sim] ${displayName} ${id} Nome -> ${name}`),
            multiTrackSelect: () => log(`[Sim] ${displayName} ${id} adicionado ao MTK`),
            multiTrackUnselect: () => log(`[Sim] ${displayName} ${id} removido do MTK`),
            automixAssignGroup: (group) => log(`[Sim] ${displayName} ${id} Automix -> ${group}`),
            automixSetWeight: (weight) => log(`[Sim] ${displayName} ${id} Peso Automix -> ${weight}`),
            changeFaderLevelDB: (d) => log(`[Sim] ${displayName} ${id} Volume -> ${d}dB`),
            setFaderLevelDB: (d) => log(`[Sim] ${displayName} ${id} Volume -> ${d}dB`),
            changeFaderLevel: (v) => log(`[Sim] ${displayName} ${id} Fader relativo -> ${v}`),
            eq: () => ({
                setHpfFreq: (f) => log(`[Sim] ${displayName} ${id} HPF -> ${f}Hz`),
                setHpfSlope: (s) => log(`[Sim] ${displayName} ${id} HPF Slope -> ${s}`),
                band: (b) => ({
                    setFreq: (f) => log(`[Sim] ${displayName} ${id} EQ B${b} Freq -> ${f}Hz`),
                    setGain: (g) => log(`[Sim] ${displayName} ${id} EQ B${b} Gain -> ${g}dB`),
                    setQ: (q) => log(`[Sim] ${displayName} ${id} EQ B${b} Q -> ${q}`),
                    setType: (t) => log(`[Sim] ${displayName} ${id} EQ B${b} Type -> ${t}`),
                    type$: { subscribe: () => {} }
                })
            }),
            gate: () => ({ enable: () => {}, disable: () => {}, setThreshold: () => {} }),
            compressor: () => ({ enable: () => {}, setRatio: () => {}, setThreshold: () => {}, setAttack: () => {}, setRelease: () => {} }),
            aux: () => ({ setFaderLevel: () => {}, setPost: () => {}, setPostProc: () => {}, setPan: () => {} }),
            fx: () => ({ setFaderLevel: () => {}, setPost: () => {} }),
            faderLevel$: { subscribe: () => {} },
            mute$: { subscribe: () => {} },
            solo$: { subscribe: () => {} },
            pan$: { subscribe: () => {} },
            name$: { subscribe: () => {} }
        };
    };

    return {
        brand: 'simulated',
        isSimulated: true,
        targetIp: 'simulado',
        conn: { sendMessage: (msg) => log(`RAW: ${msg}`) },
        master: {
            faderLevel$: { subscribe: () => {} },
            faderLevelDB$: { subscribe: () => {} },
            setFaderLevel: (v) => log(`[Sim] Master Fader -> ${Math.round(v*100)}%`),
            changeFaderLevelDB: (v) => log(`[Sim] Master Fader -> ${v}dB`),
            setFaderLevelDB: (v) => log(`[Sim] Master Fader -> ${v}dB`),
            changeFaderLevel: (v) => log(`[Sim] Master Fader relativo -> ${v}`),
            mute: () => log('[Sim] Master MUTADO'),
            unmute: () => log('[Sim] Master ATIVADO'),
            fadeTo: (v, ms) => log(`[Sim] Master Fade -> ${Math.round(v*100)}% em ${ms}ms`),
            fadeToDB: (v, ms) => log(`[Sim] Master Fade -> ${v}dB em ${ms}ms`),
            toggleDim: () => log('[Sim] Master Dim alternado'),
            dim: () => log('[Sim] Master Dim ativado'),
            undim: () => log('[Sim] Master Dim desativado'),
            setDim: (val) => log(`[Sim] Master Dim -> ${val}`),
            setPan: (v) => log(`[Sim] Master Pan -> ${v}`),
            changePan: (v) => log(`[Sim] Master Pan relativo -> ${v}`),
            setDelayL: (ms) => log(`[Sim] Master Delay L -> ${ms}ms`),
            setDelayR: (ms) => log(`[Sim] Master Delay R -> ${ms}ms`),
            changeDelayL: (ms) => log(`[Sim] Master Delay L relativo -> ${ms}ms`),
            changeDelayR: (ms) => log(`[Sim] Master Delay R relativo -> ${ms}ms`),
            input: (id) => mockChannel('input', id),
            line: (id) => mockChannel('line', id),
            player: (id) => mockChannel('player', id),
            aux: (id) => mockChannel('aux', id),
            fx: (id) => mockChannel('fx', id),
            sub: (id) => mockChannel('sub', id),
            vca: (id) => mockChannel('vca', id)
        },

        aux: (id) => {
            const mockSend = () => ({
                post$: { subscribe: () => {} },
                setPost: () => {},
                post: () => {},
                pre: () => {},
                togglePost: () => {},
                setFaderLevel: () => {},
                setPan: () => {}
            });
            return {
                setDelay: (ms) => log(`[Sim] Aux ${id} Delay -> ${ms}ms`),
                input: (ch) => mockSend(),
                line: (ch) => mockSend(),
                player: (ch) => mockSend(),
                fx: (ch) => mockSend()
            };
        },
        hw: (id) => ({
            setGain: (v) => log(`[Sim] HW ${id} Gain -> ${v}`),
            setGainDB: (v) => log(`[Sim] HW ${id} Gain -> ${v}dB`),
            changeGain: (offset) => log(`[Sim] HW ${id} Gain Offset -> ${offset}`),
            changeGainDB: (offsetDb) => log(`[Sim] HW ${id} Gain Offset -> ${offsetDb}dB`),
            phantomOn: () => log(`[Sim] HW ${id} Phantom ON`),
            phantomOff: () => log(`[Sim] HW ${id} Phantom OFF`),
            togglePhantom: () => log(`[Sim] HW ${id} Phantom alternado`),
            oscillator: () => ({ enable: () => {}, disable: () => {}, setType: () => {}, setFaderLevel: () => {} })
        }),
        recorderDualTrack: { recording$: { subscribe: () => {} }, busy$: { subscribe: () => {} } },
        recorderMultiTrack: {
            recording$: { subscribe: () => {} },
            busy$: { subscribe: () => {} },
            state$: { subscribe: () => {} },
            session$: { subscribe: () => {} },
            soundcheck$: { subscribe: () => {} },
            length$: { subscribe: () => {} },
            elapsedTime$: { subscribe: () => {} },
            remainingTime$: { subscribe: () => {} },
            recordingTime$: { subscribe: () => {} },
            recordStart: () => log('[Sim] MTK Record Start'),
            recordStop: () => log('[Sim] MTK Record Stop'),
            recordToggle: () => log('[Sim] MTK Record Toggle'),
            play: () => log('[Sim] MTK Play'),
            pause: () => log('[Sim] MTK Pause'),
            stop: () => log('[Sim] MTK Playback Stop'),
            activateSoundcheck: () => log('[Sim] Soundcheck ON'),
            deactivateSoundcheck: () => log('[Sim] Soundcheck OFF'),
            toggleSoundcheck: () => log('[Sim] Soundcheck Toggle')
        },
        automix: {
            groups: {
                a: {
                    state$: { subscribe: () => {} },
                    enable: () => log('[Sim] Automix Grupo A Ativado'),
                    disable: () => log('[Sim] Automix Grupo A Desativado'),
                    toggle: () => log('[Sim] Automix Grupo A Alternado')
                },
                b: {
                    state$: { subscribe: () => {} },
                    enable: () => log('[Sim] Automix Grupo B Ativado'),
                    disable: () => log('[Sim] Automix Grupo B Desativado'),
                    toggle: () => log('[Sim] Automix Grupo B Alternado')
                }
            },
            responseTimeMs$: { subscribe: () => {} },
            responseTime$: { subscribe: () => {} },
            setResponseTime: (v) => log(`[Sim] Automix Response Time -> ${v}`),
            setResponseTimeMs: (ms) => log(`[Sim] Automix Response Time Ms -> ${ms}`)
        },
        deviceInfo: {
            model: 'Soundcraft Ui (Simulada)',
            model$: { subscribe: () => {} },
            firmware$: { subscribe: () => {} },
            capabilities$: { subscribe: () => {} }
        },
        shows: {
            currentShow$: { subscribe: () => {} },
            currentSnapshot$: { subscribe: () => {} },
            currentCue$: { subscribe: () => {} },
            loadShow: (name) => log(`[Sim] Load Show ${name}`),
            loadSnapshot: (show, snap) => log(`[Sim] Load Snapshot ${snap} do Show ${show}`),
            loadCue: (show, cue) => log(`[Sim] Load Cue ${cue} do Show ${show}`),
            saveSnapshot: (show, snap) => log(`[Sim] Save Snapshot ${snap} do Show ${show}`),
            saveCue: (show, cue) => log(`[Sim] Save Cue ${cue} do Show ${show}`),
            updateCurrentSnapshot: () => log('[Sim] Update Current Snapshot'),
            updateCurrentCue: () => log('[Sim] Update Current Cue')
        },
        vuProcessor: {
            vuData$: { subscribe: () => {} },
            input: (id) => ({ subscribe: () => {} }),
            line: (id) => ({ subscribe: () => {} }),
            player: (id) => ({ subscribe: () => {} }),
            aux: (id) => ({ subscribe: () => {} }),
            fx: (id) => ({ subscribe: () => {} }),
            sub: (id) => ({ subscribe: () => {} }),
            master: () => ({ subscribe: () => {} })
        },
        channelSync: { getSelectedChannel: () => ({ subscribe: () => {} }), selectChannel: () => {} },
        player: {
            state$: { subscribe: () => {} },
            track$: { subscribe: () => {} },
            play: () => log('[Sim] Player Play'),
            pause: () => log('[Sim] Player Pause'),
            stop: () => log('[Sim] Player Stop'),
            next: () => log('[Sim] Player Next'),
            prev: () => log('[Sim] Player Prev'),
            setShuffle: (v) => log(`[Sim] Player Shuffle -> ${v}`),
            toggleShuffle: () => log('[Sim] Player Toggle Shuffle'),
            setAuto: () => log('[Sim] Player Auto Mode'),
            setManual: () => log('[Sim] Player Manual Mode'),
            setPlayMode: (mode) => log(`[Sim] Player Play Mode -> ${mode}`),
            loadPlaylist: (playlist) => log(`[Sim] Load Playlist ${playlist}`),
            loadTrack: (playlist, track) => log(`[Sim] Load Track ${track} da Playlist ${playlist}`)
        },
        muteGroup: (groupId) => ({
            state$: { subscribe: () => {} },
            mute: () => log(`[Sim] Mute Group ${groupId} MUTADO`),
            unmute: () => log(`[Sim] Mute Group ${groupId} ATIVADO`),
            toggle: () => log(`[Sim] Mute Group ${groupId} alternado`)
        }),
        clearMuteGroups: () => log('[Sim] Todos Mute Groups limpos'),
        volume: {
            solo: { faderLevel$: { subscribe: () => {} }, setFaderLevel: () => {} },
            headphone: (hpId) => ({ faderLevel$: { subscribe: () => {} }, setFaderLevel: () => {} })
        },
        fx: (id) => {
            const mockSend = () => ({
                post$: { subscribe: () => {} },
                setPost: () => {},
                post: () => {},
                pre: () => {},
                togglePost: () => {},
                setFaderLevel: () => {}
            });
            return {
                setBpm: (val) => log(`[Sim] FX ${id} BPM -> ${val}`),
                setParam: (p, val) => log(`[Sim] FX ${id} Param ${p} -> ${val}`),
                getParam: (p) => ({ subscribe: () => {} }),
                fxType$: { subscribe: () => {} },
                bpm$: { subscribe: () => {} },
                input: (ch) => mockSend(),
                line: (ch) => mockSend(),
                player: (ch) => mockSend(),
                sub: (ch) => mockSend()
            };
        },
        disconnect: () => { if (mixerSingleton) mixerSingleton.setMixer(null); },
        connect: async () => {}
    };
}

module.exports = { buildSimulatedMixer };
