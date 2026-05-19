/**
 * SoundMaster — Schroeder Curve Renderer
 * Renderiza a curva de decaimento de Schroeder num canvas 2D.
 *
 * API Pública (window.SchroederRenderer):
 *   .draw(canvas, curveDb, params) → void
 *   .updateMetricCards(container, params) → void
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

    /**
     * Renderiza a curva de decaimento de Schroeder.
     *
     * @param {HTMLCanvasElement} canvas
     * @param {number[]} curveDb  - array de dB (0 → -60)
     * @param {object} params     - { rt60, t20, t30, edt, snr, c50, c80, d50, sti, sti_category }
     */
    function draw(canvas, curveDb, params) {
        if (!canvas || !curveDb || curveDb.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const W = rect.width;
        const H = rect.height;
        const PAD = { top: 10, right: 16, bottom: 24, left: 38 };
        const plotW = W - PAD.left - PAD.right;
        const plotH = H - PAD.top - PAD.bottom;

        const DB_MIN = -65;
        const DB_MAX = 2;
        const DB_RANGE = DB_MAX - DB_MIN;

        ctx.fillStyle = '#0a0f1a';
        ctx.fillRect(0, 0, W, H);

        // Grade horizontal (dB)
        const gridLevels = [0, -10, -20, -30, -40, -50, -60];
        ctx.font = '9px monospace';
        ctx.fillStyle = '#475569';
        ctx.textAlign = 'right';
        gridLevels.forEach(db => {
            const y = PAD.top + plotH * (1 - (db - DB_MIN) / DB_RANGE);
            ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
            ctx.fillText(`${db}`, PAD.left - 4, y + 3);
        });

        // Linhas de referência
        const refLines = [
            { db: -10, color: 'rgba(34,211,238,0.5)', label: '-10' },
            { db: -25, color: 'rgba(251,191,36,0.5)', label: '-25' },
            { db: -35, color: 'rgba(248,113,113,0.5)', label: '-35' },
        ];
        refLines.forEach(({ db, color }) => {
            const y = PAD.top + plotH * (1 - (db - DB_MIN) / DB_RANGE);
            ctx.strokeStyle = color;
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
            ctx.setLineDash([]);
        });

        // Curva com gradiente cyan → amber → red
        const n = curveDb.length;
        const grad = ctx.createLinearGradient(PAD.left, 0, PAD.left + plotW, 0);
        grad.addColorStop(0, '#22d3ee');
        grad.addColorStop(0.45, '#f59e0b');
        grad.addColorStop(1, '#ef4444');

        ctx.beginPath();
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 4;

        for (let i = 0; i < n; i++) {
            const x = PAD.left + (i / (n - 1)) * plotW;
            const dbClamped = Math.max(DB_MIN, Math.min(DB_MAX, curveDb[i] ?? DB_MIN));
            const y = PAD.top + plotH * (1 - (dbClamped - DB_MIN) / DB_RANGE);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Eixo X — rótulos de tempo
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.font = '9px monospace';
        const rt = parseFloat(params?.rt60) || 1.5;
        [[0, '0s'], [0.5, `${(rt / 2).toFixed(1)}s`], [1, `${rt.toFixed(1)}s`]].forEach(([pct, lbl]) => {
            const x = PAD.left + pct * plotW;
            ctx.fillText(lbl, x, H - 6);
        });
    }

    /**
     * Atualiza os cards de métricas no DOM.
     *
     * @param {object} params - { rt60, t20, t30, edt, c50, c80, d50, sti, sti_category }
     */
    function updateMetricCards(params) {
        const fmt = (v) => v != null ? `${parseFloat(v).toFixed(2)}s` : '--';

        const edtEl = _el('schroeder-edt');
        const t20El = _el('schroeder-t20');
        const t30El = _el('schroeder-t30');
        const rt60El = _el('schroeder-rt60');
        const c50El = _el('schroeder-c50');
        const c80El = _el('schroeder-c80');
        const d50El = _el('schroeder-d50');
        const stiEl = _el('schroeder-sti');

        if (edtEl) edtEl.textContent = fmt(params?.edt);
        if (t20El) t20El.textContent = fmt(params?.t20);
        if (t30El) t30El.textContent = fmt(params?.t30);
        if (rt60El) rt60El.textContent = fmt(params?.rt60);

        if (c50El && params?.c50 !== undefined) {
            c50El.textContent = params.c50 != null ? `${params.c50} dB` : '--';
            c50El.className = 'text-sm font-black ' + (params.c50 > 0 ? 'text-emerald-400' : params.c50 > -2 ? 'text-yellow-400' : 'text-red-400');
        }
        if (c80El && params?.c80 !== undefined) {
            c80El.textContent = params.c80 != null ? `${params.c80} dB` : '--';
            c80El.className = 'text-sm font-black ' + (params.c80 > 2 ? 'text-emerald-400' : params.c80 > 0 ? 'text-yellow-400' : 'text-red-400');
        }
        if (d50El && params?.d50 !== undefined) {
            d50El.textContent = params.d50 != null ? `${params.d50}%` : '--';
            d50El.className = 'text-sm font-black ' + (params.d50 > 50 ? 'text-emerald-400' : params.d50 > 35 ? 'text-yellow-400' : 'text-red-400');
        }
        if (stiEl && params?.sti !== undefined) {
            const stiStr = params.sti != null ? `${params.sti}` : '--';
            const stiCat = params.sti_category || '';
            stiEl.textContent = stiStr + (stiCat ? ' (' + stiCat.charAt(0) + ')' : '');
            stiEl.className = 'text-sm font-black ' + (params.sti >= 0.6 ? 'text-emerald-400' : params.sti >= 0.45 ? 'text-yellow-400' : 'text-red-400');
        }
    }

    window.SchroederRenderer = {
        draw,
        updateMetricCards,
    };

    console.log('[SchroederRenderer] Carregado.');
})();
