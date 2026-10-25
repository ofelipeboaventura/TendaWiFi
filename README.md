# Tenda WiFi Desktop

Gerenciador local para **Tenda RX27 Pro V1.0 / V16.03.28.20_multi**, com interface própria em português do Brasil. Feito em Electron, React, TypeScript e Zod. O código das telas fica em `src/renderer`; protocolo e validações ficam em `src/main`.

## Usar no Windows

Abra o executável portátil mais recente indicado em `docs/release.json`, informe o IP local do roteador e a senha de administração. O programa não precisa de Node instalado nem de privilégios administrativos. **Explorar demonstração** abre um simulador inteiramente local, identificado em todas as telas.

A atualização silenciosa usa um coletor central com cadência-alvo de uma rodada por segundo, inclusive com a janela oculta. Consultas não se sobrepõem; falhas usam espera progressiva de 2/5/15 segundos. Fechar a janela mantém a coleta na bandeja; para encerrar, use **Sair** no menu da bandeja.

**Monitoramento** oferece cinco abas, gráficos interativos, ranking por dispositivo, sondas ICMP, alertas do Windows, CSV e histórico local de 30 dias. A versão **0.2.2** corrige a otimização Mesh e coleta CPU/memória pelo diagnóstico do roteador a cada 5 minutos, com horário, idade e histórico de cada medição. Essa coleta pode ser desativada nas preferências. O consumo acumulado continua indisponível quando não existem contadores confirmados, sem estimativas. A demonstração é inteiramente sintética. Consulte [métricas, segurança e limitações](docs/monitoring.md).

Na versão 0.2.1, os gráficos deslizam continuamente em Canvas, com picos e lacunas preservados. As janelas curtas são alimentadas por eventos, sem recarregar o histórico a cada segundo. [Detalhes e medições](docs/charts.md).

O programa consulta o equipamento somente após o login. Nenhuma configuração é aplicada automaticamente: alterações exigem uma revisão com confirmação; restauração e reset exigem digitar `CONFIRMAR`. A sessão e os tokens ficam em memória. Encerrar o aplicativo remove a sessão local, mas a expiração/revogação no equipamento depende do firmware.

### Login automático opcional

Preencha `.env.local` na raiz do projeto (desenvolvimento) ou ao lado do `.exe` portátil:

```dotenv
TENDA_ROUTER_HOST=192.168.0.1
TENDA_AUTO_LOGIN=true
TENDA_ROUTER_PASSWORD="sua senha"
```

Esse arquivo é lido **somente no processo principal**, não é enviado ao renderer, está ignorado pelo Git e não acompanha o executável. A senha fica em texto no arquivo: proteja o diretório com sua conta do Windows e remova-a quando não precisar de login automático. O aplicativo faz uma tentativa por inicialização, respeita o bloqueio do roteador e não repete senhas automaticamente. Para desativar, use `TENDA_AUTO_LOGIN=false`. Variáveis de ambiente do processo prevalecem sobre o arquivo. A senha digitada no formulário normal não é salva nesse arquivo.

O comando `node scripts/diagnose-env.mjs` faz uma tentativa de login e consultas usando essa configuração e grava somente etapas/códigos/contagens em `artifacts/login-diagnostics.json`, sem senha ou tokens.

O `.exe` de desenvolvimento pessoal não possui certificado de assinatura digital. Compare seu SHA-256 com `SHA256SUMS.txt`; esse checksum identifica o arquivo, mas não substitui uma assinatura de editor.

## Recursos implementados

- Visão geral, velocidades e histórico desta sessão, topologia Mesh, dispositivos online/offline/visitantes e bloqueados.
- Nomes de clientes, limites de tráfego e bloqueio, com proteção do computador administrador.
- 28 formulários de configuração: Wi-Fi nas três bandas, visitantes, canais, agendas, LED, WPS/Mesh, WAN, LAN/DHCP/reservas, IPv6, VPN, IPTV, firewall, DMZ, administração WAN, portas, rotas, filtro MAC, DDNS, UPnP, TR-069, integração Tenda, controle parental, modo de operação, hora e manutenção automática.
- Backup, restauração, reinicialização, reset, busca/adição de nós, otimização Mesh, consulta/atualização de firmware e senha de administração.
- Revisão detalhada, expiração e uso único das confirmações; detecção de configurações alteradas e de resultados incertos.

O catálogo acompanha o contrato observado nos scripts originais. Escritas reais, atualizações e restaurações **não foram usadas como testes no roteador de produção**. Recursos desconhecidos são recusados; não se afirma equivalência completa a todas as telas e combinações do fornecedor. Consulte os limites em [docs/features.md](docs/features.md) e [docs/protocol.md](docs/protocol.md).

## Desenvolver e compilar

Requisitos de desenvolvimento: Windows x64, Node.js 24 e npm. No PowerShell, use `npm.cmd` se a política local bloquear `npm.ps1`; não é necessário alterar a política de execução.

```powershell
npm.cmd ci
npm.cmd run dev
```

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:desktop
npm.cmd run package
```

O teste desktop usa somente demonstração, em janela oculta, e grava capturas e resultados em `artifacts/`. O empacotamento inclui apenas `out`, `dist` e o manifesto; exclui firmware, capturas, fontes originais e ferramentas de diagnóstico.

Os componentes e estilos em `src/renderer` podem ser editados e recompilados. Para acrescentar uma configuração, atualize o catálogo e o schema em `src/main/features`, mantenha a interface IPC restrita e adicione evidência do contrato e testes de validação. Não exponha uma função genérica de HTTP, IPC ou execução de código ao renderer.

## Evidências e segurança

- [Protocolo, autenticação e APIs](docs/protocol.md)
- [Catálogo e validação das configurações](docs/features.md)
- [Análise do firmware](docs/firmware.md)
- [Modelo de ameaças](docs/security.md)
- [Manifesto e hashes dos scripts observados](docs/source-manifest.json)

`npm.cmd run research` refaz a análise estática do `.bin` local. O original está ignorado pelo Git, permanece intacto e não acompanha o executável.

A skill REA `reverse-engineer-anything` foi instalada separadamente no diretório pessoal do Codex, no commit `de088fcec661a215df76e234c5375c952e2f5c58`. A instalação contém instruções e referências; não registra servidor MCP nem instala engines de análise.

## Comunicação com o roteador

O firmware observado usa HTTP e criptografia legada de aplicação. Isso não oferece as garantias de HTTPS e não impede um atacante presente na rede local. Use o gerenciador em uma rede confiável. O aplicativo restringe o destino a um IPv4 privado literal, não segue redirecionamentos e não envia telemetria.

A atualização local aceita exclusivamente o firmware RX27 Pro anexado e verificado pelo SHA-256 documentado, para o controlador principal. Para outras versões, use a atualização online oferecida pelo próprio roteador ou acrescente uma nova identidade de firmware após análise. Backups `.cfg` podem conter credenciais; são salvos somente no local escolhido pelo usuário.
