# Monitoramento — versão 0.5.0

As versões 0.3.0/0.4.0/0.5.0 ampliam a base abaixo com estimativas identificadas, calendário, inventário, Wi-Fi/Mesh, DNS, relatórios e widgets. A especificação atual de origem dos dados, retenção e segurança está em [observability.md](observability.md). Totais novos não são reconstruídos a partir do histórico anterior.

A versão 0.2.1 acrescenta Canvas com deslizamento contínuo, entrega incremental e critério unificado de continuidade. Consulte [gráficos, integridade e medições de desempenho](charts.md). Formato persistido, retenção e restrições de métricas permanecem compatíveis.

O menu **Monitoramento** contém Visão geral, Consumo, Dispositivos, Qualidade, Wi-Fi/Mesh, Recursos, Eventos e Relatórios. Gráficos têm horários, unidades, exploração pelo mouse/teclado e lacunas explícitas. Os períodos de tráfego são 1/5/15 minutos, 1/24 horas e 7/30 dias; consumo usa períodos de calendário separados. CSV exporta a seleção, com cabeçalhos de unidade e horários UTC; gráficos longos podem ser agregados em até 800 pontos.

## Evidências e limites do RX27 Pro

Em 24/10/2026, uma inspeção autenticada somente de leitura confirmou quatro nós Mesh, velocidades válidas e rodadas normais de 185–220 ms. O relatório local sanitizado está em `artifacts/monitoring/inspection.json`; não contém senha, tokens, nomes, MACs ou IPs de clientes. O script reproduzível é `node scripts/inspect-monitoring.mjs --read-only-live`.

| Métrica | Fonte e semântica |
| --- | --- |
| Velocidade WAN | `wanStatus.wanUpSpeed/wanDownSpeed`, unidade legada KB/s, normalizada para bytes/s; interface em Mbps. |
| Velocidade por cliente | `deviceList[].onlineList/guestList[].upSpeed/downSpeed`; a interface identifica tráfego do dispositivo, sem assumir que exclui rede local. |
| Consumo acumulado | Nenhum contador acumulado comprovado apareceu nos módulos inspecionados. Desde a 0.3.0, velocidades podem gerar estimativas trapezoidais identificadas, somente entre leituras válidas. Contadores confirmados continuam prioritários; parcelas medidas e estimadas não são duplicadas e mantêm cobertura/escopo. |
| CPU e memória | `syschkInfo.data[item_name=run_status].details.cpu_rate/mem_rate`, percentuais do roteador principal. Na 0.2.2, o diagnóstico `check/init` e `check/start` renova a medição a cada 5 minutos; consultas a cada 2 segundos acompanham a conclusão, com prazo de 120 segundos. Não utiliza `CLEAR_MODULE` nem `optimize`. Resultados antigos sem horário confirmado mantêm atualidade desconhecida. |
| Uptime | `systemCfg.runTime`, segundos do roteador principal; uma redução indica possível reinicialização/reinício do contador. |
| Mesh | Topologia, presença, identificação e distribuição dos clientes por nó. Não são inventadas métricas de CPU dos satélites. |
| Qualidade | ICMP deste computador para o roteador selecionado, Cloudflare `1.1.1.1` e Google `8.8.8.8`. Não equivale a uma sonda executada dentro do roteador. |

O motor de contadores aceita somente inteiros decimais uint64, preserva bytes como strings e calcula diferenças entre leituras válidas do mesmo contador/escopo/época. Reinício, redução, duplicação de identidade ou intervalo superior a `max(3,5 segundos; 1,5 × intervalo configurado)` interrompem a sequência. MACs são deduplicadas entre nós, preferindo a presença online; duplicações ambíguas não geram volume. MACs diferentes não são mescladas por nome. Um futuro adaptador precisa comprovar unidade, direção, escopo e reinicialização antes de habilitar um contador. Campos desconhecidos chamados `total*` não são suficientes.

A demonstração fica identificada em todas as telas, usa banco em memória, contadores e recursos sintéticos e não envia sondas nem notificações externas.

## Coleta e armazenamento

- Um coletor no processo principal mantém tráfego em cadência-alvo de 1 segundo, configurável para 2/3/5 segundos, metadados/topologia em 10 segundos, Wi-Fi em 30 segundos e resultados passivos de recursos em 15 segundos. Respostas lentas não se sobrepõem. Falhas usam espera de 2/5/15 segundos. Sessão expirada interrompe a coleta e exige login; não há repetição automática de senha.
- A interface recebe snapshots por evento tipado, sem consultas duplicadas de tráfego. A leitura explícita após aplicar configuração continua consultando o roteador para preservar a barreira de resultado incerto.
- SQLite roda em worker separado. Cada roteador possui perfil derivado de sua identificação primária, modelo e hardware. O arquivo `monitoring.sqlite` e WAL ficam na pasta `userData` do Electron, sob o usuário Windows. A demonstração não mistura dados com esse arquivo.
- Os últimos 15 minutos ficam detalhados em memória. No disco, velocidades são agregadas por minuto; sondas, recursos por diagnóstico e eventos mantêm seus horários. Histórico longo usa cache de até 30 segundos. Médias, picos, disponibilidade e cobertura representam somente amostras observadas.
- Volumes têm retenção de 30 dias por minuto, 90 dias por hora e 24 meses por dia. Sondas e recursos detalhados mantêm 30 dias; inventário e eventos de nós/dispositivos têm regras descritas em [observability.md](observability.md). O limite de 512 MiB considera banco, WAL e SHM; detalhes antigos são removidos primeiro, com aviso de redução da retenção. O tamanho mínimo estrutural do SQLite não pode ser reduzido indefinidamente.
- Escritas têm fila limitada. Disco cheio, corrupção ou worker ocupado não interrompem a coleta ao vivo; falhas aparecem como indisponibilidade do histórico, sem sucesso presumido. Migrações futuras desconhecidas são recusadas, preservando o arquivo.
- Fechar a janela oculta o painel e mantém a bandeja. **Sair** grava as operações pendentes e encerra. Suspender o Windows interrompe sondas/coleta; retomar registra a lacuna. Inicialização com Windows é opcional e começa desativada; usa o portátil original e somente a conta conectada.
- A opção de linha de comando `--hidden` inicia diretamente na bandeja, sem alterar a inicialização do Windows.

