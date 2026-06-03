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
        inputDevices:   [],  // MediaDeviceInfo[] - microfones
        outputDevices:  [],  // MediaDeviceInfo[] - saídas
        selectedInputId:  null,
        selectedOutputId: null,
        mixerChannel:     null,  // Canal da mesa (contexto/referência)
        activeStream:     null,
        permissionGranted: false,
    };

    // ─── Inicialização ────────────────────────────────────────────────────────

    async function init() {
        _loadPreferences();
        await _requestPermissionAndEnumerate();
        // Re-enumera quando dispositivos são conectados/desconectados
        navigator.mediaDevices?.addEventListener('devicechange', _onDeviceChange);
    }

    async function _requestPermissionAndEnumerate() {
        try {
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
            const devices = await navigator.mediaDevices.enumerateDevices();

            _state.inputDevices  = devices.filter(d => d.kind === 'audioinput');
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
                autoGainControl:  false,
                channelCount:     1,
                sampleRate:       { ideal: 48000 },
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

        const { showChannel = true, onInputChange, onOutputChange } = opts;

        el.innerHTML = `
            <div class="audio-source-panel" id="audio-source-panel">
                <div class="audio-source-row">
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
                            Permitir acesso
                        </button>` : ''}
                    </div>
                </div>

                <div class="audio-source-row">
                    <label class="audio-source-label">
                        <span class="audio-source-icon">🔊</span>
                        Saída (Sweep)
                    </label>
                    <select id="audio-output-select" class="audio-source-select">
                        <option value="">Padrão do sistema</option>
                    </select>
                </div>

                ${showChannel ? `
                <div class="audio-source-row">
                    <label class="audio-source-label">
                        <span class="audio-source-icon">📡</span>
                        Canal da Mesa (referência)
                    </label>
                    <div class="audio-source-channel-wrap">
                        <select id="audio-mixer-channel" class="audio-source-select audio-source-channel-select">
                            <option value="">— Nenhum —</option>
                            ${Array.from({ length: 24 }, (_, i) =>
                                `<option value="${i+1}" ${_state.mixerChannel === i+1 ? 'selected' : ''}>
                                    Canal ${i+1}
                                </option>`
                            ).join('')}
                        </select>
                        <span class="audio-source-channel-hint">
                            Mic de medição conectado a este canal
                        </span>
                    </div>
                </div>` : ''}

                <div id="audio-source-ui24r-hint" class="audio-source-hint" style="display:none">
                    <span>💡</span>
                    <span>Dica: Sem Ui24R USB? Conecte a saída de fones da mesa ao line-in do PC e selecione acima.</span>
                </div>
            </div>
        `;

        _injectStyles();
        _populateSelects();

        // Handlers
        const inputSel = document.getElementById('audio-input-select');
        const outputSel = document.getElementById('audio-output-select');
        const channelSel = document.getElementById('audio-mixer-channel');
        const permBtn = document.getElementById('btn-request-permission');

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
        const hintEl = document.getElementById('audio-source-ui24r-hint');
        if (hintEl && !hasUi24rUsb) hintEl.style.display = 'flex';
    }

    function _populateSelects() {
        const inputSel  = document.getElementById('audio-input-select');
        const outputSel = document.getElementById('audio-output-select');

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

    // ─── Persistência ─────────────────────────────────────────────────────────

    function _savePreferences() {
        try {
            localStorage.setItem(_STORAGE_KEY, JSON.stringify({
                inputId:  _state.selectedInputId,
                outputId: _state.selectedOutputId,
                channel:  _state.mixerChannel,
            }));
        } catch (_) {}
    }

    function _loadPreferences() {
        try {
            const saved = JSON.parse(localStorage.getItem(_STORAGE_KEY) || '{}');
            if (saved.inputId)  _state.selectedInputId  = saved.inputId;
            if (saved.outputId) _state.selectedOutputId = saved.outputId;
            if (saved.channel)  _state.mixerChannel     = saved.channel;
        } catch (_) {}
    }

    // ─── Notificações ─────────────────────────────────────────────────────────

    function _notifyDevicesUpdated() {
        document.dispatchEvent(new CustomEvent('audio_devices_updated', {
            detail: {
                inputs:  _state.inputDevices,
                outputs: _state.outputDevices,
            }
        }));
        _populateSelects();
    }

    function _notifyStreamChanged() {
        document.dispatchEvent(new CustomEvent('audio_source_changed', {
            detail: {
                inputId:  _state.selectedInputId,
                outputId: _state.selectedOutputId,
                channel:  _state.mixerChannel,
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
                gap: 0.6rem;
                padding: 0.75rem;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.07);
                border-radius: 0.75rem;
            }
            .audio-source-row {
                display: flex;
                align-items: center;
                gap: 0.75rem;
                flex-wrap: wrap;
            }
            .audio-source-label {
                display: flex;
                align-items: center;
                gap: 0.4rem;
                font-size: 0.75rem;
                color: rgba(148,163,184,0.8);
                font-weight: 500;
                min-width: 130px;
            }
            .audio-source-icon { font-size: 0.9rem; }
            .audio-source-select-wrap {
                display: flex;
                gap: 0.5rem;
                align-items: center;
                flex: 1;
            }
            .audio-source-select {
                flex: 1;
                background: rgba(15,23,42,0.8);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 0.5rem;
                color: #e2e8f0;
                font-size: 0.78rem;
                padding: 0.35rem 0.6rem;
                cursor: pointer;
                min-width: 0;
            }
            .audio-source-select:focus {
                outline: none;
                border-color: rgba(6,182,212,0.5);
                box-shadow: 0 0 0 2px rgba(6,182,212,0.15);
            }
            .audio-source-channel-wrap {
                display: flex;
                gap: 0.5rem;
                align-items: center;
                flex: 1;
            }
            .audio-source-channel-select { max-width: 120px; }
            .audio-source-channel-hint {
                font-size: 0.68rem;
                color: rgba(148,163,184,0.5);
                font-style: italic;
            }
            .audio-source-perm-btn {
                background: rgba(6,182,212,0.2);
                border: 1px solid rgba(6,182,212,0.4);
                color: #06b6d4;
                border-radius: 0.4rem;
                font-size: 0.72rem;
                padding: 0.3rem 0.7rem;
                cursor: pointer;
                white-space: nowrap;
                transition: background 0.15s;
            }
            .audio-source-perm-btn:hover { background: rgba(6,182,212,0.3); }
            .audio-source-hint {
                display: flex;
                align-items: flex-start;
                gap: 0.5rem;
                padding: 0.5rem 0.75rem;
                background: rgba(245,158,11,0.08);
                border: 1px solid rgba(245,158,11,0.2);
                border-radius: 0.5rem;
                font-size: 0.72rem;
                color: rgba(245,158,11,0.8);
                margin-top: 0.25rem;
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
})();
