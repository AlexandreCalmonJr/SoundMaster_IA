/**
 * SoundMaster — Feedback Detector & Auto-Cut Module
 * Controls real-time feedback detection and automatic notch EQ application.
 */

'use strict';

(function () {
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

    function init() {
        const btnToggleAutoCut = _el('btn-toggle-auto-cut');
        if (btnToggleAutoCut) {
            // Remove previous listener to avoid duplicates
            const newBtn = btnToggleAutoCut.cloneNode(true);
            btnToggleAutoCut.parentNode.replaceChild(newBtn, btnToggleAutoCut);
            newBtn.checked = isAutoCutEnabled;
            newBtn.addEventListener('change', (e) => {
                isAutoCutEnabled = e.target.checked;
                console.log(`[FeedbackDetectorModule] Auto-Cut toggle: ${isAutoCutEnabled ? 'ON' : 'OFF'}`);
            });
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
                feedbackAlert.innerHTML = `⚠️ <strong>Microfonia DETECTADA</strong> em <strong>${freqInt} Hz</strong> sustentados. Diferença local: ${(peakDb - neighborAvg).toFixed(1)} dB.`;
            }

            if (window.AppStore && typeof AppStore.setState === 'function') {
                AppStore.setState({ feedbackHz: freqInt });
            }

            if (isAutoCutEnabled && autoCutCooldown === 0) {
                const exactFreq = Math.round(peakHz);
                const bandId = Math.round(exactFreq / 10) * 10;
                const currentCut = autoCutHistory[bandId] || 0;

                // Max limit of -12dB cut
                if (currentCut > -12) {
                    const newCut = currentCut - 3;
                    autoCutHistory[bandId] = newCut;
                    autoCutCooldown = 60; // 1 second cooldown at 60fps

                    if (window.AIService && typeof AIService.sendTrainingEvent === 'function') {
                        AIService.sendTrainingEvent(exactFreq, peakDb, neighborAvg, newCut, true);
                    }
                    window.dispatchEvent(new CustomEvent('feedback:auto-cut', {
                        detail: { freq: exactFreq, gain: newCut, peakDb, isAuto: true }
                    }));
                    if (window.MixerService) {
                        if (typeof MixerService.applyNotchFilter === 'function') {
                            MixerService.applyNotchFilter('master', exactFreq, -3);
                            console.log(`[FeedbackDetectorModule] Notch Filter em ${exactFreq}Hz (-3dB, total: ${newCut}dB)`);
                        } else if (typeof MixerService.applyEQ === 'function') {
                            MixerService.applyEQ('master', exactFreq, 30, -3);
                            console.log(`[FeedbackDetectorModule] EQ em ${exactFreq}Hz (Q=30, -3dB)`);
                        } else if (typeof MixerService.cutFeedback === 'function') {
                            MixerService.cutFeedback(exactFreq);
                        }
                    }

                    if (btnAutoCut) {
                        btnAutoCut.style.display = 'block';
                        btnAutoCut.innerText = `🔇 Notch: ${freqInt}Hz (-3dB)`;
                        btnAutoCut.classList.add('bg-orange-600');
                        setTimeout(() => { btnAutoCut.classList.remove('bg-orange-600'); }, 1000);
                    }
                } else {
                    if (btnAutoCut) {
                        btnAutoCut.style.display = 'block';
                        btnAutoCut.innerText = `⚠️ Limite atingido em ${bandId}Hz`;
                    }
                }
            } else if (!isAutoCutEnabled) {
                if (btnAutoCut) {
                    btnAutoCut.style.display = 'block';
                    btnAutoCut.onclick = () => {
                        if (window.MixerService && typeof MixerService.cutFeedback === 'function') {
                            MixerService.cutFeedback(freqInt);
                        }
                        btnAutoCut.innerText = 'Cortando...';
                    };
                }
            }
        } else {
            if (feedbackAlert) {
                feedbackAlert.className = 'alert safe';
                feedbackAlert.innerHTML = `Espectro estável. Pico dominante: ${Math.round(peakHz)} Hz (${peakDb.toFixed(1)} dB).`;
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
        isAutoCutEnabled: () => isAutoCutEnabled,
        setAutoCutEnabled: (val) => { isAutoCutEnabled = !!val; },
        getAutoCutHistory: () => autoCutHistory
    };

    console.log('[FeedbackDetectorModule] Carregado.');
})();
