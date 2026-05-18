'use strict';
(function () {
    var STORAGE_KEY = 'sm_stage_plot_v2';
    var actors = [];
    var nextId = 1;
    var dragActor = null;
    var dragOffX = 0, dragOffY = 0;
    var popupActor = null;
    var spatialActive = false;
    var _listeners = [];
    var _resizeObserver = null;

    function _on(target, event, handler) {
        if (!target) return;
        target.addEventListener(event, handler);
        _listeners.push({ target, event, handler });
    }

    function _pctToPos(pct) {
        var wrap = document.getElementById('sp-canvas-wrap');
        if (!wrap) return { x: 0, y: 0 };
        var r = wrap.getBoundingClientRect();
        return { x: pct.x * r.width, y: pct.y * r.height };
    }

    function _posToPct(x, y) {
        var wrap = document.getElementById('sp-canvas-wrap');
        if (!wrap) return { x: 0, y: 0 };
        var r = wrap.getBoundingClientRect();
        return { x: Math.max(0, Math.min(1, x / r.width)), y: Math.max(0, Math.min(1, y / r.height)) };
    }

    function _mkId() { return 'act_' + (nextId++) + '_' + Date.now(); }

    function _renderAll() {
        var wrap = document.getElementById('sp-canvas-wrap');
        if (!wrap) return;
        wrap.querySelectorAll('.sp-actor').forEach(function (el) { el.remove(); });
        actors.forEach(_renderActor);
        var countEl = document.getElementById('sp-actor-count');
        if (countEl) countEl.textContent = actors.length + ' instrumento' + (actors.length !== 1 ? 's' : '');
    }

    function _renderActor(a) {
        var wrap = document.getElementById('sp-canvas-wrap');
        if (!wrap) return;
        var pos = _pctToPos(a.pct);
        var el = document.createElement('div');
        el.className = 'sp-actor';
        el.id = 'actor_' + a.id;
        el.style.left = pos.x + 'px';
        el.style.top = pos.y + 'px';
        el.innerHTML =
            '<span class="sp-a-remove" title="Remover">✕</span>' +
            '<span class="sp-a-icon">' + a.icon + '</span>' +
            '<span class="sp-a-label">' + (a.name || a.label) + '</span>' +
            (a.channel ? '<span class="sp-a-ch">CH ' + a.channel + '</span>' : '');

        _on(el, 'pointerdown', function (e) {
            if (e.target.classList.contains('sp-a-remove')) return;
            e.preventDefault();
            dragActor = a;
            var r = el.getBoundingClientRect();
            dragOffX = e.clientX - r.left - r.width / 2;
            dragOffY = e.clientY - r.top - r.height / 2;
            el.style.zIndex = 999;
            el.classList.add('selected');
            el.setPointerCapture(e.pointerId);
        });

        _on(el, 'pointermove', function (e) {
            if (!dragActor || dragActor.id !== a.id) return;
            var wrapRect = wrap.getBoundingClientRect();
            var x = e.clientX - wrapRect.left - dragOffX;
            var y = e.clientY - wrapRect.top - dragOffY;
            el.style.left = x + 'px';
            el.style.top = y + 'px';
        });

        _on(el, 'pointerup', function (e) {
            if (!dragActor || dragActor.id !== a.id) return;
            var wrapRect = wrap.getBoundingClientRect();
            var x = e.clientX - wrapRect.left - dragOffX;
            var y = e.clientY - wrapRect.top - dragOffY;
            a.pct = _posToPct(x, y);
            dragActor = null;
            el.classList.remove('selected');
            el.style.zIndex = '';
        });

        var clickStartX, clickStartY;
        _on(el, 'pointerdown', function (e) { clickStartX = e.clientX; clickStartY = e.clientY; }, { passive: true });
        _on(el, 'click', function (e) {
            if (e.target.classList.contains('sp-a-remove')) { _removeActor(a.id); return; }
            var dx = Math.abs(e.clientX - clickStartX), dy = Math.abs(e.clientY - clickStartY);
            if (dx < 5 && dy < 5) _openPopup(a, e.clientX, e.clientY);
        });

        wrap.appendChild(el);
    }

    function _openPopup(a, cx, cy) {
        popupActor = a;
        var popup = document.getElementById('sp-ch-popup');
        var popTitle = document.getElementById('sp-popup-title');
        var popName = document.getElementById('sp-popup-name');
        var popCh = document.getElementById('sp-popup-channel');
        if (!popup) return;
        if (popTitle) popTitle.textContent = '⚙️ ' + a.icon + ' ' + a.label;
        if (popName) popName.value = a.name || '';
        if (popCh) popCh.value = a.channel || '';
        var pw = 240, ph = 200;
        var vw = window.innerWidth, vh = window.innerHeight;
        popup.style.left = Math.min(cx + 12, vw - pw - 12) + 'px';
        popup.style.top = Math.min(cy + 12, vh - ph - 12) + 'px';
        popup.style.display = 'block';
        setTimeout(function () { if (popName) popName.focus(); }, 50);
    }

    function _closePopup() {
        var popup = document.getElementById('sp-ch-popup');
        if (popup) popup.style.display = 'none';
        popupActor = null;
    }

    function _removeActor(id) {
        actors = actors.filter(function (a) { return a.id !== id; });
        var el = document.getElementById('actor_' + id);
        if (el) el.remove();
        var countEl = document.getElementById('sp-actor-count');
        if (countEl) countEl.textContent = actors.length + ' instrumento' + (actors.length !== 1 ? 's' : '');
        _syncSpatialSources();
    }

    function _syncSpatialSources() {
        if (!window.SpatialAverager || !spatialActive) return;
        actors.filter(function (a) { return a.channel; }).forEach(function (a) {
            var id = 'stage_' + a.channel;
            if (!SpatialAverager.isActive()) return;
            SpatialAverager.addSource(id, ('CH' + a.channel + ' ' + (a.name || a.label)).slice(0, 14));
        });
    }

    function _openMixerChannel(ch) {
        if (window.router) router.navigate('mixer-input');
        setTimeout(function () {
            var qch = document.getElementById('quick-channel-number');
            if (qch) { qch.value = ch; qch.dispatchEvent(new Event('input')); }
            var tab = document.querySelector('[data-tab="mixer-actions"]') || document.querySelector('.mixer-tab-btn');
            if (tab) tab.click();
            document.dispatchEvent(new CustomEvent('stage-plot-channel-open', { detail: { channel: ch, actor: popupActor } }));
            if (window.AppStore && AppStore.addLog) AppStore.addLog('🎭 Stage Plot: Canal ' + ch + ' aberto via palco.');
        }, 300);
    }

    function _drawGrid() {
        var canvas = document.getElementById('sp-canvas');
        var wrap = document.getElementById('sp-canvas-wrap');
        if (!canvas || !wrap) return;
        canvas.width = wrap.clientWidth;
        canvas.height = wrap.clientHeight;
        var ctx = canvas.getContext('2d');
        var w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        var grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(6,182,212,.04)');
        grad.addColorStop(0.5, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(99,102,241,.04)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,.04)';
        ctx.lineWidth = 1;
        var cols = 8, rows = 6;
        for (var c = 1; c < cols; c++) {
            ctx.beginPath(); ctx.moveTo(c / cols * w, 0); ctx.lineTo(c / cols * w, h); ctx.stroke();
        }
        for (var r = 1; r < rows; r++) {
            ctx.beginPath(); ctx.moveTo(0, r / rows * h); ctx.lineTo(w, r / rows * h); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(6,182,212,.12)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(2, 2, w - 4, h - 4);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(6,182,212,.08)';
        ctx.strokeRect(w * 0.1, h * 0.08, w * 0.8, h * 0.84);
        ctx.setLineDash([]);
    }

    function init() {
        var wrap = document.getElementById('sp-canvas-wrap');
        var popup = document.getElementById('sp-ch-popup');

        _drawGrid();
        _renderAll();

        _resizeObserver = new ResizeObserver(function () { _drawGrid(); _renderAll(); });
        if (wrap) _resizeObserver.observe(wrap);

        document.querySelectorAll('.sp-palette-item').forEach(function (item) {
            _on(item, 'dragstart', function (e) {
                e.dataTransfer.setData('application/json', JSON.stringify({
                    type: item.dataset.type,
                    icon: item.dataset.icon,
                    label: item.dataset.label,
                }));
                e.dataTransfer.effectAllowed = 'copy';
            });
        });

        _on(wrap, 'dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });

        _on(wrap, 'drop', function (e) {
            e.preventDefault();
            try {
                var data = JSON.parse(e.dataTransfer.getData('application/json'));
                var wrapRect = wrap.getBoundingClientRect();
                var x = e.clientX - wrapRect.left;
                var y = e.clientY - wrapRect.top;
                var actor = { id: _mkId(), type: data.type, icon: data.icon, label: data.label, name: '', channel: null, pct: _posToPct(x, y) };
                actors.push(actor);
                _renderAll();
                setTimeout(function () { _openPopup(actor, e.clientX, e.clientY); }, 80);
            } catch (_) {}
        });

        _on(document.getElementById('sp-popup-confirm'), 'click', function () {
            if (!popupActor) return;
            var popName = document.getElementById('sp-popup-name');
            var popCh = document.getElementById('sp-popup-channel');
            popupActor.name = (popName && popName.value.trim()) || popupActor.label;
            popupActor.channel = (popCh && parseInt(popCh.value)) || null;
            _closePopup();
            _renderAll();
            _syncSpatialSources();
        });

        _on(document.getElementById('sp-popup-open-ch'), 'click', function () {
            if (!popupActor || !popupActor.channel) { alert('Defina um número de canal primeiro.'); return; }
            _openMixerChannel(popupActor.channel);
            _closePopup();
        });

        _on(document.getElementById('sp-popup-cancel'), 'click', _closePopup);

        _on(document, 'click', function (e) {
            if (!popup.contains(e.target) && !e.target.closest('.sp-actor')) _closePopup();
        });

        _on(document.getElementById('sp-btn-save'), 'click', function () {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(actors));
            var btn = document.getElementById('sp-btn-save');
            if (btn) { btn.textContent = '✅ Salvo!'; setTimeout(function () { btn.textContent = '💾 Salvar Layout'; }, 1500); }
        });

        _on(document.getElementById('sp-btn-load'), 'click', function () {
            try {
                var raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) { alert('Nenhum layout salvo.'); return; }
                actors = JSON.parse(raw);
                nextId = actors.reduce(function (m, a) {
                    var n = parseInt((a.id || '').split('_')[1]);
                    return n > m ? n + 1 : m;
                }, 1);
                _renderAll();
            } catch (e) { alert('Erro ao carregar layout: ' + e.message); }
        });

        _on(document.getElementById('sp-btn-clear'), 'click', function () {
            if (!confirm('Limpar o palco?')) return;
            actors = [];
            if (wrap) wrap.querySelectorAll('.sp-actor').forEach(function (el) { el.remove(); });
            var countEl = document.getElementById('sp-actor-count');
            if (countEl) countEl.textContent = '0 instrumentos';
        });

        _on(document.getElementById('sp-btn-export'), 'click', function () { window.print(); });

        _on(document.getElementById('sp-btn-spatial'), 'click', async function () {
            if (!window.SpatialAverager) { alert('SpatialAverager não disponível. Carregue a página de Análise primeiro.'); return; }
            var btn = document.getElementById('sp-btn-spatial');
            var badge = document.getElementById('sp-spatial-badge');
            if (spatialActive) {
                await SpatialAverager.stop();
                spatialActive = false;
                if (badge) badge.style.display = 'none';
                if (btn) btn.textContent = '🎙️ Ativar Média Espacial';
            } else {
                var mics = await SpatialAverager.startMultiDevice(Math.min(actors.filter(function (a) { return a.channel; }).length || 2, 8));
                spatialActive = mics.length > 0;
                if (badge) badge.style.display = spatialActive ? 'block' : 'none';
                if (btn) btn.textContent = spatialActive ? '⏹ Parar Spatial Avg' : '🎙️ Ativar Média Espacial';
                _syncSpatialSources();
            }
        });

        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) { actors = JSON.parse(raw); _renderAll(); }
        } catch (_) {}
    }

    function destroy() {
        _listeners.forEach(function (l) { l.target.removeEventListener(l.event, l.handler); });
        _listeners = [];
        if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
        actors = [];
        dragActor = null;
        popupActor = null;
        spatialActive = false;
    }

    window.StagePlotPage = { init: init, destroy: destroy };
})();
