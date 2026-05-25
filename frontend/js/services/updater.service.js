/**
 * Serviço de Atualização Automática
 * Comunica com o processo Main via Bridge
 */
const UpdaterService = {
    async init() {
        console.log('[Updater] Iniciando verificação de versão...');
        
        // Verifica se estamos em ambiente Electron (window.updater vem do preload.js)
        if (!window.updater) {
            console.warn('[Updater] Ambiente não compatível ou bridge não carregado.');
            return;
        }

        try {
            const update = await window.updater.checkUpdate();
            if (update && update.available) {
                console.log('[Updater] Nova versão encontrada:', update.version);
                this.showUpdateNotification(update);
            }
        } catch (error) {
            console.error('[Updater] Erro ao verificar update:', error);
        }

        // Listener para quando o download terminar
        window.updater.onUpdateReady(() => {
            this.showRestartNotification();
        });
    },

    showUpdateNotification(update) {
        const toast = document.createElement('div');
        toast.id = 'update-toast';
        toast.className = 'fixed bottom-8 right-8 z-[100] bg-cyan-600/90 backdrop-blur-xl border border-white/20 p-6 rounded-2xl shadow-2xl shadow-cyan-900/40 w-80 animate-in slide-in-from-bottom-4 duration-500';
        
        toast.innerHTML = `
            <div class="flex flex-col gap-4">
                <div class="flex items-start justify-between">
                    <div>
                        <h4 class="text-sm font-black uppercase tracking-tighter text-white">Atualização Disponível</h4>
                        <p class="text-[10px] text-cyan-100 font-bold opacity-80 mt-1">Versão ${update.version}</p>
                    </div>
                    <span class="text-xl">🚀</span>
                </div>
                <p class="text-[11px] leading-relaxed text-cyan-50">Novas melhorias para o SoundMaster Pro. Deseja baixar agora?</p>
                <div class="flex gap-2">
                    <button id="btn-update-now" class="flex-1 py-2 bg-white text-cyan-900 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-cyan-50 transition-all">Baixar</button>
                    <button id="btn-update-later" class="px-4 py-2 bg-black/20 text-white rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-black/30 transition-all">Depois</button>
                </div>
            </div>
        `;

        document.body.appendChild(toast);

        document.getElementById('btn-update-now').addEventListener('click', async () => {
            const btn = document.getElementById('btn-update-now');
            btn.disabled = true;
            btn.innerText = 'Baixando...';
            
            const success = await window.updater.startUpdate({
                url: update.downloadUrl,
                version: update.version
            });

            if (!success) {
                btn.innerText = 'Erro no Download';
                btn.disabled = false;
            }
        });

        document.getElementById('btn-update-later').addEventListener('click', () => {
            toast.remove();
        });
    },

    showRestartNotification() {
        const toast = document.getElementById('update-toast');
        if (toast) {
            toast.innerHTML = `
                <div class="flex flex-col gap-4">
                    <div class="flex items-start justify-between">
                        <h4 class="text-sm font-black uppercase tracking-tighter text-white">Tudo Pronto!</h4>
                        <span class="text-xl">✅</span>
                    </div>
                    <p class="text-[11px] leading-relaxed text-cyan-50">A atualização foi instalada. Reinicie o aplicativo para aplicar as mudanças.</p>
                    <button id="btn-restart-now" class="w-full py-2 bg-white text-cyan-900 rounded-lg text-[10px] font-black uppercase tracking-wider hover:bg-cyan-50 transition-all shadow-xl">Reiniciar Agora</button>
                </div>
            `;

            document.getElementById('btn-restart-now').addEventListener('click', () => {
                window.updater.restartApp();
            });
        }
    }
};

// Auto-inicializa se estiver no Electron
if (window.updater) {
    if (document.readyState !== 'loading') {
        UpdaterService.init();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            UpdaterService.init();
        });
    }
}

window.UpdaterService = UpdaterService;