## Qualidade e alertas

Um helper PowerShell/.NET fixo, oculto e sem shell interpolada executa uma rodada ICMP a cada 5 segundos, com timeout de 1 segundo por destino. A origem dos destinos é o backend; IPC não aceita host de sonda, comando, script ou caminho executável. Respostas passam por schema, tamanho e allowlist. O helper encerra ao fechar stdin; falhas encerram o processo e permitem nova tentativa após 30 segundos.

Média, p95 e perda usam respostas válidas da janela selecionada; a variação é a média das diferenças absolutas entre respostas consecutivas próximas. Erros locais do helper são indisponibilidade, não perda ICMP. Um destino sem resposta, isoladamente, não declara queda de Internet. A disponibilidade da Internet é a informada pelo roteador entre as coletas, acompanhada da cobertura de observação.

Padrões ajustáveis: latência >100 ms por 30 s; perda >5% em janela de 5 min com ao menos 30 sondas; saturação >90% por 30 s, apenas se a capacidade contratada foi informada. CPU/memória medidas a cada 5 minutos não acionam alertas de uso contínuo por 60 segundos. Os campos legados desses limites permanecem nas preferências persistidas para compatibilidade. Alertas abrem e resolvem incidentes. Notificações do Windows são limitadas a uma por 5 minutos; silenciamento mantém os registros. A capacidade contratada não é inferida da velocidade Ethernet.

## Diagnóstico de recursos na versão 0.2.2

A opção **Coletar recursos por diagnóstico** começa habilitada. Inicia um ciclo após conectar, com intervalo-alvo de cinco minutos entre os inícios dos ciclos; não há sobreposição nem repetição imediata ao alternar a preferência. Falhas e manutenção podem adiar o próximo ciclo. A manutenção confirmada tem prioridade. Pausar interrompe o ciclo próprio; suspensão e mudança de sessão invalidam o acompanhamento. Operações externas em andamento são preservadas.

Uma amostra exige `start` confirmado, observação de `checking` e depois `checked`, com `run_status` válido. O firmware muda para `checking` já no `init`; esse estado inicial sozinho não comprova execução. O comando `start` vem após o `init` reconhecido, como no painel original. Timeout de envio exige reconciliação e nunca repete a escrita automaticamente. O protocolo não oferece identificador exclusivo de execução: uso simultâneo por outro administrador continua uma limitação do equipamento.

CPU/memória são pontos reais de cada diagnóstico, sem interpolação ou cópia nas leituras WAN. O horário é a observação local da conclusão. Os cartões preservam a última leitura e sua idade, indicando desatualização após seis minutos. Valores passivos sem horário conhecido não entram no histórico. A migração SQLite 1→2 acrescenta `resource_samples`, sem remover tabelas ou preferências; identidade da amostra impede duplicações. CSV de recursos exporta as medições originais. Satélites não recebem valores inventados.

Em 24/10/2026, um ciclo real confirmou CPU **8,75%** e memória **65,11%**, iguais aos campos usados pelo painel original, sem `CLEAR_MODULE` nem otimização. Evidência sanitizada: `artifacts/monitoring/diagnostic-result.json`. O diagnóstico completo também verifica Wi-Fi, WAN, ping, DNS e IPv6; não foi comprovada uma chamada exclusiva para recursos. Para desativar essa função no processo principal, inclusive nos testes somente de leitura, use a variável de ambiente `TENDA_RESOURCE_DIAGNOSTICS=false`.

O executável portátil utiliza [notificações nativas da bandeja](https://www.electronjs.org/docs/latest/api/tray#traydisplayballoonoptions-windows), evitando exigir instalação, registro COM ou atalhos permanentes no menu Iniciar. As preferências de silêncio do Windows são respeitadas; clicar no aviso abre o painel.

## Interfaces e segurança

`monitoringStatus`, `monitoringHistory`, `monitoringSaveSettings`, `monitoringPause` e `exportMonitoring` são comandos específicos. `onMonitoringUpdate` oferece somente assinatura com função de cancelamento, sem IPC genérico. Emissor, frame, origem, sessão, parâmetros e limites são validados no processo principal. A exportação fica vinculada à sessão original e exige diálogo nativo para um destino `.csv`; células potencialmente executáveis como fórmulas são neutralizadas.

Vetores considerados: consultas arbitrárias/SSRF, payloads extras, replay de exportação entre sessões, falsificação de métricas, contagem duplicada no Mesh, injeção de comando/HTML/fórmula, saturação da fila, crescimento de disco, expiração e credenciais em histórico. Os dados históricos locais incluem identificadores e nomes de dispositivos; são protegidos pelas permissões da conta Windows, sem criptografia adicional. Credenciais, cookies, tokens e conteúdo de navegação não são gravados no histórico nem exportados.

O helper ICMP recebe apenas variáveis Windows necessárias; o worker SQLite recebe ambiente vazio. A senha opcional recebida por variável de ambiente é removida do ambiente do processo principal antes da criação da interface e descartada da configuração temporária após o login.
