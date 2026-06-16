# Auditoria de Producao por Pasta

Data: 2026-06-16
Escopo: `src`, `backend`, `frontend`
Foco: prontidao para producao, seguranca, resiliencia operacional e previsibilidade de manutencao
Status: auditoria executada e correcoes aplicadas em ordem de criticidade

## Baseline atual

- `npm test`: aprovado, `23` arquivos de teste, `253` testes passando.
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
  - Rotas `/api/ai/health` e `/api/ai/diagnose` passaram a exigir auth.
- Riscos remanescentes prioritarios:
  - Parte dos proxies Node -> Python ainda pode melhorar a propagacao de status/erro.
  - O frontend ainda usa `innerHTML` em muitos pontos fora de wrappers centralizados.

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

### [PARTIAL] Proxies Node -> Python ainda propagam erro de forma inconsistente
- Severidade: `medio`
- Evidencia:
  - `src/server/app-server.js:278` a `src/server/app-server.js:296` agora protegem auth e `/api/ai/health` preserva status; `/api/ai/diagnose` tambem preserva `aiRes.status`.
  - Ainda restam proxies que respondem `200` com `res.json(data)` independentemente de falha sem repassar envelope completo, como `/api/ai`, `/api/acoustic_analysis` e `/api/hardware_diagnosis`.
- Impacto em producao:
  - Parte das falhas do motor Python ainda pode chegar ao frontend de forma achatada.
- Correcao sugerida:
  - Padronizar propagacao de `status`, `statusText` e corpo de erro em todos os proxies.
- Teste de regressao recomendado:
  - Forcar `401`, `403`, `422` e `500` do Python e validar espelhamento no Node.
- Esforco: `medio`

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

### [OPEN] `innerHTML` segue espalhado e a sanitizacao ainda e inconsistente no restante do app
- Severidade: `medio`
- Evidencia:
  - Ainda existem varios pontos com HTML dinamico fora de um wrapper unico, como `frontend/js/services/auto-eq-renderer.service.js`, `frontend/js/ui/layout.js` e outras paginas.
  - `frontend/js/core/dom-sanitize.js` existe, mas nao e o caminho padrao do projeto.
- Impacto em producao:
  - A chance de regressao de XSS continua acima do ideal.
- Correcao sugerida:
  - Padronizar `textContent` por default e `setSafeHTML` apenas em funis revisados.
  - Adicionar scanner/lint na CI para `innerHTML` fora de wrappers permitidos.
- Teste de regressao recomendado:
  - Verificacao estatica em CI.
- Esforco: `medio`

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

- `proxy consistency`:
  - Ainda falta padronizar como o Node reflete erros do Python para o frontend.
- `frontend rendering discipline`:
  - O projeto melhorou nos hotspots, mas ainda precisa consolidar um padrao unico para HTML dinamico.

## Backlog priorizado restante

1. Padronizar propagacao de status/erro em todos os proxies Node -> Python.
   - Impacto: `medio`
   - Esforco: `medio`

2. Criar guardrail de CI para `innerHTML` fora de wrappers autorizados.
   - Impacto: `medio`
   - Esforco: `medio`

## Arquivos de teste adicionados nesta rodada

- `tests/socket-auth.test.js`
- `tests/integrity-guards.test.js`
- `tests/auth-surface.test.js`
- `tests/mixer-rest-command.test.js`
- `tests/mixer-rest-surface.test.js`
- `tests/xss-fixes.test.js` expandido

## Conclusao

Os itens de maior risco do relatorio original foram tratados nesta execucao: autenticacao do canal realtime, XSS nos fluxos mais expostos, integridade de update/bootstrap, baseline reproduzivel do backend Python, endurecimento da superficie REST do mixer e exposicao de diagnostico sem auth. O projeto ficou objetivamente mais pronto para producao; o trabalho restante agora esta concentrado em propagacao de erros Node -> Python e consolidacao do padrao de renderizacao segura no frontend.
