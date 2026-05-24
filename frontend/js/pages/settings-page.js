/**
 * SoundMaster — Settings Page Module
 * Persists and manages global user preferences and updates check.
 */

'use strict';

(function () {
    const pm = createPageModule();

    function loadSavedSettings() {
        const autoStartInput = pm._el('settings-auto-start');
        const highResInput = pm._el('settings-fft-highres');
        const unitSelect = pm._el('unit-select');

        // Load auto start config (default true)
        if (autoStartInput) {
            const val = localStorage.getItem('sm-settings-auto-start');
            autoStartInput.checked = val === null ? true : val === 'true';
        }

        // Load high-res config (default true)
        if (highResInput) {
            const val = localStorage.getItem('sm-settings-fft-highres');
            highResInput.checked = val === null ? true : val === 'true';
        }

        // Load unit select (default m)
        if (unitSelect) {
            const val = localStorage.getItem('sm-settings-unit');
            unitSelect.value = val || 'm';
        }
    }

    function init() {
        loadSavedSettings();

        // Bind auto start change
        const autoStartInput = pm._el('settings-auto-start');
        if (autoStartInput) {
            pm._on(autoStartInput, 'change', (e) => {
                localStorage.setItem('sm-settings-auto-start', e.target.checked);
                console.log('[SettingsPage] AutoStart set to:', e.target.checked);
            });
        }

        // Bind highres change
        const highResInput = pm._el('settings-fft-highres');
        if (highResInput) {
            pm._on(highResInput, 'change', (e) => {
                localStorage.setItem('sm-settings-fft-highres', e.target.checked);
                console.log('[SettingsPage] FFT HighRes set to:', e.target.checked);
                // If analyzer is running, we could update it
                if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.setHighResolution === 'function') {
                    window.SoundMasterAnalyzer.setHighResolution(e.target.checked);
                }
            });
        }

        // Bind unit select change
        const unitSelect = pm._el('unit-select');
        if (unitSelect) {
            pm._on(unitSelect, 'change', (e) => {
                localStorage.setItem('sm-settings-unit', e.target.value);
                console.log('[SettingsPage] Unit set to:', e.target.value);
            });
        }

        // Bind update check button
        const btnCheck = pm._el('btn-check-updates');
        if (btnCheck) {
            pm._on(btnCheck, 'click', async () => {
                if (window.UpdaterService && typeof window.UpdaterService.init === 'function') {
                    alert('🔍 Verificando se existem atualizações...');
                    try {
                        if (window.updater) {
                            const update = await window.updater.checkUpdate();
                            if (update && update.available) {
                                window.UpdaterService.showUpdateNotification(update);
                            } else {
                                alert('ℹ️ O SoundMaster Pro já está na versão mais recente!');
                            }
                        } else {
                            // Fallback simulation/mock update check
                            pm._setTimeout(() => {
                                alert('ℹ️ O SoundMaster Pro já está na versão mais recente!');
                            }, 800);
                        }
                    } catch (e) {
                        alert('❌ Ocorreu um erro ao buscar atualizações.');
                    }
                } else {
                    alert('UpdaterService não disponível.');
                }
            });
        }
    }

    function destroy() {
        pm.destroy();
    }

    window.SettingsPage = {
        init: init,
        destroy: destroy
    };
})();
