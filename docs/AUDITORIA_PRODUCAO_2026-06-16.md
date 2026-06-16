# Auditoria de Producao por Pasta

Data: 2026-06-16
Escopo: `src`, `backend`, `frontend`
Foco: prontidao para producao, seguranca, resiliencia operacional e previsibilidade de manutencao
Status: auditoria executada e correcoes aplicadas em ordem de criticidade

## Baseline atual

- `npm test`: aprovado, `25` arquivos de teste, `272` testes passando.
- `npm run audit`: aprovado, `1` arquivo de teste, `41` testes passando.
- `.venv\Scripts\python.exe -m pytest backend/ai/tests -q`: aprovado, `69` testes passando.
- Toolchain: `npm test` continua emitindo warning de CLI legado no `pretest` por uso de `npm rebuild better-sqlite3 --runtime=node --update-binary`.

## Resumo executivo

- Criticos e altos corrigidos nesta rodada:
  - `Socket.IO` agora exige autenticacao valida e bloqueia sessoes com `mustChangePassword`.
  - Fluxos principais de XSS em chat e viewer de tutoriais foram endurecidos.
  - DevTools nao abre mais fora de `development`.
  - Update e bootstrap Python agora exigem verificacao de integridade configurada.
  - Bootstrap Python agora prefere a `.venv` do projeto e valida dependencias realmente usadas pelo backend.
  - Rota REST `/api/mixer/command` agora exige `admin`, parser estrito e rejeicao explicita de campos extras.
  - Proxies Node -> Python passaram a compartilhar leitura de payload, timeout e espelhamento de status HTTP na maior parte das rotas JSON e multipart.
  - Rotas `/api/ai/health` e `/api/ai/diagnose` passaram a exigir auth.
- Riscos remanescentes prioritarios:
  - O frontend ainda usa `innerHTML` em muitos pontos legados, mas os hotspots de maior exposicao agora estao cobertos por wrappers, escape explicito e guardrails de regressao.

## Checklist - `src`

### [FIXED] Socket.IO exigia autenticacao opcional
- Severidade original: `critico`
- Evidencia da correcao:
  - `src/server/app-server.js:709` a `src/server/app-server.js:748` extraem token de cookie/header/auth/query.
  - `src/server/app-server.js:731` a `src/server/app-server.js:747` rejeitam ausencia de token, token invalido e `mustChangePassword`.
  - `frontend/js/services/socket.service.js:107` inicializa `io()` com `withCredentials: true`.
- Impacto em producao:
  - A superficie de tempo real deixou de aceitar clientes anonimos na rede permitida.
- Teste de regressao aplicado:
  - `tests/socket-auth.test.js`
- Esforco aplicado: `medio`

### [FIXED] Rota REST de comando do mixer agora usa schema estrito e controle por papel
- Severidade original: `alto`
- Evidencia da correcao:
  - `src/server/app-server.js` agora protege `/api/mixer/command` com `authenticateToken` e `requireRole('admin')`.
  - `src/server/auth.routes.js` passou a expor `requireRole(...)` para enforcement reutilizavel.
  - `src/server/mixer-rest-command.js` trocou `.strip()` por `.strict()` e continua aceitando apenas a allowlist explicita de acoes REST.
  - Campos extras e aliases fora da allowlist agora falham com `400`, em vez de serem silenciosamente ignorados.
- Impacto em producao:
  - A superficie REST deixou de aceitar comandos de mixer para usuarios comuns e ficou menos tolerante a payload ambíguo ou expandido.
- Teste de regressao aplicado:
  - `tests/mixer-rest-command.test.js`
  - `tests/mixer-rest-surface.test.js`
- Esforco aplicado: `medio`

### [FIXED] DevTools abria sempre na janela Electron
- Severidade original: `alto`
- Evidencia da correcao:
  - `src/server/electron-window.js:42` a `src/server/electron-window.js:44` abrem DevTools apenas em `NODE_ENV=development`.
- Impacto em producao:
  - Menor exposicao de internals e melhor comportamento de release.
- Teste de regressao aplicado:
  - `tests/integrity-guards.test.js`
- Esforco aplicado: `baixo`

