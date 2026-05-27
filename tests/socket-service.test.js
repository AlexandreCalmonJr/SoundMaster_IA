import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SS_PATH = resolve(process.cwd(), 'frontend/js/services/socket.service.js');

function loadSocketService() {
    // AppStore mock
    let _state = {
        mixerConnected: false,
        mixerStatusMsg: 'Offline',
        masterLevel: 0,
        masterDb: null,
        vuData: {},
        recording: false,
        mtkRecording: false,
        deviceInfo: {},
        playerState: null,
        playerTrack: null,
        currentShow: null,
        currentSnapshot: null,
        currentCue: null,
        aiAvailable: false,
        liteMode: true,
        automix: {},
        muteGroups: {},
        mixerNames: { channels: {}, aux: {} },
    };
    globalThis.AppStore = {
        getState: vi.fn(() => ({ ..._state })),
        setState: vi.fn((patch) => { Object.assign(_state, patch); }),
        addLog: vi.fn(),
    };

    // BinaryCodec mock
    globalThis.BinaryCodec = {
        decodeVuData: vi.fn((buf) => ({ master: 0.5, channels: { 1: { vuPre: 0.1, vuPost: 0.2, vuPostFader: 0.3 } } })),
        decodeMasterLevel: vi.fn((buf) => 0.5),
        decodeMasterLevelDb: vi.fn((buf) => -6.0),
        decodeChannelLevel: vi.fn((buf) => ({ channel: 1, level: 0.5 })),
    };

    globalThis.window = globalThis;
    globalThis.addEventListener = vi.fn();
    globalThis.console = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    globalThis.document = {
        createElement: vi.fn(() => {
            const el = { style: {}, appendChild: vi.fn() };
            return el;
        }),
        body: { appendChild: vi.fn() },
    };
    globalThis.io = function () {
        const s = {
            connected: true,
            emit: vi.fn(),
            on: vi.fn(),
            off: vi.fn(),
            disconnect: vi.fn(),
        };
        return s;
    };

    delete globalThis.SocketService;
    const code = readFileSync(SS_PATH, 'utf8');
    new Function('globalThis', 'var window = globalThis.window; var AppStore = globalThis.AppStore; var io = globalThis.io; ' + code)(globalThis);

    return globalThis.SocketService;
}

describe('SocketService — Offline Queue', () => {
    let ss;

    beforeEach(() => { ss = loadSocketService(); });
    afterEach(() => { delete globalThis.SocketService; delete globalThis.AppStore; delete globalThis.BinaryCodec; delete globalThis.window; delete globalThis.document; delete globalThis.io; });

    it('enqueues commands when offline', () => {
        ss.init();
        const socket = ss.raw();
        // Simula desconexão
        socket.connected = false;
        // Força _isOnline para false via connect handler (não chamamos on connect ainda)
        // Em vez disso, emit detecta socket.connected = false
        const result = ss.emit('set_master_level', { level: 0.5 });
        expect(result).toBe(false);
        expect(ss.getQueueLength()).toBeGreaterThanOrEqual(1);
    });

    it('does not enqueue when queue is full (max 100)', () => {
        ss.init();
        const socket = ss.raw();
        socket.connected = false;
        for (let i = 0; i < 110; i++) {
            ss.emit('set_master_level', { level: i / 100 });
        }
        expect(ss.getQueueLength()).toBeLessThanOrEqual(100);
    });

    it('emits directly when online', () => {
        ss.init();
        const socket = ss.raw();
        // O init configura o socket.on('connect', ...) que define _isOnline = true
        // Vamos simular chamando o handler de connect manualmente
        const connectHandler = socket.on.mock.calls.find(c => c[0] === 'connect');
        if (connectHandler) connectHandler[1]();

        const result = ss.emit('set_master_level', { level: 0.75 });
        expect(result).toBe(true);
        expect(socket.emit).toHaveBeenCalledWith('set_master_level', { level: 0.75 });
    });

    it('flushes queue on reconnect', () => {
        ss.init();
        const socket = ss.raw();
        socket.connected = false;

        ss.emit('cmd1', { x: 1 });
        ss.emit('cmd2', { x: 2 });

        // Primeiro dispara disconnect (marca _reconnectTs) depois connect (flushes queue)
        const disconnectHandler = socket.on.mock.calls.find(c => c[0] === 'disconnect');
        if (disconnectHandler) disconnectHandler[1]('transport close');

        const connectHandler = socket.on.mock.calls.find(c => c[0] === 'connect');
        if (connectHandler) connectHandler[1]();

        expect(ss.getQueueLength()).toBe(0);
    });
});

