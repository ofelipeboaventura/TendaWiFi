# Protocolo observado do RX27 Pro

Alvo: Tenda RX27 Pro V1.0, firmware `V16.03.28.20_multi`. As evidências são os arquivos JavaScript públicos capturados do roteador em `research/vendor`, cujo manifesto local registra SHA-256 e rotas. Esses arquivos e o firmware bruto ficam fora do Git e do executável. Nenhuma sessão autenticada foi copiada para fixtures.

## Autenticação e transporte

Observado no `login.js`: consultar `GET /goform/loginInfo`; enviar `POST /login/Auth` com JSON `{userName:"admin",password:MD5_UTF8_MAIUSCULO}`. A resposta de sucesso contém `errCode:0`, `sign` e `stok`. Ao abrir index.html, o painel apaga os tokens do sessionStorage e consulta `GET /goform/stokCfg?rand=...`, sem prefixo de token, usando o cookie do login. Essa resposta ? plaintext e fornece os tokens a serem usados nos m?dulos. O firmware emite o cookie legado de nome exato `_:USERNAME:_`, que cont?m dois-pontos; ele precisa ser preservado apesar de n?o corresponder ao padr?o comum de nomes de cookies. Essa sequ?ncia foi confirmada em login e consultas reais, sem escrita de configura??o.

Observado no `chunk-common.js`, módulo `5bfe`: chave AES é o UTF-8 de `sign`, IV de compatibilidade `EU5H62G9ICGRNI43`, modo CBC, preenchimento PKCS#7 e ciphertext em Base64. Requisições POST autenticadas usam JSON `{data:<ciphertext>}`; respostas autenticadas carregam o mesmo envelope. Esse protocolo legado não tem autenticação criptográfica da mensagem e não equivale a HTTPS. A aplicação mantém chaves, cookies e tokens somente no processo principal e na memória.

Consultas usam `GET /;stok=<token>/goform/getModules?modules=<lista>&rand=<valor>`. Escritas usam `POST /;stok=<token>/goform/setModules?modules=<chaves do objeto>`. O conteúdo descriptografado contém as propriedades dos módulos. `errCode:1000`, redirecionamento e página HTML de login encerram a sessão local. Outros códigos não são convertidos em sucesso.

O cliente restringe o destino a um IPv4 RFC1918 literal. Não segue redirecionamentos, não faz resolução de nomes e não utiliza proxy do ambiente. Consulta e escrita compartilham uma fila; escritas nunca são repetidas automaticamente. Timeout ou confirmação inválida de escrita gera resultado incerto.

## Status, Mesh e clientes

| Função | Módulos e campos observados |
| --- | --- |
| Identificação | `systemCfg.productName`, `softVersion`, `hardVersion`, `runTime`; `workMode.workMode`; flags públicas de `macro_config.js` |
| Internet | `wanStatus.connectCode` (`1` conectado), `wanUpSpeed`, `wanDownSpeed`, `wanIP`, `wanType` |
| Wi-Fi | `wifiBasicCfg.wifiSSID`, `wifiSSID_5g`, `wifiSSID_6g`, `wifiCurStatus*`, `wifiEn*`, `doubleBand`, `tripleBand` |
| Topologia | `meshTopo` é a raiz; cada nó usa `sn`, `nodeName`, `clientNum`, `connectStatus` e `childNode[]` |
| Clientes | `deviceList[]` por nó (`sn`, `nodeName`), com `onlineList`, `guestList`, `offlineList`; cada cliente usa `mac`, `hostname`, `ip`, `connectType`, `upSpeed`, `downSpeed`, `upLimit`, `downLimit`, `controlEn`, `connectTime` |
| Bloqueio | `macFilter.macFilterEn`, `curFilterMode`, `blackList[]`; comparação de MAC sem diferença de caixa |

`deviceListNotNeedRate` é um nome de consulta; o painel lê o resultado na chave `deviceList`. A interface original divide velocidades por 128 para exibir Mbps: a unidade da API é KB/s. O modelo do aplicativo normaliza velocidades para bytes/s multiplicando por 1024; limites permanecem em KB/s, com `0` ilimitado. O intervalo de limites não nulos observado é `64..128000` KB/s. Tempos são segundos.

