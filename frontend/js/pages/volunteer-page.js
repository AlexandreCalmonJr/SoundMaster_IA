'use strict';
(function () {
    var _listeners = [];
    var _vuUnsub = null;

    function _on(target, event, handler) {
        if (!target) return;
        target.addEventListener(event, handler);
        _listeners.push({ target, event, handler });
    }

    function _vuToPercent(db) {
        var max = 6, min = -60;
        return Math.max(0, Math.min(100, ((db - min) / (max - min)) * 100));
    }

    function _updateVUMeters() {
        var state = window.AppStore ? AppStore.getState() : {};
        var vu = state.vuData || {};
        var ch1 = vu.channels ? vu.channels[1] : null;
        var master = vu.master !== undefined ? vu.master : null;
        var vocalVuFill = document.getElementById('vol-vu-fill');
        var paVuFill = document.getElementById('vol-pa-fill');

        if (ch1 !== null && vocalVuFill) {
            var pct = _vuToPercent((ch1 < 0 ? Math.log(ch1 + 0.0001) / Math.log(10) * 20 : ch1 * 80) - 80);
            vocalVuFill.style.height = Math.max(0, Math.min(100, pct)) + '%';
        }
        if (master !== null && paVuFill) {
            var db = master < 0.001 ? -80 : 20 * Math.log10(master);
            paVuFill.style.height = Math.max(0, Math.min(100, _vuToPercent(db))) + '%';
        }
    }

    function _updateSliderLabel(slider, labelEl) {
        if (labelEl) labelEl.textContent = slider.value + '%';
    }

    function _setLevels(vocal, pa) {
        var vocalSlider = document.getElementById('vol-vocal');
        var vocalVal = document.getElementById('vol-vocal-val');
        var paSlider = document.getElementById('vol-pa');
        var paVal = document.getElementById('vol-pa-val');
        if (vocalSlider) { vocalSlider.value = vocal; _updateSliderLabel(vocalSlider, vocalVal); }
        if (paSlider) { paSlider.value = pa; _updateSliderLabel(paSlider, paVal); }
        if (window.MixerService) {
            MixerService.setChannelLevel(1, vocal / 100);
            MixerService.setMasterLevel(pa / 100);
        }
    }

    function init() {
        var vocalSlider = document.getElementById('vol-vocal');
        var vocalVal = document.getElementById('vol-vocal-val');
        var paSlider = document.getElementById('vol-pa');
        var paVal = document.getElementById('vol-pa-val');
        var monitorSlider = document.getElementById('vol-monitor');
        var monitorVal = document.getElementById('vol-monitor-val');

        if (window.SimulationService && !SimulationService.isRunning()) {
            SimulationService.enableSimulationMode();
        }

        if (window.AppStore && !_vuUnsub) {
            _vuUnsub = AppStore.subscribe('vuData', function () { _updateVUMeters(); });
            _updateVUMeters();
        }

        _on(vocalSlider, 'input', function () {
            _updateSliderLabel(vocalSlider, vocalVal);
            if (window.MixerService) MixerService.setChannelLevel(1, Number(vocalSlider.value) / 100);
        });

        _on(paSlider, 'input', function () {
            _updateSliderLabel(paSlider, paVal);
            if (window.MixerService) MixerService.setMasterLevel(Number(paSlider.value) / 100);
        });

        _on(monitorSlider, 'input', function () {
            _updateSliderLabel(monitorSlider, monitorVal);
            if (window.MixerService) MixerService.setAuxLevel(1, 1, Number(monitorSlider.value) / 100);
        });

        _updateSliderLabel(vocalSlider, vocalVal);
        _updateSliderLabel(paSlider, paVal);
        _updateSliderLabel(monitorSlider, monitorVal);

        _on(document.getElementById('vol-btn-mute-pa'), 'click', function () {
            var btn = this;
            var isMuted = btn.dataset.muted === 'true';
            if (isMuted) {
                btn.dataset.muted = 'false';
                btn.innerHTML = '🔇 Mutar PA';
                btn.classList.remove('bg-red-600', 'hover:bg-red-500');
                btn.classList.add('bg-slate-700', 'hover:bg-slate-600');
                if (window.MixerService) MixerService.setMasterMute(false);
            } else {
                btn.dataset.muted = 'true';
                btn.innerHTML = '🔊 Desmutar PA';
                btn.classList.add('bg-red-600', 'hover:bg-red-500');
                btn.classList.remove('bg-slate-700', 'hover:bg-slate-600');
                if (window.MixerService) MixerService.setMasterMute(true);
            }
        });

        _on(document.getElementById('vol-btn-mute-vocal'), 'click', function () {
            var btn = this;
            var isMuted = btn.dataset.muted === 'true';
            if (isMuted) {
                btn.dataset.muted = 'false';
                btn.innerHTML = '🔇 Mutar Vocal';
                btn.classList.remove('bg-red-600', 'hover:bg-red-500');
                btn.classList.add('bg-slate-700', 'hover:bg-slate-600');
                if (window.MixerService) MixerService.setChannelMute(1, false);
            } else {
                btn.dataset.muted = 'true';
                btn.innerHTML = '🔊 Desmutar Vocal';
                btn.classList.add('bg-red-600', 'hover:bg-red-500');
                btn.classList.remove('bg-slate-700', 'hover:bg-slate-600');
                if (window.MixerService) MixerService.setChannelMute(1, true);
            }
        });

        _on(document.getElementById('vol-btn-preset-louvor'), 'click', function () { _setLevels(85, 65); });
        _on(document.getElementById('vol-btn-preset-pregacao'), 'click', function () { _setLevels(75, 60); });
        _on(document.getElementById('vol-btn-preset-silencio'), 'click', function () {
            _setLevels(0, 0);
            if (window.MixerService) { MixerService.setChannelMute(1, true); MixerService.setMasterMute(true); }
        });

        _on(document.getElementById('vol-btn-ai-chat'), 'click', function () {
            if (window.router) router.navigate('ai-chat');
        });

        _on(document.getElementById('vol-btn-exit'), 'click', function () {
            if (window.router) router.navigate('home');
        });

        var presets = {
            claro:   { vocal: 80, pa: 70 },
            suave:   { vocal: 65, pa: 60 },
            potente: { vocal: 90, pa: 75 },
            estavel: { vocal: 70, pa: 65 }
        };

        _on(document.getElementById('vol-preset-claro'), 'click', function () { _setLevels(presets.claro.vocal, presets.claro.pa); });
        _on(document.getElementById('vol-preset-suave'), 'click', function () { _setLevels(presets.suave.vocal, presets.suave.pa); });
        _on(document.getElementById('vol-preset-potente'), 'click', function () { _setLevels(presets.potente.vocal, presets.potente.pa); });
        _on(document.getElementById('vol-preset-estavel'), 'click', function () { _setLevels(presets.estavel.vocal, presets.estavel.pa); });
    }

    function destroy() {
        _listeners.forEach(function (l) { l.target.removeEventListener(l.event, l.handler); });
        _listeners = [];
        if (_vuUnsub) { _vuUnsub(); _vuUnsub = null; }
    }

    window.VolunteerPage = { init: init, destroy: destroy };
})();
