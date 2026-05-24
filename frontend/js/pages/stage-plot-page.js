'use strict';
(function () {
    var pm = createPageModule();
    var STORAGE_KEY = 'sm_stage_plot_v2';
    var actors = [], nextId = 1, dragActor = null, dragOffX = 0, dragOffY = 0, popupActor = null, spatialActive = false, _resizeObserver = null;

    function _pctToPos(pct) { var wrap = pm._el('sp-canvas-wrap'); if (!wrap) return { x: 0, y: 0 }; var r = wrap.getBoundingClientRect(); return { x: pct.x * r.width, y: pct.y * r.height }; }
    function _posToPct(x, y) { var wrap = pm._el('sp-canvas-wrap'); if (!wrap) return { x: 0, y: 0 }; var r = wrap.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, x / r.width)), y: Math.max(0, Math.min(1, y / r.height)) }; }
    function _mkId() { return 'act_' + (nextId++) + '_' + Date.now(); }

    function _renderAll() {
        var wrap = pm._el('sp-canvas-wrap'); if (!wrap) return;
        wrap.querySelectorAll('.sp-actor').forEach(function (el) { el.remove(); });
        actors.forEach(_renderActor);
        pm._setText('sp-actor-count', actors.length + ' instrumento' + (actors.length !== 1 ? 's' : ''));
    }

    function _renderActor(a) {
        var wrap = pm._el('sp-canvas-wrap'); if (!wrap) return;
        var pos = _pctToPos(a.pct), el = document.createElement('div');
        el.className = 'sp-actor'; el.id = 'actor_' + a.id;
        el.style.left = pos.x + 'px'; el.style.top = pos.y + 'px';
        el.innerHTML = '<span class="sp-a-remove" title="Remover">\u2715</span><span class="sp-a-icon">' + a.icon + '</span><span class="sp-a-label">' + (a.name || a.label) + '</span>' + (a.channel ? '<span class="sp-a-ch">CH ' + a.channel + '</span>' : '');
        pm._on(el, 'pointerdown', function (e) { if (e.target.classList.contains('sp-a-remove')) return; e.preventDefault(); dragActor = a; var r = el.getBoundingClientRect(); dragOffX = e.clientX - r.left - r.width / 2; dragOffY = e.clientY - r.top - r.height / 2; el.style.zIndex = 999; el.classList.add('selected'); el.setPointerCapture(e.pointerId); });
        pm._on(el, 'pointermove', function (e) { if (!dragActor || dragActor.id !== a.id) return; var wr = wrap.getBoundingClientRect(); el.style.left = (e.clientX - wr.left - dragOffX) + 'px'; el.style.top = (e.clientY - wr.top - dragOffY) + 'px'; });
        pm._on(el, 'pointerup', function (e) { if (!dragActor || dragActor.id !== a.id) return; var wr = wrap.getBoundingClientRect(); a.pct = _posToPct(e.clientX - wr.left - dragOffX, e.clientY - wr.top - dragOffY); dragActor = null; el.classList.remove('selected'); el.style.zIndex = ''; });
        var csx, csy;
        pm._on(el, 'pointerdown', function (e) { csx = e.clientX; csy = e.clientY; }, { passive: true });
        pm._on(el, 'click', function (e) { if (e.target.classList.contains('sp-a-remove')) { _removeActor(a.id); return; } if (Math.abs(e.clientX - csx) < 5 && Math.abs(e.clientY - csy) < 5) _openPopup(a, e.clientX, e.clientY); });
        wrap.appendChild(el);
    }

    function _openPopup(a, cx, cy) {
        popupActor = a; var popup = pm._el('sp-ch-popup'), popTitle = pm._el('sp-popup-title'), popName = pm._el('sp-popup-name'), popCh = pm._el('sp-popup-channel');
        if (!popup) return;
        if (popTitle) popTitle.textContent = '\u2699\uFE0F ' + a.icon + ' ' + a.label;
        if (popName) popName.value = a.name || '';
        if (popCh) popCh.value = a.channel || '';
        popup.style.left = Math.min(cx + 12, window.innerWidth - 252) + 'px';
        popup.style.top = Math.min(cy + 12, window.innerHeight - 212) + 'px';
        popup.style.display = 'block';
        pm._setTimeout(function () { if (popName) popName.focus(); }, 50);
    }

    function _closePopup() { var popup = pm._el('sp-ch-popup'); if (popup) popup.style.display = 'none'; popupActor = null; }

    function _removeActor(id) { actors = actors.filter(function (a) { return a.id !== id; }); var el = pm._el('actor_' + id); if (el) el.remove(); pm._setText('sp-actor-count', actors.length + ' instrumento' + (actors.length !== 1 ? 's' : '')); _syncSpatialSources(); }

    function _syncSpatialSources() { if (!window.SpatialAverager || !spatialActive) return; actors.filter(function (a) { return a.channel; }).forEach(function (a) { var id = 'stage_' + a.channel; if (!SpatialAverager.isActive()) return; SpatialAverager.addSource(id, ('CH' + a.channel + ' ' + (a.name || a.label)).slice(0, 14)); }); }

    function _openMixerChannel(ch) {
        pm._safeCall('router', 'navigate', 'mixer-input');
        pm._setTimeout(function () {
            var qch = pm._el('quick-channel-number');
            if (qch) { qch.value = ch; qch.dispatchEvent(new Event('input')); }
            var tab = document.querySelector('[data-tab="mixer-actions"]') || document.querySelector('.mixer-tab-btn');
            if (tab) tab.click();
            document.dispatchEvent(new CustomEvent('stage-plot-channel-open', { detail: { channel: ch, actor: popupActor } }));
            pm._safeCall('AppStore', 'addLog', '\uD83C\uDFAD Stage Plot: Canal ' + ch + ' aberto via palco.');
        }, 300);
    }

    function _drawGrid() {
        var canvas = pm._el('sp-canvas'), wrap = pm._el('sp-canvas-wrap');
        if (!canvas || !wrap) return;
        canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight;
        var ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        var grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, 'rgba(6,182,212,.04)'); grad.addColorStop(0.5, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(99,102,241,.04)');
        ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 1;
        for (var c = 1; c < 8; c++) { ctx.beginPath(); ctx.moveTo(c / 8 * w, 0); ctx.lineTo(c / 8 * w, h); ctx.stroke(); }
        for (var r = 1; r < 6; r++) { ctx.beginPath(); ctx.moveTo(0, r / 6 * h); ctx.lineTo(w, r / 6 * h); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(6,182,212,.12)'; ctx.lineWidth = 1.5; ctx.strokeRect(2, 2, w - 4, h - 4);
        ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(6,182,212,.08)'; ctx.strokeRect(w * 0.1, h * 0.08, w * 0.8, h * 0.84); ctx.setLineDash([]);
    }

    function init() {
        var wrap = pm._el('sp-canvas-wrap'), popup = pm._el('sp-ch-popup');
        _drawGrid(); _renderAll();
        _resizeObserver = new ResizeObserver(function () { _drawGrid(); _renderAll(); });
        if (wrap) _resizeObserver.observe(wrap);

        document.querySelectorAll('.sp-palette-item').forEach(function (item) { pm._on(item, 'dragstart', function (e) { e.dataTransfer.setData('application/json', JSON.stringify({ type: item.dataset.type, icon: item.dataset.icon, label: item.dataset.label })); e.dataTransfer.effectAllowed = 'copy'; }); });
        pm._on(wrap, 'dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        pm._on(wrap, 'drop', function (e) { e.preventDefault(); try { var data = JSON.parse(e.dataTransfer.getData('application/json')), wr = wrap.getBoundingClientRect(), actor = { id: _mkId(), type: data.type, icon: data.icon, label: data.label, name: '', channel: null, pct: _posToPct(e.clientX - wr.left, e.clientY - wr.top) }; actors.push(actor); _renderAll(); pm._setTimeout(function () { _openPopup(actor, e.clientX, e.clientY); }, 80); } catch (_) {} });

        pm._on(pm._el('sp-popup-confirm'), 'click', function () { if (!popupActor) return; var popName = pm._el('sp-popup-name'), popCh = pm._el('sp-popup-channel'); popupActor.name = (popName && popName.value.trim()) || popupActor.label; popupActor.channel = (popCh && parseInt(popCh.value)) || null; _closePopup(); _renderAll(); _syncSpatialSources(); });
        pm._on(pm._el('sp-popup-open-ch'), 'click', function () { if (!popupActor || !popupActor.channel) { alert('Defina um n\u00FAmero de canal primeiro.'); return; } _openMixerChannel(popupActor.channel); _closePopup(); });
        pm._on(pm._el('sp-popup-cancel'), 'click', _closePopup);
        pm._on(document, 'click', function (e) { if (!popup.contains(e.target) && !e.target.closest('.sp-actor')) _closePopup(); });

        pm._on(pm._el('sp-btn-save'), 'click', function () { localStorage.setItem(STORAGE_KEY, JSON.stringify(actors)); var btn = pm._el('sp-btn-save'); if (btn) { btn.textContent = '\u2705 Salvo!'; pm._setTimeout(function () { btn.textContent = '\uD83D\uDCBE Salvar Layout'; }, 1500); } });
        pm._on(pm._el('sp-btn-load'), 'click', function () { try { var raw = localStorage.getItem(STORAGE_KEY); if (!raw) { alert('Nenhum layout salvo.'); return; } actors = JSON.parse(raw); nextId = actors.reduce(function (m, a) { var n = parseInt((a.id || '').split('_')[1]); return n > m ? n + 1 : m; }, 1); _renderAll(); } catch (e) { alert('Erro ao carregar layout: ' + e.message); } });
        pm._on(pm._el('sp-btn-clear'), 'click', function () { if (!confirm('Limpar o palco?')) return; actors = []; if (wrap) wrap.querySelectorAll('.sp-actor').forEach(function (el) { el.remove(); }); pm._setText('sp-actor-count', '0 instrumentos'); });
        pm._on(pm._el('sp-btn-export'), 'click', function () { window.print(); });
        pm._on(pm._el('sp-btn-spatial'), 'click', async function () { if (!window.SpatialAverager) { alert('SpatialAverager n\u00E3o dispon\u00EDvel.'); return; } var btn = pm._el('sp-btn-spatial'), badge = pm._el('sp-spatial-badge'); if (spatialActive) { await SpatialAverager.stop(); spatialActive = false; if (badge) badge.style.display = 'none'; if (btn) btn.textContent = '\uD83C\uDF99\uFE0F Ativar M\u00E9dia Espacial'; } else { var mics = await SpatialAverager.startMultiDevice(Math.min(actors.filter(function (a) { return a.channel; }).length || 2, 8)); spatialActive = mics.length > 0; if (badge) badge.style.display = spatialActive ? 'block' : 'none'; if (btn) btn.textContent = spatialActive ? '\u23F9 Parar Spatial Avg' : '\uD83C\uDF99\uFE0F Ativar M\u00E9dia Espacial'; _syncSpatialSources(); } });

        try { var raw = localStorage.getItem(STORAGE_KEY); if (raw) { actors = JSON.parse(raw); _renderAll(); } } catch (_) {}
    }

    function destroy() {
        if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
        if (spatialActive && window.SpatialAverager) {
            try { window.SpatialAverager.stop(); } catch (e) { console.error('[StagePlotPage] Error stopping SpatialAverager:', e); }
        }
        actors = []; dragActor = null; popupActor = null; spatialActive = false; pm.destroy();
    }

    window.StagePlotPage = { init: init, destroy: destroy };
})();
