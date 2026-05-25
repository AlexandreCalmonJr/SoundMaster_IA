/**
 * SoundMaster — SPL Display & Leq Logger Module
 * Manages SPL weighting, RMS bar UI updates, dB scale limits, and continuous Leq logging/export.
 */

'use strict';

(function () {
    let currentWeighting = 'A'; // 'A', 'C', 'Z' (flat)
    let isLeqLogging = false;
    let leqLogData = [];
    let lastLeqTime = 0;

    function _el(id) {
        const iframe = document.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    function init() {
        const btnToggleLeq = _el('btn-toggle-leq');
        const btnExportLeq = _el('btn-export-leq');
        const selectWeighting = _el('spl-weighting-select');
        const inputMinDb = _el('input-min-db');
        const inputMaxDb = _el('input-max-db');

        if (selectWeighting) {
            selectWeighting.value = currentWeighting;
            selectWeighting.addEventListener('change', (e) => {
                setWeighting(e.target.value);
            });
        }

        if (btnToggleLeq) {
            btnToggleLeq.addEventListener('click', toggleLeq);
            _updateLeqUI();
        }

        if (btnExportLeq) {
            btnExportLeq.addEventListener('click', exportLeqCsv);
        }

        if (inputMinDb && inputMaxDb) {
            const updateRange = () => {
                const min = parseInt(inputMinDb.value) || -120;
                const max = parseInt(inputMaxDb.value) || 0;
                if (window.SoundMasterAnalyzer && typeof window.SoundMasterAnalyzer.setDecibelsRange === 'function') {
                    window.SoundMasterAnalyzer.setDecibelsRange(min, max);
                }
            };
            inputMinDb.addEventListener('change', updateRange);
            inputMaxDb.addEventListener('change', updateRange);
        }
    }

    function setWeighting(type) {
        if (['A', 'C', 'Z'].includes(type)) {
            currentWeighting = type;
            console.log(`[SplDisplayModule] SPL Weighting changed to dB(${type})`);
            // Sync select element if visible
            const selectWeighting = _el('spl-weighting-select');
            if (selectWeighting) selectWeighting.value = type;
        }
    }

    function toggleLeq() {
        isLeqLogging = !isLeqLogging;
        if (isLeqLogging) {
            leqLogData = [];
            console.log('[SplDisplayModule] Started logging Leq SPL.');
        } else {
            console.log('[SplDisplayModule] Stopped logging Leq SPL.');
        }
        _updateLeqUI();
    }

    function _updateLeqUI() {
        const btnToggleLeq = _el('btn-toggle-leq');
        const btnExportLeq = _el('btn-export-leq');

        if (btnToggleLeq) {
            if (isLeqLogging) {
                btnToggleLeq.innerText = '⏹ Parar Leq';
                btnToggleLeq.classList.replace('bg-slate-700', 'bg-red-600');
                btnToggleLeq.classList.replace('hover:bg-slate-600', 'hover:bg-red-500');
            } else {
                btnToggleLeq.innerText = '▶ Gravar Leq';
                btnToggleLeq.classList.replace('bg-red-600', 'bg-slate-700');
                btnToggleLeq.classList.replace('hover:bg-red-500', 'hover:bg-slate-600');
            }
        }

        if (btnExportLeq) {
            if (!isLeqLogging && leqLogData.length > 0) {
                btnExportLeq.classList.remove('hidden');
            } else {
                btnExportLeq.classList.add('hidden');
            }
        }
    }

    function pushLeq(rmsDb) {
        if (!isLeqLogging) return;
        const now = Date.now();
        if (now - lastLeqTime >= 1000) {
            leqLogData.push({
                time: new Date(now).toISOString(),
                spl: rmsDb,
                weighting: currentWeighting
            });
            lastLeqTime = now;
        }
    }

    function exportLeqCsv() {
        if (leqLogData.length === 0) return;
        const rows = leqLogData.map(row =>
            `${row.time},${row.spl.toFixed(2)},${row.weighting}`
        );
        const csv = ['Timestamp,SPL_dB,Weighting', ...rows].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SoundMaster_Leq_SPL_Log_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function updateRmsBar(rmsDb, minDecibels, maxDecibels, isClipping) {
        const rmsBar = _el('rms-bar');
        if (!rmsBar) return;

        const rmsDbVal = rmsDb ?? -120;
        const rmsPercent = Math.min(100, Math.max(0, ((rmsDbVal - minDecibels) / (maxDecibels - minDecibels)) * 100));
        rmsBar.style.width = `${rmsPercent}%`;
        rmsBar.style.backgroundColor = isClipping ? '#ef4444' : '#10b981';
    }

    window.SplDisplayModule = {
        init,
        setWeighting,
        toggleLeq,
        pushLeq,
        exportLeqCsv,
        updateRmsBar,
        getWeighting: () => currentWeighting,
        isLeqLogging: () => isLeqLogging,
        getLeqLogData: () => leqLogData
    };

    console.log('[SplDisplayModule] Carregado.');
})();
