/**
 * Tests do Logger: instalacao do console proxy, buffering, getInstance singleton.
 * Usa tmpdir para isolar o arquivo de log.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

function freshLoggerModule() {
    const modulePath = _require.resolve('../src/server/logger');
    delete _require.cache[modulePath];
    return _require(modulePath);
}

describe('Logger', () => {
    let tmpDir;
    let Logger;

    beforeEach(() => {
        tmpDir = path.join(process.cwd(), `.tmp-logger-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        Logger = freshLoggerModule();
    });

    afterEach(() => {
        if (tmpDir && fs.existsSync(tmpDir)) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    it('getInstance retorna singleton', () => {
        const a = Logger.getInstance(tmpDir);
        const b = Logger.getInstance(tmpDir);
        expect(a).toBe(b);
    });

    it('log() formata entrada com timestamp/level/socketId/event/data', () => {
        const logger = Logger.getInstance(tmpDir);
        const captured = [];
        logger.onLog = (entry) => captured.push(entry);
        logger.info('sock-1', 'TEST_EVENT', { foo: 42 });
        expect(captured).toHaveLength(1);
        const e = captured[0];
        expect(e.level).toBe('INFO');
        expect(e.socketId).toBe('sock-1');
        expect(e.event).toBe('TEST_EVENT');
        expect(e.data).toEqual({ foo: 42 });
        expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('installConsoleProxy é idempotente e redireciona console.* para o buffer', () => {
        const logger = Logger.getInstance(tmpDir);
        const captured = [];
        logger.onLog = (e) => captured.push(e);

        Logger.installConsoleProxy();
        const firstRef = console.log;
        Logger.installConsoleProxy();
        const secondRef = console.log;
        expect(firstRef).toBe(secondRef);

        // Captura ref antes do call para evitar que vi.spyOn intercepte o proxy
        const proxiedError = console.error;
        proxiedError('legacy driver crashed');

        const errEntry = captured.find(c => c.event === 'CONSOLE' && c.level === 'ERROR');
        expect(errEntry).toBeDefined();
        expect(errEntry.data.msg).toContain('legacy driver crashed');
    });

    it('console.log concatena múltiplos args como string', () => {
        const logger = Logger.getInstance(tmpDir);
        const captured = [];
        logger.onLog = (e) => captured.push(e);
        Logger.installConsoleProxy();

        const proxiedLog = console.log;
        proxiedLog('foo', 42, { bar: true });

        const e = captured.find(c => c.event === 'CONSOLE' && c.data.msg.includes('foo'));
        expect(e).toBeDefined();
        expect(e.data.msg).toMatch(/foo.*42.*bar/);
    });

    it('não quebra quando o argumento não é string/JSON', () => {
        const logger = Logger.getInstance(tmpDir);
        const captured = [];
        logger.onLog = (e) => captured.push(e);
        Logger.installConsoleProxy();

        const proxiedLog = console.log;
        const circular = {}; circular.self = circular;
        proxiedLog(circular);

        expect(captured.some(c => c.event === 'CONSOLE')).toBe(true);
    });

    it('trunca mensagens muito longas para evitar inchaço do log', () => {
        const logger = Logger.getInstance(tmpDir);
        const captured = [];
        logger.onLog = (e) => captured.push(e);
        Logger.installConsoleProxy();

        const proxiedLog = console.log;
        proxiedLog('x'.repeat(2000));

        const e = captured.find(c => c.event === 'CONSOLE');
        expect(e.data.msg.length).toBeLessThanOrEqual(1000);
    });
});
