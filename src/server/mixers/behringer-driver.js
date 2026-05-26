const OSC = require('osc');
const EventEmitter = require('events');

const X32_PORT = 10023;

class BehringerChannel {
    constructor(driver, index) {
        this._driver = driver;
        this._idx = index;
        this._addr = `/ch/${String(index).padStart(2, '0')}`;
        this._events = new EventEmitter();
        this._faderLevel$ = { subscribe: (cb) => { this._events.on('faderLevel', cb); return { unsubscribe: () => {} }; } };
        this._mute$ = { subscribe: (cb) => { this._events.on('mute', cb); return { unsubscribe: () => {} }; } };
        this._name$ = { subscribe: (cb) => { this._events.on('name', cb); return { unsubscribe: () => {} }; } };
    }

    get faderLevel$() { return this._faderLevel$; }
    get mute$() { return this._mute$; }
    get name$() { return this._name$; }

    setFaderLevel(v) { this._driver._send(`${this._addr}/mix/fader`, 'f', v); }
    mute() { this._driver._send(`${this._addr}/mix/on`, 'f', 0); }
    unmute() { this._driver._send(`${this._addr}/mix/on`, 'f', 1); }
    setPan(v) { this._driver._send(`${this._addr}/mix/pan`, 'f', v); }
    toggleSolo() { this._driver._send(`${this._addr}/mix/solo`, 'f', 1); }
    setDelay(ms) { this._driver._send(`${this._addr}/mix/delay`, 'f', ms); }
    fadeTo(v, ms) {
        const steps = 20;
        const interval = ms / steps;
        const start = 0.5;
        const diff = v - start;
        let step = 0;
        const iv = setInterval(() => {
            step++;
            this.setFaderLevel(start + diff * (step / steps));
            if (step >= steps) clearInterval(iv);
        }, interval);
    }
    setName(name) { this._driver._send(`${this._addr}/config/name`, 's', name); }
    changeFaderLevelDB(d) {
        const dbToFloat = (db) => Math.pow(10, db / 20);
        this.setFaderLevel(dbToFloat(d));
    }

    eq() {
        return {
            setHpfFreq: (f) => this._driver._send(`${this._addr}/hp/frequency`, 'f', f),
            setHpfSlope: (s) => this._driver._send(`${this._addr}/hp/slope`, 'f', s),
            band: (b) => ({
                setFreq: (f) => this._driver._send(`${this._addr}/eq/${b}/f`, 'f', f),
                setGain: (g) => this._driver._send(`${this._addr}/eq/${b}/g`, 'f', g),
                setQ: (q) => this._driver._send(`${this._addr}/eq/${b}/q`, 'f', q),
                setType: (t) => this._driver._send(`${this._addr}/eq/${b}/type`, 'f', t)
            })
        };
    }

    gate() {
        return {
            enable: () => this._driver._send(`${this._addr}/gate/on`, 'f', 1),
            disable: () => this._driver._send(`${this._addr}/gate/on`, 'f', 0),
            setThreshold: (t) => this._driver._send(`${this._addr}/gate/thr`, 'f', t)
        };
    }

    compressor() {
        return {
            enable: () => this._driver._send(`${this._addr}/comp/on`, 'f', 1),
            setRatio: (r) => this._driver._send(`${this._addr}/comp/ratio`, 'f', r),
            setThreshold: (t) => this._driver._send(`${this._addr}/comp/thr`, 'f', t),
            setAttack: (a) => this._driver._send(`${this._addr}/comp/attack`, 'f', a),
            setRelease: (r) => this._driver._send(`${this._addr}/comp/release`, 'f', r)
        };
    }

    aux(id) {
        return {
            setFaderLevel: (v) => this._driver._send(`${this._addr}/mix/${id}/fader`, 'f', v),
            setPost: () => {},
            setPostProc: () => {},
            setPan: (v) => this._driver._send(`${this._addr}/mix/${id}/pan`, 'f', v)
        };
    }

    fx(id) {
        return {
            setFaderLevel: (v) => this._driver._send(`${this._addr}/mix/${id}/fader`, 'f', v),
            setPost: () => {}
        };
    }

    multiTrackSelect() {}
    multiTrackUnselect() {}
    automixAssignGroup(g) {}
    automixSetWeight(w) {}
}

class BehringerMaster {
    constructor(driver) {
        this._driver = driver;
        this._events = new EventEmitter();
        this._faderLevel$ = { subscribe: (cb) => { this._events.on('faderLevel', cb); return { unsubscribe: () => {} }; } };
        this._faderLevelDB$ = { subscribe: (cb) => { this._events.on('faderLevelDB', cb); return { unsubscribe: () => {} }; } };
    }

    get faderLevel$() { return this._faderLevel$; }
    get faderLevelDB$() { return this._faderLevelDB$; }

    setFaderLevel(v) { this._driver._send('/lr/mix/fader', 'f', v); }
    changeFaderLevelDB(v) {
        const dbToFloat = (db) => Math.pow(10, db / 20);
        this.setFaderLevel(dbToFloat(v));
    }
    mute() { this._driver._send('/lr/mix/on', 'f', 0); }
    unmute() { this._driver._send('/lr/mix/on', 'f', 1); }
    fadeTo(v, ms) { this.setFaderLevel(v); }
    toggleDim() {}
    setPan(v) { this._driver._send('/lr/mix/pan', 'f', v); }
    setDelayL(ms) { this._driver._send('/lr/delay/fb', 'f', ms); }
    setDelayR(ms) { this._driver._send('/lr/delay/fb', 'f', ms); }

