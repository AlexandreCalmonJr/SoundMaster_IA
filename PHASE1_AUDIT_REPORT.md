# 🔍 AUDITORIA FASE 1 - ACESSIBILIDADE E UX/UI
**Data**: 17 de maio de 2026  
**Branch**: refactor/pages-optimization  
**Status**: ✅ Em Progresso

---

## 📋 CHECKLIST - ARQUIVOS CRÍTICOS

### 1️⃣ **home.html** - 🔴 CRÍTICO

#### Problemas Encontrados:

| # | Problema | Tipo | Severidade | Linhas | Solução |
|---|----------|------|-----------|--------|---------|
| 1.1 | Emoji `💡` sem aria-label | Accessibility | 🔴 CRÍTICO | 35 | Adicionar `aria-label="Dica"` ou substituir por ícone SVG |
| 1.2 | Emoji `📱` sem aria-label | Accessibility | 🔴 CRÍTICO | 46 | Adicionar `aria-label="Controle Remoto"` |
| 1.3 | `text-amber-200/80` contraste baixo | Contrast | 🔴 CRÍTICO | 40 | Mudar para `text-amber-100` |
| 1.4 | QR Code `alt="QR Code"` genérico | Accessibility | ⚠️ ALTA | 58 | Mudar para `alt="Código QR para acesso remoto"` |
| 1.5 | QR Code com sizes fixos `w-24 h-24` | Responsiveness | ⚠️ ALTA | 57 | Mudar para `w-20 h-20 sm:w-24 sm:h-24` |
| 1.6 | Botões sem aria-label | Accessibility | ⚠️ ALTA | 15,21,27 | Adicionar `aria-label` em botões inline |
| 1.7 | Cards sem semantic heading | Semantics | ⚠️ MÉDIA | 11-29 | Revisar uso de h3 (OK) |
| 1.8 | Span com `text-[10px]` difícil ler | Readability | ⚠️ MÉDIA | 59 | Aumentar para `text-xs` |

#### Código a Corrigir:

**Antes**:
```html
<h3 class="text-amber-400 font-semibold mb-2 flex items-center gap-2">
    <span>💡</span> Dica do Contexto
</h3>
<p class="text-amber-200/80">Sua igreja...</p>
```

**Depois**:
```html
<h3 class="text-amber-400 font-semibold mb-2 flex items-center gap-2">
    <span aria-label="Dica">💡</span> Dica do Contexto
</h3>
<p class="text-amber-100">Sua igreja...</p>
```

---

### 2️⃣ **ai-chat.html** - 🔴 CRÍTICO

#### Problemas Encontrados:

| # | Problema | Tipo | Severidade | Linhas | Solução |
|---|----------|------|-----------|--------|---------|
| 2.1 | Chat container altura fixa `h-[600px]` | Responsiveness | 🔴 CRÍTICO | 47 | Remover, usar `min-h-96 max-h-[calc(100vh-250px)]` |
| 2.2 | Inputs sem `<label>` associada | Accessibility | 🔴 CRÍTICO | 12-13 | Adicionar `<label for="ai-target-channel">` |
| 2.3 | Input channel sem validação visual | UX | 🔴 CRÍTICO | 13-15 | Adicionar feedback de validação |
| 2.4 | Botões com `text-[10px]` muito pequeno | Accessibility | ⚠️ ALTA | 35-42 | Aumentar para `text-xs` |
| 2.5 | Placeholder genérico | UX | ⚠️ ALTA | 73 | Melhorar exemplo de prompt |
| 2.6 | Chat input sem aria-label | Accessibility | ⚠️ ALTA | 72 | Adicionar `aria-label="Digite sua mensagem"` |
| 2.7 | Botões prompts sem title | UX | ⚠️ MÉDIA | 22-29 | Adicionar `title` ou `aria-label` |
| 2.8 | Falta `prefers-reduced-motion` | Accessibility | ⚠️ MÉDIA | 49 | Aplicar no arquivo CSS global |

#### Código a Corrigir:

**Antes**:
```html
<div class="xl:col-span-2 flex flex-col h-[600px] bg-slate-900/50...">
    <div id="chat-messages" class="flex-1 overflow-y-auto p-6 space-y-4"></div>
</div>

<input type="text" id="chat-input" 
    class="flex-1 bg-black/40..."
    placeholder="Ex: A voz está embolada...">
```

