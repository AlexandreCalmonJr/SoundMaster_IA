/**
 * SoundMaster — VolunteerMode Service (Tópico 15)
 * =================================================
 * Sistema de permissões de dois níveis:
 *   'technician' → UI completa (padrão)
 *   'volunteer'  → UI segura: sidebar filtrada, fader limitado, PIN para sair
 *
 * API pública (window.VolunteerMode):
 *   .toggle()             — alterna entre os dois modos
 *   .enter(pin?)          — entra em modo voluntário
 *   .exit(pin)            — sai para modo técnico (requer PIN se configurado)
 *   .setChannels([1,2,3]) — define canais visíveis no modo voluntário
 *   .setPin(pin)          — define PIN de saída (null = sem PIN)
 *   .clampFader(value)    — retorna valor clampado ao teto definido
 *   .isVolunteer()        — boolean
 */

'use strict';

(function () {

    function _el(id) {
        const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    // ── Categorias e rotas bloqueadas em modo voluntário ──────────────────────
    const BLOCKED_CATEGORIES = ['measure', 'analysis', 'network', 'settings'];
    const BLOCKED_ROUTES     = [
        'rt60', 'benchmarking', 'spl-heatmap',
        'analyzer', 'feedback-detector', 'eq-guide', 'eq', 'auto-eq', 'mixer-git',
        'aes67', 'systems', 'debug', 'settings',
    ];

    // ── Canal configs padrão (nome, ícone) ────────────────────────────────────
    const CHANNEL_PRESETS = {
        1:  { name: 'Pastor',    icon: '🎤' },
        2:  { name: 'Louvor',    icon: '🎵' },
        3:  { name: 'Playback',  icon: '▶️'  },
        4:  { name: 'Coral',     icon: '🎶' },
        5:  { name: 'Violão',    icon: '🎸' },
        6:  { name: 'Teclado',   icon: '🎹' },
        7:  { name: 'Bateria',   icon: '🥁' },
        8:  { name: 'Baixo',     icon: '🎸' },
    };

    let _pin = localStorage.getItem('sm-volunteer-pin') || null;

    // ─── CSS dinâmico injetado uma vez ───────────────────────────────────────
    function _injectCSS() {
        if (_el('volunteer-mode-css')) return;
        const style = document.createElement('style');
        style.id = 'volunteer-mode-css';
        style.textContent = `
        /* ── Volunteer Mode Global ──────────────────────────────────── */
        body.volunteer-mode .rail-btn[data-category="measure"],
        body.volunteer-mode .rail-btn[data-category="analysis"],
        body.volunteer-mode .rail-btn[data-category="network"],
        body.volunteer-mode .rail-btn[data-category="settings"] {
            display: none !important;
        }

        /* Banner de modo voluntário no header */
        #volunteer-badge {
            display: none;
            align-items: center;
            gap: 6px;
            background: linear-gradient(135deg, #f59e0b, #d97706);
            color: #0d1117;
            border-radius: 999px;
            padding: 3px 12px;
            font-size: .72rem;
            font-weight: 800;
            letter-spacing: .04em;
            text-transform: uppercase;
            animation: vbadge-in .3s cubic-bezier(.34,1.56,.64,1);
            cursor: pointer;
        }
        body.volunteer-mode #volunteer-badge { display: flex; }
        @keyframes vbadge-in {
            from { opacity:0; transform:scale(.7); }
            to   { opacity:1; transform:scale(1); }
        }

        /* Toggle button states */
        #btn-volunteer-toggle.active {
            background: linear-gradient(135deg, #f59e0b, #d97706) !important;
            color: #0d1117 !important;
        }

        /* Fader ceiling indicator */
        body.volunteer-mode .fader-ceiling-line {
            display: block !important;
        }
        .fader-ceiling-line {
            display: none;
            position: absolute;
            left: 0; right: 0;
            height: 2px;
            background: #f59e0b;
            border-radius: 2px;
            z-index: 10;
            pointer-events: none;
        }
        .fader-ceiling-line::after {
            content: '0dB';
            position: absolute;
            right: 2px;
            top: -14px;
            font-size: 9px;
            color: #f59e0b;
            font-weight: 700;
        }

        /* Volunteer mixer overlay */
        #volunteer-mixer-overlay {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 200;
            background: #0d1117;
            overflow-y: auto;
        }
        body.volunteer-mode #volunteer-mixer-overlay { display: flex; flex-direction: column; }

        /* PIN modal */
        #volunteer-pin-modal {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 300;
            background: rgba(0,0,0,.85);
            backdrop-filter: blur(6px);
            align-items: center;
            justify-content: center;
        }
        #volunteer-pin-modal.open { display: flex; }
        .pin-box {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 16px;
            padding: 32px;
            width: 300px;
            text-align: center;
        }
        .pin-box h2 { font-size: 1.1rem; font-weight: 700; margin-bottom: 8px; color: #c9d1d9; }
        .pin-box p  { font-size: .78rem; color: #8b949e; margin-bottom: 20px; }
        .pin-dots   { display: flex; justify-content: center; gap: 12px; margin-bottom: 20px; }
        .pin-dot    { width: 14px; height: 14px; border-radius: 50%; background: #30363d; transition: .2s; }
        .pin-dot.filled { background: #f59e0b; }
        .pin-numpad { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-bottom: 16px; }
        .pin-key {
            background: #1c2128; border: 1px solid #30363d; border-radius: 8px;
            padding: 14px; font-size: 1.1rem; font-weight: 700; color: #c9d1d9;
            cursor: pointer; transition: .12s;
        }
        .pin-key:hover { background: #2d333b; border-color: #58a6ff; }
        .pin-key.danger { color: #f85149; }
        .pin-error { color: #f85149; font-size: .75rem; min-height: 16px; }
        `;
        document.head.appendChild(style);
    }

    // ─── Criar overlay de modo voluntário ────────────────────────────────────
    function _buildOverlay() {
        if (_el('volunteer-mixer-overlay')) return;

        // Overlay principal
        const overlay = document.createElement('div');
        overlay.id = 'volunteer-mixer-overlay';
        overlay.innerHTML = `
        <div style="padding:20px;max-width:680px;margin:0 auto;width:100%;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                <div style="background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:12px;padding:8px;font-size:1.4rem;">🎛️</div>
                <div>
                    <div style="font-size:1.1rem;font-weight:800;color:#c9d1d9;">Modo Voluntário</div>
                    <div style="font-size:.75rem;color:#8b949e;">Controles simplificados e seguros</div>
                </div>
                <button id="volunteer-exit-btn" style="margin-left:auto;padding:7px 14px;border-radius:7px;
                    border:1px solid #30363d;background:transparent;color:#8b949e;cursor:pointer;font-size:.78rem;font-weight:600;">
                    🔒 Modo Técnico
                </button>
            </div>

            <!-- SPL Badge -->
            <div id="vol-spl-badge" style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;"></div>

            <!-- Channel grid -->
            <div id="vol-channel-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;"></div>

            <!-- Master -->
            <div style="margin-top:24px;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:16px;">
                <div style="font-size:.75rem;color:#8b949e;margin-bottom:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Master</div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <div id="vol-master-vu" style="width:8px;height:80px;background:#21262d;border-radius:4px;position:relative;overflow:hidden;">
                        <div id="vol-master-vu-fill" style="position:absolute;bottom:0;left:0;right:0;border-radius:4px;background:linear-gradient(to top,#3fb950,#e3b341,#f85149);height:0%;transition:height .1s;"></div>
                    </div>
                    <div style="flex:1;position:relative;">
                        <input type="range" id="vol-master-fader" min="0" max="100" value="85"
                            style="width:100%;accent-color:#58a6ff;cursor:pointer;">
                        <div style="display:flex;justify-content:space-between;font-size:.65rem;color:#8b949e;margin-top:4px;">
                            <span>-∞</span><span>0dB</span><span>+10dB</span>
                        </div>
                    </div>
                    <button id="vol-master-mute" style="width:44px;height:44px;border-radius:8px;border:1px solid #30363d;
                        background:#1c2128;color:#c9d1d9;font-size:.8rem;font-weight:700;cursor:pointer;">M</button>
                </div>
            </div>

            <p style="text-align:center;font-size:.7rem;color:#8b949e;margin-top:16px;">
                ⚠️ Faders limitados a 0dB para proteger o sistema de som.
            </p>
        </div>`;
        document.body.appendChild(overlay);

        // PIN modal
        const pinModal = document.createElement('div');
        pinModal.id = 'volunteer-pin-modal';
        pinModal.innerHTML = `
        <div class="pin-box">
            <h2>🔐 Modo Técnico</h2>
            <p>Digite o PIN para desbloquear todos os controles.</p>
            <div class="pin-dots" id="pin-dots">
                <div class="pin-dot"></div><div class="pin-dot"></div>
                <div class="pin-dot"></div><div class="pin-dot"></div>
            </div>
            <div class="pin-numpad" id="pin-numpad">
                ${[1,2,3,4,5,6,7,8,9,'✕',0,'←'].map(k => `
                    <button class="pin-key ${k==='✕'?'danger':''}" data-key="${k}">${k}</button>
                `).join('')}
            </div>
            <div class="pin-error" id="pin-error"></div>
        </div>`;
        document.body.appendChild(pinModal);

        _bindOverlayEvents();
    }

    // ─── Bind eventos do overlay ──────────────────────────────────────────────
    function _bindOverlayEvents() {
        // Exit button
        _el('volunteer-exit-btn')?.addEventListener('click', () => {
            if (_pin) _openPinModal(); else _exitVolunteer();
        });

        // Master fader
        const masterFader = _el('vol-master-fader');
        masterFader?.addEventListener('input', (e) => {
            const raw = parseInt(e.target.value) / 100;
            const clamped = clampFader(raw);
            if (raw > clamped) e.target.value = Math.round(clamped * 100);
            if (window.socket) window.socket.emit('set_master_level', { level: clamped });
        });

        // Master mute
        _el('vol-master-mute')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const isMuted = btn.classList.toggle('muted');
            btn.style.background = isMuted ? '#f85149' : '#1c2128';
            btn.style.color = isMuted ? '#fff' : '#c9d1d9';
            if (window.socket) window.socket.emit('set_master_mute', { mute: isMuted });
        });

        // PIN numpad
        let _pinBuffer = '';
        _el('pin-numpad')?.addEventListener('click', (e) => {
            const key = e.target.closest('.pin-key')?.dataset.key;
            if (!key) return;
            if (key === '✕') { _pinBuffer = ''; _updatePinDots(); _el('pin-error').textContent = ''; return; }
            if (key === '←') { _pinBuffer = _pinBuffer.slice(0,-1); _updatePinDots(); return; }
            if (_pinBuffer.length >= 4) return;
            _pinBuffer += key;
            _updatePinDots();
            if (_pinBuffer.length === 4) {
                if (_pinBuffer === _pin) {
                    _closePinModal(); _pinBuffer = ''; _exitVolunteer();
                } else {
                    _el('pin-error').textContent = 'PIN incorreto. Tente novamente.';
                    setTimeout(() => { _pinBuffer = ''; _updatePinDots(); _el('pin-error').textContent = ''; }, 1200);
                }
            }
        });

        function _updatePinDots() {
            document.querySelectorAll('#pin-dots .pin-dot').forEach((dot, i) => {
                dot.classList.toggle('filled', i < _pinBuffer.length);
            });
        }
    }

    // ─── Render canal no overlay voluntário ──────────────────────────────────
    function _renderVolunteerChannels() {
        const grid = _el('vol-channel-grid');
        if (!grid) return;
        const channels = AppStore.getState().volunteerChannels;

        grid.innerHTML = channels.map(ch => {
            const preset = CHANNEL_PRESETS[ch] || { name: `Canal ${ch}`, icon: '🎚️' };
            return `
            <div style="background:#161b22;border:1px solid #30363d;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:1.2rem">${preset.icon}</span>
                    <span style="font-size:.82rem;font-weight:700;color:#c9d1d9;">${preset.name}</span>
                    <span style="font-size:.65rem;color:#8b949e;margin-left:auto;">CH${ch}</span>
                </div>
                <!-- Mini fader vertical (representação) -->
                <div style="display:flex;gap:8px;align-items:flex-end;height:80px;">
                    <div style="flex:1;background:#21262d;border-radius:4px;height:100%;position:relative;cursor:pointer;" title="Arraste para ajustar">
                        <div id="vol-ch${ch}-fill" style="position:absolute;bottom:0;left:0;right:0;border-radius:4px;
                            background:linear-gradient(to top,#3fb950,#e3b341);height:70%;transition:.2s;"></div>
                        <input type="range" orient="vertical" id="vol-ch${ch}-fader"
                            min="0" max="100" value="70" data-ch="${ch}"
                            style="position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;"
                            title="${preset.name}">
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <button class="vol-ch-mute" data-ch="${ch}" style="width:32px;height:32px;border-radius:6px;border:1px solid #30363d;
                            background:#1c2128;color:#8b949e;font-size:.65rem;font-weight:700;cursor:pointer;">M</button>
                        <div id="vol-ch${ch}-vu" style="width:6px;height:40px;background:#21262d;border-radius:3px;overflow:hidden;">
                            <div style="height:0%;background:#3fb950;transition:.1s;"></div>
                        </div>
                    </div>
                </div>
                <div style="font-size:.65rem;color:#8b949e;text-align:center;" id="vol-ch${ch}-db">— dB</div>
            </div>`;
        }).join('');

        // Bind fader events
        grid.querySelectorAll('input[type="range"]').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const ch  = parseInt(e.target.dataset.ch);
                const raw = parseInt(e.target.value) / 100;
                const clamped = clampFader(raw);
                if (raw > clamped) e.target.value = Math.round(clamped * 100);
                // Update fill visual
                const fill = _el(`vol-ch${ch}-fill`);
                if (fill) fill.style.height = (clamped * 100) + '%';
                // Send to mixer
                if (window.socket) window.socket.emit('set_channel_level', { channel: ch, level: clamped });
                _el(`vol-ch${ch}-db`).textContent = _levelToDb(clamped);
            });
        });

        // Bind mute events
        grid.querySelectorAll('.vol-ch-mute').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const ch = parseInt(e.currentTarget.dataset.ch);
                const muted = e.currentTarget.classList.toggle('muted');
                e.currentTarget.style.background = muted ? '#f85149' : '#1c2128';
                e.currentTarget.style.color = muted ? '#fff' : '#8b949e';
                if (window.socket) window.socket.emit('set_channel_mute', { channel: ch, mute: muted });
            });
        });
    }

    // ─── Entrar / Sair ────────────────────────────────────────────────────────
    function _enterVolunteer() {
        document.body.classList.add('volunteer-mode');
        AppStore.setState({ userMode: 'volunteer' });
        localStorage.setItem('sm-user-mode', 'volunteer');

        // Navegar para home seguro
        if (window.router && BLOCKED_ROUTES.includes(window.router.currentPage)) {
            window.router.navigate('home');
        }

        // Fechar sidebar avançada
        const panel = _el('category-panel');
        panel?.classList.remove('open');

        _buildOverlay();
        _renderVolunteerChannels();
        _updateToggleBtn();

        console.log('[VolunteerMode] Ativado.');
    }

    function _exitVolunteer() {
        document.body.classList.remove('volunteer-mode');
        AppStore.setState({ userMode: 'technician' });
        localStorage.setItem('sm-user-mode', 'technician');
        _updateToggleBtn();
        console.log('[VolunteerMode] Desativado.');
    }

    function _openPinModal() {
        _el('volunteer-pin-modal')?.classList.add('open');
    }
    function _closePinModal() {
        _el('volunteer-pin-modal')?.classList.remove('open');
        document.querySelectorAll('#pin-dots .pin-dot').forEach(d => d.classList.remove('filled'));
    }

    function _updateToggleBtn() {
        const btn = _el('btn-volunteer-toggle');
        if (!btn) return;
        const isVol = AppStore.getState().userMode === 'volunteer';
        btn.classList.toggle('active', isVol);
        btn.title = isVol ? 'Modo Voluntário ativo — clique para desbloquear' : 'Ativar Modo Voluntário';
        btn.innerHTML = isVol
            ? `<span style="font-size:.95rem">🛡️</span>`
            : `<span style="font-size:.95rem">👤</span>`;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    function clampFader(value) {
        const isVolunteer = AppStore.getState().userMode === 'volunteer';
        if (!isVolunteer) return value;
        return Math.min(value, AppStore.getState().faderCeiling);
    }

    function _levelToDb(level) {
        if (level <= 0) return '-∞';
        const db = 20 * Math.log10(level) + 10; // offset Ui24R
        return (db >= 0 ? '+' : '') + db.toFixed(1) + ' dB';
    }

    // ─── Injetar botão no header ───────────────────────────────────────────────
    function _injectHeaderButton() {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight || _el('btn-volunteer-toggle')) return;

        // Badge "VOLUNTÁRIO" visível só em modo voluntário
        const badge = document.createElement('div');
        badge.id = 'volunteer-badge';
        badge.innerHTML = '🛡️ Modo Voluntário';
        badge.addEventListener('click', () => {
            if (_pin) _openPinModal(); else _exitVolunteer();
        });
        headerRight.prepend(badge);

        // Botão toggle
        const btn = document.createElement('button');
        btn.id = 'btn-volunteer-toggle';
        btn.className = 'header-btn';
        btn.style.cssText = 'transition:.15s;border-radius:7px;padding:5px 8px;';
        btn.innerHTML = `<span style="font-size:.95rem">👤</span>`;
        btn.addEventListener('click', () => {
            const isVol = AppStore.getState().userMode === 'volunteer';
            if (isVol) {
                if (_pin) _openPinModal(); else _exitVolunteer();
            } else {
                _enterVolunteer();
            }
        });
        headerRight.prepend(btn);

        _updateToggleBtn();
    }

    // ─── API pública ──────────────────────────────────────────────────────────
    function toggle() {
        const isVol = AppStore.getState().userMode === 'volunteer';
        if (isVol) { if (_pin) _openPinModal(); else _exitVolunteer(); }
        else _enterVolunteer();
    }

    function enter() { _enterVolunteer(); }

    function exit(pin) {
        if (_pin && pin !== _pin) { console.warn('[VolunteerMode] PIN incorreto.'); return false; }
        _exitVolunteer();
        return true;
    }

    function setChannels(channels) {
        AppStore.setState({ volunteerChannels: channels });
        localStorage.setItem('sm-volunteer-channels', JSON.stringify(channels));
        if (AppStore.getState().userMode === 'volunteer') _renderVolunteerChannels();
    }

    function setPin(pin) {
        _pin = pin ? String(pin) : null;
        if (_pin) localStorage.setItem('sm-volunteer-pin', _pin);
        else localStorage.removeItem('sm-volunteer-pin');
    }

    function isVolunteer() {
        return AppStore.getState().userMode === 'volunteer';
    }

    window.VolunteerMode = { toggle, enter, exit, setChannels, setPin, isVolunteer, clampFader };

    // ─── Auto-init ────────────────────────────────────────────────────────────
    function _init() {
        _injectCSS();
        _injectHeaderButton();
        // Restaurar modo salvo
        if (AppStore.getState().userMode === 'volunteer') {
            _buildOverlay();
            _enterVolunteer();
        }
    }

    // Aguarda o DOM estar pronto e o layout inicializado
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        // Layout pode ainda não estar pronto (sidebar carregada async)
        document.addEventListener('page-loaded', () => {
            if (!_el('btn-volunteer-toggle')) _init();
        }, { once: true });
        setTimeout(_init, 500); // fallback
    }

})();
