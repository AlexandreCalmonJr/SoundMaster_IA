# SoundMaster — Mapas Acústicos e Espaciais

Este documento serve como guia prático e técnico para a utilização dos três módulos de mapeamento acústico e espacial integrados ao ecossistema SoundMaster: o **Mapa de Cobertura (Coverage Map)**, o **Mapa de Calor de SPL (SPL Heatmap)** e o **Plot de Palco (Stage Plot)**.

---

## Guia de Fluxo de Trabalho Prático em Campo (Passo a Passo)

Para realizar um alinhamento acústico completo em um evento utilizando os três mapas de forma integrada, siga o seguinte roteiro:

### Passo 1: Organizar e Mapear o Palco (Stage Plot)
1. Conecte sua mesa de som (física ou simulador) e certifique-se de que os canais de entrada estejam recebendo sinal.
2. Acesse a tela **Plot de Palco**.
3. Arraste os instrumentos correspondentes da paleta esquerda (ex: Vocal, Bateria, Teclado) para suas posições reais no grid do palco.
4. Clique em cada instrumento, defina o nome do músico, insira o número correto do canal no console e clique em **Confirmar**.
5. Salve o layout clicando em **Salvar Layout** para consultas futuras ou clique em **Exportar Layout** para imprimir o mapa técnico para os roadies.

### Passo 2: Mapear e Analisar o Nível de Ruído e Cobertura de SPL (SPL Heatmap)
1. Acesse o **Mapa de Calor** (SPL Heatmap).
2. Carregue a imagem da planta baixa do pavilhão/sala clicando em **Carregar Imagem**.
3. Defina a escala clicando em **⚙️ Escala** (ex: digite `20` para indicar que a largura total do local equivale a 20 metros).
4. Posicione-se fisicamente no primeiro ponto da sala com o seu microfone de medição ativo (ou com o modo Demo habilitado no analisador para fins de simulação).
5. Clique na tela na posição correspondente para gravar o primeiro ponto de SPL (o sistema registrará o nível atual em dB).
6. Caminhe pela sala e adicione novos pontos (pins) em diversas posições (frente, meio, fundo, laterais).
7. Clique em **🔲 Isolinhas ON** para gerar o mapa de curvas de decaimento acústico da sala.
8. Para calcular a distância entre as caixas acústicas (PA) e os pontos de medição, clique em **📏 Régua** e desenhe a linha do PA até os pontos. O sistema informará a distância exata em metros.

### Passo 3: Avaliar a Uniformidade da Cobertura e o Alinhamento de Delay (Coverage Map)
1. Acesse o **Mapa de Cobertura** (Coverage Map).
2. Caminhe até posições estratégicas da plateia e dê um clique no canvas correspondente a cada ponto.
   * O sistema capturará instantaneamente o **SPL** e o **Delay de fase** em milissegundos correspondentes àquele ponto.
3. Observe os dados estatísticos gerados automaticamente na barra lateral:
   * **Média de SPL**: Nível médio de som da sala.
   * **Variância**: Se estiver acima de `3.0 dB`, o som está muito desbalanceado (muito alto na frente e muito baixo atrás). O ideal é buscar menos de `2.0 dB`.
   * **Cobertura (±3dB)**: Tente atingir acima de `80%`. Caso a porcentagem esteja baixa, vá ao mixer e ajuste o fader das caixas de vias auxiliares (delay towers) ou aplique atenuação nas caixas frontais.
4. Alterne o modo de exibição para **Delay** para verificar a diferença de tempo de chegada do som. Se um ponto mostrar atraso significativo, use a ferramenta para calcular o delay necessário e configure-o no canal de saída correspondente do mixer.
5. Ao concluir, clique em **Exportar CSV** para salvar o relatório de calibração acústica final.

---

## 1. Mapa de Cobertura Acústica (Coverage Map)

### O que é?
O **Mapa de Cobertura** permite mapear pontos de escuta específicos no ambiente e avaliar a uniformidade e o alinhamento de tempo do sistema de som (PA). Ele calcula em tempo real o SPL e o Delay de cada ponto, colorindo a área pelo diagrama de **Voronoi** para revelar lacunas de cobertura e problemas de fase.

### Métricas Calculadas:
* **Média de SPL**: Nível de pressão sonora médio da sala em dB.
* **Variância**: Mede o desvio padrão das medições. Menos variância significa uma cobertura mais homogênea.
* **Cobertura (±3dB)**: Porcentagem de pontos medidos que estão dentro de uma variação segura de ±3dB em relação à média (meta recomendada para sonorização profissional).

### Como Usar:
1. Acesse **Mapa de Cobertura** no menu.
2. **Adicionar Pontos**: Clique em qualquer coordenada do canvas interativo (representando o plano da sala).
   * O sistema lê automaticamente o nível de SPL e o Delay em milissegundos do analisador ativo (`window.SoundMasterAnalyzer`).
3. **Modos de Visualização**: Use os seletores na lateral para alternar entre visualizar o gradiente de **SPL** ou de **Delay**.
4. **Remover Pontos**: Na lista lateral, clique no `✕` vermelho de um ponto específico para apagá-lo.
5. **Limpar Tudo**: Clique em **Limpar Tudo** para apagar o histórico de medições.
6. **Exportar CSV**: Clique em **Exportar CSV** para salvar todas as coordenadas `(X, Y)`, decibéis, milissegundos de delay e timestamps em uma tabela formatada para Excel ou ferramentas externas.

---

## 2. Mapa de Calor de SPL (SPL Heatmap)

