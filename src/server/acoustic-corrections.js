/**
 * SoundMaster — Acoustic Corrections Engine
 * ==========================================
 * Traduz métricas acústicas (RT60, STI, C50, C80, T20, T30, EDT)
 * em ações concretas de mixer para a Soundcraft Ui24R.
 *
 * Baseado em:
 *  - ISO 3382-1 (RT60, EDT, C-values)
 *  - IEC 60268-16 (STI)
 *  - AES e EIA-422-B (Speech Intelligibility)
 *  - Práticas de live sound em ambientes de culto (AVIXA F502.01)
 *
 * Uso:
 *   const { generateCorrections } = require('./acoustic-corrections');
 *   const plan = generateCorrections(rt60Metrics, mixerState, roomProfile);
 *   // plan: { actions[], summary, risk, confidence }
 */

'use strict';

// ─── Alvos acústicos para ambientes de culto/speech ──────────────────────────

const TARGETS = {
    // RT60 ideal para ambientes de fala (s)
    rt60: { excellent: [0.6, 0.9], good: [0.9, 1.2], acceptable: [1.2, 1.6] },
    // STI: inteligibilidade da fala (0-1)
    sti:  { excellent: 0.75, good: 0.60, fair: 0.45 },
    // C50: clareza de fala (dB) — quanto sinal útil vs reverberação
    c50:  { excellent: 3.0, good: 0.0, poor: -3.0 },
    // C80: clareza musical (dB)
    c80:  { excellent: 3.0, good: 0.0 },
    // D50: definição (0-1) — parcela de energia nos primeiros 50ms
    d50:  { excellent: 0.65, good: 0.50, poor: 0.35 },
};

// ─── API Principal ────────────────────────────────────────────────────────────

/**
 * Gera um plano de correções completo com base nas métricas e no estado da mesa.
 *
 * @param {Object} metrics   - { rt60, t20, t30, edt, c50, c80, d50, sti, snr }
 * @param {Object} mixerState - Estado atual do mixer (do singleton: master, channels)
 * @param {Object} roomProfile - { name, volume_m3, seats, measurementChannel }
 * @returns {CorrectionPlan}
 */
function generateCorrections(metrics, mixerState, roomProfile) {
    const plan = {
        actions:    [],
        summary:    '',
        risk:       'low',       // 'low' | 'medium' | 'high'
        confidence: 0,           // 0-100: quão confiante é o plano
        roomQuality: _assessRoomQuality(metrics),
        metrics,
    };

    if (!metrics || !metrics.rt60) {
        plan.summary = 'Métricas insuficientes para gerar correções.';
        return plan;
    }

    const ctx = { metrics, mixerState, roomProfile, plan };

    // ── Análise em ordem de prioridade ────────────────────────────────────────

    _correctRt60(ctx);      // 1. Reverberação excessiva ou insuficiente
    _correctSti(ctx);       // 2. Inteligibilidade da fala
    _correctClarity(ctx);   // 3. Clareza (C50/C80/D50)
    _correctMudiness(ctx);  // 4. "Lama" de médios-baixos
    _correctChannels(ctx);  // 5. Ajustes por canal (HPF, gate)

    // ── Resumo ────────────────────────────────────────────────────────────────

    plan.confidence = _calculateConfidence(metrics);
    plan.summary    = _buildSummary(plan);
    plan.risk       = _assessRisk(plan.actions);

    return plan;
}

// ─── Analisadores ─────────────────────────────────────────────────────────────

function _correctRt60({ metrics, plan }) {
    const rt60 = metrics.rt60;
    if (!rt60) return;

    const [minGood, maxGood] = TARGETS.rt60.good;
    const [, maxAccept]      = TARGETS.rt60.acceptable;

    if (rt60 > maxAccept) {
        // Reverberação muito alta (> 1.6s) — situação crítica
        const excess = rt60 - 1.2;
        const hfCut  = Math.min(4.5, +(excess * 2.5).toFixed(1)); // dB de corte em altas freq.
        const lfCut  = Math.min(3.0, +(excess * 1.5).toFixed(1));

        plan.actions.push({
            id:          'rt60_hf_cut',
            priority:    1,
            type:        'eq',
            target:      'master',
            description: `RT60 alto (${rt60.toFixed(2)}s) — Corte de presença para reduzir reverberação`,
            explanation: `Com RT60 de ${rt60.toFixed(2)}s (alvo: 0.9-1.2s), a reverberação está obscurecendo a fala. ` +
                         `Reduzir 2-4kHz e 125-250Hz diminui o tempo percebido de decaimento sem afetar o volume.`,
            changes: [
                { band: 'low_mid', hz: 250,  gain: -lfCut, q: 1.4,  type: 'peaking', label: 'Mud cut' },
                { band: 'presence', hz: 3000, gain: -hfCut, q: 0.9, type: 'peaking', label: 'Presence cut' },
            ],
        });

    } else if (rt60 < minGood && rt60 > 0.2) {
        // Ambiente seco demais (< 0.6s) — pode soar áspero
        plan.actions.push({
            id:          'rt60_add_air',
            priority:    3,
            type:        'eq',
            target:      'master',
            description: `RT60 baixo (${rt60.toFixed(2)}s) — Adicionar "ar" e calor`,
            explanation: `O ambiente é muito seco (${rt60.toFixed(2)}s). Um toque de altas frequências suaviza o som.`,
            changes: [
                { band: 'air', hz: 12000, gain: 1.5, q: 0.7, type: 'shelf', label: 'Air shelf' },
            ],
        });
    }
}

