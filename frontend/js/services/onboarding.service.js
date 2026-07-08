/**
 * SoundMaster Pro - Onboarding Tour Service
 * Sistema de tour guiado com tooltips e spotlight.
 * Exibe dicas contextuais para novos utilizadores.
 *
 * Engenharia: Alexandre Calmon Jr.
 */
(function () {
    'use strict';

    function _el(id) {
        const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }

    const STORAGE_KEY = 'soundmaster_onboarding_done';
    const TOUR_STEP_KEY = 'soundmaster_tour_step';

    const DEFAULT_STEPS = [
        {
            id: 'welcome',
            target: null,
            position: 'center',
            title: 'Bem-vindo ao SoundMaster!',
            content: 'Este é o seu assistente de mixagem para igrejas. Vamos fazer um tour rápido de 2 minutos. Clique "Próximo" para começar.',
            icon: '🎛️'
        },
        {
            id: 'analyzer-nav',
            target: null,
            selector: 'button[data-target="analyzer"]',
            position: 'bottom',
            title: 'Analisador ao Vivo',
            content: 'Aqui você monitora o espectro do som em tempo real, detecta microfonias e ajusta o sistema.',
            icon: '📊'
        },
        {
            id: 'fft-canvas',
            target: 'fft-canvas',
            position: 'top',
            title: 'Espectro em Tempo Real',
            content: 'Este gráfico mostra a energia em cada frequência. Use-o para identificar ressonâncias e equilibrar o som.',
            icon: '📈',
            required: true
        },
        {
            id: 'mic-toggle',
            target: null,
            selector: 'button[data-target="analyzer"]',
            position: 'right',
            title: 'Ativar Microfone',
            content: 'Clique no botão para ativar o microfone RTA e começar a análise. Precisará dar permissão ao navegador.',
            icon: '🎤'
        },
        {
            id: 'rt60-nav',
            target: null,
            selector: 'button[data-target="rt60"]',
            position: 'right',
            title: 'Acústica do Salão',
            content: 'Mede o RT60 (tempo de reverberação) e o STI (inteligibilidade da fala). Ideal para ajustar o som ao ambiente.',
            icon: '📐'
        },
        {
            id: 'ai-chat-nav',
            target: null,
            selector: 'button[data-target="ai-chat"]',
            position: 'right',
            title: 'Assistente IA',
            content: 'Pergunte em linguagem natural: "como melhorar a voz?", "tem microfonia?" ou "ajustar graves".',
            icon: '🤖'
        },
        {
            id: 'settings-nav',
            target: null,
            selector: 'button[data-target="settings"]',
            position: 'right',
            title: 'Configurações',
            content: 'Calibre o microfone, configure offsets de SPL, e conecte-se à mesa de som.',
            icon: '⚙️'
        },
        {
            id: 'complete',
            target: null,
            position: 'center',
            title: 'Tour Completo!',
            content: 'Você está pronto! Lembre-se: pode usar o botão de ajuda (?) em qualquer página para rever este tour. Boa mixagem! 🎛️',
            icon: '✅'
        }
    ];

    let steps = DEFAULT_STEPS;
    let currentStepIndex = 0;
    let isActive = false;
    let overlayEl = null;
    let tooltipEl = null;
    let spotlightEl = null;
    let destroyFn = null;

    function isCompleted() {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    }

    function markCompleted() {
        localStorage.setItem(STORAGE_KEY, 'true');
    }

    function resetTour() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(TOUR_STEP_KEY);
    }

    function saveStep() {
        localStorage.setItem(TOUR_STEP_KEY, String(currentStepIndex));
    }

    function loadStep() {
        const saved = localStorage.getItem(TOUR_STEP_KEY);
        return saved ? Math.max(0, Math.min(parseInt(saved, 10), steps.length - 1)) : 0;
    }

    function _createOverlay() {
        if (overlayEl) return;
        overlayEl = document.createElement('div');
        overlayEl.id = 'tour-overlay';
        overlayEl.style.cssText = `
            position: fixed; inset: 0; z-index: 9998;
            background: rgba(0,0,0,0.75);
            backdrop-filter: blur(2px);
            pointer-events: none;
        `;
        document.body.appendChild(overlayEl);
    }

    function _removeOverlay() {
        if (overlayEl) {
            overlayEl.remove();
            overlayEl = null;
        }
    }

    function _createTooltip(step, stepIndex) {
        if (tooltipEl) tooltipEl.remove();

        tooltipEl = document.createElement('div');
        tooltipEl.id = 'tour-tooltip';
        tooltipEl.style.cssText = `
            position: fixed; z-index: 9999;
            background: #0f172a;
            border: 1px solid rgba(6,182,212,0.5);
            border-radius: 16px;
            padding: 0;
            width: 320px;
            max-width: 90vw;
            box-shadow: 0 25px 50px rgba(0,0,0,0.5), 0 0 30px rgba(6,182,212,0.15);
            font-family: system-ui, sans-serif;
            overflow: hidden;
            pointer-events: auto;
            animation: tour-tooltip-in 0.3s ease;
        `;

        const headerBg = step.id === 'complete' ? 'linear-gradient(135deg, #059669, #10b981)' : 'linear-gradient(135deg, #0e7490, #06b6d4)';

        tooltipEl.innerHTML = `
            <style>
                @keyframes tour-tooltip-in {
                    from { opacity: 0; transform: scale(0.9) translateY(10px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                #tour-tooltip .tour-header {
                    background: ${headerBg};
                    padding: 16px 20px 14px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                #tour-tooltip .tour-icon { font-size: 28px; }
                #tour-tooltip .tour-title { font-size: 14px; font-weight: 700; color: white; margin: 0; flex: 1; }
                #tour-tooltip .tour-skip {
                    background: rgba(255,255,255,0.15); border: none; color: rgba(255,255,255,0.7);
                    font-size: 10px; font-weight: 700; padding: 4px 8px; border-radius: 6px; cursor: pointer;
                }
                #tour-tooltip .tour-skip:hover { background: rgba(255,255,255,0.25); color: white; }
                #tour-tooltip .tour-body { padding: 16px 20px; }
                #tour-tooltip .tour-content { font-size: 13px; color: #cbd5e1; line-height: 1.6; margin: 0 0 16px; }
                #tour-tooltip .tour-footer {
                    padding: 12px 20px 16px;
                    display: flex; align-items: center; justify-content: space-between;
                    border-top: 1px solid rgba(255,255,255,0.05);
                }
                #tour-tooltip .tour-progress {
                    font-size: 11px; color: #64748b; font-weight: 600;
                }
                #tour-tooltip .tour-actions { display: flex; gap: 8px; }
                #tour-tooltip .tour-btn {
                    border: none; border-radius: 8px; padding: 8px 16px;
                    font-size: 12px; font-weight: 700; cursor: pointer;
                    transition: all 0.15s;
                }
                #tour-tooltip .tour-btn-prev {
                    background: rgba(255,255,255,0.05); color: #94a3b8;
                }
                #tour-tooltip .tour-btn-prev:hover { background: rgba(255,255,255,0.1); color: white; }
                #tour-tooltip .tour-btn-prev:disabled { opacity: 0.3; cursor: default; }
                #tour-tooltip .tour-btn-next {
                    background: #06b6d4; color: white;
                }
                #tour-tooltip .tour-btn-next:hover { background: #22d3ee; }
                #tour-tooltip .tour-btn-skip-all {
                    background: rgba(239,68,68,0.1); color: #f87171;
                    border: 1px solid rgba(239,68,68,0.2);
                }
                #tour-tooltip .tour-btn-skip-all:hover { background: rgba(239,68,68,0.2); }
            </style>
            <div class="tour-header">
                <span class="tour-icon">${step.icon || 'ℹ️'}</span>
                <h3 class="tour-title">${step.title}</h3>
                <button class="tour-skip" id="tour-skip">Pular</button>
            </div>
            <div class="tour-body">
                <p class="tour-content">${step.content}</p>
            </div>
            <div class="tour-footer">
                <span class="tour-progress">${stepIndex + 1} / ${steps.length}</span>
                <div class="tour-actions">
                    <button class="tour-btn tour-btn-prev" id="tour-prev" ${stepIndex === 0 ? 'disabled' : ''}>Voltar</button>
                    <button class="tour-btn tour-btn-next" id="tour-next">${step.id === 'complete' ? 'Concluir' : 'Próximo'}</button>
                </div>
            </div>
        `;

        document.body.appendChild(tooltipEl);

        _el('tour-skip').addEventListener('click', stop);
        _el('tour-prev').addEventListener('click', () => goTo(stepIndex - 1));
        _el('tour-next').addEventListener('click', () => {
            if (stepIndex < steps.length - 1) {
                saveStep();
                goTo(stepIndex + 1);
            } else {
                stop();
            }
        });

        return tooltipEl;
    }

    function _positionTooltip(tooltip, step) {
        let x = 0, y = 0;
        let targetEl = null;
        const tw = 320;

        if (step.target) {
            targetEl = _el(step.target);
        } else if (step.selector) {
            targetEl = document.querySelector(step.selector);
        }

        if (targetEl) {
            const rect = targetEl.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            switch (step.position) {
                case 'top':
                    x = rect.left + rect.width / 2 - tw / 2;
                    y = rect.bottom + 12;
                    break;
                case 'bottom':
                    x = rect.left + rect.width / 2 - tw / 2;
                    y = rect.top - 12 - 200;
                    break;
                case 'left':
                    x = rect.right + 12;
                    y = rect.top + rect.height / 2 - 100;
                    break;
                case 'right':
                    x = rect.left - tw - 12;
                    y = rect.top + rect.height / 2 - 100;
                    break;
            }

            x = Math.max(8, Math.min(x, vw - tw - 8));
            y = Math.max(8, Math.min(y, vh - 220));
        } else {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            x = vw / 2 - tw / 2;
            y = vh / 2 - 120;
        }

        tooltip.style.left = x + 'px';
        tooltip.style.top = y + 'px';
    }

    function _cutSpotlight(targetEl, overlay) {
        if (!targetEl) {
            overlay.style.clipPath = 'none';
            return;
        }
        const rect = targetEl.getBoundingClientRect();
        const pad = 6;
        const top = rect.top - pad;
        const left = rect.left - pad;
        const w = rect.width + pad * 2;
        const h = rect.height + pad * 2;

        overlay.style.clipPath = `
            polygon(
                0% 0%, 100% 0%, 100% 100%, 0% 100%,
                0% 0%,
                ${left}px ${top}px,
                ${left}px ${top + h}px,
                ${left + w}px ${top + h}px,
                ${left + w}px ${top}px,
                ${left}px ${top}px,
                0% 100%,
                0% 0%
            )
        `;
    }

    function _highlightTarget(step) {
        document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
        let targetEl = null;
        if (step.target) targetEl = _el(step.target);
        else if (step.selector) targetEl = document.querySelector(step.selector);
        if (targetEl) {
            targetEl.classList.add('tour-highlight');
        }
    }

    function _removeHighlight() {
        document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
    }

    function goTo(index) {
        if (index < 0 || index >= steps.length) return;
        currentStepIndex = index;
        const step = steps[index];

        _createOverlay();
        _removeHighlight();
        _highlightTarget(step);

        const tooltip = _createTooltip(step, index);
        _positionTooltip(tooltip, step);

        const targetEl = step.target
            ? _el(step.target)
            : step.selector ? document.querySelector(step.selector) : null;

        if (targetEl && overlayEl) {
            _cutSpotlight(targetEl, overlayEl);
        }

        tooltip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function start(fromStep) {
        if (isActive) return;
        isActive = true;
        currentStepIndex = (typeof fromStep === 'number') ? fromStep : loadStep();
        goTo(currentStepIndex);

        destroyFn = () => {
            const onKey = (e) => {
                if (e.key === 'Escape') stop();
                if (e.key === 'ArrowRight' && currentStepIndex < steps.length - 1) goTo(currentStepIndex + 1);
                if (e.key === 'ArrowLeft' && currentStepIndex > 0) goTo(currentStepIndex - 1);
            };
            document.addEventListener('keydown', onKey);
            return () => document.removeEventListener('keydown', onKey);
        };
        const cleanup = destroyFn();
        destroyFn = () => { cleanup(); destroyFn = null; };
    }

    function stop() {
        if (!isActive) return;
        isActive = false;
        markCompleted();
        localStorage.removeItem(TOUR_STEP_KEY);

        _removeHighlight();
        _removeOverlay();
        if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }

        if (destroyFn) { destroyFn(); destroyFn = null; }

        document.dispatchEvent(new CustomEvent('tour-complete'));
    }

    function showHelp(pageId) {
        const pageSteps = steps.filter(s => {
            if (!s.target && !s.selector) return false;
            return true;
        });
        if (pageSteps.length === 0) return;

        const target = pageSteps[0];
        if (!isActive) {
            start(0);
        }
    }

    function openHelpModal() {
        const existing = _el('tour-help-modal');
        if (existing) { existing.remove(); return; }

        const modal = document.createElement('div');
        modal.id = 'tour-help-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 9997;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center;
            animation: fade-in 0.2s;
        `;
        modal.innerHTML = `
            <div style="
                background: #0f172a; border: 1px solid rgba(6,182,212,0.3);
                border-radius: 16px; padding: 0; width: 360px; max-width: 90vw;
                box-shadow: 0 25px 50px rgba(0,0,0,0.5);
            ">
                <div style="
                    background: linear-gradient(135deg, #0e7490, #06b6d4);
                    padding: 20px 24px 18px;
                    border-radius: 16px 16px 0 0;
                    display: flex; align-items: center; gap: 12px;
                ">
                    <span style="font-size: 28px">🤔</span>
                    <div>
                        <h3 style="margin:0; color: white; font-size: 16px; font-weight: 700;">Precisa de ajuda?</h3>
                        <p style="margin:4px 0 0; color: rgba(255,255,255,0.7); font-size: 12px;">Escolha uma opção abaixo</p>
                    </div>
                </div>
                <div style="padding: 20px 24px; display: flex; flex-direction: column; gap: 10px;">
                    <button id="hm-start-tour" style="
                        width: 100%; padding: 12px; border: 1px solid rgba(6,182,212,0.3);
                        background: rgba(6,182,212,0.1); color: #22d3ee;
                        border-radius: 10px; font-size: 13px; font-weight: 700;
                        cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px;
                    ">
                        <span>🗺️</span> Fazer Tour Guiado (2min)
                    </button>
                    <button id="hm-reset-tour" style="
                        width: 100%; padding: 12px; border: 1px solid rgba(255,255,255,0.1);
                        background: transparent; color: #94a3b8;
                        border-radius: 10px; font-size: 13px; font-weight: 600;
                        cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px;
                    ">
                        <span>🔄</span> Repetir Tour desde o início
                    </button>
                    <a href="pages/ai-chat.html" style="
                        width: 100%; padding: 12px; border: 1px solid rgba(168,85,247,0.3);
                        background: rgba(168,85,247,0.1); color: #c084fc;
                        border-radius: 10px; font-size: 13px; font-weight: 700;
                        cursor: pointer; text-align: left; display: flex; align-items: center; gap: 10px;
                        text-decoration: none;
                    ">
                        <span>🤖</span> Perguntar ao Assistente IA
                    </a>
                </div>
                <div style="padding: 0 24px 20px;">
                    <button id="hm-close" style="
                        width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.1);
                        background: transparent; color: #64748b;
                        border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
                    ">Fechar</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.id === 'hm-close') modal.remove();
        });
        _el('hm-start-tour').addEventListener('click', () => {
            modal.remove();
            resetTour();
            start(0);
        });
        _el('hm-reset-tour').addEventListener('click', () => {
            modal.remove();
            resetTour();
            start(0);
        });
    }

    function init() {
        if (isCompleted()) return;

        setTimeout(() => {
            if (!isActive) start(0);
        }, 1500);
    }

    window.SoundMasterTour = {
        start,
        stop,
        showHelp,
        openHelpModal,
        resetTour,
        isCompleted,
        init
    };
})();