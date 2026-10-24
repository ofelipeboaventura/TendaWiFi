# Configurações do RX27 Pro

Este catálogo implementa formulários locais e validação no processo principal. A fonte de compatibilidade é o JavaScript servido pelo RX27 Pro V1.0, firmware `V16.03.28.20_multi`, capturado durante a investigação. A existência de um campo no JavaScript prova o contrato usado pelo frontend; não prova a implementação ou a robustez do setter no firmware. Nenhuma escrita no roteador de produção foi executada para validar estes formulários.

## Convenção da interface

`FeatureDefinition` contém metadados de apresentação. `FeatureSnapshot.values` é um mapa plano: a chave literal `wifiBasicCfg.wifiSSID`, por exemplo, corresponde diretamente a `values[field.key]`. Tabelas são arrays de objetos em `values[table.key]`. A interface não recebe URLs, nomes de módulos configuráveis, funções de rede genéricas ou acesso ao sistema de arquivos.

O processo principal mantém uma lista fechada de recursos e schemas Zod estritos, inclusive para linhas de tabelas. Nomes de propriedades desconhecidos, identificadores de regras inexistentes, limites excedidos e campos somente de leitura alterados são rejeitados. Cada recurso aplica regras de negócio além da validação de formato.

## Recursos e evidências

| Recurso | Módulos do firmware | Fonte estática | Comportamento e limites |
|---|---|---|---|
| Wi-Fi nas três bandas | `wifiBasicCfg` | `wifi.js`, `chunk-common.js` | SSID de 2,4 GHz até 29 bytes UTF-8 e demais bandas até 32; senha ASCII de 8–63 caracteres nas redes protegidas; unificação exclusiva entre duas ou três bandas; WPA3 em 6 GHz. |
| Canais e largura | `wifiAdvCfg` | `wifiAdvance.js` | Canal numérico somente quando presente na lista retornada para banda/largura; preserva domínio regulatório. |
| Visitantes | `wifiGuest` | `wifiGuest.js` | Nomes diferentes da rede principal; validade de 4h, 8h ou permanente; limite de velocidade aplicado ?s duas dire??es, como no painel original. O controle de exigir senha ? derivado de guestPwd e n?o ? enviado como campo do firmware. |
| Agenda Wi-Fi | `wifiTime` | `devices.js` | Período `HH:MM-HH:MM`; dias 1–7 transformados no bitmap de sete posições do firmware. |
| LEDs | `ledCfg` | `led.js` | Ligado, desligado ou agenda. |
| Botão Mesh | `meshBtn` | `wifiMesh.js` | Ativação do botão físico. |
| Pareamento WPS | `wifiWpsList` | `wifiWps.js` | Ação explícita `wps` para um único `sn` pertencente à lista atual; não é um switch persistente de WPS. |
| WAN | `wanCfg`, `wanAdvCfg` | `wan.js`, `chunk-common.js` | DHCP, IP estático, PPPoE, PPTP, L2TP e PPPoE duplo; MTU por protocolo; DNS, MAC e credenciais. |
| Porta WAN | `wanAdvCfg` | `wanAdvance.js` | Negociação automática ou velocidade/duplex fixos anunciados no frontend original. |
| LAN e reservas | `lanCfg`, `staticIPList` | `lan.js` | Máscara contínua, pool na sub-rede LAN, exclusão de IP do roteador, reservas únicas; até 32 reservas. |
| IPv6 | `ipv6Cfg` | `ipv6.js` | DHCPv6, PPPoEv6 e estático; o endereço WAN é transportado como array do firmware. |
| Servidor VPN | `vpnServer`, `vpnAccountList` | `vpn.js` | PPTP/MPPE e até oito contas; credenciais mantidas por identificador da conta, nunca pela posição na tabela. |
| Cliente VPN | `vpnClient` | `vpn.js` | PPTP/L2TP, servidor e credenciais. Os protocolos são os legados do equipamento. |
| IPTV | `iptvCfg` | `iptv.js` | Multicast, IPTV e VLAN personalizada de 2 a 4094. |
| Firewall | `firewallCfg` | `firewall.js` | Defesas contra ICMP/TCP/UDP flood e bloqueio de ping pela WAN. |
| DMZ | `dmzCfg` | `advDmz.js` | Host unicast da LAN diferente do roteador. |
| Administração WAN | `remoteWeb` | `advDmz.js` | O desktop exige um IP de origem específico; recusa abertura para `0.0.0.0`. |
| Portas | `portList` | `advPortMap.js` | Até 16 regras; intervalos de 1–65535 com tamanhos equivalentes; recusa sobreposição por protocolo. |
| Rotas | `staticRouteList` | `advStaticRoute.js` | Até dez rotas manuais na WAN; normaliza rede pela máscara; preserva rotas de sistema fora da edição. |
| Filtro MAC | `macFilter` | `macfilter.js`, `chunk-common.js` | Até 64 entradas por lista; não permite excluir o computador de gerenciamento do acesso. A lista de permissão aparece em um ramo do código original, embora o menu desta compilação anuncie somente bloqueio. |
| DDNS | `ddnsCfg` | `advDdns.js` | Serviços listados no firmware e credenciais. |
| UPnP | `upnpCfg` | `advUpnp.js` | Habilitação explícita com revisão de segurança. |
| TR-069 | `tr069Cfg` | `tr069.js` | ACS, informes, conexão e STUN; limites de portas e intervalo validados. |
| Aplicação Tenda | `cloudManage` | `app.js` | Leitura limitada à ação `basic`; mantém a configuração existente de conta, sem fazer consulta/registro de conta no serviço cloud. |
| Controle parental | `parentControlList` | `parent-controls.js` | Até dez grupos, dez horários e dez sites por grupo; clientes devem constar da lista do roteador; dispositivo não pode pertencer a dois grupos. |
| Modo de operação | `workMode` | `workMode.js` | Roteador, AP, WISP e Cliente+AP. Repetição usa o ramo manual `handset:"1"` e exige Mesh desativado. |
| Data/hora | `systemTime` | `systemTime.js`, `chunk-common.js` | Sincronização, hora manual, fuso com valores codificados do fornecedor e flag de horário de verão; períodos DST existentes são preservados. |
| Manutenção | `systemMaintenance` | `systemMaintenance.js` | Habilitação, horário de reinicialização e adiamento quando há tráfego. |

