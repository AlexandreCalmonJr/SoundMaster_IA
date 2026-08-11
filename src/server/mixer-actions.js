const mixerSingleton = require('./mixer-singleton');
const database = require('./database');

/**
 * Erro lançado quando a mesa não está ligada ou a conexão OSC foi perdida.
 * Capturado no handler de comando e re-emitido como `mixer_status` ao cliente.
 */
class MixerOfflineError extends Error {
    constructor(reason) {
        super(reason || 'Mesa offline ou sem conexão OSC');
        this.name = 'MixerOfflineError';
        this.code = 'MIXER_OFFLINE';
    }
}

const AI_COMMAND_ALLOWLIST = new Set([
    'volume_up', 'volume_down',
    'set_fader_level_db', 'change_fader_level', 'change_fader_level_db',
    'set_channel_level', 'channel_fader',
    'channel_mute', 'toggle_channel_mute',
    'change_channel_pan', 'set_channel_pan',
    'eq_cut', 'apply_channel_hpf', 'apply_channel_gate', 'apply_channel_compressor',
    'set_aux_level', 'master_mute', 'run_clean_sound_preset',
    'toggle_solo', 'set_solo',
    'set_master_level',
    'set_master_pan', 'change_master_pan',
    'set_master_dim', 'toggle_dim',
    'set_delay',
    'log'
]);

