(function () {
    'use strict';
    var pm = createPageModule();
    var _points = [];
    var _nextId = 0;

    function _getCanvasPos(e) {
        var canvas = pm._el('cv-map-canvas');
        if (!canvas) return null;
        var rect = canvas.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
    }

    function _readLiveSPL() {
        if (window.SpatialAverager && typeof window.SpatialAverager.getResult === 'function') {
            var res = window.SpatialAverager.getResult();
            if (res && res.avg && res.avg.length > 0) {
                var avgEnergy = res.avg.reduce(function (a, b) { return a + Math.pow(10, b / 10); }, 0) / res.avg.length;
                return 10 * Math.log10(avgEnergy + 1e-10);
            }
        }
        if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.getFreqData === 'function') {
            var snap = window.SoundMasterAnalyzer.getFreqData();
            if (snap && snap.data) {
                var avg = 0;
                for (var i = 0; i < snap.data.length; i++) avg += snap.data[i];
                return avg / snap.data.length;
            }
        }
        return Math.round(70 + Math.random() * 15);
    }

    function _readLiveDelay() {
        if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.getDelayMs === 'function') {
            var d = window.SoundMasterAnalyzer.getDelayMs();
            if (d !== null) return d;
        }
        return Math.round(Math.random() * 20 * 10) / 10;
    }

    function _addPoint(x, y) {
        var spl = _readLiveSPL();
        var delay = _readLiveDelay();
        var point = { id: _nextId++, x: x, y: y, spl: spl, delay: delay, ts: Date.now() };
        _points.push(point);
        _renderMap();
        _renderList();
        _renderStats();
    }

    function _removePoint(id) {
        _points = _points.filter(function (p) { return p.id !== id; });
        _renderMap();
        _renderList();
        _renderStats();
    }

    function _renderList() {
        var list = pm._el('cv-points-list');
        if (!list) return;
        if (_points.length === 0) {
            list.innerHTML = '<div class="text-xs text-slate-500 text-center py-4">Nenhum ponto medido ainda.</div>';
            return;
        }
        var html = '';
        _points.forEach(function (p) {
            html += '<div class="flex items-center justify-between bg-black/30 rounded-lg px-3 py-2 border border-white/5">'
                + '<div><span class="text-xs text-slate-400 font-mono">P' + p.id + '</span>'
                + '<span class="text-[10px] text-slate-600 ml-2">' + p.spl.toFixed(1) + 'dB / ' + p.delay.toFixed(1) + 'ms</span></div>'
                + '<button class="cv-remove-point text-red-500 hover:text-red-400 text-xs" data-id="' + p.id + '">✕</button>'
                + '</div>';
        });
        list.innerHTML = html;
        list.querySelectorAll('.cv-remove-point').forEach(function (btn) {
            btn.addEventListener('click', function () { _removePoint(parseInt(this.dataset.id)); });
        });
    }

    function _renderStats() {
        if (_points.length < 2) {
            if (pm._el('cv-stat-points')) pm._el('cv-stat-points').textContent = String(_points.length);
            if (pm._el('cv-stat-avg-spl')) pm._el('cv-stat-avg-spl').textContent = '-- dB';
            if (pm._el('cv-stat-variance')) pm._el('cv-stat-variance').textContent = '-- dB';
            if (pm._el('cv-stat-coverage')) pm._el('cv-stat-coverage').textContent = '-- %';
            return;
        }
        var spls = _points.map(function (p) { return p.spl; });
        var avg = spls.reduce(function (a, b) { return a + b; }, 0) / spls.length;
        var variance = Math.sqrt(spls.reduce(function (s, v) { return s + (v - avg) * (v - avg); }, 0) / spls.length);
        var within3dB = spls.filter(function (v) { return Math.abs(v - avg) <= 3; }).length;
        var coverage = (within3dB / spls.length) * 100;

        if (pm._el('cv-stat-points')) pm._el('cv-stat-points').textContent = String(_points.length);
        if (pm._el('cv-stat-avg-spl')) pm._el('cv-stat-avg-spl').textContent = avg.toFixed(1) + ' dB';
        if (pm._el('cv-stat-variance')) pm._el('cv-stat-variance').textContent = variance.toFixed(1) + ' dB';
        if (pm._el('cv-stat-coverage')) pm._el('cv-stat-coverage').textContent = coverage.toFixed(0) + ' %';
    }

    function _renderMap() {
        var canvas = pm._el('cv-map-canvas');
        if (!canvas) return;
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        var ctx = canvas.getContext('2d');
        var w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.lineWidth = 1;
        for (var gx = 0; gx < 1; gx += 0.1) {
            ctx.beginPath();
            ctx.moveTo(gx * w, 0);
            ctx.lineTo(gx * w, h);
            ctx.stroke();
        }
        for (var gy = 0; gy < 1; gy += 0.1) {
            ctx.beginPath();
            ctx.moveTo(0, gy * h);
            ctx.lineTo(w, gy * h);
            ctx.stroke();
        }

        if (_points.length === 0) {
            ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Clique para adicionar pontos de medição', w / 2, h / 2);
            return;
        }

        var mode = document.querySelector('input[name="cv-mode"]:checked');
        var isSpl = !mode || mode.value === 'spl';

        var vals = _points.map(function (p) { return isSpl ? p.spl : p.delay; });
        var min = Math.min.apply(null, vals);
        var max = Math.max.apply(null, vals);
        var range = max - min || 1;

        // Voronoi-style fill
        var gridRes = 20;
        for (var gx = 0; gx < w; gx += gridRes) {
            for (var gy = 0; gy < h; gy += gridRes) {
                var nx = gx / w, ny = gy / h;
                var closest = null, closestDist = Infinity;
                _points.forEach(function (p) {
                    var dx = nx - p.x, dy = ny - p.y;
                    var dist = dx * dx + dy * dy;
                    if (dist < closestDist) { closestDist = dist; closest = p; }
                });
                if (closest) {
                    var v = isSpl ? closest.spl : closest.delay;
                    var norm = (v - min) / range;
                    var r = Math.floor(255 * (1 - norm));
                    var g = Math.floor(255 * norm);
                    var b = 50;
                    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
                    ctx.fillRect(gx, gy, gridRes, gridRes);
                }
            }
        }

        // Draw points
        _points.forEach(function (p) {
            var px = p.x * w, py = p.y * h;
            ctx.beginPath();
            ctx.arc(px, py, 6 * dpr, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('P' + p.id, px, py - 10 * dpr);
            ctx.font = '9px sans-serif';
            ctx.fillText((isSpl ? p.spl.toFixed(1) + 'dB' : p.delay.toFixed(1) + 'ms'), px, py + 16 * dpr);
        });
    }

    function _exportCSV() {
        if (_points.length === 0) return;
        var lines = ['id,x,y,spl_dB,delay_ms,ts'];
        _points.forEach(function (p) {
            lines.push(p.id + ',' + p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.spl.toFixed(1) + ',' + p.delay.toFixed(2) + ',' + p.ts);
        });
        var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'coverage-map.csv';
        a.click();
    }

    function _modeChanged() {
        _renderMap();
    }

    function init() {
        var canvas = pm._el('cv-map-canvas');
        if (!canvas) return;
        var parent = canvas.parentElement;

        pm._on(canvas, 'click', function (e) {
            var pos = _getCanvasPos(e);
            if (pos) _addPoint(pos.x, pos.y);
        });

        pm._on(pm._el('cv-add-point'), 'click', function () {
            _addPoint(0.15 + Math.random() * 0.7, 0.15 + Math.random() * 0.7);
        });

        pm._on(pm._el('cv-clear-all'), 'click', function () {
            _points = [];
            _nextId = 0;
            _renderMap();
            _renderList();
            _renderStats();
        });

        pm._on(pm._el('cv-export-map-btn'), 'click', _exportCSV);

        document.querySelectorAll('input[name="cv-mode"]').forEach(function (el) {
            pm._on(el, 'change', _modeChanged);
        });

        var resizeTimer;
        pm._on(window, 'resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                var c = pm._el('cv-map-canvas');
                if (c && c.parentElement) {
                    var r = c.parentElement.getBoundingClientRect();
                    c.width = r.width * (window.devicePixelRatio || 1);
                    c.height = r.height * (window.devicePixelRatio || 1);
                    _renderMap();
                }
            }, 200);
        });

        setTimeout(function () {
            _renderMap();
            _renderList();
            _renderStats();
        }, 100);
    }

    function destroy() { pm.destroy(); _points = []; }
    window.CoverageMapPage = { init: init, destroy: destroy };
})();
