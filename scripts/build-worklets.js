/**
 * build-worklets.js
 * Minifica todos os AudioWorklet processors usando esbuild.
 * Saída: frontend/js/core/min/*.js
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'frontend', 'js', 'core');
const OUT = path.join(SRC, 'min');

const files = fs.readdirSync(SRC)
    .filter(f => f.endsWith('-processor.js') || f === 'signal-generators.js')
    .filter(f => f !== 'min'); // exclude min/ dir itself (strings only, but safe)

if (files.length === 0) {
    console.error('[build-worklets] Nenhum worklet encontrado em', SRC);
    process.exit(1);
}

async function build() {
    for (const file of files) {
        const entry = path.join(SRC, file);
        const outfile = path.join(OUT, file);
        console.log(`[build-worklets] Minificando ${file}...`);
        await esbuild.build({
            entryPoints: [entry],
            outfile,
            minify: true,
            allowOverwrite: true,
        });
    }
    const sizes = files.map(f => ({
        name: f,
        original: fs.statSync(path.join(SRC, f)).size,
        minified: fs.statSync(path.join(OUT, f)).size,
    }));
    console.log('\n[build-worklets] Resumo:');
    console.log('  Original  Minificado  Economia  Arquivo');
    for (const s of sizes) {
        const pct = ((1 - s.minified / s.original) * 100).toFixed(1);
        console.log(
            `  ${String(s.original).padStart(7)}B  ${String(s.minified).padStart(7)}B  ${pct.padStart(5)}%  ${s.name}`
        );
    }
    console.log(`\n[build-worklets] Concluído — ${files.length} worklets em ${OUT}`);
}

build().catch(err => { console.error(err); process.exit(1); });
