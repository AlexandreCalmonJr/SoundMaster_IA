/**
 * =============================================================================
 * SoundMaster — Página de Calibração do Analisador
 * =============================================================================
 *
 * Descrição:
 *     Módulo responsável pela calibração do microfone e configuração de
 *     referência absoluta de SPL (Sound Pressure Level). Permite carregamento
 *     de arquivos de calibração do microfone e calibração com calibrador
 *     acústico de 94dB a 1kHz.
 *
 * Funcionalidades:
 *     - Upload e carregamento de arquivos de calibração do microfone
 *     - Calibração SPL usando calibrador acústico de referência (94dB @ 1kHz)
 *     - Exibição do status atual da calibração (perfil ativo ou genérico)
 *     - Exibição do offset SPL atual em dB
 *     - Remoção de calibração (retorna ao microfone genérico plano)
 *     - Validação de sinal do microfone antes da calibração
 *
 * Fluxo de Calibração SPL:
 *     1. Ativar o microfone na aba FFT & Waterfall
 *     2. Ligar o calibrador acústico de 94dB a 1kHz no microfone
 *     3. Clicar em "Calibrar SPL para 94dB"
 *     4. O sistema calcula o offset automaticamente
 *
 * Dependências:
 *     - AcousticCalibration: Serviço de calibração acústica
 *     - _rawFreqRMS_dB: Variável global com o RMS bruto em dB da frequência
 *     - createPageModule(): Módulo base de páginas
 *
 * Integrações:
 *     - Integra com o analisador FFT para obter leituras de sinal
 *     - Conecta-se ao sistema de calibração para aplicar offsets
 *     - Afeta todas as medições de SPL no sistema
 *
 * Uso:
 *     Para inicializar: AnalyzerCalibrationPage.init()
 *     Para destruir: AnalyzerCalibrationPage.destroy()
 *
 * Variável Global:
 *     window.AnalyzerCalibrationPage - Objeto público com init() e destroy()
 * =============================================================================
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
