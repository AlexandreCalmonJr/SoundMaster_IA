import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path) {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function luminance(hex) {
    const rgb = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    const linear = rgb.map((value) => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('SoundMaster Design System', () => {
    const design = read('frontend/css/design-system.css');

    it('loads after generated and page-specific CSS in shell and iframe routes', () => {
        const index = read('frontend/index.html');
        const router = read('frontend/js/core/router.js');
        const serviceWorker = read('frontend/sw.js');
        expect(index.indexOf('css/design-system.css')).toBeGreaterThan(index.indexOf('css/styles.css'));
        expect(index.indexOf('css/design-system.css')).toBeGreaterThan(index.indexOf('css/rt60-integration.css'));
        expect(router).toContain('<link rel="stylesheet" href="css/design-system.css">');
        expect(router.indexOf('css/design-system.css')).toBeGreaterThan(router.indexOf('${conditionalCssTags}'));
        expect(serviceWorker).toContain("'/css/design-system.css'");
        expect(serviceWorker).toContain('soundmaster-v2-design-system');
    });

    it('defines one semantic token set for typography, surfaces, borders and radii', () => {
        expect(design).toContain("--sm-font-sans: 'Outfit'");
        expect(design).toContain('--sm-bg-canvas: #070b12');
        expect(design).toContain('--sm-bg-panel: #101826');
        expect(design).toContain('--sm-text-secondary: #a9b7c9');
        expect(design).toContain('--sm-radius-lg: 14px');
        expect(design).toContain('--sm-accent: #22d3ee');
    });

    it('keeps semantic text colors above WCAG AA contrast on primary surfaces', () => {
        const surfaces = ['#070b12', '#101826', '#151f2f'];
        const textColors = ['#f8fafc', '#e5edf7', '#a9b7c9', '#8291a6', '#22d3ee', '#4ade80', '#fbbf24', '#fb7185'];
        surfaces.forEach((surface) => {
            textColors.forEach((color) => expect(contrast(color, surface)).toBeGreaterThanOrEqual(4.5));
        });
    });

    it('enforces readable legacy labels and consistent controls', () => {
        expect(design).toContain('[class~="text-[7px]"]');
        expect(design).toContain('[class~="text-[8px]"]');
        expect(design).toContain('[class~="text-[9px]"]');
        expect(design).toContain('font-size: 10px !important');
        expect(design).toContain('min-height: 42px');
        expect(design).toContain('box-shadow: 0 0 0 3px var(--sm-accent-soft)');
    });

    it('covers every page fragment with the page-section design boundary', () => {
        const pagesDir = resolve(process.cwd(), 'frontend/pages');
        const pages = readdirSync(pagesDir).filter((name) => name.endsWith('.html'));
        const missing = pages.filter((name) => !read('frontend/pages/' + name).includes('page-section'));
        expect(missing).toEqual([]);
    });

    it('removes competing font families from special modules', () => {
        const mixerGit = read('frontend/css/mixer-git.css');
        const stagePlot = read('frontend/css/stage-plot.css');
        const rt60 = read('frontend/css/rt60-integration.css');
        expect(mixerGit).not.toContain("font-family:'Inter'");
        expect(stagePlot).not.toContain("'Inter'");
        expect(rt60).not.toContain("'JetBrains Mono'");
        expect(mixerGit).toContain('--sm-font-sans');
        expect(stagePlot).toContain('--sm-font-sans');
        expect(rt60).toContain('--sm-font-mono');
    });

    it('aligns mobile and authentication surfaces to the same palette and font', () => {
        const mobile = read('frontend/mobile/css/mobile.css');
        const mobileHtml = read('frontend/mobile/index.html');
        const auth = read('frontend/auth.html');
        expect(mobile).toContain('--bg:            #070b12');
        expect(mobile).toContain("--font-body:     'Outfit'");
        expect(mobile).toContain('font-size: 10px');
        expect(mobileHtml).toContain('family=Outfit');
        expect(auth).toContain('--bg: #070b12');
        expect(auth).toContain("--font: 'Outfit'");
    });
});