### O que é?
O **Mapa de Calor de SPL** projeta graficamente a dispersão de energia sonora sobre a planta baixa real do local. Ele suporta o upload de imagens personalizadas do ambiente, traça curvas de isolinhas acústicas (linhas de contorno de pressão) e oferece uma régua de distância precisa para fins de calibração física.

### Funcionalidades Especiais:
* **Gradientes Radiais**: Cada ponto cria uma esfera de influência sonora suave de 30% da largura da sala, misturando as cores com base no nível medido.
* **Isolinhas (Contour Lines)**: Desenha contornos de pressão acústica de 75 a 105 dB (passos de 5dB) usando o algoritmo de *Marching Squares* para demarcar visualmente os limites de atenuação natural.
* **Régua de Calibração (Ruler)**: Permite traçar linhas de medição direta na tela e obter a distância correspondente em metros com base na escala configurada.
* **Sincronização em Tempo Real**: Envia e recebe dados via WebSockets (`save_heatmap_snapshot`) para sincronizar a tela de medição com múltiplos dispositivos e persistir dados no backend.

### Como Usar:
1. Acesse **Mapa de Calor** no menu lateral.
2. **Carregar Planta Baixa**: Clique em **Carregar Imagem** e selecione um arquivo JPG/PNG da planta baixa ou do mapa de assentos da sala (limite recomendado de 2MB para salvar localmente).
3. **Configurar a Escala**: Clique em **⚙️ Escala** e informe quantos metros correspondem a 100% da largura da tela (ex: se o pavilhão tem 30m de largura, digite `30`).
4. **Adicionar Pontos (Pins)**: Clique na tela na posição física onde a medição de SPL foi tomada.
   * O aplicativo captura o RMS dB em tempo real. Certifique-se de ligar o microfone ou o modo demo no analisador para obter dados ao vivo.
5. **Ativar Isolinhas**: Clique no botão **🔲 Isolinhas ON/OFF** para exibir ou ocultar os contornos geométricos de decibéis.
6. **Medir Distâncias**: 
   * Clique no botão **📏 Régua** (o cursor se tornará uma mira).
   * Clique e arraste de uma caixa de som até um pin ou entre dois pins quaisquer. A tela desenhará uma linha tracejada com a distância física calculada em metros (ex: `12.4m`).
7. **Limpar/Reiniciar**: Use o botão **Limpar** para reiniciar o mapa de calor.

---

## 3. Palco Interativo (Stage Plot)

### O que é?
O **Plot de Palco** é um editor visual de layout para organizar os músicos, monitores, caixas DI e microfones sobre o palco. Ele se integra diretamente ao console de mixagem (permitindo abrir controles com um clique) e ao motor de **Média Espacial (Spatial Averager)** para medições acústicas multi-dispositivo no palco.

### Como Usar:
1. Acesse **Plot de Palco** no menu lateral.
2. **Posicionar Instrumentos**: Arraste os ícones da paleta de instrumentos na lateral esquerda (Voz, Violão, Bateria, etc.) e solte-os em qualquer coordenada do grid do palco (8x6).
3. **Configurar Instrumento**: Clique sobre o instrumento posicionado no palco para abrir o popup de edição:
   * Insira o **Nome do Músico**.
   * Insira o **Número do Canal** da mesa de som correspondente (ex: `3`).
   * Clique em **Salvar**.
4. **Abrir Mixer Rapidamente**: No popup de um instrumento configurado com canal, clique em **Abrir Canal**. O SoundMaster redirecionará automaticamente para as configurações de EQ, ganho e nível daquele canal no mixer.
5. **Média Espacial do Palco**:
   * Clique em **Ativar Média Espacial** para iniciar a consolidação de múltiplas fontes acústicas usando os dispositivos dos músicos ou microfones auxiliares.
6. **Salvar/Carregar Layouts**:
   * Clique em **Salvar Layout** para guardar as posições localmente (`localStorage`).
   * Clique em **Carregar Layout** para restaurar a última montagem de palco.
   * Clique em **Limpar** para remover todos os elementos e começar do zero.
7. **Exportar para Impressão**: Clique em **Exportar Layout** para gerar um PDF ou imprimir o mapa técnico de palco para os auxiliares e roadies.

---

## 4. Estrutura de Arquivos no Workspace

Para manutenção dos mapas, consulte e modifique os seguintes arquivos:

* **Mapa de Cobertura**:
  * [frontend/pages/coverage-map.html](file:///c:/Users/Administrator/SoundMaster_IA/frontend/pages/coverage-map.html) (DOM)
  * [frontend/js/pages/coverage-map-page.js](file:///c:/Users/Administrator/SoundMaster_IA/frontend/js/pages/coverage-map-page.js) (Lógica e Cálculos)

* **Mapa de Calor de SPL**:
  * [frontend/pages/spl-heatmap.html](file:///c:/Users/Administrator/SoundMaster_IA/frontend/pages/spl-heatmap.html) (DOM)
  * [frontend/js/pages/spl-heatmap-page.js](file:///c:/Users/Administrator/SoundMaster_IA/frontend/js/pages/spl-heatmap-page.js) (Delegate de Lifecycle)
  * [frontend/js/services/heatmap.js](file:///c:/Users/Administrator/SoundMaster_IA/frontend/js/services/heatmap.js) (Renderizador do Canvas, Isolinhas, Régua e Socket Sinc)

* **Plot de Palco**:
  * [frontend/pages/stage-plot.html](file:///c:/Users/Administrator/SoundMaster_IA/frontend/pages/stage-plot.html) (DOM)
  * [frontend/js/pages/stage-plot-page.js](file:///c:/Users/Administrator/SoundMaster_IA/frontend/js/pages/stage-plot-page.js) (Arrastar/Soltar e Média Espacial)
