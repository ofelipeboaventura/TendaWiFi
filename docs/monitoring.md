# Monitoramento — versão 0.2.0

A versão 0.2.1 acrescenta Canvas com deslizamento contínuo, entrega incremental e critério unificado de continuidade. Consulte [gráficos, integridade e medições de desempenho](charts.md). Formato persistido, retenção e restrições de métricas permanecem compatíveis.

O menu **Monitoramento** contém Visão geral, Dispositivos, Qualidade, Recursos e Eventos. Gráficos têm horários, unidades, exploração pelo mouse/teclado e lacunas explícitas. Os períodos são 5/15 minutos, 1/24 horas e 7/30 dias. CSV exporta a seleção, com cabeçalhos de unidade e horários UTC; gráficos longos podem ser agregados em até 800 pontos.

## Evidências e limites do RX27 Pro

Em 24/10/2026, uma inspeção autenticada somente de leitura confirmou quatro nós Mesh, velocidades válidas e rodadas normais de 185–220 ms. O relatório local sanitizado está em `artifacts/monitoring/inspection.json`; não contém senha, tokens, nomes, MACs ou IPs de clientes. O script reproduzível é `node scripts/inspect-monitoring.mjs --read-only-live`.

| Métrica | Fonte e semântica |
| --- | --- |
| Velocidade WAN | `wanStatus.wanUpSpeed/wanDownSpeed`, unidade legada KB/s, normalizada para bytes/s; interface em Mbps. |
| Velocidade por cliente | `deviceList[].onlineList/guestList[].upSpeed/downSpeed`; a interface identifica tráfego do dispositivo, sem assumir que exclui rede local. |
| Consumo acumulado | Nenhum contador acumulado com semântica comprovada apareceu nos módulos inspecionados. O adaptador real retorna contadores indisponíveis. **Não existe integração das velocidades para estimar consumo.** |
| CPU e memória | O código original usa `syschkInfo.data[item_name=run_status].details.cpu_rate/mem_rate`. Consultamos somente resultados existentes, sem `CLEAR_MODULE`, start, init ou optimize. Nesta inspeção não havia percentuais disponíveis. Resultados sem horário confirmado têm atualidade desconhecida e não alimentam gráficos ou alertas. |
| Uptime | `systemCfg.runTime`, segundos do roteador principal; uma redução indica possível reinicialização/reinício do contador. |
| Mesh | Topologia, presença, identificação e distribuição dos clientes por nó. Não são inventadas métricas de CPU dos satélites. |
| Qualidade | ICMP deste computador para o roteador selecionado, Cloudflare `1.1.1.1` e Google `8.8.8.8`. Não equivale a uma sonda executada dentro do roteador. |

O motor de contadores aceita somente inteiros decimais uint64, preserva bytes como strings e calcula diferenças entre leituras válidas do mesmo contador/escopo/época. Reinício, redução, duplicação de identidade ou intervalo superior a 2,5 segundos interrompem a sequência. MACs são deduplicadas entre nós, preferindo a presença online; MACs diferentes não são mescladas por nome. Um futuro adaptador precisa comprovar unidade, direção, escopo e reinicialização antes de habilitar um contador. Campos desconhecidos chamados `total*` não são suficientes.

A demonstração fica identificada em todas as telas, usa banco em memória, contadores e recursos sintéticos e não envia sondas nem notificações externas.

## Coleta e armazenamento

