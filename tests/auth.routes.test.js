import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';

vi.mock('../src/server/logger', () => ({
    default: { getInstance: () => ({ info: () => {}, warn: () => {}, error: () => {} }) }
}));

let tmpDir;
let authDb;
let registerAuthRoutes;
let AUTH_COOKIE_NAME;

beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.tmp-auth-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    authDb = require('../src/server/auth-db');
    registerAuthRoutes = require('../src/server/auth.routes').registerAuthRoutes;
    AUTH_COOKIE_NAME = require('../src/server/auth.routes').AUTH_COOKIE_NAME;
    authDb.initDatabase(tmpDir);
});

afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
});

async function startServer() {
    const app = express();
    app.use(express.json());
    registerAuthRoutes(app);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r))
    };
}

function parseCookies(setCookieHeader) {
    const out = {};
    if (!setCookieHeader) return out;
    const parts = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    for (const p of parts) {
        const [pair] = p.split(';');
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k) out[k] = v;
    }
    return out;
}

async function call(baseUrl, method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (opts.cookie) headers['Cookie'] = `${AUTH_COOKIE_NAME}=${opts.cookie}`;
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
    const res = await fetch(`${baseUrl}${path}`, {
        method, headers, body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = res.headers.get('set-cookie');
    const cookies = parseCookies(setCookie);
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json, setCookie, cookies };
}

describe('Auth Routes - default password enforcement (C-1)', () => {
    it('returns mustChangePassword=true on default admin login', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const r = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            expect(r.status).toBe(200);
            expect(r.body.user.mustChangePassword).toBe(true);
        } finally { await close(); }
    });

    it('/api/auth/me returns user with must_change_password flag from DB (via cookie)', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const cookie = login.cookies[AUTH_COOKIE_NAME];
            expect(cookie).toBeTruthy();
            const me = await call(baseUrl, 'GET', '/api/auth/me', null, { cookie });
            expect(me.status).toBe(200);
            expect(me.body.user.must_change_password).toBe(1);
        } finally { await close(); }
    });

    it('change-password succeeds and clears flag in new cookie', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const oldCookie = login.cookies[AUTH_COOKIE_NAME];
            const r = await call(baseUrl, 'POST', '/api/auth/change-password', {
                currentPassword: 'admin',
                newPassword: 'NewPass123!'
            }, { cookie: oldCookie });
            expect(r.status).toBe(200);
            expect(r.body.user.mustChangePassword).toBe(false);
            expect(r.cookies[AUTH_COOKIE_NAME]).toBeTruthy();
            expect(r.cookies[AUTH_COOKIE_NAME]).not.toBe(oldCookie);

            const me = await call(baseUrl, 'GET', '/api/auth/me', null, { cookie: r.cookies[AUTH_COOKIE_NAME] });
            expect(me.body.user.must_change_password).toBe(0);
        } finally { await close(); }
    });

    it('change-password rejects wrong current password with 401', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const r = await call(baseUrl, 'POST', '/api/auth/change-password', {
                currentPassword: 'wrong',
                newPassword: 'NewPass123!'
            }, { cookie: login.cookies[AUTH_COOKIE_NAME] });
            expect(r.status).toBe(401);
        } finally { await close(); }
    });

    it('change-password rejects too-short new password with 400', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const r = await call(baseUrl, 'POST', '/api/auth/change-password', {
                currentPassword: 'admin',
                newPassword: 'short'
            }, { cookie: login.cookies[AUTH_COOKIE_NAME] });
            expect(r.status).toBe(400);
        } finally { await close(); }
    });

    it('change-password rejects when new equals current with 400', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const r = await call(baseUrl, 'POST', '/api/auth/change-password', {
                currentPassword: 'admin',
                newPassword: 'admin'
            }, { cookie: login.cookies[AUTH_COOKIE_NAME] });
            expect(r.status).toBe(400);
        } finally { await close(); }
    });

    it('change-password rejects missing fields with 400', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const r = await call(baseUrl, 'POST', '/api/auth/change-password', {}, { cookie: login.cookies[AUTH_COOKIE_NAME] });
            expect(r.status).toBe(400);
        } finally { await close(); }
    });

    it('change-password rejects unauthenticated with 401', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const r = await call(baseUrl, 'POST', '/api/auth/change-password', {
                currentPassword: 'admin',
                newPassword: 'NewPass123!'
            });
            expect(r.status).toBe(401);
        } finally { await close(); }
    });
});

