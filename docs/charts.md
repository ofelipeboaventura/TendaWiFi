# Gráficos e fluidez — 0.2.1

Na versão 0.2.2, CPU/memória usam os registros individuais do diagnóstico como pontos, sem copiar valores nas amostras WAN ou ligar os intervalos sem medição. A alternativa SVG também desenha esses pontos. Em nova medição sintética de 900 amostras nesta máquina, o desenho p95 foi **0,3 ms**, aproximadamente **55,2 desenhos/s**, sem tarefas recorrentes acima de 50 ms; o objetivo de 60 desenhos/s permanece um alvo, não uma garantia do equipamento.

Os gráficos usam Canvas 2D em três camadas: grade, séries e interação. O desenho tem cadência-alvo limitada a 60 FPS; a coleta continua em 1 segundo para tráfego e 5 segundos para ICMP. A janela de tempo mantém o período escolhido, inclusive na coleta inicial. Não são geradas novas medições para preencher os frames.

O eixo Y expande para acomodar picos e só reduz após dez segundos de necessidade menor. As linhas seguem amostras reais; tooltip e teclado apontam para horários/valores medidos. Redução por resolução preserva extremos e interrupções, sem converter pontos em médias artificiais. A resolução física do Canvas é limitada a DPR 2.

## Continuidade e dados

- O critério antigo de aproximadamente `mediana × 1,8` foi removido. O backend identifica pausas e intervalos de tráfego superiores a 3,5 segundos. Amostras com intervalos de 2–3 segundos não são cortadas por um critério visual diferente.
- A latência usa os registros ICMP originais, com seus próprios horários, timeouts e interrupções. Sondas também são persistidas quando uma consulta WAN está pendente. Campos de continuidade não alteram o formato persistido legado.
- `ChartFrame` acrescenta época de sessão, sequência crescente e atualizações de tráfego/sondas ao evento tipado existente. `ChartSample` identifica horário, valor e interrupção anterior. O snapshot captura pontos e watermark antes da consulta assíncrona; eventos posteriores são reconciliados sem duplicação.
- As janelas de 5/15 minutos recebem eventos incrementais depois do snapshot inicial. Abrir uma janela/filtro ou voltar do segundo plano solicita sincronização; o histórico longo pode atualizar a cada 30 segundos. Não existe consulta de histórico a cada frame ou a cada segundo.
- O store usa assinaturas seletivas; desenho, cursor e tooltip não atualizam estado React a cada frame. Consultas, buffers e cálculos históricos ficam fora do loop de animação. Dados recentes continuam visíveis se o histórico estiver indisponível, identificados como parciais.
- Ocultar a janela interrompe o desenho, preservando a coleta no processo principal. Gráficos sem métricas permanecem estáticos; movimento reduzido do sistema é respeitado. Se Canvas não estiver disponível, existe alternativa SVG estática com unidades, grade, tooltip e teclado.

## Validação de desempenho

Harness reproduzível: `node scripts/benchmark-charts.mjs`; variantes `--empty` e `--fallback`. Os resultados ficam em `artifacts/chart-performance`. O cenário usa 900 amostras, atualizações de dados/dispositivos por segundo e movimento de mouse aproximadamente a cada 16 ms, em perfil separado, sem roteador.

Na medição isolada nesta máquina:

| Cenário | Resultado |
| --- | --- |
| Canvas com 900 amostras | p95 de desenho ≈0,3 ms, abaixo da meta de 8 ms; aproximadamente 55 desenhos/s no ambiente medido, com limite configurado de 60. |
| Tarefas longas após aquecimento | Nenhuma acima de 50 ms no cenário medido. A inicialização é contabilizada separadamente. |
| CPU/memória indisponíveis | Zero desenhos/s após estabilizar; somente os desenhos iniciais da grade. |
| Canvas indisponível | SVG alternativo confirmado, sem loop Canvas. |

O baseline preservado em `before.*` corresponde ao SVG anterior. A contagem de callbacks `requestAnimationFrame` do harness não é a frequência de atualização das linhas: no SVG anterior, o traçado mudava quando chegavam dados. O p95 acima mede trabalho de desenho no renderer, não o tempo completo da GPU nem uma garantia de FPS em qualquer equipamento.

Testes adicionais cobrem watermark/sessão, chegada de eventos durante snapshot, intervalos de 2–3 segundos, lacunas, redução com extremos, precisão uint64, buffers limitados e sondas independentes da WAN. A verificação desktop instrumenta chamadas de histórico e desenho, e confirma o funcionamento de CSV e das telas existentes.
