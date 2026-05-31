var _toastContainer = null;
var _toastTimers = new Map();
var _toastIdCounter = 0;

function _ensureContainer() {
    if (_toastContainer) return _toastContainer;
    _toastContainer = document.createElement('div');
    _toastContainer.id = 'sm-toast-container';
    Object.assign(_toastContainer.style, {
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: '99999',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
        maxWidth: '360px'
    });
    document.body.appendChild(_toastContainer);
    return _toastContainer;
}

var TOAST_COLORS = {
    info: { bg: 'rgba(6,182,212,0.9)', border: 'rgba(6,182,212,0.5)' },
    success: { bg: 'rgba(34,197,94,0.9)', border: 'rgba(34,197,94,0.5)' },
    error: { bg: 'rgba(239,68,68,0.9)', border: 'rgba(239,68,68,0.5)' },
    warning: { bg: 'rgba(234,179,8,0.9)', border: 'rgba(234,179,8,0.5)' }
};

function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3500;
    var id = 'sm-toast-' + (++_toastIdCounter);
    var colors = TOAST_COLORS[type] || TOAST_COLORS.info;
    var container = _ensureContainer();

    var el = document.createElement('div');
    el.id = id;
    Object.assign(el.style, {
        background: colors.bg,
        border: '1px solid ' + colors.border,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: '#fff',
        padding: '10px 16px',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '600',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        pointerEvents: 'auto',
        transform: 'translateX(120%)',
        transition: 'transform 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.25s',
        opacity: '0'
    });
    el.textContent = message;
    container.appendChild(el);

    requestAnimationFrame(function () {
        el.style.transform = 'translateX(0)';
        el.style.opacity = '1';
    });

    var timer = setTimeout(function () {
        el.style.transform = 'translateX(120%)';
        el.style.opacity = '0';
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
        _toastTimers.delete(id);
    }, duration);
    _toastTimers.set(id, timer);
    return id;
}

function dismissToast(id) {
    var timer = _toastTimers.get(id);
    if (timer) clearTimeout(timer);
    var el = document.getElementById(id);
    if (el) {
        el.style.transform = 'translateX(120%)';
        el.style.opacity = '0';
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
    }
    _toastTimers.delete(id);
}

window.SoundMasterToast = { showToast: showToast, dismissToast: dismissToast };