function createMixerActions(getMixer) {
    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, Number(value)));
    }

    function ensureMixer(socket) {
        const mixer = getMixer();
        if (!mixer || (!mixer.conn && !mixer.isSimulated)) {
            if (socket) socket.emit('mixer_status', { connected: false, msg: 'Conecte-se a mesa primeiro!' });
            return false;
        }
        return true;
    }

    /**
     * Envia mensagem OSC cru pela conexão WebSocket da Ui24R.
     * Lança `MixerOfflineError` com mensagem clara se a mesa estiver desligada
     * ou a conexão estiver fechada (em vez de `Cannot read property 'sendMessage'
     * of undefined` ou `WebSocket is not open`).
     */
    function safeOscSend(mixer, address, value) {
        if (!mixer) {
            throw new MixerOfflineError('Mesa não inicializada');
        }
        const conn = mixer.conn;
        if (!conn || typeof conn.sendMessage !== 'function') {
            throw new MixerOfflineError('Conexão OSC indisponível (mesa offline)');
        }
        const status = conn.status || conn.readyState;
        if (status === 'CLOSED' || status === 'CLOSING' || status === 3 /* CLOSED */ || status === 2 /* CLOSING */) {
            throw new MixerOfflineError(`Mesa desconectada (status=${status})`);
        }
        try {
            conn.sendMessage(`${address}^${value}`);
        } catch (err) {
            if (/not open|closed|is not a function/i.test(err.message)) {
                throw new MixerOfflineError(`Falha ao enviar OSC: ${err.message}`);
            }
            throw err;
        }
    }

    /**
     * Variante para mensagens OSC pré-formatadas (já contendo o separador '^').
     * Usada por `sendRawCommand` e pelo fallback de delay de aux.
     */
    function safeOscSendRaw(mixer, fullMessage) {
        if (!mixer) {
            throw new MixerOfflineError('Mesa não inicializada');
        }
        const conn = mixer.conn;
        if (!conn || typeof conn.sendMessage !== 'function') {
            throw new MixerOfflineError('Conexão OSC indisponível (mesa offline)');
        }
        try {
            conn.sendMessage(fullMessage);
        } catch (err) {
            if (/not open|closed|is not a function/i.test(err.message)) {
                throw new MixerOfflineError(`Falha ao enviar OSC: ${err.message}`);
            }
            throw err;
        }
    }

    function applyChannelHpf(channel, hz) {
        const mixer = getMixer();
        const frequency = clamp(hz || 100, 20, 400);
        const idx = channel - 1;

        safeOscSend(mixer, `SETD^i.${idx}.eq.hpf.freq`, frequency);
        safeOscSend(mixer, `SETD^i.${idx}.eq.hpf.slope`, 2);
        safeOscSend(mixer, `SETD^i.${idx}.eq.hpf.on`, 1);

        mixerSingleton.updateChannelState(channel, { hpf: frequency });

        return `HPF ${frequency}Hz aplicado no canal ${channel}.`;
    }

    function applyChannelGate(channel, enabled, threshold = -52) {
        const mixer = getMixer();
        const idx = channel - 1;
        const thr = clamp(threshold, -80, 0);

        safeOscSend(mixer, `SETD^i.${idx}.gate.on`, enabled ? 1 : 0);
        safeOscSend(mixer, `SETD^i.${idx}.gate.thr`, thr);

        mixerSingleton.updateChannelState(channel, { gate: enabled ? 1 : 0, gateThr: thr });
        return `Gate ${enabled ? 'ativado' : 'desativado'} no canal ${channel}.`;
    }

    function applyChannelCompressor(channel, ratio = 2.5, threshold = -18) {
        const mixer = getMixer();
        const idx = channel - 1;
        const ratioClamped = clamp(ratio, 1, 20);
        const thrClamped = clamp(threshold, -60, 0);
        const attack = 25;
        const release = 220;

        safeOscSend(mixer, `SETD^i.${idx}.comp.on`, 1);
        safeOscSend(mixer, `SETD^i.${idx}.comp.ratio`, ratioClamped);
        safeOscSend(mixer, `SETD^i.${idx}.comp.thr`, thrClamped);
        safeOscSend(mixer, `SETD^i.${idx}.comp.attack`, attack);
        safeOscSend(mixer, `SETD^i.${idx}.comp.release`, release);

        mixerSingleton.updateChannelState(channel, { comp: 1, compRatio: ratioClamped, compThr: thrClamped });
        return `Compressor leve aplicado no canal ${channel}.`;
    }

    function applyEqCut(target, channel, hz, gain = -3, q = 1.4, band = 2) {
        const mixer = getMixer();
        const frequency = clamp(hz || 250, 20, 20000);
        const cutGain = clamp(gain, -12, 6);
        const qValue = clamp(q, 0.2, 10);
        const bandIndex = clamp(band, 1, 4);

        if (target === 'master') {
            const rawIndex = bandIndex - 1;
            safeOscSend(mixer, `SETD^m.eq.band.${rawIndex}.freq`, frequency);
            safeOscSend(mixer, `SETD^m.eq.band.${rawIndex}.gain`, cutGain);
            safeOscSend(mixer, `SETD^m.eq.band.${rawIndex}.q`, qValue);
            safeOscSend(mixer, `SETD^m.eq.band.${rawIndex}.type`, 0);
        } else {
            const idx = channel - 1;
            const rawIndex = bandIndex - 1;
            safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.freq`, frequency);
            safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.gain`, cutGain);
            safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.q`, qValue);
            safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.type`, 0);
            safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.on`, 1);
        }

        if (target === 'master') {
            mixerSingleton.updateMasterState({ eq: Object.assign({}, mixerSingleton.getMasterState().eq || {}, { [bandIndex]: { hz: frequency, gain: cutGain, q: qValue } }) });
        } else if (channel) {
            const current = mixerSingleton.getChannelState(channel) || {};
            mixerSingleton.updateChannelState(channel, { eq: Object.assign({}, current.eq || {}, { [bandIndex]: { hz: frequency, gain: cutGain, q: qValue } }) });
        }

        const label = target === 'master' ? 'Master' : `canal ${channel || 1}`;
        return `EQ aplicado no ${label}: ${frequency}Hz, ${cutGain}dB, Q ${qValue}.`;
    }

    function setAfs(enabled) {
        const mixer = getMixer();
        if (mixer.master.afs) {
            if (enabled) mixer.master.afs().enable();
            else mixer.master.afs().disable();
        } else {
            safeOscSend(mixer, `SETD^afs`, enabled ? 1 : 0);
        }
        return `AFS2 ${enabled ? 'ativado' : 'desativado'} globalmente.`;
    }

    function cutFeedback(hz) {
        return applyEqCut('master', null, hz, -12, 8.0, 4);
    }

    function setAuxLevel(channel, aux, level) {
        const input = getMixer().master.input(channel);
        const faderVal = clamp(level, 0, 1);
        input.aux(aux).setFaderLevel(faderVal);
        mixerSingleton.updateAuxState(aux, { level: faderVal, channel });
        return `AUX ${aux} do canal ${channel} ajustado para ${Math.round(faderVal * 100)}%.`;
    }

    function setAuxPost(channel, aux, isPost) {
        const target = getMixer().master.input(channel).aux(aux);
        if (isPost) {
            if (target.post) target.post();
            else target.setPost(1);
        } else {
            if (target.pre) target.pre();
            else target.setPost(0);
        }
        return `AUX ${aux} do canal ${channel} configurado como ${isPost ? 'POST' : 'PRE'}-Fader.`;
    }

    function setAuxPostProc(channel, aux, isPostProc) {
        const target = getMixer().master.input(channel).aux(aux);
        if (isPostProc) {
            if (target.postProc) target.postProc();
            else target.setPostProc(1);
        } else {
            if (target.preProc) target.preProc();
            else target.setPostProc(0);
        }
        return `AUX ${aux} do canal ${channel} configurado como ${isPostProc ? 'POST' : 'PRE'}-PROC.`;
    }

    function setFxLevel(channel, fx, level) {
        const input = getMixer().master.input(channel);
        const faderVal = clamp(level, 0, 1);
        input.fx(fx).setFaderLevel(faderVal);
        return `FX ${fx} do canal ${channel} ajustado para ${Math.round(faderVal * 100)}%.`;
    }

    function setFxPost(channel, fx, isPost) {
        const target = getMixer().master.input(channel).fx(fx);
        if (isPost) {
            if (target.post) target.post();
            else target.setPost(1);
        } else {
            if (target.pre) target.pre();
            else target.setPost(0);
        }
        return `FX ${fx} do canal ${channel} configurado como ${isPost ? 'POST' : 'PRE'}-Fader.`;
    }

    function fadeMaster(level, time) {
        // ✅ Correção Auditoria: fadeTo aceita apenas 2 argumentos (valor e tempo)
        getMixer().master.fadeTo(clamp(level, 0, 1), time);
        return `Fade do Master para ${Math.round(level * 100)}% em ${time}ms iniciado.`;
    }

    function fadeChannel(channel, level, time) {
        // ✅ Correção Auditoria: fadeTo aceita apenas 2 argumentos
        getMixer().master.input(channel).fadeTo(clamp(level, 0, 1), time);
        return `Fade do canal ${channel} para ${Math.round(level * 100)}% em ${time}ms iniciado.`;
    }

    function setFxBpm(fx, bpm) {
        getMixer().fx(fx).setBpm(clamp(bpm, 20, 400));
        return `BPM do processador de efeito ${fx} ajustado para ${bpm}.`;
    }

    function setFxParam(fx, param, value) {
        getMixer().fx(fx).setParam(clamp(param, 1, 6), clamp(value, 0, 1));
        return `Parâmetro ${param} do processador de efeito ${fx} ajustado para ${Math.round(value * 100)}%.`;
    }

    function setHwGain(hwInput, gain) {
        // ✅ Correção Auditoria: hw() refere-se à ENTRADA FÍSICA (Hardware Input), não ao canal de software.
        // O valor 0..1 mapeia para o range total de ganho da mesa (-6 a +57dB)
        getMixer().hw(hwInput).setGain(clamp(gain, 0, 1));
        mixerSingleton.updateChannelState(hwInput, { gain: clamp(gain, 0, 1) });
        return `Ganho de Hardware (Entrada Física ${hwInput}) ajustado para ${Math.round(gain * 100)}%.`;
    }

    function setPhantom(hwInput, enabled) {
        const hw = getMixer().hw(hwInput);
        if (enabled) hw.phantomOn();
        else hw.phantomOff();
        mixerSingleton.updateChannelState(hwInput, { phantom: enabled ? 1 : 0 });
        return `Phantom Power (48V) da Entrada Física ${hwInput} ${enabled ? 'LIGADO ⚠️' : 'DESLIGADO'}.`;
    }

    function setChannelName(channel, name) {
        const input = getMixer().master.input(channel);
        const cleanName = String(name || '').substring(0, 20);
        input.setName(cleanName);
        mixerSingleton.updateChannelState(channel, { name: cleanName });
        return `Nome do canal ${channel} alterado para "${cleanName}" e sincronizado com a mesa.`;
    }

    function setMonitorVolume(target, level) {
        const mixer = getMixer();
        const faderVal = clamp(level, 0, 1);
        if (target === 'solo') {
            if (!mixer.volume || !mixer.volume.solo) return 'Função Solo não disponível nesta mesa.';
            mixer.volume.solo.setFaderLevel(faderVal);
        } else if (target === 'hp1') {
            if (!mixer.volume || !mixer.volume.headphone) return 'Monitoramento de fone não disponível nesta mesa.';
            mixer.volume.headphone(1).setFaderLevel(faderVal);
        } else if (target === 'hp2') {
            if (!mixer.volume || !mixer.volume.headphone) return 'Monitoramento de fone não disponível nesta mesa.';
            mixer.volume.headphone(2).setFaderLevel(faderVal);
        }
        return `Volume de monitoramento (${target}) ajustado para ${Math.round(faderVal * 100)}%.`;
    }

    function selectChannelSync(type, num, syncId = 'SYNC_ID') {
        const mixer = getMixer();
        if (type === 'master') {
            mixer.channelSync.selectChannel('master', syncId);
            return `Master selecionado nos clientes (SyncID: ${syncId}).`;
        }
        
        // Mapeamento de tipos simplificado para os códigos da biblioteca
        const typeMap = {
            'input': 'i', 'channel': 'i', 'ch': 'i',
            'line': 'l', 'player': 'p', 'fx': 'f',
            'sub': 's', 'subgroup': 's', 'aux': 'a', 'vca': 'v'
        };
        const shortType = typeMap[type.toLowerCase()] || type;
        mixer.channelSync.selectChannel(shortType, num, syncId);
        return `Canal ${type} ${num} selecionado nos clientes (SyncID: ${syncId}).`;
    }

    function playerControl(action, value = null) {
        const p = getMixer().player;
        switch (action) {
            case 'play': p.play(); break;
            case 'pause': p.pause(); break;
            case 'stop': p.stop(); break;
            case 'next': p.next(); break;
            case 'prev': p.prev(); break;
            case 'shuffle': p.setShuffle(value ? 1 : 0); break;
            case 'toggle_shuffle': p.toggleShuffle(); break;
            case 'auto': p.setAuto(); break;
            case 'manual': p.setManual(); break;
            case 'load_playlist': p.loadPlaylist(value); break;
            case 'load_track': 
                if (typeof value === 'object' && value !== null) {
                    p.loadTrack(value.playlist || '', value.track || '');
                } else if (typeof value === 'string') {
                    const parts = value.split(':');
                    p.loadTrack(parts[0] || '', parts[1] || '');
                }
                break;
            default: return `Ação do player desconhecida: ${action}`;
        }
        return `Player: comando ${action} executado.`;
    }

    function recorderControl(action) {
        const mixer = getMixer();
        if (!mixer || !mixer.recorderDualTrack) return 'Gravador 2-Track não disponível nesta mesa.';
        const r = mixer.recorderDualTrack;
        switch (action) {
            case 'start': r.recordStart(); break;
            case 'stop': r.recordStop(); break;
            case 'toggle': r.recordToggle(); break;
            default: return `Ação do gravador desconhecida: ${action}`;
        }
        return `Gravador: comando ${action} executado.`;
    }

    function mtkControl(action, value = null) {
        const mtk = getMixer().recorderMultiTrack;
        switch (action) {
            case 'start': mtk.recordStart(); break;
            case 'stop': mtk.recordStop(); break;
            case 'toggle': mtk.recordToggle(); break;
            case 'play': mtk.play(); break;
            case 'pause': mtk.pause(); break;
            case 'playback_stop':
            case 'stop_play':
            case 'stop_playback':
                mtk.stop();
                break;
            case 'soundcheck_on': mtk.activateSoundcheck(); break;
            case 'soundcheck_off': mtk.deactivateSoundcheck(); break;
            case 'toggle_soundcheck': mtk.toggleSoundcheck(); break;
            case 'set_soundcheck':
                if (value !== null) {
                    mtk.setSoundcheck(value !== false && value !== 0 ? 1 : 0);
                }
                break;
            default: return `Ação MTK desconhecida: ${action}`;
        }
        return `Multitrack: comando ${action} executado.`;
    }

    function mtkSelectChannel(channel, selected) {
        const input = getMixer().master.input(channel);
        if (selected) input.multiTrackSelect();
        else input.multiTrackUnselect();
        return `Canal ${channel} ${selected ? 'ADICIONADO ao' : 'REMOVIDO do'} Multitrack.`;
    }

    function showControl(action, showName, targetName = null) {
        const s = getMixer().shows;
        switch (action) {
            case 'load_show': s.loadShow(showName); break;
            case 'load_snapshot': s.loadSnapshot(showName, targetName); break;
            case 'load_cue': s.loadCue(showName, targetName); break;
            case 'save_snapshot': s.saveSnapshot(showName, targetName); break;
            case 'save_cue': s.saveCue(showName, targetName); break;
            case 'update_snapshot': s.updateCurrentSnapshot(); break;
            case 'update_cue': s.updateCurrentCue(); break;
            default: return `Ação de Show desconhecida: ${action}`;
        }
        return `Show/Snapshot: comando ${action} executado (${showName}${targetName ? ' > ' + targetName : ''}).`;
    }

    function muteGroupControl(groupId, action, mute = false) {
        const mg = getMixer().muteGroup(groupId);
        if (action === 'toggle') {
            mg.toggle();
            return `Mute Group ${groupId} alternado.`;
        }
        if (mute) mg.mute();
        else mg.unmute();
        return `Mute Group ${groupId} ${mute ? 'MUTADO' : 'ATIVADO'}.`;
    }

    function clearMuteGroups() {
        getMixer().clearMuteGroups();
        return 'Todos os Mute Groups foram limpos.';
    }

    function automixControl(action, value = null) {
        const am = getMixer().automix;
        const groupKey = action.endsWith('_a') ? 'a' : 'b';
        const group = am.groups[groupKey];

        if (action.startsWith('toggle')) group.toggle();
        else if (action.startsWith('enable')) group.enable();
        else if (action.startsWith('disable')) group.disable();
        else if (action === 'set_response') {
            if (value <= 1.0) am.setResponseTime(clamp(value, 0, 1));
            else am.setResponseTimeMs(clamp(value, 20, 4000));
        }
        else if (action === 'reset_weights') {
            const mixer = getMixer();
            for (let i = 1; i <= 24; i++) {
                const input = mixer.master.input(i);
                if (input) input.automixSetWeight(0.5);
            }
        }
        
        return `Automix: comando ${action} executado.`;
    }

    function automixAssignChannel(channel, group, weight = 0.5) {
        const mixer = getMixer();
        if (!mixer) return 'Mesa não conectada.';
        const input = mixer.master.input(channel);
        if (!input) return `Canal ${channel} inválido.`;
        input.automixAssignGroup(group); // 'a', 'b', ou 'none'
        input.automixSetWeight(clamp(weight, 0, 1));
        return `Canal ${channel} atribuído ao Automix Grupo ${group.toUpperCase()} com peso ${Math.round(weight * 100)}%.`;
    }

    function getDeviceInfo() {
        const mixer = getMixer();
        const info = mixer.deviceInfo;
        return {
            model: mixer.model || 'Soundcraft Ui',
            firmware: 'Verificando...', // Firmware é via Observable, simplificamos para o retorno imediato
            capabilities: 'Consultando...'
        };
    }

    function sendRawCommand(msg) {
        const mixer = getMixer();
        const prefix = mixer.isSimulated ? '[SIM] Raw: ' : '';
        safeOscSendRaw(mixer, msg);
        return mixer.isSimulated
            ? `${prefix}${msg} enviado.`
            : `Mensagem bruta enviada: ${msg}`;
    }

    function runCleanSoundPreset(channel, opts = {}) {
        const steps = [
            applyChannelHpf(channel, opts.hpf || 100),
            applyChannelGate(channel, 1, opts.gateThreshold || -52),
            applyChannelCompressor(channel, opts.ratio || 2.5, opts.compThreshold || -18),
            applyEqCut('channel', channel, opts.mudHz || 250, opts.mudGain || -3, 1.2, 2),
            applyEqCut('channel', channel, opts.harshHz || 3200, opts.harshGain || -2, 1.5, 3)
        ];
        return `Preset de som limpo aplicado no canal ${channel}: ${steps.join(' ')}`;
    }

    function applyOscillator(enabled, type = 1, level = -20) {
        const mixer = getMixer();
        const hw = mixer.hw(1);
        if (!hw || !hw.oscillator) {
            return `Gerador de ruído: oscilador não disponível nesta mesa.`;
        }
        const osc = hw.oscillator;
        if (enabled) osc.enable();
        else osc.disable();
        
        const typeStr = type === 0 ? 'sine' : (type === 1 ? 'pink' : 'white');
        osc.setType(typeStr);
        osc.setFaderLevel(clamp(level, -100, 0));
        return `Gerador de ruído (${typeStr}) ${enabled ? 'ligado' : 'desligado'}.`;
    }

    function setDelay(target, id, ms) {
        const mixer = getMixer();
        const delayValue = clamp(ms, 0, 500); // Master/Aux 500ms, Input 250ms

        if (target === 'master') {
            mixer.master.setDelayL(delayValue);
            mixer.master.setDelayR(delayValue);
        } else if (target === 'aux') {
            // mixer.aux(id) retorna AuxBus (sem setDelay). Usar master.aux(id) que e DelayableMasterChannel.
            const auxCh = mixer.master.aux(id || 1);
            if (auxCh && auxCh.setDelay) auxCh.setDelay(delayValue);
            else safeOscSend(mixer, `SETD^a.${(id || 1) - 1}.delay`, delayValue / 1000);
        } else if (target === 'channel' || target === 'input') {
            const chDelay = clamp(ms, 0, 250);
            mixer.master.input(id || 1).setDelay(chDelay);
        }
        return `Delay de ${ms}ms solicitado para ${target} ${id || ''}.`;
    }

    function resolveTarget(c) {
        const mixer = getMixer();
        if (c.target === 'master') {
            return mixer.master;
        }
        if (c.target === 'solo') {
            return mixer.volume && mixer.volume.solo;
        }
        if (c.target === 'hp1' || c.target === 'headphone1') {
            return mixer.volume && mixer.volume.headphone && mixer.volume.headphone(1);
        }
        if (c.target === 'hp2' || c.target === 'headphone2') {
            return mixer.volume && mixer.volume.headphone && mixer.volume.headphone(2);
        }
        const type = String(c.channelType || c.type || 'input').toLowerCase();
        const ch = c.channel || c.ch || c.id || 1;
        switch (type) {
            case 'solo':
                return mixer.volume && mixer.volume.solo;
            case 'headphone':
            case 'hp':
                return mixer.volume && mixer.volume.headphone && mixer.volume.headphone(ch);
            case 'line':
            case 'l':
                return mixer.master.line(ch);
            case 'player':
            case 'play':
            case 'p':
                return mixer.master.player(ch);
            case 'aux':
            case 'a':
                return mixer.master.aux(ch);
            case 'fx':
            case 'f':
                return mixer.master.fx(ch);
            case 'sub':
            case 'subgroup':
            case 's':
                return mixer.master.sub(ch);
            case 'vca':
            case 'v':
                return mixer.master.vca(ch);
            case 'input':
            case 'channel':
            case 'ch':
            case 'i':
            default:
                return mixer.master.input(ch);
        }
    }

    function executeMixerCommand(cmd, options = {}) {
        const mixer = getMixer();
        if (!cmd || !cmd.action) throw new Error('Comando invalido.');
        if (!mixer || (!mixer.conn && !mixer.isSimulated)) {
            throw new Error('Conecte-se à mesa primeiro.');
        }
        if (options.source === 'ai' && !AI_COMMAND_ALLOWLIST.has(cmd.action)) {
            throw new Error(`Acao nao permitida para IA: ${cmd.action}`);
        }

        const actionsMap = {
            'volume_up': (c) => {
                const delta = Number(c.val) || 1;
                const target = resolveTarget(c);
                target.changeFaderLevelDB(delta);
                return `${c.target || 'canal'} ajustado em ${delta}dB.`;
            },
            'volume_down': (c) => {
                const delta = Number(c.val) || -1;
                const target = resolveTarget(c);
                target.changeFaderLevelDB(delta);
                return `${c.target || 'canal'} ajustado em ${delta}dB.`;
            },
            'set_fader_level_db': (c) => {
                const target = resolveTarget(c);
                const dbVal = clamp(c.levelDb || c.val || 0, -Infinity, 10);
                target.setFaderLevelDB(dbVal);
                return `${c.target || 'canal'} fader ajustado para ${dbVal}dB.`;
            },
            'change_fader_level': (c) => {
                const target = resolveTarget(c);
                const offset = clamp(c.offset || c.val || 0, -1, 1);
                target.changeFaderLevel(offset);
                return `${c.target || 'canal'} fader ajustado relativamente em ${offset} linear.`;
            },
            'change_fader_level_db': (c) => {
                const target = resolveTarget(c);
                const offsetDb = clamp(c.offsetDb || c.val || 0, -100, 100);
                target.changeFaderLevelDB(offsetDb);
                return `${c.target || 'canal'} fader ajustado relativamente em ${offsetDb}dB.`;
            },
            'fade_master_db': (c) => {
                const dbVal = clamp(c.levelDb || c.val || 0, -Infinity, 10);
                const time = c.time || 2000;
                mixer.master.fadeToDB(dbVal, time);
                return `Fade do Master para ${dbVal}dB em ${time}ms iniciado.`;
            },
            'fade_channel_db': (c) => {
                const target = resolveTarget(c);
                const dbVal = clamp(c.levelDb || c.val || 0, -Infinity, 10);
                const time = c.time || 2000;
                target.fadeToDB(dbVal, time);
                return `Fade de ${c.target || 'canal'} para ${dbVal}dB em ${time}ms iniciado.`;
            },
            'set_master_dim': (c) => {
                const dVal = c.enabled !== false && c.val !== 0;
                mixer.master.setDim(dVal ? 1 : 0);
                return `Dim do Master ${dVal ? 'ativado' : 'desativado'}.`;
            },
            'set_master_delay': (c) => {
                const ms = clamp(c.ms || c.val || 0, 0, 500);
                mixer.master.setDelayL(ms);
                mixer.master.setDelayR(ms);
                return `Delay do Master L/R configurado para ${ms}ms.`;
            },
            'change_master_delay': (c) => {
                const offset = clamp(c.offset || c.val || 0, -500, 500);
                mixer.master.changeDelayL(offset);
                mixer.master.changeDelayR(offset);
                return `Delay do Master L/R ajustado relativamente em ${offset}ms.`;
            },
            'change_master_pan': (c) => {
                const offset = clamp(c.offset || c.val || 0, -1, 1);
                mixer.master.changePan(offset);
                return `Pan do Master ajustado relativamente em ${offset}.`;
            },
            'change_channel_pan': (c) => {
                const target = resolveTarget(c);
                const offset = clamp(c.offset || c.val || 0, -1, 1);
                target.changePan(offset);
                return `Pan de ${c.target || 'canal'} ajustado relativamente em ${offset}.`;
            },
            'eq_cut': (c) => applyEqCut(c.target, c.channel, c.hz, c.gain, c.q, c.band),
            'apply_channel_hpf': (c) => applyChannelHpf(c.channel || 1, c.hz || 100),
            'apply_channel_gate': (c) => applyChannelGate(c.channel || 1, c.enabled !== 0, c.threshold),
            'apply_channel_compressor': (c) => applyChannelCompressor(c.channel || 1, c.ratio, c.threshold),
            'set_afs_enabled': (c) => setAfs(c.enabled !== 0),
            'mute_master': (c) => {
                // master.mute()/unmute() nao existem em soundcraft-ui-connection v6 (MasterBus nao implementa mute). Enviar OSC cru.
                const on = c.enabled !== false && c.enabled !== 0;
                safeOscSend(mixer, `SETD^m.mute`, on ? 1 : 0);
                return `Mute do master ${on ? 'ativado' : 'desativado'}.`;
            },
            'run_master_ideal_curve': () => { const steps = [applyEqCut('master', null, 60, 3, 1.0, 1), applyEqCut('master', null, 400, -2, 1.2, 2), applyEqCut('master', null, 3000, 1, 1.0, 3)]; return `Curva ideal aplicada no Master: ${steps.join(' ')}`; },
            'set_master_level': (c) => {
                const level = clamp(c.level ?? 0.7, 0, 1);
                mixer.master.setFaderLevel(level);
                mixerSingleton.updateMasterState({ level });
                return `Master ajustado para ${Math.round(level * 100)}%`;
            },
            'master_mute': (c) => {
                // master.mute()/unmute() nao existem em soundcraft-ui-connection v6 (MasterBus nao implementa mute). Enviar OSC cru.
                const on = c.enabled !== false && c.enabled !== 0;
                safeOscSend(mixer, `SETD^m.mute`, on ? 1 : 0);
                mixerSingleton.updateMasterState({ mute: on ? 1 : 0 });
                return `Master ${on ? 'MUTADO' : 'DESMUTADO'}.`;
            },
            'set_channel_level': (c) => {
                const target = resolveTarget(c);
                const lvl = clamp(c.level ?? c.val ?? 0.7, 0, 1);
                target.setFaderLevel(lvl);
                if (c.channel) mixerSingleton.updateChannelState(c.channel, { level: lvl });
                return `${c.target || 'canal'} ajustado para ${Math.round(lvl * 100)}%`;
            },
            'channel_fader': (c) => {
                const target = resolveTarget(c);
                const lvl = clamp(c.level ?? c.val ?? 0.7, 0, 1);
                target.setFaderLevel(lvl);
                if (c.channel) mixerSingleton.updateChannelState(c.channel, { level: lvl });
                return `${c.target || 'canal'} ajustado para ${Math.round(lvl * 100)}%`;
            },
            'channel_mute': (c) => {
                const target = resolveTarget(c);
                const mut = c.enabled !== false && c.enabled !== 0;
                if (target.setMute) target.setMute(mut ? 1 : 0);
                else if (mut) target.mute();
                else target.unmute();
                if (c.channel) mixerSingleton.updateChannelState(c.channel, { mute: mut ? 1 : 0 });
                return `${c.target || 'canal'} ${mut ? 'MUTADO' : 'DESMUTADO'}.`;
            },
            'toggle_channel_mute': (c) => {
                const target = resolveTarget(c);
                if (target.toggleMute) target.toggleMute();
                return `${c.target || 'canal'} mute alternado.`;
            },
            'toggle_dim': () => { mixer.master.toggleDim(); return 'Função DIM alternada no Master.'; },
            'set_master_pan': (c) => { mixer.master.setPan(clamp(c.val || 0.5, 0, 1)); return `Pan do Master ajustado para ${c.val}`; },
            'set_channel_pan': (c) => {
                const target = resolveTarget(c);
                const panLvl = clamp(c.val || 0.5, 0, 1);
                target.setPan(panLvl);
                return `Pan de ${c.target || 'canal'} ajustado para ${panLvl}`;
            },
            'toggle_solo': (c) => {
                const target = resolveTarget(c);
                if (target.toggleSolo) target.toggleSolo();
                return `Solo de ${c.target || 'canal'} alternado.`;
            },
            'set_solo': (c) => {
                const target = resolveTarget(c);
                const enabled = c.enabled !== false && c.enabled !== 0;
                if (target.setSolo) target.setSolo(enabled ? 1 : 0);
                else if (enabled) {
                    if (target.solo) target.solo();
                } else {
                    if (target.unsolo) target.unsolo();
                }
                return `Solo de ${c.target || 'canal'} ${enabled ? 'ATIVADO' : 'DESATIVADO'}.`;
            },
            'mtk_toggle': (c) => {
                const target = resolveTarget(c);
                if (target.multiTrackToggle) target.multiTrackToggle();
                return `Multitrack de ${c.target || 'canal'} alternado.`;
            },
            'automix_remove': (c) => {
                const target = resolveTarget(c);
                if (target.automixRemove) target.automixRemove();
                return `Canal ${c.channel || 1} removido do Automix.`;
            },
            'automix_set_weight_db': (c) => {
                const target = resolveTarget(c);
                const dbVal = clamp(c.weightDb !== undefined ? c.weightDb : (c.val || 0), -12, 12);
                if (target.automixSetWeightDB) target.automixSetWeightDB(dbVal);
                return `Peso Automix de ${c.target || 'canal'} ajustado para ${dbVal}dB.`;
            },
            'automix_change_weight_db': (c) => {
                const target = resolveTarget(c);
                const offsetDb = clamp(c.offsetDb !== undefined ? c.offsetDb : (c.val || 0), -24, 24);
                if (target.automixChangeWeightDB) target.automixChangeWeightDB(offsetDb);
                return `Peso Automix de ${c.target || 'canal'} ajustado relativamente em ${offsetDb}dB.`;
            },
            'toggle_aux_post': (c) => {
                const ch = c.channel || c.ch || 1;
                const aux = c.aux || 1;
                const target = getMixer().master.input(ch).aux(aux);
                if (target.togglePost) target.togglePost();
                return `AUX ${aux} do canal ${ch} fader mode alternado.`;
            },
            'toggle_fx_post': (c) => {
                const ch = c.channel || c.ch || 1;
                const fx = c.fx || 1;
                const target = getMixer().master.input(ch).fx(fx);
                if (target.togglePost) target.togglePost();
                return `FX ${fx} do canal ${ch} fader mode alternado.`;
            },
            'reconnect_mixer': () => {
                const mixer = getMixer();
                if (mixer.reconnect) mixer.reconnect();
                return 'Tentando reconectar à mesa de som...';
            },
            'get_connection_status': () => {
                const mixer = getMixer();
                const status = mixer.conn && mixer.conn.status ? mixer.conn.status : 'UNKNOWN';
                return `Status da conexão: ${status}`;
            },
            'fade_master': (c) => fadeMaster(c.level || 0, c.time || 2000),
            'fade_channel': (c) => {
                const target = resolveTarget(c);
                const lvl = clamp(c.level || 0, 0, 1);
                const time = c.time || 2000;
                target.fadeTo(lvl, time);
                return `Fade de ${c.target || 'canal'} para ${Math.round(lvl * 100)}% em ${time}ms iniciado.`;
            },
            'set_oscillator': (c) => applyOscillator(c.enabled !== 0 && c.enabled !== false, c.type, c.level),
            'set_aux_level': (c) => setAuxLevel(c.channel || 1, c.aux || 1, c.level || 0),
            'set_aux_post': (c) => setAuxPost(c.channel || 1, c.aux || 1, c.enabled !== 0 && c.enabled !== false),
            'set_aux_post_proc': (c) => setAuxPostProc(c.channel || 1, c.aux || 1, c.enabled !== 0 && c.enabled !== false),
            'set_aux_pan': (c) => { const ch = c.channel || c.ch || 1; getMixer().master.input(ch).aux(c.aux || 1).setPan(clamp(c.val || 0.5, 0, 1)); return `Pan do AUX ${c.aux} (Canal ${ch}) ajustado para ${c.val}`; },
            'set_channel_name': (c) => setChannelName(c.channel || 1, c.name || ''),
            'set_fx_level': (c) => setFxLevel(c.channel || 1, c.fx || 1, c.level || 0),
            'set_fx_post': (c) => setFxPost(c.channel || 1, c.fx || 1, c.enabled !== 0 && c.enabled !== false),
            'set_fx_bpm': (c) => setFxBpm(c.fx || 1, c.val || 120),
            'set_fx_param': (c) => setFxParam(c.fx || 1, c.param || 1, c.val || 0.5),
            'set_hw_gain': (c) => setHwGain(c.input || c.channel || 1, c.val || 0.5),
            'set_hw_gain_db': (c) => {
                const input = c.input || c.channel || 1;
                const dbVal = clamp(c.levelDb !== undefined ? c.levelDb : (c.val || 0), -6, 57);
                mixer.hw(input).setGainDB(dbVal);
                mixerSingleton.updateChannelState(input, { gainDb: dbVal });
                return `Ganho de Hardware da Entrada Física ${input} ajustado para ${dbVal}dB.`;
            },
            'change_hw_gain': (c) => {
                const input = c.input || c.channel || 1;
                const offset = clamp(c.offset || c.val || 0, -1, 1);
                mixer.hw(input).changeGain(offset);
                return `Ganho de Hardware da Entrada Física ${input} ajustado relativamente por ${offset}.`;
            },
            'change_hw_gain_db': (c) => {
                const input = c.input || c.channel || 1;
                const offsetDb = clamp(c.offsetDb || c.val || 0, -60, 60);
                mixer.hw(input).changeGainDB(offsetDb);
                return `Ganho de Hardware da Entrada Física ${input} ajustado relativamente por ${offsetDb}dB.`;
            },
            'set_phantom': (c) => setPhantom(c.input || c.channel || 1, c.enabled !== 0 && c.enabled !== false),
            'set_phantom_power': (c) => setPhantom(c.input || c.channel || 1, c.enabled !== 0 && c.enabled !== false),
            'toggle_phantom': (c) => {
                const input = c.input || c.channel || 1;
                const hw = mixer.hw(input);
                if (hw.togglePhantom) hw.togglePhantom();
                else {
                    const current = mixerSingleton.getChannelState(input) || {};
                    const next = !current.phantom;
                    if (next) hw.phantomOn(); else hw.phantomOff();
                }
                return `Phantom Power da Entrada Física ${input} alternado.`;
            },
            'set_monitor_volume': (c) => setMonitorVolume(c.target || 'hp1', c.val || 0.5),
            'select_channel': (c) => selectChannelSync(c.type || 'input', c.channel || c.ch || 1, c.syncId || 'SYNC_ID'),
            'player_cmd': (c) => playerControl(c.action_type || c.action, c.val),
            'set_play_mode': (c) => {
                // soundcraft-ui-connection v6: setPlayMode espera numero (manual=0, auto=3).
                const modeMap = { manual: 0, auto: 3 };
                const raw = c.mode !== undefined ? c.mode : c.val;
                const numeric = (typeof raw === 'string') ? (modeMap[raw.toLowerCase()] ?? 0) : Number(raw);
                const playMode = Number.isFinite(numeric) ? numeric : 0;
                mixer.player.setPlayMode(playMode);
                return `Modo do Player configurado para ${playMode}.`;
            },
            'recorder_cmd': (c) => recorderControl(c.action_type),
            'mtk_cmd': (c) => mtkControl(c.action_type || c.action, c.val !== undefined ? c.val : (c.value !== undefined ? c.value : c.enabled)),
            'mtk_select': (c) => mtkSelectChannel(c.channel || c.ch || 1, c.enabled !== 0),
            'show_cmd': (c) => showControl(c.action_type, c.show, c.target),
            'mute_group_cmd': (c) => muteGroupControl(c.id || 'all', c.action_type || c.action, c.enabled !== 0),
            'clear_mute_groups': () => clearMuteGroups(),
            'automix_cmd': (c) => automixControl(c.action_type, c.val),
            'assign_channel': (c) => automixAssignChannel(c.channel || 1, c.group || 'none', c.weight || 0.5),
            'automix_assign': (c) => automixAssignChannel(c.channel || 1, c.group || 'none', c.weight || 0.5),
            'get_device_info': () => getDeviceInfo(),
            'send_raw': (c) => sendRawCommand(c.message || c.msg),
            'send_raw_message': (c) => sendRawCommand(c.message || c.msg),
            'run_clean_sound_preset': (c) => runCleanSoundPreset(c.channel || 1, c),
            'set_delay': (c) => { const id = c.channel || c.ch || c.aux || c.id || 1; return setDelay(c.target || 'aux', id, c.ms || 0); },
            'set_room_profile': (c) => `Perfil acústico alterado para: ${c.profile}`,
            'log': (c) => `INFO: ${c.desc}`,
            'trigger_sweep': (c) => 'Medição de sweep iniciada no cliente.',
            'save_preset': (c) => {
                const name = c.name || `Preset ${new Date().toLocaleString('pt-BR')}`;
                database.presets.insert({ name, timestamp: Date.now(), source: 'ai' }, (err) => {
                    if (err) console.error('[MixerActions] Erro ao salvar preset:', err);
                });
                return `Preset "${name}" salvo com sucesso.`;
            },
            'list_presets': (c) => 'Listando presets salvos na interface...',
            'save_scene': (c) => {
                const name = c.name || `Cena ${new Date().toLocaleString('pt-BR')}`;
                return `Cena "${name}" registrada.`;
            }
        };

        const handler = actionsMap[cmd.action];
        if (!handler) throw new Error(`Acao nao suportada: ${cmd.action}`);
        return handler(cmd);
    }

    function _snapshotEq(target, channel) {
        const state = target === 'master'
            ? mixerSingleton.getMasterState()
            : mixerSingleton.getChannelState(channel);
        const currentEq = (state && state.eq) || {};
        const snapshot = {};
        for (let b = 1; b <= 4; b++) {
            const bandState = currentEq[b] || {};
            snapshot[b] = {
                hz: bandState.hz || 250,
                gain: bandState.gain || 0,
                q: bandState.q || 1.4,
            };
        }
        return snapshot;
    }

    function _applyBands(target, channel, bands, snapshot) {
        const mixer = getMixer();
        const applied = [];
        for (const f of bands) {
            const frequency = clamp(f.hz || 250, 20, 20000);
            const cutGain = clamp(f.gainDb !== undefined ? f.gainDb : f.gain || 0, -12, 6);
            const qValue = clamp(f.q || 1.4, 0.2, 10);
            const bandIndex = clamp(f.band || 1, 1, 4);

            if (target === 'master') {
                const rawIndex = bandIndex - 1;
                safeOscSend(mixer, `SETD^m.eq.band.${rawIndex}.freq`, frequency);
                safeOscSend(mixer, `SETD^m.eq.band.${rawIndex}.gain`, cutGain);
                safeOscSend(mixer, `SETD^m.eq.band.${rawIndex}.q`, qValue);
                safeOscSend(mixer, `SETD^m.eq.band.${rawIndex}.type`, 0);
            } else {
                // input.eq().band() nao existe em soundcraft-ui-connection v6 — OSC cru.
                const idx = channel - 1;
                const rawIndex = bandIndex - 1;
                safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.freq`, frequency);
                safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.gain`, cutGain);
                safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.q`, qValue);
                safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.type`, 0);
                safeOscSend(mixer, `SETD^i.${idx}.eq.band.${rawIndex}.on`, 1);
            }

            const patch = { [bandIndex]: { hz: frequency, gain: cutGain, q: qValue } };
            if (target === 'master') {
                mixerSingleton.updateMasterState({ eq: Object.assign({}, mixerSingleton.getMasterState().eq || {}, patch) });
            } else {
                const current = mixerSingleton.getChannelState(channel) || {};
                mixerSingleton.updateChannelState(channel, { eq: Object.assign({}, current.eq || {}, patch) });
            }
            applied.push(`Band${bandIndex}(${frequency}Hz, ${cutGain}dB, Q${qValue})`);
        }
        const label = target === 'master' ? 'Master' : `canal ${channel || 1}`;
        return { msg: `EQ aplicado no ${label}: ${applied.join(', ')}.`, snapshot };
    }

    function batchApplyEq(target, channel, bands) {
        const snapshot = _snapshotEq(target, channel);
        return _applyBands(target, channel, bands, snapshot);
    }

    function restoreEqSnapshot(target, channel, snapshot) {
        const bands = Object.entries(snapshot || {}).map(([band, state]) => ({
            hz: state.hz, gain: state.gain, q: state.q, band: Number(band)
        }));
        const result = _applyBands(target, channel, bands, null);
        const label = target === 'master' ? 'Master' : `canal ${channel || 1}`;
        result.msg = `EQ restaurado no ${label} (undo).`;
        return result;
    }

    return {
        applyChannelCompressor, applyChannelGate, applyChannelHpf, applyEqCut,
        applyOscillator, ensureMixer, executeMixerCommand, setAfs,
        setAuxLevel, setFxLevel, setDelay, runCleanSoundPreset,
        setPhantom, setChannelName, cutFeedback, automixAssignChannel,
        batchApplyEq, restoreEqSnapshot
    };
}

module.exports = { createMixerActions };