Renomeação/limites: `setDeviceInfo` recebe o registro do dispositivo com `hostname`, `upLimit`, `downLimit` e `controlEn` alterados. Bloqueio: `macFilter:{macFilterEn:true,curFilterMode:"deny",blackList:[{hostname,mac},...]}`, máximo de 64 entradas. Uma lista de permissão ativa não deve ser convertida silenciosamente em lista de bloqueio.

## Operações com efeito

O método HTTP não determina se uma operação é somente leitura. `scanNodeList` com `action:"scan"` inicia busca Mesh por GET; os resultados são consultados com `action:"scanResult"`. O cliente oferece métodos separados para essas operações. `CLEAR_MODULE` e `SyncPPPoeAccount` não entram na lista de consultas comuns.

- Reiniciar: `systemReboot:{action:"reboot"}`; para um satélite, o painel acrescenta `sn`, `mac` e `ip`.
- Restaurar padrão de fábrica: `systemReset:{action:"reset",sn?}`.
- Otimizar: `meshOptimize:{action:"optimize"}`.
- Adicionar nó: `addNode:<serial>` (string no código capturado).
- Alterar nome/LED do nó: registro `meshInfo` com `nodeName`/`ledEn` alterados; remover usa `meshInfo:{action:"remove",sn,ip,mac}`.
- Consultar nova versão: `deviceVersionList:{action:"queryversion",sn?}`. Atualização online: `action:"queryupgrade"`.

Os identificadores de cliente e nó devem sempre ser conferidos contra uma consulta autenticada atual antes da escrita. O transporte não substitui a validação específica de cada formulário nem a autorização por ownership feita pelo serviço principal.

## Backup e upload

Backup observado: `GET /cgi-bin/DownloadCfg/RouterCfm.cfg`. Restauração: multipart POST em `/cgi-bin/UploadCfg`. Atualização local do controlador: primeiro `agentLocalUpgrade:{sn}`, depois multipart POST em `/cgi-bin/upgrade`, com campo oculto `sn` e arquivo no campo `file`. A aplicação limita upload local ao controlador escolhido, evitando transmissão de credenciais para outros hosts. O nome transmitido é gerado pela aplicação.

A resposta de upload é esperada com `error` numérico; o parser aceita JSON e um carrier limitado de iframe/postMessage, sem executar JavaScript. Uma resposta desconhecida é incerta, nunca sucesso presumido. Não foi realizado upload real para validar o carrier exato desse firmware.

O formato anexado de firmware tem um prefixo de quatro bytes big-endian igual ao comprimento restante e payload múltiplo de 16. Isso é evidência de enquadramento, não autenticação de origem, assinatura, chave ou prova do algoritmo. O aplicativo faz verificação adicional da identidade do arquivo aprovado antes de enviá-lo; o roteador continua responsável por validar compatibilidade e integridade do firmware.

## Limitações verificáveis

Na versão 0.2.2 foi validado um diagnóstico ativo autorizado: `syschkInfo:{operation_name:"check",operation_action:"init"|"start"|"stop"}`. O `init` deixa `check_type:"checking"` e todos os itens `unchecked`; somente `start` inicia os testes. A leitura comum de `syschkInfo`, sem `CLEAR_MODULE`, acompanha progresso e conclusão. CPU/memória vêm de `run_status.details.cpu_rate/mem_rate`. Não há identificador exclusivo de execução nem mecanismo de diagnóstico por satélite comprovado. Essa validação não executou `meshOptimize`, alterações de configuração ou firmware.

A implementação tem testes com respostas e credenciais sintéticas. Login real, escrita, atualização e restauração no equipamento de produção não foram usados como teste de desenvolvimento. O protocolo e os mapeamentos foram reconstruídos de código estático e observação do painel, portanto comportamento de escrita real permanece sujeito a validação controlada. Desconectar o aplicativo apaga a sessão local; não se afirma que o token já emitido foi revogado no roteador. O ciclo de vida e a expiração desse token são impostos pelo firmware original.
