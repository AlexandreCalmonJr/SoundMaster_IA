const express = require('express');
const jwt = require('jsonwebtoken');
const authDb = require('./auth-db');
const Logger = require('./logger');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('./jwt-config');

const AUTH_COOKIE_NAME = 'sm_auth_token';
const SECURE_COOKIES = process.env.SECURE_COOKIES === 'true';
const PASSWORD_CHANGE_WHITELIST = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];

function parseCookieHeader(header) {
    const out = {};
    if (!header) return out;
    const pairs = header.split(';');
    for (const p of pairs) {
        const idx = p.indexOf('=');
        if (idx === -1) continue;
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    }
    return out;
}

function setAuthCookie(res, token) {
    const parts = [
        `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict'
    ];
    if (SECURE_COOKIES) parts.push('Secure');
    const maxAgeMs = 24 * 60 * 60 * 1000;
    parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
    res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res) {
    const parts = [
        `${AUTH_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=0'
    ];
    if (SECURE_COOKIES) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
}

function extractToken(req) {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        const m = authHeader.split(' ');
        if (m.length === 2 && m[0] === 'Bearer' && m[1]) return m[1];
    }
    if (req.headers.cookie) {
        const cookies = parseCookieHeader(req.headers.cookie);
        if (cookies[AUTH_COOKIE_NAME]) return cookies[AUTH_COOKIE_NAME];
    }
    return null;
}

function authenticateToken(req, res, next) {
    const token = extractToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Token não fornecido' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        if (decoded.mustChangePassword === true && !PASSWORD_CHANGE_WHITELIST.includes(req.path)) {
            Logger.getInstance().warn('auth', 'BLOCKED_MUST_CHANGE_PASSWORD', { userId: decoded.id, path: req.path });
            return res.status(403).json({ error: 'Senha precisa ser alterada', code: 'MUST_CHANGE_PASSWORD' });
        }
        next();
    } catch (err) {
        return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
}

