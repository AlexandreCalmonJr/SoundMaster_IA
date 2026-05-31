/**
 * SoundMaster — AES67 Page Module
 * Controls multi-channel meters (AES67 stream telemetry) and network diagnostic info.
 */

'use strict';

(function () {
    const pm = createPageModule();
    let meterBars = [];

    function buildMeters() {
        const grid = pm._el('aes67-meters-grid');
        if (!grid) return;

        grid.innerHTML = ''; // Clear placeholders
        meterBars = [];

        const labels = [
            ...Array(24).fill(0).map((_, i) => `Ch ${i + 1}`),
            'Aux 1', 'Aux 2', 'Aux 3', 'Aux 4', 'Aux 5', 'Aux 6', 'FX 1', 'FX 2'
        ];

        labels.forEach((label, i) => {
            const meterCol = document.createElement('div');
            meterCol.className = 'flex flex-col items-center gap-2 h-full';

            const track = document.createElement('div');
            track.className = 'flex-1 w-3 bg-slate-800 rounded-full relative overflow-hidden';

            const bar = document.createElement('div');
            bar.className = 'absolute bottom-0 w-full bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 h-[0%] transition-all duration-75';
            
            const span = document.createElement('span');
            span.className = 'text-[9px] font-bold text-slate-500 uppercase';
            span.innerText = label;

            track.appendChild(bar);
            meterCol.appendChild(track);
            meterCol.appendChild(span);
            grid.appendChild(meterCol);

            meterBars.push(bar);
        });
    }

    function updateMeters(peakValues) {
        if (!peakValues || !Array.isArray(peakValues)) return;
        
        peakValues.forEach((db, i) => {
            if (i >= meterBars.length) return;
            // Map db (-60 to 0) to percentage (0% to 100%)
            const dbVal = db ?? -60;
            const pct = Math.max(0, Math.min(100, ((dbVal + 60) / 60) * 100));
            meterBars[i].style.height = `${pct}%`;
        });
    }

    function handleNetDiagUpdate(data) {
        if (!data) return;

        const latEl = pm._el('aes67-latency');
        const jitEl = pm._el('aes67-jitter');
        const lossEl = pm._el('aes67-loss');
        const ptpEl = pm._el('aes67-ptp-status');

        if (latEl && data.latency !== null) {
            latEl.innerText = `${data.latency.toFixed(1)} ms`;
            latEl.className = `px-2 py-0.5 rounded text-xs font-mono ${
                data.latency < 5 ? 'bg-green-950 text-green-400 border border-green-500/20' :
                data.latency < 20 ? 'bg-amber-950 text-amber-400 border border-amber-500/20' : 'bg-red-950 text-red-400 border border-red-500/20'
            }`;
        }

        if (jitEl && data.jitter !== null) {
            jitEl.innerText = `${data.jitter.toFixed(1)} ms`;
            jitEl.className = `px-2 py-0.5 rounded text-xs font-mono ${
                data.jitter < 2 ? 'bg-green-950 text-green-400 border border-green-500/20' :
                data.jitter < 8 ? 'bg-amber-950 text-amber-400 border border-amber-500/20' : 'bg-red-950 text-red-400 border border-red-500/20'
            }`;
        }

        if (lossEl && data.loss !== null) {
            lossEl.innerText = `${data.loss.toFixed(1)}%`;
            lossEl.className = `px-2 py-0.5 rounded text-xs font-mono ${
                data.loss < 0.1 ? 'bg-green-950 text-green-400 border border-green-500/20' :
                data.loss < 2 ? 'bg-amber-950 text-amber-400 border border-amber-500/20' : 'bg-red-950 text-red-400 border border-red-500/20'
            }`;
        }

        if (ptpEl) {
            const hasGoodSync = data.latency !== null && data.jitter !== null && data.jitter < 5;
            ptpEl.innerHTML = `<span class="w-2 h-2 rounded-full ${hasGoodSync ? 'bg-green-500' : 'bg-amber-500'} animate-pulse"></span> ${hasGoodSync ? 'Lock' : 'Unsynced'}`;
            ptpEl.className = `flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${hasGoodSync ? 'text-green-400' : 'text-amber-400'}`;
        }
    }

    function handleNetDiagAlert(alert) {
        const container = pm._el('aes67-ai-alerts');
        if (!container) return;

        // Clear default placeholder if present
        const placeholder = container.querySelector('.italic');
        if (placeholder) {
            container.innerHTML = '';
        }

        const time = new Date().toLocaleTimeString('pt-BR');
        const alertDiv = document.createElement('div');
        alertDiv.className = `p-3 rounded-xl border text-[11px] font-medium leading-normal flex items-start gap-2 ${
            alert.level === 'critical' ? 'bg-red-950/20 border-red-500/20 text-red-300' : 'bg-amber-950/20 border-amber-500/20 text-amber-300'
        }`;

        alertDiv.innerHTML = `
            <span class="text-xs">${alert.level === 'critical' ? '🔴' : '⚠️'}</span>
            <div class="flex-1">
                <div class="flex items-center justify-between font-bold mb-1 text-[10px] uppercase tracking-wider">
                    <span>${alert.code.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}</span>
                    <span class="text-slate-500 font-mono font-normal">${time}</span>
                </div>
                <div>${alert.message.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}</div>
            </div>
        `;

        container.insertBefore(alertDiv, container.firstChild);

        // Keep last 15 alerts to avoid DOM bloat
        while (container.children.length > 15) {
            container.removeChild(container.lastChild);
        }
    }

    function restartStream() {
        console.log('[Aes67Page] Reiniciando Stream AoIP...');
        pm._safeCall('SocketService', 'emit', 'stop_net_diag');
        pm._safeCall('SocketService', 'emit', 'start_net_diag', { interval: 2000 });
        
        const container = pm._el('aes67-ai-alerts');
        if (container) {
            container.innerHTML = `
                <div class="p-3 bg-cyan-950/20 border border-cyan-500/20 rounded-xl text-[11px] text-cyan-300 flex items-center gap-2">
                    <span class="animate-spin">🌀</span>
                    <span>Receptor reiniciado. Aguardando novos dados de telemetria...</span>
                </div>
            `;
        }
    }

    function activateIaScan() {
        console.log('[Aes67Page] Ativando Varredura IA de rede...');
        pm._safeCall('SocketService', 'emit', 'scan_network');
        
        const container = pm._el('aes67-ai-alerts');
        if (container) {
            const time = new Date().toLocaleTimeString('pt-BR');
            const scanDiv = document.createElement('div');
            scanDiv.className = 'p-3 bg-cyan-950/20 border border-cyan-500/20 rounded-xl text-[11px] text-cyan-300 flex items-start gap-2';
            scanDiv.innerHTML = `
                <span class="text-xs">🤖</span>
                <div class="flex-1">
                    <div class="flex items-center justify-between font-bold mb-1 text-[10px] uppercase tracking-wider">
                        <span>Varredura Ativa</span>
                        <span class="text-slate-500 font-mono font-normal">${time}</span>
                    </div>
                    <div>Varredura mDNS e varredura de portas TCP na subnet iniciadas.</div>
                </div>
            `;
            container.insertBefore(scanDiv, container.firstChild);
        }
    }

    var _socketListenersAttached = false;

    function init() {
        buildMeters();

        var socket = pm._call('SocketService', 'raw');
        if (socket && !_socketListenersAttached) {
            socket.on('multi_meter_update', updateMeters);
            socket.on('net_diag_update', handleNetDiagUpdate);
            socket.on('net_diag_alert', handleNetDiagAlert);
            _socketListenersAttached = true;

            pm._safeCall('SocketService', 'emit', 'get_net_devices');
            pm._safeCall('SocketService', 'emit', 'start_net_diag', { interval: 3000 });
        }

        var btnRestart = pm._el('aes67-btn-restart');
        var btnScan = pm._el('aes67-btn-scan');

        if (btnRestart) pm._on(btnRestart, 'click', restartStream);
        if (btnScan) pm._on(btnScan, 'click', activateIaScan);
    }

    function destroy() {
        var socket = pm._call('SocketService', 'raw');
        if (socket) {
            socket.off('multi_meter_update', updateMeters);
            socket.off('net_diag_update', handleNetDiagUpdate);
            socket.off('net_diag_alert', handleNetDiagAlert);
        }
        _socketListenersAttached = false;
        pm.destroy();
    }

    window.Aes67Page = {
        init: init,
        destroy: destroy
    };
})();
