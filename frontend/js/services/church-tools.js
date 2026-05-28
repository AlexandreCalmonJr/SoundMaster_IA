(function () {
    var _churchController = new AbortController();
    var _mtkUnsub = null;
    var _acousticHandler = null;

    function _el(id) {
        const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    function _esc(s){return String(s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]});}

    function initEqGuide() {
        const eqSelect = _el('eq-instrument-select');
        const eqDisplay = _el('eq-data-display');
        if (!eqSelect || !eqDisplay || typeof eqData === 'undefined') return;

        function updateEqDisplay() {
            const data = eqData[eqSelect.value];
            if (!data) return;

            eqDisplay.innerHTML = `
                <div style="font-size: 2rem; margin-bottom: 10px;">${_esc(data.icon)}</div>
                <h3 style="margin-bottom: 15px; color: var(--accent-primary);">${_esc(data.title)}</h3>
                <div style="margin-bottom: 10px;"><strong>HPF (Corte de Graves):</strong> <span style="color: var(--text-muted)">${_esc(data.hpf)}</span></div>
                <div style="margin-bottom: 10px;"><strong>Área Crítica (Mud):</strong> <span style="color: var(--warning)">${_esc(data.mud)}</span></div>
                <div style="margin-bottom: 10px;"><strong>Presença/Clareza:</strong> <span style="color: var(--success)">${_esc(data.presence)}</span></div>
                <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 0.9rem;">
                    <em>Dica: ${_esc(data.tips)}</em>
                </div>
            `;
        }

        const btnSync = _el('btn-sync-eq-ai');
        if (btnSync) {
            btnSync.onclick = () => {
                const instrument = eqSelect.options[eqSelect.selectedIndex].text;
                const channelInput = _el('ai-target-channel');
                const channel = channelInput ? channelInput.value : 1;
                
                if (window.AIService) {
                    AIService.ask(`Equalizar ${instrument} no canal ${channel}`, channel);
                }
            };
        }

        eqSelect.addEventListener('change', updateEqDisplay, { signal: _churchController.signal });
        updateEqDisplay();
    }

    function initRt60Calculator() {
        const btnCalcManual = _el('btn-calculate-rt60');
        const btnCalcFull = _el('btn-calc-rt60'); // O botão grande que não funcionava
        const btnPulse = _el('btn-trigger-pulse');
        const btnClear = _el('btn-clear-measurements');
        const btnRefreshBench = _el('btn-refresh-history');
        const rtResult = _el('rt60-result');

        if (btnPulse) {
            btnPulse.addEventListener('click', () => {
                console.log('[Acoustics] Disparando pulso de medição via Analyzer...');
                // Unifica com o motor de análise real que captura o decaimento
                if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.triggerImpulse === 'function') {
                    window.SoundMasterAnalyzer.triggerImpulse();
                } else {
                    // Fallback se o analisador não estiver pronto
                    MixerService.setOscillator(true, -10);
                    setTimeout(() => MixerService.setOscillator(false, -10), 200);
                    alert('Pulso disparado (Modo Fallback). Ative o microfone na aba Análise para captura real.');
                }
            }, { signal: _churchController.signal });
        }

        if (btnClear) {
            btnClear.addEventListener('click', () => {
                const inputs = ['rt-length', 'rt-width', 'rt-height', 'rt-delay-dist', 'rt-absorption'];
                inputs.forEach(id => {
                    const el = _el(id);
                    if (el) el.value = '';
                });
                if (rtResult) {
                    rtResult.style.display = 'none';
                    rtResult.innerHTML = '';
                }
            }, { signal: _churchController.signal });
        }

        // Handler para o Benchmarking
        if (btnRefreshBench) {
            btnRefreshBench.addEventListener('click', () => {
                if (window.SocketService) {
                    window.SocketService.emit('get_acoustic_history');
                    const emptyEl = _el('bench-empty-rt60');
                    const fullEl = _el('bench-full-rt60');
                    if (emptyEl) emptyEl.classList.add('animate-pulse');
                    if (fullEl) fullEl.classList.add('animate-pulse');
                    setTimeout(() => {
                        if (emptyEl) emptyEl.classList.remove('animate-pulse');
                        if (fullEl) fullEl.classList.remove('animate-pulse');
                    }, 1000);
                } else {
                    alert('SocketService não disponível.');
                }
            }, { signal: _churchController.signal });
        }

        _initMtkControls();

        const runCalculation = async () => {
            const length = parseFloat(_el('rt-length').value);
            const width = parseFloat(_el('rt-width').value);
            const height = parseFloat(_el('rt-height').value);
            const delayDist = parseFloat(_el('rt-delay-dist').value) || 0;
            const absorptionCoef = parseFloat(_el('rt-absorption').value);

            if (!length || !width || !height) {
                alert('Por favor, preencha as dimensões da igreja.');
                return;
            }

            const volume = length * width * height;
            const surfaceArea = (2 * length * width) + (2 * length * height) + (2 * width * height);
            
            let rt60 = 0;
            let formula = 'Sabine (Local)';
            let classification = '';

            // Tenta usar o motor Python (Eyring) se disponível
            if (window.AIService && typeof window.AIService.calculateAcoustics === 'function') {
                const aiResult = await AIService.calculateAcoustics(volume, surfaceArea, absorptionCoef);
                if (aiResult) {
                    rt60 = aiResult.rt60;
                    formula = 'Eyring (AI Engine)';
                    classification = aiResult.classification;
                }
            }

            // Fallback para Sabine local se falhar
            if (rt60 === 0) {
                const totalAbsorption = surfaceArea * absorptionCoef;
                rt60 = totalAbsorption > 0 ? 0.161 * (volume / totalAbsorption) : 0;
            }

            const delayMs = delayDist > 0 ? (delayDist / 343) * 1000 : 0;

            let statusClass = 'safe';
            let statusText = classification || 'Ideal para fala / Palavra';
            let suggestions = 'A acústica está seca e favorece a pregação. Pode faltar um pouco de calor na música, mas é o cenário mais seguro.';

            if (rt60 >= 1.6) {
                statusClass = 'danger';
                statusText = classification || 'Reverberação Excessiva';
                suggestions = 'O som pode embolar e refletir nos vidros. Reduza o volume geral, controle graves e feche cortinas acústicas.';
            } else if (rt60 >= 1.0) {
                statusClass = 'warning';
                statusText = classification || 'Aceitável para culto contemporâneo';
                suggestions = 'Bom balanço para louvor, mas a fala exige cuidado com volume, médios e articulação.';
            }

            const delayHtml = delayDist > 0 ? `
                <div class="mt-4 pt-4 border-t border-white/10">
                    <h4 class="text-xs font-bold text-cyan-400 mb-2 uppercase tracking-widest">Ajuste de Delay</h4>
                    <p class="text-xs text-slate-400">Configure o delay de saída na Ui24R para as caixas auxiliares em:</p>
                    <p class="text-xl font-black text-amber-400 mt-1">${delayMs.toFixed(1)} ms</p>
                </div>
            ` : '';

            rtResult.classList.remove('hidden');
            rtResult.className = `card alert-card mt-15 p-6 rounded-2xl border ${statusClass === 'danger' ? 'border-red-500/30 bg-red-900/20' : (statusClass === 'warning' ? 'border-amber-500/30 bg-amber-900/20' : 'border-cyan-500/30 bg-cyan-900/20')}`;
            rtResult.innerHTML = `
                <div class="flex justify-between text-[10px] uppercase font-black text-slate-500 mb-4 tracking-tighter">
                    <span>Volume: ${Math.round(volume)}m³</span>
                    <span>Fórmula: ${_esc(formula)}</span>
                </div>
                <h3 class="text-2xl font-black text-white">RT60: ${rt60.toFixed(2)} seg</h3>
                <p class="text-sm font-bold mt-2 ${statusClass === 'safe' ? 'text-green-400' : (statusClass === 'warning' ? 'text-amber-400' : 'text-red-400')}">${_esc(statusText)}</p>
                <p class="text-xs text-slate-300 mt-2 leading-relaxed">${_esc(suggestions)}</p>
                ${delayHtml}
            `;

            // Atualizar Mapa Visual
            const mappingContainer = _el('mapping-container');
            if (mappingContainer) {
                mappingContainer.classList.remove('hidden');
                // Pequeno delay para garantir que o DOM renderizou e o width não seja 0
                setTimeout(() => {
                    if (window.SoundMasterMapping) {
                        window.SoundMasterMapping.updateDimensions(width, length);
                    }
                }, 150);
            }
        };

        if (btnCalcManual) btnCalcManual.addEventListener('click', runCalculation, { signal: _churchController.signal });
        if (btnCalcFull) btnCalcFull.addEventListener('click', runCalculation, { signal: _churchController.signal });
    }

    function initBenchmarking() {
        console.log('[Benchmarking] Inicializando lógica de comparação...');
        const btnRefresh = _el('btn-refresh-history');
        if (!btnRefresh) return;

        // Registrar listener para dados reais (apenas uma vez)
        if (window.SocketService && !window._benchmarkingListenerSet) {
            _acousticHandler = (data) => {
                const emptyEl = _el('bench-empty-rt60');
                const fullEl = _el('bench-full-rt60');
                
                if (emptyEl) {
                    const val = data.benchmark?.empty?.rt60 || 0;
                    emptyEl.innerText = val > 0 ? `${val.toFixed(2)}s` : 'Sem dados';
                }
                if (fullEl) {
                    const val = data.benchmark?.full?.rt60 || 0;
                    fullEl.innerText = val > 0 ? `${val.toFixed(2)}s` : 'Sem dados';
                }
                AppStore.addLog('Benchmarking atualizado via histórico acústico real.');
            };
            window.SocketService.on('acoustic_history_data', _acousticHandler);
            window._benchmarkingListenerSet = true;
        }

        btnRefresh.onclick = () => {
            if (window.SocketService) {
                window.SocketService.emit('get_acoustic_history');
                
                const emptyEl = _el('bench-empty-rt60');
                const fullEl = _el('bench-full-rt60');
                if (emptyEl) emptyEl.classList.add('animate-pulse');
                if (fullEl) fullEl.classList.add('animate-pulse');
                
                setTimeout(() => {
                    if (emptyEl) emptyEl.classList.remove('animate-pulse');
                    if (fullEl) fullEl.classList.remove('animate-pulse');
                }, 1000);
            } else {
                alert('SocketService não disponível.');
            }
        };
    }

    function init() {
        console.log('[SoundMasterChurchTools] Inativo - Lógica delegada aos módulos de página.');
    }

    window.SoundMasterChurchTools = { init };

    function _initMtkControls() {
        const btnRec = _el('btn-rt-rec-mtk');
        const btnStop = _el('btn-rt-stop-mtk');
        const recDot = _el('rt-rec-dot');
        const recText = _el('rt-rec-text');

        if (!btnRec || !btnStop) return;

        const updateStatusUI = (isRecording) => {
            if (isRecording) {
                recDot?.classList.remove('bg-slate-500');
                recDot?.classList.add('bg-rose-500');
                if (recText) recText.innerText = 'GRAVANDO MTK';
                recText?.classList.remove('text-slate-500');
                recText?.classList.add('text-rose-500');
                btnRec.classList.add('opacity-50', 'pointer-events-none');
                btnStop.classList.remove('cursor-not-allowed', 'text-slate-500');
                btnStop.classList.add('bg-slate-700', 'text-white');
                btnStop.disabled = false;
            } else {
                recDot?.classList.remove('bg-rose-500');
                recDot?.classList.add('bg-slate-500');
                if (recText) recText.innerText = 'OFFLINE';
                recText?.classList.remove('text-rose-500');
                recText?.classList.add('text-slate-500');
                btnRec.classList.remove('opacity-50', 'pointer-events-none');
                btnStop.classList.add('cursor-not-allowed', 'text-slate-500');
                btnStop.classList.remove('bg-slate-700', 'text-white');
                btnStop.disabled = true;
            }
        };

        btnRec.onclick = () => {
            MixerService.mtkControl('start');
            updateStatusUI(true);
            AppStore.addLog('MTK: Gravação de Multitrack iniciada para Soundcheck Virtual.');
        };

        btnStop.onclick = () => {
            MixerService.mtkControl('stop');
            updateStatusUI(false);
            AppStore.addLog('MTK: Gravação de Multitrack finalizada.');
        };

        if (_mtkUnsub) _mtkUnsub();
        _mtkUnsub = AppStore.subscribe('isRecordingMTK', (isRec) => updateStatusUI(isRec));
    }

    function destroy() {
        if (_churchController) _churchController.abort();
        _churchController = new AbortController();
        if (_mtkUnsub) { _mtkUnsub(); _mtkUnsub = null; }
        if (_acousticHandler && window.SocketService) {
            window.SocketService.off('acoustic_history_data', _acousticHandler);
            _acousticHandler = null;
        }
        window._benchmarkingListenerSet = false;
    }

    window.SoundMasterChurchTools.destroy = destroy;
})();
