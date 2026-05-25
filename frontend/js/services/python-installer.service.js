/**
 * Serviço de Instalação Automática do Python Portátil
 * Comunica com o processo Main para verificar/instalar o ambiente de IA.
 * Estilizado de forma independente do Tailwind para rodar em index.html e auth.html.
 */
const PythonInstallerService = {
    async init() {
        console.log('[PythonInstaller] Iniciando verificação de ambiente Python...');

        // Verifica se estamos em ambiente Electron
        if (!window.pythonInstaller) {
            console.warn('[PythonInstaller] Ambiente não compatível com Electron. IA local ignorada.');
            return;
        }

        try {
            const status = await window.pythonInstaller.checkPython();
            if (!status.installed) {
                console.log('[PythonInstaller] Python local ou dependências não encontradas. Solicitando instalação...');
                this.showPromptToast();
            } else {
                console.log('[PythonInstaller] Ambiente Python pronto em:', status.path);
            }
        } catch (error) {
            console.error('[PythonInstaller] Erro ao verificar Python:', error);
        }

        // Listener de Progresso
        window.pythonInstaller.onInstallProgress((data) => {
            this.handleProgress(data);
        });
    },

    showPromptToast() {
        if (document.getElementById('python-install-toast')) return;

        // Injeta CSS chave para animação de rotação se não houver
        if (!document.getElementById('py-installer-keyframes')) {
            const style = document.createElement('style');
            style.id = 'py-installer-keyframes';
            style.innerHTML = `
                @keyframes pySpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes pySlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
                .py-spin-anim { animation: pySpin 2s linear infinite; }
                .py-toast-anim { animation: pySlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
            `;
            document.head.appendChild(style);
        }

        const toast = document.createElement('div');
        toast.id = 'python-install-toast';
        toast.className = 'py-toast-anim';
        
        // Estilos estruturais e visuais inline para máxima compatibilidade
        toast.style.position = 'fixed';
        toast.style.bottom = '32px';
        toast.style.right = '32px';
        toast.style.zIndex = '99999';
        toast.style.backgroundColor = 'rgba(30, 27, 75, 0.95)'; // Indigo-950 escuro com opacidade
        toast.style.backdropFilter = 'blur(16px)';
        toast.style.webkitBackdropFilter = 'blur(16px)';
        toast.style.border = '1px solid rgba(255, 255, 255, 0.15)';
        toast.style.padding = '20px';
        toast.style.borderRadius = '16px';
        toast.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.5)';
        toast.style.width = '320px';
        toast.style.fontFamily = "'Outfit', system-ui, -apple-system, sans-serif";
        toast.style.color = '#ffffff';

        toast.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; align-items: start; justify-content: space-between;">
                    <div>
                        <h4 style="margin: 0; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff;">IA Offline: Requer Python</h4>
                        <p style="margin: 4px 0 0 0; font-size: 10px; color: rgba(255, 255, 255, 0.6); font-weight: 700; text-transform: uppercase;">Recursos de Inteligência Artificial</p>
                    </div>
                    <span style="font-size: 20px;">🤖</span>
                </div>
                <p style="margin: 0; font-size: 11px; line-height: 1.5; color: rgba(255, 255, 255, 0.85);">Para habilitar predição de microfonia, IA preditiva e análise acústica nativa, precisamos baixar e configurar um Python portátil (~10 MB).</p>
                <div style="display: flex; gap: 8px; margin-top: 4px;">
                    <button id="btn-py-install" style="flex: 1; padding: 8px; background-color: #ffffff; color: #1e1b4b; border: none; border-radius: 8px; font-size: 10px; font-weight: 800; text-transform: uppercase; cursor: pointer; transition: background-color 0.2s;">Instalar</button>
                    <button id="btn-py-later" style="padding: 8px 16px; background-color: rgba(255, 255, 255, 0.1); color: #ffffff; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; font-size: 10px; font-weight: 800; text-transform: uppercase; cursor: pointer;">Depois</button>
                </div>
            </div>
        `;

        document.body.appendChild(toast);

        // Hover effects inline
        const btnInstall = document.getElementById('btn-py-install');
        btnInstall.addEventListener('mouseenter', () => btnInstall.style.backgroundColor = '#f3f4f6');
        btnInstall.addEventListener('mouseleave', () => btnInstall.style.backgroundColor = '#ffffff');

        btnInstall.addEventListener('click', async () => {
            this.showInstallingState();
            const success = await window.pythonInstaller.installPython();
            if (!success) {
                this.showErrorState('Houve um erro na instalação. Verifique sua conexão e tente novamente.');
            }
        });

        document.getElementById('btn-py-later').addEventListener('click', () => {
            toast.remove();
        });
    },

    showInstallingState() {
        const toast = document.getElementById('python-install-toast');
        if (!toast) return;

        toast.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; align-items: start; justify-content: space-between;">
                    <div>
                        <h4 style="margin: 0; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #ffffff;">Configurando IA Local</h4>
                        <p id="py-install-status" style="margin: 4px 0 0 0; font-size: 10px; color: rgba(255, 255, 255, 0.6); font-weight: 700; text-transform: uppercase;">Preparando ambiente...</p>
                    </div>
                    <span id="py-install-spinner" class="py-spin-anim" style="font-size: 20px; display: inline-block;">⚡</span>
                </div>
                <div style="width: 100%; background-color: rgba(0, 0, 0, 0.3); border-radius: 9999px; height: 6px; overflow: hidden; margin: 4px 0;">
                    <div id="py-install-bar" style="background-color: #3b82f6; height: 100%; width: 5%; transition: width 0.3s ease; border-radius: 9999px;"></div>
                </div>
                <p id="py-install-msg" style="margin: 0; font-size: 10px; line-height: 1.4; color: rgba(255, 255, 255, 0.7);">Conectando ao servidor oficial...</p>
            </div>
        `;
    },

    handleProgress(data) {
        let toast = document.getElementById('python-install-toast');
        if (!toast) return;

        const progressBar = document.getElementById('py-install-bar');
        const statusText = document.getElementById('py-install-status');
        const msgText = document.getElementById('py-install-msg');

        if (data.stage === 'completed') {
            this.showCompletedState();
            return;
        }

        if (data.stage === 'error') {
            this.showErrorState(data.msg || 'Erro inesperado durante a instalação.');
            return;
        }

        let totalPercent = 0;
        if (data.stage === 'downloading-python') {
            totalPercent = Math.round(data.percent * 0.3);
            if (statusText) statusText.innerText = 'Baixando Python...';
        } else if (data.stage === 'extracting-python') {
            totalPercent = 30 + Math.round(data.percent * 0.1);
            if (statusText) statusText.innerText = 'Extraindo arquivos...';
        } else if (data.stage === 'patching-pth') {
            totalPercent = 40 + Math.round(data.percent * 0.05);
            if (statusText) statusText.innerText = 'Configurando interpretador...';
        } else if (data.stage === 'downloading-pip') {
            totalPercent = 45 + Math.round(data.percent * 0.05);
            if (statusText) statusText.innerText = 'Adquirindo Pip...';
        } else if (data.stage === 'installing-pip') {
            totalPercent = 50 + Math.round(data.percent * 0.1);
            if (statusText) statusText.innerText = 'Instalando gerenciador Pip...';
        } else if (data.stage === 'installing-requirements') {
            totalPercent = 60 + Math.round(data.percent * 0.4);
            if (statusText) statusText.innerText = 'Instalando bibliotecas de IA...';
        }

        if (progressBar) {
            progressBar.style.width = `${totalPercent}%`;
            // Deixa azul para download, e muda para ciano gradiente na instalação de libs
            if (totalPercent > 60) {
                progressBar.style.backgroundColor = '#06b6d4';
            }
        }
        if (msgText) msgText.innerText = data.msg || 'Aguarde...';
    },

    showCompletedState() {
        const toast = document.getElementById('python-install-toast');
        if (!toast) return;

        toast.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; align-items: start; justify-content: space-between;">
                    <h4 style="margin: 0; font-size: 13px; font-weight: 800; text-transform: uppercase; color: #ffffff;">Instalação Concluída!</h4>
                    <span style="font-size: 20px;">✅</span>
                </div>
                <p style="margin: 0; font-size: 11px; line-height: 1.5; color: rgba(255, 255, 255, 0.85);">O Python portátil e todas as dependências de IA foram configurados com sucesso.</p>
            </div>
        `;

        setTimeout(() => {
            toast.remove();
        }, 5000);
    },

    showErrorState(errorMsg) {
        const toast = document.getElementById('python-install-toast');
        if (!toast) return;

        toast.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <div style="display: flex; align-items: start; justify-content: space-between;">
                    <h4 style="margin: 0; font-size: 13px; font-weight: 800; text-transform: uppercase; color: #ffffff;">Erro na Instalação</h4>
                    <span style="font-size: 20px;">❌</span>
                </div>
                <p style="margin: 0; font-size: 11px; line-height: 1.5; color: #fca5a5;">${errorMsg}</p>
                <div style="display: flex; gap: 8px; margin-top: 4px;">
                    <button id="btn-py-retry" style="flex: 1; padding: 8px; background-color: #ffffff; color: #1e1b4b; border: none; border-radius: 8px; font-size: 10px; font-weight: 800; text-transform: uppercase; cursor: pointer;">Repetir</button>
                    <button id="btn-py-cancel" style="padding: 8px 16px; background-color: rgba(255, 255, 255, 0.1); color: #ffffff; border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; font-size: 10px; font-weight: 800; text-transform: uppercase; cursor: pointer;">Cancelar</button>
                </div>
            </div>
        `;

        const btnRetry = document.getElementById('btn-py-retry');
        btnRetry.addEventListener('mouseenter', () => btnRetry.style.backgroundColor = '#f3f4f6');
        btnRetry.addEventListener('mouseleave', () => btnRetry.style.backgroundColor = '#ffffff');

        btnRetry.addEventListener('click', () => {
            this.showInstallingState();
            window.pythonInstaller.installPython().then(success => {
                if (!success) {
                    this.showErrorState('A instalação falhou novamente. Verifique sua conexão.');
                }
            });
        });

        document.getElementById('btn-py-cancel').addEventListener('click', () => {
            toast.remove();
        });
    }
};

// Inicializa no carregamento do DOM
if (window.pythonInstaller) {
    if (document.readyState !== 'loading') {
        PythonInstallerService.init();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            PythonInstallerService.init();
        });
    }
}
