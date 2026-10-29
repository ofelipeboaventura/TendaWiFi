# Modelo de ameaças e limites

## Fronteiras de confiança

O renderer é não confiável. O processo principal autentica a conexão, valida o emissor IPC (janela e frame principal), valida schemas Zod estritos e escolhe os endpoints e módulos de uma lista fechada. Uma página externa não recebe preload, cookies, tokens, API de sistema ou acesso ao roteador pelo bridge. O renderer recebe somente comandos de domínio e dados necessários à tela; senhas já configuradas são substituídas por campos vazios.

O login automático é opcional e usa `.env.local` somente no backend. O arquivo armazena a senha em texto por escolha do usuário; não oferece a proteção do Windows Credential Manager/DPAPI. Ele não é empacotado, versionado nem retornado via IPC. Somente três variáveis conhecidas são aceitas, o arquivo tem tamanho limitado e há uma única tentativa por inicialização. O teste desktop força `TENDA_AUTO_LOGIN=false` no processo de teste para nunca conectar à rede real por causa de uma credencial local configurada.

Dados do roteador também são não confiáveis: respostas têm limites de tamanho, profundidade e quantidade; chaves perigosas e tipos inesperados são rejeitados. React renderiza nomes e logs como texto, sem inserir HTML. O protocolo `tenda://app` serve somente arquivos locais permitidos. CSP bloqueia scripts externos, frames, objetos, formulários e conexões do renderer. Sandbox, isolamento de contexto e segurança web estão habilitados. Permissões, novas janelas e navegação externa são negadas. O pacote desativa fuses de RunAsNode, NODE_OPTIONS e Inspector e exige ASAR com integridade.

## Ameaças e controles

| Vetor | Controle |
|---|---|
| Frontend adulterado / payload extra | Schemas estritos no processo principal; catálogo e operações fechados; limite de tamanho e chamadas IPC. |
| IDOR em clientes ou nós | Busca autenticada atual, verificação de MAC/nó/ownership antes de revisar e aplicar; não aceita destinos de upload de satélites. |
| Bloqueio do administrador | Verificação do cliente local e do MAC do computador administrador; listas de permissão devem preservá-lo. |
| Replay / clique duplicado | Confirmação aleatória de uso único com validade de dois minutos, vinculada à sessão; aplicações serializadas. |
| Corrida / alteração concorrente | Revisões HMAC das configurações, nova consulta antes da escrita, rejeição de estado alterado. Trocar sessão invalida confirmações e arquivos. |
| Timeout após envio | Sem retry automático de POST; resultado incerto bloqueia novas operações até consulta bem-sucedida. Formulários também exigem reconsulta da configuração afetada. |
| SSRF / DNS rebinding / redirecionamento | Somente IPv4 privado canônico, porta 80, transporte nativo sem proxy e sem DNS; nenhum redirecionamento é seguido. |
| Brute force | Bloqueios informados pelo equipamento, tentativas limitadas no aplicativo e nenhuma tentativa automática de senha. |
| Upload indevido / troca de arquivo | Escolha por diálogo nativo, extensão e tamanho, snapshot imutável em memória, verificação de arquivo alterado durante leitura; firmware com hash conhecido e controlador verificado. |
| Vazamento em logs | Auditoria em memória sem payloads ou credenciais. Linhas de log do roteador com marcadores comuns de segredo são omitidas integralmente. |

## Limites que o aplicativo não corrige

HTTP não autentica o equipamento contra um adversário ativo da LAN. MD5 e AES-CBC com IV fixo são compatibilidade com o firmware, não criptografia nova recomendada. Não foi demonstrado que o firmware impede replay, aplica todos os limites do frontend, valida corretamente uploads ou revoga imediatamente uma sessão desconectada no desktop.

O hash conhecido do `.bin` impede substituir acidentalmente o arquivo analisado, mas não comprova assinatura do fabricante nem garante recuperação após uma falha elétrica. Uploads de formato desconhecido são recusados ou classificados como incertos, nunca sucesso presumido.

Os logs do roteador podem ter conteúdo arbitrário que o aplicativo não consegue classificar perfeitamente. A auditoria do desktop não inclui tais payloads e não os exporta automaticamente. Backups opacos podem conter segredos e herdam os controles de acesso do diretório escolhido no Windows. Memória de processos, pagefile e uma máquina já comprometida estão fora das garantias de proteção oferecidas pelo aplicativo.

Não há serviço HTTP local, service role, nuvem própria, autoatualização ou compartilhamento de diagnóstico. O histórico usa SQLite local em worker, com consultas parametrizadas e perfil por roteador. Recursos de nuvem, TR-069 e atualização do fornecedor são iniciados pelo roteador somente após configuração ou ação explícita do usuário.

