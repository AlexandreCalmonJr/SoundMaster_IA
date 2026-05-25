const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

let db = null;

function initDatabase(dbDir) {
    const dbPath = path.join(dbDir, 'soundmaster.sqlite');
    db = new Database(dbPath);

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // Gera usuário admin na primeira inicialização se a tabela estiver vazia
    try {
        const countStmt = db.prepare('SELECT COUNT(*) as count FROM users');
        const { count } = countStmt.get();
        if (count === 0) {
            console.log('[AuthDB] Tabela de usuários vazia. Criando usuário admin padrão...');
            const passwordHash = bcrypt.hashSync('admin', 10);
            const insertStmt = db.prepare(
                "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)"
            );
            insertStmt.run('admin', 'admin@soundmaster.local', passwordHash, 'admin');
            console.log('[AuthDB] Usuário admin padrão criado:');
            console.log(' - Usuário: admin');
            console.log(' - Senha: admin');
            console.log(' - Email: admin@soundmaster.local');
        }
    } catch (e) {
        console.error('[AuthDB] Erro ao criar usuário admin padrão:', e.message);
    }

    console.log('[AuthDB] SQLite initialized:', dbPath);
    return db;
}

function createUser(username, email, password) {
    const passwordHash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    );
    const result = stmt.run(username, email, passwordHash);
    return { id: result.lastInsertRowid, username, email };
}

function findUserByUsername(username) {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username) || null;
}

function findUserByEmail(email) {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email) || null;
}

function findUserById(id) {
    const stmt = db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?');
    return stmt.get(id) || null;
}

function verifyPassword(password, hash) {
    return bcrypt.compareSync(password, hash);
}

function getDb() {
    return db;
}

module.exports = {
    initDatabase,
    createUser,
    findUserByUsername,
    findUserByEmail,
    findUserById,
    verifyPassword,
    getDb,
};
