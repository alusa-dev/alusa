# Alusa Admin — Fases 2, 3 e 4

## Fase 2 — fronteiras compartilhadas

- `@alusa/database` é o cliente Prisma canônico usado pelos adapters antigos e
  pelo novo app.
- `@alusa/lib/security/rate-limit` concentra o rate limit distribuído e mantém
  o fallback local apenas para desenvolvimento/compatibilidade.
- `@alusa/admin-auth` contém somente contratos, papéis, permissões, identidade,
  sessões persistentes e elevações; não contém telas nem regras financeiras.
- O código de negócio financeiro continua em `@alusa/finance`.

## Fase 3 — app administrativo

Foi criado `apps/admin` como aplicação Next.js independente, sem imports de
`apps/web`. O app possui:

- login próprio em `/login`;
- `proxy` para redirecionamento de navegação sem sessão;
- validação server-side no layout protegido;
- shell administrativo responsivo;
- dashboard e listagem real de contas;
- rotas estruturais para financeiro, webhooks, casos, auditoria e configurações.

O `/developer` continua preservado. As áreas restantes entram por fatias
verticais no app novo; não há alias nem rewrite que esconda uma dependência
entre os dois apps.

## Fase 4 — identidade e sessão

A migration `20260902120000_add_admin_identity_sessions` é aditiva e cria:

- `AdminUser`, identidade global canônica;
- `AdminSession`, token aleatório persistido somente como hash, com revogação,
  expiração, IP e user-agent;
- `TemporaryElevation`, permissões explícitas, motivo e expiração obrigatória.

O script `pnpm admin:backfill-users` migra `SupportUser` de forma idempotente.
Usuários `BREAK_GLASS` são convertidos em elevação temporária com prazo; não
viram um papel permanente. Durante o cutover, o `/developer` faz dual-read da
sessão persistente nova e do JWT legado, nesta ordem.

### Operação de rollout

1. Aplicar migrations.
2. Executar o backfill em staging e conferir cardinalidade.
3. Executar o backfill em produção com aprovação operacional.
4. Configurar `GLOBAL_ADMIN_SESSION_SECRET` somente enquanto o legado existir.
5. Ativar o domínio do `apps/admin` e validar login, revogação e expiração.
6. Remover JWT, aliases e rotas legadas apenas na Fase 5.
