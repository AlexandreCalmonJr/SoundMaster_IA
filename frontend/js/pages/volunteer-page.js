/**
 * @fileoverview Página de Modo Voluntário — Painel simplificado para operadores
 * de som em eventos ao vivo (igrejas, shows, conferências).
 *
 * Esta página fornece uma interface simplificada e amigável para voluntários
 * que operam o sistema de som sem treinamento técnico avançado. O modo
 * voluntário permite controle básico de volume vocal, PA e monitor, com
 * presets pré-configurados para diferentes cenários de evento.
 *
 * ## Funcionalidades Principais
 * - Controle deslizante de volume vocal (canal 1) e PA (master)
 * - Controle de volume de monitor (aux 1)
 * - Botões de mute para vocal e PA com indicadores visuais
 * - Presets de cena: Louvo, Pregação e Silêncio
 * - Presets de timbre: Claro, Suave, Potente e Estável
 * - Medidores VU em tempo real para vocal e PA
 * - Botões de acesso rápido ao Chat IA e saída
 *
 * ## Como Usar
 * 1. Ajuste os níveis de vocal e PA usando os sliders
 * 2. Use os presets de cena para configurações rápidas
 * 3. Use os presets de timbre para ajustar o character do som
 * 4. Pressione os botões de mute para silenciar vocal ou PA
 * 5. Pressione "Chat IA" para acessar o assistente inteligente
 *
 * ## Dependências e Integrações
 * - **createPageModule()**: Módulo base para páginas (métodos auxiliares)
 * - **AppStore**: Store global do estado da aplicação (dados VU)
 * - **MixerService**: Serviço de controle da mesa de mixagem
 *   - `setChannelLevel(channel, level)` — Ajusta nível do canal
 *   - `setMasterLevel(level)` — Ajusta nível master
 *   - `setChannelMute(channel, muted)` — Alterna mute do canal
 *   - `setMasterMute(muted)` — Alterna mute master
 *   - `setAuxLevel(aux, channel, level)` — Ajusta nível de aux
 * - **SimulationService**: Modo simulação para testes sem mixer real
 * - **router**: Navegação entre páginas
 *
 * @module VolunteerPage
 * @version 1.0.0
 */

