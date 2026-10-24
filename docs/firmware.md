# Análise do firmware RX27 Pro

## Observações verificadas

- Arquivo: `US_RX27_PROV1.0br_V16.03.28.20_multi_9569_TDE01.bin`.
- Tamanho: 26446708 bytes.
- SHA-256: `0121bd96ee3f590f9f4a21a2b60220028f7f94f460f6579382dd15e22737dd62`.
- Primeiro inteiro big-endian de 32 bits: 26446704; corresponde exatamente aos bytes restantes.
- O conteúdo após esse prefixo é múltiplo de 16 bytes.
- Entropia global: 7.99999256 bits por byte.
- A busca limitada às assinaturas uImage, SquashFS, gzip, XZ, UBI, ELF e ZIP não encontrou essas assinaturas.

## Inferências e limites

O alinhamento e a entropia são compatíveis com conteúdo criptografado ou empacotamento proprietário. Eles não identificam algoritmo, chave, assinatura, arquitetura executável ou sistema de arquivos. Não houve descriptografia, extração de rootfs, execução, emulação, acesso físico, mudança de bootloader ou gravação no equipamento.

A configuração pública do painel anuncia Broadcom bcm96756 e RX27_PRO; isso é uma declaração do software, não uma inspeção física do chip. O painel autenticado exibiu V1.0 e V16.03.28.20_multi. A análise web permite desenvolver o aplicativo independentemente da extração do firmware.

## Aplicação no projeto

O arquivo original permanece intacto, ignorado pelo Git e excluído do executável. O envio local aceita apenas o SHA-256 acima e o cabeçalho verificado, para o RX27 Pro principal. Outras versões precisam de verificação e inclusão explícita no código, ou da atualização online oficial iniciada pelo roteador. O roteador ainda precisa validar formato, integridade e compatibilidade; a verificação de hash local não equivale a uma assinatura de fabricante.

Reproduza o levantamento com `npm run research`. Dados estruturados: [firmware.json](firmware.json).
