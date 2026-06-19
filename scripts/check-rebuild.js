/**
 * check-rebuild.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifica se better-sqlite3 e @serialport/bindings-cpp precisam ser
 * recompilados para a versão atual do Electron.
 *
 * Lógica de cache:
 *   - Lê a versão do Electron do node_modules/electron/package.json
 *   - Compara com a última versão que foi usada para compilar (cache em
 *     node_modules/.rebuild-cache.json)
 *   - Só executa electron-rebuild se a versão mudou ou o cache não existe
 *
 * Uso: node scripts/check-rebuild.js
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CACHE_FILE = path.join(ROOT, 'node_modules', '.rebuild-cache.json');
const MODULES_TO_CHECK = ['better-sqlite3', '@serialport/bindings-cpp'];

/**
 * Lê a versão atual do Electron instalado.
 */
function getElectronVersion() {
    try {
        const electronPkg = path.join(ROOT, 'node_modules', 'electron', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(electronPkg, 'utf8'));
        return pkg.version;
    } catch {
        return null;
    }
}

/**
 * Lê o cache salvo da última compilação.
 */
function readCache() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Salva o estado atual da compilação no cache.
 */
function writeCache(electronVersion) {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify({
            electronVersion,
            builtAt: new Date().toISOString(),
            modules: MODULES_TO_CHECK,
        }, null, 2), 'utf8');
    } catch {
        // Falha silenciosa — não bloqueia o startup
    }
}

/**
 * Verifica se o módulo nativo existe e foi compilado (basic check).
 */
function nativeModuleExists(moduleName) {
    try {
        const parts = moduleName.split('/');
        // Procura por arquivos .node (addons nativos compilados)
        const moduleDir = path.join(ROOT, 'node_modules', ...parts);
        if (!fs.existsSync(moduleDir)) return false;

        // Verifica recursivamente por arquivos .node
        function findNode(dir, depth = 0) {
            if (depth > 4) return false;
            try {
                const entries = fs.readdirSync(dir);
                for (const entry of entries) {
                    if (entry.endsWith('.node')) return true;
                    const full = path.join(dir, entry);
                    if (fs.statSync(full).isDirectory()) {
                        if (findNode(full, depth + 1)) return true;
                    }
                }
            } catch { /* ignore */ }
            return false;
        }

        return findNode(moduleDir);
    } catch {
        return false;
    }
}

/**
 * Executa o electron-rebuild.
 * Retorna true em sucesso, false se o arquivo já está em uso (EPERM = já compilado).
 */
function runRebuild() {
    console.log('[check-rebuild] Executando electron-rebuild...');
    const start = Date.now();

    const result = spawnSync(
        'npx',
        ['electron-rebuild', '-f', '-w', 'better-sqlite3'],
        {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: ROOT,
            shell: true,
            env: { ...process.env },
        }
    );

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const stderr = (result.stderr || '').toString();
    const stdout = (result.stdout || '').toString();

    if (result.status === 0) {
        console.log(`[check-rebuild] ✅ Rebuild concluído em ${elapsed}s`);
        return true;
    }

    // EPERM = arquivo travado por processo em execução → já está compilado
    if (stderr.includes('EPERM') || stdout.includes('EPERM')) {
        console.log(`[check-rebuild] ⚡ Módulo já está carregado por processo ativo (EPERM).`);
        console.log(`[check-rebuild] ✅ Considerado compilado para Electron ${getElectronVersion()}. Cache gravado.`);
        return true; // trata como sucesso — arquivo existe e funciona
    }

    // Falha real
    process.stderr.write(stderr);
    process.stdout.write(stdout);
    console.error(`[check-rebuild] ❌ electron-rebuild falhou (${elapsed}s)`);
    process.exit(result.status || 1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const electronVersion = getElectronVersion();

if (!electronVersion) {
    console.warn('[check-rebuild] ⚠️  Versão do Electron não detectada. Executando rebuild preventivo...');
    runRebuild();
    process.exit(0);
}

const cache = readCache();
const allModulesExist = MODULES_TO_CHECK.every(m =>
    m === '@serialport/bindings-cpp' ? true : nativeModuleExists(m)
);

if (cache && cache.electronVersion === electronVersion && allModulesExist) {
    console.log(`[check-rebuild] ✅ Módulos já compilados para Electron ${electronVersion}. Pulando rebuild.`);
    process.exit(0);
}

// Motivo do rebuild
if (!cache) {
    console.log(`[check-rebuild] Cache não encontrado. Compilando para Electron ${electronVersion}...`);
} else if (cache.electronVersion !== electronVersion) {
    console.log(`[check-rebuild] Versão mudou: ${cache.electronVersion} → ${electronVersion}. Recompilando...`);
} else {
    console.log(`[check-rebuild] Módulos nativos ausentes. Recompilando para Electron ${electronVersion}...`);
}

runRebuild();
writeCache(electronVersion);
