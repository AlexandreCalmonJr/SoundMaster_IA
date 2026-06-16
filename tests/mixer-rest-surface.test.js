import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appServerSrc = readFileSync(resolve(process.cwd(), 'src/server/app-server.js'), 'utf8');
const authRoutesSrc = readFileSync(resolve(process.cwd(), 'src/server/auth.routes.js'), 'utf8');
const restParserSrc = readFileSync(resolve(process.cwd(), 'src/server/mixer-rest-command.js'), 'utf8');

describe('Mixer REST surface hardening', () => {
    it('requires admin role for the REST mixer command route', () => {
        expect(appServerSrc).toContain("expressApp.post('/api/mixer/command', authenticateToken, requireRole('admin'), express.json(), (req, res) => {");
    });

    it('exports a reusable role guard from auth routes', () => {
        expect(authRoutesSrc).toContain('function requireRole(...allowedRoles) {');
        expect(authRoutesSrc).toContain("return res.status(403).json({ error: 'Acesso restrito a administradores' });");
    });

    it('uses strict schemas for allowed REST mixer commands', () => {
        expect(restParserSrc).not.toContain('.strip()');
        expect(restParserSrc).toContain('.strict()');
    });
});
