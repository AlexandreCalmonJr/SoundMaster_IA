import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CB_PATH = resolve(process.cwd(), 'frontend/js/core/circuit-breaker.js');

function loadCircuitBreaker() {
    globalThis.window = globalThis;
    globalThis.console = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    delete globalThis.CircuitBreaker;
    const code = readFileSync(CB_PATH, 'utf8');
    const run = new Function('globalThis', 'var window = globalThis.window; ' + code);
    run(globalThis);
    return globalThis.CircuitBreaker;
}

describe('CircuitBreaker', () => {
    let CircuitBreaker;

    beforeEach(() => { CircuitBreaker = loadCircuitBreaker(); });
    afterEach(() => { delete globalThis.CircuitBreaker; delete globalThis.window; });

    it('starts CLOSED with zero failures', () => {
        const cb = new CircuitBreaker(async () => 'ok');
        expect(cb.state).toBe('CLOSED');
        expect(cb.failureCount).toBe(0);
    });

    it('calls the wrapped function and returns its result', async () => {
        const fn = vi.fn(async () => 'hello');
        const cb = new CircuitBreaker(fn);
        const result = await cb.call();
        expect(result).toBe('hello');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('passes arguments to the wrapped function', async () => {
        const fn = vi.fn(async (a, b) => a + b);
        const cb = new CircuitBreaker(fn);
        const result = await cb.call(2, 3);
        expect(result).toBe(5);
        expect(fn).toHaveBeenCalledWith(2, 3);
    });

    it('transitions CLOSED → OPEN after maxFailures consecutive failures', async () => {
        const fn = vi.fn(async () => { throw new Error('fail'); });
        const cb = new CircuitBreaker(fn, { maxFailures: 2, cooldownMs: 60000 });
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('CLOSED');
        expect(cb.failureCount).toBe(1);
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');
        expect(cb.failureCount).toBe(2);
    });

    it('throws when called in OPEN state and no fallback', async () => {
        const fn = vi.fn(async () => { throw new Error('fail'); });
        const cb = new CircuitBreaker(fn, { maxFailures: 1, cooldownMs: 60000 });
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');
        await expect(cb.call()).rejects.toThrow('CircuitBreaker');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls fallback when OPEN and fallback is provided', async () => {
        const fn = vi.fn(async () => { throw new Error('fail'); });
        const fallback = vi.fn(async () => 'fallback-result');
        const cb = new CircuitBreaker(fn, { maxFailures: 1, cooldownMs: 60000, fallback });
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');
        const result = await cb.call();
        expect(result).toBe('fallback-result');
        expect(fallback).toHaveBeenCalledOnce();
    });

    it('transitions OPEN → HALF_OPEN when cooldown expires', async () => {
        // A função deve ter sucesso na chamada HALF_OPEN, senão volta a OPEN
        let callCount = 0;
        const fn = vi.fn(async () => {
            callCount++;
            if (callCount <= 1) throw new Error('fail');
            return 'ok';
        });
        const cb = new CircuitBreaker(fn, { maxFailures: 1, cooldownMs: 60000 });
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');

        cb._nextAttempt = Date.now() - 1;
        const result = await cb.call();
        expect(result).toBe('ok');
        // HALF_OPEN → sucesso → CLOSED
        expect(cb.state).toBe('CLOSED');
        expect(cb.failureCount).toBe(0);
    });

    it('transitions HALF_OPEN → CLOSED on success', async () => {
        let attempts = 0;
        const fn = vi.fn(async () => {
            attempts++;
            if (attempts === 1) throw new Error('fail');
            return 'ok';
        });
        const cb = new CircuitBreaker(fn, { maxFailures: 1, cooldownMs: 100 });
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');

        // Simula expiração do cooldown
        cb._nextAttempt = Date.now() - 1;
        const result = await cb.call();
        expect(result).toBe('ok');
        expect(cb.state).toBe('CLOSED');
        expect(cb.failureCount).toBe(0);
    });

    it('transitions HALF_OPEN → OPEN on failure', async () => {
        const fn = vi.fn(async () => { throw new Error('fail'); });
        const cb = new CircuitBreaker(fn, { maxFailures: 1, cooldownMs: 100 });
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');

        cb._nextAttempt = Date.now() - 1;
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');
        expect(cb.failureCount).toBe(2);
    });

    it('reset() restores CLOSED state and zero failures', async () => {
        const fn = vi.fn(async () => { throw new Error('fail'); });
        const cb = new CircuitBreaker(fn, { maxFailures: 1, cooldownMs: 60000 });
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');
        cb.reset();
        expect(cb.state).toBe('CLOSED');
        expect(cb.failureCount).toBe(0);
        fn.mockResolvedValue('recovered');
        const result = await cb.call();
        expect(result).toBe('recovered');
    });

    it('uses default options when none provided', () => {
        const cb = new CircuitBreaker(async () => 'ok');
        expect(cb._maxFailures).toBe(3);
        expect(cb._cooldownMs).toBe(10000);
        expect(cb._fallback).toBeUndefined();
        expect(cb._name).toBe('unnamed');
    });

    it('uses provided name for logging', async () => {
        const fn = vi.fn(async () => { throw new Error('fail'); });
        const cb = new CircuitBreaker(fn, { maxFailures: 1, cooldownMs: 10, name: 'test-ai' });
        await expect(cb.call()).rejects.toThrow();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('test-ai'));
    });

    it('re-throws the original error after maxFailures', async () => {
        const fn = vi.fn(async () => { throw new Error('original-msg') });
        const cb = new CircuitBreaker(fn, { maxFailures: 3 });
        await expect(cb.call()).rejects.toThrow('original-msg');
    });

    it('does not call wrapped fn when OPEN with fallback', async () => {
        const fn = vi.fn(async () => { throw new Error('fail'); });
        const fallback = vi.fn(async () => 'fb');
        const cb = new CircuitBreaker(fn, { maxFailures: 1, cooldownMs: 60000, fallback });
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');
        await cb.call();
        // fn should NOT be called again while OPEN
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('stays OPEN after HALF_OPEN failure with maxFailures=1', async () => {
        const fn = vi.fn(async () => { throw new Error('fail'); });
        const cb = new CircuitBreaker(fn, { maxFailures: 1, cooldownMs: 100 });

        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');

        cb._nextAttempt = Date.now() - 1;
        await expect(cb.call()).rejects.toThrow();
        expect(cb.state).toBe('OPEN');
        expect(cb.failureCount).toBe(2);

        // Ainda OPEN, fallback deve ser chamado se existir
        cb._nextAttempt = Date.now() + 60000;
        await expect(cb.call()).rejects.toThrow('CircuitBreaker');
    });
});
