/**
 * SoundMaster Pro — Módulo de Calibração de Microfone (AcousticCalibration)
 * ===========================================================================
 *
 * Funcionalidades:
 *   1. Parser de ficheiros .cal / .txt de calibração (formatos FuzzMeasure,
 *      Room EQ Wizard, ARTA, MiniDSP UMIK, AudioTechnica ECM8000)
 *   2. Interpolação logarítmica (log-linear) dos pontos de calibração para
 *      qualquer resolução de FFT (qualquer número de bins)
 *   3. Aplicação da curva inversa em tempo real no array freqData
 *   4. Calibração de SPL absoluta por tom de referência (94 dBSPL @ 1 kHz)
 *   5. Persistência via API do servidor (NeDB)
 *   6. Migração do ScriptProcessorNode → AudioWorklet para ruído rosa
 *
 * Formatos de ficheiro suportados:
 *   ─────────────────────────────────────────────────────────────────
 *   FuzzMeasure / ARTA:     "<freq> <dB> [phase_deg]"
 *   REW (export TXT):       "<freq> <dB> [phase_deg]"  (header com *)
 *   MiniDSP / UMIK-1:       "<freq>\t<dB>"  (separador: tab)
 *   AudioTechnica .cal:     "<freq>,<dB>"   (separador: vírgula)
 *   Generic:                qualquer whitespace/vírgula/ponto-e-vírgula
 *   Cabeçalhos ignorados:   linhas que começam com *, #, /, ", [, espaço
 *   ─────────────────────────────────────────────────────────────────
 *
 * API pública (window.AcousticCalibration):
 *   .applyCalibration(freqDataArray, sampleRate, fftSize?)
 *   .calibrateSPL(currentRawDb)
 *   .clearCalibration()
 *   .loadFromText(text, filename?)   → Promise<{ points, name, metadata }>
 *   .loadPreset(name)                → carrega perfil embutido (ECM8000, etc.)
 *   .getProfile()                    → { name, points, splOffset, active }
 *   .getCurrentSplOffset()           → number
 *   .isActive()                      → bool
 */

'use strict';

