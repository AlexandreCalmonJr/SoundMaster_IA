/**
 * SoundMaster Pro - Crosshair Utility
 * Provides a professional HUD-style crosshair for canvas visualizations.
 * Supports Frequency (Hz) and Magnitude (dB/deg) display at cursor position.
 */
(function() {
    'use strict';

    /**
     * Calculates frequency from X coordinate on logarithmic frequency scale
     * @param {number} x - X coordinate in canvas pixels
     * @param {number} width - Canvas width in pixels
     * @param {number} minFreq - Minimum frequency (default 20 Hz)
     * @param {number} maxFreq - Maximum frequency (default 20000 Hz)
     * @returns {number} Frequency in Hz
     */
    function xToFrequency(x, width, minFreq = 20, maxFreq = 20000) {
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const xPercent = x / width;
        return Math.pow(10, logMin + xPercent * (logMax - logMin));
    }

    /**
     * Calculates magnitude from Y coordinate
     * @param {number} y - Y coordinate in canvas pixels (0 = top)
     * @param {number} height - Canvas height in pixels
     * @param {number} minDb - Minimum dB value (default -60)
     * @param {number} maxDb - Maximum dB value (default 0)
     * @returns {number} Magnitude in dB
     */
    function yToMagnitude(y, height, minDb = -60, maxDb = 0) {
        const yPercent = 1 - (y / height);
        return minDb + yPercent * (maxDb - minDb);
    }

    /**
     * Converts magnitude (dB) to Y coordinate
     * @param {number} db - Magnitude in dB
     * @param {number} height - Canvas height in pixels
     * @param {number} minDb - Minimum dB value
     * @param {number} maxDb - Maximum dB value
     * @returns {number} Y coordinate
     */
    function magnitudeToY(db, height, minDb = -60, maxDb = 0) {
        const normalized = (db - minDb) / (maxDb - minDb);
        return height * (1 - normalized);
    }

    /**
     * Draws a professional crosshair and tooltip on a canvas context.
     * @param {CanvasRenderingContext2D} ctx - The canvas context to draw on.
     * @param {number} x - Current mouse X (already scaled to canvas internal resolution).
     * @param {number} y - Current mouse Y (already scaled).
     * @param {Object} options - Customization options.
     */
    function draw(ctx, x, y, options = {}) {
        if (x < 0 || y < 0) return;

        const {
            width = ctx.canvas.width,
            height = ctx.canvas.height,
            color = '#f97316',
            labelX = '',
            labelY = '',
            precision = 1
        } = options;

        ctx.save();
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.stroke();

        const text = `${labelX}${labelY ? ' | ' + labelY : ''}`;
        ctx.font = 'bold 11px "JetBrains Mono", "Roboto Mono", monospace';
        const metrics = ctx.measureText(text);
        const padding = 8;
        const ttWidth = metrics.width + padding * 2;
        const ttHeight = 22;

        let ttX = x + 12;
        let ttY = y - 30;
        if (ttX + ttWidth > width) ttX = x - ttWidth - 12;
        if (ttY < 0) ttY = y + 12;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.fillRect(ttX, ttY, ttWidth, ttHeight);
        ctx.strokeRect(ttX, ttY, ttWidth, ttHeight);

        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, ttX + padding, ttY + ttHeight / 2);

        ctx.restore();
    }

    /**
     * Enhanced crosshair with automatic frequency/magnitude calculation
     * Works with any canvas that has data mapped to x=frequency, y=magnitude
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} x - Mouse X position
     * @param {number} y - Mouse Y position  
     * @param {Object} options - Drawing options
     */
    function drawProfessional(ctx, x, y, options = {}) {
        if (x < 0 || y < 0) return;

        const {
            width = ctx.canvas.width,
            height = ctx.canvas.height,
            color = '#f97316',
            minFreq = 20,
            maxFreq = 20000,
            minDb = -60,
            maxDb = 0,
            unit = 'dB',
            precision = 1
        } = options;

        const frequency = xToFrequency(x, width, minFreq, maxFreq);
        const magnitude = yToMagnitude(y, height, minDb, maxDb);

        const freqLabel = frequency >= 1000 
            ? `${(frequency / 1000).toFixed(precision)}kHz` 
            : `${Math.round(frequency)}Hz`;
        const magLabel = `${magnitude.toFixed(precision)} ${unit}`;

        draw(ctx, x, y, {
            width,
            height,
            color,
            labelX: freqLabel,
            labelY: magLabel,
            precision
        });
    }

    /**
     * Crosshair for RTA 1/3 octave bars
     * Calculates values based on IEC center frequencies
     */
    function drawRTA(ctx, x, y, options = {}) {
        if (x < 0 || y < 0) return;

        const {
            width = ctx.canvas.width,
            height = ctx.canvas.height,
            color = '#f97316',
            minDb = -100,
            maxDb = -10,
            axisOffset = 32,
            axisBottom = 14,
            spacing = 1,
            iecCenters = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 
                         500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 
                         6300, 8000, 10000, 12500, 16000, 20000]
        } = options;

        const plotW = width - axisOffset;
        const plotH = height - axisBottom;
        const numBands = iecCenters.length;
        const barWidth = (plotW - (spacing * (numBands - 1))) / numBands;
        
        const bandIndex = Math.floor((x - axisOffset) / (barWidth + spacing));
        const clampedIndex = Math.max(0, Math.min(numBands - 1, bandIndex));
        const centerFreq = iecCenters[clampedIndex];

        const magPercent = 1 - (y / plotH);
        const dbValue = minDb + magPercent * (maxDb - minDb);

        const freqLabel = centerFreq >= 1000 
            ? `${(centerFreq / 1000).toFixed(1)}kHz` 
            : `${centerFreq}Hz`;

        draw(ctx, x, y, {
            width,
            height,
            color,
            labelX: freqLabel,
            labelY: `${dbValue.toFixed(1)} dB`,
            precision: 1
        });
    }

    /**
     * Crosshair for Transfer Function (logarithmic frequency scale)
     */
    function drawTransferFunction(ctx, x, y, options = {}) {
        if (x < 0 || y < 0) return;

        let {
            width = ctx.canvas.width,
            height = ctx.canvas.height,
            color = '#22d3ee',
            minFreq = 20,
            maxFreq = 20000,
            zoomRange = 40,
            unit = 'dB',
            isPhase = false
        } = options;

        const frequency = xToFrequency(x, width, minFreq, maxFreq);
        
        let magnitude;
        if (isPhase) {
            const rangeDeg = zoomRange;
            magnitude = ((height / 2 - y) / height) * rangeDeg;
            unit = 'deg';
        } else {
            magnitude = ((height / 2 - y) / height) * zoomRange;
        }

        const freqLabel = frequency >= 1000 
            ? `${(frequency / 1000).toFixed(1)}kHz` 
            : `${Math.round(frequency)}Hz`;

        const magLabel = isPhase 
            ? `${magnitude.toFixed(0)}°` 
            : `${magnitude.toFixed(1)} ${unit}`;

        draw(ctx, x, y, {
            width,
            height,
            color,
            labelX: freqLabel,
            labelY: magLabel,
            precision: 1
        });
    }

    window.Crosshair = {
        draw,
        drawProfessional,
        drawRTA,
        drawTransferFunction,
        xToFrequency,
        yToMagnitude,
        magnitudeToY
    };
})();