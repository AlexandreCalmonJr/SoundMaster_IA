/**
 * SoundMaster — Mixer Discovery Service (Frontend)
 * =================================================
 * Escuta o evento 'mixer_discovered' do servidor e exibe um banner
 * de notificação convidando o usuário a conectar automaticamente.
 *
 * Integra-se ao SocketService e MixerService existentes.
 *
 * Uso automático: basta incluir este script após socket.service.js.
 * O serviço inicia sozinho ao detectar que nenhuma mesa está conectada.
 */
(function () {
    'use strict';

    // ─── Estado ───────────────────────────────────────────────────────────────

    let _bannerEl        = null;
    let _scanning        = false;
    let _lastDiscovered  = null;
    let _autoConnectTimer = null;
    let _initialized     = false;

    // Segundos para auto-conexão (0 = desabilitado)
    const AUTO_CONNECT_DELAY_S = 8;

    // ─── Inicialização ────────────────────────────────────────────────────────

    function init() {
        if (_initialized) return;
        _initialized = true;

        _injectStyles();
        _createBanner();
        _bindSocketEvents();

        // Solicita ao servidor que inicie a varredura
        if (typeof SocketService !== 'undefined' && SocketService.isConnected()) {
            _requestScan();
        } else {
            // Aguarda a conexão Socket.IO estar pronta
            document.addEventListener('socket_connected', _requestScan, { once: true });
            window.addEventListener('socket_ready', _requestScan, { once: true });
        }

        console.log('[Discovery] Serviço de descoberta iniciado no frontend.');
    }

    function _requestScan() {
        if (typeof SocketService !== 'undefined') {
            SocketService.emit('start_discovery');
        }
    }

    // ─── Eventos Socket.IO ────────────────────────────────────────────────────

    function _bindSocketEvents() {
        if (typeof SocketService === 'undefined') {
            // Fallback: tenta de novo em 1s
            setTimeout(_bindSocketEvents, 1000);
            return;
        }

        SocketService.on('mixer_discovered', _onMixerDiscovered);
        SocketService.on('discovery_status', _onDiscoveryStatus);
        SocketService.on('mixer_status',     _onMixerStatus);
    }

    /**
     * Chamado quando o servidor encontra uma mesa na rede.
     * @param {{ ip, model, confidence, method, ts }} data
     */
    function _onMixerDiscovered(data) {
        if (!data || !data.ip) return;

        // Se já está conectado a esta mesa, ignora
        const currentState = typeof AppStore !== 'undefined' ? AppStore.getState() : {};
        if (currentState.mixerConnected && currentState.mixerIp === data.ip) return;

        _lastDiscovered = data;
        _showDiscoveredBanner(data);
    }

    function _onDiscoveryStatus(data) {
        _scanning = !!data.scanning;
        _updateScanIndicator();
    }

    function _onMixerStatus(data) {
        if (data && data.connected) {
            // Mesa conectada — esconde o banner
            _hideBanner();
            _clearAutoConnect();
        }
    }

    // ─── Banner UI ────────────────────────────────────────────────────────────

    function _createBanner() {
        _bannerEl = document.createElement('div');
        _bannerEl.id = 'mixer-discovery-banner';
        _bannerEl.setAttribute('role', 'alert');
        _bannerEl.setAttribute('aria-live', 'polite');
        _bannerEl.style.display = 'none';
        document.body.appendChild(_bannerEl);
    }

    function _showDiscoveredBanner(data) {
        if (!_bannerEl) return;

        const confidence = data.confidence || 0;
        const methodLabel = {
            'gateway_fingerprint': '🔗 Rede direta da mesa',
            'known_ip':            '📋 IP conhecido',
            'subnet_scan':         '🔍 Varredura de rede',
        }[data.method] || '🔍 Rede local';

        const confColor = confidence >= 80 ? '#22c55e' : confidence >= 50 ? '#f59e0b' : '#94a3b8';

        _bannerEl.innerHTML = `
            <div class="discovery-icon">📡</div>
            <div class="discovery-content">
                <div class="discovery-title">Mesa encontrada!</div>
                <div class="discovery-info">
                    <span class="discovery-model">${_escHtml(data.model)}</span>
                    <span class="discovery-ip">${_escHtml(data.ip)}</span>
                </div>
                <div class="discovery-meta">
                    <span class="discovery-method">${methodLabel}</span>
                    <span class="discovery-confidence" style="color:${confColor}">
                        ${confidence}% de confiança
                    </span>
                </div>
                ${AUTO_CONNECT_DELAY_S > 0 ? `
                <div class="discovery-autoconnect" id="disc-autoconnect-msg">
                    Conectando automaticamente em <strong id="disc-countdown">${AUTO_CONNECT_DELAY_S}</strong>s…
                </div>` : ''}
            </div>
            <div class="discovery-actions">
                <button id="disc-btn-connect" class="disc-btn disc-btn-primary" aria-label="Conectar à mesa">
                    Conectar agora
                </button>
                <button id="disc-btn-dismiss" class="disc-btn disc-btn-secondary" aria-label="Ignorar">
                    Ignorar
                </button>
            </div>
            <button id="disc-btn-close" class="disc-close" aria-label="Fechar">✕</button>
        `;

        _bannerEl.style.display = 'flex';

        // Anima a entrada
        requestAnimationFrame(() => {
            _bannerEl.classList.add('discovery-visible');
        });

        // Handlers de botões
        document.getElementById('disc-btn-connect')?.addEventListener('click', () => {
            _connectTo(data.ip);
        });

        document.getElementById('disc-btn-dismiss')?.addEventListener('click', () => {
            _hideBanner();
            _clearAutoConnect();
        });

        document.getElementById('disc-btn-close')?.addEventListener('click', () => {
            _hideBanner();
            _clearAutoConnect();
        });

        // Auto-conexão com countdown
        if (AUTO_CONNECT_DELAY_S > 0) {
            _startAutoConnect(data.ip, AUTO_CONNECT_DELAY_S);
        }
    }

    function _hideBanner() {
        if (!_bannerEl) return;
        _bannerEl.classList.remove('discovery-visible');
        setTimeout(() => {
            if (_bannerEl) _bannerEl.style.display = 'none';
        }, 350);
    }

    function _updateScanIndicator() {
        const indicator = document.getElementById('discovery-scan-indicator');
        if (!indicator) return;
        indicator.style.display = _scanning ? 'flex' : 'none';
    }

    // ─── Auto-conexão ─────────────────────────────────────────────────────────

    function _startAutoConnect(ip, seconds) {
        let remaining = seconds;

        _autoConnectTimer = setInterval(() => {
            remaining--;
            const el = document.getElementById('disc-countdown');
            if (el) el.textContent = remaining;

            if (remaining <= 0) {
                _clearAutoConnect();
                _connectTo(ip);
            }
        }, 1000);
    }

    function _clearAutoConnect() {
        if (_autoConnectTimer) {
            clearInterval(_autoConnectTimer);
            _autoConnectTimer = null;
        }
    }

    function _connectTo(ip) {
        _hideBanner();
        _clearAutoConnect();

        if (typeof MixerService !== 'undefined') {
            MixerService.connect(ip, 'soundcraft');
        } else if (typeof SocketService !== 'undefined') {
            SocketService.emit('connect_mixer', { ip, brand: 'soundcraft' });
        }

        if (typeof AppStore !== 'undefined') {
            AppStore.addLog(`🔌 Conectando à mesa em ${ip}...`);
        }
    }

    // ─── API Pública ──────────────────────────────────────────────────────────

    /**
     * Força uma varredura manual (chamado pelo botão "Escanear" da UI).
     */
    function scanNow() {
        if (typeof SocketService !== 'undefined') {
            SocketService.emit('scan_now');
            _scanning = true;
            _updateScanIndicator();
        }
    }

    /**
     * Retorna o último dispositivo descoberto.
     */
    function getLastDiscovered() {
        return _lastDiscovered;
    }

    // ─── Estilos CSS injetados ────────────────────────────────────────────────

    function _injectStyles() {
        if (document.getElementById('discovery-styles')) return;

        const style = document.createElement('style');
        style.id = 'discovery-styles';
        style.textContent = `
            /* ── Discovery Banner ──────────────────────────────────── */
            #mixer-discovery-banner {
                position: fixed;
                bottom: 1.5rem;
                left: 50%;
                transform: translateX(-50%) translateY(120%);
                z-index: 9999;
                display: none;
                align-items: center;
                gap: 1rem;
                padding: 1rem 1.25rem;
                width: min(480px, calc(100vw - 2rem));
                background: linear-gradient(135deg,
                    rgba(15, 23, 42, 0.98) 0%,
                    rgba(21, 34, 56, 0.98) 100%);
                border: 1px solid rgba(6, 182, 212, 0.35);
                border-radius: 1rem;
                box-shadow:
                    0 0 0 1px rgba(6, 182, 212, 0.1),
                    0 20px 60px rgba(0, 0, 0, 0.6),
                    0 0 40px rgba(6, 182, 212, 0.08);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
                            opacity 0.35s ease;
                opacity: 0;
                font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            }

            #mixer-discovery-banner.discovery-visible {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
            }

            .discovery-icon {
                font-size: 2rem;
                flex-shrink: 0;
                filter: drop-shadow(0 0 8px rgba(6, 182, 212, 0.6));
                animation: discovery-pulse 2s ease-in-out infinite;
            }

            @keyframes discovery-pulse {
                0%, 100% { transform: scale(1); }
                50%       { transform: scale(1.12); }
            }

            .discovery-content {
                flex: 1;
                min-width: 0;
            }

            .discovery-title {
                font-size: 0.85rem;
                font-weight: 600;
                color: rgba(6, 182, 212, 0.9);
                text-transform: uppercase;
                letter-spacing: 0.08em;
                margin-bottom: 0.25rem;
            }

            .discovery-info {
                display: flex;
                align-items: center;
                gap: 0.5rem;
                flex-wrap: wrap;
            }

            .discovery-model {
                font-size: 1rem;
                font-weight: 700;
                color: #f1f5f9;
            }

            .discovery-ip {
                font-size: 0.8rem;
                color: rgba(148, 163, 184, 0.8);
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
                background: rgba(255,255,255,0.06);
                padding: 0.1rem 0.4rem;
                border-radius: 0.25rem;
            }

            .discovery-meta {
                display: flex;
                gap: 0.75rem;
                margin-top: 0.2rem;
                font-size: 0.72rem;
                color: rgba(148, 163, 184, 0.7);
            }

            .discovery-autoconnect {
                margin-top: 0.4rem;
                font-size: 0.75rem;
                color: rgba(148, 163, 184, 0.6);
            }

            .discovery-autoconnect strong {
                color: rgba(6, 182, 212, 0.9);
                font-size: 0.9rem;
            }

            .discovery-actions {
                display: flex;
                flex-direction: column;
                gap: 0.4rem;
                flex-shrink: 0;
            }

            .disc-btn {
                padding: 0.4rem 0.9rem;
                border-radius: 0.5rem;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
                border: none;
                transition: all 0.15s ease;
                white-space: nowrap;
            }

            .disc-btn-primary {
                background: linear-gradient(135deg, #06b6d4, #0891b2);
                color: #fff;
                box-shadow: 0 2px 8px rgba(6, 182, 212, 0.35);
            }

            .disc-btn-primary:hover {
                background: linear-gradient(135deg, #22d3ee, #06b6d4);
                box-shadow: 0 4px 12px rgba(6, 182, 212, 0.5);
                transform: translateY(-1px);
            }

            .disc-btn-secondary {
                background: rgba(255,255,255,0.07);
                color: rgba(148, 163, 184, 0.8);
            }

            .disc-btn-secondary:hover {
                background: rgba(255,255,255,0.12);
                color: #f1f5f9;
            }

            .disc-close {
                position: absolute;
                top: 0.6rem;
                right: 0.6rem;
                background: none;
                border: none;
                color: rgba(148, 163, 184, 0.5);
                cursor: pointer;
                font-size: 0.8rem;
                padding: 0.25rem;
                border-radius: 0.25rem;
                transition: color 0.15s;
            }

            .disc-close:hover { color: #f1f5f9; }

            /* ── Indicador de Scan ────────────────────────────────── */
            #discovery-scan-indicator {
                display: none;
                align-items: center;
                gap: 0.4rem;
                font-size: 0.72rem;
                color: rgba(148, 163, 184, 0.5);
            }

            .discovery-spinner {
                width: 10px;
                height: 10px;
                border: 2px solid rgba(6, 182, 212, 0.2);
                border-top-color: rgba(6, 182, 212, 0.8);
                border-radius: 50%;
                animation: discovery-spin 0.8s linear infinite;
            }

            @keyframes discovery-spin {
                to { transform: rotate(360deg); }
            }

            @media (max-width: 480px) {
                #mixer-discovery-banner {
                    flex-direction: column;
                    bottom: 0.75rem;
                }
                .discovery-actions {
                    flex-direction: row;
                    width: 100%;
                }
                .disc-btn { flex: 1; text-align: center; }
            }
        `;

        document.head.appendChild(style);
    }

    // ─── Utils ────────────────────────────────────────────────────────────────

    function _escHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ─── Export Global ────────────────────────────────────────────────────────

    window.MixerDiscoveryService = {
        init,
        scanNow,
        getLastDiscovered,
    };

    // Auto-inicializa quando o DOM estiver pronto
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Pequeno delay para garantir que SocketService já está disponível
        setTimeout(init, 500);
    }

})();
