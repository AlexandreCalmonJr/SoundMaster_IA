const express = require('express');
const jwt = require('jsonwebtoken');
const authDb = require('./auth-db');
const Logger = require('./logger');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('./jwt-config');

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
            const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

            res.status(201).json({
                message: 'Usuário criado com sucesso',
                user: { id: user.id, username: user.username, email: user.email },
                token,
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
            const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

            res.json({
                message: 'Login realizado com sucesso',
                user: { id: user.id, username: user.username, email: user.email, role: user.role },
                token,
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

    function authenticateToken(req, res, next) {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Token não fornecido' });
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.user = decoded;
            next();
        } catch (err) {
            return res.status(403).json({ error: 'Token inválido ou expirado' });
        }
    }
}

module.exports = { registerAuthRoutes };
