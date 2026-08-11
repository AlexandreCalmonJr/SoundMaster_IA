# SoundMaster Design System 2.0

## Objetivo

O design system garante que shell, páginas técnicas, controles da Ui24R, assistente de IA, autenticação e mobile compartilhem a mesma linguagem visual. A prioridade é leitura rápida durante operação ao vivo, com baixa ambiguidade e contraste consistente.

## Direção visual

- Interface escura, técnica e precisa.
- Superfícies sólidas em vez de excesso de transparência ou brilho.
- Ciano reservado para ação primária, foco e dados ativos.
- Verde para sucesso, âmbar para atenção, vermelho-rosa para erro ou risco e azul para informação.
- Um raio principal de 14px para cards, 12px para agrupamentos e 8px para controles.
- Sombras discretas, usadas apenas para separar planos.

## Tipografia

### Família principal

Outfit é usada em títulos, textos, botões, navegação, formulários e status.

```css
font-family: var(--sm-font-sans);
```

### Família monoespaçada

A fonte monoespaçada é reservada para valores técnicos, frequências, dB, hashes, tempos e logs.

```css
font-family: var(--sm-font-mono);
font-variant-numeric: tabular-nums;
```

### Escala mínima

- Texto de interface: 13px ou 14px.
- Botões e campos: mínimo 11px; padrão 12px ou 13px.
- Labels e eyebrows: mínimo 10px.
- Valores técnicos podem ser compactos, mas nunca devem depender de baixo contraste.
- Títulos de página: 28px a 36px conforme viewport.

## Tokens principais

```css
--sm-bg-canvas: #070b12;
--sm-bg-shell: #0b111b;
--sm-bg-panel: #101826;
--sm-bg-panel-raised: #151f2f;
--sm-bg-control: #0b1320;

--sm-text-strong: #f8fafc;
--sm-text-primary: #e5edf7;
--sm-text-secondary: #a9b7c9;
--sm-text-muted: #8291a6;

--sm-accent: #22d3ee;
--sm-success: #4ade80;
--sm-warning: #fbbf24;
--sm-danger: #fb7185;
--sm-info: #60a5fa;

--sm-radius-sm: 8px;
--sm-radius-md: 12px;
--sm-radius-lg: 14px;
```

Todos os textos semânticos superam contraste WCAG AA sobre as superfícies principais.

## Componentes

### Cabeçalho de página

Use a estrutura existente com `page-section > header` ou a classe `sm-page-header`. Um cabeçalho deve conter um único título, subtítulo curto e ações relacionadas à página.

### Card

```html
<section class="sm-card">
  <h3 class="sm-card-title">Título</h3>
  <p class="sm-card-description">Descrição objetiva.</p>
</section>
```

Cards não devem inventar novas cores, raios ou sombras. Estados semânticos podem alterar apenas borda, texto de status e detalhes necessários.

### Métrica

```html
<div class="sm-card sm-card-compact">
  <span class="sm-eyebrow">Pico</span>
  <strong class="sm-metric-value">-3.2 dBFS</strong>
</div>
```

### Botões

- Primário: uma ação principal por bloco.
- Outline: ações secundárias.
- Danger: somente ações destrutivas ou de risco.
- Altura mínima recomendada: 40px; alvos de toque principais: 44px.
- O texto deve usar verbo e objeto, por exemplo `Confirmar ajuste`.

### Formulários

Campos usam superfície de controle, borda forte, raio de 8px e foco ciano visível. Placeholder nunca substitui label.

### Tabelas

Cabeçalhos usam 10px em caixa alta; células usam 12px ou mais. Linhas recebem apenas um hover sutil, sem alternância excessiva de cores.

### Badges e status

Badges usam formato pill e nunca substituem uma mensagem completa. Cor semântica deve ser acompanhada de texto.

## Aplicação técnica

- `frontend/css/styles.css`: Tailwind compilado e utilidades existentes.
- `frontend/css/design-system.css`: camada semântica global carregada por último.
- `frontend/js/core/router.js`: injeta o design system em todas as páginas do iframe.
- CSS específicos podem definir layouts, mas devem consumir tokens `--sm-*`.
- `frontend/mobile/css/mobile.css` espelha os mesmos tokens e escalas.
- `frontend/auth.html` usa a mesma paleta, tipografia e raios.

## Regras para futuras telas

1. Toda página deve estar contida em `page-section`.
2. Não declarar uma nova família tipográfica.
3. Não criar tons alternativos de ciano, verde, âmbar ou vermelho.
4. Não usar texto funcional abaixo de 10px.
5. Não usar opacidade que reduza texto abaixo de contraste AA.
6. Não criar raios fora de 8px, 12px, 14px ou pill.
7. Preferir classes semânticas antes de repetir longas combinações Tailwind.
8. Preservar foco visível e navegação por teclado.
9. Usar monoespaçada apenas para dados técnicos.
10. Validar desktop, tablet e mobile antes de publicar.
