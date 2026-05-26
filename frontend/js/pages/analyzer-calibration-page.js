/**
 * SoundMaster — Analyzer Calibration Page Module
 * Controls the microphone calibration file uploads and SPL absolute reference calibration.
 */

'use strict';

(function () {
    const pm = createPageModule();

    function updateUI() {
        const cal = window.AcousticCalibration;
        if (!cal) return;

        const profile = cal.getProfile();
        const statusEl = pm._el('cal-status');
        const offsetEl = pm._el('spl-offset-display');

        if (statusEl) {
            if (profile && profile.active) {
                statusEl.innerText = `✅ ${profile.name} (${profile.points.length} pts)`;
                statusEl.className = 'text-green-400 font-bold';
            } else {
                statusEl.innerText = 'Sem calibração (Microfone Genérico)';
                statusEl.className = 'text-amber-400 font-bold';
            }
        }

        if (offsetEl) {
            const offset = cal.getCurrentSplOffset();
            offsetEl.innerText = `${offset.toFixed(1)} dB`;
        }
    }

    function init() {
        const cal = window.AcousticCalibration;
        if (!cal) {
            console.error('[AnalyzerCalibrationPage] AcousticCalibration not found.');
            return;
        }

        // 1. File Input handler
        const fileInput = pm._el('cal-file-input');
        if (fileInput) {
            pm._on(fileInput, 'change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    await cal.loadFromText(text, file.name);
                    updateUI();
                    alert(`✅ Calibração "${file.name}" carregada com sucesso!`);
                } catch (err) {
                    alert(`❌ Erro ao carregar arquivo de calibração: ${err.message}`);
                }
            });
        }

        // 2. Clear Calibration button
        const btnClear = pm._el('btn-clear-calibration');
        if (btnClear) {
            pm._on(btnClear, 'click', () => {
                cal.clearCalibration();
                updateUI();
                if (fileInput) fileInput.value = '';
                alert('ℹ️ Calibração removida. Retornando ao microfone plano genérico.');
            });
        }

        // 3. Calibrate SPL to 94dB button
        const btnCalibrate = pm._el('btn-calibrate-spl');
        if (btnCalibrate) {
            pm._on(btnCalibrate, 'click', () => {
                const rawDb = window._rawFreqRMS_dB;
                if (rawDb == null || !isFinite(rawDb)) {
                    alert('⚠️ Erro: Sinal do microfone inativo ou muito baixo. Ative o microfone em "FFT & Waterfall" e ligue o calibrador acústico de 1kHz a 94dB.');
                    return;
                }

                cal.calibrateSPL(rawDb);
                updateUI();
                alert(`✅ Calibração de SPL concluída! Novo offset: ${cal.getCurrentSplOffset().toFixed(1)} dB`);
            });
        }

        // Update UI initially on load
        updateUI();
    }

    function destroy() {
        pm.destroy();
    }

    window.AnalyzerCalibrationPage = {
        init: init,
        destroy: destroy
    };
})();
