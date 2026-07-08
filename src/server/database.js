const Datastore = require('@seald-io/nedb');
const path = require('path');

let presetsDb = null;
let mappingsDb = null;
let settingsDb = null;

/**
 * Inicializa os datastores com o diretório correto (userData do Electron).
 * Deve ser chamado uma vez em main.js antes de usar os DBs.
 * @param {string} dataDir - Caminho absoluto para o diretório de dados
 */
const COMPACT_INTERVAL_MS = 300000; // 5 minutos

let _compactTimers = [];

function _startAutoCompact(db, name) {
    const timer = setInterval(() => {
        try {
            db.compactDatafile();
        } catch (_) {
            console.warn(`[DB] Falha ao compactar ${name}`);
        }
    }, COMPACT_INTERVAL_MS);
    timer.unref();
    _compactTimers.push(timer);
}

function initDatabase(dataDir) {
    presetsDb = new Datastore({ filename: path.join(dataDir, 'presets.db'), autoload: true });
    mappingsDb = new Datastore({ filename: path.join(dataDir, 'mappings.db'), autoload: true });
    settingsDb = new Datastore({ filename: path.join(dataDir, 'settings.db'), autoload: true });

    mappingsDb.ensureIndex({ fieldName: 'hz' });
    mappingsDb.ensureIndex({ fieldName: 'date' });

    _startAutoCompact(presetsDb, 'presets');
    _startAutoCompact(mappingsDb, 'mappings');
    _startAutoCompact(settingsDb, 'settings');
}

function compactAll() {
    const dbs = [presetsDb, mappingsDb, settingsDb];
    const names = ['presets', 'mappings', 'settings'];
    for (let i = 0; i < dbs.length; i++) {
        if (dbs[i]) {
            try {
                dbs[i].compactDatafile();
            } catch (_) {
                console.warn(`[DB] Falha ao compactar ${names[i]}`);
            }
        }
    }
}

function stopAutoCompact() {
    for (const t of _compactTimers) clearInterval(t);
    _compactTimers = [];
}

module.exports = {
    get presets() {
        if (!presetsDb) throw new Error('Database não inicializado. Chame initDatabase() primeiro.');
        return presetsDb;
    },
    get mappings() {
        if (!mappingsDb) throw new Error('Database não inicializado. Chame initDatabase() primeiro.');
        return mappingsDb;
    },
    get settings() {
        if (!settingsDb) throw new Error('Database não inicializado. Chame initDatabase() primeiro.');
        return settingsDb;
    },
    initDatabase,
    compactAll,
    stopAutoCompact
};
