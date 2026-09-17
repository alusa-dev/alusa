# @alusa/lib

Camada compartilhada de compatibilidade durante a convergência do monorepo.

Novos módulos devem declarar ownership e preferir o pacote de destino:

- domínio acadêmico puro: `@alusa/domain`;
- financeiro, webhooks e reconciliação: `@alusa/finance`;
- persistência e Prisma: `@alusa/database`;
- tipos/utilitários sem infraestrutura: `@alusa/shared`.

Os utilitários puros de documento e calendário já foram convergidos para
`@alusa/shared/validators/cpf-cnpj` e `@alusa/shared/date-only`. Os subpaths
equivalentes deste pacote são somente bridges de compatibilidade e não devem
receber novas regras.

Dentro de `@alusa/lib`, use subpaths explícitos. O barrel raiz permanece apenas
para compatibilidade e não deve ser importado pelo runtime de `apps/web`.
Mudanças em exports legados exigem inventário de consumidores, teste e janela
de migração.
