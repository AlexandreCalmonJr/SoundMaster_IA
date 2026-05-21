/**
 * SoundMaster — Voice Presets Page Module
 * Manages the application of vocal presets to channels 1-24.
 */

'use strict';

(function () {
    const pm = createPageModule();

    function init() {
        const select = pm._el('voice-preset-channel');
        if (!select) return;

        // Populate channels 1-24
        select.innerHTML = '';
        for (let i = 1; i <= 24; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.className = 'bg-slate-900';
            opt.innerText = `Canal ${i.toString().padStart(2, '0')}`;
            select.appendChild(opt);
        }

        // Configure buttons
        const btnApply = document.querySelectorAll('.bg-rose-600, .bg-cyan-600, .bg-emerald-600');
        btnApply.forEach(btn => {
            pm._on(btn, 'click', () => {
                const ch = select.value;
                const card = btn.closest('.bg-slate-900\\/60, .bg-cyan-900\\/20, .bg-emerald-900\\/20');
                if (!card) return;
                
                const typeEl = card.querySelector('h3');
                if (!typeEl) return;
                const type = typeEl.innerText;

                let opts = {};
                if (type.includes('Barítono')) opts = { hpf: 120, low: -2 };
                if (type.includes('Soprano')) opts = { hpf: 150, high: 2 };
                if (type.includes('Pregador')) opts = { compressor: 'aggressive', afs: true };
                if (type.includes('Smart Clean')) opts = { deesser: true, gate: 'adaptive', air: true, denoise: true };

                MixerService.runCleanSoundPreset(ch, opts);
                AppStore.addLog(`IA: Aplicando preset [${type}] ao canal ${ch}`);

                const originalText = btn.innerText;
                btn.innerText = 'APLICADO ✓';
                
                // Track style colors
                const originalBg = [...btn.classList].find(c => c.startsWith('bg-'));
                if (originalBg) {
                    btn.classList.remove(originalBg);
                }
                btn.classList.add('bg-green-600');
                
                pm._setTimeout(() => {
                    btn.innerText = originalText;
                    btn.classList.remove('bg-green-600');
                    if (originalBg) {
                        btn.classList.add(originalBg);
                    }
                }, 2000);
            });
        });
    }

    function destroy() {
        pm.destroy();
    }

    window.VoicePresetsPage = {
        init: init,
        destroy: destroy
    };
})();
