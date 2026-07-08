(async function() {
    try {
        const user = await window.AuthService?.fetchMe();
        if (user) window.location.replace('index.html');
    } catch {
        // not logged in, stay on auth page
    }
})();

function switchTab(tab) {
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab === 'register');
    document.getElementById('form-login').classList.toggle('active', tab === 'login');
    document.getElementById('form-register').classList.toggle('active', tab === 'register');
    document.getElementById('hint-login').style.display = tab === 'login' ? '' : 'none';
    document.getElementById('hint-register').style.display = tab === 'register' ? '' : 'none';
    ['login-msg','register-msg'].forEach(id => {
        const el = document.getElementById(id);
        el.className = 'msg'; el.textContent = '';
    });
}

function setMsg(id, text, type) {
    const el = document.getElementById(id);
    el.textContent = text;
    el.className = 'msg ' + type;
}

function setBusy(btnId, busy) {
    const btn = document.getElementById(btnId);
    btn.disabled = busy;
    btn.classList.toggle('loading', busy);
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    setBusy('btn-login', true);
    setMsg('login-msg', '', '');

    try {
        if (!window.AuthService) throw new Error('AuthService indisponível');
        const data = await AuthService.login(username, password);
        if (data && data.user && data.user.mustChangePassword) {
            setMsg('login-msg', '⚠️ Senha precisa ser alterada — abra o painel de configurações.', 'warn');
            setBusy('btn-login', false);
            return;
        }
        setMsg('login-msg', '✓ Autenticado — redirecionando...', 'success');
        setTimeout(() => window.location.replace('index.html'), 700);

    } catch (err) {
        setMsg('login-msg', err.message || 'Erro ao fazer login', 'error');
        setBusy('btn-login', false);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('reg-username').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    setBusy('btn-register', true);
    setMsg('register-msg', '', '');

    try {
        if (!window.AuthService) throw new Error('AuthService indisponível');
        const data = await AuthService.register(username, email, password);
        if (data && data.user) {
            setMsg('register-msg', '✓ Conta criada — redirecionando...', 'success');
            setTimeout(() => window.location.replace('index.html'), 700);
        }
    } catch (err) {
        setMsg('register-msg', err.message || 'Erro ao criar conta', 'error');
        setBusy('btn-register', false);
    }
}

document.getElementById('form-login')?.addEventListener('submit', handleLogin);
document.getElementById('form-register')?.addEventListener('submit', handleRegister);

// H5: Real-time validation logic
document.addEventListener('DOMContentLoaded', () => {
    const inputs = document.querySelectorAll('form input');
    inputs.forEach(input => {
        input.addEventListener('input', () => {
            input.classList.add('touched');
        });
        input.addEventListener('blur', () => {
            if (input.value) input.classList.add('touched');
        });
    });
});
