# SoundMaster Pro

Ecossistema inteligente de controle e análise de áudio para técnicos de som de igreja e eventos. Integra controle remoto da mesa **Soundcraft Ui24R** com ferramentas de análise acústica e assistente de IA especializado.

[![UI](https://img.shields.io/badge/UI-Premium_Glassmorphism-00cfd5?style=for-the-badge)](https://soundmaster.app)
[![Status](https://img.shields.io/badge/Status-Beta_Active-success?style=for-the-badge)](https://soundmaster.app)
[![Electron](https://img.shields.io/badge/Electron-41.x-9feaf9?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python)](https://python.org)

---

## Funcionalidades

### Controle de Mixer
- **Soundcraft Ui24R**: Conexão nativa via WebSocket (v6.0.3+) com suporte a OSC
- **Presets de Voz IA**: Pregador/Fala, Smart Clean, Voz Masculina/Feminina com EQ + HPF + compressor
- **Canais 1-24**: Controle de ganho, EQ paramétrico, gate, compressor e auxiliares
- **Comandos por Voz/Chat via IA**: "Aumente o volume do canal 3", "Aplique HPF no canal 1"

### Análise Acústica
- **RT60**: Cálculo de reverberação via Sabine/Eyring (backend Python + fallback local)
- **RTA & SPL Meter**: Analisador em tempo real com ponderação dBA/dBC e resposta FAST/SLOW
- **Heatmap 3D**: Mapa de dispersão sonora com interpolação de pontos
- **Auto-EQ**: Curva de equalização corretiva com PEQ + GEQ de 31 bandas
- **Detector de Microfonia**: Identifica picos sustentados com corte de feedback imediato

### IA & Automação
- **Assistente SoundMaster AI**: Diagnóstico inteligente e sugestões de ajuste via backend Python
- **Auto-Mixer Dugan**: Ganho automático para múltiplos canais de microfone
- **Scene Builder**: Salva e restaura cenas completas do mixer
- **Benchmarking**: Compara respostas acústicas (templo vazio vs cheio)

### Infraestrutura
- **PWA**: Acessível via navegador em qualquer dispositivo
- **Electron**: Versão nativa para Windows com auto-update
- **WebSocket Real-Time**: Sincronização instantânea com a mesa
- **mDNS**: Descoberta automática do mixer na rede local
- **Conexão Remota**: Túnel HTTPS automático para acesso externo

---

## Tecnologias

| Camada | Tecnologias |
|---|---|
| **Frontend** | HTML5, Vanilla JS, Tailwind CSS v4, Web Audio API |
| **Backend** | Node.js, Express 5, Socket.io |
| **IA** | Python 3.10+, FastAPI, TinyLlama, processamento de sinal |
| **Desktop** | Electron 41, electron-builder 26 |
| **Áudio** | WebSocket para Ui24R, OSC, AES67 |
| **Banco** | SQLite (better-sqlite3), NeDB |

---

## Instalação

### Pré-requisitos

- Node.js 18+ (recomendado 20 LTS)
- Python 3.10+ (para o assistente de IA)
- Git

### Passos

```bash
# Clone
git clone https://github.com/AlexandreCalmonJr/sound_assist_pibi.git
cd sound_assist_pibi

# Instale dependências Node (executa postinstall que instala dependências Python)
npm install

# Configure variáveis de ambiente (opcional)
# Crie um arquivo .env na raiz:
# AI_MODEL_PATH=modelos/tinyllama-1.1b-chat
# AI_SERVER_PORT=5000

# Inicie em modo dev (com rebuild automático do CSS)
npm run build:css &
npm start
```

> O servidor tentará criar um túnel Localtunnel e exibirá o URL público no console. Se falhar, acesse via `http://localhost:3000`.

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `AI_SERVER_PORT` | `5000` | Porta do backend Python |
| `AI_MODEL_PATH` | — | Caminho para modelo TinyLlama local |
| `DISK_IO_ROOT` | `%USERPROFILE%\.soundmaster` | Diretório raiz para uploads/export |
| `JWT_SECRET` | (autogerado) | Chave secreta JWT |
| `NODE_ENV` | `development` | Ambiente de execução |

---

## Desenvolvimento

### Comandos

| Comando | Descrição |
|---|---|
| `npm start` | Inicia o Electron |
| `npm run build:css` | Rebuild do Tailwind CSS (modo watch) |
| `npm test` | Roda testes com Vitest |
| `npm run audit` | Auditoria de segurança completa |
| `npm run pack` | Empacota para distribuição local |
| `npm run dist` | Gera instalador (.exe NSIS / Portable) |

### Estrutura do Projeto

```
sound_assist_pibi/
├── frontend/
│   ├── index.html          # Shell principal (SPA)
│   ├── auth.html           # Tela de login
│   ├── css/
│   │   ├── input.css       # Tailwind source
│   │   └── styles.css      # Output compilado
│   ├── js/
│   │   ├── core/           # Router, analyzer, app.js
│   │   ├── services/       # Socket, auth, mixer, AI, calibration...
│   │   ├── pages/          # Lógica de cada página
│   │   └── ui/             # Componentes de UI
│   ├── pages/              # Páginas HTML carregadas no iframe
│   ├── components/         # Componentes reutilizáveis
│   ├── manifest.json       # PWA manifest
│   └── mobile/             # Modo remoto mobile
├── src/
│   ├── main.js             # Processo principal Electron
│   ├── preload.js          # Preload seguro
│   └── ipc/                # IPC handlers
├── backend/
│   ├── ai_server.py        # Servidor Python FastAPI
│   ├── predictive_maintenance.py
│   └── requirements.txt
├── docs/
│   ├── INDEX.md            # Índice da documentação
│   └── flows/              # Tutoriais por fluxo
├── tests/
│   ├── audit.test.js       # Testes de auditoria de segurança
│   └── testbed.js
└── package.json
```

### Build para Distribuição

```bash
npm run dist
```

Gera instaladores em `dist/`:
- `SoundMaster Setup {version}.exe` — Instalador NSIS
- `SoundMaster {version}.exe` — Portable (standalone)

---

## Segurança

- **Sandbox**: Electron com `sandbox: true` e context isolation
- **CSP**: Helmet com Content-Security-Policy restritiva
- **Upload**: Validação de tipo MIME, SHA256 checksum, limite de 50MB
- **ZIP Slip**: Prevenção de path traversal em extração de arquivos
- **Rate Limiting**: Express-rate-limit em todas as rotas da API
- **JWT**: Tokens com expiração de 24h, bcrypt para senhas
- **Timing Attack**: `hmac.compare_digest()` para comparação de tokens
- **Comandos**: Lista de ações permitidas (`ALLOWED_AI_ACTIONS`), sem `shell: true`

---

## API

### Backend Python (`/api`)

| Rota | Método | Descrição |
|---|---|---|
| `/diagnose` | POST | Diagnóstico acústico com IA |
| `/process` | POST | Processamento de sinal de áudio |
| `/rt60` | POST | Cálculo de reverberação (Sabine/Eyring) |
| `/upload` | POST | Upload de arquivo WAV validado |
| `/health` | GET | Health check do servidor |
| `/hardware_diagnosis` | POST | Diagnóstico preditivo de hardware |

### Backend Node

| Rota | Descrição |
|---|---|
| `/api/auth/*` | Autenticação e gerenciamento de templo |
| `/api/status` | Status do sistema e serviços |
| `Socket.io` | Eventos em tempo-real (SPL, mixer, chat) |

---

## Documentação

Consulte [`docs/INDEX.md`](docs/INDEX.md) para o índice completo de documentação, incluindo tutoriais interativos por fluxo, diagramas de arquitetura e guias de uso.

---

## Licença

MIT © [Alexandre Calmon Jr.](https://github.com/AlexandreCalmonJr)

---

*Desenvolvido com foco na excelência acústica para técnicos de som voluntários.*
