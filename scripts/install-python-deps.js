const { execFileSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REQS = path.join(__dirname, '..', 'backend', 'ai', 'requirements.txt');
const PROJECT_ROOT = path.join(__dirname, '..');
const LOCAL_VENV = process.platform === 'win32'
    ? path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe')
    : path.join(PROJECT_ROOT, '.venv', 'bin', 'python');
const REQUIRED_IMPORTS = [
    'fastapi',
    'numpy',
    'scipy',
    'multipart',
    'requests',
    'tqdm',
    'dotenv',
];
const PACKAGE_BY_IMPORT = {
    fastapi: 'fastapi',
    numpy: 'numpy',
    scipy: 'scipy',
    multipart: 'python-multipart',
    requests: 'requests',
    tqdm: 'tqdm',
    dotenv: 'python-dotenv',
};

if (!fs.existsSync(REQS)) {
    console.log('[install-python-deps] requirements.txt not found at', REQS);
    process.exit(0);
}

const candidates = [];
if (fs.existsSync(LOCAL_VENV)) candidates.push(LOCAL_VENV);
candidates.push('python', 'python3');
if (process.platform === 'win32') candidates.push('py');

let pythonCmd = null;
for (const cmd of candidates) {
    try {
        execSync(`"${cmd}" --version`, { stdio: 'ignore' });
        execSync(`"${cmd}" -m pip --version`, { stdio: 'ignore' });
        pythonCmd = cmd;
        break;
    } catch (_) {}
}

if (!pythonCmd) {
    console.warn('[install-python-deps] Python not found. Install Python and run: pip install -r backend/ai/requirements.txt');
    process.exit(0);
}

function getRequirementSpec(pkgName) {
    const content = fs.readFileSync(REQS, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('--')) continue;
        if (trimmed.startsWith(`${pkgName}`)) return trimmed;
    }
    return pkgName;
}

function getMissingImports() {
    const command = [
        'import importlib.util',
        `mods = ${JSON.stringify(REQUIRED_IMPORTS)}`,
        'missing = [name for name in mods if importlib.util.find_spec(name) is None]',
        "print(','.join(missing))",
    ].join('\n');
    const output = execFileSync(pythonCmd, ['-c', command], { encoding: 'utf8' });
    return output
        .trim()
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

let missingImports = [];
try {
    missingImports = getMissingImports();
} catch (error) {
    console.warn('[install-python-deps] Failed to inspect Python environment:', error.message);
}

if (missingImports.length === 0) {
    console.log(`[install-python-deps] Python dependencies already installed in ${pythonCmd}.`);
    process.exit(0);
}

const packageSpecs = Array.from(new Set(
    missingImports.map((name) => getRequirementSpec(PACKAGE_BY_IMPORT[name] || name))
));

console.log(`[install-python-deps] Using Python: ${pythonCmd}`);
console.log(`[install-python-deps] Missing imports: ${missingImports.join(', ')}`);
console.log('[install-python-deps] Installing baseline Python dependencies...');
try {
    const args = ['-m', 'pip', 'install', ...packageSpecs];
    execSync(`"${pythonCmd}" ${args.map((arg) => `"${arg}"`).join(' ')}`, {
        stdio: 'inherit',
        timeout: 300000,
    });
    console.log('[install-python-deps] Done.');
} catch (e) {
    console.warn('[install-python-deps] Failed:', e.message);
    console.warn(`Run manually: "${pythonCmd}" -m pip install ${packageSpecs.join(' ')}`);
}
