const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const authDb = require('./auth-db');
const Logger = require('./logger');

function registerAuthRoutes(app) {
    const logger = Logger.getInstance();
    const SECRET_ENV = process.env.JWT_SECRET;
    if (!SECRET_ENV) {
        logger.warn('auth', 'JWT_SECRET_MISSING', { msg: 'Usando chave aleatória temporária — tokens inválidos após reinício' });
    }
    const JWT_SECRET = SECRET_ENV || crypto.randomBytes(64).toString('hex');
    const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
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

    app.post('/api/auth/login', (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({ error: 'Campos obrigatórios: username, password' });
            }

            const user = authDb.findUserByUsername(username);
            if (!user) {
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }

            const valid = authDb.verifyPassword(password, user.password_hash);
            if (!valid) {
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }

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