### [FIXED] Atualizador permitia seguir sem hash obrigatorio
- Severidade original: `alto`
- Evidencia da correcao:
  - `src/server/updater.js:95` a `src/server/updater.js:99` agora abortam quando `UPDATE_HASH` nao estiver configurado.
- Impacto em producao:
  - O update deixa de instalar pacote nao verificado por ausencia de configuracao.
- Teste de regressao aplicado:
  - `tests/integrity-guards.test.js`
- Esforco aplicado: `medio`

### [PASS] Hardening base do Electron esta configurado
- Severidade: `baixo`
- Evidencia:
  - `src/server/electron-window.js:30` a `src/server/electron-window.js:36` mantem `nodeIntegration: false`, `contextIsolation: true` e `sandbox: true`.
  - `src/preload.js:3` a `src/preload.js:24` expoem ponte pequena e explicita.

### [PASS] Permissoes do Electron estao limitadas a origens locais
- Severidade: `baixo`
- Evidencia:
  - `src/server/electron-window.js:4` a `src/server/electron-window.js:22` restringem permissoes a `localhost` e `127.0.0.1`.

## Checklist - `backend`

### [FIXED] Suite Python agora e reproduzivel na `.venv` do projeto
- Severidade original: `alto`
- Evidencia da correcao:
  - `scripts/install-python-deps.js` agora prefere `./.venv/Scripts/python.exe` quando presente.
  - `scripts/install-python-deps.js` deixou de aceitar ambiente "saudavel" so com `fastapi` e passou a validar `numpy`, `scipy`, `python-multipart`, `requests`, `tqdm` e `python-dotenv`.
  - `backend/ai/requirements.txt` passou a declarar tambem dependencias oficiais de teste (`pytest`, `httpx2`).
  - `.venv\Scripts\python.exe -m pytest backend/ai/tests -q` aprovado com `69` testes.
- Impacto em producao:
  - O backend Python voltou a ter baseline executavel confiavel no ambiente suportado do projeto.
- Teste de regressao aplicado:
  - `.venv\Scripts\python.exe -m pytest backend/ai/tests -q`
- Esforco aplicado: `medio`

### [FIXED] Instalador do Python aceitava `get-pip.py` sem checksum configurado
- Severidade original: `alto`
- Evidencia da correcao:
  - `src/server/python-installer.js:10` usa `process.env.EXPECTED_GETPIP_SHA256 || ''`.
  - `src/server/python-installer.js:13` a `src/server/python-installer.js:16` agora abortam quando o checksum nao estiver configurado.
- Impacto em producao:
  - O bootstrap deixa de executar script remoto sem verificador declarado.
- Teste de regressao aplicado:
  - `tests/integrity-guards.test.js`
- Esforco aplicado: `medio`

### [FIXED] Proxies principais Node -> Python agora espelham status e payload de forma consistente
- Severidade: `medio`
- Evidencia da correcao:
  - `src/server/app-server.js` agora centraliza a chamada em `callPythonJson(...)`, `buildPythonHeaders(...)`, `fetchPython(...)` e `readPythonPayload(...)`.
  - As rotas `/api/ai`, `/api/ai/health`, `/api/ai/diagnose`, `/api/ai/classify`, `/api/models*`, `/api/acoustic_analysis`, `/api/hardware_diagnosis` e `/train` passaram a responder com `res.status(response.status).json(data)`.
  - Os proxies multipart de audio agora tambem preservam o status e o corpo de erro do Python antes de cair em fallback local.
- Impacto em producao:
  - O frontend deixa de receber uma parte relevante dos erros do Python como `200` enganoso ou `500` genérico sem contexto.
- Teste de regressao aplicado:
  - `tests/auth-surface.test.js`
- Esforco aplicado: `medio`

### [FIXED] Rotas de diagnostico da IA no Node estavam expostas sem auth
- Severidade original: `medio`
- Evidencia da correcao:
  - `src/server/app-server.js:278` e `src/server/app-server.js:290` agora usam `authenticateToken`.
- Impacto em producao:
  - Menor exposicao de estado interno do backend Python.
- Teste de regressao aplicado:
  - `tests/auth-surface.test.js`
- Esforco aplicado: `baixo`

