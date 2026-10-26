# Validação das versões

## Wi-Fi/Mesh 0.5.2 — 26/10/2026

- **247 testes em 15 arquivos aprovados**. Os cenários novos cobrem deduplicação, roaming ambíguo, clientes sem nó, estados offline, ordenação estável, separação entre taxa negociada e tráfego, ausência versus zero, qualidade do controlador/Ethernet, configuração automática versus estado atual e nomes com conteúdo malicioso renderizados como texto.
- **TypeScript e build de produção aprovados**. Nenhum endpoint, coletor, schema persistido ou cadência do roteador foi alterado. Busca, filtros, ordenação, paginação e expansão ficam no renderer; a consulta de histórico preserva a cadência de 30 segundos e impede sobreposição.
- **29 verificações desktop aprovadas contra o ASAR**, incluindo a tabela comparativa, detalhes/clientes, navegação das demais abas, cartões DNS, inventário, exportações, autenticação, bandeja e ausência de consultas completas de histórico por segundo. Capturas: `artifacts/monitor-wifi-mesh-comparison.png` e `artifacts/monitor-wifi-mesh-details.png`.
- **Fixture sintética específica aprovada** com teclado/foco, nomes longos, RSSI e ping zero, busca por IP, filtro de conexão, 25 clientes paginados, preservação da seleção/filtros durante atualizações, colunas sem alteração de largura, consulta sem chamadas extras, nós offline e falha de histórico distinta de ausência de eventos. Não conecta ao roteador nem utiliza credenciais.
- **12 combinações de layout aprovadas:** larguras de 980/1280/1440/1920 pixels com zoom da interface em 100/125/150%. Sem excesso horizontal na página; somente tabelas têm rolagem interna quando necessária. Foco emulado pelo protocolo do Chromium permite verificar CSS de foco em janela oculta. A configuração global de DPI do Windows não foi alterada. Resultado e capturas: `artifacts/wifi-mesh/result.json` e PNGs no mesmo diretório. Reprodução: `node scripts/test-wifi-mesh.mjs`.
- **Portátil final aprovado sem Node no PATH e sem administrador:** seis amostras reais, três níveis de agregados, SQLite válido, sem erro de processo. O primeiro lançamento não confirmou a coleta no prazo de 30 segundos; a repetição isolada passou. O diagnóstico ativo permaneceu desativado, e a validação não alterou configurações do roteador.
- **Pacote inspecionado:** 13 entradas no ASAR, build correspondente, ícones de nove tamanhos, versão 0.5.2, execução `asInvoker` e fuses preservados. Firmware original e portátil 0.5.1 mantêm seus SHA-256 anteriores. A versão foi entregue inicialmente de forma local; a publicação posterior em GitHub Releases utiliza o mesmo executável, sem recompilação, com SHA-256 `02a449031b8a12a790622739a31df44bd529b35c6a928bcf69d40fca940d9de0`. Os quatro assets têm tamanho e digest remoto conferidos pelo publisher.

## Distribuição 0.5.1 — 26/10/2026

Ícone próprio incorporado ao launcher portátil e ao executável Electron, nos tamanhos 16/20/24/32/40/48/64/128/256. A inspeção PE confirmou os nove PNG, produto Tenda WiFi Desktop, versão 0.5.1 e execução `asInvoker`. Os PNG da janela/bandeja também foram conferidos dentro do ASAR; os 13 arquivos/diretórios correspondem à allowlist e ao build. Os fuses continuam configurados como nas versões anteriores. Firmware original e hashes dos oito launchers arquivados foram preservados.

235 testes automatizados em 14 arquivos, build TypeScript e 28 verificações desktop aprovados, incluindo coleta com janela fechada, ausência de polling por segundo, exportações e controles de autorização. O portátil final passou com PATH sem Node, usuário sem privilégios administrativos, perfil isolado, seis amostras reais, três níveis de agregados e SQLite válido. O primeiro lançamento não confirmou coleta no limite de 30 segundos; uma repetição isolada concluiu, sem saída de erro. Diagnósticos ativos permaneceram desativados; nenhuma configuração foi alterada no equipamento.

