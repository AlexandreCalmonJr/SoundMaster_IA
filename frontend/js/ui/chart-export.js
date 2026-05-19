/**
 * SoundMaster Pro - Universal Chart Export
 * Exporta gráficos como PNG ou PDF usando jsPDF (já carregado via CDN)
 */
(function() {
    'use strict';

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

    const CHART_CANVAS_IDS = {
        heatmap: 'heatmap-canvas',
        schroeder: 'schroeder-canvas',
        tfMagnitude: 'tf-magnitude-canvas',
        tfPhase: 'tf-phase-canvas',
        rta: 'fft-canvas',
        waterfall: 'waterfall-canvas'
    };

    const DEFAULT_OPTIONS = {
        filename: 'SoundMaster_Report',
        format: 'png',
        quality: 1.0,
        includeTimestamp: true
    };

    function getCanvasDataUrl(canvasId) {
        const canvas = _el(canvasId);
        if (!canvas) {
            console.warn(`[ChartExport] Canvas não encontrado: ${canvasId}`);
            return null;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');

        tempCtx.fillStyle = '#0f172a';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvas, 0, 0);

        return tempCanvas.toDataURL('image/png', DEFAULT_OPTIONS.quality);
    }

    function generateReportMeta() {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return {
            timestamp,
            dateStr: now.toLocaleDateString('pt-BR'),
            timeStr: now.toLocaleTimeString('pt-BR')
        };
    }

    async function downloadDataUrl(dataUrl, filename) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        await new Promise(r => setTimeout(r, 200));
    }

    async function exportAsPNG(options = {}) {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const meta = generateReportMeta();

        const availableCharts = [];
        const failedCharts = [];

        for (const [name, id] of Object.entries(CHART_CANVAS_IDS)) {
            const dataUrl = getCanvasDataUrl(id);
            if (dataUrl) {
                availableCharts.push({ name, dataUrl });
            } else {
                failedCharts.push(name);
            }
        }

        if (availableCharts.length === 0) {
            alert('Nenhum gráfico disponível para exportação. Ative os gráficos no Analisador primeiro.');
            return null;
        }

        console.log(`[ChartExport] Exportando ${availableCharts.length} gráficos como PNG...`);
        
        for (const chart of availableCharts) {
            const filename = `${opts.filename}_${chart.name}_${meta.timestamp}.png`;
            await downloadDataUrl(chart.dataUrl, filename);
        }

        console.log(`[ChartExport] Exportado ${availableCharts.length} gráficos como PNG`);
        return { success: true, charts: availableCharts.length, failed: failedCharts.length };
    }

    async function exportAsPDF(options = {}) {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        
        try {
            const jsPDFLib = window.jspdf || window.jspdfjsPDF;
            if (!jsPDFLib) {
                throw new Error('jsPDF não está disponível');
            }
            
            const meta = generateReportMeta();
            const doc = new jsPDFLib({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            });

            const pageWidth = 210;
            const pageHeight = 297;
            const margin = 15;
            let yPos = margin;

            doc.setFillColor(15, 23, 42);
            doc.rect(0, 0, pageWidth, 40, 'F');
            
            doc.setTextColor(248, 250, 252);
            doc.setFontSize(22);
            doc.setFont('helvetica', 'bold');
            doc.text('SoundMaster Pro', margin, 20);
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text('Relatório de Análise Acústica', margin, 30);

            yPos = 50;
            doc.setTextColor(51, 65, 85);
            doc.setFontSize(10);
            doc.text(`Data: ${meta.dateStr} ${meta.timeStr}`, margin, yPos);
            yPos += 10;

            const chartConfigs = [
                { name: 'Transfer Function (Magnitude)', id: CHART_CANVAS_IDS.tfMagnitude, aspect: 1.8 },
                { name: 'Transfer Function (Fase)', id: CHART_CANVAS_IDS.tfPhase, aspect: 1.8 },
                { name: 'RTA - Resposta em Frequência', id: CHART_CANVAS_IDS.rta, aspect: 1.5 },
                { name: 'Curva de Schroeder (RT60)', id: CHART_CANVAS_IDS.schroeder, aspect: 1.5 },
                { name: 'Mapa de Calor (SPL)', id: CHART_CANVAS_IDS.heatmap, aspect: 1.2 }
            ];

            for (const config of chartConfigs) {
                const dataUrl = getCanvasDataUrl(config.id);
                if (!dataUrl) continue;

                const maxWidth = pageWidth - margin * 2;
                const imgHeight = maxWidth / config.aspect;
                
                if (yPos + imgHeight > pageHeight - margin) {
                    doc.addPage();
                    yPos = margin;
                }

                doc.setTextColor(30, 41, 59);
                doc.setFontSize(11);
                doc.setFont('helvetica', 'bold');
                doc.text(config.name, margin, yPos);
                yPos += 5;

                try {
                    doc.addImage(dataUrl, 'PNG', margin, yPos, maxWidth, imgHeight);
                    yPos += imgHeight + 10;
                } catch (imgErr) {
                    console.warn(`[ChartExport] Falha ao adicionar ${config.name}:`, imgErr);
                    doc.setTextColor(239, 68, 68);
                    doc.text(`[Gráfico não disponível]`, margin, yPos + 5);
                    yPos += 15;
                }
            }

            yPos = pageHeight - 20;
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text('Gerado por SoundMaster Pro', margin, yPos);
            
            const filename = `${opts.filename}_${meta.timestamp}.pdf`;
            doc.save(filename);

            console.log('[ChartExport] PDF exportado com sucesso');
            return { success: true, filename };

        } catch (err) {
            console.error('[ChartExport] Erro ao gerar PDF:', err);
            alert('Erro ao gerar PDF. Verifique se a biblioteca jsPDF está carregada corretamente.\nTentando exportar como PNG...');
            return exportAsPNG(opts);
        }
    }

    function exportCharts(options = {}) {
        const format = (options.format || 'png').toLowerCase();
        
        if (format === 'pdf') {
            return exportAsPDF(options);
        } else {
            return exportAsPNG(options);
        }
    }

    function getAvailableCharts() {
        const available = [];
        for (const [name, id] of Object.entries(CHART_CANVAS_IDS)) {
            const canvas = _el(id);
            if (canvas) available.push(name);
        }
        return available;
    }

    function bindExportButtons() {
        const btnPng = _el('btn-export-png');
        const btnPdf = _el('btn-export-pdf');
        
        if (btnPng) {
            btnPng.addEventListener('click', () => {
                btnPng.innerHTML = '⏳ Exportando...';
                exportAsPNG().finally(() => {
                    btnPng.innerHTML = '📊 Export PNG';
                });
            });
        }
        
        if (btnPdf) {
            btnPdf.addEventListener('click', () => {
                btnPdf.innerHTML = '⏳ Gerando...';
                exportAsPDF().finally(() => {
                    btnPdf.innerHTML = '📄 Export PDF';
                });
            });
        }
    }

    document.addEventListener('page-loaded', (e) => {
        if (e.detail.pageId === 'analyzer' || e.detail.pageId === 'spl-heatmap' || e.detail.pageId === 'rt60') {
            setTimeout(bindExportButtons, 300);
        }
    });

    // Também inicializa quando carregado diretamente no iframe
    (function autoInitExport() {
        if (_el('btn-export-png') || _el('btn-export-pdf')) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => setTimeout(bindExportButtons, 300));
            } else {
                setTimeout(bindExportButtons, 300);
            }
        }
    })();

    window.ChartExport = {
        exportCharts,
        exportAsPNG,
        exportAsPDF,
        getAvailableCharts,
        bindExportButtons,
        CANVAS_IDS: CHART_CANVAS_IDS
    };
})();