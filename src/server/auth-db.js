const Datastore = require('@seald-io/nedb');
const path = require('path');
const bcrypt = require('bcryptjs');

let db = null;

function mapUser(doc) {
    if (!doc) return null;
    return {
        id: doc._id,
        username: doc.username,
        email: doc.email,
        password_hash: doc.password_hash,
        role: doc.role || 'user',
        must_change_password: doc.must_change_password !== undefined ? doc.must_change_password : 0,
        created_at: doc.created_at,
        updated_at: doc.updated_at
    };
}

function initDatabase(dbDir) {
    let config = { autoload: true };
    // Force in-memory database for tests to prevent ENOENT and deletion race conditions
    if (dbDir && dbDir !== ':memory:' && process.env.NODE_ENV !== 'test') {
        const dbPath = path.join(dbDir, 'auth_users.db');
        config.filename = dbPath;
        console.log('[AuthDB] NeDB initialized (File):', dbPath);
    } else {
        console.log('[AuthDB] NeDB initialized (In-Memory)');
    }
    db = new Datastore(config);
    db.ensureIndex({ fieldName: 'username', unique: true });
    db.ensureIndex({ fieldName: 'email', unique: true });

    // Queue admin user insertion immediately.
    const passwordHash = bcrypt.hashSync('admin', 10);
    db.insert({
        username: 'admin',
        email: 'admin@soundmaster.local',
        password_hash: passwordHash,
        role: 'admin',
        must_change_password: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }, (err) => {
        if (err && err.errorType !== 'uniqueViolated') {
            console.error('[AuthDB] Erro ao criar usuário admin padrão:', err.message);
        }
    });

    return db;
}

function createUser(username, email, password) {
    return new Promise((resolve, reject) => {
        const passwordHash = bcrypt.hashSync(password, 10);
        const newUser = {
            username,
            email,
            password_hash: passwordHash,
            role: 'user',
            must_change_password: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        db.insert(newUser, (err, doc) => {
            if (err) return reject(err);
            resolve(mapUser(doc));
        });
    });
}

function findUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.findOne({ username }, (err, doc) => {
            if (err) return reject(err);
            resolve(mapUser(doc));
        });
    });
}

function findUserByEmail(email) {
    return new Promise((resolve, reject) => {
        db.findOne({ email }, (err, doc) => {
            if (err) return reject(err);
            resolve(mapUser(doc));
        });
    });
}

function findUserById(id) {
    return new Promise((resolve, reject) => {
        db.findOne({ _id: id }, (err, doc) => {
            if (err) return reject(err);
            const user = mapUser(doc);
            if (user) {
                delete user.password_hash;
            }
            resolve(user);
        });
    });
}

function findUserByIdWithHash(id) {
    return new Promise((resolve, reject) => {
        db.findOne({ _id: id }, (err, doc) => {
            if (err) return reject(err);
            resolve(mapUser(doc));
        });
    });
}

function verifyPassword(password, hash) {
    return bcrypt.compareSync(password, hash);
}

function updatePassword(userId, newPassword) {
    return new Promise((resolve, reject) => {
        const passwordHash = bcrypt.hashSync(newPassword, 10);
        db.update(
            { _id: userId },
            { $set: { password_hash: passwordHash, must_change_password: 0, updated_at: new Date().toISOString() } },
            {},
            (err, numAffected) => {
                if (err) return reject(err);
                resolve(numAffected > 0);
            }
        );
    });
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
    findUserByIdWithHash,
    verifyPassword,
    updatePassword,
    getDb,
};
