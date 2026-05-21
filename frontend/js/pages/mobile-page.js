/**
 * SoundMaster — Mobile Page Module
 * Displays QR code and URL for connecting a mobile device.
 */

'use strict';

(function () {
    const pm = createPageModule();

    async function loadConfig() {
        try {
            const res = await fetch('/api/config');
            if (!res.ok) return;

            const config = await res.json();
            const qrCodeEl = pm._el('mobile-qr-code');
            const urlEl = pm._el('mobile-url');
            const linkEl = pm._el('mobile-open-link');

            const serverUrl = `http://${config.localIp}:${config.port}`;
            const mobileHref = `${serverUrl}/mobile/index.html?mode=mobile`;

            if (urlEl) {
                urlEl.innerText = mobileHref;
            }

            if (linkEl) {
                linkEl.href = mobileHref;
            }

            if (qrCodeEl) {
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(mobileHref)}`;
                qrCodeEl.src = qrUrl;
                console.log('[MobilePage] QR Code set to:', mobileHref);
            }
        } catch (e) {
            console.error('[MobilePage] Error loading config:', e);
            const urlEl = pm._el('mobile-url');
            if (urlEl) {
                urlEl.innerText = 'Erro ao carregar endereço local.';
            }
        }
    }

    function init() {
        console.log('[MobilePage] Inicializando...');
        loadConfig();
    }

    function destroy() {
        pm.destroy();
    }

    window.MobilePage = {
        init: init,
        destroy: destroy
    };
})();
