/**
 * SoundMaster — Feedback Detector Module
 * Detecta microfonia e apresenta alertas. A execução automática fica bloqueada
 * enquanto o Assistente de Operação Sonora estiver em modo sombra.
 */

'use strict';

(function () {
    const SHADOW_MODE = true;
    let isAutoCutEnabled = false;
    let autoCutHistory = {}; // { '1000': -3 }
    let autoCutCooldown = 0; // Cooldown frames to prevent double trigger

    function _el(id) {
        const iframe = document.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    function _setAlertMessage(feedbackAlert, parts) {
        if (!feedbackAlert) return;
        feedbackAlert.textContent = '';

        parts.forEach((part, index) => {
            if (!part) return;
            if (index > 0) {
                feedbackAlert.appendChild(document.createTextNode(' '));
            }

            if (part.strong) {
                const strong = document.createElement('strong');
                strong.textContent = part.text == null ? '' : String(part.text);
                feedbackAlert.appendChild(strong);
                return;
            }

            feedbackAlert.appendChild(document.createTextNode(part.text == null ? '' : String(part.text)));
        });
    }

    function init() {
        const btnToggleAutoCut = _el('btn-toggle-auto-cut');
        if (btnToggleAutoCut) {
            // Remove listeners antigos e mantenha o controle bloqueado no modo sombra.
            const newBtn = btnToggleAutoCut.cloneNode(true);
            btnToggleAutoCut.parentNode.replaceChild(newBtn, btnToggleAutoCut);
            newBtn.checked = false;
            newBtn.disabled = SHADOW_MODE;
            newBtn.title = SHADOW_MODE
                ? 'Modo sombra ativo: nenhum corte será aplicado automaticamente.'
                : 'Habilitar corte automático de microfonia.';
            if (!SHADOW_MODE) {
                newBtn.addEventListener('change', (e) => {
                    isAutoCutEnabled = e.target.checked;
                    console.log(`[FeedbackDetectorModule] Auto-Cut toggle: ${isAutoCutEnabled ? 'ON' : 'OFF'}`);
                });
            }
        }
    }

    function update(currentFastPeakHz, peakDb, peakHz, neighborAvg, sampleRate) {
        if (autoCutCooldown > 0) autoCutCooldown--;

        // Use the global service to analyze feedback
        const isFeedback = FeedbackDetectorService.analyze(currentFastPeakHz, peakDb, -20);
        
        const feedbackAlert = _el('feedback-alert');
        const btnAutoCut = _el('btn-auto-cut');

        if (isFeedback) {
            const freqInt = Math.round(peakHz);
            if (feedbackAlert) {
                feedbackAlert.className = 'alert danger';
                _setAlertMessage(feedbackAlert, [
                    { text: 'WARNING' },
                    { text: 'Microfonia DETECTADA', strong: true },
                    { text: 'em' },
                    { text: freqInt + ' Hz', strong: true },
                    { text: 'sustentados. Diferen?a local: ' + (peakDb - neighborAvg).toFixed(1) + ' dB.' }
                ]);
            }

            if (window.AppStore && typeof AppStore.setState === 'function') {
                AppStore.setState({ feedbackHz: freqInt });
            }

            if (SHADOW_MODE) {
                if (btnAutoCut) {
                    btnAutoCut.style.display = 'block';
                    btnAutoCut.disabled = true;
                    btnAutoCut.onclick = null;
                    btnAutoCut.innerText = `Modo sombra: corte sugerido em ${freqInt}Hz`;
                }
            } else if (isAutoCutEnabled && autoCutCooldown === 0) {
                // A execução será reintroduzida somente pelo fluxo central de
                // confirmação, allowlist, snapshot e rollback.
                console.warn('[FeedbackDetectorModule] Execução bloqueada fora do fluxo de confirmação.');
            } else if (btnAutoCut) {
                btnAutoCut.style.display = 'block';
                btnAutoCut.disabled = true;
                btnAutoCut.onclick = null;
                btnAutoCut.innerText = `Revisar pico em ${freqInt}Hz`;
            }
        } else {
            if (feedbackAlert) {
                feedbackAlert.className = 'alert safe';
                _setAlertMessage(feedbackAlert, [
                    { text: 'Espectro estavel. Pico dominante: ' + Math.round(peakHz) + ' Hz (' + peakDb.toFixed(1) + ' dB).' }
                ]);
            }
            if (btnAutoCut && !isAutoCutEnabled) {
                btnAutoCut.style.display = 'none';
                btnAutoCut.innerText = '🪄 Cortar Frequência na Mesa';
            }

            if (window.AppStore && typeof AppStore.setState === 'function') {
                AppStore.setState({ feedbackHz: null });
            }
        }
    }

    function reset() {
        FeedbackDetectorService.reset();
        autoCutHistory = {};
        autoCutCooldown = 0;
    }

    window.FeedbackDetectorModule = {
        init,
        update,
        reset,
        isAutoCutEnabled: () => !SHADOW_MODE && isAutoCutEnabled,
        setAutoCutEnabled: (val) => { isAutoCutEnabled = SHADOW_MODE ? false : !!val; },
        getAutoCutHistory: () => autoCutHistory
    };

    console.log('[FeedbackDetectorModule] Carregado.');
})();
