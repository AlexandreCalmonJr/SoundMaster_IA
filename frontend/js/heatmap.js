(function() {

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

    let points = [];
    let bgImageSrc = null;
    let persistedHeatmapId = null;
    
    // Isolinhas e Régua
    let scaleMetersPerPixel = 0.5;
    let showIsolines = true;
    let rulerMode = false;
    let rulerStart = null;
    let rulerEnd = null;
    let isDragging = false;
    const ISO_LEVELS = [75, 80, 85, 90, 95, 100, 105];

    let _heatmapInitialized = false;

    function handleSocketUpdate(data) {
        if (data.snapshot && data.snapshot.points) points = data.snapshot.points;
        else if (data.points) points = data.points;
        if (data.bgImageSrc) {
            bgImageSrc = data.bgImageSrc;
            showImage();
        }
        if (data.snapshot && data.snapshot.bgImageSrc) {
            bgImageSrc = data.snapshot.bgImageSrc;
            showImage();
        }
        if (data._id) {
            persistedHeatmapId = data._id;
            localStorage.setItem('heatmap_snapshot_id', persistedHeatmapId);
        }
        renderHeatmap();
        renderPins();
    }

    function destroyHeatmap() {
        if (!_heatmapInitialized) return;
        _heatmapInitialized = false;

        const socket = window.SocketService?.raw();
        if (socket) {
            socket.off('heatmap_updated', handleSocketUpdate);
        }

        const upload = _el('heatmap-image-upload');
        const btnUpload = _el('btn-heatmap-upload');
        const container = _el('heatmap-container');
        const btnClear = _el('btn-clear-heatmap');

        if (upload) upload.removeEventListener('change', handleImageUpload);
        if (btnUpload) btnUpload.onclick = null;
        if (container) {
            container.onclick = null;
            container.onmousedown = null;
            container.onmousemove = null;
            container.onmouseup = null;
        }
        if (btnClear) btnClear.onclick = null;
    }

    function initHeatmap() {
        if (_heatmapInitialized) return;
        _heatmapInitialized = true;

        const upload = _el('heatmap-image-upload');
        const btnUpload = _el('btn-heatmap-upload');
        const container = _el('heatmap-container');
        const btnClear = _el('btn-clear-heatmap');
        
        if(btnUpload && upload) btnUpload.onclick = () => upload.click();
        if(upload) upload.addEventListener('change', handleImageUpload);
        if(container) {
            container.onclick = handleContainerClick;
            // Régua: mouse events
            container.onmousedown = handleRulerStart;
            container.onmousemove = handleRulerMove;
            container.onmouseup = handleRulerEnd;
        }
        if(btnClear) btnClear.onclick = clearHeatmap;
        
        loadSettings();
        
        const savedImg = localStorage.getItem('heatmap_bg');
        if(savedImg) {
            bgImageSrc = savedImg;
            showImage();
        }
        const savedPoints = localStorage.getItem('heatmap_points');
        if(savedPoints) {
            points = JSON.parse(savedPoints);
            // Dá um tempo pro DOM renderizar o tamanho do container
            setTimeout(() => {
                renderHeatmap();
                renderPins();
            }, 300);
        }
        const savedHeatmapId = localStorage.getItem('heatmap_snapshot_id');
        if (savedHeatmapId) {
            persistedHeatmapId = savedHeatmapId;
        }

        // ✅ Novo: Sincronização em tempo real via Socket
        if (window.SocketService) {
            window.SocketService.on('heatmap_updated', handleSocketUpdate);
        }
        
        // Adicionar controles de isocinias e régua
        addHeatmapControls();
    }
    
    function loadSettings() {
        const savedScale = localStorage.getItem('heatmap_scale');
        if (savedScale) scaleMetersPerPixel = parseFloat(savedScale);
        
        const savedIsolines = localStorage.getItem('heatmap_isolines');
        showIsolines = savedIsolines !== 'false';
    }
    
    function addHeatmapControls() {
        const container = _el('heatmap-container');
        if (!container) return;
        
        // Barra de controles inferior
        let controlsBar = _el('heatmap-controls');
        if (!controlsBar) {
            controlsBar = document.createElement('div');
            controlsBar.id = 'heatmap-controls';
            controlsBar.className = 'absolute bottom-2 left-2 right-2 flex justify-center gap-2 z-20';
            container.appendChild(controlsBar);
        }
        
        // Toggle isocinias
        let btnIsolines = _el('btn-toggle-isolines');
        if (!btnIsolines) {
            btnIsolines = document.createElement('button');
            btnIsolines.id = 'btn-toggle-isolines';
            btnIsolines.className = 'px-2 py-1 bg-slate-800/80 hover:bg-slate-700 rounded text-[10px] font-bold text-white';
            btnIsolines.innerHTML = showIsolines ? '🔳 Isolinhas' : '🔳 Isolinhas';
            btnIsolines.onclick = () => {
                showIsolines = !showIsolines;
                localStorage.setItem('heatmap_isolines', showIsolines);
                btnIsolines.classList.toggle('opacity-50', !showIsolines);
                renderHeatmap();
            };
            btnIsolines.classList.toggle('opacity-50', !showIsolines);
            controlsBar.appendChild(btnIsolines);
        }
        
        // Botão Régua
        let btnRuler = _el('btn-toggle-ruler');
        if (!btnRuler) {
            btnRuler = document.createElement('button');
            btnRuler.id = 'btn-toggle-ruler';
            btnRuler.className = 'px-2 py-1 bg-slate-800/80 hover:bg-slate-700 rounded text-[10px] font-bold text-white';
            btnRuler.innerHTML = '📏 Régua';
            btnRuler.onclick = () => {
                rulerMode = !rulerMode;
                btnRuler.classList.toggle('bg-cyan-600', rulerMode);
                btnRuler.classList.toggle('bg-slate-800', !rulerMode);
                container.style.cursor = rulerMode ? 'crosshair' : 'default';
                if (!rulerMode) {
                    rulerStart = null;
                    rulerEnd = null;
                    renderHeatmap();
                }
            };
            controlsBar.appendChild(btnRuler);
        }
        
        // Botão Calibrar Escala
        let btnCalibrate = _el('btn-calibrate-scale');
        if (!btnCalibrate) {
            btnCalibrate = document.createElement('button');
            btnCalibrate.id = 'btn-calibrate-scale';
            btnCalibrate.className = 'px-2 py-1 bg-slate-800/80 hover:bg-slate-700 rounded text-[10px] font-bold text-white';
            btnCalibrate.innerHTML = '⚙️ Escala';
            btnCalibrate.onclick = () => {
                const input = prompt('Digite a escala (metros por % da tela):\nEx: 20 significa que 100% da largura = 20 metros', scaleMetersPerPixel * 100);
                if (input) {
                    scaleMetersPerPixel = parseFloat(input) / 100;
                    localStorage.setItem('heatmap_scale', scaleMetersPerPixel);
                    showToast(`Escala: 1px = ${(scaleMetersPerPixel * 100).toFixed(1)}cm`, 'success');
                }
            };
            controlsBar.appendChild(btnCalibrate);
        }
    }
    
    function handleRulerStart(e) {
        if (!rulerMode) return;
        const container = _el('heatmap-container');
        const rect = container.getBoundingClientRect();
        rulerStart = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
        isDragging = true;
    }
    
    function handleRulerMove(e) {
        if (!rulerMode || !isDragging || !rulerStart) return;
        const container = _el('heatmap-container');
        const rect = container.getBoundingClientRect();
        rulerEnd = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
        renderHeatmap();
        renderRulerLine();
    }
    
    function handleRulerEnd(e) {
        if (!rulerMode || !isDragging) return;
        isDragging = false;
        if (rulerStart && rulerEnd) {
            showRulerResult();
        }
    }
    
    function showRulerResult() {
        const container = _el('heatmap-container');
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        const dx = (rulerEnd.x - rulerStart.x) * width;
        const dy = (rulerEnd.y - rulerStart.y) * height;
        const pixelDist = Math.sqrt(dx * dx + dy * dy);
        const metersDist = pixelDist * scaleMetersPerPixel;
        
        showToast(`Distância: ${metersDist.toFixed(2)}m (${pixelDist.toFixed(0)}px)`, 'info');
    }
    
    function renderRulerLine() {
        if (!rulerStart || !rulerEnd) return;
        
        const canvas = _el('heatmap-canvas');
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;
        
        const w = canvas.width;
        const h = canvas.height;
        
        ctx.save();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 4]);
        
        ctx.beginPath();
        ctx.moveTo(rulerStart.x * w, rulerStart.y * h);
        ctx.lineTo(rulerEnd.x * w, rulerEnd.y * h);
        ctx.stroke();
        
        // Marcadores de início e fim
        ctx.setLineDash([]);
        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.arc(rulerStart.x * w, rulerStart.y * h, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rulerEnd.x * w, rulerEnd.y * h, 6, 0, Math.PI * 2);
        ctx.fill();
        
        // Label de distância
        const midX = ((rulerStart.x + rulerEnd.x) / 2) * w;
        const midY = ((rulerStart.y + rulerEnd.y) / 2) * h;
        
        const dx = (rulerEnd.x - rulerStart.x) * canvas.width;
        const dy = (rulerEnd.y - rulerStart.y) * canvas.height;
        const pixelDist = Math.sqrt(dx * dx + dy * dy);
        const metersDist = pixelDist * scaleMetersPerPixel;
        
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(midX - 30, midY - 12, 60, 20);
        ctx.fillStyle = '#22d3ee';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${metersDist.toFixed(1)}m`, midX, midY + 4);
        
        ctx.restore();
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

    function _getMeasurementMetadata(db) {
        const analyzer = window.SoundMasterAnalyzer;
        const analysis = analyzer && analyzer.hasAnalysis && analyzer.hasAnalysis() ? analyzer.getLastAnalysis() : null;
        const rt60 = analyzer && analyzer.getLastRt60 ? analyzer.getLastRt60() : null;
        return {
            schema_version: '1.1',
            type: 'heatmap',
            measurementType: 'spl-heatmap',
            summary: analysis ? analysis.text : 'Ponto SPL do mapa de calor',
            peakHz: analysis?.details?.peakHz ?? null,
            peakDb: analysis?.details?.peakDb ?? null,
            rms: analysis?.details?.rmsDb ?? null,
            spl: db,
            spectrum_db: analysis?.details?.spectrum_v11 || {},
            rt60: rt60?.rt60 ? Number(rt60.rt60) : null,
            rt60_multiband: rt60?.multiband || null
        };
    }

    function _persistHeatmap() {
        if (window.SocketService) {
            window.SocketService.emit('save_heatmap_snapshot', {
                _id: persistedHeatmapId,
                bgImageSrc,
                points,
                snapshot: {
                    bgImageSrc,
                    points,
                    ..._getMeasurementMetadata(points.length ? points[points.length - 1].db : null)
                }
            });
        }
    }

    function handleImageUpload(e) {
        const file = e.target.files[0];
        if(!file) return;
        
        // Alerta sobre limite do localStorage (~5MB total, reservamos 2MB para a imagem)
        if (file.size > 2 * 1024 * 1024) {
            alert('Aviso: Imagens maiores que 2MB podem não ser salvas permanentemente devido ao limite do navegador. O mapa funcionará, mas você precisará carregar a imagem novamente ao reiniciar.');
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
            bgImageSrc = ev.target.result;
            try {
                localStorage.setItem('heatmap_bg', bgImageSrc);
                _persistHeatmap();
            } catch(e) {
                console.warn('Imagem muito grande para o localStorage. Mantendo em memória temporária.');
            }
            showImage();
        };
        reader.readAsDataURL(file);
    }

    function showImage() {
        const img = _el('heatmap-bg');
        const placeholder = _el('heatmap-placeholder');
        if(img && bgImageSrc) {
            img.src = bgImageSrc;
            img.classList.remove('hidden');
            if(placeholder) placeholder.classList.add('hidden');
        }
    }

    function clearHeatmap() {
        if(confirm('Tem certeza que deseja apagar todos os pontos de medição?')) {
            points = [];
            localStorage.removeItem('heatmap_points');
            _persistHeatmap();
            renderHeatmap();
            renderPins();
            _el('heatmap-last-val').innerText = '-- dB';
        }
    }

    function handleContainerClick(e) {
        if(e.target.classList.contains('heatmap-pin')) return;

        const container = _el('heatmap-container');
        const rect = container.getBoundingClientRect();
        
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;

        let db = 75; 
        if (window.currentGlobalRMS) {
            // Conversão simplificada para dB SPL usando o offset calibrado
            let rawDb = 20 * Math.log10(window.currentGlobalRMS + 1e-6);
            if (window.AcousticCalibration) {
                rawDb += window.AcousticCalibration.getCurrentSplOffset();
            }
            db = rawDb;
        } else {
            alert('Ative o microfone na aba Visual para gravar leituras reais!');
            return;
        }

        _el('heatmap-last-val').innerText = `${db.toFixed(1)} dB`;

        const point = {
            x,
            y,
            db,
            position: { x, y },
            timestamp: new Date().toISOString(),
            ..._getMeasurementMetadata(db)
        };
        points.push(point);
        localStorage.setItem('heatmap_points', JSON.stringify(points));
        if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.setMeasurementPosition === 'function') {
            window.SoundMasterAnalyzer.setMeasurementPosition({ x, y });
        }
        _persistHeatmap();

        renderHeatmap();
        renderPins();
    }

    function getColorForDb(db) {
        const minDb = 75;
        const maxDb = 105;
        let percent = (db - minDb) / (maxDb - minDb);
        percent = Math.max(0, Math.min(1, percent));
        
        let r, g, b;
        if (percent < 0.5) {
            let p2 = percent * 2;
            r = 0;
            g = Math.round(p2 * 255);
            b = Math.round((1 - p2) * 255);
        } else {
            let p2 = (percent - 0.5) * 2;
            r = Math.round(p2 * 255);
            g = Math.round((1 - p2) * 255);
            b = 0;
        }
        return `rgba(${r}, ${g}, ${b}, 0.65)`;
    }

    function renderPins() {
        const layer = _el('heatmap-pins-layer');
        if(!layer) return;
        layer.innerHTML = '';
        
        points.forEach((p, i) => {
            const pin = document.createElement('div');
            pin.className = 'heatmap-pin absolute w-6 h-6 rounded-full border-2 border-white shadow-lg transform -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-[9px] font-black text-white';
            pin.style.left = `${p.x * 100}%`;
            pin.style.top = `${p.y * 100}%`;
            pin.style.backgroundColor = getColorForDb(p.db).replace('0.65', '1');
            pin.style.textShadow = '0px 1px 2px rgba(0,0,0,0.8)';
            pin.innerText = Math.round(p.db);
            layer.appendChild(pin);
        });
    }

    function renderHeatmap() {
        const canvas = _el('heatmap-canvas');
        const container = _el('heatmap-container');
        if(!canvas || !container) return;

        const ctx = canvas.getContext('2d');
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Se não tem pontos, não pinta nada
        if (points.length === 0) return;

        // Desenha gradientes radiais para cada ponto
        points.forEach(p => {
            const cx = p.x * canvas.width;
            const cy = p.y * canvas.height;
            const radius = Math.max(canvas.width, canvas.height) * 0.3; // 30% da tela de influência

            const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            const color = getColorForDb(p.db);
            const rgbMatch = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
            
            if (rgbMatch) {
                const rgbStr = `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]},`;
                gradient.addColorStop(0, `${rgbStr} 0.8)`);
                gradient.addColorStop(0.5, `${rgbStr} 0.4)`);
                gradient.addColorStop(1, `${rgbStr} 0)`);
                
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
                ctx.fill();
            }
        });
        
        // Renderiza isocinias se habilitado
        if (showIsolines && points.length >= 3) {
            renderIsolines(ctx, canvas.width, canvas.height);
        }
        
        // Renderiza régua se ativa
        if (rulerMode && rulerStart && rulerEnd) {
            renderRulerLine();
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ISOLINHAS (Contour Lines) - Algoritmo Marching Squares simplificado
    // ═══════════════════════════════════════════════════════════════════════════
    function renderIsolines(ctx, width, height) {
        const resolution = 80;
        const cellW = width / resolution;
        const cellH = height / resolution;
        
        // Criar grid de valores SPL
        const grid = [];
        for (let y = 0; y <= resolution; y++) {
            const row = [];
            for (let x = 0; x <= resolution; x++) {
                const px = x * cellW;
                const py = y * cellH;
                row.push(interpolateSPLAt(px, py, width, height));
            }
            grid.push(row);
        }
        
        // Para cada nível de isolinha, desenhar contour
        ISO_LEVELS.forEach((targetDb, idx) => {
            ctx.beginPath();
            ctx.strokeStyle = getIsolineColor(targetDb);
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.6;
            
            // Marching squares simplificado
            for (let y = 0; y < resolution; y++) {
                for (let x = 0; x < resolution; x++) {
                    const tl = grid[y][x] >= targetDb ? 1 : 0;
                    const tr = grid[y][x+1] >= targetDb ? 1 : 0;
                    const br = grid[y+1][x+1] >= targetDb ? 1 : 0;
                    const bl = grid[y+1][x] >= targetDb ? 1 : 0;
                    
                    const caseId = tl * 8 + tr * 4 + br * 2 + bl;
                    
                    if (caseId > 0 && caseId < 15) {
                        const px = x * cellW;
                        const py = y * cellH;
                        drawIsoSegment(ctx, caseId, px, py, cellW, cellH, grid, targetDb);
                    }
                }
            }
            
            ctx.stroke();
            ctx.globalAlpha = 1;
            
            // Label da isolinha
            const labelPos = findLabelPosition(grid, targetDb, width, height);
            if (labelPos) {
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                ctx.fillRect(labelPos.x - 15, labelPos.y - 8, 30, 16);
                ctx.fillStyle = getIsolineColor(targetDb);
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${targetDb}`, labelPos.x, labelPos.y + 4);
            }
        });
    }
    
    function interpolateSPLAt(px, py, w, h) {
        if (points.length === 0) return 0;
        
        let totalWeight = 0;
        let weightedSum = 0;
        
        points.forEach(p => {
            const pcx = p.x * w;
            const pcy = p.y * h;
            const dist = Math.sqrt((px - pcx) ** 2 + (py - pcy) ** 2);
            const maxDist = Math.max(w, h) * 0.3;
            const weight = Math.max(0, 1 - dist / maxDist) ** 2;
            
            weightedSum += p.db * weight;
            totalWeight += weight;
        });
        
        return totalWeight > 0 ? weightedSum / totalWeight : 0;
    }
    
    function getIsolineColor(db) {
        if (db <= 80) return '#22c55e'; // green
        if (db <= 85) return '#84cc16'; // lime
        if (db <= 90) return '#eab308'; // yellow
        if (db <= 95) return '#f97316'; // orange
        if (db <= 100) return '#ef4444'; // red
        return '#dc2626'; // dark red
    }
    
    function drawIsoSegment(ctx, caseId, x, y, cw, ch, grid, targetDb) {
        // Simplified marching squares - draw based on case
        // This is a simplified version; full implementation would calculate exact intersection points
        const midX = x + cw / 2;
        const midY = y + ch / 2;
        
        // Very simplified: just mark cell centers for visual indication
        const tl = grid[y][x];
        const tr = grid[y][x+1];
        const br = grid[y+1][x+1];
        const bl = grid[y+1][x];
        
        if ((tl >= targetDb) !== (tr >= targetDb)) {
            ctx.moveTo(midX, y);
            ctx.lineTo(midX, midY);
        }
        if ((tr >= targetDb) !== (br >= targetDb)) {
            ctx.lineTo(x + cw, midY);
            ctx.moveTo(midX, midY);
        }
        if ((br >= targetDb) !== (bl >= targetDb)) {
            ctx.lineTo(midX, y + ch);
            ctx.moveTo(midX, midY);
        }
        if ((bl >= targetDb) !== (tl >= targetDb)) {
            ctx.lineTo(x, midY);
            ctx.moveTo(midX, midY);
        }
    }
    
    function findLabelPosition(grid, targetDb, width, height) {
        // Find a position in the middle of a region at targetDb level
        for (let y = 10; y < grid.length - 10; y += 20) {
            for (let x = 10; x < grid[0].length - 10; x += 20) {
                const val = grid[y][x];
                if (Math.abs(val - targetDb) < 2) {
                    return { x: x * (width / grid[0].length), y: y * (height / grid.length) };
                }
            }
        }
        return null;
    }



    window.SoundMasterHeatmap = {
        init: initHeatmap,
        destroy: destroyHeatmap
    };

    document.addEventListener('page-loaded', (e) => {
        console.log(`[Heatmap] Page loaded: ${e.detail.pageId}`);
        if (e.detail.pageId === 'spl-heatmap' || e.detail.pageId === 'analyzer') {
            setTimeout(initHeatmap, 200);
        }
    });

    // Também inicializa quando carregado diretamente no iframe (analyzer page)
    (function autoInitHeatmap() {
        if (_el('heatmap-canvas') || _el('heatmap-container')) {
            // Se já existir o AnalyzerMappingsPage ou similar que gerencia o lifecycle, deixa ele chamar o init
            const isManaged = window.AnalyzerMappingsPage;
            if (isManaged) return;

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => setTimeout(initHeatmap, 200));
            } else {
                setTimeout(initHeatmap, 200);
            }
        }
    })();

    // Observer removido: page-loaded é suficiente com setTimeout
})();
