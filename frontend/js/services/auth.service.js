(function () {
    'use strict';

    const API_BASE = '';
    const DEFAULT_TIMEOUT_MS = 30000;

    function getUser() {
        try {
            const raw = localStorage.getItem('sm_user');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function setUser(user) {
        if (user) localStorage.setItem('sm_user', JSON.stringify(user));
        else localStorage.removeItem('sm_user');
    }

    /**
     * Wrapper HTTP com timeout via AbortController.
     * Lança `AbortError` (DOMException) se a requisição ultrapassar `timeoutMs`.
     *
     * @param {string} method    HTTP verb
     * @param {string} path      path começando em '/'
     * @param {object} [body]    payload JSON
     * @param {object} [opts]    { timeoutMs?: number } — default 30000
     */
    async function request(method, path, body, opts) {
        const timeoutMs = (opts && opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const fetchOpts = {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
        };
        if (body) fetchOpts.body = JSON.stringify(body);

        let res;
        try {
            res = await fetch(API_BASE + path, fetchOpts);
        } catch (err) {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                throw new Error(`Requisição expirou após ${timeoutMs}ms (${path})`);
            }
            throw err;
        }
        clearTimeout(timer);

        const contentType = res.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await res.json() : null;

        if (!res.ok) {
            if (res.status === 401) {
                setUser(null);
            }
            throw new Error((data && data.error) || 'Erro na requisição');
        }
        return data;
    }

    async function register(username, email, password) {
        const data = await request('POST', '/api/auth/register', { username, email, password });
        if (data && data.user) setUser(data.user);
        return data;
    }

    async function login(username, password) {
        const data = await request('POST', '/api/auth/login', { username, password });
        if (data && data.user) setUser(data.user);
        return data;
    }

    async function fetchMe() {
        try {
            const data = await request('GET', '/api/auth/me');
            if (data && data.user) {
                setUser(data.user);
                return data.user;
            }
            setUser(null);
            return null;
        } catch {
            setUser(null);
            return null;
        }
    }

    async function logout() {
        try {
            await request('POST', '/api/auth/logout');
        } catch {
            // ignore errors on logout
        }
        setUser(null);
    }

    function isAuthenticated() {
        const user = getUser();
        return !!(user && typeof user === 'object' && user.id);
    }

    window.AuthService = {
        getUser,
        isAuthenticated,
        register,
        login,
        fetchMe,
        logout,
    };
})();
