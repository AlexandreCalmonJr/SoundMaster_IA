/**
 * SoundMaster — MixerService
 * Centraliza todas as operações de controle da mesa Soundcraft Ui.
 * Usa SocketService para emitir eventos e AppStore para atualizar estado.
 *
 * USO:
 *   MixerService.connect('10.10.1.1');
 *   MixerService.setMasterLevel(0.75);
 *   MixerService.applyHpf(3, 100);
 */
(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // Helpers internos
    // -------------------------------------------------------------------------

    function _clamp(value, min, max) {
        const num = Number(value);
        return isNaN(num) ? min : Math.min(max, Math.max(min, num));
    }

    function _validateChannel(channel) {
        const ch = Number(channel);
        if (!Number.isInteger(ch) || ch < 1 || ch > 24) {
            console.warn('[MixerService] Canal inválido:', channel);
            return -1;
        }
        return ch;
    }

    /**
     * ✅ Novo: Converte valor linear de VU (0..1) para altura percentual baseada em dB logarítmico.
     * Escala interna da mesa: 0 = -80dB, 1 = 0dB.
     */
    function vuToHeight(linearValue) {
        const val = Number(linearValue) || 0;
        const db = -80 + (val * 80); // Mapeia 0..1 para -80..0 dB
        const minDb = -60; // Piso visual do medidor
        const maxDb = 0;   // Teto visual
        
        const percent = ((db - minDb) / (maxDb - minDb)) * 100;
        return _clamp(percent, 0, 100);
    }

    /**
     * Emite um evento para o servidor e registra no log.
     * @param {string} event
     * @param {Object} data
     * @param {string} logMsg
     */
    function _emit(event, data, logMsg) {
        if (!SocketService.isConnected()) {
            AppStore.addLog('⚠️ Conecte-se à mesa antes de usar este recurso.');
            return false;
        }
        SocketService.emit(event, data);
        if (logMsg) AppStore.addLog(logMsg);
        return true;
    }

    // -------------------------------------------------------------------------
    // Conexão
    // -------------------------------------------------------------------------

    /**
     * Conecta ao mixer no IP fornecido.
     * @param {string} ip
     */
    function connect(ip, brand) {
        if (!ip || !ip.trim()) {
            AppStore.addLog('⚠️ Insira um IP válido para conectar.');
            return;
        }
        const cleanIp = ip.trim();
        AppStore.setState({ mixerIp: cleanIp, mixerStatusMsg: 'Conectando...' });
        AppStore.addLog(`Tentando conectar em ${cleanIp} (${brand || 'soundcraft'})...`);
        SocketService.emit('connect_mixer', { ip: cleanIp, brand: brand || 'soundcraft' });
    }

    /**
     * Desconecta do mixer atual.
     */
    function disconnect() {
        AppStore.addLog('Solicitando desconexão do mixer...');
        SocketService.emit('disconnect_mixer');
    }

    // -------------------------------------------------------------------------
    // Master
    // -------------------------------------------------------------------------

    /**
     * Define o nível do master (0.0 – 1.0).
     * Usa throttle com requestAnimationFrame para não sobrecarregar o servidor.
     * @param {number} level
     */
    let _pendingMasterEmit = false;
    let _pendingMasterLevel = null;

    function setMasterLevel(level) {
        const clamped = _clamp(level, 0, 1);
        _pendingMasterLevel = clamped;

        // Atualiza UI imediatamente (otimista)
        AppStore.setState({ masterLevel: clamped });

        if (_pendingMasterEmit) return;
        _pendingMasterEmit = true;

        requestAnimationFrame(function () {
            if (_pendingMasterLevel !== null) {
                SocketService.emit('set_master_level', { level: _pendingMasterLevel });
                _pendingMasterLevel = null;
            }
            _pendingMasterEmit = false;
        });
    }

    /**
     * Ajusta o master em delta percentual (-100 a +100).
     * @param {number} deltaPercent
     */
    function adjustMasterLevel(deltaPercent) {
        const current = AppStore.getState().masterLevel;
        const next = _clamp(current + deltaPercent / 100, 0, 1);
        setMasterLevel(next);
    }

    // -------------------------------------------------------------------------
    // Ações de canal
    // -------------------------------------------------------------------------

    /**
     * @param {number} channel  1–24
     * @param {number} [hz=100] Frequência de corte em Hz
     */
    function applyHpf(channel, hz) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        const freq = _clamp(hz || 100, 20, 400);
        return _emit('apply_channel_hpf', { channel: ch, hz: freq },
            'HPF ' + freq + 'Hz solicitado no canal ' + ch + '.');
    }

    /**
     * @param {number} channel
     * @param {number} [threshold=-52]
     */
    function applyGate(channel, threshold) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        const thresh = _clamp(threshold !== undefined ? threshold : -52, -80, 0);
        return _emit('apply_channel_gate', { channel: ch, enabled: 1, threshold: thresh },
            'Gate leve solicitado no canal ' + ch + '.');
    }

    /**
     * @param {number} channel
     * @param {number} [ratio=2.5]
     * @param {number} [threshold=-18]
     */
    function applyCompressor(channel, ratio, threshold) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        return _emit('apply_channel_compressor', {
            channel: ch,
            ratio: _clamp(ratio || 2.5, 1, 20),
            threshold: _clamp(threshold !== undefined ? threshold : -18, -60, 0)
        }, 'Compressor leve solicitado no canal ' + ch + '.');
    }

    /**
     * @param {'channel'|'master'} target
     * @param {number|null} channel  - necessário se target === 'channel'
     * @param {number} hz
     * @param {number} [gain=-3]
     * @param {number} [q=1.4]
     * @param {number} [band=2]
     */
    function applyEqCut(target, channel, hz, gain, q, band) {
        const eqCh = target === 'channel' ? _validateChannel(channel) : -1;
        if (target === 'channel' && eqCh < 1) return false;
        const payload = {
            target: target,
            channel: target === 'channel' ? eqCh : null,
            hz: _clamp(hz, 20, 20000),
            gain: _clamp(gain !== undefined ? gain : -3, -12, 6),
            q: _clamp(q !== undefined ? q : 1.4, 0.2, 10),
            band: _clamp(band !== undefined ? band : 2, 1, 4)
        };
        const label = target === 'master' ? 'Master' : 'canal ' + payload.channel;
        return _emit('apply_eq_cut', payload,
            'EQ ' + payload.hz + 'Hz (' + payload.gain + 'dB) solicitado no ' + label + '.');
    }

    /**
     * @param {boolean} enabled
     */
    function setAfs(enabled) {
        return _emit('set_afs_enabled', { enabled: enabled ? 1 : 0 },
            'AFS2 ' + (enabled ? 'ativado' : 'desativado') + ' globalmente.');
    }

    /**
     * @param {number} channel
     * @param {Object} [opts] - Parâmetros opcionais do preset
     */
    function runCleanSoundPreset(channel, opts) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        return _emit('run_clean_sound_preset', Object.assign({ channel: ch }, opts || {}),
            'Preset de som limpo solicitado no canal ' + ch + '.');
    }

    /**
     * Corta frequência de feedback no master (usado pelo detector).
     * @param {number} hz
     */
    function cutFeedback(hz) {
        return _emit('cut_feedback', { hz: Math.round(hz) },
            'Corte de feedback solicitado em ' + Math.round(hz) + ' Hz.');
    }

    /**
     * Aplica EQ paramétrico no canal especificado.
     * Usado pelo Auto-Cut de feedback.
     * @param {number} channel - Canal (1-16 ou 'master')
     * @param {number} freq - Frequência central em Hz
     * @param {number} q - Fator Q (largura da banda)
     * @param {number} gainDb - Ganho em dB (negativo para corte)
     */
    function applyEQ(channel, freq, q, gainDb) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        const payload = {
            channel: ch,
            freq: Math.round(freq),
            q: Math.round(q * 10) / 10,
            gain: Math.round(gainDb * 10) / 10,
            type: 'peaking'
        };
        
        _logAutoCutAction({
            timestamp: new Date().toISOString(),
            action: 'applyEQ',
            channel: ch,
            freq: payload.freq,
            q: payload.q,
            gain: payload.gain,
            source: 'feedback-detector'
        });
        
        return _emit('apply_parametric_eq', payload, 
            `EQ Aplicado: ${gainDb}dB em ${freq}Hz (Q=${q}) no canal ${ch}`);
    }

    /**
     * Aplica um Notch Filter (corte estreito) na frequência de feedback.
     * @param {number} channel - Canal (1-16 ou 'master')
     * @param {number} freq - Frequência central em Hz
     * @param {number} gainDb - Ganho negativo (ex: -3, -6)
     */
    function applyNotchFilter(channel, freq, gainDb = -3) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        const q = 30; // Q bem alto para notch estreito
        
        _logAutoCutAction({
            timestamp: new Date().toISOString(),
            action: 'notch',
            channel: ch,
            freq: Math.round(freq),
            q: q,
            gain: gainDb,
            source: 'feedback-detector'
        });
        
        return _emit('apply_notch_filter', {
            channel: ch,
            freq: Math.round(freq),
            q: q,
            gain: gainDb
        }, `Notch Filter: ${gainDb}dB em ${Math.round(freq)}Hz (Q=${q})`);
    }

    /**
     * Registra ação de Auto-Cut no log local.
     * @param {Object} actionData
     */
    const _autoCutLog = [];
    function _logAutoCutAction(actionData) {
        _autoCutLog.push(actionData);
        console.log('[AutoCut-Log]', JSON.stringify(actionData));
        
        // Limita o log a 50 entradas para evitar memory leak
        if (_autoCutLog.length > 50) _autoCutLog.shift();
    }

    /**
     * Retorna o histórico de ações de Auto-Cut.
     * @returns {Array}
     */
    function getAutoCutLog() {
        return [..._autoCutLog];
    }

    /**
     * Limpa o histórico de Auto-Cut.
     */
    function clearAutoCutLog() {
        _autoCutLog.length = 0;
    }

    /**
     * Executa um comando vindo da IA (objeto com action, desc, etc.).
     * @param {Object} command
     */
    function executeAICommand(command) {
        if (!command || !command.action) {
            AppStore.addLog('⚠️ Comando IA inválido recebido.');
            return false;
        }
        return _emit('execute_ai_command', command,
            'Executando comando IA: ' + (command.desc || command.action));
    }

    /**
     * Liga/Desliga o gerador de ruído rosa.
     * @param {boolean} enabled 
     * @param {number} [level=-20] 
     */
    function setOscillator(enabled, level) {
        return _emit('set_oscillator', { enabled: enabled ? 1 : 0, type: 1, level: level || -20 },
            'Gerador de ruído rosa ' + (enabled ? 'ativado' : 'desativado') + '.');
    }

    // -------------------------------------------------------------------------
    // Presets e Undo
    // -------------------------------------------------------------------------

    function savePreset(name) {
        return _emit('save_preset', { name: name }, 'Salvando preset: ' + name);
    }

    function listPresets() {
        SocketService.emit('list_presets');
    }

    function loadPreset(id) {
        return _emit('load_preset', id, 'Carregando preset...');
    }

    function undo() {
        return _emit('undo_command', {}, 'Desfazer última ação solicitada.');
    }

    /**
     * Define o delay (atraso) de uma saída auxiliar.
     * @param {number} auxChannel 1-10
     * @param {number} ms Milissegundos (0-500ms)
     */
    function setDelay(auxChannel, ms) {
        const aux = _clamp(auxChannel, 1, 10);
        const time = _clamp(ms, 0, 500);
        
        return _emit('set_aux_delay', { aux: aux, ms: time },
            'Ajustando Delay do Aux ' + aux + ' para ' + time + 'ms.');
    }

    /**
     * Define o nível de envio de um canal para um auxiliar (Monitor).
     * @param {number} channel  1–24
     * @param {number} auxChannel 1-10 (Ui24R tem 10 aux)
     * @param {number} level 0.0 - 1.0
     */
    function setAuxLevel(channel, auxChannel, level) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        const aux = _clamp(auxChannel, 1, 10);
        const clamped = _clamp(level, 0, 1);
        
        return _emit('set_aux_level', { channel: ch, aux: aux, level: clamped },
            'Ajustando envio do canal ' + ch + ' para o Aux ' + aux + ' em ' + Math.round(clamped * 100) + '%.');
    }

    /**
     * Define o nível de envio de um canal para um engine de efeito (FX).
     * @param {number} channel 1-24
     * @param {number} fxChannel 1-4
     * @param {number} level 0.0 - 1.0
     */
    function setFxLevel(channel, fxChannel, level) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        const fx = _clamp(fxChannel, 1, 4);
        const clamped = _clamp(level, 0, 1);
        
        return _emit('set_fx_level', { channel: ch, fx: fx, level: clamped },
            'Ajustando envio do canal ' + ch + ' para o FX ' + fx + ' em ' + Math.round(clamped * 100) + '%.');
    }

    /**
     * Envia uma mensagem RAW diretamente para a mesa.
     * @param {string} message 
     */
    function sendRaw(message) {
        return _emit('send_raw_message', { message: message }, 'Comando RAW enviado: ' + message);
    }

    /**
     * Carrega os nomes personalizados dos canais e auxiliares do banco de dados.
     */
    async function loadNames() {
        try {
            const res = await fetch('/api/mixer/names');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            AppStore.setState({ mixerNames: data });
            return data;
        } catch (err) {
            console.error('[MixerService] Erro ao carregar nomes:', err);
            return { channels: {}, aux: {} };
        }
    }

    /**
     * Salva os nomes personalizados no banco de dados.
     * @param {Object} names - { channels: {...}, aux: {...} }
     */
    async function saveNames(names) {
        try {
            // ✅ Sincroniza cada nome com a mesa física
            if (names.channels) {
                Object.keys(names.channels).forEach(ch => {
                    setChannelName(ch, names.channels[ch]);
                });
            }

            const res = await fetch('/api/mixer/names', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(names)
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            AppStore.setState({ mixerNames: names });
            AppStore.addLog('Etiquetas do mixer salvas e sincronizadas.');
            return await res.json();
        } catch (err) {
            console.error('[MixerService] Erro ao salvar nomes:', err);
            return null;
        }
    }

    // -------------------------------------------------------------------------
    // Novos Controles Avançados (Ui24R)
    // -------------------------------------------------------------------------

    function recorderControl(action) {
        return _emit('recorder_cmd', { action_type: action }, 'Gravador 2-Track: ' + action);
    }

    function mtkControl(action) {
        return _emit('mtk_cmd', { action_type: action }, 'Multitrack: ' + action);
    }

    function setFxBpm(fx, bpm) {
        return _emit('set_fx_bpm', { fx: fx, val: bpm }, 'FX ' + fx + ' BPM: ' + bpm);
    }

    function showControl(action, show, target) {
        return _emit('show_cmd', { action_type: action, show: show, target: target }, 'Show/Scene: ' + action);
    }

    function automixControl(action, val) {
        return _emit('automix_cmd', { action_type: action, val: val }, 'Automix: ' + action);
    }

    function fadeMaster(level, time) {
        return _emit('fade_master', { level: level, time: time }, 'Fade Master iniciado...');
    }

    function fadeChannel(channel, level, time) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        return _emit('fade_channel', { channel: ch, level: level, time: time }, 'Fade Canal ' + ch + ' iniciado...');
    }

    function setPhantomPower(hwInput, enabled) {
        return _emit('set_phantom_power', { input: Number(hwInput), enabled: !!enabled }, 
            'Phantom Power (48V) na entrada ' + hwInput + ': ' + (enabled ? 'ON' : 'OFF'));
    }

    function setHwGain(hwInput, gain) {
        const val = _clamp(gain, 0, 1);
        return _emit('set_hw_gain', { input: Number(hwInput), val: val }, 
            'Ganho de Hardware na entrada ' + hwInput + ' ajustado.');
    }

    function setChannelName(channel, name) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        const cleanName = String(name || '').substring(0, 20);
        return _emit('set_channel_name', { channel: ch, name: cleanName });
    }

    function setMasterMute(enabled) {
        const state = enabled ? 1 : 0;
        AppStore.setState({ masterMute: !!enabled });
        return _emit('execute_ai_command', {
            action: 'master_mute',
            enabled: state
        }, enabled ? 'Master MUTADO.' : 'Master DESMUTADO.');
    }

    function setChannelMute(channel, enabled) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        const state = enabled ? 1 : 0;
        AppStore.setState({ [`mute_ch_${ch}`]: !!enabled });
        return _emit('execute_ai_command', {
            action: 'channel_mute',
            channel: ch,
            enabled: state
        }, enabled ? `Canal ${ch} MUTADO.` : `Canal ${ch} DESMUTADO.`);
    }

    function setChannelLevel(channel, level) {
        const ch = _validateChannel(channel);
        if (ch < 1) return false;
        const clamped = _clamp(level, 0, 1);
        AppStore.setState({ [`ch_${ch}_level`]: clamped });
        return _emit('execute_ai_command', {
            action: 'channel_fader',
            channel: ch,
            level: clamped
        }, `Canal ${ch} -> ${Math.round(clamped * 100)}%.`);
    }

    // -------------------------------------------------------------------------
    // Exportação
    // -------------------------------------------------------------------------
    window.MixerService = {
        connect,
        disconnect,
        setMasterLevel,
        adjustMasterLevel,
        setMasterMute,
        setChannelMute,
        setChannelLevel,
        applyHpf,
        applyGate,
        applyCompressor,
        applyEqCut,
        setAfs,
        runCleanSoundPreset,
        cutFeedback,
        executeAICommand,
        setOscillator,
        setAuxLevel,
        setFxLevel,
        setDelay,
        savePreset,
        listPresets,
        loadPreset,
        undo,
        sendRaw,
        loadNames,
        saveNames,
        recorderControl,
        mtkControl,
        setFxBpm,
        showControl,
        automixControl,
        fadeMaster,
        fadeChannel,
        setPhantomPower,
        setHwGain,
        setChannelName,
        vuToHeight,
        // Auto-Cut / Feedback Detection
        applyEQ,
        applyNotchFilter,
        getAutoCutLog,
        clearAutoCutLog,
        pingMixer: function() {
            return _emit('ping_mixer', {}, 'Solicitando status da mesa...');
        }
    };
})();
