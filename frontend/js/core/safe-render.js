/**
 * SoundMaster — Safe Render Utilities
 * Centraliza escape de HTML para prevenir XSS no frontend Electron.
 *
 * Uso:
 *   const { escapeHtml, safeText } = window.SafeRender || {};
 *   element.innerHTML = escapeHtml(userInput);
 *   // ou, preferível:
 *   safeText(element, userInput);
 */
'use strict';

(function () {
    const ENTITY_MAP = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
        '`': '&#x60;'
    };

    const ENTITY_RE = /[&<>"'\/`]/g;

    /**
     * Escapa caracteres perigosos para interpolação segura em innerHTML.
     * @param {string} str
     * @returns {string}
     */
    function escapeHtml(str) {
        if (typeof str !== 'string') return String(str ?? '');
        return str.replace(ENTITY_RE, (ch) => ENTITY_MAP[ch]);
    }

    /**
     * Define textContent de um elemento de forma segura (preferível a innerHTML).
     * @param {HTMLElement} el
     * @param {string} text
     */
    function safeText(el, text) {
        if (el && el.nodeType === 1) {
            el.textContent = text ?? '';
        }
    }

    /**
     * Cria um elemento de texto seguro.
     * @param {string} tag
     * @param {string} text
     * @param {string} [className]
     * @returns {HTMLElement}
     */
    function safeElement(tag, text, className) {
        const el = document.createElement(tag);
        el.textContent = text ?? '';
        if (className) el.className = className;
        return el;
    }

    window.SafeRender = { escapeHtml, safeText, safeElement };
})();
