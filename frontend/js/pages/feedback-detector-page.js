/**
 * =============================================================================
 * SoundMaster — Página de Detector de Feedback (Microfonia)
 * =============================================================================
 *
 * Descrição:
 *     Módulo de monitoramento em tempo real para detecção de feedback
 *     (microfonia) em sistemas de PA. Exibe alarmes visuais quando uma
 *     frequência ressonante é detectada e mantém histórico das ocorrências.
 *
 * Funcionalidades:
 *     - Monitoramento em tempo real de frequências de feedback
 *     - Indicador visual de status (seguro/alerta) com animação
 *     - Exibição da frequência crítica detectada em Hz
 *     - Histórico das últimas 10 ocorrências com timestamp
 *     - Descrição do problema e orientação para correção
 *     - Atualização automática via assinatura do AppStore
 *
 * Estados do Sistema:
 *     - Seguro: Ícone verde "✅", texto "Sistema Seguro"
 *     - Alerta: Ícone vermelho pulsante "🚨", texto "Feedback Detectado!"
 *               com frequência e instrução de corte
 *
 * Dependências:
 *     - AppStore: Store global (estado: feedbackHz)
 *     - createPageModule(): Módulo base de páginas
 *
 * Integrações:
 *     - Assina mudanças no AppStore.feedbackHz via pm._subscribe()
 *     - Atualiza UI automaticamente quando detector identifica feedback
 *     - Fornece dados históricos para análise de tendências
 *
 * Uso:
 *     Para inicializar: FeedbackDetectorPage.init()
 *     Para destruir: FeedbackDetectorPage.destroy()
 *
 * Variável Global:
 *     window.FeedbackDetectorPage - Objeto público com init() e destroy()
 * =============================================================================
 */

'use strict';

(function () {
    const pm = createPageModule();
    let history = [];

    function updateUI(hz) {
        const iconEl = pm._el('feedback-status-icon');
        const textEl = pm._el('feedback-status-text');
        const descEl = pm._el('feedback-status-desc');
        const listEl = pm._el('feedback-frequencies-list');

        if (hz) {
            // Update icon and text to show warning
            if (iconEl) {
                iconEl.className = 'w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mb-6 animate-pulse';
                iconEl.innerHTML = '<span class="text-4xl" aria-label="Perigo">🚨</span>';
            }
            if (textEl) {
                textEl.innerText = 'Feedback Detectado!';
                textEl.className = 'text-xl font-black text-red-500 mb-2';
            }
            if (descEl) {
                descEl.innerText = `Pico ressonante detectado em ${hz} Hz. Corte a frequência correspondente na mesa.`;
                descEl.className = 'text-xs text-red-400 leading-relaxed';
            }

            // Add to local history
            const time = new Date().toLocaleTimeString('pt-BR');
            if (history.length === 0 || history[0].hz !== hz) {
                history.unshift({ hz, time });
                history = history.slice(0, 10); // Keep last 10
            }
        } else {
            // Safe state
            if (iconEl) {
                iconEl.className = 'w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mb-6';
                iconEl.innerHTML = '<span class="text-4xl" aria-label="Seguro">✅</span>';
            }
            if (textEl) {
                textEl.innerText = 'Sistema Seguro';
                textEl.className = 'text-xl font-black text-white mb-2';
            }
            if (descEl) {
                descEl.innerText = 'Nenhuma frequência de feedback detectada nos últimos instantes.';
                descEl.className = 'text-xs text-slate-500 leading-relaxed';
            }
        }

        // Render history list
        if (listEl) {
            if (history.length === 0) {
                listEl.innerHTML = `
                    <div class="flex items-center justify-center h-48 opacity-20">
                        <p class="text-xs font-black uppercase tracking-widest text-white">Nenhum feedback detectado recente</p>
                    </div>
                `;
            } else {
                listEl.innerHTML = history.map(item => `
                    <div class="flex items-center justify-between p-4 bg-black/30 rounded-xl border border-red-500/20">
                        <div class="flex items-center gap-4">
                            <span class="text-red-500">🚨</span>
                            <div>
                                <span class="text-sm font-black text-white">${item.hz} Hz</span>
                                <span class="text-[10px] text-slate-500 block">Frequência crítica de microfonia</span>
                            </div>
                        </div>
                        <span class="text-[10px] font-mono text-slate-500">${item.time}</span>
                    </div>
                `).join('');
            }
        }
    }

    function init() {
        // Subscribe to global feedback frequency changes
        pm._subscribe('AppStore', 'feedbackHz', (hz) => {
            updateUI(hz);
        });

        // Initialize display with current value
        const initialVal = window.AppStore ? window.AppStore.getState().feedbackHz : null;
        updateUI(initialVal);
    }

    function destroy() {
        pm.destroy();
    }

    window.FeedbackDetectorPage = {
        init: init,
        destroy: destroy
    };
})();
