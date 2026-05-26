(function () {
    function _el(id) {
        const iframe = window.parent?.document?.getElementById('agent-workspace-iframe');
        if (iframe && iframe.contentDocument) {
            const el = iframe.contentDocument.getElementById(id);
            if (el) return el;
        }
        return document.getElementById(id);
    }
    let tunnelPollCount = 0;

    async function loadConfig() {
        try {
            const res = await fetch('/api/config');
            if (!res.ok) return;

            const config = await res.json();
            const ipCard = _el('local-ip-card');
            const ipDisplay = _el('server-ip-display');
            const mobileUrl = _el('mobile-url');
            const mobileLink = _el('mobile-open-link');
            const mobileQrCode = _el('mixer-mobile-qr-code');

            if (ipCard) ipCard.style.display = 'block';
            const serverUrl = `http://${config.localIp}:${config.port}`;
            if (ipDisplay) ipDisplay.innerText = serverUrl;
            
            // Link para modo mobile (Celular)
            const mobileHref = `${serverUrl}/mobile/index.html?mode=mobile`;
            if (mobileUrl) {
                mobileUrl.innerHTML = '<span style="color: var(--cyan-400); font-size: 10px;">Acesso Rede Local: ' + mobileHref.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]}) + '</span>';
            }
            
            if (mobileLink) mobileLink.href = mobileHref;
            
            if (mobileQrCode) {
                mobileQrCode.style.display = 'none';
                const urlDisplay = document.createElement('div');
                urlDisplay.className = 'text-[10px] text-cyan-400 break-all mt-1';
                urlDisplay.textContent = mobileHref;
                mobileQrCode.parentNode?.appendChild(urlDisplay);
                const copyBtn = document.createElement('button');
                copyBtn.className = 'mt-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-[9px] font-bold text-white transition-all';
                copyBtn.textContent = 'Copiar URL';
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(mobileHref).then(() => {
                        copyBtn.textContent = 'Copiado!';
                        setTimeout(() => { copyBtn.textContent = 'Copiar URL'; }, 2000);
                    }).catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = mobileHref;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        copyBtn.textContent = 'Copiado!';
                        setTimeout(() => { copyBtn.textContent = 'Copiar URL'; }, 2000);
                    });
                };
                mobileQrCode.parentNode?.appendChild(copyBtn);
                console.log('[Config] URL mobile:', mobileHref);
            }
        } catch (e) {
            console.error('[Config] Erro ao carregar config:', e);
        }
    }

    async function loadMappings() {
        try {
            const res = await fetch('/api/mappings');
            if (!res.ok) return;

            const mappings = await res.json();
            const list = _el('db-mappings-list');
            if (!list) return;

            list.innerHTML = '';
            if (mappings.length === 0) {
                list.innerHTML = '<li style="color: var(--text-muted);">Nenhum mapeamento salvo.</li>';
                return;
            }

            mappings.forEach(map => {
                const li = document.createElement('li');
                li.style.cssText = 'display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);';
                const location = map.location ? ` - ${map.location}` : '';
                const channel = map.channel ? ` canal ${map.channel}` : '';
                li.innerHTML = '<span><strong>' + String(map.hz).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]}) + ' Hz</strong>' + channel.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]}) + location.replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]}) + ' - Detectado em ' + new Date(map.date).toLocaleDateString() + '</span>\n                    <button class="btn-delete-map" data-id="' + String(map._id).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]}) + '" style="background: none; border: none; color: var(--danger); cursor: pointer;">Excluir</button>';
                list.appendChild(li);
            });

            list.addEventListener('click', async (e) => {
                const btn = e.target.closest('.btn-delete-map');
                if (!btn) return;
                const id = btn.getAttribute('data-id');
                await fetch(`/api/mappings/${id}`, { method: 'DELETE' });
                loadMappings();
            });
        } catch (e) {
            console.error('Erro ao carregar mapeamentos:', e);
        }
    }

    function initSaveMapping() {
        const btnSaveMap = _el('btn-save-map');
        if (!btnSaveMap) return;

        btnSaveMap.addEventListener('click', async () => {
            const hzInput = _el('save-hz');
            const channelInput = _el('save-map-channel');
            const locationInput = _el('save-map-location');
            const hzVal = parseInt(hzInput.value, 10);

            if (!hzVal) {
                alert('Insira uma frequência válida!');
                return;
            }

            try {
                const res = await fetch('/api/mappings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        hz: hzVal,
                        channel: Number(channelInput?.value || 1),
                        location: locationInput?.value?.trim() || '',
                        date: new Date().toISOString()
                    })
                });

                if (res.ok) {
                    hzInput.value = '';
                    if (locationInput) locationInput.value = '';
                    loadMappings();
                    alert('Frequência salva com sucesso no Banco de Dados!');
                }
            } catch (e) {
                alert('Erro ao salvar no banco de dados local.');
            }
        });
    }

    function init() {
        loadConfig();
        loadMappings();
        initSaveMapping();
    }

    window.SoundMasterMappings = { init, loadMappings };

    // Ouvir eventos do roteador
    document.addEventListener('page-loaded', (e) => {
        if (e.detail.pageId === 'home') {
            loadConfig();
        } else if (e.detail.pageId === 'analyzer') {
            loadMappings();
            initSaveMapping();
        } else if (e.detail.pageId === 'mobile') {
            loadConfig();
        }
    });
})();
