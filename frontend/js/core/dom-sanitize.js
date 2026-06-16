/**
 * SoundMaster — DOM Sanitization Utilities
 * Shared sanitization functions for safe HTML rendering.
 */

'use strict';

window.DOMPurify = window.DOMPurify || null;

window.escapeHTMLText = function (value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * Sanitize HTML string using DOMPurify if available, otherwise fallback to basic escaping.
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML string
 */
window.sanitizeHTML = function (html) {
    if (!html) return '';
    if (window.DOMPurify) {
        return window.DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'blockquote'],
            ALLOWED_ATTR: ['href', 'target', 'rel', 'class']
        });
    }
    // Fallback: escape HTML entities
    return window.escapeHTMLText(html);
};

/**
 * Set innerHTML safely with sanitization.
 * @param {HTMLElement|string} el - Element or element ID
 * @param {string} html - HTML string to set
 */
window.setSafeHTML = function (el, html) {
    if (typeof el === 'string') {
        el = document.getElementById(el);
    }
    if (el) {
        el.innerHTML = window.sanitizeHTML(html);
    }
};
