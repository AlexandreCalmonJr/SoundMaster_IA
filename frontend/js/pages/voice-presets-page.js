/**
 * @fileoverview Módulo de Página de Presets de Voz
 * @module VoicePresetsPage
 * @description Página responsável por gerenciar e aplicar presets de voz nos canais 1-24.
 * Oferece presets pré-configurados para diferentes tipos de voz e cenários de uso.
 *
 * ## Funcionalidades Principais
 * - Seleção de canal de destino (1-24) via dropdown
 * - Aplicação de presets com configurações específicas por tipo
 * - Feedback visual de confirmação (botão verde "APLICADO ✓" por 2 segundos)
 * - Configurações automáticas: HPF, EQ, compressor, deesser, gate, denoise, etc.
 *
 * ## Presets Disponíveis
 * - **Barítono**: HPF 120Hz, Low -2dB
 * - **Soprano**: HPF 150Hz, High +2dB
 * - **Pregador**: Compressor agressivo, AFS ativado
 * - **Smart Clean**: Deesser, gate adaptativo, air, denoise
 * - **Infantil**: HPF 200Hz, Presence +3dB
 * - **Tenor**: HPF 100Hz, Mud -2dB
 * - **Coro**: HPF 130Hz, Presence +1.5dB
 * - **Podcast**: Compressor leve, deesser, HPF 80Hz, Presence +2dB
 *
 * ## Como Usar
 * 1. Inicializar a página chamando `VoicePresetsPage.init()`
 * 2. Selecionar o canal de destino no dropdown "Canal"
 * 3. Clicar no botão do preset desejado na grid de cards
 * 4. Aguardar confirmação visual (verde) de 2 segundos
 * 5. O preset é aplicado automaticamente ao canal selecionado
 *
 * ## Dependências e Integrações
 * - **MixerService**: Serviço de comunicação (runCleanSoundPreset para aplicar configurações)
 * - **AppStore**: Armazenamento global (addLog para registro de ações)
 * - **createPageModule()**: Factory de módulo de página para gerenciamento de lifecycle
 * - Evento: `stage-plot-channel-open` (abrir canal via Stage Plot)
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

        // Configure buttons - select ALL buttons inside preset cards
        const btnApply = document.querySelectorAll('[id^="voice-presets"] .grid button[class*="font-black"]');
        btnApply.forEach(btn => {
            pm._on(btn, 'click', () => {
                const ch = select.value;
                const card = btn.closest('[class*="rounded-2xl"][class*="p-6"]');
                if (!card) return;
                
                const typeEl = card.querySelector('h3');
                if (!typeEl) return;
                const type = typeEl.innerText;

                let opts = {};
                if (type.includes('Barítono')) opts = { hpf: 120, low: -2 };
                if (type.includes('Soprano')) opts = { hpf: 150, high: 2 };
                if (type.includes('Pregador')) opts = { compressor: 'aggressive', afs: true };
                if (type.includes('Smart Clean')) opts = { deesser: true, gate: 'adaptive', air: true, denoise: true };
                if (type.includes('Infantil')) opts = { hpf: 200, presence: 3 };
                if (type.includes('Tenor')) opts = { hpf: 100, mud: -2 };
                if (type.includes('Coro')) opts = { hpf: 130, presence: 1.5 };
                if (type.includes('Podcast')) opts = { compressor: 'light', deesser: true, hpf: 80, presence: 2 };

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
