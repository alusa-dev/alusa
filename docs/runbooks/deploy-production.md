# Runbook de deploy de produção

Este runbook define o fluxo seguro para publicar a Alusa em produção. A
produção é multi-tenant e possui integrações financeiras; um deploy verde não
substitui validação de banco, webhooks ou reconciliação.

## Regras obrigatórias

- Não fazer push direto na `main` sem os checks do CI.
- Não executar migrations destrutivas junto com uma publicação comum.
- Não usar banco de produção em testes, build local ou seed.
- Não colocar tokens da Vercel, Asaas ou banco em commits, logs ou client.
- Em alterações financeiras, validar comportamento local e produção somente com
  consultas ou scripts explicitamente seguros e idempotentes.

## Fluxo recomendado

### 1. Validar localmente

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm -w lint
pnpm -w typecheck
pnpm -w test:unit
pnpm -w build
pnpm -w test:e2e
git diff --check
```

Para alterações em `apps/web`, também executar o build no mesmo formato do
projeto Vercel:

```bash
NODE_OPTIONS=--max-old-space-size=3072 pnpm --dir apps/web build:webpack
```

O Next usa `apps/web/tsconfig.build.json` durante o build para não incluir os
testes no typecheck da aplicação. O typecheck completo continua sendo uma
etapa separada de qualidade e não deve ser removido para “fazer o deploy
passar”.

### 2. PR e CI

O CI deve estar verde antes da promoção. Falhas conhecidas de seed, Prisma,
testes financeiros ou E2E devem ser corrigidas, não mascaradas com `skip`,
`only`, `any` ou relaxamento de TypeScript.

Na proteção do GitHub, exigir checks de lint, typecheck, testes unitários,
build e E2E, aprovação de revisão e proibição de push direto em `main`.

### 3. Validar e publicar o artefato Vercel

Quando houver pipeline dedicado, separar build de publicação:

```bash
vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
vercel build --prod --token="$VERCEL_TOKEN"
vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
```

O CLI deve ser fixado em uma versão conhecida no CI. `VERCEL_TOKEN`,
`VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` devem existir apenas como secrets do CI.

Quando um preview já foi validado, preferir promover o mesmo artefato:

```bash
vercel promote <deployment-url-ou-id> --token="$VERCEL_TOKEN"
```

Isso evita recompilar entre o teste e a produção.

### 4. Migrations e backfills

1. Aplicar e testar a migration no banco efêmero do CI.
2. Confirmar `prisma migrate status`.
3. Aplicar migration compatível com a versão atual da aplicação.
4. Executar backfill com escopo explícito, dry-run por padrão, lock e
   idempotência.
5. Validar contagens, totais financeiros, `contaId` e auditoria.
6. Somente depois promover a aplicação.

Nunca apagar registros financeiros históricos para corrigir um total. Uma
divergência ambígua deve virar fila de reconciliação.

### 5. Pós-deploy

Confirmar no painel Vercel que a implantação está `Ready`, com o commit
esperado e os aliases corretos. Depois executar smoke checks somente de
leitura: login/autorização por conta, rota protegida financeira, métricas do
evento sem cache antigo e logs sem erro novo de runtime.

Em caso de regressão, interromper novas publicações e fazer rollback para a
última implantação `Ready`. Não corrigir dados de produção manualmente sem
identificar a causa e registrar a operação.

## Diagnóstico de falhas

- `Queued`: aguardar capacidade da Vercel; não criar deploys duplicados.
- `Out of memory`: verificar escopo do TypeScript, workers, cache e se
  `NODE_OPTIONS` foi aplicado ao processo que executa o Next.
- Parou em `Running TypeScript`: conferir `tsconfig.build.json`, quantidade de
  arquivos e reproduzir com `next build --webpack`.
- Build local passa e Vercel falha: comparar Node, pnpm, variáveis, comando,
  região e cache; usar `vercel build --prod`.
- Deploy `Ready`, mas tela mostra valor antigo: validar cache HTTP, cache do
  React Query, commit/alias ativo e resposta autenticada da API.

## Evidências para fechar um deploy

Registrar no PR ou na operação o commit e ID da implantação, checks do CI,
status `Ready`, migrations/backfills executados, smoke checks, riscos
remanescentes e rollback conhecido.