function _correctSti({ metrics, plan }) {
    const sti = metrics.sti;
    if (!sti) return;

    if (sti < TARGETS.sti.fair) {
        // STI crítico — inteligibilidade muito ruim
        plan.actions.push({
            id:          'sti_presence_boost',
            priority:    1,
            type:        'eq',
            target:      'master',
            description: `STI muito baixo (${sti.toFixed(2)}) — Foco em frequências de inteligibilidade`,
            explanation: `STI ${sti.toFixed(2)} indica inteligibilidade de fala ${_stiLabel(sti)}. ` +
                         `Reforçar 1-4kHz (formantes da voz) melhora a compreensão sem aumentar o volume.`,
            changes: [
                { band: 'speech', hz: 1500, gain: 2.5, q: 1.0, type: 'peaking', label: 'Speech boost' },
                { band: 'definition', hz: 3500, gain: 1.5, q: 0.8, type: 'peaking', label: 'Definition' },
            ],
        });

    } else if (sti < TARGETS.sti.good) {
        // STI abaixo do bom
        plan.actions.push({
            id:          'sti_subtle_boost',
            priority:    2,
            type:        'eq',
            target:      'master',
            description: `STI moderado (${sti.toFixed(2)}) — Leve realce de presença`,
            explanation: `STI ${sti.toFixed(2)} é razoável mas pode melhorar. Realce sutil em 2kHz ajuda.`,
            changes: [
                { band: 'presence', hz: 2000, gain: 1.5, q: 1.2, type: 'peaking', label: 'Presence' },
            ],
        });
    }
}

function _correctClarity({ metrics, plan }) {
    const { c50, c80, d50 } = metrics;

    if (c50 !== undefined && c50 < TARGETS.c50.poor) {
        // C50 muito negativo — fala misturada na reverberação
        plan.actions.push({
            id:          'c50_compressor',
            priority:    2,
            type:        'processing',
            target:      'master',
            description: `C50 ruim (${c50.toFixed(1)} dB) — Sugerir compressão para aumentar clareza`,
            explanation: `C50 de ${c50.toFixed(1)}dB indica que a energia reverberante supera o sinal direto nos primeiros 50ms. ` +
                         `Compressão moderada (2:1, attack 10ms) ajuda a "empurrar" o sinal direto para frente.`,
            changes: [
                { type: 'compressor', ratio: 2.0, threshold: -18, attack: 10, release: 80, label: 'Clarity comp' },
            ],
        });
    }

    if (d50 !== undefined && d50 < TARGETS.d50.poor) {
        plan.actions.push({
            id:          'd50_definition',
            priority:    2,
            type:        'eq',
            target:      'master',
            description: `D50 baixo (${(d50 * 100).toFixed(0)}%) — Melhorar definição tonal`,
            explanation: `Definição de ${(d50 * 100).toFixed(0)}% (alvo >50%) indica excesso de energia tardia. ` +
                         `Reduzir graves que "carregam" por mais tempo melhora a definição percebida.`,
            changes: [
                { band: 'low', hz: 125, gain: -2.5, q: 0.9, type: 'shelf', label: 'Low shelf cut' },
            ],
        });
    }
}

function _correctMudiness({ metrics, plan }) {
    const rt60 = metrics.rt60 || 0;

    // "Lama" (mudiness) é comum em salas com RT60 alto + volume grande
    if (rt60 > 1.0) {
        const mudGain = -Math.min(4.0, (rt60 - 1.0) * 3);
        plan.actions.push({
            id:          'mud_cut',
            priority:    2,
            type:        'eq',
            target:      'master',
            description: 'Corte de "lama" nos médios-baixos (150-400Hz)',
            explanation: `Em ambientes com RT60 > 1.0s, a faixa de 150-400Hz tende a acumular e ` +
                         `"obscurecer" a voz. Um corte suave limpa o som sem remover calor.`,
            changes: [
                { band: 'mud', hz: 200, gain: +(mudGain).toFixed(1), q: 0.8, type: 'peaking', label: 'Mud cut' },
                { band: 'boxiness', hz: 350, gain: +(mudGain * 0.7).toFixed(1), q: 1.0, type: 'peaking', label: 'Box cut' },
            ],
        });
    }
}

