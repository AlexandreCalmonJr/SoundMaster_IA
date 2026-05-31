# Guia de Fluxo de Medição de Resposta de Impulso (IR) e Geração de Sinais

Este documento descreve o fluxo completo de medição de Resposta de Impulso (IR), análise acústica de sala (ETC + Decaimento) e aplicação de filtros inversos em tempo real via Convolução FIR, bem como a integração e persistência com a geração de sinais.

---

## 1. Visão Geral da Arquitetura de Áudio Persistente

Para permitir medições sem atrito, o SoundMaster trata os fluxos de áudio e sinais de teste como **serviços globais persistentes em segundo plano**:
* **Always-on Mic:** O fluxo do microfone de medição e o `AudioContext` global permanecem ativos mesmo ao navegar entre páginas (como sair da tela FFT Waterfall para a tela de Medição de IR).
* **Always-on Signal:** Os sinais de teste gerados (ruído rosa, sweeps senoidais, etc.) continuam tocando continuamente durante a navegação, permitindo coletar dados acústicos em tempo real sem interrupções.

---

## 2. Fluxo Passo a Passo: Alinhamento e Medição

### Passo 1: Conexão com a Mesa (Mixer Integration)
1. Acesse o menu de **Conectar Mesa** (ou "Mixer") na barra lateral.
2. Digite o IP de rede da mesa de som física compatível (ou clique em conectar no modo **Simulado** para testes locais offline).
3. Isso habilita o canal de comunicação para controle dinâmico de volume, cortes de graves (HPF) e equalização parametrizada.

### Passo 2: Geração do Sinal de Teste (Estímulo Acústico)
1. Navegue até a página **Gerador de Sinais**.
2. Selecione o tipo de sinal desejado para o teste:
   * **Ruído Rosa (Pink Noise):** Recomendado para análise de Função de Transferência espectral contínua.
   * **Sweep (Chirp):** Recomendado para varredura completa de frequências.
   * **MLS (Maximum Length Sequence):** Sinal pseudo-aleatório ideal para medição de resposta ao impulso em ambientes ruidosos.
3. Clique em **Tocar** ou **Ativar** no sinal desejado.
4. Ajuste o slider de nível (dB) conforme apropriado para o ambiente.
5. *Nota: Você pode navegar livremente para outras páginas que o sinal continuará tocando nas caixas.*

### Passo 3: Ativação do Analisador e LIR
1. Navegue até a tela principal do analisador (**FFT Waterfall**).
2. Configure o dispositivo de entrada física para o seu **Microfone de Medição** e ative o botão **Mic Online**.
3. Ative o botão **TF (Transfer Function)** para visualizar a resposta de magnitude e fase em tempo real (comparando a saída física com a captação do microfone).
4. Ative o cálculo de resposta de impulso em tempo real pressionando a tecla **L** (ou clicando no botão **LIR / L**).
5. O sistema começará a computar a Resposta de Impulso em Tempo Real (`lirData`) silenciosamente em segundo plano.

### Passo 4: Captura da Resposta de Impulso (IR)
1. Vá para a página **Resposta ao Impulso** (IR Measurement).
2. O microfone e o cálculo do LIR estarão ativos e atualizados em segundo plano.
3. Clique em **Capturar IR**.
4. O gráfico da forma de onda da IR será exibido na tela de forma automática e normalizada (calculada com base no pico máximo para perfeita visualização de reflexões).

### Passo 5: Análise Acústica (ETC + Decaimento)
1. Avance para a Etapa 2 (**ETC + Decaimento**).
2. **ETC (Energy-Time Curve):** Mostra a energia do sinal decaindo ao longo do tempo em dB, identificando reflexões precoces (que reforçam o som) e reflexões tardias (que causam eco e perda de inteligibilidade).
3. **Decaimento por Frequência:** Gráfico colorido multibanda que exibe o tempo de decaimento (RT60 aproximado) dividido por oitavas (125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz).

### Passo 6: Geração e Aplicação de Filtro Inverso (Correção)
1. Avance para a Etapa 3 (**Filtro Inverso & Exportação**).
2. Escolha o método de inversão desejado:
   * **Mínimos Quadrados (Wiener):** Excelente para correções focadas em energia e controle de cancelamentos.
   * **Fase Mínima (Minimum-Phase):** Alinha a fase do sistema atenuando os excessos sem adicionar pré-eco.
   * **Inversão Temporal Simples (Time-Reverse / Phase Flip).**
3. Clique em **Gerar Filtro Inverso**. A forma de onda do filtro FIR de correção gerado será plotada na tela.
4. Opções pós-geração:
   * **Exportar IR (WAV):** Salva a resposta de impulso medida em um arquivo `.wav` de 32-bit float a 48kHz.
   * **Filtro Inverso (WAV):** Salva o filtro corretivo gerado em `.wav` de 32-bit float para uso em DSPs externos.
   * **Carregar no Convolver:** Carrega o filtro dinamicamente e ativa (`apply()`) o motor de convolução `FIRConvolution` local. Isso fará com que o som captado pelo microfone de medição passe a ser corrigido em tempo real pelo filtro FIR projetado.

---

## 3. Detalhes Técnicos de Implementação

* **Roteamento de Sinal (`analyzer.js`):**
  O nó `FIRConvolution` é inserido diretamente no fluxo de monitoração do sinal:
  `Source (Mic) ──> FIRConvolution (Convolver) ──> monitorGain ──> Destination (Saída)`
* **Cálculo Desacoplado de UI (`tf-visualizer.js`):**
  O cálculo de `lirData` via `computeImpulseResponse` ocorre dentro do loop global de visualização da TF mesmo se as telas/telas canvas não estiverem montadas no DOM.
* **Normalização Dinâmica (`ir-measurement-page.js`):**
  As formas de onda das medições e dos filtros gerados são renderizadas localizando o valor máximo absoluto ($\max |x[n]|$) e dividindo todos os pontos por esse fator, prevenindo gráficos em linha reta horizontal (flat line) quando a amplitude de entrada é pequena.
