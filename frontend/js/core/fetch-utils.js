/**
 * SoundMaster Pro — HTTP fetch utilities
 * =======================================
 * Wrappers com timeout via AbortController para uso em serviços
 * de frontend (mobile, mixer, analyzer, ai-chat) que não passam
 * pelo AuthService central.
 */
(function () {
    'use strict';

    const DEFAULT_TIMEOUT_MS = 30000;

    /**
     * fetch() com timeout via AbortController.
     * @param {string} url
     * @param {RequestInit} [opts]
     * @param {number} [timeoutMs=30000] — 0 desabilita o timeout
     * @returns {Promise<Response>}
     * @throws {Error} com mensagem `Timeout após Xms` se AbortError for lançado
     */
    async function fetchWithTimeout(url, opts, timeoutMs) {
        const ms = timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : timeoutMs;
        const controller = new AbortController();
        let timer = null;
        if (ms > 0) {
            timer = setTimeout(() => controller.abort(), ms);
        }

        const fetchOpts = Object.assign({}, opts, { signal: controller.signal });

        try {
            return await fetch(url, fetchOpts);
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw new Error(`Timeout após ${ms}ms (${url})`);
            }
            throw err;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    window.SoundMasterFetch = { fetchWithTimeout, DEFAULT_TIMEOUT_MS };
})();
