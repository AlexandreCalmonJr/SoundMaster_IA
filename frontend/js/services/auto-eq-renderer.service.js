/**
 * SoundMaster — Auto-EQ Renderer
 * Renderiza gráficos, tabelas PEQ e barras GEQ para o módulo Auto-EQ.
 *
 * API Pública (window.AutoEqRenderer):
 *   .drawGraph(canvas, result, freqData, sampleRate, fftSize)
 *   .renderPEQ(container, peq)
 *   .renderGEQ(container, geq)
 *   .renderStats(stats, targetName)
 *   .demoFreqData(binCount, sampleRate) → Float32Array
 */

'use strict';

(function () {

    function _el(id) {
        const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    function _esc(value) {
        if (typeof window.escapeHTMLText === 'function') return window.escapeHTMLText(value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function _setHtml(container, html) {
        if (!container) return;
        if (typeof window.setSafeHTML === 'function') {
            window.setSafeHTML(container, html);
            return;
        }
        container.innerHTML = html;
    }

    // ── Graph ──

    function drawGraph(canvas, result, freqData, sampleRate, fftSize) {
        if (!canvas || !result) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const W = canvas.clientWidth || canvas.width;
        const H = canvas.clientHeight || canvas.height;
        if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
            canvas.width = W * dpr;
            canvas.height = H * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const PAD = { l: 48, r: 16, t: 16, b: 36 };
        const iW = W - PAD.l - PAD.r;
        const iH = H - PAD.t - PAD.b;

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0d1117';
        ctx.fillRect(0, 0, W, H);

        const DB_MIN = -60, DB_MAX = 6;

        function xForHz(hz) {
            return PAD.l + (Math.log10(hz / 20) / Math.log10(20000 / 20)) * iW;
        }
        function yForDb(db) {
            return PAD.t + (1 - (db - DB_MIN) / (DB_MAX - DB_MIN)) * iH;
        }

        // Grid
        ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1;
        [DB_MIN, -48, -36, -24, -12, 0, DB_MAX].forEach(db => {
            const y = yForDb(db);
            ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
            ctx.fillStyle = '#8b949e'; ctx.font = '10px Inter';
            ctx.fillText(db + 'dB', 2, y + 4);
        });

        const freqGridHz = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        freqGridHz.forEach(hz => {
            const x = xForHz(hz);
            ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
            ctx.fillStyle = '#8b949e'; ctx.font = '9px Inter';
            ctx.fillText(_fmtHzShort(hz), x - 8, H - 8);
        });

        // Measured spectrum
        if (freqData) {
            const hzPerBin = sampleRate / fftSize;
            ctx.beginPath(); ctx.strokeStyle = '#58a6ff'; ctx.lineWidth = 1.5;
            let first = true;
            for (let k = 1; k < freqData.length; k++) {
                const hz = k * hzPerBin;
                if (hz < 20 || hz > 20000) continue;
                const x = xForHz(hz), y = yForDb(freqData[k]);
                first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                first = false;
            }
            ctx.stroke();
        }

        // Target curve
        if (result.curve) {
            ctx.beginPath(); ctx.strokeStyle = '#e3b341'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
            result.curve.forEach((pt, i) => {
                const x = xForHz(pt.hz), y = yForDb(pt.targetDb);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.stroke(); ctx.setLineDash([]);
        }

        // Correction curve (GEQ)
        if (result.geq) {
            ctx.beginPath(); ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 2;
            result.geq.forEach((b, i) => {
                const x = xForHz(b.hz), y = yForDb(b.correctionDb);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.stroke();
        }
    }

    // ── PEQ Table ──

    function renderPEQ(container, peq) {
        if (!container) return;

        const badge = _el('aeq-peq-badge');
        if (badge) badge.textContent = peq.length;

        if (peq.length === 0) {
            _setHtml(container, '<div class="empty-state">Espectro dentro da curva alvo (desvio &lt; 0.5dB).</div>');
            return;
        }

        let html = '<table class="peq-table"><thead><tr><th>Banda</th><th>Freq</th><th>Ganho</th><th>Q</th><th>Zona</th></tr></thead><tbody>';
        peq.forEach(f => {
            const cls = f.gainDb > 0 ? 'gain-pos' : 'gain-neg';
            html += `<tr>
                <td>Band ${f.band}</td>
                <td>${_fmtHz(f.hz)}</td>
                <td class="${cls}">${f.gainDb > 0 ? '+' : ''}${f.gainDb} dB</td>
                <td>${f.q}</td>
                <td>${_esc(f.name)}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        _setHtml(container, html);
    }

    // ── GEQ Bars ──

    function renderGEQ(container, geq) {
        if (!container) return;

        const badge = _el('aeq-geq-badge');
        if (badge) badge.textContent = geq.filter(b => Math.abs(b.correctionDb) >= 0.5).length;

        const maxDb = 12;
        let html = '<div class="geq-grid">';
        geq.forEach(b => {
            const pct = Math.abs(b.correctionDb) / maxDb * 50;
            const isPos = b.correctionDb > 0;
            const style = isPos ? `height:${pct}%; bottom:0;` : `height:${pct}%; top:0;`;
            html += `<div class="geq-bar-wrap">
                <div class="geq-bar-track">
                    <div class="geq-bar-fill ${isPos ? 'pos' : 'neg'}" style="${style}"></div>
                </div>
                <div class="geq-label">${_fmtHzShort(b.hz)}</div>
            </div>`;
        });
        html += '</div>';
        html += '<div style="display:flex;justify-content:space-between;font-size:.65rem;color:var(--sub);margin-top:6px;"><span>−12dB</span><span>0dB</span><span>+12dB</span></div>';
        _setHtml(container, html);
    }

    // ── Stats ──

    function renderStats(stats, targetName) {
        const rmsEl = _el('aeq-stat-rms');
        const maxEl = _el('aeq-stat-max');
        const bandsEl = _el('aeq-stat-bands');
        const targetEl = _el('aeq-stat-target');

        if (rmsEl) rmsEl.textContent = stats.rms.toFixed(1) + ' dB';
        if (maxEl) maxEl.textContent = stats.max.toFixed(1) + ' dB';
        if (bandsEl) bandsEl.textContent = stats.bands;
        if (targetEl) targetEl.textContent = targetName || '—';
    }

    // ── Demo Data ──

    function demoFreqData(binCount, sr) {
        const data = new Float32Array(binCount);
        const hzPerBin = sr / (binCount * 2);
        for (let k = 1; k < binCount; k++) {
            const hz = k * hzPerBin;
            const pink = -10 * Math.log10(Math.max(hz, 1) / 1000);
            const roomMode = 4 * Math.exp(-Math.pow((Math.log10(hz) - Math.log10(250)), 2) / 0.05);
            data[k] = -40 + pink + roomMode + (Math.random() - 0.5) * 3;
        }
        return data;
    }

    // ── Helpers ──

    function _fmtHz(hz) {
        return hz >= 1000 ? (hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1) + 'kHz' : hz + 'Hz';
    }

    function _fmtHzShort(hz) {
        if (hz >= 10000) return (hz / 1000).toFixed(0) + 'k';
        if (hz >= 1000) return (hz / 1000).toFixed(1).replace('.0', '') + 'k';
        return hz >= 100 ? hz.toString() : hz.toString();
    }

    window.AutoEqRenderer = {
        drawGraph,
        renderPEQ,
        renderGEQ,
        renderStats,
        demoFreqData,
    };

    console.log('[AutoEqRenderer] Carregado.');
})();
