const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const cacheDir = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign');
const targetDir = path.join(cacheDir, 'winCodeSign-2.6.0');
const exe7z = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');

try {
    if (!fs.existsSync(cacheDir)) {
        console.error(`Cache directory does not exist: ${cacheDir}`);
        process.exit(1);
    }

    // Find any .7z file in the cache directory
    const files = fs.readdirSync(cacheDir);
    const zipFile = files.find(f => f.endsWith('.7z'));

    if (!zipFile) {
        console.error('No .7z file found in cache directory. Please run npm run dist once to let it download.');
        process.exit(1);
    }

    const zipPath = path.join(cacheDir, zipFile);
    console.log(`Using zip file: ${zipPath}`);
    console.log(`Target extraction directory: ${targetDir}`);

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        console.log(`Created target directory: ${targetDir}`);
    } else {
        console.log(`Target directory already exists: ${targetDir}`);
    }

    console.log('Running 7za to extract all files except the "darwin" directory...');
    // 7za.exe x <archive> -o<output_dir> -x!darwin -y
    execFile(exe7z, ['x', zipPath, `-o${targetDir}`, '-x!darwin', '-y'], (err, stdout, stderr) => {
        if (err) {
            console.error('Extraction failed:', err);
            console.error(stderr);
            process.exit(1);
        }
        console.log('Extraction completed successfully!');
        console.log(stdout);
        process.exit(0);
    });
} catch (e) {
    console.error('Error during cache preparation:', e);
    process.exit(1);
}
