# Central de monitoramento

## Visualização Wi-Fi/Mesh — 0.5.2 local

A aba reúne resumo, rádios, tabela comparativa dos nós, detalhes expansíveis e histórico de hoje. As somas usam clientes online, com MAC única e nó conhecido; roaming ambíguo e associações desconhecidas aparecem separadamente. A taxa negociada permanece distinta do tráfego; RSSI é bruto, inclusive o valor zero. A qualidade do controlador e de conexões Ethernet não é apresentada como uma medição de backhaul.

Busca, filtros, ordenação, paginação e expansão são locais. Atualizações preservam seleção e filtros sem mudar larguras das colunas. O histórico usa o comando existente a cada 30 segundos, sem sobreposição, somente com a aba montada e documento visível. Retorno ao primeiro plano pode sincronizar se o intervalo já venceu. Falhas preservam resultados anteriores e não são descritas como ausência de eventos. Não há novos endpoints nem migrações. O executável 0.5.2 é uma entrega local, sem nova publicação no GitHub.

## 0.3.0 — consumo e inventário

O coletor integra velocidades apenas entre duas observações válidas. A integração trapezoidal usa duração monotônica e aritmética inteira com resíduos fracionários. Pausa, suspensão, falha, reinício ou salto de relógio interrompem o intervalo. O limite de continuidade é `max(3500 ms, 1.5 × intervalo configurado)`; a coleta permite 1/2/3/5 segundos. Contadores confirmados têm prioridade e nunca são somados a uma estimativa do mesmo intervalo.

Volumes WAN representam somente essa interface. Volumes dos clientes podem incluir comunicação local. As parcelas medidas e estimadas, a cobertura e o início da coleta acompanham cada resultado. Zero observado é diferente de ausência. GB/TB usam base decimal. Não existe reconstrução de consumo anterior à habilitação da coleta. O firmware V16.03.28.20 ainda não forneceu contadores acumulados comprovados nas consultas auditadas em 26/10/2026.

As consultas de calendário são resolvidas no backend em America/Bahia: hoje, ontem, sete dias, mês atual/anterior, ano e intervalo personalizado. Comparações exigem duração equivalente, pelo menos 90% de cobertura nos dois períodos e denominador positivo. Buckets que atravessem limites históricos sem resolução suficiente são excluídos, com cobertura ausente explícita.

A migração SQLite 2→3 é transacional e aditiva. Registros de volume são agregados simultaneamente por minuto/hora/dia; a expiração de detalhes não reconstrói nem apaga esses totais. Retenção: 30 dias/minuto, 90 dias/hora e 24 meses/dia. Sob limite de 512 MiB, detalhes antigos são removidos primeiro. Watermarks por sessão/sequência impedem duplicação de um append repetido. Leituras e escritas usam consultas parametrizadas em worker separado.

O inventário identifica dispositivos por MAC, registra presença, desconexão, reconexão e roaming. A primeira captura estabelece a base, sem gerar alertas de novidade. MACs privadas diferentes não são unificadas. Duplicações ambíguas durante roaming não geram consumo. Perfis históricos ficam vinculados ao roteador autenticado. A tabela é paginada e o drawer reutiliza os controles existentes de revisão de alterações.

Os volumes ao vivo chegam no mesmo canal incremental dos gráficos. Snapshots de consumo usam watermark para reconciliar eventos recebidos durante a consulta. Consultas completas são limitadas a abertura/filtro/retorno e sincronização de 30 segundos, sem SQL ou IPC por frame. A exportação CSV neutraliza fórmulas e depende da escolha do destino.

Inicialização com Windows é opcional e desativada por padrão. O backend usa o caminho original do portátil e `--hidden`, sem aceitar caminhos da interface. Utiliza a API de [login item do Electron](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings), com consulta usando os mesmos argumentos. Nenhum serviço administrativo é instalado.

## 0.4.0 — Wi-Fi, Mesh e qualidade

