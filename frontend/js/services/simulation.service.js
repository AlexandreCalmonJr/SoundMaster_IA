/**
 * @fileoverview Simulation Service - Serviço de simulação de mixer para testes offline
 * @module SimulationService
 * @description Serviço que simula um mixer com 24 canais, 10 auxs e 4 FX.
 *              Permite testar a interface sem hardware real, com VU meters,
 *              níveis de canal, mute, e geração de áudio fake.
 *
 * @funcionalidades
 * - Simulação de 24 canais com níveis independently controláveis
 * - 10 auxiliares e 4 efeitos (Reverb, Delay, Chorus, Room)
 * - VU meters com animação Brownian para realismo
 * - 4 cenas pré-definidas (Louvor, Pregação, Silêncio, Transição)
 * - Chat IA simulado com respostas pré-definidas
 * - Análise acústica fake (RT60, STI, bandas)
 * - Integração com AppStore para VU data
 *
 * @como-usar
 * - SimulationService.start() → inicia simulação (setInterval a cada 80ms)
 * - SimulationService.stop() → pausa simulação
 * - SimulationService.getState() → retorna estado atual do mixer
 * - SimulationService.setChannelLevel(ch, level) → ajusta nível do canal
 * - SimulationService.setMasterLevel(level) → ajusta nível master
 * - SimulationService.askAI(text, channel) → simula resposta IA
 * - SimulationService.getActiveScene() → retorna cena ativa
 *
 * @dependencias
 * - AppStore (para estado global e VU data)
 *
 * @exposes window.SimulationService
 */
