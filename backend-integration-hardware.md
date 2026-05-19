# 📋 PLANO DE BACKEND — INTEGRAÇÃO DE HARDWARE E DISTRIBUIÇÃO

Este plano orienta a implementação da Fase 2 do SoundMaster Pro, focando na integração com hardware de áudio real (mDNS, OSC/MIDI), suporte robusto a streams de rede (AES67 e loopback local) e empacotamento do aplicativo Desktop (Electron) para uso em ambiente de igreja.

---

## 🔍 Visão Geral
* **Objetivo**: Conectar o frontend do SoundMaster Pro a consoles de mixagem reais (via rede local) e fluxos de áudio de rede (AES67), permitindo que Alexandre controle e audite a acústica da igreja em tempo real enquanto caminha pelo templo com seu notebook/tablet.
* **Propósito**: Converter a simulação offline do SoundMaster em uma ferramenta de produção operacional.

## 📱 Tipo de Projeto
* **Tipo**: WEB / DESKTOP BACKEND
* **Agente Principal**: `backend-specialist`
* **Skills Relacionadas**: `nodejs-best-practices`, `api-patterns`, `testing-patterns`

---

## 🎯 Critérios de Sucesso
1. **Auto-Descoberta (mDNS)**: Varredura automática da rede para encontrar mesas de som e transmissores AES67 sem necessidade de digitar IPs manualmente.
2. **Protocolo OSC de Alta Performance**: Faders de canais e auxiliares do SoundMaster controlando remotamente mesas Behringer X32/Soundcraft Ui em latência ultra-baixa (< 20ms).
3. **Loopback de Áudio Confiável**: Captura do canal de referência via AES67 / placa local para medições em tempo real do analyzer (RTA e Transfer Function).
4. **Instalador Desktop Homologado**: Geração com sucesso de executável portátil (.exe) via electron-builder pronto para Windows.

---

## 💻 Tech Stack
* **Runtime**: Node.js v20+ / Electron v41+
* **Descoberta**: `multicast-dns` (mDNS)
* **Conectividade**: `dgram` (UDP/OSC) & `soundcraft-ui-connection` (Ui24R)
* **Rede de Áudio**: AES67 RTP Receiver nativo
* **Empacotador**: `electron-builder` (Portable & NSIS targets)

---

## 📂 Estrutura de Arquivos Planejada

```
soundmaster/
├── src/
│   ├── server/
│   │   ├── aes67-service.js       # Gerenciamento de streams AES67 / RTP
│   │   ├── network.js             # Descoberta mDNS e varreduras de IP
│   │   ├── mixer-singleton.js     # Ponte unificada de controle (OSC/WS)
│   │   └── app-server.js          # Express & WebSocket Handlers
└── package.json                   # Scripts de build do Electron
```

---

## 📝 Detalhamento das Tarefas

### Tarefa 1: Ativação e Testes do Serviço de Rede AES67
* **Agente**: `backend-specialist`
* **Skills**: `nodejs-best-practices`
* **Prioridade**: P0
* **Dependências**: Nenhuma
* **Descrição**: Ativar e testar o receptor multicast RTP (AES67) no backend (`aes67-service.js`) para capturar fluxos de áudio de rede e alimentá-los ao RTA e Transfer Function do frontend.
* **INPUT**: Arquivo `src/server/aes67-service.js` atual
* **OUTPUT**: AES67 rodando com recebimento ativo de pacotes UDP na porta de áudio multicast (5004)
* **VERIFY**: Executar testes automatizados em `tests/socket-handlers.test.js` e verificar console logs do servidor mostrando receptor ativo em 0.0.0.0:5004.

### Tarefa 2: Mapeamento Dinâmico de Consoles de Som via mDNS
* **Agente**: `backend-specialist`
* **Skills**: `api-patterns`
* **Prioridade**: P1
* **Dependências**: Tarefa 1
* **Descrição**: Implementar varredura de rede local baseada em mDNS para auto-descobrir consoles de som disponíveis (ex: Behringer X32/M32 via OSC/UDP nas portas correspondentes, e Soundcraft Ui via WebSockets).
* **INPUT**: Biblioteca `multicast-dns` e módulo de rede atual `src/server/network.js`
* **OUTPUT**: Lista dinâmica de dispositivos descobertos transmitida via WebSocket para a interface do frontend
* **VERIFY**: Chamar o endpoint/evento de varredura e mockar a resposta mDNS para checar a renderização e retorno da lista sem erros no console.

### Tarefa 3: Integração dos Protocolos OSC e Soundcraft Ui
* **Agente**: `backend-specialist`
* **Skills**: `nodejs-best-practices`
* **Prioridade**: P1
* **Dependências**: Tarefa 2
* **Descrição**: Completar a ponte bidirecional de mensagens. Quando um fader for movido no frontend, o backend traduz para mensagens OSC (Behringer) ou comandos Ui Connection e envia para o IP do console. Atualizações de volume feitas na mesa física devem atualizar o fader correspondente no frontend do SoundMaster.
* **INPUT**: Módulos `mixer-singleton.js` e `mixer-actions.js`
* **OUTPUT**: Mensagens UDP OSC enviadas ao IP de destino correto
* **VERIFY**: Rodar testes unitários in `tests/mixer-actions.test.js` simulando comandos de ganho e mute e validando a integridade da saída UDP.

### Tarefa 4: Empacotamento do Distribuidor Desktop (.exe)
* **Agente**: `devops-engineer`
* **Skills**: `deployment-procedures`
* **Prioridade**: P2
* **Dependências**: Tarefa 3
* **Descrição**: Executar a compilação e empacotamento do SoundMaster utilizando o `electron-builder` para gerar uma versão portátil independente (.exe) e um instalador NSIS completo.
* **INPUT**: Configurações de build no `package.json`
* **OUTPUT**: Diretório `dist/` contendo o instalador `SoundMaster-Setup.exe` e executável portable
* **VERIFY**: Executar comando `npm run pack` e checar geração dos arquivos no diretório `dist/` sem alertas críticos.

---

## 🏁 Fase X: Lista de Verificação Final (MANDATORY SCRIPT EXECUTION)

Após concluir as tarefas de integração, execute a suíte de validação:

```powershell
# Inicia todos os testes e auditorias integrados
$env:PYTHONIOENCODING="utf-8"; python .agent/scripts/checklist.py .
```

### Critérios Adicionais
- [ ] Nenhum código de cor violeta ou roxo no layout da UI (Regra de Cores)
- [ ] Latência das mensagens de controle OSC abaixo de 30ms no loop local
- [ ] Auto-reconexão estável em caso de oscilação do sinal de Wi-Fi da igreja

---

## ✅ PHASE X COMPLETE
- Lint: [ ]
- Security: [ ]
- Build: [ ]
- Date: [Aguardando Execução]
