'use strict';
document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    if (!body) return;
    const moduleName = body.getAttribute('data-module');
    const pageId = body.getAttribute('data-page-id');

    if (moduleName && window[moduleName] && typeof window[moduleName].init === 'function') {
        try {
            window[moduleName].init();
        } catch (e) {
            console.error('[Iframe] Erro ao inicializar modulo ' + moduleName + ':', e);
        }
    }
    
    // Notify parent router that the page is fully loaded and initialized
    const event = new CustomEvent('iframe-loaded', {
        detail: { pageId: pageId }
    });
    window.parent.document.dispatchEvent(event);
});