O fluxo de publicação aceita somente os quatro assets conhecidos de `release/0.5.1/publish`, confere checksums locais e digests remotos, exige tag/commit coincidentes e não substitui arquivos publicados. Testes sintéticos verificam o escopo da credencial, bloqueio de destino/repositório indevido, redirecionamentos e erros sem conteúdo sensível. Evidências técnicas: `artifacts/releases/v0.5.1-package.json`, `artifacts/smoke-0.5.1-asar.json` e `artifacts/packaged-check/native-result.json`.

## Central 0.3.0 / 0.4.0 / 0.5.0 — 26/10/2026

- **230 testes aprovados em 13 arquivos**, incluindo integração trapezoidal, precisão inteira, contadores prioritários, intervalos configuráveis, lacunas, relógio, roaming ambíguo, calendários de Bahia, inventário, ownership e retenção por resolução. A migração interrompida por `SQLITE_FULL` preserva a versão anterior e os dados; após liberar espaço, a repetição conclui. Foram mantidos os testes anteriores de corrupção, concorrência, suspensão, diagnóstico e autenticação.
- **TypeScript e build de produção aprovados**. Migrações 2→3→4→5 são aditivas e transacionais; o banco antigo de velocidades não foi convertido em consumo retroativo.
- **ASARs finais verificados com simulador**: 26 verificações na 0.3.0, 27 na 0.4.0 e 28 na 0.5.0. Incluem consumo por calendário, inventário/drawer, ownership, oito modalidades de CSV, autorização da inicialização antes do login, continuidade na bandeja, Canvas, ausência de polling por segundo e regressões das configurações. As etapas posteriores acrescentam Wi-Fi/Mesh/DNS, relatórios, limites de histórico e organização persistente de widgets. Resultados: `artifacts/smoke-<versão>-asar.json`.
- **Portáteis das três versões executados sem Node no PATH e sem administrador**, ocultos em perfis isolados: seis amostras reais, três níveis de agregados de consumo e SQLite válido. O diagnóstico ativo foi desativado nesses testes; as consultas ao equipamento foram somente de leitura. O teste final está em `artifacts/packaged-check/native-result.json`.
- **Auditoria autenticada somente de leitura**: quatro nós Mesh, 17 clientes online, velocidades válidas, RSSI e velocidade negociada, três bandas com canal/largura atuais e duas consultas DNS bem-sucedidas. O harness bloqueia setters. Os novos volumes foram identificados como estimativas, somente nos intervalos observados. Evidência sanitizada: `artifacts/observability/live.json`.
- **Desempenho com 900 amostras**, atualizações por segundo e interação de tooltip: desenho p95 **0,3 ms**, aproximadamente **56,7 desenhos/s**, sem tarefas recorrentes acima de 50 ms após aquecimento. Houve uma tarefa de inicialização contabilizada separadamente. Não é uma garantia de 60 FPS em qualquer computador. Evidência: `artifacts/chart-performance/after.json`.
- **Projeção, anomalia e relatórios fechados** foram validados com histórico sintético nos testes, inclusive cobertura insuficiente e geração idempotente. A rede real ainda não acumulou os sete dias completos necessários. Nenhum dado passado foi inventado para ativar essas funções.
- **Inicialização com Windows** foi testada com mocks: destino do portátil original, argumento fixo, rejeição de caminhos inseguros e operação limitada à conta atual. Os testes desktop confirmaram a barreira de autenticação. Nenhuma entrada real de inicialização foi habilitada durante a validação.
- **Pacotes e firmware**: o script `node scripts/verify-deliveries.mjs` confere SHA-256 das três entregas, identidade dos ASARs, allowlist de arquivos, proteção da inicialização e fuses; o pacote 0.5.0 também deve corresponder ao build local. Firmware original preservado com SHA-256 `0121bd96ee3f590f9f4a21a2b60220028f7f94f460f6579382dd15e22737dd62`. O manifesto das três entregas está em [releases.json](releases.json).

Reprodução: `npm.cmd test`, `npm.cmd run build`, `node scripts/run-smoke.mjs --packaged-asar --version=0.5.0`, `node scripts/benchmark-charts.mjs` e `node scripts/verify-deliveries.mjs`. O teste real `node scripts/test-packaged.mjs --read-only-live --version=0.5.0` utiliza a credencial local no backend, sem imprimi-la. Não foram executadas alterações de configuração, otimização, reboot, atualização de firmware ou diagnóstico ativo nesta evolução. O diagnóstico autorizado da 0.2.2 permanece documentado abaixo.

