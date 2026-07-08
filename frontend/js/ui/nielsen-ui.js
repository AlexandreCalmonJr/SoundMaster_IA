/**
 * SoundMaster — Keyboard Shortcuts & Confirm Dialog
 * H7: Flexibilidade e eficiência de uso — atalhos de teclado
 * H3: Controle e liberdade — diálogos de confirmação
 */
(function () {
    'use strict';

    /**
     * Show a confirmation dialog (H3).
     * @param {Object} opts
     * @param {string} opts.title
     * @param {string} opts.description
     * @param {string} [opts.confirmText='Confirmar']
     * @param {string} [opts.cancelText='Cancelar']
     * @param {string} [opts.variant='danger'] - 'danger' | 'primary'
     * @returns {Promise<boolean>}
     */
    function confirm(opts) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'sm-confirm-overlay';
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-label', opts.title);

            const btnClass = opts.variant === 'primary'
                ? 'sm-confirm-btn sm-confirm-btn-primary'
                : 'sm-confirm-btn sm-confirm-btn-danger';

            overlay.innerHTML = `
                <div class="sm-confirm-card">
                    <div class="sm-confirm-title">${opts.title}</div>
                    <div class="sm-confirm-desc">${opts.description}</div>
                    <div class="sm-confirm-actions">
                        <button class="sm-confirm-btn sm-confirm-btn-cancel" id="sm-confirm-cancel">${opts.cancelText || 'Cancelar'}</button>
                        <button class="${btnClass}" id="sm-confirm-ok">${opts.confirmText || 'Confirmar'}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const cleanup = (result) => {
                overlay.remove();
                document.removeEventListener('keydown', onKey);
                resolve(result);
            };

            const onKey = (e) => {
                if (e.key === 'Escape') cleanup(false);
                if (e.key === 'Enter') cleanup(true);
            };

            document.addEventListener('keydown', onKey);
            overlay.querySelector('#sm-confirm-cancel').addEventListener('click', () => cleanup(false));
            overlay.querySelector('#sm-confirm-ok').addEventListener('click', () => cleanup(true));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });

            requestAnimationFrame(() => overlay.querySelector('#sm-confirm-cancel').focus());
        });
    }

    // Navigation progress bar (H1)
    let _progressEl = null;

    function _ensureProgressBar() {
        if (_progressEl) return _progressEl;
        _progressEl = document.createElement('div');
        _progressEl.id = 'sm-nav-progress';
        document.body.appendChild(_progressEl);
        return _progressEl;
    }

    function startProgress() {
        const bar = _ensureProgressBar();
        bar.className = '';
        bar.style.width = '0';
        bar.style.opacity = '1';
        requestAnimationFrame(() => {
            bar.classList.add('active');
        });
    }

    function endProgress() {
        const bar = _ensureProgressBar();
        bar.classList.remove('active');
        bar.classList.add('done');
        setTimeout(() => {
            bar.className = '';
            bar.style.width = '0';
            bar.style.opacity = '1';
        }, 500);
    }

    // Keyboard shortcuts (H7)
    function _initShortcuts() {
        document.addEventListener('keydown', (e) => {
            const tag = (e.target.tagName || '').toLowerCase();
            const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

            // Ctrl+K / Cmd+K: Global Search
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                if (window.SoundMasterSearch) window.SoundMasterSearch.toggle();
                return;
            }

            // Escape: Close search or modal
            if (e.key === 'Escape') {
                if (window.SoundMasterSearch) window.SoundMasterSearch.close();
                return;
            }

            // Shortcuts below don't trigger inside inputs
            if (isInput) return;

            // Ctrl+M: Toggle microphone
            if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
                e.preventDefault();
                const micBtn = document.getElementById('btn-toggle-mic');
                if (micBtn) micBtn.click();
                return;
            }

            // Ctrl+H: Go to Home
            if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
                e.preventDefault();
                if (window.router) window.router.navigate('home');
                return;
            }

            // ? (alone): Open help modal
            if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                if (window.SoundMasterTour) window.SoundMasterTour.openHelpModal();
                return;
            }
        });
    }

    // Connection status indicator (H1)
    function _createConnectionIndicator() {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight || document.getElementById('sm-connection-status')) return;

        const indicator = document.createElement('div');
        indicator.id = 'sm-connection-status';
        indicator.className = 'connection-indicator';
        indicator.setAttribute('data-status', 'disconnected');
        indicator.innerHTML = '<span class="connection-dot"></span><span id="sm-conn-label">Desconectado</span>';
        indicator.title = 'Status da conexão com o servidor';

        headerRight.insertBefore(indicator, headerRight.firstChild);

        // Subscribe to socket status via AppStore
        if (window.AppStore) {
            AppStore.subscribe('mixerConnected', (connected) => {
                const status = connected ? 'connected' : 'disconnected';
                indicator.setAttribute('data-status', status);
                document.getElementById('sm-conn-label').textContent = connected ? 'Conectado' : 'Desconectado';
            });
        }
    }

    function init() {
        _ensureProgressBar();
        _initShortcuts();
        _createConnectionIndicator();
    }

    // Toast Notifications (H1)
    function showToast(message, variant = 'success') {
        let container = document.getElementById('sm-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'sm-toast-container';
            container.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        let bgClass = 'bg-slate-800';
        let textClass = 'text-white';
        let borderClass = 'border-slate-700';
        let icon = 'ℹ️';

        if (variant === 'success') {
            bgClass = 'bg-emerald-950/90';
            borderClass = 'border-emerald-500/30';
            textClass = 'text-emerald-400';
            icon = '✓';
        } else if (variant === 'error') {
            bgClass = 'bg-red-950/90';
            borderClass = 'border-red-500/30';
            textClass = 'text-red-400';
            icon = '❌';
        } else if (variant === 'warning') {
            bgClass = 'bg-amber-950/90';
            borderClass = 'border-amber-500/30';
            textClass = 'text-amber-400';
            icon = '⚠️';
        }

        toast.className = `px-4 py-3 rounded-xl border shadow-xl flex items-center gap-3 transform transition-all duration-300 translate-y-4 opacity-0 ${bgClass} ${borderClass}`;
        toast.innerHTML = `<span class="text-lg">${icon}</span><span class="text-sm font-bold ${textClass}">${message}</span>`;
        
        container.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.classList.remove('translate-y-4', 'opacity-0');
        });

        // Auto remove
        setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-2');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    window.SoundMasterUI = {
        confirm,
        startProgress,
        endProgress,
        showToast,
        init
    };
})();