O diagnóstico automático autorizado na 0.2.2 usa apenas operações fixas `check/init`, `check/start`, `check/stop`. O renderer pode habilitar/desabilitar a preferência; não fornece módulo, ação, destino nem intervalo arbitrário. Ciclos são limitados no backend, serializados com manutenção e invalidados na troca de sessão. Resultados antigos, incompletos ou sem transição comprovada não viram métricas novas. A otimização Mesh mantém revisão de uso único, validação estrita e confirmação explícita; selecionar um nó não acrescenta campos a ações globais. IDs de revisão inválidos não interrompem o diagnóstico.

As versões 0.3–0.5 acrescentam consultas de calendário limitadas a 24 meses, MACs históricas vinculadas ao perfil autenticado e layouts restritos a IDs predefinidos. A camada principal rejeita campos extras, origens arbitrárias, URLs de widgets, IDs de relatórios indevidos e alterações de inicialização anteriores ao login. Migrações são aditivas e transacionais; replay de amostras usa sessão/sequência. Erros SQL/corrupção não são retornados como mensagens internas ao renderer. Sondas DNS têm nome fixo e destinos fechados; ICMP Mesh aceita apenas IPs privados dos nós autenticados na mesma sub-rede suportada. Integração de volumes não extrapola lacunas, não contabiliza roaming ambíguo e não transforma tráfego local em Internet. Arquivos CSV continuam protegidos contra fórmulas.

## Validação

Na 0.5.3, reinicialização por nó reutiliza apenas `prepareAction`/`applyChange`. O renderer envia ação e ID; não pode fornecer MAC, IP, papel ou comando arbitrário. O backend confirma ownership e estado online, consulta `meshInfo` com o SN autenticado, exige resposta para o mesmo SN e valida MAC unicast, papel e IP privado do satélite. Guarda essa identidade na revisão e compara novamente antes de escrever. Campos ausentes/inválidos, troca de papel/endereço, revisão cancelada/expirada, sessão trocada ou alvo removido impedem o envio; o destino nunca é substituído pelo principal. Cliques concorrentes consomem a revisão uma vez. Um timeout de escrita mantém a barreira de resultado incerto e não dispara retry.

O modal acompanha o estado atual do nó. Fechá-lo enquanto prepara uma revisão invalida o contexto local e cancela uma revisão que chegue tardiamente, sem abrir confirmação ou enviar reinicialização. O atalho Manutenção mantém o ID selecionado e não recai no principal se o nó desaparecer. A auditoria real usa credencial somente no backend e bloqueia todos os setters; seus resultados expõem somente estados/booleanos sanitizados. Os testes de escrita são sintéticos.

Os testes usam senhas e respostas sintéticas. O simulador é um provedor em memória, sem conexão de rede. O teste desktop confirma isolamento, navegação, leitura do catálogo, revisão/cancelamento, whitelist IPC e ownership. Testes reais de escrita exigem um ambiente controlado e autorização específica; não são parte do desenvolvimento contra a rede de produção.


## Distribuição e GitHub Releases

Na visualização Wi-Fi/Mesh 0.5.2, nomes de dispositivos/nós, endereços e demais campos permanecem texto React, sem HTML dinâmico. Filtros e expansão não recebem destinos de rede, comandos ou operações de manutenção, e não expõem novos canais IPC. A seleção local de um nó não constitui autorização para ações de backend. A fixture de teste contém payloads maliciosos sintéticos e fica fora do pacote. Históricos com falha ou campos ausentes não são convertidos em métricas zero; associações ambíguas não duplicam tráfego.

Vetores considerados: inclusão acidental de credenciais/firmware nos assets, troca de binário após calcular SHA-256, tag apontando para outro código, substituição silenciosa de uma release e vazamento da autenticação em redirecionamentos/logs. O diretório de upload aceita quatro nomes fixos, arquivos regulares com tamanho limitado e hashes consistentes com o manifesto. O publisher verifica branch limpa, HEAD remoto e tag; publica primeiro como rascunho, valida digests do GitHub e recusa assets divergentes. Não reescreve tags nem substitui assets publicados.

O credential helper do Git fornece autenticação somente em memória. Não há token em argumento de processo, arquivo, renderer ou relatório. Destinos autenticados são restritos a api.github.com e uploads.github.com, com repositório fixo e redirecionamentos bloqueados. Arquivamento local move apenas nomes de launchers antigos, dentro do projeto, e confere SHA-256 antes/depois; a configuração privada fica no lugar. Os ícones são recursos locais sem conteúdo executável. A ausência de certificado de editor permanece explícita.