## Atualização 0.2.1

- **173 testes aprovados** em oito arquivos. Novos cenários cobrem continuidade com leituras de 2–3 segundos, lacunas explícitas, extremos na redução de pontos, escala estável, sessão/watermark, eventos durante snapshots, buffers limitados e sondas independentes de leituras WAN pendentes.
- **TypeScript e build de produção aprovados**.
- **21 verificações desktop aprovadas a partir do ASAR final**, incluindo Canvas ativo, `document.hidden=true` interrompendo o desenho, ausência de polling por segundo, retorno da janela, quatro tipos de CSV, preferências e regressões das telas existentes.
- **Benchmark sintético com 900 amostras**: p95 de desenho aproximadamente 0,3 ms; sem tarefas longas recorrentes acima de 50 ms após aquecimento. Gráfico vazio com zero desenhos/s em regime estável; fallback SVG confirmado. Limite de desenho de 60 FPS, com cerca de 55 desenhos/s observados neste ambiente. [Método e limites](charts.md).
- **Integração real aprovada**: login automático, quatro nós, dados/histórico avançando e três sondas disponíveis. As limitações de consumo e recursos continuam explícitas.
- **Portátil 0.2.1 validado sem Node no PATH e sem administrador**, em perfil isolado: seis amostras reais persistidas e `quick_check=ok` no SQLite; somente processos do teste foram encerrados.
- **ASAR conferido**: dez entradas, build correspondente, fuses preservados e ausência de `.env`, firmware, pesquisa, testes e banco local no pacote. Dados persistidos mantêm o formato anterior; não houve migração destrutiva.

Nenhuma configuração, diagnóstico ativo, teste de velocidade, reboot ou atualização de firmware foi executado no roteador nesta validação.

## Atualização 0.2.0

- **152 testes automatizados aprovados** em sete arquivos: acrescentados contadores uint64, lacunas, roaming, escopo, schemas de telemetria, qualidade, alertas, worker/SQLite, retenção, corrupção, migrações, disco cheio, fila limitada, sondas e isolamento de credenciais/sessão.
- **TypeScript e build de produção aprovados**.
- **19 verificações desktop aprovadas a partir do ASAR final**: cinco abas do monitoramento, preferências, quatro tipos de CSV, coleta após fechar a janela, pausa/retomada e regressões das telas existentes. Perfil separado, dados sintéticos, nenhuma sonda ou conexão real nessa execução.
- **Integração real pela interface aprovada**, com login automático, quatro nós, cinco amostras históricas avançando, três destinos de sonda e helper disponível. Consumo acumulado continuou indisponível, e nenhum percentual de CPU/memória foi apresentado como atual.
- **Helper ICMP real aprovado com ambiente mínimo**, inclusive após o isolamento das variáveis de credencial. Respostas do roteador e dos dois destinos externos foram recebidas.
- **ASAR e fuses conferidos**: dez entradas, incluindo o worker SQLite; main, preload, worker e renderer correspondem ao build. Nenhum `.env`, firmware, banco local, script de teste ou pesquisa foi incluído.
- **Portátil final executado sem Node no PATH e sem privilégios administrativos**, oculto em perfil isolado: seis amostras reais foram persistidas, e o banco passou em `quick_check`. Somente os processos descendentes desse teste foram encerrados.
- **Firmware preservado**: SHA-256 `0121bd96ee3f590f9f4a21a2b60220028f7f94f460f6579382dd15e22737dd62` conferido novamente.

Detalhes de origem, limites e operação estão em [monitoring.md](monitoring.md). A validação real desta versão não executou setters, diagnóstico ativo, testes de velocidade, reboot ou atualização no roteador.

## Atualização 0.1.3

A atualização ativa passou a buscar uma rodada por segundo, descontando o tempo gasto nas consultas. As consultas continuam sem sobreposição; atrasos do equipamento podem aumentar o intervalo efetivo. O cabeçalho não exibe botão, horário ou indicador de carregamento durante essas atualizações. A espera de 15 segundos em segundo plano ou após falha foi preservada. Os 97 testes, o build TypeScript/Vite e o teste desktop em demonstração passaram novamente nesta versão.

## Base 0.1.2

