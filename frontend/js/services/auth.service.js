(function () {
    'use strict';

    const API_BASE = '';

    function getToken() {
        return localStorage.getItem('sm_auth_token');
    }

    function setToken(token) {
        localStorage.setItem('sm_auth_token', token);
    }

    function removeToken() {
        localStorage.removeItem('sm_auth_token');
        localStorage.removeItem('sm_user');
    }

    function getUser() {
        try {
            const raw = localStorage.getItem('sm_user');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function setUser(user) {
        localStorage.setItem('sm_user', JSON.stringify(user));
    }

    function isAuthenticated() {
        return !!getToken();
    }

    async function request(method, path, body) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (body) opts.body = JSON.stringify(body);

        const token = getToken();
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(API_BASE + path, opts);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Erro na requisição');
        }
        return data;
    }

    async function register(username, email, password) {
        const data = await request('POST', '/api/auth/register', { username, email, password });
        if (data.token) {
            setToken(data.token);
            setUser(data.user);
        }
        return data;
    }

    async function login(username, password) {
        const data = await request('POST', '/api/auth/login', { username, password });
        if (data.token) {
            setToken(data.token);
            setUser(data.user);
        }
        return data;
    }

    async function fetchMe() {
        try {
            const data = await request('GET', '/api/auth/me');
            if (data.user) setUser(data.user);
            return data.user;
        } catch {
            removeToken();
            return null;
        }
    }

    function logout() {
        removeToken();
    }

    window.AuthService = {
        getToken,
        getUser,
        isAuthenticated,
        register,
        login,
        fetchMe,
        logout,
    };
})();