**Depois**:
```html
<div class="xl:col-span-2 flex flex-col min-h-96 max-h-[calc(100vh-250px)] bg-slate-900/50...">
    <div id="chat-messages" class="flex-1 overflow-y-auto p-6 space-y-4"></div>
</div>

<label for="chat-input" class="sr-only">Digite sua mensagem</label>
<input type="text" id="chat-input" 
    class="flex-1 bg-black/40..."
    placeholder="Ex: A voz está embolada..."
    aria-label="Digite sua mensagem para a IA">
```

---

### 3️⃣ **analyzer.html** - 🔴 CRÍTICO

#### Problemas Encontrados:

| # | Problema | Tipo | Severidade | Linhas | Solução |
|---|----------|------|-----------|--------|---------|
| 3.1 | Emoji `🔬` sem aria-label | Accessibility | 🔴 CRÍTICO | 2 | Adicionar `aria-label="Analisador"` |
| 3.2 | Emoji `💡` sem aria-label | Accessibility | 🔴 CRÍTICO | 12 | Adicionar `aria-label="Dica útil"` |
| 3.3 | Canvas para gráficos sem alt text | Accessibility | 🔴 CRÍTICO | 50-53 | Adicionar atributo `aria-label` |
| 3.4 | `text-amber-200/70` contraste baixo | Contrast | 🔴 CRÍTICO | 12 | Mudar para `text-amber-100` |
| 3.5 | Canvas heights com md: breakpoint | Responsiveness | ⚠️ ALTA | 50-53 | Adicionar `sm:` fallback |
| 3.6 | Select sem label | Accessibility | ⚠️ ALTA | 38-39 | Adicionar `<label for="mic-select">` |
| 3.7 | Texto `text-[9px]` e `text-[10px]` pequeno | Readability | ⚠️ ALTA | 13-14, 41 | Aumentar para `text-xs` |
| 3.8 | Waterfall canvas sem descrição | Accessibility | ⚠️ MÉDIA | 62 | Adicionar `aria-label` |

#### Código a Corrigir:

**Antes**:
```html
<span class="p-3 bg-cyan-900/40 rounded-2xl text-2xl">🔬</span>

<span class="text-lg">💡</span>
<p class="text-[10px] text-amber-200/70 font-medium">
```

**Depois**:
```html
<span class="p-3 bg-cyan-900/40 rounded-2xl text-2xl" aria-label="Analisador">🔬</span>

<span class="text-lg" aria-label="Dica útil">💡</span>
<p class="text-xs text-amber-100 font-medium">
```

---

### 4️⃣ **settings.html** - 🟡 ALTA

#### Problemas Encontrados:

| # | Problema | Tipo | Severidade | Linhas | Solução |
|---|----------|------|-----------|--------|---------|
| 4.1 | Emoji `⚙️` sem aria-label | Accessibility | 🔴 CRÍTICO | 3 | Adicionar `aria-label="Configurações"` |
| 4.2 | Toggle switches não acessíveis | Accessibility | 🔴 CRÍTICO | 15-16, 22-23 | Substituir `<div>` por `<input type="checkbox">` com estilo |
| 4.3 | `text-slate-500` no descritivo contraste baixo | Contrast | ⚠️ ALTA | 9, 18, 26 | Mudar para `text-slate-400` |
| 4.4 | Selects sem label | Accessibility | ⚠️ ALTA | 27-29 | Adicionar `<label for="...">` |
| 4.5 | `text-[10px]` descrição pequena | Readability | ⚠️ ALTA | 9, 18, 26 | Aumentar para `text-xs` |
| 4.6 | Button "Verificar Atualizações" sem aria-label | Accessibility | ⚠️ MÉDIA | 35 | Adicionar `aria-label` descritivo |
| 4.7 | Animações no header sem `prefers-reduced-motion` | Accessibility | ⚠️ MÉDIA | 1 | Aplicar no CSS global |

#### Código a Corrigir:

**Antes**:
```html
<div class="w-12 h-6 bg-cyan-600 rounded-full relative cursor-pointer">
    <div class="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
</div>
```

**Depois**:
```html
<label class="relative inline-flex items-center cursor-pointer">
    <input type="checkbox" class="sr-only peer" checked>
    <div class="w-12 h-6 bg-cyan-600 rounded-full peer-checked:bg-cyan-600 peer-unchecked:bg-slate-600 transition-colors"></div>
    <span class="sr-only">Auto-iniciar ao ligar PC</span>
</label>
```