'use strict';
(function () {
    var pm = createPageModule();
    var _vuUnsub = null;

    function _vuToPercent(db) {
        return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    }

    function _updateVUMeters() {
        var state = window.AppStore ? AppStore.getState() : {};
        var vu = state.vuData || {};
        var ch1 = vu.channels ? vu.channels[1] : null;
        var master = vu.master !== undefined ? vu.master : null;
        var vocalVuFill = pm._el('vol-vu-fill');
        var paVuFill = pm._el('vol-pa-fill');

        if (ch1 != null && vocalVuFill) {
            var db = ch1 < 0.001 ? -80 : 20 * Math.log10(ch1);
            vocalVuFill.style.height = Math.max(0, Math.min(100, _vuToPercent(db))) + '%';
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
        var vocalSlider = pm._el('vol-vocal');
        var vocalVal = pm._el('vol-vocal-val');
        var paSlider = pm._el('vol-pa');
        var paVal = pm._el('vol-pa-val');
        if (vocalSlider) { vocalSlider.value = vocal; _updateSliderLabel(vocalSlider, vocalVal); }
        if (paSlider) { paSlider.value = pa; _updateSliderLabel(paSlider, paVal); }
        pm._safeCall('MixerService', 'setChannelLevel', 1, vocal / 100);
        pm._safeCall('MixerService', 'setMasterLevel', pa / 100);
    }

    function _toggleMute(btnId, serviceMethod, muteText, unmuteText, channel) {
        var btn = pm._el(btnId);
        if (!btn) return;
        var isMuted = btn.dataset.muted === 'true';
        if (isMuted) {
            btn.dataset.muted = 'false';
            btn.innerHTML = muteText;
            pm._toggleClasses(btnId, ['bg-slate-700', 'hover:bg-slate-600'], ['bg-red-600', 'hover:bg-red-500']);
        } else {
            btn.dataset.muted = 'true';
            btn.innerHTML = unmuteText;
            pm._toggleClasses(btnId, ['bg-red-600', 'hover:bg-red-500'], ['bg-slate-700', 'hover:bg-slate-600']);
        }
        if (channel !== undefined) {
            pm._safeCall('MixerService', serviceMethod, channel, !isMuted);
        } else {
            pm._safeCall('MixerService', serviceMethod, !isMuted);
        }
    }

    function init() {
        var vocalSlider = pm._el('vol-vocal');
        var vocalVal = pm._el('vol-vocal-val');
        var paSlider = pm._el('vol-pa');
        var paVal = pm._el('vol-pa-val');
        var monitorSlider = pm._el('vol-monitor');
        var monitorVal = pm._el('vol-monitor-val');

        pm._safeCall('SimulationService', 'enableSimulationMode');

        if (window.AppStore && !_vuUnsub) {
            _vuUnsub = AppStore.subscribe('vuData', function () { _updateVUMeters(); });
            _updateVUMeters();
        }

        pm._on(vocalSlider, 'input', function () { _updateSliderLabel(vocalSlider, vocalVal); pm._safeCall('MixerService', 'setChannelLevel', 1, Number(vocalSlider.value) / 100); });
        pm._on(paSlider, 'input', function () { _updateSliderLabel(paSlider, paVal); pm._safeCall('MixerService', 'setMasterLevel', Number(paSlider.value) / 100); });
        pm._on(monitorSlider, 'input', function () { _updateSliderLabel(monitorSlider, monitorVal); pm._safeCall('MixerService', 'setAuxLevel', 1, 1, Number(monitorSlider.value) / 100); });

        _updateSliderLabel(vocalSlider, vocalVal);
        _updateSliderLabel(paSlider, paVal);
        _updateSliderLabel(monitorSlider, monitorVal);

        pm._on(pm._el('vol-btn-mute-pa'), 'click', function () { _toggleMute('vol-btn-mute-pa', 'setMasterMute', '\uD83D\uDD07 Mutar PA', '\uD83D\uDD0A Desmutar PA'); });
        pm._on(pm._el('vol-btn-mute-vocal'), 'click', function () { _toggleMute('vol-btn-mute-vocal', 'setChannelMute', '\uD83D\uDD07 Mutar Vocal', '\uD83D\uDD0A Desmutar Vocal', 1); });

        pm._on(pm._el('vol-btn-preset-louvor'), 'click', function () { _setLevels(85, 65); });
        pm._on(pm._el('vol-btn-preset-pregacao'), 'click', function () { _setLevels(75, 60); });
        pm._on(pm._el('vol-btn-preset-silencio'), 'click', function () { 
            _setLevels(0, 0); 
            pm._safeCall('MixerService', 'setChannelMute', 1, true); 
            pm._safeCall('MixerService', 'setMasterMute', true);
            var paBtn = pm._el('vol-btn-mute-pa');
            if (paBtn) { paBtn.dataset.muted = 'true'; paBtn.innerHTML = '\uD83D\uDD0A Desmutar PA'; pm._toggleClasses('vol-btn-mute-pa', ['bg-red-600', 'hover:bg-red-500'], ['bg-slate-700', 'hover:bg-slate-600']); }
            var vocalBtn = pm._el('vol-btn-mute-vocal');
            if (vocalBtn) { vocalBtn.dataset.muted = 'true'; vocalBtn.innerHTML = '\uD83D\uDD0A Desmutar Vocal'; pm._toggleClasses('vol-btn-mute-vocal', ['bg-red-600', 'hover:bg-red-500'], ['bg-slate-700', 'hover:bg-slate-600']); }
        });
        pm._on(pm._el('vol-btn-ai-chat'), 'click', function () { pm._safeCall('router', 'navigate', 'home'); });
        pm._on(pm._el('vol-btn-exit'), 'click', function () { pm._safeCall('router', 'navigate', 'home'); });

        var presets = { claro: { vocal: 80, pa: 70 }, suave: { vocal: 65, pa: 60 }, potente: { vocal: 90, pa: 75 }, estavel: { vocal: 70, pa: 65 } };
        pm._on(pm._el('vol-preset-claro'), 'click', function () { _setLevels(presets.claro.vocal, presets.claro.pa); });
        pm._on(pm._el('vol-preset-suave'), 'click', function () { _setLevels(presets.suave.vocal, presets.suave.pa); });
        pm._on(pm._el('vol-preset-potente'), 'click', function () { _setLevels(presets.potente.vocal, presets.potente.pa); });
        pm._on(pm._el('vol-preset-estavel'), 'click', function () { _setLevels(presets.estavel.vocal, presets.estavel.pa); });
    }

    function destroy() {
        pm.destroy();
        if (_vuUnsub) { _vuUnsub(); _vuUnsub = null; }
    }

    window.VolunteerPage = { init: init, destroy: destroy };
})();
