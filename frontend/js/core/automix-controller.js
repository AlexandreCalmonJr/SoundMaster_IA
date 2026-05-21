/**
 * SoundMaster — Automix Controller Module
 * Handles Automix UI toggles, speed sliders, and Group A/B routing inputs.
 */

'use strict';

(function () {
    let currentGroup = 'a';

    function _el(id) {
        const iframe = document.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    function init() {
        const btnToggle = _el('btn-toggle-automix');
        const sliderSpeed = _el('automix-speed-slider');
        const valSpeed = _el('automix-speed-val');
        const btnGroupA = _el('btn-automix-group-a');
        const btnGroupB = _el('btn-automix-group-b');

        if (btnToggle) {
            btnToggle.checked = false; // default state
            btnToggle.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                if (window.MixerService) {
                    MixerService.automixControl(currentGroup, enabled ? 'enable' : 'disable');
                }
                console.log(`[AutomixController] Automix ${currentGroup.toUpperCase()}: ${enabled ? 'ON' : 'OFF'}`);
            });
        }

        if (sliderSpeed) {
            sliderSpeed.addEventListener('input', (e) => {
                const ms = e.target.value;
                if (valSpeed) valSpeed.innerText = ms + 'ms';
                if (window.MixerService) {
                    MixerService.automixControl(null, 'responseTime', ms);
                }
            });
        }

        const updateGroupUI = (group) => {
            currentGroup = group;
            if (btnGroupA && btnGroupB) {
                btnGroupA.classList.toggle('active', group === 'a');
                btnGroupA.classList.toggle('bg-cyan-600/20', group === 'a');
                btnGroupB.classList.toggle('active', group === 'b');
                btnGroupB.classList.toggle('bg-cyan-600/20', group === 'b');
            }
            // If automix is already running, notify service about group change
            if (btnToggle && btnToggle.checked && window.MixerService) {
                MixerService.automixControl(currentGroup, 'enable');
            }
        };

        if (btnGroupA) {
            btnGroupA.addEventListener('click', () => updateGroupUI('a'));
        }
        if (btnGroupB) {
            btnGroupB.addEventListener('click', () => updateGroupUI('b'));
        }

        // Initialize UI states
        updateGroupUI('a');
    }

    window.AutomixController = {
        init,
        getCurrentGroup: () => currentGroup,
        setCurrentGroup: (group) => {
            if (['a', 'b'].includes(group)) {
                currentGroup = group;
            }
        }
    };

    console.log('[AutomixController] Carregado.');
})();