- Um coletor no processo principal mantém tráfego em cadência-alvo de 1 segundo, metadados/topologia em 10 segundos e resultados passivos de recursos em 15 segundos. Respostas lentas não se sobrepõem. Falhas usam espera de 2/5/15 segundos. Sessão expirada interrompe a coleta e exige login; não há repetição automática de senha.
- A interface recebe snapshots por evento tipado, sem consultas duplicadas de tráfego. A leitura explícita após aplicar configuração continua consultando o roteador para preservar a barreira de resultado incerto.
- SQLite roda em worker separado. Cada roteador possui perfil derivado de sua identificação primária, modelo e hardware. O arquivo `monitoring.sqlite` e WAL ficam na pasta `userData` do Electron, sob o usuário Windows. A demonstração não mistura dados com esse arquivo.
- Os últimos 15 minutos ficam detalhados em memória. No disco, velocidades/recursos são agregados por minuto; sondas e eventos mantêm seus horários. Histórico longo usa cache de até 30 segundos. Médias, picos, disponibilidade e cobertura representam somente amostras observadas.
- A retenção é de 30 dias. O limite de 512 MiB considera banco, WAL e SHM; registros mais antigos são removidos se necessário, com aviso de redução da retenção. O tamanho mínimo estrutural do SQLite não pode ser reduzido indefinidamente.
- Escritas têm fila limitada. Disco cheio, corrupção ou worker ocupado não interrompem a coleta ao vivo; falhas aparecem como indisponibilidade do histórico, sem sucesso presumido. Migrações futuras desconhecidas são recusadas, preservando o arquivo.
- Fechar a janela oculta o painel e mantém a bandeja. **Sair** grava as operações pendentes e encerra. Suspender o Windows interrompe sondas/coleta; retomar registra a lacuna. Não foi configurada inicialização automática do Windows.
- A opção de linha de comando `--hidden` inicia diretamente na bandeja, sem alterar a inicialização do Windows.

## Qualidade e alertas

Um helper PowerShell/.NET fixo, oculto e sem shell interpolada executa uma rodada ICMP a cada 5 segundos, com timeout de 1 segundo por destino. A origem dos destinos é o backend; IPC não aceita host de sonda, comando, script ou caminho executável. Respostas passam por schema, tamanho e allowlist. O helper encerra ao fechar stdin; falhas encerram o processo e permitem nova tentativa após 30 segundos.

Média, p95 e perda usam respostas válidas da janela selecionada; a variação é a média das diferenças absolutas entre respostas consecutivas próximas. Erros locais do helper são indisponibilidade, não perda ICMP. Um destino sem resposta, isoladamente, não declara queda de Internet. A disponibilidade da Internet é a informada pelo roteador entre as coletas, acompanhada da cobertura de observação.

Padrões ajustáveis: latência >100 ms por 30 s; perda >5% em janela de 5 min com ao menos 30 sondas; CPU >80% e memória >90% por 60 s, exclusivamente com atualidade confirmada; saturação >90% por 30 s, apenas se a capacidade contratada foi informada. Alertas abrem e resolvem incidentes. Notificações do Windows são limitadas a uma por 5 minutos; silenciamento mantém os registros. A capacidade contratada não é inferida da velocidade Ethernet.

O executável portátil utiliza [notificações nativas da bandeja](https://www.electronjs.org/docs/latest/api/tray#traydisplayballoonoptions-windows), evitando exigir instalação, registro COM ou atalhos permanentes no menu Iniciar. As preferências de silêncio do Windows são respeitadas; clicar no aviso abre o painel.

## Interfaces e segurança

`monitoringStatus`, `monitoringHistory`, `monitoringSaveSettings`, `monitoringPause` e `exportMonitoring` são comandos específicos. `onMonitoringUpdate` oferece somente assinatura com função de cancelamento, sem IPC genérico. Emissor, frame, origem, sessão, parâmetros e limites são validados no processo principal. A exportação fica vinculada à sessão original e exige diálogo nativo para um destino `.csv`; células potencialmente executáveis como fórmulas são neutralizadas.

Vetores considerados: consultas arbitrárias/SSRF, payloads extras, replay de exportação entre sessões, falsificação de métricas, contagem duplicada no Mesh, injeção de comando/HTML/fórmula, saturação da fila, crescimento de disco, expiração e credenciais em histórico. Os dados históricos locais incluem identificadores e nomes de dispositivos; são protegidos pelas permissões da conta Windows, sem criptografia adicional. Credenciais, cookies, tokens e conteúdo de navegação não são gravados no histórico nem exportados.

O helper ICMP recebe apenas variáveis Windows necessárias; o worker SQLite recebe ambiente vazio. A senha opcional recebida por variável de ambiente é removida do ambiente do processo principal antes da criação da interface e descartada da configuração temporária após o login.
