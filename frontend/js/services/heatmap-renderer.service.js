/**
 * SoundMaster — Heatmap Renderer Service
 * Renderiza o mapa de calor SPL sobre a planta baixa.
 *
 * API Pública (window.HeatmapRenderer):
 *   .drawPins(container, points)
 *   .drawHeatmap(canvas, points, width, height)
 *   .getColorForDb(db) → string
 */

'use strict';

(function () {

    /**
     * Renderiza os pins de medição no container.
     *
     * @param {HTMLElement} container
     * @param {Array} points - [{ x%, y%, db, label }]
     */
    function drawPins(container, points) {
        if (!container) return;
        container.innerHTML = '';

        points.forEach((p, i) => {
            const pin = document.createElement('div');
            pin.className = 'absolute w-5 h-5 rounded-full border-2 border-white/80 shadow-lg transform -translate-x-1/2 -translate-y-1/2 cursor-pointer hover:scale-125 transition-transform pointer-events-auto';
            pin.style.left = p.x + '%';
            pin.style.top = p.y + '%';
            pin.style.backgroundColor = _getColorForDb(p.db);
            pin.title = `${p.label || 'Ponto ' + (i + 1)}: ${p.db.toFixed(1)} dB`;
            pin.setAttribute('data-index', i);
            container.appendChild(pin);
        });
    }

    /**
     * Renderiza o heatmap (gradientes) no canvas.
     *
     * @param {HTMLCanvasElement} canvas
     * @param {Array} points - [{ x%, y%, db }]
     * @param {number} width
     * @param {number} height
     */
    function drawHeatmap(canvas, points, width, height) {
        if (!canvas || !points || points.length === 0) return;

        const ctx = canvas.getContext('2d');
        canvas.width = width;
        canvas.height = height;
        ctx.clearRect(0, 0, width, height);

        const radius = Math.min(width, height) * 0.15;

        points.forEach(p => {
            const px = (p.x / 100) * width;
            const py = (p.y / 100) * height;
            const color = _getColorForDb(p.db);

            const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, 'rgba(0,0,0,0)');

            ctx.fillStyle = gradient;
            ctx.fillRect(px - radius, py - radius, radius * 2, radius * 2);
        });
    }

    function _getColorForDb(db) {
        if (db >= 100) return 'rgb(255, 0, 0)';
        if (db >= 95) return 'rgb(255, 100, 0)';
        if (db >= 90) return 'rgb(0, 255, 0)';
        if (db >= 85) return 'rgb(0, 200, 100)';
        if (db >= 80) return 'rgb(0, 100, 255)';
        return 'rgb(0, 0, 255)';
    }

    window.HeatmapRenderer = {
        drawPins,
        drawHeatmap,
        getColorForDb: _getColorForDb,
    };

    console.log('[HeatmapRenderer] Carregado.');
})();