function _correctChannels({ metrics, roomProfile, plan }) {
    const rt60 = metrics.rt60 || 0;
    const measurementChannel = roomProfile?.measurementChannel;

    // HPF recomendado em todos os canais de microfone
    const hpfHz = rt60 > 1.2 ? 120 : rt60 > 0.8 ? 100 : 80;

    plan.actions.push({
        id:          'hpf_mic_channels',
        priority:    3,
        type:        'channel_processing',
        target:      'all_mic_channels',
        description: `HPF a ${hpfHz}Hz em canais de microfone (reduz bombo de ambiente)`,
        explanation: `Em ambientes com RT60 de ${rt60.toFixed(2)}s, ` +
                     `frequências abaixo de ${hpfHz}Hz em microfones geralmente são ruído de ambiente, ` +
                     `ventilação ou manipulação. O HPF limpa sem afetar a voz.`,
        changes: [
            { type: 'hpf', hz: hpfHz, slope: 24, label: `HPF ${hpfHz}Hz` },
        ],
        affectedChannels: measurementChannel ? [measurementChannel] : [],
        note: 'Aplicar individualmente aos canais de microfone ativos.',
    });

    // Gate recomendado se STI é ruim (muitos mics abertos piora)
    if (metrics.sti !== undefined && metrics.sti < TARGETS.sti.good) {
        plan.actions.push({
            id:          'gate_open_mics',
            priority:    3,
            type:        'channel_processing',
            target:      'all_mic_channels',
            description: 'Gate leve nos canais de microfone (reduz microfones abertos desnecessariamente)',
            explanation: `Com STI de ${metrics.sti.toFixed(2)}, cada microfone aberto adiciona ` +
                         `6dB de ruído de palco. Gates fechados reduzem a carga reverberante total.`,
            changes: [
                { type: 'gate', threshold: -55, attack: 5, release: 100, label: 'Noise gate leve' },
            ],
        });
    }
}

// ─── Avaliação e helpers ──────────────────────────────────────────────────────

function _assessRoomQuality(metrics) {
    if (!metrics) return 'unknown';
    const rt60 = metrics.rt60;
    const sti  = metrics.sti;

    if (!rt60) return 'unknown';

    const rt60Score =
        rt60 >= 0.6 && rt60 <= 1.2 ? 3 :
        rt60 >= 0.4 && rt60 <= 1.6 ? 2 : 1;

    const stiScore = !sti ? 2 :
        sti >= TARGETS.sti.excellent ? 3 :
        sti >= TARGETS.sti.good      ? 2 : 1;

    const avg = (rt60Score + stiScore) / 2;
    return avg >= 2.5 ? 'good' : avg >= 1.8 ? 'fair' : 'poor';
}

function _assessRisk(actions) {
    const maxPriority = Math.min(...actions.map(a => a.priority));
    if (maxPriority === 1 && actions.length > 3) return 'medium';
    if (actions.some(a => a.type === 'processing')) return 'medium';
    return 'low';
}

function _calculateConfidence(metrics) {
    let score = 0;
    if (metrics.rt60)  score += 30;
    if (metrics.t30)   score += 20;
    if (metrics.t20)   score += 15;
    if (metrics.edt)   score += 10;
    if (metrics.c50 !== undefined) score += 10;
    if (metrics.sti !== undefined) score += 15;
    return Math.min(100, score);
}

function _buildSummary(plan) {
    const { roomQuality, metrics, actions } = plan;
    const rt60 = metrics.rt60?.toFixed(2);
    const sti  = metrics.sti?.toFixed(2);
    const qMap = { good: 'boa', fair: 'moderada', poor: 'ruim', unknown: 'indefinida' };

    return `Qualidade acústica ${qMap[roomQuality]} — ` +
           `RT60: ${rt60 || '?'}s` +
           (sti ? `, STI: ${sti}` : '') +
           `. ${actions.length} correção(ões) sugerida(s).`;
}

function _stiLabel(sti) {
    if (sti >= 0.75) return 'excelente';
    if (sti >= 0.60) return 'boa';
    if (sti >= 0.45) return 'razoável';
    if (sti >= 0.30) return 'ruim';
    return 'muito ruim';
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { generateCorrections, TARGETS };