    eq() {
        return {
            band: (b) => ({
                setFreq: (f) => this._driver._send(`/lr/eq/${b}/f`, 'f', f),
                setGain: (g) => this._driver._send(`/lr/eq/${b}/g`, 'f', g),
                setQ: (q) => this._driver._send(`/lr/eq/${b}/q`, 'f', q),
                setType: (t) => this._driver._send(`/lr/eq/${b}/type`, 'f', t)
            })
        };
    }

    afs() { return { enable: () => {}, disable: () => {} }; }
}

function buildBehringerMixer(ip, options) {
    const { socket, mixerSingleton } = options;
    const driverEvents = new EventEmitter();

    const driver = {
        brand: 'behringer',
        model: 'X32',
        isSimulated: false,
        isSubscribed: false,
        targetIp: ip,
        conn: { sendMessage: (msg) => {} },
        _send: null,
        _client: null,
        _inputCache: {},
        _master: null,

        get status$() {
            return { subscribe: (cb) => { driverEvents.on('status', cb); return { unsubscribe: () => driverEvents.removeListener('status', cb) }; } };
        },

        get master() {
            if (!this._master) this._master = new BehringerMaster(this);
            return this._master;
        },

        input(ch) {
            if (!this._inputCache[ch]) this._inputCache[ch] = new BehringerChannel(this, ch);
            return this._inputCache[ch];
        },

        hw(ch) {
            return {
                setGain: (v) => this._send(`/headamp/${String(ch).padStart(2, '0')}/gain`, 'f', v),
                phantomOn: () => this._send(`/headamp/${String(ch).padStart(2, '0')}/phantom`, 'f', 1),
                phantomOff: () => this._send(`/headamp/${String(ch).padStart(2, '0')}/phantom`, 'f', 0),
                oscillator: () => ({ enable: () => {}, disable: () => {}, setType: () => {}, setFaderLevel: () => {} })
            };
        },

        aux(id) {
            return {
                setDelay: (ms) => this._send(`/aux/${id}/mix/delay`, 'f', ms)
            };
        },

        fx(id) {
            return {
                setBpm: (bpm) => {},
                setParam: (p, v) => {}
            };
        },

        recorderDualTrack: { recording$: { subscribe: () => {} } },
        recorderMultiTrack: { recording$: { subscribe: () => {} } },

        automix: {
            groups: {
                a: { state$: { subscribe: () => {} } },
                b: { state$: { subscribe: () => {} } }
            },
            responseTimeMs$: { subscribe: () => {} }
        },

        deviceInfo: {
            firmware$: { subscribe: () => {} },
            capabilities$: { subscribe: () => {} }
        },

        shows: {
            currentShow$: { subscribe: () => {} },
            currentSnapshot$: { subscribe: () => {} },
            currentCue$: { subscribe: () => {} }
        },

        vuProcessor: {
            vuData$: { subscribe: (cb) => {
                driver._vuCb = cb;
                return { unsubscribe: () => { driver._vuCb = null; } };
            }}
        },

        channelSync: {
            getSelectedChannel: () => ({ subscribe: () => {} }),
            selectChannel: () => {}
        },

        player: {
            state$: { subscribe: () => {} },
            track$: { subscribe: () => {} },
            play: () => {}, pause: () => {}, stop: () => {},
            next: () => {}, prev: () => {},
            setShuffle: () => {}, setAuto: () => {}, setManual: () => {},
            loadPlaylist: () => {}
        },

        muteGroup: () => ({ state$: { subscribe: () => {} }, mute: () => {}, unmute: () => {} }),
        clearMuteGroups: () => {},
        volume: { solo: { setFaderLevel: () => {} }, headphone: () => ({ setFaderLevel: () => {} }) },

        disconnect: () => {
            if (driver._server) try { driver._server.close(); } catch (_) {}
            if (driver._client) try { driver._client.close(); } catch (_) {}
            if (mixerSingleton) mixerSingleton.setMixer(null);
        },

        connect: async () => {
            return new Promise((resolve, reject) => {
                try {
                    driver._client = new OSC.UDPPort({
                        localAddress: '0.0.0.0',
                        localPort: 0,
                        remoteAddress: ip,
                        remotePort: X32_PORT,
                        metadata: true
                    });

                    driver._send = (address, type, value) => {
                        try {
                            driver._client.send({
                                address,
                                args: [{ type, value }]
                            });
                        } catch (e) {
                            console.warn(`[Behringer] OSC send error (${address}):`, e.message);
                        }
                    };

                    driver._client.on('ready', () => {
                        driverEvents.emit('status', 0);
                        console.log(`[Behringer] OSC client ready for ${ip}:${X32_PORT}`);
                        resolve();
                    });

                    driver._client.on('error', (err) => {
                        console.error(`[Behringer] OSC error:`, err.message);
                        driverEvents.emit('status', 2);
                        reject(err);
                    });

                    driver._client.open();
                } catch (err) {
                    reject(err);
                }
            });
        }
    };

    return driver;
}

module.exports = { buildBehringerMixer };
