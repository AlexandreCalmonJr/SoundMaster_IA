# Assistente de Operação Sonora

## Objetivo

O Assistente de Operação Sonora observa o áudio recebido da Soundcraft Ui24R, gera alertas técnicos explicáveis e orquestra análises, medições e ajustes confirmados. A detecção continua em modo sombra: nenhum alerta altera a mesa sozinho. Uma ação só pode ser executada depois de ser validada pelo servidor e confirmada explicitamente por um administrador.

## Separação de responsabilidades

- USB de áudio: entrega as amostras PCM do Main L/R ao analisador.
- WebSocket da Ui24R: entrega estado da mesa e transporta propostas, confirmações, resultados e comandos já autorizados.
- DSP local: calcula métricas de baixa latência e dispara detectores determinísticos.
- Backend de IA: fornece uma segunda opinião de risco e classificação; não é o único gatilho de uma ação.
- Interface: mostra evidências, confiança e a condição de segurança atual.

O WebSocket de controle não transporta o áudio PCM necessário para a análise.

## Fluxo atual

1. O operador seleciona a Ui24R ou outra interface USB como entrada.
2. O navegador abre a entrada sem cancelamento de eco, supressão de ruído ou ganho automático.
3. O AudioWorklet mede pico e RMS de L e R independentemente a cada 4096 amostras.
4. O analisador calcula espectro, piso local, bandas, fator de crista e classificação.
5. O SoundAssistantService aplica persistência temporal, histerese e limiares de confiança.
6. Alertas aparecem no painel do analisador e na central global disponível em Analisar, Medir, Mixer e Configurações.
7. Pedidos em linguagem natural podem iniciar análise do Main L/R, classificação e medição RT60, mostrando progresso e resultado.
8. Ajustes sugeridos viram ações pendentes; não são executados neste momento.
9. O servidor valida usuário administrativo, schema estrito, allowlist, limites e expiração.
10. Após confirmação explícita, o comando é executado uma vez, registrado e devolve sucesso ou falha.
11. Quando existe snapshot seguro, a central oferece desfazer.

## Detectores integrados

### Clipping no Main L/R

O alerta exige picos digitais consecutivos, evitando reagir a uma única amostra isolada. O maior pico entre L e R é usado para que um problema em apenas um lado não seja escondido pelo mixdown mono.

Evidências exibidas:

- pico em dBFS;
- RMS do lado mais crítico;
- quantidade de quadros consecutivos;
- confiança do detector.

### Risco de microfonia

O alerta exige simultaneamente:

- pico entre 40 Hz e 16 kHz;
- nível mínimo;
- destaque em relação ao piso espectral local;
- frequência estável por vários quadros;
- confiança mínima combinando persistência, estabilidade e proeminência;
- classificação de IA apenas como reforço opcional.

Uma proposta de notch pode ser encaminhada à central, mas ainda requer validação e confirmação antes de executar.

### Outros detectores

- margem baixa e nível médio excessivo;
- dinâmica excessivamente comprimida;
- excesso persistente de graves;
- médio-agudos agressivos;
- ruído, hum ou rumble persistente;
- ausência de sinal com mesa conectada e master aberto.

Os detectores podem ser habilitados ou desabilitados em Configurações e possuem perfis de sensibilidade conservador, equilibrado e sensível.

## Contrato de segurança

Regras vigentes:

- detectores nunca executam ações diretamente;
- Auto-Cut e os eventos antigos de corte automático permanecem bloqueados;
- respostas da IA não podem mais usar execute_ai_command diretamente;
- toda proposta recebe um identificador único, expira em dois minutos e só pode ser processada uma vez;
- apenas usuários administrativos podem propor, confirmar, rejeitar ou desfazer ajustes;
- o servidor aceita somente ações e parâmetros previstos no schema estrito;
- comandos raw, phantom power, gravação e outras ações fora da allowlist são rejeitados;
- ações de alto impacto são destacadas na central;
- o estado anterior é capturado para EQ, faders, mute, HPF, níveis auxiliares e delay quando possível;
- cada etapa é registrada no logger e no histórico de comandos.

## Limitações conhecidas

- O Main L/R permite avaliar o resultado geral, mas não identifica de forma confiável qual canal causou um problema.
- Ajustes por canal dependerão da futura captura USB multicanal ou de correlação forte com a telemetria da mesa.
- Um detector espectral não substitui calibração, escuta do operador e validação em hardware real.
- Os limiares precisam ser calibrados com gravações reais de cultos e eventos antes de qualquer automação pré-autorizada futura.

## Critérios de validação antes da próxima fase

- falso positivo crítico abaixo de 1 por hora no conjunto de gravações de validação;
- clipping detectado em até 500 ms;
- microfonia sustentada detectada em até 1,5 s;
- picos musicais móveis não classificados como microfonia;
- nenhum evento de detecção executa comando sem confirmação explícita;
- propostas não confirmadas nunca chamam o executor da mesa;
- confirmação duplicada e comandos fora da allowlist são rejeitados;
- alertas duplicados são consolidados e resolvidos após a condição desaparecer;
- captura estéreo continua estável durante uma sessão prolongada.

## Próxima fase

Depois de validar esta integração em modo simulado e com gravações reais:

1. medir automaticamente o áudio antes e depois de cada comando confirmado;
2. comparar melhoria, efeito neutro ou regressão e sugerir rollback;
3. ampliar a captura para canais USB separados;
4. correlacionar cada canal de áudio com nome, VU e processamento recebido via WebSocket;
5. calibrar limiares por ambiente, tipo de evento e perfil de operador;
6. avaliar automações pré-autorizadas somente para ações reversíveis e de baixo impacto.
