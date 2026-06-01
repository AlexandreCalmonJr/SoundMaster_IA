// scripts/verify-electron-sqlite.js
// Smoke test: confirma que better-sqlite3 carrega dentro do Electron runtime.
// Uso: npx electron scripts/verify-electron-sqlite.js
const path = require('path');

let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    console.error('[FAIL] better-sqlite3 nao carrega neste runtime:', e.message);
    process.exit(1);
}

let db;
try {
    db = new Database(':memory:');
    db.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (42);');
    const row = db.prepare('SELECT x FROM t').get();
    if (row.x !== 42) throw new Error('SELECT retornou valor inesperado: ' + row.x);
    db.close();
} catch (e) {
    console.error('[FAIL] SQLite query falhou:', e.message);
    process.exit(1);
}

console.log(
    `[OK] better-sqlite3 funciona no Electron\n` +
    `     electron = ${process.versions.electron}\n` +
    `     node      = ${process.versions.node}\n` +
    `     modules   = ${process.versions.modules}`
);
process.exit(0);
