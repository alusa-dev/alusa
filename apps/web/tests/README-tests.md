## Testes Alusa (Web)

### Reset de Banco Rápido vs migrate reset

Para acelerar testes usamos um helper `resetDb(prisma)` (em `e2e/utils/reset-db.ts`) que:

1. Valida `NODE_ENV === 'test'`.
2. Lista todas as tabelas do schema `public` exceto `_prisma_migrations`.
3. Executa `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` com constraints temporariamente relaxadas (`session_replication_role=replica`).

Isso evita o custo de `prisma migrate reset` a cada cenário e mantém o schema intacto.

### Quando usar cada um

| Situação | Comando indicado |
|----------|------------------|
| Alterou schema (nova migration) e quer aplicar no ambiente de teste | `pnpm -w prisma migrate dev` |
| Rodando bateria de testes local/CI após schema já aplicado | `NODE_ENV=test pnpm -w test:unit` / `NODE_ENV=test pnpm -w test:e2e` |
| Precisa recriar seeds iniciais globais | `pnpm -w tsx prisma/seed.ts` |

### Scripts

Exemplos:
```
NODE_ENV=test pnpm -w test:unit
NODE_ENV=test pnpm -w test:e2e --project=chromium -g "First Register"
```

### Observações

- Nunca use `resetDb` fora de `NODE_ENV=test` (proteção já lança erro).
- Se adicionar novas tabelas, nenhuma alteração necessária: o helper coleta dinamicamente.
- Para cenários que dependem de dados seed, rode o seed após migrations e antes dos testes — o truncate não remove `_prisma_migrations`.
