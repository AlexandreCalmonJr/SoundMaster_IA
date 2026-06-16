import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(process.cwd(), 'src/server/app-server.js'), 'utf8');

describe('Socket.IO auth hardening', () => {
    it('rejects missing tokens in the Socket.IO middleware', () => {
        expect(src).toMatch(/if \(!token\) \{/);
        expect(src).toMatch(/Autenticação obrigatória para Socket\.IO\./);
    });

    it('rejects invalid tokens instead of allowing anonymous fallback', () => {
        expect(src).toMatch(/return next\(new Error\('Token inválido ou expirado\.'\)\);/);
        expect(src).not.toMatch(/Allow connection but mark as unauthenticated/);
    });

    it('blocks realtime access when mustChangePassword is still true', () => {
        expect(src).toMatch(/decoded\.mustChangePassword === true/);
        expect(src).toMatch(/Senha precisa ser alterada antes de usar o tempo real\./);
    });
});
