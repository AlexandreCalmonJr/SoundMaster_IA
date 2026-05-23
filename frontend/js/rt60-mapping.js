/**
 * SoundMaster Pro - RT60 Mapping & Multi-point Calibration
 * Permite criar mapas de calor de reverberação e perfis de EQ baseados em múltiplas posições.
 */
(function() {

    function _el(id) {
        if (window.self !== window.top) {
            return document.getElementById(id);
        }
        const iframe = document.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }
    'use strict';

    let mappingPoints = [];
    let currentProfile = null;
    let profiles = {};
    let bgImage = null;
    let canvas = null;
    let ctx = null;
    let isActive = false;

    const RT60_COLORS = {
        good: { min: 0, max: 1.4, color: [34, 197, 94], label: 'Ótimo' },
        fair: { min: 1.4, max: 1.8, color: [234, 179, 8], label: 'Aceitável' },
        poor: { min: 1.8, max: 2.5, color: [249, 115, 22], label: 'Longo' },
        bad: { min: 2.5, max: Infinity, color: [239, 68, 68], label: 'Crítico' }
    };

    function init() {
        const container = _el('mapping-container');
        if (!container) return;
        
        container.classList.remove('hidden');
        
        canvas = _el('mapping-canvas');
        if (!canvas) return;
        
        ctx = canvas.getContext('2d');
        
        setupEventListeners();
        loadSavedData();
        loadProfilesFromStorage();
        resizeCanvas();
        
        window.removeEventListener('resize', resizeCanvas);
        window.addEventListener('resize', resizeCanvas);
        
        console.log('[RT60-Mapping] Módulo inicializado');
    }

    function setupEventListeners() {
        const inputFloorplan = _el('input-floorplan');
        const btnImport = _el('btn-import-floorplan');
        const btnClear = _el('btn-clear-mapping');
        const btnExport = _el('btn-export-mapping');

        if (btnImport && inputFloorplan) {
            btnImport.addEventListener('click', () => inputFloorplan.click());
            inputFloorplan.addEventListener('change', handleFloorplanUpload);
        }
        
        btnClear?.addEventListener('click', clearMapping);
        btnExport?.addEventListener('click', exportMapping);
        
        canvas?.addEventListener('click', handleCanvasClick);
    }

    function resizeCanvas() {
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx?.scale(dpr, dpr);
        render();
    }

    function handleFloorplanUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (ev) => {
            bgImage = new Image();
            bgImage.onload = () => {
                saveToStorage();
                render();
            };
            bgImage.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    function handleCanvasClick(e) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        
        const analyzer = window.SoundMasterAnalyzer;
        const lastRT60 = analyzer?.getLastRt60 ? analyzer.getLastRt60() : null;
        
        let rt60Val = 1.5;
        let c50 = 0, c80 = 0, d50 = 50, sti = 0.6;
        let hasValidMeasurement = false;
        
        if (lastRT60 && lastRT60.rt60) {
            rt60Val = lastRT60.rt60 || lastRT60.rt60_est || 1.5;
            c50 = lastRT60.c50 || 0;
            c80 = lastRT60.c80 || 0;
            d50 = lastRT60.d50 || 50;
            sti = lastRT60.sti || 0.6;
            hasValidMeasurement = true;
        }

        // Se não tem medição válida, usa valor manual ou alerta
        if (!hasValidMeasurement) {
            const manualRT60 = prompt('Sem medição RT60 recente. Digite o RT60 manual (ex: 1.5):', '1.5');
            if (!manualRT60 || isNaN(parseFloat(manualRT60))) {
                console.log('[RT60-Mapping] Ponto cancelado - sem medição válida');
                return;
            }
            rt60Val = parseFloat(manualRT60);
        }

        const point = {
            x, y,
            rt60: rt60Val,
            c50, c80, d50, sti,
            timestamp: new Date().toISOString(),
            id: Date.now(),
            hasMeasurement: hasValidMeasurement
        };
        
        mappingPoints.push(point);
        saveToStorage();
        render();
        
        // Feedback visual
        showToast(`Ponto adicionado: RT60 = ${rt60Val.toFixed(2)}s`, 'success');
        console.log('[RT60-Mapping] Ponto adicionado:', point);
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm font-bold shadow-xl z-50 ${
            type === 'success' ? 'bg-emerald-600 text-white' : 'bg-cyan-600 text-white'
        }`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function getColorForRT60(rt60) {
        for (const [key, data] of Object.entries(RT60_COLORS)) {
            if (rt60 >= data.min && rt60 < data.max) {
                return `rgb(${data.color.join(',')})`;
            }
        }
        return 'rgb(239, 68, 68)';
    }

    function interpolateColors(x, y, radius) {
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);
        
        let r = 0, g = 0, b = 0, count = 0;
        
        for (const p of mappingPoints) {
            const dist = Math.sqrt(Math.pow((p.x - x) * w, 2) + Math.pow((p.y - y) * h, 2));
            if (dist < radius) {
                const weight = 1 - (dist / radius);
                const color = getColorForRT60(p.rt60).match(/\d+/g).map(Number);
                r += color[0] * weight;
                g += color[1] * weight;
                b += color[2] * weight;
                count += weight;
            }
        }
        
        if (count === 0) return 'rgba(30, 41, 59, 0.5)';
        return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }

    function render() {
        if (!ctx || !canvas) return;
        
        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);
        
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, w, h);
        
        if (bgImage) {
            ctx.globalAlpha = 0.3;
            ctx.drawImage(bgImage, 0, 0, w, h);
            ctx.globalAlpha = 1;
        }
        
        if (mappingPoints.length > 0) {
            const radius = Math.max(w, h) * 0.15;
            
            for (let py = 0; py < h; py += 4) {
                for (let px = 0; px < w; px += 4) {
                    const x = px / w;
                    const y = py / h;
                    ctx.fillStyle = interpolateColors(x, y, radius);
                    ctx.fillRect(px, py, 4, 4);
                }
            }
        }
        
        for (const p of mappingPoints) {
            const px = p.x * w;
            const py = p.y * h;
            
            ctx.beginPath();
            ctx.arc(px, py, 8, 0, Math.PI * 2);
            ctx.fillStyle = getColorForRT60(p.rt60);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.rt60.toFixed(1), px, py);
        }
        
        if (mappingPoints.length > 0) {
            const avgRT60 = mappingPoints.reduce((s, p) => s + p.rt60, 0) / mappingPoints.length;
            const avgC50 = mappingPoints.reduce((s, p) => s + (p.c50 || 0), 0) / mappingPoints.length;
            const avgD50 = mappingPoints.reduce((s, p) => s + (p.d50 || 50), 0) / mappingPoints.length;
            const avgSTI = mappingPoints.reduce((s, p) => s + (p.sti || 0.6), 0) / mappingPoints.length;
            
            updateMappingStats(avgRT60, avgC50, avgD50, avgSTI);
        }
    }

    function updateMappingStats(avgRT60, avgC50, avgD50, avgSTI) {
        const container = document.querySelector('#mapping-container > div');
        let statsEl = _el('mapping-stats');
        
        if (!statsEl && container) {
            statsEl = document.createElement('div');
            statsEl.id = 'mapping-stats';
            container.appendChild(statsEl);
        }
        
        if (statsEl) {
            statsEl.className = 'grid grid-cols-4 gap-2 mt-4 p-3 bg-black/30 rounded-lg';
            statsEl.innerHTML = `
                <div class="text-center"><div class="text-[8px] text-slate-500">Média RT60</div><div class="text-sm font-bold text-cyan-400">${avgRT60.toFixed(2)}s</div></div>
                <div class="text-center"><div class="text-[8px] text-slate-500">Média C50</div><div class="text-sm font-bold text-amber-400">${avgC50.toFixed(1)} dB</div></div>
                <div class="text-center"><div class="text-[8px] text-slate-500">Média D50</div><div class="text-sm font-bold text-emerald-400">${avgD50.toFixed(0)}%</div></div>
                <div class="text-center"><div class="text-[8px] text-slate-500">Média STI</div><div class="text-sm font-bold text-rose-400">${avgSTI.toFixed(2)}</div></div>
            `;
        }
        
        // Adiciona botão de criar perfil de calibração
        let profileBtn = _el('btn-create-calibration-profile');
        if (!profileBtn && mappingPoints.length >= 1) {
            profileBtn = document.createElement('button');
            profileBtn.id = 'btn-create-calibration-profile';
            profileBtn.className = 'mt-3 w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all';
            profileBtn.innerHTML = '🔧 Criar Perfil de Calibração (Média Espacial)';
            profileBtn.onclick = () => createCalibrationProfileFromMap();
            if (container) container.appendChild(profileBtn);
        }
    }
    
    function createCalibrationProfileFromMap() {
        if (mappingPoints.length === 0) {
            alert('Adicione pontos ao mapa primeiro.');
            return;
        }
        
        const profile = getAverageProfile();
        if (!profile) return;
        
        const profileName = prompt('Nome do perfil de calibração:', `Perfil ${Object.keys(profiles).length + 1}`);
        if (!profileName) return;
        
        // Tenta usar Auto-EQ para correções baseadas em medição real
        const autoCorrections = _generateAutoEQCorrections(profile);
        
        let corrections;
        let source;
        
        if (autoCorrections.length > 0) {
            corrections = autoCorrections;
            source = 'Auto-EQ';
        } else {
            // Fallback: correções heurísticas com reason
            corrections = [];
            
            if (profile.rt60 > 1.6) {
                corrections.push({ type: 'highpass', freq: 80, gain: -3, reason: 'RT60 longo - reduz graves', source: 'heuristic' });
                corrections.push({ type: 'peaking', freq: 250, gain: -2, q: 1, reason: 'RT60 longo - reduz graves medios', source: 'heuristic' });
            } else if (profile.rt60 < 1.2) {
                corrections.push({ type: 'peaking', freq: 200, gain: 2, q: 0.7, reason: 'RT60 curto - reforça graves', source: 'heuristic' });
            }
            
            if (profile.d50 < 40) {
                corrections.push({ type: 'peaking', freq: 2000, gain: -2, q: 2, reason: 'D50 baixo - reduz Medios agudos', source: 'heuristic' });
                corrections.push({ type: 'peaking', freq: 4000, gain: -1, q: 1.5, reason: 'D50 baixo - reduz agudos', source: 'heuristic' });
            } else if (profile.d50 > 60) {
                corrections.push({ type: 'peaking', freq: 3000, gain: 1, q: 1, reason: 'D50 alto - reforça presença', source: 'heuristic' });
            }
            
            if (profile.c50 < -2) {
                corrections.push({ type: 'peaking', freq: 1000, gain: -1.5, q: 1, reason: 'C50 baixo - clarity melhorada', source: 'heuristic' });
            } else if (profile.c50 > 2) {
                corrections.push({ type: 'peaking', freq: 3000, gain: 1.5, q: 1, reason: 'C50 alto - Clareza excelente', source: 'heuristic' });
            }
            source = 'Heurístico';
        }
        
        profiles[profileName] = {
            ...profile,
            corrections,
            createdAt: new Date().toISOString(),
            points: mappingPoints.length,
            source
        };
        
        showToast(`Perfil "${profileName}" criado com ${corrections.length} correções (${source})`, 'success');
        console.log('[RT60-Mapping] Perfil criado:', profileName, source, corrections);
        
        // Salva perfis no storage
        saveProfilesToStorage();
        
        // Atualiza UI de perfis
        updateProfilesList();
    }
    
    function saveProfilesToStorage() {
        try {
            localStorage.setItem('rt60_calibration_profiles', JSON.stringify(profiles));
        } catch(e) {
            console.warn('[RT60-Mapping] Failed to save profiles:', e);
        }
    }
    
    function loadProfilesFromStorage() {
        try {
            const saved = localStorage.getItem('rt60_calibration_profiles');
            if (saved) {
                profiles = JSON.parse(saved);
                updateProfilesList();
            }
        } catch(e) {
            console.warn('[RT60-Mapping] Failed to load profiles:', e);
        }
    }
    
    function updateProfilesList() {
        const container = document.querySelector('#mapping-container > div');
        let listEl = _el('calibration-profiles-list');
        
        if (!listEl && Object.keys(profiles).length > 0) {
            listEl = document.createElement('div');
            listEl.id = 'calibration-profiles-list';
            listEl.className = 'mt-4 p-3 bg-slate-900/50 rounded-lg';
            listEl.innerHTML = '<div class="text-[10px] text-slate-500 uppercase font-bold mb-2">Perfis de Calibração Salvos</div>';
            if (container) container.appendChild(listEl);
        }
        
        if (listEl) {
            let html = '<div class="text-[10px] text-slate-500 uppercase font-bold mb-2">Perfis de Calibração Salvos</div>';
            for (const [name, profile] of Object.entries(profiles)) {
                html += `
                    <div class="flex items-center justify-between bg-black/30 p-2 rounded mb-1">
                        <div>
                            <div class="text-xs font-bold text-white">${name}</div>
                            <div class="text-[9px] text-slate-500">RT60: ${profile.rt60.toFixed(2)}s | ${profile.points} pts</div>
                        </div>
                        <div class="flex gap-1">
                            <button class="text-[9px] px-2 py-1 bg-emerald-600 rounded text-white" onclick="RT60Mapping.applyProfile('${name}')">Apply</button>
                            <button class="text-[9px] px-2 py-1 bg-red-600 rounded text-white" onclick="RT60Mapping.deleteProfile('${name}')">X</button>
                        </div>
                    </div>
                `;
            }
            listEl.innerHTML = html;
        }
    }
    
    function applyProfile(name) {
        const profile = profiles[name];
        if (!profile) return;
        
        console.log('[RT60-Mapping] Aplicando perfil:', name, profile.corrections);
        
        // Dispara evento para sistema de EQ aplicar as correções
        document.dispatchEvent(new CustomEvent('apply-calibration-profile', {
            detail: {
                name: name,
                corrections: profile.corrections,
                metrics: {
                    rt60: profile.rt60,
                    c50: profile.c50,
                    d50: profile.d50,
                    sti: profile.sti
                }
            }
        }));
        
        showToast(`Perfil "${name}" aplicado ao sistema de EQ`, 'success');
    }
    
    function deleteProfile(name) {
        if (confirm(`Excluir perfil "${name}"?`)) {
            delete profiles[name];
            saveProfilesToStorage();
            updateProfilesList();
            showToast(`Perfil "${name}" excluído`, 'info');
        }
    }

    function clearMapping() {
        if (confirm('Limpar todos os pontos do mapa de RT60?')) {
            mappingPoints = [];
            saveToStorage();
            render();
            const statsEl = _el('mapping-stats');
            if (statsEl) statsEl.remove();
        }
    }

    function exportMapping() {
        const data = {
            points: mappingPoints,
            bgImage: bgImage?.src?.substring(0, 100) + '...',
            exportedAt: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SoundMaster_RT60_Map_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function saveToStorage() {
        try {
            const simplified = mappingPoints.map(p => ({
                x: p.x, y: p.y, rt60: p.rt60, c50: p.c50, c80: p.c80, d50: p.d50, sti: p.sti, id: p.id
            }));
            localStorage.setItem('rt60_mapping_points', JSON.stringify(simplified));
        } catch(e) {
            console.warn('[RT60-Mapping] Storage save failed:', e);
        }
    }

    function loadSavedData() {
        try {
            const saved = localStorage.getItem('rt60_mapping_points');
            if (saved) {
                mappingPoints = JSON.parse(saved);
            }
        } catch(e) {
            console.warn('[RT60-Mapping] Storage load failed:', e);
        }
    }

    function getAverageProfile() {
        if (mappingPoints.length === 0) return null;
        
        return {
            rt60: mappingPoints.reduce((s, p) => s + p.rt60, 0) / mappingPoints.length,
            c50: mappingPoints.reduce((s, p) => s + (p.c50 || 0), 0) / mappingPoints.length,
            c80: mappingPoints.reduce((s, p) => s + (p.c80 || 0), 0) / mappingPoints.length,
            d50: mappingPoints.reduce((s, p) => s + (p.d50 || 50), 0) / mappingPoints.length,
            sti: mappingPoints.reduce((s, p) => s + (p.sti || 0.6), 0) / mappingPoints.length,
            points: mappingPoints.length
        };
    }

    function createCorrectionProfile(name = 'default') {
        const profile = getAverageProfile();
        if (!profile) return null;
        
        // Tenta usar Auto-EQ para correções baseadas em medição real
        const autoCorrections = _generateAutoEQCorrections(profile);
        
        if (autoCorrections.length > 0) {
            console.log('[RT60-Mapping] Usando correções Auto-EQ:', autoCorrections);
            return _saveProfile(name, profile, autoCorrections);
        }
        
        // Fallback: correções heurísticas
        const corrections = [];
        
        if (profile.rt60 > 1.6) {
            corrections.push({ type: 'highpass', freq: 80, gain: -3, source: 'heuristic' });
            corrections.push({ type: 'peaking', freq: 250, gain: -2, q: 1, source: 'heuristic' });
        } else if (profile.rt60 < 1.2) {
            corrections.push({ type: 'peaking', freq: 200, gain: 2, q: 0.7, source: 'heuristic' });
        }
        
        if (profile.d50 < 40) {
            corrections.push({ type: 'peaking', freq: 2000, gain: -2, q: 2, source: 'heuristic' });
            corrections.push({ type: 'peaking', freq: 4000, gain: -1, q: 1.5, source: 'heuristic' });
        }
        
        if (profile.c50 < -2) {
            corrections.push({ type: 'peaking', freq: 1000, gain: -1.5, q: 1 });
        } else if (profile.c50 > 2) {
            corrections.push({ type: 'peaking', freq: 3000, gain: 1.5, q: 1 });
        }
        
        profiles[name] = {
            ...profile,
            corrections,
            createdAt: new Date().toISOString()
        };
        
        console.log('[RT60-Mapping] Perfil criado:', name, corrections);
        return profiles[name];
    }

    /**
     * Gera correções usando o Auto-EQ service.
     * Integração recomendada pelo relatório de auditoria técnica.
     * Usa curvas alvo baseadas no perfil RT60 da sala.
     */
    function _generateAutoEQCorrections(profile) {
        if (!window.AutoEQ) {
            console.warn('[RT60-Mapping] Auto-EQ não disponível');
            return [];
        }

        // Determina a curva alvo baseada no tipo de sala/perfil
        let targetCurve = 'smaart';
        if (profile.rt60 > 2.0) {
            targetCurve = 'tilt'; // Sala reverberante: curva mais atenuada em agudos
        } else if (profile.rt60 < 1.0) {
            targetCurve = 'presence'; // Sala seca: curva com presença
        }

        try {
            window.AutoEQ.setTarget(targetCurve);
            
            // Tenta obter o espectro atual do analyzer
            const analyzer = window.SoundMasterAnalyzer;
            const freqData = analyzer?.getLastSpectrum?.();
            
            if (freqData && freqData.length > 0) {
                const sr = analyzer?.sampleRate || 48000;
                const fftSize = analyzer?.fftSize || 2048;
                
                const result = window.AutoEQ.analyze(freqData, sr, fftSize);
                
                if (result && result.peq && result.peq.length > 0) {
                    // Converte resultado do Auto-EQ para formato de correções
                    return result.peq.map(band => ({
                        type: 'peaking',
                        freq: band.freq,
                        gain: -band.gain, // Inverte para correção
                        q: band.q || 1,
                        source: 'auto-eq',
                        targetCurve
                    }));
                }
            }
        } catch (e) {
            console.warn('[RT60-Mapping] Auto-EQ analysis failed:', e);
        }

        return [];
    }

    /**
     * Salva o perfil de calibração com correções.
     */
    function _saveProfile(name, profile, corrections) {
        profiles[name] = {
            ...profile,
            corrections,
            createdAt: new Date().toISOString()
        };
        
        saveProfilesToStorage();
        console.log('[RT60-Mapping] Perfil salvo:', name, corrections);
        
        return profiles[name];
    }

    function getProfiles() {
        return profiles;
    }

    function deleteProfile(name) {
        delete profiles[name];
    }

    function getCanvasForExport() {
        return canvas;
    }

    function setActive(active) {
        isActive = active;
        if (canvas) {
            canvas.style.cursor = active ? 'crosshair' : 'default';
        }
    }

    document.addEventListener('page-loaded', (e) => {
        if (e.detail.pageId === 'acustica') {
            setTimeout(init, 300);
        }
    });

    window.RT60Mapping = {
        init,
        getAverageProfile,
        createCorrectionProfile,
        getProfiles,
        applyProfile,
        deleteProfile,
        getCanvasForExport,
        setActive,
        clearMapping,
        exportMapping,
        getPoints: () => mappingPoints
    };
})();