(function () {

    /**
     * Busca elemento pelo ID, tentando primeiro no iframe e depois no parent.
     */
    function _el(id) {
        const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    // ─── Estado interno ───────────────────────────────────────────────────────

    let _points    = [];     // [{ hz: number, offsetDb: number }] — ordenado por hz
    let _splOffset = 0;      // offset global de SPL (calibração de nível absoluto)
    let _name      = 'Genérico (Flat)';
    let _active    = false;  // true quando há um ficheiro carregado

    // Cache de curva interpolada por resolução de FFT
    // Chave: `${binCount}_${sampleRate}` → Float32Array de offsets por bin
    const _cache   = new Map();

    // RMS do ruído rosa (exposto internamente para debug)
    let _pinkNoiseRms = 0;

    // ─── Parser de ficheiro .cal / .txt ───────────────────────────────────────

    /**
     * Detecta e faz o parse de um ficheiro de calibração.
     * Suporta os formatos: FuzzMeasure, ARTA, REW, MiniDSP UMIK-1, AudioTechnica.
     *
     * @param {string} text      - conteúdo completo do ficheiro
     * @param {string} filename  - nome do ficheiro (para detecção de formato)
     * @returns {{ points: Array, name: string, metadata: Object }}
     */
    function _parseCalText(text, filename = '') {
        const points   = [];
        const metadata = { format: 'unknown', headerLines: [], rawLineCount: 0 };
        const lines    = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        // Detecta o formato pelo cabeçalho
        let format = 'generic';
        for (const line of lines.slice(0, 10)) {
            const l = line.trim().toLowerCase();
            if (l.includes('room eq wizard') || l.includes('rew'))  { format = 'rew';   break; }
            if (l.includes('arta') || l.includes('measurement'))    { format = 'arta';  break; }
            if (l.includes('umik') || l.includes('minidsp'))        { format = 'umik';  break; }
            if (l.includes('fuzz') || l.includes('fuzzm'))          { format = 'fuzzmeasure'; break; }
            if (filename.endsWith('.cal') || filename.endsWith('.mic')) { format = 'cal'; break; }
        }
        metadata.format = format;

        for (let i = 0; i < lines.length; i++) {
            const raw  = lines[i];
            const line = raw.trim();
            metadata.rawLineCount++;

            // Salta linhas de cabeçalho/comentário
            if (!line
                || line.startsWith('*')
                || line.startsWith('#')
                || line.startsWith('/')
                || line.startsWith('"')
                || line.startsWith('[')
                || line.toLowerCase().startsWith('freq')
                || line.toLowerCase().startsWith('hz')) {
                metadata.headerLines.push(raw);
                continue;
            }

            // Divide por qualquer separador: espaço, tab, vírgula, ponto-e-vírgula
            const parts = line.split(/[\s,;\t]+/).filter(p => p.length > 0);
            if (parts.length < 2) continue;

            const hz       = parseFloat(parts[0]);
            const offsetDb = parseFloat(parts[1]);
            // Fase (parte[2]) é ignorada na calibração de magnitude, mas guardada
            const phase    = parts.length >= 3 ? parseFloat(parts[2]) : null;

            if (!isFinite(hz) || !isFinite(offsetDb)) continue;
            if (hz < 1 || hz > 100000) continue;              // fora de gama física
            if (Math.abs(offsetDb) > 40) continue;             // valor implausível

            points.push({ hz, offsetDb, phase });
        }

        // Ordena por frequência (alguns ficheiros não estão ordenados)
        points.sort((a, b) => a.hz - b.hz);

        // Remove duplicados (média entre pontos com mesma frequência)
        const deduped = [];
        for (let i = 0; i < points.length; i++) {
            if (i === 0 || Math.abs(points[i].hz - deduped[deduped.length - 1].hz) > 0.01) {
                deduped.push({ ...points[i] });
            } else {
                // Média dos offsets
                deduped[deduped.length - 1].offsetDb =
                    (deduped[deduped.length - 1].offsetDb + points[i].offsetDb) / 2;
            }
        }

        console.log(`[Calibration] Parse (${format}): ${deduped.length} pontos, ${metadata.headerLines.length} linhas de cabeçalho`);
        return { points: deduped, metadata, format };
    }

    // ─── Interpolação logarítmica ─────────────────────────────────────────────

    /**
     * Constrói a curva de compensação para cada bin do FFT.
     *
     * Usa interpolação log-linear (linear em escala logarítmica de frequência)
     * porque as bandas de oitava têm espaçamento logarítmico — idêntico ao
     * método usado no REW e no ARTA para aplicação de curvas de calibração.
     *
     * A curva retornada é a **curva inversa**: se o microfone tem +2dB a 1kHz,
     * subtraímos 2dB dessa bin para compensar.
     *
     * @param {number} binCount  - frequencyBinCount do analyser
     * @param {number} sampleRate
     * @param {number} fftSize   - para calcular hzPerBin correctamente
     * @returns {Float32Array}   - array de offsets (em dB) para cada bin
     */
    function _buildInterpolatedCurve(binCount, sampleRate, fftSize) {
        const curve     = new Float32Array(binCount);
        const hzPerBin  = sampleRate / (fftSize ?? binCount * 2);
        const pts       = _points; // já ordenado

        if (pts.length === 0) return curve; // sem dados → zeros

        const logHz = pts.map(p => Math.log10(Math.max(p.hz, 1)));

        for (let k = 0; k < binCount; k++) {
            const freq = k * hzPerBin;
            if (freq < 1) { curve[k] = 0; continue; }

            const logF = Math.log10(freq);

            // Extrapolação para frequências abaixo/acima do range do ficheiro
            if (logF <= logHz[0]) {
                curve[k] = -pts[0].offsetDb;  // curva inversa
                continue;
            }
            if (logF >= logHz[logHz.length - 1]) {
                curve[k] = -pts[pts.length - 1].offsetDb;
                continue;
            }

            // Busca binária pelo intervalo de interpolação
            let lo = 0, hi = pts.length - 2;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (logHz[mid + 1] < logF) lo = mid + 1;
                else hi = mid;
            }

            // Interpolação linear em escala log(Hz)
            const t = (logF - logHz[lo]) / (logHz[lo + 1] - logHz[lo]);
            const interpolatedDb = pts[lo].offsetDb + t * (pts[lo + 1].offsetDb - pts[lo].offsetDb);

            // Curva inversa: se mic tem +2dB → subtraímos 2dB
            curve[k] = -interpolatedDb;
        }

        return curve;
    }

    /**
     * Retorna a curva cacheada, recalculando apenas se necessário.
     */
    function _getCurve(binCount, sampleRate, fftSize) {
        const key = `${binCount}_${sampleRate}_${fftSize ?? 0}`;
        if (!_cache.has(key)) {
            _cache.set(key, _buildInterpolatedCurve(binCount, sampleRate, fftSize));
        }
        return _cache.get(key);
    }

    // ─── Aplicação em tempo real ──────────────────────────────────────────────

    /**
     * Aplica a curva de calibração inversa ao array freqData do analyser.
     * Chamado a cada frame de análise (60fps) — deve ser O(N) sem alocação.
     *
     * @param {Float32Array} freqDataArray - getFloatFrequencyData() em dBFS
     * @param {number}       sampleRate
     * @param {number}       fftSize       - analyser.fftSize (opcional)
     */
    function applyCalibration(freqDataArray, sampleRate, fftSize) {
        if (!_active && _splOffset === 0) return;

        const binCount = freqDataArray.length;
        const curve    = _active ? _getCurve(binCount, sampleRate, fftSize) : null;

        for (let i = 0; i < binCount; i++) {
            let correction = _splOffset;
            if (curve) correction += curve[i];
            freqDataArray[i] += correction;
        }
    }

    // ─── Carregamento de ficheiro ─────────────────────────────────────────────

    /**
     * Carrega e activa uma curva de calibração a partir de texto.
     * @returns {Promise<{ points, name, metadata }>}
     */
    async function loadFromText(text, filename = 'custom.cal') {
        const result = _parseCalText(text, filename);

        if (result.points.length < 3) {
            throw new Error(`Ficheiro inválido: apenas ${result.points.length} pontos encontrados (mínimo: 3).`);
        }

        _points = result.points;
        _name   = filename.replace(/\.(cal|txt|mic)$/i, '');
        _active = true;
        _cache.clear(); // invalida cache ao mudar de perfil

        _updateUI();
        await _persist();

        console.log(`[Calibration] Perfil "${_name}" activado com ${_points.length} pontos.`);
        return { points: _points, name: _name, metadata: result.metadata };
    }

    // ─── Perfis embutidos ─────────────────────────────────────────────────────

    /**
     * Curvas de calibração de microfones comuns, embutidas no código.
     * Fonte: datasheets e medições de referência publicadas pelos fabricantes.
     *
     * Formato: { hz, offsetDb } onde offsetDb é o desvio do microfone
     * (positivo = microfone mede mais; a curva inversa compensa subtraindo).
     */
    const BUILTIN_PROFILES = {
        'ECM8000': {
            name: 'Behringer ECM8000',
            // Curva típica do ECM8000 (média de unidades medidas em campo)
            // Baseado em: tinyurl.com/ecm8000-cal + media.behringer.com
            points: [
                { hz: 20,    offsetDb:  2.5 },
                { hz: 31.5,  offsetDb:  1.8 },
                { hz: 63,    offsetDb:  0.8 },
                { hz: 125,   offsetDb:  0.3 },
                { hz: 250,   offsetDb:  0.1 },
                { hz: 500,   offsetDb:  0.0 },
                { hz: 1000,  offsetDb:  0.0 },
                { hz: 2000,  offsetDb:  0.2 },
                { hz: 4000,  offsetDb:  1.5 },
                { hz: 6000,  offsetDb:  2.8 },
                { hz: 8000,  offsetDb:  2.1 },
                { hz: 10000, offsetDb:  0.5 },
                { hz: 12500, offsetDb: -1.2 },
                { hz: 16000, offsetDb: -3.5 },
                { hz: 20000, offsetDb: -6.0 },
            ]
        },
        'UMIK-1': {
            name: 'MiniDSP UMIK-1 (Flat)',
            // O UMIK-1 é fornecido com ficheiro .cal individual — este é apenas
            // um perfil genérico de fallback quando o ficheiro individual não está disponível
            points: [
                { hz: 20,    offsetDb:  1.0 },
                { hz: 63,    offsetDb:  0.5 },
                { hz: 125,   offsetDb:  0.2 },
                { hz: 250,   offsetDb:  0.1 },
                { hz: 500,   offsetDb:  0.0 },
                { hz: 1000,  offsetDb:  0.0 },
                { hz: 2000,  offsetDb:  0.0 },
                { hz: 4000,  offsetDb:  0.3 },
                { hz: 8000,  offsetDb:  0.8 },
                { hz: 12500, offsetDb:  1.2 },
                { hz: 16000, offsetDb:  2.0 },
                { hz: 20000, offsetDb:  3.5 },
            ]
        },
        'FLAT': {
            name: 'Flat (sem calibração)',
            points: []
        }
    };

    /**
     * Carrega um perfil embutido pelo nome.
     * @param {'ECM8000'|'UMIK-1'|'FLAT'} presetName
     */
    function loadPreset(presetName) {
        const profile = BUILTIN_PROFILES[presetName];
        if (!profile) {
            console.warn(`[Calibration] Perfil desconhecido: ${presetName}`);
            return;
        }
        _points  = [...profile.points];
        _name    = profile.name;
        _active  = profile.points.length > 0;
        _cache.clear();
        _updateUI();
        console.log(`[Calibration] Perfil embutido "${_name}" carregado.`);
    }

    // ─── Calibração SPL absoluta ──────────────────────────────────────────────

    /**
     * Calibra o nível SPL absoluto usando um calibrador de campo (tom de 94 dBSPL a 1 kHz).
     * Chame este método com o valor RMS lido pelo microfone enquanto o calibrador está ligado.
     *
     * @param {number} currentRawDb - valor lido em dBFS pelo analyser
     */
    function calibrateSPL(currentRawDb) {
        const REF_DB = 94; // dBSPL — padrão IEC 60942 para calibradores de campo
        _splOffset   = REF_DB - currentRawDb;
        _cache.clear();

        const disp = _el('spl-offset-display');
        if (disp) disp.innerText = `${_splOffset.toFixed(1)} dB`;

        _persist();
        console.log(`[Calibration] SPL offset: ${_splOffset.toFixed(1)} dB`);
    }

    // ─── Limpeza ──────────────────────────────────────────────────────────────

    function clearCalibration() {
        _points    = [];
        _splOffset = 0;
        _name      = 'Genérico (Flat)';
        _active    = false;
        _cache.clear();

        _updateUI();
        _persist();

        const input = _el('cal-file-input');
        if (input) input.value = '';

        console.log('[Calibration] Calibração removida.');
    }

    // ─── UI ───────────────────────────────────────────────────────────────────

    function _updateUI() {
        const status = _el('cal-status');
        const disp   = _el('spl-offset-display');

        if (status) {
            if (_active) {
                status.innerText   = `✅ ${_name} (${_points.length} pts)`;
                status.className   = 'text-green-400 font-bold';
            } else {
                status.innerText   = 'Sem calibração (Microfone Genérico)';
                status.className   = 'text-amber-400 font-bold';
            }
        }
        if (disp) disp.innerText = `${_splOffset.toFixed(1)} dB`;
    }

    // ─── Persistência ─────────────────────────────────────────────────────────

    async function _persist() {
        try {
            const res = await fetch('/api/calibration', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ calibrationData: _points, splOffset: _splOffset, name: _name })
            });
            if (!res.ok) console.warn('[Calibration] Persistência retornou HTTP', res.status);
        } catch (err) {
            console.warn('[Calibration] Falha ao persistir:', err.message);
        }
    }

    async function _restore() {
        try {
            const res  = await fetch('/api/calibration');
            if (!res.ok) return;
            const data = await res.json();

            if (data.calibrationData?.length > 0) {
                _points = data.calibrationData.sort((a, b) => a.hz - b.hz);
                _name   = data.name || 'Recuperado';
                _active = true;
            }
            if (data.splOffset != null && isFinite(data.splOffset)) {
                _splOffset = data.splOffset;
            }
            _updateUI();
            console.log(`[Calibration] Recuperado: "${_name}" (${_points.length} pts), offset=${_splOffset.toFixed(1)}dB`);
        } catch (err) {
            console.warn('[Calibration] Falha ao recuperar:', err.message);
        }
    }

    // ─── Migração Pink Noise: ScriptProcessor → AudioWorklet ─────────────────

    /**
     * Inicia o ruído rosa usando o novo AudioWorkletNode (thread de áudio dedicada).
     * Requer AudioWorklet; ScriptProcessorNode não é usado por ser depreciado.
     *
     * @param {AudioContext} ctx
     * @param {number}       amplitude  - 0.0 a 1.0
     * @returns {Promise<AudioNode>}    - nó conectável ao destination
     */
    async function createPinkNoiseNode(ctx, amplitude = 0.25) {
        try {
            await ctx.audioWorklet.addModule('js/core/min/pink-noise-processor.js');
            const node = new AudioWorkletNode(ctx, 'pink-noise-processor', {
                numberOfInputs:  0,
                numberOfOutputs: 1,
                outputChannelCount: [1],
                parameterData: { amplitude },
            });
            node.port.onmessage = (e) => {
                if (e.data.type === 'rms') {
                    _pinkNoiseRms = e.data.value;
                }
            };
            node._isPinkWorklet = true;
            console.log('[PinkNoise] AudioWorklet iniciado.');
            return node;
        } catch (err) {
            console.error('[PinkNoise] Erro ao carregar AudioWorklet. A API ScriptProcessorNode foi depreciada e removida.', err.message);
            throw new Error('Web Audio API moderna (AudioWorklet) é necessária para esta função.');
        }
    }

    // ─── Inicialização da página ──────────────────────────────────────────────

    let _pageAc = null;

    document.addEventListener('page-loaded', (e) => {
        if (e.detail.pageId !== 'analyzer') return;

        // Cancela listeners anteriores (evita duplicação se page-loaded re-firar)
        if (_pageAc) _pageAc.abort();
        _pageAc = new AbortController();
        const { signal } = _pageAc;

        // Upload de ficheiro .cal
        const input = _el('cal-file-input');
        if (input) {
            input.addEventListener('change', async (ev) => {
                const file = ev.target.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    await loadFromText(text, file.name);
                    alert(`✅ Calibração "${_name}" carregada com ${_points.length} pontos.`);
                } catch (err) {
                    alert(`❌ Erro ao carregar ficheiro: ${err.message}`);
                }
            }, { signal });
        }

        // Botão limpar
        const btnClear = _el('btn-clear-calibration');
        if (btnClear) btnClear.addEventListener('click', clearCalibration, { signal });

        // Botão calibrar SPL (tom de 94dB)
        const btnSpl = _el('btn-calibrate-spl');
        if (btnSpl) {
            btnSpl.addEventListener('click', () => {
                const rms = window.currentGlobalRMS;
                if (!rms) {
                    alert('Ative o microfone e toque um tom de 94 dBSPL @ 1kHz antes de calibrar.');
                    return;
                }
                const rawDb = 20 * Math.log10(rms + 1e-6);
                calibrateSPL(rawDb);
                alert(`✅ Offset SPL: ${_splOffset.toFixed(1)} dB`);
            }, { signal });
        }

        // Dropdown de perfis embutidos
        const selectPreset = _el('cal-preset-select');
        if (selectPreset) {
            // Popula o select com os perfis disponíveis
            Object.entries(BUILTIN_PROFILES).forEach(([key, profile]) => {
                const opt = document.createElement('option');
                opt.value = key;
                opt.text  = profile.name;
                selectPreset.appendChild(opt);
            });
            selectPreset.addEventListener('change', (ev) => {
                if (ev.target.value) loadPreset(ev.target.value);
            }, { signal });
        }

        // Recupera perfil guardado do servidor
        _restore();
    });



    // ─── API pública ──────────────────────────────────────────────────────────

    window.AcousticCalibration = {
        // Calibração em tempo real
        applyCalibration,
        calibrateSPL,
        clearCalibration,
        // Carregamento de perfis
        loadFromText,
        loadPreset,
        // Factory do gerador de ruído rosa (AudioWorklet)
        createPinkNoiseNode,
        // Getters de estado
        getCurrentSplOffset: () => _splOffset,
        getProfile:          () => ({ name: _name, points: [..._points], splOffset: _splOffset, active: _active }),
        isActive:            () => _active,
        // Constantes
        BUILTIN_PROFILES,
    };

})();
