# Distribuição e publicação

A release atual é identificada por `package.json`, `docs/release.json` e uma tag `v<versão>` no mesmo commit. O repositório guarda fontes e ícones; executáveis são assets de GitHub Releases. Arquivos privados, firmware, bancos e capturas não são publicados.

## Arquivos locais

- `resources/icon.svg`: desenho editável do ícone; PNG e ICO derivados também são versionados.
- `release/<versão>/win-unpacked`: pacote para inspeção e teste.
- `release/<versão>/publish`: somente executável, SHA-256, instruções e manifesto destinados ao GitHub.
- `release/archive/<versão>`: portáteis anteriores preservados, sem mudar seu conteúdo.
- `TendaWiFi-<versão-atual>.exe`: cópia conveniente ao lado da configuração local privada.

O `.env.local` existente permanece no projeto e nunca é copiado para `publish`. Quem baixar a release pode criar sua configuração privada ao lado do executável. O histórico permanece na pasta do usuário Windows. Inicialização automática precisa ser reconfigurada ao mudar o caminho/nome do portátil.

## Preparação

Atualize a versão em `package.json`/lock e as notas em `docs/releases/v<versão>.md`. Preserve a branch escolhida pelo usuário. Ícones podem ser regenerados com `npm.cmd run build:icons`; o renderer usa somente arquivos locais.

```powershell
npm.cmd test
npm.cmd run package
npm.cmd run release:prepare
node scripts/run-smoke.mjs --packaged-asar
node scripts/test-packaged.mjs --read-only-live
node scripts/verify-deliveries.mjs
```

`release:prepare` não sobrescreve um executável existente com conteúdo diferente. `archive-portables.mjs --apply` move somente launchers antigos da raiz, confere hashes antes/depois e mantém credenciais no lugar. A pasta `release` é ignorada pelo Git.

## GitHub

Após revisar as mudanças e finalizar testes, faça commit na branch atual, envie o commit e crie/envie a tag anotada correspondente. Não reescreva uma tag publicada. Não adicione binários ao Git.

```powershell
node scripts/github-release.mjs --inspect
node scripts/github-release.mjs --draft
node scripts/github-release.mjs --publish
node scripts/github-release.mjs --verify
```

O publisher exige `main` limpa, commit remoto e tag iguais ao HEAD, quatro assets conhecidos, tamanho/checksum corretos e destino fixo `ofelipeboaventura/TendaWiFi`. Autenticação vem do credential helper do Git, em memória; não entra em arquivos, argumentos ou logs. Requisições autenticadas aceitam somente `api.github.com`/`uploads.github.com`, sem redirecionamento. O upload é feito primeiro em rascunho; só publica após conferir o digest remoto dos quatro assets. Reexecuções reutilizam assets idênticos e recusam divergências. Assets publicados nunca são substituídos automaticamente.

O executável tem ícone e informações de produto/versão. Continua sem assinatura de editor: `signExecutable: false` preserva a edição de recursos do [electron-builder](https://www.electron.build/v26/docs/win/). A publicação segue a [API oficial de Releases](https://docs.github.com/en/rest/releases/releases) e a [API de assets](https://docs.github.com/en/rest/releases/assets).
