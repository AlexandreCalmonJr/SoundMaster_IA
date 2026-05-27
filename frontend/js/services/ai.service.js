/**
 * SoundMaster — AIService
 * Gerencia toda comunicação com o servidor Python de IA (ai_server.py).
 * Inclui timeout, retry e enriquecimento da mensagem com canal alvo.
 *
 * USO:
 *   const result = await AIService.ask('voz abafada', 3);
 *   // result: { text: string, command: Object|null }
 */
(function () {
    'use strict';

    const AI_URL = '/api/ai';
    const TIMEOUT_MS = 60000;

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _buildMessage(text, channel) {
        const ch = Number(channel);
        const validChannel = Number.isInteger(ch) && ch >= 1 && ch <= 24 ? ch : 1;
        // Enriquece a mensagem com o canal se ainda não estiver presente
        const hasChannel = /canal\s*\d+/i.test(text) || /ch\s*\d+/i.test(text);
        return hasChannel ? text : text + ' canal ' + validChannel;
    }

    function _getMixerSnapshot(channel) {
        const state = AppStore.getState();
        const selectedChannel = Number(channel);
        const channelVu = state.vuData && state.vuData.channels ? state.vuData.channels[selectedChannel] : null;

        var auxSends = {};
        for (var a = 1; a <= 4; a++) {
            auxSends['aux' + a] = state[`ch_${selectedChannel}_aux${a}_level`] ?? null;
        }

        return {
            selectedChannel: selectedChannel,
            channel: {
                level: state[`ch_${selectedChannel}_level`] ?? null,
                mute: state[`mute_ch_${selectedChannel}`] ? 1 : 0,
                phantom: state[`phantom_ch_${selectedChannel}`] ? 1 : 0,
                vu: channelVu || null,
                eq: state[`ch_${selectedChannel}_eq`] ?? null
            },
            aux_sends: auxSends,
            master: {
                level: state.masterLevel ?? 0,
                levelDb: state.masterDb ?? null,
                mute: state.masterMute ? 1 : 0
            },
            all_vus: state.vuData || null
        };
    }

    function _getLiveAnalysis() {
        if (window.SoundMasterAnalyzer && window.SoundMasterAnalyzer.isAnalyzing()) {
            const analysis = window.SoundMasterAnalyzer.getLastAnalysis();
            if (analysis) {
                return {
                    live: true,
                    summary: analysis.text,
                    peakHz: analysis.details?.peakHz,
                    peakDb: analysis.details?.peakDb,
                    rms: analysis.details?.rmsDb,
                    bands: analysis.details?.bands,
                    spectrum: analysis.details?.spectrum_v11,
                };
            }
        }
        return null;
    }

    // -------------------------------------------------------------------------
    // API principal
    // -------------------------------------------------------------------------

    /**
     * Envia uma mensagem para a IA e retorna a resposta.
     * @param {string} text     - Mensagem do usuário
     * @param {number} channel  - Canal alvo (1–24)
     * @param {Object} [analysis] - Dados acústicos adicionais para auxiliar a IA
     * @returns {Promise<{ text: string, command: Object|null }>}
     */
    async function ask(text, channel, analysis) {
        const message = _buildMessage(text.trim(), channel);

        const enrichedAnalysis = analysis || {};
        const liveData = _getLiveAnalysis();
        if (liveData) {
            enrichedAnalysis.live_mic = liveData;
        }

        AppStore.setState({ aiStatus: 'loading' });

        const controller = new AbortController();
        const timeoutId = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

        var sessionId = AppStore.getState().aiSessionId || 'default';

        try {
            const response = await fetch(AI_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, channel, analysis: enrichedAnalysis, mixer_context: _getMixerSnapshot(channel), session_id: sessionId }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            let data;
            try {
                data = await response.json();
            } catch (jsonErr) {
                throw new Error('Resposta inválida do servidor IA (HTTP ' + response.status + ')');
            }
            AppStore.setState({ aiStatus: 'online' });

            // Registrar sugestão no store se houver comando
            if (data.command) {
                AppStore.addAISuggestion({ desc: data.command.desc, command: data.command });
                AppStore.addLog('Sugestão IA: ' + data.command.desc);
            }

            return {
                text: data.text || 'IA não retornou resposta.',
                command: data.command || null,
                report: data.report || null
            };

        } catch (err) {
            clearTimeout(timeoutId);

            if (err.name === 'AbortError') {
                AppStore.addLog('⚠️ IA: timeout — usando IA simulada.');
            } else {
                AppStore.addLog('⚠️ IA offline — usando IA simulada: ' + err.message);
            }

            if (window.SimulationService && window.SimulationService.isRunning()) {
                AppStore.setState({ aiStatus: 'simulation' });
                try {
                    const simResult = await SimulationService.askAI(text.trim(), channel);
                    return simResult;
                } catch (simErr) {
                    AppStore.addLog('⚠️ Simulação falhou: ' + simErr.message);
                }
            }

            AppStore.setState({ aiStatus: 'offline' });
            return {
                text: 'IA local offline. Ative o modo simulação (ícone de chave) ou inicie o servidor Python (npm start).',
                command: null
            };
        }
    }

    async function ping() {
        const controller = new AbortController();
        const timeoutId = setTimeout(function () { controller.abort(); }, 2000);
        try {
            const response = await fetch('/api/ai/health', {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (response.ok) {
                AppStore.setState({ aiStatus: 'online' });
                return true;
            }
            throw new Error('Offline');
        } catch (_) {
            clearTimeout(timeoutId);
            if (window.SimulationService && SimulationService.isRunning()) {
                AppStore.setState({ aiStatus: 'simulation' });
                return true;
            }
            AppStore.setState({ aiStatus: 'offline' });
            return false;
        }
    }

    /**
     * Envia dimensões para cálculo acústico avançado no Python (Eyring RT60).
     */
    async function calculateAcoustics(volume, surfaceArea, alpha) {
        try {
            const response = await fetch('/api/acoustic_analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ volume, surface_area: surfaceArea, alpha })
            });
            if (!response.ok) throw new Error('Falha no cálculo');
            return await response.json();
        } catch (err) {
            console.error('[AIService] Erro no cálculo acústico:', err);
            return null;
        }
    }

    /**
     * Classifica áudio em tempo real via YAMNet (Python).
     * Envia amostras PCM Float32 para o endpoint /api/ai/classify.
     * @param {Float32Array|number[]} samples  - 1 segundo de áudio (~48000 samples a 48kHz)
     * @param {number} sampleRate               - taxa de amostragem (padrão 48000)
     * @param {number} [k=5]                    - top-K classes
     * @param {number} [threshold=0.1]          - score mínimo
     * @returns {Promise<{classes:Array, topClass:string, topScore:number}>}
     */
    async function classifyAudio(samples, sampleRate = 48000, k = 5, threshold = 0.1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch('/api/ai/classify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio: Array.from(samples),
                    sampleRate,
                    k,
                    threshold
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return { classes: [], topClass: null, topScore: null };
            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            return { classes: [], topClass: null, topScore: null };
        }
    }

    /**
     * Envia dados espectrais para o Auto-EQ do Python.
     */
    async function autoEqFromAI(freqData, sampleRate, fftSize, targetCurve = 'smaart') {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch('/api/calculate/auto-eq', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ freqData: Array.from(freqData), sampleRate, fftSize, targetCurve }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return null;
            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            return null;
        }
    }

    /**
     * Envia diagnóstico de hardware para o Python (análise de tendência).
     */
    async function hardwareDiagnosis(channel, snapshots) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch('/hardware_diagnosis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel, snapshots, months: 6 }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return null;
            return await response.json();
        } catch (err) {
            clearTimeout(timeoutId);
            return null;
        }
    }

    /**
     * Envia um evento de treinamento para o Python (feedback do usuário).
     * Isso alimenta o modelo de ML para melhorar predições futuras.
     */
    async function sendTrainingEvent(freq, db, prevDb, gain, isFeedback) {
        try {
            await fetch('/train', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ freq, db, prevDb, gain, isFeedback })
            });
        } catch (_) {}
    }

    async function listenAndAnalyze(channel) {
        if (!window.SoundMasterAnalyzer) {
            throw new Error('Analisador não disponível');
        }

        if (!window.SoundMasterAnalyzer.isAnalyzing()) {
            await window.SoundMasterAnalyzer.start();
            await new Promise(r => setTimeout(r, 3000));
        }

        const analysis = window.SoundMasterAnalyzer.getLastAnalysis();
        if (!analysis) {
            throw new Error('Nenhuma análise disponível. Aguarde alguns segundos.');
        }

        const result = await ask('Analise o áudio capturado pelo microfone e sugira melhorias', channel || 1, {
            auto_listen: true,
            summary: analysis.text,
            peakHz: analysis.details?.peakHz,
            peakDb: analysis.details?.peakDb,
            rms: analysis.details?.rmsDb,
            bands: analysis.details?.bands,
            spectrum: analysis.details?.spectrum_v11,
        });

        return result;
    }

    window.AIService = { ask, ping, calculateAcoustics, listenAndAnalyze, classifyAudio, autoEqFromAI, hardwareDiagnosis, sendTrainingEvent };
})();
