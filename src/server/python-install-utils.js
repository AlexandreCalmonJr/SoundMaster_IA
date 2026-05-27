const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REQS_PATH = path.join(__dirname, '..', '..', 'backend', 'ai', 'requirements.txt');

function _parseRequirements() {
    const content = fs.readFileSync(REQS_PATH, 'utf8');
    const lines = content.split(/\r?\n/);
    const core = [];
    const optional = [];
    let section = 'core';
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            if (trimmed.includes('===== OPCIONAIS')) section = 'optional';
            continue;
        }
        (section === 'core' ? core : optional).push(trimmed);
    }
    return { core, optional };
}

function installCoreReqs(pythonCmd, onProgress) {
    const { core } = _parseRequirements();
    return _installList(pythonCmd, core, 'CORE', onProgress);
}

function installOptionalReqs(pythonCmd, onProgress) {
    const { optional } = _parseRequirements();
    const results = [];
    for (const pkg of optional) {
        const pkgName = pkg.split('>=')[0].split('<')[0].split('=')[0].replace(/;.*$/, '').trim();
        if (onProgress) onProgress(`Instalando ${pkgName} (opcional)...`);
        const r = spawnSync(pythonCmd, ['-m', 'pip', 'install', pkg, '--quiet'], {
            timeout: 300000,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        if (r.status === 0) {
            results.push({ name: pkgName, ok: true });
        } else {
            const stderr = r.stderr ? r.stderr.toString().slice(0, 200) : '';
            results.push({ name: pkgName, ok: false, error: stderr });
        }
    }
    return results;
}

function _installList(pythonCmd, packages, label, onProgress) {
    if (packages.length === 0) return true;
    if (onProgress) onProgress(`Instalando dependências ${label}...`);
    const reqContent = packages.join('\n');
    const tmpFile = path.join(
        path.dirname(REQS_PATH),
        `.requirements_${label.toLowerCase()}_tmp.txt`
    );
    try {
        fs.writeFileSync(tmpFile, reqContent, 'utf8');
        const r = spawnSync(pythonCmd, ['-m', 'pip', 'install', '-r', tmpFile, '--quiet'], {
            timeout: 300000,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        return r.status === 0;
    } catch (e) {
        return false;
    } finally {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
}

module.exports = { installCoreReqs, installOptionalReqs, REQS_PATH };
