# Validação da versão 0.1.2

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
