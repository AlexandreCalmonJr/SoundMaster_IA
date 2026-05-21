/**
 * SoundMaster — Home Page Module
 * Displays server configuration, local network link, and live system metrics.
 */

'use strict';

(function () {
    const pm = createPageModule();

    async function loadConfig() {
        try {
            const res = await fetch('/api/config');
            if (!res.ok) return;

            const config = await res.json();
            const ipCard = pm._el('local-ip-card');
            const ipDisplay = pm._el('server-ip-display');
            const mobileLink = pm._el('mobile-link');
            const mobileQrCode = pm._el('mobile-qr-code');

            if (ipCard) ipCard.style.display = 'block';
            const serverUrl = `http://${config.localIp}:${config.port}`;
            if (ipDisplay) ipDisplay.innerText = serverUrl;
            
            const mobileHref = `${serverUrl}/mobile/index.html?mode=mobile`;
            if (mobileLink) {
                mobileLink.href = mobileHref;
            }
            
            if (mobileQrCode) {
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(mobileHref)}`;
                mobileQrCode.src = qrUrl;
                console.log('[HomePage] QR Code set to:', mobileHref);
            }
        } catch (e) {
            console.error('[HomePage] Error loading config:', e);
        }
    }

    function init() {
        loadConfig();

        // Subscribe to AppStore for live status updates if status cards exist
        pm._subscribe('AppStore', 'splStats', (stats) => {
            const splValEl = pm._el('home-spl-val');
            if (splValEl && stats && stats.leqTotal !== undefined) {
                splValEl.innerText = `${stats.leqTotal.toFixed(1)} dBA`;
            }
        });

        pm._subscribe('AppStore', 'mixerConnected', (connected) => {
            const statusEl = pm._el('home-mixer-status');
            if (statusEl) {
                statusEl.innerText = connected ? 'Online' : 'Offline';
                statusEl.className = connected ? 'text-green-400 font-bold' : 'text-red-400 font-bold';
            }
        });

        // Listen for new RT60 results
        document.addEventListener('rt60-result', (e) => {
            const rtValEl = pm._el('home-rt60-val');
            if (rtValEl && e.detail && e.detail.rt60 !== undefined) {
                rtValEl.innerText = `${e.detail.rt60.toFixed(2)}s`;
            }
        });
    }

    function destroy() {
        pm.destroy();
    }

    window.HomePage = {
        init: init,
        destroy: destroy
    };
})();
