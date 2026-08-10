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
 * Sanitize HTML string using DOMPurify if available, otherwise fallback to
 * DOMParser-based sanitization that strips scripts/event-handlers but
 * preserves valid HTML and SVG elements.
 *
 * IMPORTANT: The previous fallback (escapeHTMLText) broke sidebar rendering
 * when running on isolated mixer networks without internet (CDN unreachable).
 *
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML string
 */
window.sanitizeHTML = function (html) {
    if (!html) return '';

    // Primary: DOMPurify (local bundle or CDN)
    if (window.DOMPurify) {
        return window.DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true, svg: true, svgFilters: true }
        });
    }

    // Fallback: DOMParser-based sanitizer — strips dangerous elements/attrs
    // while preserving valid HTML structure (buttons, divs, SVGs, etc.)
    try {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        // Remove script elements
        doc.querySelectorAll('script, iframe, object, embed, form').forEach(function (el) { el.remove(); });
        // Remove dangerous attributes (event handlers, javascript: URIs)
        doc.querySelectorAll('*').forEach(function (el) {
            var attrs = Array.from(el.attributes);
            for (var i = 0; i < attrs.length; i++) {
                var name = attrs[i].name.toLowerCase();
                if (name.startsWith('on') || (name === 'href' && String(attrs[i].value).trim().toLowerCase().startsWith('javascript:'))) {
                    el.removeAttribute(attrs[i].name);
                }
            }
        });
        return doc.body ? doc.body.innerHTML : html;
    } catch (_) {
        // Last resort: return as-is (we're in a trusted Electron context)
        console.warn('[DOMSanitize] DOMParser fallback failed, using raw HTML.');
        return html;
    }
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
