function buildSimulatedMixer(socket, mixerSingleton) {
    const log = (msg) => {
        if (socket) socket.emit('mixer_log', msg);
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
            setPan: (v) => log(`[Sim] Master Pan -> ${v}`),
            changePan: (v) => log(`[Sim] Master Pan relativo -> ${v}`),
            setDelayL: (ms) => log(`[Sim] Master Delay L -> ${ms}ms`),
            setDelayR: (ms) => log(`[Sim] Master Delay R -> ${ms}ms`),
            changeDelayL: (ms) => log(`[Sim] Master Delay L relativo -> ${ms}ms`),
            changeDelayR: (ms) => log(`[Sim] Master Delay R relativo -> ${ms}ms`),
            input: (id) => ({
                setFaderLevel: (v) => log(`[Sim] Canal ${id} Fader -> ${Math.round(v * 100)}%`),
                mute: () => log(`[Sim] Canal ${id} MUTADO`),
                unmute: () => log(`[Sim] Canal ${id} ATIVADO`),
                setPan: (v) => log(`[Sim] Canal ${id} Pan -> ${v}`),
                changePan: (v) => log(`[Sim] Canal ${id} Pan relativo -> ${v}`),
                toggleSolo: () => log(`[Sim] Canal ${id} SOLO alternado`),
                setDelay: (ms) => log(`[Sim] Canal ${id} Delay -> ${ms}ms`),
                fadeTo: (v, ms) => log(`[Sim] Canal ${id} Fade -> ${Math.round(v * 100)}% em ${ms}ms`),
                fadeToDB: (v, ms) => log(`[Sim] Canal ${id} Fade -> ${v}dB em ${ms}ms`),
                setName: (name) => log(`[Sim] Canal ${id} Nome -> ${name}`),
                multiTrackSelect: () => log(`[Sim] Canal ${id} adicionado ao MTK`),
                multiTrackUnselect: () => log(`[Sim] Canal ${id} removido do MTK`),
                automixAssignGroup: (group) => log(`[Sim] Canal ${id} Automix -> ${group}`),
                automixSetWeight: (weight) => log(`[Sim] Canal ${id} Peso Automix -> ${weight}`),
                changeFaderLevelDB: (d) => log(`[Sim] Canal ${id} Volume -> ${d}dB`),
                setFaderLevelDB: (d) => log(`[Sim] Canal ${id} Volume -> ${d}dB`),
                changeFaderLevel: (v) => log(`[Sim] Canal ${id} Fader relativo -> ${v}`),
                eq: () => ({
                    setHpfFreq: (f) => log(`[Sim] Canal ${id} HPF -> ${f}Hz`),
                    setHpfSlope: (s) => log(`[Sim] Canal ${id} HPF Slope -> ${s}`),
                    band: (b) => ({
                        setFreq: (f) => log(`[Sim] Canal ${id} EQ B${b} Freq -> ${f}Hz`),
                        setGain: (g) => log(`[Sim] Canal ${id} EQ B${b} Gain -> ${g}dB`),
                        setQ: (q) => log(`[Sim] Canal ${id} EQ B${b} Q -> ${q}`),
                        setType: (t) => log(`[Sim] Canal ${id} EQ B${b} Type -> ${t}`)
                    })
                }),
                gate: () => ({ enable: () => {}, disable: () => {}, setThreshold: () => {} }),
                compressor: () => ({ enable: () => {}, setRatio: () => {}, setThreshold: () => {}, setAttack: () => {}, setRelease: () => {} }),
                aux: () => ({ setFaderLevel: () => {}, setPost: () => {}, setPostProc: () => {}, setPan: () => {} }),
                fx: () => ({ setFaderLevel: () => {}, setPost: () => {} }),
                faderLevel$: { subscribe: () => {} },
                mute$: { subscribe: () => {} },
                name$: { subscribe: () => {} }
            })
        },

        aux: (id) => ({ setDelay: (ms) => log(`[Sim] Aux ${id} Delay -> ${ms}ms`) }),
        hw: (id) => ({
            setGain: (v) => log(`[Sim] HW ${id} Gain -> ${v}`),
            phantomOn: () => log(`[Sim] HW ${id} Phantom ON`),
            phantomOff: () => log(`[Sim] HW ${id} Phantom OFF`),
            oscillator: () => ({ enable: () => {}, disable: () => {}, setType: () => {}, setFaderLevel: () => {} })
        }),
        recorderDualTrack: { recording$: { subscribe: () => {} } },
        recorderMultiTrack: {
            recording$: { subscribe: () => {} },
            recordStart: () => log('[Sim] MTK Record Start'),
            recordStop: () => log('[Sim] MTK Record Stop'),
            recordToggle: () => log('[Sim] MTK Record Toggle'),
            play: () => log('[Sim] MTK Play'),
            pause: () => log('[Sim] MTK Pause'),
            activateSoundcheck: () => log('[Sim] Soundcheck ON'),
            deactivateSoundcheck: () => log('[Sim] Soundcheck OFF'),
            toggleSoundcheck: () => log('[Sim] Soundcheck Toggle')
        },
        automix: { groups: { a: { state$: { subscribe: () => {} } }, b: { state$: { subscribe: () => {} } } }, responseTimeMs$: { subscribe: () => {} } },
        deviceInfo: { model$: { subscribe: () => {} }, firmware$: { subscribe: () => {} }, capabilities$: { subscribe: () => {} } },
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
        vuProcessor: { vuData$: { subscribe: () => {} } },
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
        volume: { solo: { setFaderLevel: () => {} }, headphone: () => ({ setFaderLevel: () => {} }) },
        fx: () => ({ setBpm: () => {}, setParam: () => {} }),
        disconnect: () => { if (mixerSingleton) mixerSingleton.setMixer(null); },
        connect: async () => {}
    };
}

module.exports = { buildSimulatedMixer };
