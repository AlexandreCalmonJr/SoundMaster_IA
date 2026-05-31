function buildSimulatedMixer(socket, mixerSingleton) {
    return {
        brand: 'simulated',
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
            setDelayR: (ms) => socket.emit('mixer_log', `[Sim] Master Delay R -> ${ms}ms`),
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
            })
        },

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
        deviceInfo: { model$: { subscribe: () => {} }, firmware$: { subscribe: () => {} }, capabilities$: { subscribe: () => {} } },
        shows: { currentShow$: { subscribe: () => {} }, currentSnapshot$: { subscribe: () => {} }, currentCue$: { subscribe: () => {} } },
        vuProcessor: { vuData$: { subscribe: () => {} } },
        channelSync: { getSelectedChannel: () => ({ subscribe: () => {} }), selectChannel: () => {} },
        player: { state$: { subscribe: () => {} }, track$: { subscribe: () => {} }, play: () => {}, pause: () => {}, stop: () => {}, next: () => {}, prev: () => {}, setShuffle: () => {}, setAuto: () => {}, setManual: () => {}, loadPlaylist: () => {} },
        muteGroup: () => ({ state$: { subscribe: () => {} }, mute: () => {}, unmute: () => {} }),
        clearMuteGroups: () => {},
        volume: { solo: { setFaderLevel: () => {} }, headphone: () => ({ setFaderLevel: () => {} }) },
        fx: () => ({ setBpm: () => {}, setParam: () => {} }),
        disconnect: () => { if (mixerSingleton) mixerSingleton.setMixer(null); },
        connect: async () => {}
    };
}

module.exports = { buildSimulatedMixer };
