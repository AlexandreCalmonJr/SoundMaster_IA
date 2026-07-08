/**
 * SoundMaster — app.js (refatorado v2)
 * Ponto de entrada da aplicação.
 * Carrega componentes do shell, inicializa serviços e roteador.
 */

document.addEventListener('DOMContentLoaded', async function () {
    console.log('[SoundMaster] Inicializando App Shell v2...');

    function setShellHtml(container, html) {
        if (!container) return;
        if (typeof window.setSafeHTML === 'function') {
            window.setSafeHTML(container, html);
            return;
        }
        container.innerHTML = html;
    }

    // 1. Load shell components
    const loadComponent = async (id, path) => {
        try {
            const res = await fetch(path);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const container = document.getElementById(id);
            if (!container) throw new Error(`Container #${id} não encontrado`);
            setShellHtml(container, await res.text());
        } catch (err) {
            console.error(`[SoundMaster] Erro ao carregar componente ${id}:`, err);
            const container = document.getElementById(id);
            setShellHtml(container, '<div class="text-red-400 p-4">Erro ao carregar componente. Recarregue a página.</div>');
        }
    };

    await Promise.all([
        loadComponent('app-sidebar', 'components/sidebar.html')
    ]);

    // 2. Init layout (sidebar, toggles, breadcrumbs) — must run AFTER sidebar HTML is loaded
    if (window.SoundMasterLayout) {
        window.SoundMasterLayout.init();
    }

    // 2b. Init Nielsen UI Enhancements (H1, H3, H6, H7)
    if (window.SoundMasterUI) {
        window.SoundMasterUI.init();
    }

    // 3. Init Socket & Services
    if (typeof SocketService !== 'undefined') {
        SocketService.init();
        window.socket = SocketService.raw();
    }



    // 5. Init Onboarding Tour
    if (window.SoundMasterTour) {
        window.SoundMasterTour.init();
    }

    // 6. Help button
    document.getElementById('btn-help')?.addEventListener('click', () => {
        if (window.SoundMasterTour) {
            window.SoundMasterTour.openHelpModal();
        }
    });

    // 6a. Global Search button (H6)
    document.getElementById('btn-global-search')?.addEventListener('click', () => {
        if (window.SoundMasterSearch) {
            window.SoundMasterSearch.toggle();
        }
    });

    // 6b. Simulation toggle button
    document.getElementById('btn-toggle-sim')?.addEventListener('click', () => {
        if (window.SimulationService) {
            window.SimulationService.toggleSimulationMode();
        }
    });

    // 7. Navigate based on auth state
    if (window.router) {
        document.addEventListener('auth-login-success', function () {
            console.log('[SoundMaster] Login successful, navigating to home');
            updateUserUI();
            window.router.navigate('home');
        });

        document.getElementById('btn-logout')?.addEventListener('click', async function () {
            if (window.AuthService) {
                // H3: Confirmation before destructive action
                if (window.SoundMasterUI) {
                    const confirmed = await SoundMasterUI.confirm({
                        title: 'Sair do SoundMaster?',
                        description: 'Sua sessão será encerrada. Dados não salvos podem ser perdidos.',
                        confirmText: 'Sair',
                        cancelText: 'Cancelar',
                        variant: 'danger'
                    });
                    if (!confirmed) return;
                }
                AuthService.logout();
                window.location.replace('auth.html');
            }
        });

        const urlParams = new URLSearchParams(window.location.search);
        const isMobileMode = urlParams.get('mode') === 'mobile' || window.innerWidth < 768;

        if (isMobileMode) {
            window.router.navigate('mobile');
        } else if (window.AuthService && AuthService.isAuthenticated()) {
            const user = await AuthService.fetchMe();
            if (user) {
                updateUserUI();
                // H3: Restore page from URL if navigating back
                const urlParams2 = new URLSearchParams(window.location.search);
                const savedPage = urlParams2.get('page');
                if (savedPage && ROUTE_MAP[savedPage]) {
                    window.router.navigate(savedPage);
                } else {
                    window.router.navigate('home');
                }
            } else {
                // H9: Descriptive error for session expiry
                console.warn('[SoundMaster] Sessão expirada ou inválida. Redirecionando para login.');
                if (window.SoundMasterToast) {
                    SoundMasterToast.showToast('Sessão expirada. Faça login novamente.', 'warning', 4000);
                }
                setTimeout(() => window.location.replace('auth.html'), 1500);
            }
        } else {
            window.location.replace('auth.html');
        }
    }

    function updateUserUI() {
        const userInfo = document.getElementById('rail-user-info');
        const usernameEl = document.getElementById('rail-username');
        if (!userInfo || !usernameEl) return;

        if (window.AuthService && AuthService.isAuthenticated()) {
            const user = AuthService.getUser();
            if (user) {
                usernameEl.textContent = user.username;
                userInfo.classList.remove('hidden');
            }
        } else {
            userInfo.classList.add('hidden');
        }
    }

    console.log('[SoundMaster] App Shell v2 inicializado com sucesso.');
});
