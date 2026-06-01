import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(p) {
    return readFileSync(resolve(process.cwd(), p), 'utf8');
}

describe('XSS - mobile.js user bubble (C-1 fe)', () => {
    const src = read('frontend/mobile/js/mobile.js');

    it('does not interpolate user text directly into innerHTML', () => {
        const idx = src.indexOf('async function askAI');
        expect(idx).toBeGreaterThan(-1);
        const slice = src.slice(idx, idx + 1500);
        expect(slice).not.toMatch(/innerHTML\s*=\s*`[^`]*\$\{text\}/);
    });

    it('uses textContent for the user message bubble', () => {
        const idx = src.indexOf('async function askAI');
        expect(idx).toBeGreaterThan(-1);
        const slice = src.slice(idx, idx + 1500);
        expect(slice).toMatch(/textContent\s*=\s*text\s*\|\|/);
    });
});

describe('XSS - mixer-git-page.js commit list (C-2 fe)', () => {
    const src = read('frontend/js/pages/mixer-git-page.js');

    it('escapes c._id in data-id attribute of commit item', () => {
        const re = /data-id="'\s*\+\s*pm\._esc\(c\._id\)\s*\+\s*'/;
        expect(src).toMatch(re);
    });

    it('escapes c._id in option value attribute', () => {
        const re = /<option value="'\s*\+\s*pm\._esc\(c\._id\)\s*\+\s*'">/;
        expect(src).toMatch(re);
    });

    it('does not interpolate raw c._id in any innerHTML', () => {
        const lines = src.split('\n');
        const offenders = lines.filter((l) => l.includes('innerHTML') && l.includes('c._id') && !l.includes('pm._esc(c._id)'));
        expect(offenders).toEqual([]);
    });
});

describe('XSS - rt60-mapping.js profile list (additional)', () => {
    let src;
    try {
        src = read('frontend/js/services/rt60-mapping.js');
    } catch {
        src = '';
    }

    it('does not interpolate profile name into onclick attribute', () => {
        expect(src).not.toMatch(/onclick="[^"]*\$\{name\}/);
    });

    it('uses addEventListener for apply/delete profile buttons', () => {
        expect(src).toMatch(/applyBtn\.addEventListener\('click'/);
        expect(src).toMatch(/delBtn\.addEventListener\('click'/);
    });

    it('uses textContent for the profile name display', () => {
        expect(src).toMatch(/nameEl\.textContent\s*=\s*name/);
    });
});

describe('XSS - page-utils.js escaper is comprehensive', () => {
    const src = read('frontend/js/core/page-utils.js');

    it('escapes &, <, >, ", and single quotes', () => {
        const escMatch = src.match(/function _esc\(s\)[\s\S]*?\n\s*\}/);
        expect(escMatch).toBeTruthy();
        const body = escMatch[0];
        expect(body).toMatch(/&/);
        expect(body).toMatch(/</);
        expect(body).toMatch(/>/);
        expect(body).toMatch(/"/);
        expect(body).toMatch(/'/);
    });

    it('uses .replace with a character class covering all five entities', () => {
        expect(src).toContain(".replace(/[&<>\"']/g");
    });

    it('returns the entity map with all five characters', () => {
        const mapMatch = src.match(/\(\{\s*'&':\s*'&amp;',[\s\S]*?\}\)/);
        expect(mapMatch).toBeTruthy();
        const map = mapMatch[0];
        expect(map).toMatch(/'&':\s*'&amp;'/);
        expect(map).toMatch(/'<':\s*'&lt;'/);
        expect(map).toMatch(/'>':\s*'&gt;'/);
        expect(map).toMatch(/'"':\s*'&quot;'/);
        expect(map).toMatch(/"'":\s*'&#39;'/);
    });
});
