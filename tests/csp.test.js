import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

vi.mock('../src/server/logger', () => ({
    default: { getInstance: () => ({ info: () => {}, warn: () => {}, error: () => {} }) }
}));

let server;
let baseUrl;
let frontendDir;

function makeApp() {
    const app = express();
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
                scriptSrcAttr: ["'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "blob:"],
                connectSrc: ["'self'", "ws:", "wss:"],
                upgradeInsecureRequests: null,
            }
        },
        hsts: false
    }));
    app.use(express.static(frontendDir));
    return app;
}

beforeEach(async () => {
    frontendDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-csp-'));
    fs.writeFileSync(path.join(frontendDir, 'auth.html'), '<html><body>auth</body></html>');
    fs.mkdirSync(path.join(frontendDir, 'js', 'pages'), { recursive: true });
    fs.writeFileSync(path.join(frontendDir, 'js', 'pages', 'auth-page.js'), '/* auth page */');
    fs.writeFileSync(path.join(frontendDir, 'js', 'pages', 'analyzer-hotkeys.js'), '/* hotkeys */');

    const app = makeApp();
    server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (frontendDir && fs.existsSync(frontendDir)) {
        fs.rmSync(frontendDir, { recursive: true, force: true });
    }
});

describe('CSP - C-2 strict mode', () => {
    it('sends Content-Security-Policy header on every response', async () => {
        const res = await fetch(`${baseUrl}/auth.html`);
        expect(res.status).toBe(200);
        const csp = res.headers.get('content-security-policy');
        expect(csp).toBeTruthy();
    });

    it('does NOT allow unsafe-inline in script-src', async () => {
        const res = await fetch(`${baseUrl}/auth.html`);
        const csp = res.headers.get('content-security-policy') || '';
        const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
        expect(scriptSrcMatch).toBeTruthy();
        const scriptSrc = scriptSrcMatch[1];
        expect(scriptSrc).not.toMatch(/'unsafe-inline'/);
    });

    it('DOES allow unsafe-inline in script-src-attr (for onclick handlers)', async () => {
        const res = await fetch(`${baseUrl}/auth.html`);
        const csp = res.headers.get('content-security-policy') || '';
        const attrMatch = csp.match(/script-src-attr\s+([^;]+)/);
        expect(attrMatch).toBeTruthy();
        expect(attrMatch[1]).toMatch(/'unsafe-inline'/);
    });

    it('keeps self in script-src', async () => {
        const res = await fetch(`${baseUrl}/auth.html`);
        const csp = res.headers.get('content-security-policy') || '';
        expect(csp).toMatch(/script-src[^;]*'self'/);
    });

    it('keeps cdnjs.cloudflare.com in script-src for mobile/tutorials', async () => {
        const res = await fetch(`${baseUrl}/auth.html`);
        const csp = res.headers.get('content-security-policy') || '';
        expect(csp).toMatch(/script-src[^;]*cdnjs\.cloudflare\.com/);
    });

    it('externalized auth-page.js is served as application/javascript', async () => {
        const res = await fetch(`${baseUrl}/js/pages/auth-page.js`);
        expect(res.status).toBe(200);
        const ct = res.headers.get('content-type') || '';
        expect(ct).toMatch(/javascript/);
    });

    it('externalized analyzer-hotkeys.js is served', async () => {
        const res = await fetch(`${baseUrl}/js/pages/analyzer-hotkeys.js`);
        expect(res.status).toBe(200);
    });
});

describe('CSP - source files no longer contain inline scripts', () => {
    it('auth.html does not contain an inline <script> block', () => {
        const content = fs.readFileSync(
            path.join(process.cwd(), 'frontend', 'auth.html'),
            'utf8'
        );
        const inlineScriptTags = content.match(/<script>([\s\S]*?)<\/script>/g) || [];
        expect(inlineScriptTags).toEqual([]);
    });

    it('auth.html references external auth-page.js', () => {
        const content = fs.readFileSync(
            path.join(process.cwd(), 'frontend', 'auth.html'),
            'utf8'
        );
        expect(content).toMatch(/<script src="js\/pages\/auth-page\.js"><\/script>/);
    });

    it('analyzer.html does not contain an inline <script> block', () => {
        const content = fs.readFileSync(
            path.join(process.cwd(), 'frontend', 'pages', 'analyzer.html'),
            'utf8'
        );
        const inlineScriptTags = content.match(/<script>([\s\S]*?)<\/script>/g) || [];
        expect(inlineScriptTags).toEqual([]);
    });

    it('analyzer.html references external analyzer-hotkeys.js', () => {
        const content = fs.readFileSync(
            path.join(process.cwd(), 'frontend', 'pages', 'analyzer.html'),
            'utf8'
        );
        expect(content).toMatch(/<script src="\.\.\/js\/pages\/analyzer-hotkeys\.js"><\/script>/);
    });

    it('extracted auth-page.js defines switchTab, handleLogin, handleRegister as globals', () => {
        const content = fs.readFileSync(
            path.join(process.cwd(), 'frontend', 'js', 'pages', 'auth-page.js'),
            'utf8'
        );
        expect(content).toMatch(/function\s+switchTab/);
        expect(content).toMatch(/async\s+function\s+handleLogin/);
        expect(content).toMatch(/async\s+function\s+handleRegister/);
    });
});
