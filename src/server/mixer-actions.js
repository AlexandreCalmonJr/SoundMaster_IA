const mixerSingleton = require('./mixer-singleton');

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

    function applyChannelHpf(channel, hz) {
        const mixer = getMixer();
        const input = mixer.input(channel);
        const frequency = clamp(hz || 100, 20, 400);
        
        input.eq().setHpfFreq(frequency);
        // Slope is often not directly exposed as a simple setter in all versions, 
        // using raw as fallback if method not found, but trying high-level first.
        if (input.eq().setHpfSlope) {
            input.eq().setHpfSlope(2);
        } else {
            mixer.conn.sendMessage(`SETD^i.${channel-1}.eq.hpf.slope^2`);
        }
        mixerSingleton.updateChannelState(channel, { hpf: frequency });
        
        return `HPF ${frequency}Hz aplicado no canal ${channel}.`;
    }

    function applyChannelGate(channel, enabled, threshold = -52) {
        const input = getMixer().input(channel);
        if (enabled) {
            input.gate().enable();
        } else {
            input.gate().disable();
        }
        input.gate().setThreshold(clamp(threshold, -80, 0));
        mixerSingleton.updateChannelState(channel, { gate: enabled ? 1 : 0 });
        return `Gate ${enabled ? 'ativado' : 'desativado'} no canal ${channel}.`;
    }

    function applyChannelCompressor(channel, ratio = 2.5, threshold = -18) {
        const input = getMixer().input(channel);
        input.compressor().enable();
        input.compressor().setRatio(clamp(ratio, 1, 20));
        input.compressor().setThreshold(clamp(threshold, -60, 0));
        input.compressor().setAttack(25);
        input.compressor().setRelease(220);
        mixerSingleton.updateChannelState(channel, { comp: 1 });
        return `Compressor leve aplicado no canal ${channel}.`;
    }

    function applyEqCut(target, channel, hz, gain = -3, q = 1.4, band = 2) {
        const mixer = getMixer();
        const frequency = clamp(hz || 250, 20, 20000);
        const cutGain = clamp(gain, -12, 6);
        const qValue = clamp(q, 0.2, 10);
        const bandIndex = clamp(band, 1, 4);

        const eq = target === 'master' ? mixer.master.eq() : mixer.input(channel).eq();
        
        eq.band(bandIndex).setFreq(frequency);
        eq.band(bandIndex).setGain(cutGain);
        eq.band(bandIndex).setQ(qValue);
        // EQ type 0 is usually Bell/Parametric
        if (eq.band(bandIndex).setType) eq.band(bandIndex).setType(0);
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
            mixer.conn.sendMessage(`SETD^afs^${enabled ? 1 : 0}`);
        }
        return `AFS2 ${enabled ? 'ativado' : 'desativado'} globalmente.`;
    }

    function cutFeedback(hz) {
        return applyEqCut('master', null, hz, -12, 8.0, 4);
    }

    function setAuxLevel(channel, aux, level) {
        const input = getMixer().input(channel);
        const faderVal = clamp(level, 0, 1);
        input.aux(aux).setFaderLevel(faderVal);
        mixerSingleton.updateAuxState(aux, { level: faderVal, channel });
        return `AUX ${aux} do canal ${channel} ajustado para ${Math.round(faderVal * 100)}%.`;
    }

    function setAuxPost(channel, aux, isPost) {
        getMixer().input(channel).aux(aux).setPost(isPost ? 1 : 0);
        return `AUX ${aux} do canal ${channel} configurado como ${isPost ? 'POST' : 'PRE'}-Fader.`;
    }

    function setAuxPostProc(channel, aux, isPostProc) {
        getMixer().input(channel).aux(aux).setPostProc(isPostProc ? 1 : 0);
        return `AUX ${aux} do canal ${channel} configurado como ${isPostProc ? 'POST' : 'PRE'}-PROC.`;
    }

    function setFxLevel(channel, fx, level) {
        const input = getMixer().input(channel);
        const faderVal = clamp(level, 0, 1);
        input.fx(fx).setFaderLevel(faderVal);
        return `FX ${fx} do canal ${channel} ajustado para ${Math.round(faderVal * 100)}%.`;
    }

    function setFxPost(channel, fx, isPost) {
        getMixer().input(channel).fx(fx).setPost(isPost ? 1 : 0);
        return `FX ${fx} do canal ${channel} configurado como ${isPost ? 'POST' : 'PRE'}-Fader.`;
    }

    function fadeMaster(level, time) {
        // ✅ Correção Auditoria: fadeTo aceita apenas 2 argumentos (valor e tempo)
        getMixer().master.fadeTo(clamp(level, 0, 1), time);
        return `Fade do Master para ${Math.round(level * 100)}% em ${time}ms iniciado.`;
    }

    function fadeChannel(channel, level, time) {
        // ✅ Correção Auditoria: fadeTo aceita apenas 2 argumentos
        getMixer().input(channel).fadeTo(clamp(level, 0, 1), time);
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
        const input = getMixer().input(channel);
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
            case 'auto': p.setAuto(); break;
            case 'manual': p.setManual(); break;
            case 'load_playlist': p.loadPlaylist(value); break;
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

    function mtkControl(action) {
        const mtk = getMixer().recorderMultiTrack;
        switch (action) {
            case 'start': mtk.recordStart(); break;
            case 'stop': mtk.recordStop(); break;
            case 'play': mtk.play(); break;
            case 'pause': mtk.pause(); break;
            case 'soundcheck_on': mtk.activateSoundcheck(); break;
            case 'soundcheck_off': mtk.deactivateSoundcheck(); break;
            default: return `Ação MTK desconhecida: ${action}`;
        }
        return `Multitrack: comando ${action} executado.`;
    }

    function mtkSelectChannel(channel, selected) {
        const input = getMixer().input(channel);
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
            case 'update_snapshot': s.updateCurrentSnapshot(); break;
            default: return `Ação de Show desconhecida: ${action}`;
        }
        return `Show/Snapshot: comando ${action} executado (${showName}${targetName ? ' > ' + targetName : ''}).`;
    }

    function muteGroupControl(groupId, mute) {
        const mg = getMixer().muteGroup(groupId);
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

        if (action.startsWith('enable')) group.enable();
        else if (action.startsWith('disable')) group.disable();
        else if (action === 'set_response') am.setResponseTimeMs(clamp(value, 20, 4000));
        
        return `Automix: comando ${action} executado.`;
    }

    function automixAssignChannel(channel, group, weight = 0.5) {
        const mixer = getMixer();
        if (!mixer) return 'Mesa não conectada.';
        const input = mixer.input(channel);
        if (!input) return `Canal ${channel} inválido.`;
        input.automixAssignGroup(group); // 'a', 'b', ou 'none'
        input.automixSetWeight(clamp(weight, 0, 1));
        return `Canal ${channel} atribuído ao Automix Grupo ${group.toUpperCase()} com peso ${Math.round(weight * 100)}%.`;
    }

    function getDeviceInfo() {
        const mixer = getMixer();
        const info = mixer.deviceInfo;
        return {
            model: info.model,
            firmware: 'Verificando...', // Firmware é via Observable, simplificamos para o retorno imediato
            capabilities: 'Consultando...'
        };
    }

    function sendRawCommand(msg) {
        const mixer = getMixer();
        if (mixer.isSimulated) {
            mixer.conn.sendMessage(msg);
            return `[SIM] Raw: ${msg} enviado.`;
        }
        mixer.conn.sendMessage(msg);
        return `Mensagem bruta enviada: ${msg}`;
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
            mixer.aux(id).setDelay(delayValue);
        } else if (target === 'channel' || target === 'input') {
            const chDelay = clamp(ms, 0, 250);
            mixer.input(id || 1).setDelay(chDelay);
        }
        return `Delay de ${ms}ms solicitado para ${target} ${id || ''}.`;
    }

    function executeMixerCommand(cmd) {
        const mixer = getMixer();
        if (!cmd || !cmd.action) throw new Error('Comando invalido.');
        if (!mixer || (!mixer.conn && !mixer.isSimulated)) {
            throw new Error('Conecte-se à mesa primeiro.');
        }

        const actionsMap = {
            'volume_up': (c) => {
                const delta = Number(c.val) || 1;
                const target = c.target === 'master' ? mixer.master : mixer.input(c.ch || c.channel || 1);
                target.changeFaderLevelDB(delta);
                return `${c.target} ajustado em ${delta}dB.`;
            },
            'volume_down': (c) => {
                const delta = Number(c.val) || -1;
                const target = c.target === 'master' ? mixer.master : mixer.input(c.ch || c.channel || 1);
                target.changeFaderLevelDB(delta);
                return `${c.target} ajustado em ${delta}dB.`;
            },
            'eq_cut': (c) => applyEqCut(c.target, c.channel, c.hz, c.gain, c.q, c.band),
            'apply_channel_hpf': (c) => applyChannelHpf(c.channel || 1, c.hz || 100),
            'apply_channel_gate': (c) => applyChannelGate(c.channel || 1, c.enabled !== 0, c.threshold),
            'apply_channel_compressor': (c) => applyChannelCompressor(c.channel || 1, c.ratio, c.threshold),
            'set_afs_enabled': (c) => setAfs(c.enabled !== 0),
            'mute_master': (c) => { if (c.enabled) mixer.master.mute(); else mixer.master.unmute(); return `Mute do master ${c.enabled ? 'ativado' : 'desativado'}.`; },
            'run_master_ideal_curve': () => { const steps = [applyEqCut('master', null, 60, 3, 1.0, 1), applyEqCut('master', null, 400, -2, 1.2, 2), applyEqCut('master', null, 3000, 1, 1.0, 3)]; return `Curva ideal aplicada no Master: ${steps.join(' ')}`; },
            'set_master_level': (c) => { mixer.master.setFaderLevel(clamp(c.level || 0.7, 0, 1)); return `Master ajustado para ${Math.round((c.level || 0.7) * 100)}%`; },
            'master_mute': (c) => { if (c.enabled) mixer.master.mute(); else mixer.master.unmute(); return `Master ${c.enabled ? 'MUTADO' : 'DESMUTADO'}.`; },
            'set_channel_level': (c) => { const ch = c.channel || c.ch || 1; mixer.input(ch).setFaderLevel(clamp(c.level || 0.7, 0, 1)); return `Canal ${ch} ajustado para ${Math.round((c.level || 0.7) * 100)}%`; },
            'channel_fader': (c) => { const ch = c.channel || c.ch || 1; mixer.input(ch).setFaderLevel(clamp(c.level || 0.7, 0, 1)); return `Canal ${ch} ajustado para ${Math.round((c.level || 0.7) * 100)}%`; },
            'channel_mute': (c) => { const ch = c.channel || c.ch || 1; if (c.enabled) mixer.input(ch).mute(); else mixer.input(ch).unmute(); return `Canal ${ch} ${c.enabled ? 'MUTADO' : 'DESMUTADO'}.`; },
            'toggle_dim': () => { mixer.master.toggleDim(); return 'Função DIM alternada no Master.'; },
            'set_master_pan': (c) => { mixer.master.setPan(clamp(c.val || 0.5, 0, 1)); return `Pan do Master ajustado para ${c.val}`; },
            'set_channel_pan': (c) => { const ch = c.channel || c.ch || 1; mixer.input(ch).setPan(clamp(c.val || 0.5, 0, 1)); return `Pan do Canal ${ch} ajustado para ${c.val}`; },
            'toggle_solo': (c) => { const ch = c.channel || c.ch || 1; mixer.input(ch).toggleSolo(); return `Solo do Canal ${ch} alternado.`; },
            'fade_master': (c) => fadeMaster(c.level || 0, c.time || 2000),
            'fade_channel': (c) => fadeChannel(c.channel || 1, c.level || 0, c.time || 2000),
            'set_oscillator': (c) => applyOscillator(c.enabled !== 0, c.type, c.level),
            'set_aux_level': (c) => setAuxLevel(c.channel || 1, c.aux || 1, c.level || 0),
            'set_aux_post': (c) => setAuxPost(c.channel || 1, c.aux || 1, c.enabled !== 0),
            'set_aux_post_proc': (c) => setAuxPostProc(c.channel || 1, c.aux || 1, c.enabled !== 0),
            'set_aux_pan': (c) => { const ch = c.channel || c.ch || 1; getMixer().input(ch).aux(c.aux || 1).setPan(clamp(c.val || 0.5, 0, 1)); return `Pan do AUX ${c.aux} (Canal ${ch}) ajustado para ${c.val}`; },
            'set_channel_name': (c) => setChannelName(c.channel || 1, c.name || ''),
            'set_fx_level': (c) => setFxLevel(c.channel || 1, c.fx || 1, c.level || 0),
            'set_fx_post': (c) => setFxPost(c.channel || 1, c.fx || 1, c.enabled !== 0),
            'set_fx_bpm': (c) => setFxBpm(c.fx || 1, c.val || 120),
            'set_fx_param': (c) => setFxParam(c.fx || 1, c.param || 1, c.val || 0.5),
            'set_hw_gain': (c) => setHwGain(c.input || c.channel || 1, c.val || 0.5),
            'set_phantom': (c) => setPhantom(c.input || c.channel || 1, c.enabled !== 0),
            'set_phantom_power': (c) => setPhantom(c.input || c.channel || 1, c.enabled !== 0),
            'set_monitor_volume': (c) => setMonitorVolume(c.target || 'hp1', c.val || 0.5),
            'select_channel': (c) => selectChannelSync(c.type || 'input', c.channel || c.ch || 1, c.syncId || 'SYNC_ID'),
            'player_cmd': (c) => playerControl(c.action_type, c.val),
            'recorder_cmd': (c) => recorderControl(c.action_type),
            'mtk_cmd': (c) => mtkControl(c.action_type),
            'mtk_select': (c) => mtkSelectChannel(c.channel || c.ch || 1, c.enabled !== 0),
            'show_cmd': (c) => showControl(c.action_type, c.show, c.target),
            'mute_group_cmd': (c) => muteGroupControl(c.id || 'all', c.enabled !== 0),
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
            'log': (c) => `INFO: ${c.desc}`
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
        const eq = target === 'master' ? mixer.master.eq() : mixer.input(channel).eq();
        const applied = [];
        for (const f of bands) {
            const frequency = clamp(f.hz || 250, 20, 20000);
            const cutGain = clamp(f.gainDb !== undefined ? f.gainDb : f.gain || 0, -12, 6);
            const qValue = clamp(f.q || 1.4, 0.2, 10);
            const bandIndex = clamp(f.band || 1, 1, 4);
            eq.band(bandIndex).setFreq(frequency);
            eq.band(bandIndex).setGain(cutGain);
            eq.band(bandIndex).setQ(qValue);
            if (eq.band(bandIndex).setType) eq.band(bandIndex).setType(0);
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
