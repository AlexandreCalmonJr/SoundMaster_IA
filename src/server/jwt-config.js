/**
 * SoundMaster — JWT Secret Module
 * Shared JWT secret for authentication across all server modules.
 */
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

if (!process.env.JWT_SECRET) {
    console.warn('[Auth] JWT_SECRET não definido. Tokens serão inválidos após reinício do servidor.');
}

module.exports = { JWT_SECRET, JWT_EXPIRES_IN };
