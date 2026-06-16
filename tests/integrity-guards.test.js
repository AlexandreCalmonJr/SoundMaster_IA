import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const updaterSrc = readFileSync(resolve(process.cwd(), 'src/server/updater.js'), 'utf8');
const installerSrc = readFileSync(resolve(process.cwd(), 'src/server/python-installer.js'), 'utf8');
const electronWindowSrc = readFileSync(resolve(process.cwd(), 'src/server/electron-window.js'), 'utf8');

describe('Integrity guards', () => {
    it('blocks updater when UPDATE_HASH is missing', () => {
        expect(updaterSrc).toContain("throw new Error('UPDATE_HASH não configurado. Atualização bloqueada por política de integridade.')");
    });

    it('blocks python bootstrap when get-pip checksum is missing', () => {
        expect(installerSrc).toContain("const EXPECTED_GETPIP_SHA256 = process.env.EXPECTED_GETPIP_SHA256 || '';");
        expect(installerSrc).toContain("throw new Error(`Checksum não configurado para ${label}. Instalação bloqueada por política de integridade.`);");
    });

    it('opens DevTools only in development mode', () => {
        expect(electronWindowSrc).toMatch(/if \(process\.env\.NODE_ENV === 'development'\) \{\s*win\.webContents\.openDevTools\(\);/);
    });
});
