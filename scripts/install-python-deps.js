const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REQS = path.join(__dirname, '..', 'backend', 'ai', 'requirements.txt');

if (!fs.existsSync(REQS)) {
    console.log('[install-python-deps] requirements.txt not found at', REQS);
    process.exit(0);
}

const candidates = ['python', 'python3'];
if (process.platform === 'win32') candidates.push('py');

let pythonCmd = null;
for (const cmd of candidates) {
    try {
        execSync(`"${cmd}" --version`, { stdio: 'ignore' });
        pythonCmd = cmd;
        break;
    } catch (_) {}
}

if (!pythonCmd) {
    console.warn('[install-python-deps] Python not found. Install Python and run: pip install -r backend/ai/requirements.txt');
    process.exit(0);
}

// Check if fastapi is already installed
try {
    execSync(`"${pythonCmd}" -c "import fastapi"`, { stdio: 'ignore' });
    console.log('[install-python-deps] Python dependencies already installed.');
    process.exit(0);
} catch (_) {}

console.log('[install-python-deps] Installing Python dependencies (pip install -r requirements.txt)...');
try {
    execSync(`"${pythonCmd}" -m pip install -r "${REQS}"`, { stdio: 'inherit', timeout: 300000 });
    console.log('[install-python-deps] Done.');
} catch (e) {
    console.warn('[install-python-deps] Failed:', e.message);
    console.warn('Run manually: pip install -r backend/ai/requirements.txt');
}
