(function() {
    var loginForm = document.getElementById('login-form');
    var registerForm = document.getElementById('register-form');

    if (loginForm) {
        var errorEl = document.getElementById('login-error');
        var btn = document.getElementById('login-btn');
        var goToRegister = document.getElementById('go-to-register');

        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            errorEl.classList.add('hidden');
            btn.disabled = true;
            btn.textContent = 'Entrando...';

            var username = document.getElementById('login-username').value.trim();
            var password = document.getElementById('login-password').value;

            try {
                await window.AuthService.login(username, password);
                window.parent.document.dispatchEvent(new CustomEvent('auth-login-success'));
            } catch (err) {
                errorEl.textContent = err.message;
                errorEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Entrar';
            }
        });

        if (goToRegister) {
            goToRegister.addEventListener('click', function(e) {
                e.preventDefault();
                window.parent.router.navigate('register');
            });
        }
    }

    if (registerForm) {
        var errorEl = document.getElementById('register-error');
        var btn = document.getElementById('register-btn');
        var goToLogin = document.getElementById('go-to-login');

        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            errorEl.classList.add('hidden');
            btn.disabled = true;
            btn.textContent = 'Criando...';

            var username = document.getElementById('reg-username').value.trim();
            var email = document.getElementById('reg-email').value.trim();
            var password = document.getElementById('reg-password').value;

            try {
                await window.AuthService.register(username, email, password);
                window.parent.document.dispatchEvent(new CustomEvent('auth-login-success'));
            } catch (err) {
                errorEl.textContent = err.message;
                errorEl.classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Criar Conta';
            }
        });

        if (goToLogin) {
            goToLogin.addEventListener('click', function(e) {
                e.preventDefault();
                window.parent.router.navigate('login');
            });
        }
    }
})();