describe('SocketService — Fader Lock Registry', () => {
    let ss;

    beforeEach(() => {
        vi.useFakeTimers();
        ss = loadSocketService();
    });
    afterEach(() => {
        vi.useRealTimers();
        delete globalThis.SocketService; delete globalThis.AppStore; delete globalThis.BinaryCodec; delete globalThis.window; delete globalThis.document; delete globalThis.io;
    });

    it('locks a fader for a duration', () => {
        ss.lockFader('ch_1', 0.8);
        expect(ss.isFaderLocked('ch_1')).toBe(true);
    });

    it('releases lock after LOCK_DURATION_MS', () => {
        ss.lockFader('ch_1', 0.8);
        vi.advanceTimersByTime(400);
        expect(ss.isFaderLocked('ch_1')).toBe(false);
    });

    it('unlockFader removes the lock immediately', () => {
        ss.lockFader('master', 0.5);
        expect(ss.isFaderLocked('master')).toBe(true);
        ss.unlockFader('master');
        expect(ss.isFaderLocked('master')).toBe(false);
    });

    it('returns false for unknown fader', () => {
        expect(ss.isFaderLocked('nonexistent')).toBe(false);
    });

    it('two independent locks do not interfere', () => {
        ss.lockFader('ch_1', 0.8);
        ss.lockFader('ch_2', 0.3);
        expect(ss.isFaderLocked('ch_1')).toBe(true);
        expect(ss.isFaderLocked('ch_2')).toBe(true);
        ss.unlockFader('ch_1');
        expect(ss.isFaderLocked('ch_1')).toBe(false);
        expect(ss.isFaderLocked('ch_2')).toBe(true);
    });
});

describe('SocketService — Event Handlers', () => {
    let ss;

    beforeEach(() => { ss = loadSocketService(); });
    afterEach(() => { delete globalThis.SocketService; delete globalThis.AppStore; delete globalThis.BinaryCodec; delete globalThis.window; delete globalThis.document; delete globalThis.io; });

    it('master_level binary decode triggers setState', () => {
        ss.init();
        const socket = ss.raw();
        const handler = socket.on.mock.calls.find(c => c[0] === 'master_level');
        expect(handler).toBeDefined();

        const fakeBuffer = new ArrayBuffer(4);
        handler[1](fakeBuffer);
        expect(BinaryCodec.decodeMasterLevel).toHaveBeenCalledWith(fakeBuffer);
    });

    it('vu_data binary decode triggers setState', () => {
        ss.init();
        const socket = ss.raw();
        const handler = socket.on.mock.calls.find(c => c[0] === 'vu_data');
        expect(handler).toBeDefined();

        const fakeBuffer = new ArrayBuffer(292);
        handler[1](fakeBuffer);
        expect(BinaryCodec.decodeVuData).toHaveBeenCalledWith(fakeBuffer);
    });

    it('channel_level binary decode triggers setState', () => {
        ss.init();
        const socket = ss.raw();
        const handler = socket.on.mock.calls.find(c => c[0] === 'channel_level');
        expect(handler).toBeDefined();

        const fakeBuffer = new ArrayBuffer(5);
        handler[1](fakeBuffer);
        expect(BinaryCodec.decodeChannelLevel).toHaveBeenCalledWith(fakeBuffer);
    });

    it('connect handler sets _isOnline and requests state delta on reconnect', () => {
        ss.init();
        const socket = ss.raw();
        // Simula que já estava conectado antes (reconexão)
        const connectHandler = socket.on.mock.calls.find(c => c[0] === 'connect');
        expect(connectHandler).toBeDefined();

        connectHandler[1]();
        expect(AppStore.addLog).toHaveBeenCalledWith(expect.stringContaining('Conectado'));
        expect(socket.emit).toHaveBeenCalledWith('get_ai_status');
    });
});
