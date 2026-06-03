/**
 * SoundMaster — Reusable Audio Source Selector Web Component
 * ==========================================================
 * Custom Element HTML nativo (<audio-source-selector>) para renderizar
 * a seleção de dispositivos de captura, reprodução e canal de mesa
 * de forma modular em qualquer página da aplicação.
 *
 * Uso:
 *   <audio-source-selector show-channel="true"></audio-source-selector>
 */

'use strict';

class AudioSourceSelector extends HTMLElement {
    constructor() {
        super();
        this._unsubscribeList = [];
    }

    connectedCallback() {
        this.render();
        this.bindEvents();
    }

    disconnectedCallback() {
        this.unbindEvents();
    }

    static get observedAttributes() {
        return ['show-channel'];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'show-channel' && oldValue !== newValue) {
            this.render();
            this.bindEvents();
        }
    }

    render() {
        const showChannel = this.getAttribute('show-channel') !== 'false';
        const state = window.MixerAudioSource ? window.MixerAudioSource.getState() : {
            inputDevices: [],
            outputDevices: [],
            selectedInputId: null,
            selectedOutputId: null,
            mixerChannel: null,
            permissionGranted: false
        };

        // SVGs Line Icons (estilo Lucide)
        const micIcon = `<svg class="audio-source-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>`;
        const speakerIcon = `<svg class="audio-source-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
        const slidersIcon = `<svg class="audio-source-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="8" x2="14" y2="8"/><line x1="18" y1="16" x2="22" y2="16"/></svg>`;
        const infoIcon = `<svg class="audio-source-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="color: #fbbf24;"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12.01" y1="16" y2="16"/><path d="M12 8v4"/></svg>`;

        this.innerHTML = `
            <div class="audio-source-panel" id="audio-source-panel">
                <div class="audio-source-grid">
                    <div class="audio-source-col">
                        <label class="audio-source-label">
                            ${micIcon}
                            Entrada (Microfone)
                        </label>
                        <div class="audio-source-select-wrap">
                            <select id="audio-input-select" class="audio-source-select">
                                <option value="">Carregando...</option>
                            </select>
                            ${!state.permissionGranted ? `
                            <button id="btn-request-permission" class="audio-source-perm-btn">
                                Permitir
                            </button>` : ''}
                        </div>
                    </div>

                    <div class="audio-source-col">
                        <label class="audio-source-label">
                            ${speakerIcon}
                            Saída (Sweep)
                        </label>
                        <select id="audio-output-select" class="audio-source-select">
                            <option value="">Padrão do sistema</option>
                        </select>
                    </div>

                    ${showChannel ? `
                    <div class="audio-source-col">
                        <label class="audio-source-label">
                            ${slidersIcon}
                            Canal da Mesa (referência)
                        </label>
                        <div class="audio-source-channel-wrap">
                            <select id="audio-mixer-channel" class="audio-source-select">
                                <option value="">— Nenhum —</option>
                                ${Array.from({ length: 24 }, (_, i) =>
                                    `<option value="${i + 1}" ${state.mixerChannel === i + 1 ? 'selected' : ''}>
                                        Canal ${i + 1}
                                    </option>`
                                ).join('')}
                            </select>
                            <span class="audio-source-channel-hint">
                                Mic de medição conectado a este canal
                            </span>
                        </div>
                    </div>` : ''}
                </div>

                <div id="audio-source-ui24r-hint" class="audio-source-hint" style="display:none">
                    ${infoIcon}
                    <span>Dica: Sem Ui24R USB? Conecte a saída de fones da mesa ao line-in do PC e selecione acima.</span>
                </div>
            </div>
        `;

        this.populateSelects(state);
        this.updateHint(state);
    }

    populateSelects(state) {
        const inputSel = this.querySelector('#audio-input-select');
        const outputSel = this.querySelector('#audio-output-select');

        if (inputSel) {
            inputSel.innerHTML = state.inputDevices.map((d, i) => {
                const label = d.label || `Microfone ${i + 1}`;
                const isUi24 = /soundcraft|ui24/i.test(label);
                const prefix = isUi24 ? '📡 ' : '';
                return `<option value="${d.deviceId}" ${d.deviceId === state.selectedInputId ? 'selected' : ''}>
                    ${prefix}${label}
                </option>`;
            }).join('') || '<option value="">Nenhum microfone encontrado</option>';
        }

        if (outputSel) {
            outputSel.innerHTML = '<option value="">🔊 Padrão do sistema</option>' +
                state.outputDevices.map((d, i) => {
                    const label = d.label || `Saída ${i + 1}`;
                    const isUi24 = /soundcraft|ui24/i.test(label);
                    const prefix = isUi24 ? '📡 ' : '';
                    return `<option value="${d.deviceId}" ${d.deviceId === state.selectedOutputId ? 'selected' : ''}>
                        ${prefix}${label}
                    </option>`;
                }).join('');
        }
    }

    updateHint(state) {
        const hasUi24rUsb = state.inputDevices.some(d => /soundcraft|ui24/i.test(d.label));
        const hintEl = this.querySelector('#audio-source-ui24r-hint');
        if (hintEl) {
            hintEl.style.display = !hasUi24rUsb ? 'flex' : 'none';
        }
    }

    bindEvents() {
        const inputSel = this.querySelector('#audio-input-select');
        const outputSel = this.querySelector('#audio-output-select');
        const channelSel = this.querySelector('#audio-mixer-channel');
        const permBtn = this.querySelector('#btn-request-permission');

        inputSel?.addEventListener('change', e => {
            if (window.MixerAudioSource) {
                window.MixerAudioSource.setInputDevice(e.target.value || null);
            }
        });

        outputSel?.addEventListener('change', e => {
            if (window.MixerAudioSource) {
                window.MixerAudioSource.setOutputDevice(e.target.value || null);
            }
        });

        channelSel?.addEventListener('change', e => {
            if (window.MixerAudioSource) {
                window.MixerAudioSource.setMixerChannel(e.target.value);
            }
        });

        permBtn?.addEventListener('click', async () => {
            if (window.MixerAudioSource) {
                // Solicita permissão e atualiza o estado
                await window.MixerAudioSource.init(); 
                const state = window.MixerAudioSource.getState();
                this.render();
                this.bindEvents();
            }
        });

        const onDevicesUpdated = () => {
            if (window.MixerAudioSource) {
                const state = window.MixerAudioSource.getState();
                this.populateSelects(state);
                this.updateHint(state);
            }
        };

        const onSourceChanged = (e) => {
            const { inputId, outputId, channel } = e.detail;
            if (inputSel && inputSel.value !== inputId) inputSel.value = inputId || '';
            if (outputSel && outputSel.value !== outputId) outputSel.value = outputId || '';
            if (channelSel && channelSel.value !== String(channel)) channelSel.value = channel || '';
        };

        const eventDoc = window.parent?.document || document;

        eventDoc.addEventListener('audio_devices_updated', onDevicesUpdated);
        eventDoc.addEventListener('audio_source_changed', onSourceChanged);

        this._unsubscribeList = [
            { event: 'audio_devices_updated', fn: onDevicesUpdated },
            { event: 'audio_source_changed', fn: onSourceChanged }
        ];
    }

    unbindEvents() {
        const eventDoc = window.parent?.document || document;
        this._unsubscribeList.forEach(item => {
            eventDoc.removeEventListener(item.event, item.fn);
        });
        this._unsubscribeList = [];
    }
}

customElements.define('audio-source-selector', AudioSourceSelector);
