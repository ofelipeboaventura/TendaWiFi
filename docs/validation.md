# Validação das versões

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