describe('Auth - httpOnly cookie', () => {
    it('login sets sm_auth_token as HttpOnly cookie', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const r = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const cookieHeader = r.setCookie || '';
            expect(cookieHeader).toMatch(/sm_auth_token=[^;]+/);
            expect(cookieHeader).toMatch(/HttpOnly/i);
            expect(cookieHeader).toMatch(/SameSite=Strict/i);
            expect(cookieHeader).toMatch(/Path=\//);
            expect(cookieHeader).toMatch(/Max-Age=\d+/);
        } finally { await close(); }
    });

    it('login response does NOT include token in body (now in cookie only)', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const r = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            expect(r.body.token).toBeUndefined();
        } finally { await close(); }
    });

    it('register sets HttpOnly cookie', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const r = await call(baseUrl, 'POST', '/api/auth/register', {
                username: 'newuser', email: 'new@test.local', password: 'password123'
            });
            expect(r.status).toBe(201);
            expect(r.cookies[AUTH_COOKIE_NAME]).toBeTruthy();
            expect(r.setCookie).toMatch(/HttpOnly/i);
        } finally { await close(); }
    });

    it('auth via cookie works for protected route', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const me = await call(baseUrl, 'GET', '/api/auth/me', null, { cookie: login.cookies[AUTH_COOKIE_NAME] });
            expect(me.status).toBe(200);
            expect(me.body.user.username).toBe('admin');
        } finally { await close(); }
    });

    it('auth via Authorization header still works (backward compat)', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const me = await call(baseUrl, 'GET', '/api/auth/me', null, { token: login.cookies[AUTH_COOKIE_NAME] });
            expect(me.status).toBe(200);
        } finally { await close(); }
    });

    it('logout clears the cookie', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const logout = await call(baseUrl, 'POST', '/api/auth/logout', {}, { cookie: login.cookies[AUTH_COOKIE_NAME] });
            expect(logout.status).toBe(200);
            const cleared = logout.cookies[AUTH_COOKIE_NAME];
            expect(cleared === '' || cleared === undefined).toBe(true);
            const clearCookieHeader = logout.setCookie || '';
            expect(clearCookieHeader).toMatch(/Max-Age=0/);
        } finally { await close(); }
    });

    it('after logout, /me returns 401', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const logout = await call(baseUrl, 'POST', '/api/auth/logout', {});
            const me = await call(baseUrl, 'GET', '/api/auth/me', null, { cookie: '' });
            expect(me.status).toBe(401);
        } finally { await close(); }
    });

    it('rejects requests with invalid cookie', async () => {
        const { baseUrl, close } = await startServer();
        try {
            const me = await call(baseUrl, 'GET', '/api/auth/me', null, { cookie: 'invalid-jwt' });
            expect(me.status).toBe(403);
        } finally { await close(); }
    });
});

describe('Auth middleware - mustChangePassword blocks non-whitelisted routes', () => {
    it('returns 403 with code MUST_CHANGE_PASSWORD on non-whitelisted protected route (via cookie)', async () => {
        const realApp = express();
        realApp.use(express.json());
        const jwt = require('jsonwebtoken');
        const { JWT_SECRET } = require('../src/server/jwt-config');
        const { authenticateToken } = require('../src/server/auth.routes');
        realApp.get('/api/protected', authenticateToken, (req, res) => res.json({ ok: true }));

        const auxServer = await new Promise((resolve) => {
            const s = realApp.listen(0, () => resolve(s));
        });
        const auxPort = auxServer.address().port;

        const { baseUrl, close } = await startServer();
        try {
            const login = await call(baseUrl, 'POST', '/api/auth/login', { username: 'admin', password: 'admin' });
            const oldCookie = login.cookies[AUTH_COOKIE_NAME];

            const res1 = await fetch(`http://127.0.0.1:${auxPort}/api/protected`, {
                headers: { Cookie: `${AUTH_COOKIE_NAME}=${oldCookie}` }
            });
            const body1 = await res1.json();
            expect(res1.status).toBe(403);
            expect(body1.code).toBe('MUST_CHANGE_PASSWORD');

            const change = await call(baseUrl, 'POST', '/api/auth/change-password', {
                currentPassword: 'admin',
                newPassword: 'NewPass123!'
            }, { cookie: oldCookie });
            const newCookie = change.cookies[AUTH_COOKIE_NAME];

            const res2 = await fetch(`http://127.0.0.1:${auxPort}/api/protected`, {
                headers: { Cookie: `${AUTH_COOKIE_NAME}=${newCookie}` }
            });
            expect(res2.status).toBe(200);
        } finally {
            await close();
            await new Promise((r) => auxServer.close(r));
        }
    });
});