- **97 testes automatizados aprovados**: protocolo, criptografia, limites, sessão, cookies, validação de campos/listas, revisão, conflitos, ownership, resultados incertos, arquivos e login automático.
- **TypeScript e build de produção aprovados**.
- **Teste desktop em demonstração aprovado**: isolamento do renderer, leitura do catálogo, navegação das oito áreas, revisão/cancelamento, bloqueio de payload extra, ownership e logout. Nenhuma conexão real nesse teste; `TENDA_AUTO_LOGIN=false` é imposto pelo runner.
- **Login e consultas reais aprovados**: autenticação, bootstrap por cookie, decriptação, Internet conectada, quatro nós Mesh e clientes online. A quantidade de clientes varia com a rede.
- **Login automático completo aprovado pela interface e IPC**, utilizando a credencial do arquivo local somente no processo principal.
- **Leitura real dos 28 recursos do catálogo** realizada. Campos condicionais ausentes são tratados pelo adaptador; foram observadas falhas transitórias de socket, com uma única repetição permitida somente para consultas sem efeito.
- **Executável empacotado iniciado com PATH sem Node e sem privilégios administrativos**, com três subprocessos ativos. Perfil de teste separado e login automático desativado.
- **Pacote ASAR inspecionado**: somente nove entradas; sem `.env`, firmware, scripts de pesquisa, testes ou dependências de desenvolvimento. O main empacotado corresponde ao build atual.
- **Fuses inspecionados**: RunAsNode, NODE_OPTIONS, Inspector e privilégios extras de `file://` desabilitados; integridade ASAR e carregamento exclusivo por ASAR habilitados.

O login real identificou duas diferenças importantes em relação ao primeiro cliente reconstruído: o bootstrap `/goform/stokCfg` não usa prefixo `stok`, e o cookie legado `_:USERNAME:_` precisa ser aceito por seu nome exato. Há testes de regressão para ambos.

Não foram feitos testes reais de escrita, reset, restauração, pareamento, mudança de senha ou atualização de firmware no equipamento de produção. Esses fluxos foram validados com respostas sintéticas e revisão estática; o carrier de upload desconhecido falha de forma segura. O firmware original continua com o SHA-256 documentado em [firmware.json](firmware.json) e não foi descriptografado.

O executável é uma compilação pessoal sem assinatura digital de editor. Seu checksum está em `SHA256SUMS.txt`; a identidade da entrega está em [release.json](release.json).

## Atualização 0.2.2

201 testes automatizados passaram, incluindo manutenção global com seleção de nó, estados do diagnóstico, limites, cadência, expiração, pausa, suspensão, incerteza, migração 1→2 e persistência sem duplicação. O desktop com simulador passou 23 verificações: revisão da otimização com principal/secundário, uma amostra de recursos por ciclo, cinco tipos de CSV, Canvas, preferências, bandeja e validação IPC.

Um diagnóstico real autorizado do RX27Pro / V16.03.28.20_multi concluiu com CPU 8,75% e memória 65,11%, iguais aos campos consumidos pelo painel original. A coleta WAN continuou durante o ciclo, com 56 rodadas observadas pelo harness. Não foi utilizado `CLEAR_MODULE` nem executada otimização. O primeiro teste identificou que `init` já coloca o estado em `checking`; sua inicialização incompleta foi encerrada antes do ciclo validado, sem interromper itens ativos. Essa particularidade ganhou teste de regressão. Evidência sanitizada: `artifacts/monitoring/diagnostic-result.json`.

Medição de 900 amostras: desenho p95 0,3 ms, cerca de 55,2 desenhos/s e nenhuma tarefa recorrente acima de 50 ms. O tráfego mantém valores medidos e janela temporal contínua; recursos são medições pontuais.

O ASAR final corresponde ao build atual, contém versão 0.2.2 e não inclui `.env`, firmware, pesquisa ou testes. Os fuses de segurança foram conferidos. O executável portátil final passou com PATH sem Node, conta sem privilégios administrativos, perfil isolado, seis amostras reais e `PRAGMA quick_check=ok`; o diagnóstico foi desativado nessa verificação somente de leitura. A primeira tentativa do portátil terminou antes da coleta; uma repetição com captura técnica e novo perfil concluiu sem mensagens de erro. Os processos próprios do teste foram encerrados.
