/**
 * Tests do helper fetchWithTimeout (AbortController).
 * Usa fake timers + mock do fetch global para validar timeout e cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function loadHelper() {
    // Carrega o IIFE em ambiente controlado
    const path = require('node:path');
    const fs = require('node:fs');
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'frontend', 'js', 'core', 'fetch-utils.js'),
        'utf8'
    );
    const sandbox = { window: {} };
    const fn = new Function('window', src);
    fn(sandbox.window);
    return sandbox.window.SoundMasterFetch;
}

describe('fetch-utils.fetchWithTimeout', () => {
    let originalFetch;
    let mockFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        vi.useRealTimers();
    });

    it('expõe fetchWithTimeout e DEFAULT_TIMEOUT_MS no window', () => {
        const helper = loadHelper();
        expect(typeof helper.fetchWithTimeout).toBe('function');
        expect(helper.DEFAULT_TIMEOUT_MS).toBe(30000);
    });

    it('passa o response adiante quando fetch resolve dentro do timeout', async () => {
        mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
        global.fetch = mockFetch;
        const { fetchWithTimeout } = loadHelper();
        const res = await fetchWithTimeout('/api/health', {}, 5000);
        expect(res.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const passedOpts = mockFetch.mock.calls[0][1];
        expect(passedOpts.signal).toBeDefined();
    });

    it('lança "Timeout após Xms" quando AbortError é lançado após o deadline', async () => {
        mockFetch = vi.fn().mockImplementation((_url, opts) => {
            return new Promise((_, reject) => {
                if (opts && opts.signal) {
                    opts.signal.addEventListener('abort', () => {
                        const err = new Error('aborted');
                        err.name = 'AbortError';
                        reject(err);
                    });
                }
            });
        });
        global.fetch = mockFetch;
        const { fetchWithTimeout } = loadHelper();
        await expect(fetchWithTimeout('/api/slow', {}, 50))
            .rejects.toThrow(/Timeout após 50ms/);
    });

    it('timeout=0 desabilita o abort automático', async () => {
        vi.useFakeTimers();
        mockFetch = vi.fn().mockResolvedValue({ ok: true });
        global.fetch = mockFetch;
        const { fetchWithTimeout } = loadHelper();
        const p = fetchWithTimeout('/api/quick', {}, 0);
        await vi.runAllTimersAsync();
        await p;
        expect(mockFetch).toHaveBeenCalled();
    });

    it('propaga erros de rede não-Abort', async () => {
        mockFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        global.fetch = mockFetch;
        const { fetchWithTimeout } = loadHelper();
        await expect(fetchWithTimeout('/api/x', {}, 1000))
            .rejects.toThrow('Failed to fetch');
    });
});
