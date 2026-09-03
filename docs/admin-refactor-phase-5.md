# Refatoração do Admin — Fase 5: cutover

## Objetivo

Concluir a migração do backoffice para `apps/admin`, mantendo os casos de uso existentes e removendo o runtime administrativo legado de `apps/web`.

## Entregas

- Todas as telas operacionais migradas para `apps/admin`: busca, contas, detalhes 360º, alunos, responsáveis, usuários, matrículas, financeiro, cobranças, webhooks, auditoria e configurações.
- Todas as APIs migradas de `/api/developer/**` para `/api/admin/**`, incluindo ações Asaas, reconciliação, replay de webhook, notas, casos, convites e read models.
- Autenticação exclusivamente por `AdminUser` + `AdminSession`, com cookie httpOnly, TTL, revogação, rate limit e auditoria.
- Configurações administrativas passam a criar e alterar `AdminUser`; não criam novas identidades no modelo legado `SupportUser`.
- `apps/web` deixou de expor páginas, APIs e sessão JWT de developer/global-admin.
- O proxy do Admin responde APIs sem sessão para que os route handlers retornem `401` JSON, e protege páginas por sessão persistida.
- O build do Admin usa Webpack, compatível com os imports `.js` dos packages financeiros já compilados.

## Compatibilidade e banco

O modelo `SupportUser` permanece no schema e no banco como registro histórico de migração e rollback. Ele não é mais consultado pelo runtime do Admin. A remoção física da tabela deve ser uma operação posterior, após confirmação do cutover em produção e retenção dos requisitos de auditoria.

O campo `AdminUser.legacySupportUserId` mantém a rastreabilidade entre a identidade migrada e a origem histórica. O script `admin:backfill-users` continua disponível para ambientes ainda não migrados; o provisionamento normal usa `admin:upsert-user` (o alias anterior `support:upsert-admin` permanece compatível).

## Rotas oficiais

- Admin: `/login`, `/`, `/contas`, `/financeiro`, `/webhooks`, `/auditoria` e `/configuracoes`.
- APIs administrativas: `/api/auth/**` e `/api/admin/**`.
- Aplicação web: não possui mais rota `/developer` nem `/api/developer`.

## Verificação

Executar no monorepo:

```bash
pnpm --filter @alusa/admin typecheck
pnpm --filter @alusa/admin lint
pnpm --filter @alusa/admin build
pnpm --filter @alusa/web typecheck
pnpm --filter @alusa/web build
pnpm security:check
```

O `security:check` também valida que o registry do `apps/web` e o proxy do Admin continuam cobrindo as rotas críticas. Falhas pré-existentes do detector de RLS devem ser tratadas separadamente, sem relaxar a proteção desta fase.
