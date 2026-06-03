/**
 * SoundMaster — Mixer Audio Source Service
 * =========================================
 * Gerencia a seleção de dispositivos de áudio (entrada e saída)
 * para medições RT60 integradas com a mesa Soundcraft Ui24R.
 *
 * Funcionalidades:
 *  - Enumera microfones e saídas de áudio disponíveis no navegador
 *  - Detecta automaticamente se a Ui24R aparece como dispositivo USB de áudio
 *  - Permite trocar a fonte de áudio do analisador em tempo real
 *  - Usa setSinkId() para controlar a saída de áudio (sweep)
 *  - Mantém preferências do usuário via localStorage
 *
 * Nota sobre captura via mesa sem USB:
 *   Se a Ui24R não está configurada como interface USB, o usuário deve:
 *   a) Conectar o mic diretamente ao PC (recomendado para medição)
 *   b) Conectar a saída de fones/monitor da mesa no line-in do PC
 *
 * Uso:
 *   await MixerAudioSource.init();
 *   MixerAudioSource.renderDeviceSelector('container-id');
 *   const stream = await MixerAudioSource.getInputStream();
 */

(function () {
    'use strict';

    // ─── Estado ───────────────────────────────────────────────────────────────

    const _STORAGE_KEY = 'sm_audio_source_prefs';

    const _state = {
        inputDevices: [],  // MediaDeviceInfo[] - microfones
        outputDevices: [],  // MediaDeviceInfo[] - saídas
        selectedInputId: null,
        selectedOutputId: null,
        mixerChannel: null,  // Canal da mesa (contexto/referência)
        activeStream: null,
        permissionGranted: false,
    };

    const _renderedElements = new Set();

    // ─── Inicialização ────────────────────────────────────────────────────────

    async function init() {
        _loadPreferences();
        await _requestPermissionAndEnumerate();
        // Re-enumera quando dispositivos são conectados/desconectados
        if (navigator.mediaDevices) {
            navigator.mediaDevices.addEventListener('devicechange', _onDeviceChange);
        }
    }

    async function _requestPermissionAndEnumerate() {
        try {
            if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
                console.warn('[AudioSource] navigator.mediaDevices.getUserMedia não disponível.');
                _state.permissionGranted = false;
                await _enumerateDevices();
                return;
            }
            // Solicita permissão (necessário para ver labels dos dispositivos)
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            tempStream.getTracks().forEach(t => t.stop());
            _state.permissionGranted = true;
        } catch (err) {
            console.warn('[AudioSource] Permissão de microfone negada:', err.message);
            _state.permissionGranted = false;
        }
        await _enumerateDevices();
    }

    async function _enumerateDevices() {
        try {
            if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
                console.warn('[AudioSource] navigator.mediaDevices.enumerateDevices não disponível.');
                _notifyDevicesUpdated();
                return;
            }
            const devices = await navigator.mediaDevices.enumerateDevices();

            _state.inputDevices = devices.filter(d => d.kind === 'audioinput');
            _state.outputDevices = devices.filter(d => d.kind === 'audiooutput');

            // Auto-detecta Soundcraft Ui24R (aparece como "Soundcraft" ou "Ui24")
            const ui24rInput = _state.inputDevices.find(d =>
                /soundcraft|ui24|Ui24|Soundcraft/i.test(d.label)
            );
            const ui24rOutput = _state.outputDevices.find(d =>
                /soundcraft|ui24|Ui24|Soundcraft/i.test(d.label)
            );

            if (ui24rInput && !_state.selectedInputId) {
                _state.selectedInputId = ui24rInput.deviceId;
                console.log('[AudioSource] Ui24R detectada como entrada:', ui24rInput.label);
            }

            if (ui24rOutput && !_state.selectedOutputId) {
                _state.selectedOutputId = ui24rOutput.deviceId;
                console.log('[AudioSource] Ui24R detectada como saída:', ui24rOutput.label);
            }

            _notifyDevicesUpdated();
        } catch (err) {
            console.error('[AudioSource] Erro ao enumerar dispositivos:', err);
            _notifyDevicesUpdated();
        }
    }

    async function _onDeviceChange() {
        await _enumerateDevices();
    }

    // ─── Stream de Entrada ────────────────────────────────────────────────────

    /**
     * Retorna um MediaStream do dispositivo de entrada selecionado.
     * O SoundMasterAnalyzer usa este stream para capturar áudio.
     *
     * @param {Object} [opts] - Overrides opcionais para getUserMedia
     * @returns {Promise<MediaStream>}
     */
    async function getInputStream(opts) {
        if (_state.activeStream) {
            _state.activeStream.getTracks().forEach(t => t.stop());
        }

        const constraints = {
            audio: {
                deviceId: _state.selectedInputId
                    ? { exact: _state.selectedInputId }
                    : true,
                echoCancellation: false,  // Desabilita para medição acústica
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
                sampleRate: { ideal: 48000 },
                ...(opts || {}),
            },
            video: false,
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            _state.activeStream = stream;
            return stream;
        } catch (err) {
            console.error('[AudioSource] Erro ao abrir stream de entrada:', err);
            // Fallback: tenta sem deviceId específico
            if (_state.selectedInputId) {
                console.warn('[AudioSource] Tentando dispositivo padrão como fallback...');
                _state.selectedInputId = null;
                return getInputStream(opts);
            }
            throw err;
        }
    }

    /**
     * Aplica o dispositivo de saída selecionado a um elemento de áudio/vídeo.
     * Usa a API setSinkId() (Chrome/Edge).
     *
     * @param {HTMLMediaElement|AudioContext} target
     */
    async function applyOutputDevice(target) {
        if (!_state.selectedOutputId) return;
        if (!target || typeof target.setSinkId !== 'function') return;
        try {
            await target.setSinkId(_state.selectedOutputId);
        } catch (err) {
            console.warn('[AudioSource] setSinkId falhou:', err.message);
        }
    }

    // ─── Seletores ────────────────────────────────────────────────────────────

    function setInputDevice(deviceId) {
        _state.selectedInputId = deviceId;
        _savePreferences();
        // Se o analisador tem stream ativo, notifica para re-abrir
        _notifyStreamChanged();
    }

    function setOutputDevice(deviceId) {
        _state.selectedOutputId = deviceId;
        _savePreferences();
        _notifyStreamChanged();
    }

    function setMixerChannel(channel) {
        _state.mixerChannel = channel ? parseInt(channel, 10) : null;
        _savePreferences();
    }

    // ─── Renderização de UI ───────────────────────────────────────────────────

    /**
     * Renderiza os seletores de dispositivo em um contêiner existente.
     * Substituiu qualquer conteúdo anterior no contêiner.
     *
     * @param {string|HTMLElement} container - ID ou elemento DOM
     * @param {Object} opts - { showChannel: bool, onInputChange, onOutputChange }
     */
    function renderDeviceSelector(container, opts = {}) {
        const el = typeof container === 'string'
            ? document.getElementById(container)
            : container;
        if (!el) return;

        // Cleanup old selectors that are no longer in any DOM document
        for (const activeEl of _renderedElements) {
            if (!activeEl.ownerDocument || !activeEl.ownerDocument.contains(activeEl)) {
                _renderedElements.delete(activeEl);
            }
        }
        _renderedElements.add(el);

        const { showChannel = true, onInputChange, onOutputChange } = opts;

        el.innerHTML = `
            <div class="audio-source-panel" id="audio-source-panel">
                <div class="audio-source-grid">
                    <div class="audio-source-col">
                        <label class="audio-source-label">
                            <span class="audio-source-icon">🎤</span>
                            Entrada (Microfone)
                        </label>
                        <div class="audio-source-select-wrap">
                            <select id="audio-input-select" class="audio-source-select">
                                <option value="">Carregando...</option>
                            </select>
                            ${!_state.permissionGranted ? `
                            <button id="btn-request-permission" class="audio-source-perm-btn">
                                Permitir
                            </button>` : ''}
                        </div>
                    </div>

                    <div class="audio-source-col">
                        <label class="audio-source-label">
                            <span class="audio-source-icon">🔊</span>
                            Saída (Sweep)
                        </label>
                        <select id="audio-output-select" class="audio-source-select">
                            <option value="">Padrão do sistema</option>
                        </select>
                    </div>

                    ${showChannel ? `
                    <div class="audio-source-col">
                        <label class="audio-source-label">
                            <span class="audio-source-icon">📡</span>
                            Canal da Mesa (referência)
                        </label>
                        <div class="audio-source-channel-wrap">
                            <select id="audio-mixer-channel" class="audio-source-select">
                                <option value="">— Nenhum —</option>
                                ${Array.from({ length: 24 }, (_, i) =>
            `<option value="${i + 1}" ${_state.mixerChannel === i + 1 ? 'selected' : ''}>
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
                    <span>💡</span>
                    <span>Dica: Sem Ui24R USB? Conecte a saída de fones da mesa ao line-in do PC e selecione acima.</span>
                </div>
            </div>
        `;

        _injectStyles();
        _populateSelects();

        // Handlers scoped directly to the rendered element
        const inputSel = el.querySelector('#audio-input-select');
        const outputSel = el.querySelector('#audio-output-select');
        const channelSel = el.querySelector('#audio-mixer-channel');
        const permBtn = el.querySelector('#btn-request-permission');

        inputSel?.addEventListener('change', e => {
            setInputDevice(e.target.value || null);
            onInputChange?.(e.target.value);
        });

        outputSel?.addEventListener('change', e => {
            setOutputDevice(e.target.value || null);
            onOutputChange?.(e.target.value);
        });

        channelSel?.addEventListener('change', e => {
            setMixerChannel(e.target.value);
        });

        permBtn?.addEventListener('click', async () => {
            await _requestPermissionAndEnumerate();
            renderDeviceSelector(el, opts); // re-renderiza com dispositivos
        });

        // Mostra hint se não tem Ui24R como USB
        const hasUi24rUsb = _state.inputDevices.some(d => /soundcraft|ui24/i.test(d.label));
        const hintEl = el.querySelector('#audio-source-ui24r-hint');
        if (hintEl && !hasUi24rUsb) hintEl.style.display = 'flex';
    }

    function _populateSelects() {
        for (const root of _renderedElements) {
            const inputSel = root.querySelector('#audio-input-select');
            const outputSel = root.querySelector('#audio-output-select');

            if (inputSel) {
                inputSel.innerHTML = _state.inputDevices.map((d, i) => {
                    const label = d.label || `Microfone ${i + 1}`;
                    const isUi24 = /soundcraft|ui24/i.test(label);
                    const prefix = isUi24 ? '📡 ' : '🎤 ';
                    return `<option value="${d.deviceId}" ${d.deviceId === _state.selectedInputId ? 'selected' : ''}>
                        ${prefix}${label}
                    </option>`;
                }).join('') || '<option value="">Nenhum microfone encontrado</option>';
            }

            if (outputSel) {
                outputSel.innerHTML = '<option value="">🔊 Padrão do sistema</option>' +
                    _state.outputDevices.map((d, i) => {
                        const label = d.label || `Saída ${i + 1}`;
                        const isUi24 = /soundcraft|ui24/i.test(label);
                        const prefix = isUi24 ? '📡 ' : '🔊 ';
                        return `<option value="${d.deviceId}" ${d.deviceId === _state.selectedOutputId ? 'selected' : ''}>
                            ${prefix}${label}
                        </option>`;
                    }).join('');
            }
        }
    }


    // ─── Persistência ─────────────────────────────────────────────────────────

    function _savePreferences() {
    try {
        localStorage.setItem(_STORAGE_KEY, JSON.stringify({
            inputId: _state.selectedInputId,
            outputId: _state.selectedOutputId,
            channel: _state.mixerChannel,
        }));
    } catch (_) { }
}

function _loadPreferences() {
    try {
        const saved = JSON.parse(localStorage.getItem(_STORAGE_KEY) || '{}');
        if (saved.inputId) _state.selectedInputId = saved.inputId;
        if (saved.outputId) _state.selectedOutputId = saved.outputId;
        if (saved.channel) _state.mixerChannel = saved.channel;
    } catch (_) { }
}

// ─── Notificações ─────────────────────────────────────────────────────────

function _notifyDevicesUpdated() {
    document.dispatchEvent(new CustomEvent('audio_devices_updated', {
        detail: {
            inputs: _state.inputDevices,
            outputs: _state.outputDevices,
        }
    }));
    _populateSelects();
}

function _notifyStreamChanged() {
    document.dispatchEvent(new CustomEvent('audio_source_changed', {
        detail: {
            inputId: _state.selectedInputId,
            outputId: _state.selectedOutputId,
            channel: _state.mixerChannel,
        }
    }));
}

// ─── CSS injetado ─────────────────────────────────────────────────────────

function _injectStyles() {
    if (document.getElementById('audio-source-styles')) return;
    const style = document.createElement('style');
    style.id = 'audio-source-styles';
    style.textContent = `
            .audio-source-panel {
                display: flex;
                flex-direction: column;
                gap: 1rem;
                padding: 1.25rem;
                background: rgba(15, 23, 42, 0.45);
                border: 1px solid rgba(6, 182, 212, 0.18);
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
            }
            .audio-source-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 1.25rem;
                align-items: flex-start;
            }
            .audio-source-col {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
            }
            .audio-source-label {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                font-size: 0.72rem;
                color: rgba(148, 163, 184, 0.85);
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .audio-source-svg-icon {
                width: 14px;
                height: 14px;
                stroke-width: 2.25px;
                color: #22d3ee;
                flex-shrink: 0;
            }
            .audio-source-select-wrap {
                display: flex;
                gap: 0.5rem;
                align-items: center;
                width: 100%;
            }
            .audio-source-select {
                width: 100%;
                background: rgba(15, 23, 42, 0.9);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 8px;
                color: #f1f5f9;
                font-size: 0.78rem;
                padding: 0.5rem 0.75rem;
                cursor: pointer;
                outline: none;
                transition: all 0.15s ease;
                min-width: 0;
            }
            .audio-source-select:focus {
                border-color: rgba(6, 182, 212, 0.6);
                box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.2);
            }
            .audio-source-channel-wrap {
                display: flex;
                flex-direction: column;
                gap: 0.35rem;
                width: 100%;
            }
            .audio-source-channel-hint {
                font-size: 0.68rem;
                color: rgba(148, 163, 184, 0.45);
                font-style: italic;
            }
            .audio-source-perm-btn {
                background: rgba(6, 182, 212, 0.15);
                border: 1px solid rgba(6, 182, 212, 0.35);
                color: #22d3ee;
                border-radius: 6px;
                font-size: 0.72rem;
                padding: 0.4rem 0.8rem;
                cursor: pointer;
                white-space: nowrap;
                transition: all 0.15s;
            }
            .audio-source-perm-btn:hover { 
                background: rgba(6, 182, 212, 0.25);
                border-color: rgba(6, 182, 212, 0.5);
            }
            .audio-source-hint {
                display: flex;
                align-items: center;
                gap: 0.6rem;
                padding: 0.65rem 1rem;
                background: rgba(245, 158, 11, 0.06);
                border: 1px solid rgba(245, 158, 11, 0.15);
                border-radius: 8px;
                font-size: 0.72rem;
                color: rgba(251, 191, 36, 0.85);
            }
        `;
    document.head.appendChild(style);
}

// ─── Export ───────────────────────────────────────────────────────────────

window.MixerAudioSource = {
    init,
    getInputStream,
    applyOutputDevice,
    setInputDevice,
    setOutputDevice,
    setMixerChannel,
    renderDeviceSelector,
    getState: () => ({ ..._state }),
    getSelectedChannel: () => _state.mixerChannel,
};
}) ();