function requireRole(...allowedRoles) {
    return function requireRoleMiddleware(req, res, next) {
        const role = req.user && typeof req.user.role === 'string'
            ? req.user.role
            : '';

        if (!role || !allowedRoles.includes(role)) {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        next();
    };
}

function registerAuthRoutes(app) {
    const logger = Logger.getInstance();
    app.post('/api/auth/register', (req, res) => {
        try {
            const { username, email, password } = req.body;

            if (!username || !email || !password) {
                return res.status(400).json({ error: 'Campos obrigatórios: username, email, password' });
            }
            if (password.length < 6) {
                return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
            }
            if (username.length < 3) {
                return res.status(400).json({ error: 'Username deve ter no mínimo 3 caracteres' });
            }

            const existingUser = authDb.findUserByUsername(username);
            if (existingUser) {
                return res.status(409).json({ error: 'Username já existe' });
            }

            const existingEmail = authDb.findUserByEmail(email);
            if (existingEmail) {
                return res.status(409).json({ error: 'Email já cadastrado' });
            }

            const user = authDb.createUser(username, email, password);
            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role, mustChangePassword: false },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN }
            );
            setAuthCookie(res, token);

            res.status(201).json({
                message: 'Usuário criado com sucesso',
                user: { id: user.id, username: user.username, email: user.email, role: user.role, mustChangePassword: false },
            });
        } catch (err) {
            logger.error('auth', 'REGISTER_ERROR', { error: err.message });
            res.status(500).json({ error: 'Erro interno ao criar usuário' });
        }
    });

    // Brute-force protection: track failed login attempts
    const _loginAttempts = new Map(); // key: 'username:ip' -> { count, lastAttempt }
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

    function _checkBruteForce(username, ip) {
        const key = `${username}:${ip}`;
        const record = _loginAttempts.get(key);
        if (!record) return true;
        if (record.count >= MAX_ATTEMPTS) {
            const elapsed = Date.now() - record.lastAttempt;
            if (elapsed < LOCKOUT_MS) return false;
            _loginAttempts.delete(key); // Reset after lockout
        }
        return true;
    }

    function _recordFailedAttempt(username, ip) {
        const key = `${username}:${ip}`;
        const record = _loginAttempts.get(key) || { count: 0, lastAttempt: 0 };
        record.count++;
        record.lastAttempt = Date.now();
        _loginAttempts.set(key, record);
    }

    function _clearAttempts(username, ip) {
        const key = `${username}:${ip}`;
        _loginAttempts.delete(key);
    }

    app.post('/api/auth/login', (req, res) => {
        try {
            const { username, password } = req.body;
            const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';

            if (!username || !password) {
                return res.status(400).json({ error: 'Campos obrigatórios: username, password' });
            }

            if (!_checkBruteForce(username, clientIp)) {
                logger.warn('auth', 'LOGIN_LOCKED_OUT', { username, ip: clientIp });
                return res.status(429).json({ error: 'Conta bloqueada temporariamente. Tente novamente em 15 minutos.' });
            }

            const user = authDb.findUserByUsername(username);
            if (!user) {
                _recordFailedAttempt(username, clientIp);
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }

            const valid = authDb.verifyPassword(password, user.password_hash);
            if (!valid) {
                _recordFailedAttempt(username, clientIp);
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }

            _clearAttempts(username, clientIp);
            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role, mustChangePassword: user.must_change_password === 1 },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN }
            );
            setAuthCookie(res, token);

            res.json({
                message: 'Login realizado com sucesso',
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    mustChangePassword: user.must_change_password === 1
                },
            });
        } catch (err) {
            logger.error('auth', 'LOGIN_ERROR', { error: err.message });
            res.status(500).json({ error: 'Erro interno ao fazer login' });
        }
    });

    app.get('/api/auth/me', authenticateToken, (req, res) => {
        try {
            const user = authDb.findUserById(req.user.id);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            res.json({ user });
        } catch (err) {
            logger.error('auth', 'ME_ERROR', { error: err.message });
            res.status(500).json({ error: 'Erro interno' });
        }
    });

    app.post('/api/auth/change-password', authenticateToken, (req, res) => {
        try {
            const { currentPassword, newPassword } = req.body || {};
            if (!currentPassword || !newPassword) {
                return res.status(400).json({ error: 'Campos obrigatórios: currentPassword, newPassword' });
            }
            if (newPassword.length < 8) {
                return res.status(400).json({ error: 'Senha deve ter no mínimo 8 caracteres' });
            }
            if (newPassword === currentPassword) {
                return res.status(400).json({ error: 'A nova senha deve ser diferente da atual' });
            }
            const user = authDb.findUserByIdWithHash(req.user.id);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }
            if (!authDb.verifyPassword(currentPassword, user.password_hash)) {
                logger.warn('auth', 'CHANGE_PASSWORD_BAD_CURRENT', { userId: user.id });
                return res.status(401).json({ error: 'Senha atual incorreta' });
            }
            const ok = authDb.updatePassword(user.id, newPassword);
            if (!ok) {
                return res.status(500).json({ error: 'Falha ao atualizar senha' });
            }
            const token = jwt.sign(
                { id: user.id, username: user.username, role: user.role, mustChangePassword: false },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN }
            );
            setAuthCookie(res, token);
            logger.info('auth', 'PASSWORD_CHANGED', { userId: user.id });
            res.json({
                message: 'Senha alterada com sucesso',
                user: { id: user.id, username: user.username, email: user.email, role: user.role, mustChangePassword: false },
            });
        } catch (err) {
            logger.error('auth', 'CHANGE_PASSWORD_ERROR', { error: err.message });
            res.status(500).json({ error: 'Erro interno ao alterar senha' });
        }
    });

    app.post('/api/auth/logout', (req, res) => {
        clearAuthCookie(res);
        res.json({ message: 'Logout realizado com sucesso' });
    });
}

module.exports = {
    registerAuthRoutes,
    authenticateToken,
    requireRole,
    extractToken,
    AUTH_COOKIE_NAME
};