### [PASS] Backend Python aplica API key na maior parte das rotas sensiveis
- Severidade: `baixo`
- Evidencia:
  - `backend/ai/ai_server.py:124` a `backend/ai/ai_server.py:146` validam `X-API-Key`.
  - Rotas principais usam `Depends(verify_api_key)`.

### [PASS] Validacao de payload no FastAPI esta razoavel para carga volumosa
- Severidade: `baixo`
- Evidencia:
  - `backend/ai/ai_server.py:204` a `backend/ai/ai_server.py:229` limitam listas.
  - `backend/ai/ai_server.py:63` a `backend/ai/ai_server.py:77` validam upload WAV com limite.

## Checklist - `frontend`

### [FIXED] Viewer de tutoriais renderizava Markdown sem sanitizacao
- Severidade original: `alto`
- Evidencia da correcao:
  - `frontend/pages/tutorials.html:373` agora carrega DOMPurify.
  - `frontend/js/pages/tutorials-page.js:163` a `frontend/js/pages/tutorials-page.js:173` sanitizam HTML renderizado.
  - `frontend/js/pages/tutorials-page.js:201` aplica `content.innerHTML = _sanitizeRenderedMarkdown(html)`.
- Impacto em producao:
  - Reduz risco de XSS/supply chain na documentacao empacotada.
- Teste de regressao aplicado:
  - `tests/xss-fixes.test.js`
- Esforco aplicado: `baixo`

### [FIXED] Cards de comando do chat interpolavam campos sem escape completo
- Severidade original: `alto`
- Evidencia da correcao:
  - `frontend/js/pages/ai-chat-page.js` passa a escapar `desc`, `action`, `value` e `channel`.
  - `frontend/js/pages/home-page.js` aplica a mesma regra.
- Impacto em producao:
  - Respostas do backend de IA deixam de injetar markup nesses cards.
- Teste de regressao aplicado:
  - `tests/xss-fixes.test.js`
- Esforco aplicado: `medio`

### [PARTIAL] Guardrail e hotspots prioritarios de `innerHTML` foram endurecidos
- Severidade: `medio`
- Evidencia:
  - `frontend/index.html` agora carrega `frontend/js/core/dom-sanitize.js` no shell principal.
  - `frontend/js/core/dom-sanitize.js` passa a expor `escapeHTMLText(...)` e `setSafeHTML(...)`, agora com perfil HTML completo do DOMPurify para nao degradar componentes ricos do shell.
  - `frontend/js/services/auto-eq-renderer.service.js` passou a usar `_setHtml(...)`, escape explicito em campos dinamicos como `f.name` e fallback correto sem recursao.
  - `frontend/js/pages/feedback-detector-page.js`, `frontend/js/pages/hardware-diagnostics-page.js` e `frontend/js/pages/benchmarking-page.js` passaram a escapar interpolacoes dinamicas vindas de estado local/backend.
  - `frontend/js/core/analyzer.js` agora usa `_setHtml(...)` nos cards de RT60/IR e escapa mensagens de erro e warning dinamicas.
  - `frontend/js/pages/aes67-page.js` passou a usar `_setHtml(...)` e escape explicito em alertas de rede e badges de status.
  - `frontend/js/services/volunteer.service.js` agora encapsula overlay, modal PIN, grade de canais e icones do header via `_setHtml(...)` com escape de valores dinamicos de preset/estado.
  - `frontend/js/pages/settings-page.js` passou a escapar `desc` e `size` dos modelos antes do templating HTML e usa `_setHtml(...)` no fallback offline.
  - `frontend/js/core/app.js` centraliza a injecao do shell por `setShellHtml(...)`, mantendo o carregamento de componentes locais sob a mesma disciplina de sanitizacao.
  - `frontend/js/services/mixer-audio-source.service.js` e `frontend/js/ui/audio-source-selector.js` deixaram de interpolar nomes de dispositivos em `innerHTML`, passando a construir `option`s via DOM API.
  - `frontend/js/ui/mixer-panel.ui.js` deixou de interpolar nomes de presets em `innerHTML`, usando `createElement(...)` e `textContent`.
  - `frontend/js/pages/debug-page.js` passou a encapsular a renderizacao do console com o wrapper de HTML seguro.
  - `frontend/js/pages/ai-chat-page.js` deixou de interpolar texto bruto nos steps de progresso da IA, passando a montar o status com nos DOM e `textContent`.
  - `frontend/js/core/feedback-detector.js` deixou de usar `innerHTML` nas mensagens de alerta e status, preservando o destaque visual com construcao explicita de nos.
  - `frontend/js/pages/testbed-page.js` deixou de interpolar `scene.label` e `scene.description` em `innerHTML` nos botoes de cenario.
  - `frontend/js/pages/mixer-git-page.js` corrigiu a limpeza visual das tags de escopo no rollback (`.scope-tag`).
  - `tests/frontend-innerhtml-guard.test.js` congela o baseline atual de atribuicoes HTML e verifica os renderizadores dinamicos endurecidos.
