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

## Validação

Os testes usam senhas e respostas sintéticas. O simulador é um provedor em memória, sem conexão de rede. O teste desktop confirma isolamento, navegação, leitura do catálogo, revisão/cancelamento, whitelist IPC e ownership. Testes reais de escrita exigem um ambiente controlado e autorização específica; não são parte do desenvolvimento contra a rede de produção.