O adaptador consulta `wifiAdvCfg` a cada 30 segundos e separa canal/largura configurados dos valores atuais nas três bandas do controlador. `deviceRate` é a velocidade negociada em Mbps, como no código original; não é tráfego. RSSI permanece como informado, sem conversão ou unidade não demonstrada. O painel por nó soma uma vez os clientes associados, sem tratar essa soma como backhaul nem adicioná-la ao total WAN.

DNS usa consulta A fixa a `example.com` no roteador e em `1.1.1.1`, a cada 30 segundos, timeout de 1 segundo e uma tentativa. Os destinos não são fornecidos por IPC. Sondas ICMP adicionais aceitam somente nós online da topologia autenticada, privados e no mesmo /24 do controlador; nós sem endereço verificável ficam indisponíveis. As sondas extras são observações deste computador e não substituem métricas internas do enlace Mesh. Fechar a janela preserva o processo; pausa, suspensão, troca de sessão e saída encerram os helpers.

A migração 3→4 acrescenta histórico de sondas e de estados dos nós. Tempo online inclui apenas intervalos observados entre topologias válidas próximas, sem completar suspensões. A primeira topologia não gera incidentes. Novos dispositivos exigem duas observações consecutivas e são comparados com o inventário persistido, sem anunciar toda a rede a cada início. Alertas mantêm o agrupamento de cinco minutos.

Validação real de leitura em 26/10/2026: quatro nós, 17 clientes online, RSSI e velocidade negociada presentes; canais atuais 8/40/37 e larguras 20/160/160 MHz. As duas consultas DNS responderam. Todos os setters e diagnósticos ativos foram bloqueados no harness. Evidência: `artifacts/observability/live.json`.

## 0.5.0 — inteligência, relatórios e widgets

Referência de tráfego: sete dias completos anteriores com pelo menos 80% de cobertura e janelas de cinco minutos válidas. Anomalia requer velocidade média de cinco minutos ≥10 Mbps, maior que duas vezes a mediana e maior que mediana + seis MADs, mantida por 60 segundos. Referências ausentes/desatualizadas e cobertura corrente insuficiente não abrem incidentes. A referência é recalculada no worker; a interface não define valores de referência nem thresholds ocultos.

A correlação de gargalo exige 30 segundos de saturação ou atraso local coincidentes com degradação das sondas externas. O painel mostra evidências e utilizadores simultâneos; não atribui causalidade a dispositivos. CPU/RAM esparsas continuam sem alertas de utilização sustentada de 60 segundos.

Heatmap agrega somente horas existentes, por dia da semana/hora, em Mbps médios ponderados ou GB observados; a resolução horária é conservada por 90 dias. Cinza é ausência, distinto de volume zero observado. A projeção do mês atual exige sete dias completos com ≥90% de cobertura e multiplica sua média pelos dias do mês, sempre identificada como modelo estimado separado do total observado.

A migração 4→5 acrescenta relatórios fechados e layout. Semanas começam na segunda-feira em America/Bahia; meses usam o calendário local. O próximo ciclo gera até quatro relatórios pendentes por manutenção do histórico, evitando bloquear o worker com um grande acúmulo. Períodos sem observações não viram relatórios. O conteúdo consolidado guarda cobertura, disponibilidade observada, volumes, dias e Top 10, sem credenciais. IDs fixos, perfil autenticado e geração idempotente evitam replay e acesso cruzado. CSV exige diálogo nativo de destino.

Widgets disponíveis: indicadores, tráfego, consumo/capacidade, indícios e eventos. A ordem deve ser uma permutação completa dos IDs conhecidos; campos extras, códigos, fontes e URLs são rejeitados. A interface permite ocultar, arrastar ou mover por botões de teclado. A autorização para alterar inicialização do Windows também é verificada no backend antes de qualquer escrita, inclusive nas entregas 0.3.0 e 0.4.0 recompiladas.

O histórico anterior de velocidades é preservado. Estimativas, inventário e métricas novas começam quando a versão correspondente passa a coletar. Versões antigas recusam schemas futuros para preservar o banco; use a versão mais recente depois de atualizar. Inicialização automática aponta para o arquivo escolhido daquela versão: ao migrar de nome/caminho, configure a opção no novo portátil.