(function () {
    'use strict';

    const NUM_CHANNELS = 24;
    const NUM_AUX = 10;
    const NUM_FX = 4;

    let _isRunning = false;
    let _intervalId = null;
    let _tickRate = 80;

    const state = {
        connected: false,
        isSimulated: true,
        master: { level: 0.75, mute: false, dim: false, pan: 0.5 },
        channels: [],
        aux: [],
        fx: [],
        automix: { enabled: false, groups: { a: false, b: false } }
    };

    function _initState() {
        state.channels = [];
        for (let i = 1; i <= NUM_CHANNELS; i++) {
            state.channels.push({
                id: i,
                level: 0.5,
                mute: false,
                solo: false,
                hpf: false,
                gate: false,
                comp: false,
                vu: 0,
                vuPeak: 0
            });
        }
        state.aux = [];
        for (let i = 1; i <= NUM_AUX; i++) {
            state.aux.push({ id: i, level: 0, post: true });
        }
        state.fx = [];
        for (let i = 1; i <= NUM_FX; i++) {
            state.fx.push({ id: i, level: 0, mix: 0.3 });
        }
    }
    _initState();

    function _lerp(a, b, t) { return a + (b - a) * t; }

    function _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function _brownian(current, target, speed) {
        return _lerp(current, target, speed) + (Math.random() - 0.5) * 0.03;
    }

    function _tick() {
        if (!state.connected) return;

        const masterEff = state.master.mute ? 0 : state.master.level;

        for (let i = 0; i < NUM_CHANNELS; i++) {
            const ch = state.channels[i];
            if (ch.mute) {
                ch.vu = _brownian(ch.vu, -80, 0.2);
                ch.vuPeak = Math.max(ch.vuPeak - 0.05, -80);
                continue;
            }

            const scene = _getActiveScene();
            const baseVu = scene.channelBases[i] || -24;
            const variation = (Math.random() - 0.5) * (scene.vuVariation || 8);
            let targetVu = baseVu + variation;

            if (ch.solo) targetVu += 6;
            targetVu = _clamp(targetVu, -80, 0);

            const channelEff = ch.level * masterEff;
            ch.vu = _brownian(ch.vu, targetVu + (channelEff - 0.5) * 20, 0.15);
            ch.vu = _clamp(ch.vu, -80, 0);

            if (ch.vu > ch.vuPeak) ch.vuPeak = ch.vu;
            else ch.vuPeak = Math.max(ch.vuPeak - 0.08, -80);
        }

        _emitVuUpdate();
    }

    function _emitVuUpdate() {
        if (!window.AppStore) return;
        const vuData = { channels: {}, master: 0 };
        state.channels.forEach((ch, i) => {
            vuData.channels[i + 1] = _dbToLinear(ch.vu);
        });
        vuData.master = state.master.mute ? 0 : _dbToLinear(state.master.level * -3);
        AppStore.setState({ vuData });
    }

    function _dbToLinear(db) {
        const normalized = (db + 80) / 80;
        return _clamp(normalized, 0, 1);
    }

    const SCENES = {
        silencio: {
            label: 'Silêncio',
            description: 'Ambiente sem som',
            channelBases: Array(NUM_CHANNELS).fill(-80),
            vuVariation: 0,
            rt60: 1.8,
            spectrum: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            peakHz: 0,
            rms: -80,
            c50: -99,
            c80: -99,
            sti: 0
        },
        louvor: {
            label: 'Louvor',
            description: 'Banda completa ao vivo',
            channelBases: [-18, -14, -12, -16, -8, -10, -6, -20, -22, -15, -12, -18, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25],
            vuVariation: 10,
            rt60: 2.1,
            spectrum: [-8, -6, -4, -2, 0, -2, -4, -6, -8, -10, -12, -14],
            peakHz: 250,
            rms: -12,
            c50: -2,
            c80: 3,
            sti: 0.62
        },
        pregacao: {
            label: 'Pregação',
            description: 'Foco em voz e monitor',
            channelBases: [-10, -60, -60, -60, -60, -60, -60, -30, -60, -60, -60, -60, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25, -25],
            vuVariation: 6,
            rt60: 1.6,
            spectrum: [-12, -10, -6, -2, 2, 4, 3, 1, -2, -6, -10, -14],
            peakHz: 2000,
            rms: -8,
            c50: 8,
            c80: 12,
            sti: 0.72
        },
        transicao: {
            label: 'Transição',
            description: 'Fade entre momentos',
            channelBases: [-40, -40, -40, -40, -40, -40, -40, -40, -40, -40, -40, -40, -30, -30, -30, -30, -30, -30, -30, -30, -30, -30, -30, -30],
            vuVariation: 5,
            rt60: 1.9,
            spectrum: [-10, -8, -6, -4, -2, -4, -6, -8, -10, -12, -14, -16],
            peakHz: 500,
            rms: -30,
            c50: 0,
            c80: 4,
            sti: 0.55
        },
        ensaio: {
            label: 'Ensaio',
            description: 'Som reduzido para teste',
            channelBases: [-20, -16, -14, -18, -12, -14, -8, -25, -30, -20, -16, -22, -30, -30, -30, -30, -30, -30, -30, -30, -30, -30, -30, -30],
            vuVariation: 12,
            rt60: 2.3,
            spectrum: [-10, -8, -5, -3, -1, -3, -5, -7, -9, -11, -13, -15],
            peakHz: 125,
            rms: -16,
            c50: -1,
            c80: 2,
            sti: 0.58
        }
    };

    let _activeScene = 'silencio';

    function _getActiveScene() {
        return SCENES[_activeScene] || SCENES.silencio;
    }

    function _aiResponses() {
        const scene = _getActiveScene();
        const responses = [
            {
                trigger: /voz|pregação|pregador|pregadora/i,
                text: `Analisando a voz: NT1 está em ${scene.c50 > 5 ? 'boa inteligibilidade' : ' inteligibilidade aceitável'} (C50 = ${scene.c50.toFixed(1)}dB). Sugiro verificar a posição do microfone e ajustar o compressor para Ratio 2.5:1, Attack 25ms, Release 220ms. STIp = ${scene.sti.toFixed(2)} (${scene.sti > 0.65 ? 'bom' : 'razoável'} para esta sala com RT60 = ${scene.rt60.toFixed(1)}s).`,
                command: { action: 'apply_compressor', channel: 1, ratio: 2.5, threshold: -18 }
            },
            {
                trigger: /grave|baixo|boom|embolado|125hz|250hz/i,
                text: `Identificado acúmulo de graves na banda de ${Math.round(scene.peakHz)}Hz (pico principal). Sugiro aplicar um corte de -3dB em ${scene.peakHz < 200 ? '125Hz' : scene.peakHz < 500 ? '250Hz' : '500Hz'}, Q=1.2 no canal afetado. A sala com RT60 = ${scene.rt60.toFixed(1)}s amplifica estas frequências.`,
                command: { action: 'eq_cut', target: 'channel', channel: 1, hz: scene.peakHz < 200 ? 125 : 250, gain: -3, q: 1.2, band: 2 }
            },
            {
                trigger: /agudo|chiado|metal|3k|4k|8k/i,
                text: `Detecção de excesso de energia em ${scene.peakHz > 1000 ? 'agudos' : 'medios-altos'}. Aplicando corte paramétrico de -2dB em ${scene.peakHz > 2000 ? '3200Hz' : '2000Hz'}, Q=1.5. O RT60 de ${scene.rt60.toFixed(1)}s está ${scene.rt60 > 2.0 ? 'contribuindo para' : 'dentro do esperado para'} a ressonância.`,
                command: { action: 'eq_cut', target: 'channel', channel: 1, hz: 3200, gain: -2, q: 1.5, band: 3 }
            },
            {
                trigger: /microfonia|apito|feedback|larsen/i,
                text: `ALERTA: Risco de microfonia detectado em ${Math.round(scene.peakHz)}Hz. Sugiro: 1) cortar o retorno mais próximo do microfone, 2) reduzir ganho do mic em 3dB, 3) aplicar HPF em 100Hz neste canal. O AFS2 deve ser ativado como backup.`,
                command: { action: 'apply_channel_hpf', channel: 1, hz: 100 }
            },
            {
                trigger: /monitor|retorno|altar|palco/i,
                text: `Verificando vazamento de monitor: detectado耦合 entre PA e retorno. Sugiro aumentar o HPF do canal de monitor para 120Hz, aplicar gate com threshold -45dB, e verificar o delay do monitor (delay ideal = ${Math.round(3.5 * 2.915)}ms para 3.5m de distância).`,
                command: { action: 'set_delay', target: 'aux', id: 1, ms: 10 }
            },
            {
                trigger: /delay|eco|profundidade/i,
                text: `Para um delay musical natural, o tempo deve ser relacionado ao BPM. Com BPM estimado de 85 (louvor), o delay em semínima = ${Math.round(60000 / 85)}ms. Para o altar a 5m, delay = ${Math.round(5 * 2.915)}ms. Usando delay de repetição: 290ms (d = 50m).`,
                command: null
            },
            {
                trigger: /reverb|sala|ambiência/i,
                text: `RT60 medido = ${scene.rt60.toFixed(2)}s — ${scene.rt60 > 2.2 ? 'ACIMA do ideal (recomendo tratamento acústico).' : 'dentro da faixa aceitável para igrejas.'} Pre-delay recomendado: ${Math.round(scene.rt60 * 200)}ms para intelligibilidade. Decay: ${Math.round(scene.rt60 * 0.7)}s. Mix: ${scene.c80 > 8 ? '35%' : '25%'}.`,
                command: null
            },
            {
                trigger: /eq.*canal|ajustar|tratar/i,
                text: `Processando resposta de frequência... Canal ${Math.floor(Math.random() * 8) + 1}: Detectada ressonância em ${scene.peakHz}Hz (+${Math.floor(Math.random() * 6)}dB acima da curva target). Sugiro: Notch de -6dB em ${scene.peakHz}Hz, Q=8.0. A curva target para este ambiente: Church-Natural (IEC 60268-1).`,
                command: { action: 'eq_cut', target: 'master', hz: scene.peakHz, gain: -6, q: 8, band: 4 }
            },
            {
                trigger: /stéreo|l|r|p|pan/i,
                text: `Configuração estéreo: Verificando balance L/R... Master Pan em 0.5 (centro). O sistema está ${scene.c80 > 10 ? 'bem balanceado para direto' : 'com leve inversão de phase no canal esquerdo.'} Verificar cabos XLR do sistema principal.`,
                command: null
            },
            {
                trigger: /relatório|completo|técnico/i,
                text: `📊 RELATÓRIO TÉCNICO SIMULADO\n\nRT60: ${scene.rt60.toFixed(2)}s (${scene.rt60 > 2.2 ? '⚠️ Acima do ideal' : '✅ OK'})\nSTI: ${scene.sti.toFixed(2)} (${scene.sti > 0.65 ? '✅ Bom' : '⚠️ Melhorar'})\nC50: ${scene.c50.toFixed(1)}dB (Inteligibilidade)\nC80: ${scene.c80.toFixed(1)}dB (Definição Musical)\nPico: ${scene.peakHz}Hz\nRMS: ${scene.rms}dBFS\nCanais ativos: ${state.channels.filter(c => !c.mute && c.vu > -60).length}/${NUM_CHANNELS}\nMixer: ${state.connected ? 'SIMULADO CONECTADO' : 'OFFLINE'}`,
                command: null
            }
        ];
        return responses;
    }

    function askAI(text, channel) {
        const ch = (typeof channel === 'number' && channel >= 1 && channel <= 24) ? channel : 1;
        const responses = _aiResponses();
        for (const r of responses) {
            if (r.trigger.test(text)) {
                if (r.command && r.command.desc) {
                    r.command.desc = r.command.desc.replace(/Canal \d+/, `Canal ${ch}`);
                }
                return Promise.resolve({
                    text: r.text,
                    command: r.command
                });
            }
        }
        const scene = _getActiveScene();
        const chInfo = state.channels[ch - 1];
        const chName = chInfo?.name || ('Canal ' + ch);
        return Promise.resolve({
            text: `Entendi: "${text}". Estou analisando ${chName} (canal ${ch}). A sala tem RT60 = ${scene.rt60.toFixed(1)}s, ${state.channels.filter(c => !c.mute).length} canais ativos e Master em ${Math.round(state.master.level * 100)}%. Posso ajudar com ajustes de EQ, gate, compressor ou configurações de monitor para ${chName}.`,
            command: null
        });
    }

    function start() {
        if (_isRunning) return;
        _isRunning = true;
        state.connected = true;
        _intervalId = setInterval(_tick, _tickRate);
        _emitVuUpdate();
        if (window.AppStore) AppStore.addLog('[SIM] Simulação iniciada — Mixer simulado ativo.');
    }

    function stop() {
        if (!_isRunning) return;
        _isRunning = false;
        clearInterval(_intervalId);
        _intervalId = null;
        state.connected = false;
        _emitVuUpdate();
        if (window.AppStore) AppStore.addLog('[SIM] Simulação pausada.');
    }

    function reset() {
        _initState();
        _emitVuUpdate();
    }

    function setChannelLevel(channel, level) {
        const ch = state.channels[channel - 1];
        if (ch) ch.level = _clamp(level, 0, 1);
    }

    function setChannelMute(channel, mute) {
        const ch = state.channels[channel - 1];
        if (ch) ch.mute = !!mute;
    }

    function setMasterLevel(level) {
        state.master.level = _clamp(level, 0, 1);
    }

    function setMasterMute(mute) {
        state.master.mute = !!mute;
    }

    function setScene(sceneId) {
        if (SCENES[sceneId]) _activeScene = sceneId;
    }

    function getState() { return state; }
    function getScenes() { return SCENES; }
    function getActiveScene() { return _getActiveScene(); }
    function isRunning() { return _isRunning; }
    function getChannelCount() { return NUM_CHANNELS; }

    function getFakeAnalysis() {
        const scene = _getActiveScene();
        return {
            rt60: scene.rt60,
            rt60_multiband: { '125': scene.rt60 * 1.1, '250': scene.rt60 * 1.0, '500': scene.rt60 * 0.95, '1k': scene.rt60 * 0.9, '2k': scene.rt60 * 0.8, '4k': scene.rt60 * 0.7, '8k': scene.rt60 * 0.5 },
            peakHz: scene.peakHz,
            rms: scene.rms,
            spectrum_db: scene.spectrum,
            c50: scene.c50,
            c80: scene.c80,
            sti: scene.sti
        };
    }

    function getFakeSweepIR() {
        const scene = _getActiveScene();
        return {
            rt60: scene.rt60,
            edt: scene.rt60 * 0.45,
            t20: scene.rt60 * 0.8,
            t30: scene.rt60,
            c50: scene.c50,
            c80: scene.c80,
            sti: scene.sti,
            sti_speech: scene.sti,
            quality: scene.rt60 > 2.2 ? 'poor' : scene.rt60 > 1.8 ? 'fair' : 'good',
            room_type: scene.rt60 < 1.5 ? 'dead' : scene.rt60 < 2.0 ? 'moderate' : 'live'
        };
    }

    function enableSimulationMode() {
        if (!_isRunning) start();
        document.body.classList.add('simulation-mode');
        AppStore.setState({ simulationMode: true, aiStatus: 'simulation' });
        const btn = document.getElementById('btn-toggle-sim');
        if (btn) btn.style.display = '';
        if (btn) {
            btn.classList.add('active');
            btn.style.color = 'var(--accent)';
        }
        AppStore.addLog('[SIM] Modo simulação ATIVADO — sem hardware necessário.');
    }

    function disableSimulationMode() {
        stop();
        document.body.classList.remove('simulation-mode');
        AppStore.setState({ simulationMode: false });
        const btn = document.getElementById('btn-toggle-sim');
        if (btn) {
            btn.classList.remove('active');
            btn.style.color = '';
        }
        AppStore.addLog('[SIM] Modo simulação DESATIVADO.');
    }

    function toggleSimulationMode() {
        if (_isRunning) disableSimulationMode();
        else enableSimulationMode();
    }

    window.SimulationService = {
        start, stop, reset, isRunning,
        setChannelLevel, setChannelMute,
        setMasterLevel, setMasterMute,
        setScene, getState, getScenes, getActiveScene,
        getChannelCount,
        askAI,
        getFakeAnalysis,
        getFakeSweepIR,
        enableSimulationMode, disableSimulationMode, toggleSimulationMode
    };
})();
