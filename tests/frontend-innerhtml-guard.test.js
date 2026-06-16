import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function read(file) {
    return readFileSync(resolve(process.cwd(), file), 'utf8');
}

function collectMatches() {
    const output = execFileSync(
        'rg',
        ['-n', 'innerHTML\\s*=|insertAdjacentHTML|outerHTML\\s*=', 'frontend/js', 'frontend/mobile/js', 'src', '-S'],
        { cwd: process.cwd(), encoding: 'utf8' }
    );

    return output
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
            const [file, lineNo] = line.split(':', 3);
            return { file, line: Number(lineNo) };
        });
}

describe('frontend innerHTML guardrail', () => {
    const matches = collectMatches();
    const BASELINE_ASSIGNMENTS = 163;

    it('keeps the current assignment inventory from growing silently', () => {
        expect(matches.length).toBeLessThanOrEqual(BASELINE_ASSIGNMENTS);
    });

    it('requires the shared DOM sanitization utility to be loaded in the shell', () => {
        const shell = read('frontend/index.html');
        expect(shell).toContain('js/core/dom-sanitize.js');
    });

    it('hardens key dynamic renderers that ingest backend or AI data', () => {
        const autoEq = read('frontend/js/services/auto-eq-renderer.service.js');
        const hardware = read('frontend/js/pages/hardware-diagnostics-page.js');
        const benchmarking = read('frontend/js/pages/benchmarking-page.js');
        const feedback = read('frontend/js/pages/feedback-detector-page.js');
        const aes67 = read('frontend/js/pages/aes67-page.js');
        const analyzer = read('frontend/js/core/analyzer.js');
        const volunteer = read('frontend/js/services/volunteer.service.js');
        const settings = read('frontend/js/pages/settings-page.js');
        const app = read('frontend/js/core/app.js');
        const sanitize = read('frontend/js/core/dom-sanitize.js');
        const mixerAudio = read('frontend/js/services/mixer-audio-source.service.js');
        const audioSelector = read('frontend/js/ui/audio-source-selector.js');
        const debug = read('frontend/js/pages/debug-page.js');
        const mixerPanel = read('frontend/js/ui/mixer-panel.ui.js');
        const aiChat = read('frontend/js/pages/ai-chat-page.js');
        const feedbackDetectorCore = read('frontend/js/core/feedback-detector.js');
        const testbed = read('frontend/js/pages/testbed-page.js');

        expect(autoEq).toContain('function _setHtml(container, html)');
        expect(autoEq).toContain('_setHtml(container, html);');
        expect(autoEq).toContain('${_esc(f.name)}');

        expect(hardware).toContain("div.innerHTML = '<span class=\"text-cyan-400\">");
        expect(hardware).toContain("+ _esc(r);");
        expect(hardware).toContain("' Ch' + _esc(s.channel)");

        expect(benchmarking).toContain("_esc(name)");
        expect(benchmarking).toContain("_esc(dateStr)");
        expect(benchmarking).toContain("_esc(rt60Str)");

        expect(feedback).toContain('${_esc(item.hz)} Hz');
        expect(feedback).toContain('${_esc(item.time)}');

        expect(aes67).toContain('function _setHtml(el, html)');
        expect(aes67).toContain('${_esc(alert.code)}');
        expect(aes67).toContain('${_esc(alert.message)}');

        expect(analyzer).toContain('function _setHtml(el, html)');
        expect(analyzer).toContain('function _escapeHtmlText(value)');
        expect(analyzer).toContain('_setHtml(rt60El, `');
        expect(analyzer).toContain('_setHtml(resultEl, `');

        expect(volunteer).toContain('function _setHtml(el, html)');
        expect(volunteer).toContain('_setHtml(pinModal, `');
        expect(volunteer).toContain('_setHtml(grid, channels.map(ch => {');
        expect(volunteer).toContain('const safeName = _esc(preset.name);');

        expect(settings).toContain('function _setHtml(el, html)');
        expect(settings).toContain("var safeDesc = pm._esc(info.desc || '');");
        expect(settings).toContain("var safeSize = pm._esc(info.size || '-');");
        expect(settings).toContain('_setHtml(card, `');

        expect(app).toContain('function setShellHtml(container, html)');
        expect(app).toContain('setShellHtml(container, await res.text());');

        expect(sanitize).toContain('USE_PROFILES: { html: true }');

        expect(mixerAudio).toContain("inputSel.textContent = '';");
        expect(mixerAudio).toContain("outputSel.textContent = '';");
        expect(mixerAudio).toContain("const prefix = isUi24 ? '[Ui24] ' : '[Mic] ';");
        expect(mixerAudio).toContain("const prefix = isUi24 ? '[Ui24] ' : '[Out] ';");

        expect(audioSelector).toContain("inputSel.textContent = '';");
        expect(audioSelector).toContain("outputSel.textContent = '';");

        expect(debug).toContain('safeSetHtml(consoleDiv, logs.map(function (l) {');

        expect(mixerPanel).toContain("const label = document.createElement('span');");
        expect(mixerPanel).toContain("button.textContent = 'Carregar';");

        expect(aiChat).toContain('function _renderStepContent(el, text, icon, textClassName) {');
        expect(aiChat).toContain("textSpan.textContent = text == null ? '' : String(text);");

        expect(feedbackDetectorCore).toContain('function _setAlertMessage(feedbackAlert, parts) {');
        expect(feedbackDetectorCore).not.toContain('feedbackAlert.innerHTML =');

        expect(testbed).toContain("var title = document.createElement('div');");
        expect(testbed).toContain("description.textContent = scene.description || '';");
    });
});
