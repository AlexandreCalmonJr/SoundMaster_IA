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
        if (window.MixerAudioSource) {
            window.MixerAudioSource.init().then(() => {
                const state = window.MixerAudioSource.getState();
                this.populateSelects(state);
                this.updateHint(state);
            }).catch(err => {
                console.error('[AudioSourceSelector] Falha ao inicializar MixerAudioSource:', err);
            });
        }
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
        const infoIcon = `<svg class="audio-source-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="color: #fbbf24; width: 14px; height: 14px; stroke-width: 2.25px;"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12.01" y1="16" y2="16"/><path d="M12 8v4"/></svg>`;

        this.innerHTML = `
            <style>
                .audio-source-panel {
                    background: rgba(15, 23, 42, 0.55);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 12px;
                    padding: 0.85rem;
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
                    backdrop-filter: blur(8px);
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                    width: 100%;
                    box-sizing: border-box;
                }
                .audio-source-col {
                    display: flex;
                    flex-direction: column;
                    gap: 0.35rem;
                    width: 100%;
                    box-sizing: border-box;
                }
                .audio-source-label {
                    display: flex;
                    align-items: center;
                    gap: 0.4rem;
                    font-size: 0.68rem;
                    color: rgba(148, 163, 184, 0.8);
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    user-select: none;
                }
                .audio-source-svg-icon {
                    width: 13px;
                    height: 13px;
                    stroke-width: 2.25px;
                    color: #22d3ee;
                    flex-shrink: 0;
                }
                .audio-source-select-wrap {
                    display: flex;
                    gap: 0.4rem;
                    align-items: center;
                    width: 100%;
                    position: relative;
                    box-sizing: border-box;
                }
                .audio-source-select {
                    width: 100%;
                    height: 36px;
                    background: rgba(15, 23, 42, 0.8);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    border-radius: 8px;
                    color: #f1f5f9;
                    font-size: 0.76rem;
                    padding: 0 2rem 0 0.75rem;
                    cursor: pointer;
                    outline: none;
                    transition: all 0.15s ease;
                    min-width: 0;
                    appearance: none;
                    -webkit-appearance: none;
                    -moz-appearance: none;
                    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba%28148,163,184,0.7%29' stroke-width='2.5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19.5 8.25l-7.5 7.5-7.5-7.5'/%3E%3C/svg%3E");
                    background-repeat: no-repeat;
                    background-position: right 0.75rem center;
                    background-size: 11px;
                    box-sizing: border-box;
                }
                .audio-source-select:hover {
                    border-color: rgba(6, 182, 212, 0.4);
                    background: rgba(30, 41, 59, 0.7);
                }
                .audio-source-select:focus {
                    border-color: #06b6d4;
                    box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.25);
                }
                .audio-source-perm-btn {
                    height: 36px;
                    background: rgba(6, 182, 212, 0.1);
                    border: 1px solid rgba(6, 182, 212, 0.3);
                    color: #22d3ee;
                    border-radius: 8px;
                    font-size: 0.7rem;
                    font-weight: 600;
                    padding: 0 0.75rem;
                    cursor: pointer;
                    white-space: nowrap;
                    transition: all 0.15s;
                    box-sizing: border-box;
                }
                .audio-source-perm-btn:hover {
                    background: rgba(6, 182, 212, 0.2);
                    border-color: #22d3ee;
                }
                .audio-source-channel-wrap {
                    display: flex;
                    flex-direction: column;
                    gap: 0.25rem;
                    width: 100%;
                    box-sizing: border-box;
                }
                .audio-source-channel-hint {
                    font-size: 0.64rem;
                    color: rgba(148, 163, 184, 0.45);
                    font-style: italic;
                    padding-left: 0.25rem;
                }
                .audio-source-hint {
                    display: flex;
                    align-items: flex-start;
                    gap: 0.45rem;
                    padding: 0.5rem 0.65rem;
                    background: rgba(245, 158, 11, 0.05);
                    border: 1px solid rgba(245, 158, 11, 0.15);
                    border-radius: 8px;
                    font-size: 0.65rem;
                    color: rgba(251, 191, 36, 0.85);
                    line-height: 1.35;
                    margin-top: 0.25rem;
                    box-sizing: border-box;
                }
                .audio-source-hint span {
                    flex: 1;
                }
                .audio-source-hint svg {
                    margin-top: 1px;
                }
            </style>
            <div class="audio-source-panel" id="audio-source-panel">
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
            inputSel.textContent = '';
            if (state.inputDevices.length === 0) {
                const emptyInput = document.createElement('option');
                emptyInput.value = '';
                emptyInput.textContent = 'Nenhum microfone encontrado';
                inputSel.appendChild(emptyInput);
            } else {
                state.inputDevices.forEach((d, i) => {
                    const label = d.label || `Microfone ${i + 1}`;
                    const option = document.createElement('option');
                    option.value = d.deviceId || '';
                    option.selected = d.deviceId === state.selectedInputId;
                    option.textContent = label;
                    inputSel.appendChild(option);
                });
            }
        }

        if (outputSel) {
            outputSel.textContent = '';
            const defaultOutput = document.createElement('option');
            defaultOutput.value = '';
            defaultOutput.textContent = 'Padrao do sistema';
            outputSel.appendChild(defaultOutput);
            state.outputDevices.forEach((d, i) => {
                const label = d.label || `Saida ${i + 1}`;
                const option = document.createElement('option');
                option.value = d.deviceId || '';
                option.selected = d.deviceId === state.selectedOutputId;
                option.textContent = label;
                outputSel.appendChild(option);
            });
        }
    }

    updateHint    }

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