## Revisão, sessão e consistência

Cada edição exige o token de revisão devolvido pela leitura. Ele é um HMAC com chave aleatória mantida no processo principal: a interface não recebe um hash estável de credenciais que possa facilitar tentativa de adivinhação de senhas. Antes de preparar e antes de aplicar, o serviço consulta o roteador e compara a revisão.

A preparação produz um identificador `feature:<UUID>`, válido por dois minutos e consumido uma única vez. A confirmação resume os campos alterados, omite senhas e informa risco de desconexão ou mudança de proteção. Cancelamento, troca de conexão e desconexão invalidam revisões. O controlador principal deve chamar `FeatureService.clear()` ao encerrar/substituir uma sessão e deve serializar operações de manutenção com alterações de configuração.

Senhas existentes nunca são devolvidas ao renderer. Um campo de senha vazio mantém a credencial lida no processo principal; uma nova conta VPN exige uma nova senha. Nenhum segredo entra no texto de revisão ou na auditoria. Reordenação de contas preserva as senhas pelo identificador da conta. Somente os campos conhecidos de cada contrato são escritos; metadados arbitrários da resposta não são retransmitidos.

Escritas não têm retry automático. Após timeout, uma nova leitura tenta confirmar o resultado. Se ele permanecer incerto, a alteração é bloqueada até uma leitura atualizada. Edições normais recebem leitura de confirmação; ações que podem derrubar a conexão retornam instrução de reconexão, sem declarar que o equipamento já terminou de aplicá-las.

## Limites e verificação

O serviço permite leitura em versões diferentes, mas nega escritas reais fora do RX27 Pro `V16.03.28.20[_multi]`. Recursos dependentes de modo e flags são desabilitados quando não anunciados. Campos ausentes no contrato retornado não podem ser introduzidos por uma edição; a exceção documentada é a configuração manual de repetição, descrita expressamente pelo JavaScript original.

Os testes usam um provedor inteiramente local, com dados fictícios. Cobrem schemas estritos, UTF-8, sub-redes, portas sobrepostas, proteção do administrador, identificação de linhas, preservação de segredos, limites de capacidades, revisão concorrente, expiração, cancelamento, replay, timeout e confirmação sem retry. A compatibilidade de setters do firmware permanece sujeita a testes controlados em equipamento de laboratório ou com autorização específica de manutenção.

## Confirma??o por consultas reais

Login e consultas autenticadas foram executados com sucesso contra o equipamento em 24/10/2026. As 28 consultas do cat?logo retornaram seus m?dulos durante a primeira varredura. Campos de rede sem fio do modo repetidor n?o aparecem no modo roteador; dhcpDelegation IPv6 pode estar ausente no contexto atual. O controle guestSecurityMode ? uma abstra??o da interface derivada da presen?a de guestPwd, n?o um campo retornado pelo firmware. Uma segunda varredura observou uma falha transit?ria de rede na consulta parental, seguida de outras consultas bem-sucedidas; indisponibilidade n?o ? convertida em dados vazios ou sucesso. Nenhuma configura??o real foi gravada.
