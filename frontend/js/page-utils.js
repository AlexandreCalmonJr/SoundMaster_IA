/**
 * SoundMaster — Page Utilities Module
 * Factory function que cria um contexto isolado para cada page module.
 */

'use strict';

window.createPageModule = function () {
    var _listeners = [];
    var _rafIds = [];
    var _timeouts = [];
    var _intervals = [];
    var _subscriptions = [];

    function _on(target, event, selectorOrHandler, maybeHandler) {
        var handler = maybeHandler || selectorOrHandler;
        var selector = (typeof selectorOrHandler === 'string') ? selectorOrHandler : null;
        if (!target) return;
        var el = selector ? (typeof selector === 'string' ? target.querySelector(selector) : selector) : target;
        if (!el) return;
        el.addEventListener(event, handler);
        _listeners.push({ target: el, event: event, handler: handler });
    }

    function _el(id) {
        return document.getElementById(id);
    }

    function _setText(id, text) { var el = _el(id); if (el) el.textContent = text; }

    function _setHTML(id, html) { var el = _el(id); if (el) el.innerHTML = html; }

    function _toggleClass(id, cls, on) {
        var el = _el(id);
        if (!el) return;
        if (on) el.classList.add(cls); else el.classList.remove(cls);
    }

    function _toggleClasses(id, addCls, removeCls) {
        var el = _el(id);
        if (!el) return;
        if (addCls) el.classList.add.apply(el.classList, Array.isArray(addCls) ? addCls : [addCls]);
        if (removeCls) el.classList.remove.apply(el.classList, Array.isArray(removeCls) ? removeCls : [removeCls]);
    }

    function _call(serviceName, method) {
        var args = Array.prototype.slice.call(arguments, 2);
        var service = window[serviceName];
        if (service && typeof service[method] === 'function') return service[method].apply(service, args);
        return undefined;
    }

    function _safeCall(serviceName, method) {
        var args = Array.prototype.slice.call(arguments, 2);
        var service = window[serviceName];
        if (service && typeof service[method] === 'function') {
            try { return service[method].apply(service, args); } catch (e) { return undefined; }
        }
        return undefined;
    }

    function _esc(s) {
        return String(s != null ? s : '').replace(/[&<>"']/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
        });
    }

    function _lerp(a, b, t) { return a + (b - a) * t; }

    function _log(containerId, msg, type) {
        var el = _el(containerId || 'sim-log');
        if (!el) return;
        var time = new Date().toLocaleTimeString('pt-BR');
        var color = type === 'error' ? 'text-red-400' : type === 'warn' ? 'text-amber-400' : 'text-green-400';
        el.innerHTML += '<div class="' + color + '">[' + time + '] ' + msg + '</div>';
        el.scrollTop = el.scrollHeight;
    }

    function _requestAnimationFrame(fn) { var id = requestAnimationFrame(fn); _rafIds.push(id); return id; }
    function _cancelAllAnimationFrames() { _rafIds.forEach(function (id) { cancelAnimationFrame(id); }); _rafIds = []; }
    function _setTimeout(fn, ms) { var id = setTimeout(fn, ms); _timeouts.push(id); return id; }
    function _clearAllTimeouts() { _timeouts.forEach(function (id) { clearTimeout(id); }); _timeouts = []; }
    function _setInterval(fn, ms) { var id = setInterval(fn, ms); _intervals.push(id); return id; }
    function _clearAllIntervals() { _intervals.forEach(function (id) { clearInterval(id); }); _intervals = []; }

    function _subscribe(storeName, key, handler) {
        var store = window[storeName];
        if (store && typeof store.subscribe === 'function') {
            var unsub = store.subscribe(key, handler);
            if (typeof unsub === 'function') _subscriptions.push(unsub);
        }
    }

    function _unbindAllSubscriptions() { _subscriptions.forEach(function (fn) { fn(); }); _subscriptions = []; }

    function destroy() {
        _listeners.forEach(function (l) { l.target.removeEventListener(l.event, l.handler); });
        _listeners = [];
        _cancelAllAnimationFrames();
        _clearAllTimeouts();
        _clearAllIntervals();
        _unbindAllSubscriptions();
    }

    return {
        _on: _on, _el: _el, _setText: _setText, _setHTML: _setHTML,
        _toggleClass: _toggleClass, _toggleClasses: _toggleClasses,
        _call: _call, _safeCall: _safeCall,
        _esc: _esc, _lerp: _lerp, _log: _log,
        _requestAnimationFrame: _requestAnimationFrame, _cancelAllAnimationFrames: _cancelAllAnimationFrames,
        _setTimeout: _setTimeout, _clearAllTimeouts: _clearAllTimeouts,
        _setInterval: _setInterval, _clearAllIntervals: _clearAllIntervals,
        _subscribe: _subscribe, destroy: destroy
    };
};