- Impacto em producao:
  - A regressao silenciosa de novos pontos com `innerHTML` ficou detectavel em CI e os fluxos mais expostos neste bloco passaram a renderizar dados dinamicos com escape/sanitizacao sem quebrar layouts do shell.
- Correcao sugerida:
  - Continuar migrando telas antigas para `textContent` por default e `setSafeHTML` apenas em funis revisados.
  - Refinar o guardrail para allowlist por contexto e reduzir gradualmente o baseline de `innerHTML`.
- Teste de regressao aplicado:
  - `tests/frontend-innerhtml-guard.test.js`
  - `tests/xss-fixes.test.js`
- Esforco remanescente: `medio`

### [PARTIAL] Estado de autenticacao no frontend dependia demais de `localStorage`
- Severidade: `baixo`
- Evidencia:
  - `frontend/js/services/auth.service.js:103` agora exige `user.id` para considerar sessao local como autentica.
  - Ainda existe dependencia de cache local como heuristica inicial de UX em `frontend/js/core/app.js`.
- Impacto em producao:
  - Melhorou a heuristica, mas o ideal ainda e derivar sessao de confirmacao server-side logo no bootstrap.
- Correcao sugerida:
  - Reduzir ainda mais o peso do cache local no gating inicial.
- Teste de regressao aplicado:
  - `tests/auth-surface.test.js`
- Esforco remanescente: `baixo`

### [PASS] Cliente HTTP de auth usa cookie `HttpOnly` com `credentials: include`
- Severidade: `baixo`
- Evidencia:
  - `src/server/auth.routes.js` define cookie `HttpOnly` e `SameSite=Strict`.
  - `frontend/js/services/auth.service.js:35` a `frontend/js/services/auth.service.js:39` usam `credentials: 'include'`.

### [PASS] Chat da pagina dedicada usa sanitizacao melhor que a media do app
- Severidade: `baixo`
- Evidencia:
  - `frontend/js/pages/ai-chat-page.js` mantem escape inicial e DOMPurify para o corpo do Markdown.
  - `frontend/index.html` carrega DOMPurify com `integrity`.

## Riscos transversais remanescentes

- `frontend rendering discipline`:
  - O projeto melhorou nos hotspots, agora protege shell local, overlays do modo voluntario e cards de configuracao, mas ainda precisa consolidar um padrao unico para HTML dinamico nas telas legadas.

## Backlog priorizado restante

1. Reduzir gradualmente o baseline legado de `innerHTML` nas telas antigas e convergir para `textContent`/`setSafeHTML`.
   - Impacto: `medio`
   - Esforco: `medio`

## Arquivos de teste adicionados nesta rodada

- `tests/socket-auth.test.js`
- `tests/integrity-guards.test.js`
- `tests/auth-surface.test.js`
- `tests/mixer-rest-command.test.js`
- `tests/mixer-rest-surface.test.js`
- `tests/xss-fixes.test.js` expandido
- `tests/frontend-innerhtml-guard.test.js`

## Conclusao

Os itens de maior risco do relatorio original foram tratados nesta execucao: autenticacao do canal realtime, XSS nos fluxos mais expostos, integridade de update/bootstrap, baseline reproduzivel do backend Python, endurecimento da superficie REST do mixer, consistencia principal dos proxies Node -> Python e exposicao de diagnostico sem auth. O projeto ficou objetivamente mais pronto para producao; o trabalho restante agora esta concentrado em consolidacao do padrao de renderizacao segura no frontend.