---

### 5️⃣ **spl-heatmap.html** - 🟡 ALTA

#### Problemas Encontrados:

| # | Problema | Tipo | Severidade | Linhas | Solução |
|---|----------|------|-----------|--------|---------|
| 5.1 | Emoji `🔥` sem aria-label | Accessibility | 🔴 CRÍTICO | 2 | Adicionar `aria-label="Calor SPL"` |
| 5.2 | Canvas heatmap sem alt text | Accessibility | 🔴 CRÍTICO | 27 | Adicionar `aria-label="Mapa de calor SPL"` |
| 5.3 | Heatmap container `aspect-video` fixo | Responsiveness | ⚠️ ALTA | 26 | Revisar em mobile, adicionar `max-w-4xl` |
| 5.4 | Emojis em botões `🖼️`, `🧹` sem aria-label | Accessibility | ⚠️ ALTA | 15-19 | Adicionar aria-label descritivo |
| 5.5 | `text-[10px]` em labels pequeno | Readability | ⚠️ ALTA | 6, 15-19, 31 | Aumentar para `text-xs` |
| 5.6 | Placeholder com emoji `📍` sem alt | Accessibility | ⚠️ MÉDIA | 21-25 | Adicionar aria-label ao container |
| 5.7 | Contraste de cores em stat cards | Contrast | ⚠️ MÉDIA | 33-48 | Revisar `text-slate-500` → `text-slate-400` |

#### Código a Corrigir:

**Antes**:
```html
<span class="p-3 bg-red-900/40 rounded-2xl text-2xl">🔥</span>

<button id="btn-heatmap-upload" class="...">
    🖼️ Planta Baixa
</button>

<canvas id="heatmap-canvas" ... ></canvas>
```

**Depois**:
```html
<span class="p-3 bg-red-900/40 rounded-2xl text-2xl" aria-label="Mapa de calor">🔥</span>

<button id="btn-heatmap-upload" class="..." aria-label="Carregar planta baixa">
    <span aria-hidden="true">🖼️</span> Planta Baixa
</button>

<canvas id="heatmap-canvas" aria-label="Mapa de calor SPL do salão"></canvas>
```

---

## 📊 RESUMO DE PROBLEMAS POR TIPO

### Acessibilidade (14 problemas)
- ❌ Emojis sem aria-label: 6
- ❌ Inputs sem label: 3
- ❌ Canvas sem descrição: 3
- ❌ Toggle switches não-acessíveis: 1
- ❌ Botões sem feedback: 1

### Contraste de Cores (4 problemas)
- `text-amber-200/80` → `text-amber-100`
- `text-slate-500` → `text-slate-400` (em vários)
- `text-slate-600` → `text-slate-400`
- `text-amber-200/70` → `text-amber-100`

### Responsiveness (6 problemas)
- ❌ Height fixos: 1 (`h-[600px]`)
- ❌ Sizes fixos: 3 (`w-24 h-24`, canvas)
- ❌ Falta breakpoint sm: 2

### Readability (8 problemas)
- `text-[10px]` → `text-xs` (múltiplas instâncias)
- `text-[9px]` → `text-xs`

### Animações (2 problemas)
- Falta `prefers-reduced-motion`: 2 arquivos

---

## ✅ PRÓXIMAS AÇÕES

### **Imediato** (Esta semana)
1. [ ] Corrigir acessibilidade nos 5 arquivos críticos
   - [ ] home.html
   - [ ] ai-chat.html
   - [ ] analyzer.html
   - [ ] settings.html
   - [ ] spl-heatmap.html

2. [ ] Criar `frontend/css/components.css` com classes reutilizáveis

3. [ ] Adicionar `prefers-reduced-motion` media query em `frontend/css/styles.css`

### **Próxima Semana**
- [ ] Auditar 8 arquivos de prioridade alta
- [ ] Iniciar FASE 2 (Componentização)

---

## 🛠️ Ferramentas Usadas para Auditoria
- Manual review do HTML
- Lighthouse accessibility standards
- WCAG 2.1 Level AA criteria
- Tailwind CSS best practices

---

**Status**: Pronto para implementação  
**Próximo Passo**: Começar correções em home.html
