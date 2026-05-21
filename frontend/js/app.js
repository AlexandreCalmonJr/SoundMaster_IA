/**
 * SoundMaster — app.js (refatorado v2)
 * Ponto de entrada da aplicação.
 * Carrega componentes do shell, inicializa serviços e roteador.
 */

document.addEventListener('DOMContentLoaded', async function () {
    console.log('[SoundMaster] Inicializando App Shell v2...');

    // 1. Load shell components
    const loadComponent = async (id, path) => {
        try {
            const res = await fetch(path);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const container = document.getElementById(id);
            if (!container) throw new Error(`Container #${id} não encontrado`);
            container.innerHTML = await res.text();
        } catch (err) {
            console.error(`[SoundMaster] Erro ao carregar componente ${id}:`, err);
            const container = document.getElementById(id);
            if (container) container.innerHTML = '<div class="text-red-400 p-4">Erro ao carregar componente. Recarregue a página.</div>';
        }
    };

    await Promise.all([
        loadComponent('app-sidebar', 'components/sidebar.html'),
        loadComponent('app-mixer', 'components/mixer-panel.html')
    ]);

    // 2. Init layout (sidebar, toggles, breadcrumbs) — must run AFTER sidebar HTML is loaded
    if (window.SoundMasterLayout) {
        window.SoundMasterLayout.init();
    }

    // 3. Init Socket & Services
    if (typeof SocketService !== 'undefined') {
        SocketService.init();
        window.socket = SocketService.raw();
    }

    // 4. Init Mixer Panel
    if (window.SoundMasterMixerPanel) {
        window.SoundMasterMixerPanel.init();
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

        document.getElementById('btn-logout')?.addEventListener('click', function () {
            if (window.AuthService) {
                AuthService.logout();
                updateUserUI();
                window.router.navigate('login');
            }
        });

        const urlParams = new URLSearchParams(window.location.search);
        const isMobileMode = urlParams.get('mode') === 'mobile' || window.innerWidth < 768;

        if (isMobileMode) {
            window.router.navigate('mobile');
        } else if (window.AuthService && AuthService.isAuthenticated()) {
            updateUserUI();
            window.router.navigate('home');
        } else {
            window.router.navigate('login');
        }
    }

    function updateUserUI() {
        var userInfo = document.getElementById('rail-user-info');
        var usernameEl = document.getElementById('rail-username');
        if (!userInfo || !usernameEl) return;

        if (window.AuthService && AuthService.isAuthenticated()) {
            var user = AuthService.getUser();
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
