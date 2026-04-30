# E2E Tests — Módulo Financeiro (Cobranças)

## Como rodar

```bash
# Rodar todos os testes de cobranças
pnpm --filter @alusa/web test:e2e -- tests/e2e/financeiro/

# Rodar um spec específico
pnpm --filter @alusa/web test:e2e -- tests/e2e/financeiro/todas-operacional.spec.ts

# Com UI interativa
pnpm --filter @alusa/web test:e2e -- --ui tests/e2e/financeiro/
```

## Variáveis de ambiente

O Playwright é configurado em `playwright.config.ts` e carrega `.env.test` da raiz.

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL_TEST` | Sim | URL do banco de teste contendo `alusa_test` |
| `NEXTAUTH_SECRET` | Sim | Secret para gerar tokens de sessão |
| `ENCRYPTION_KEY` | Sim | Chave de criptografia |

Variáveis injetadas automaticamente pelo config:
- `PAYMENTS_PROVIDER_MODE=mock` (SDK Asaas mockado)
- `PLAYWRIGHT_TEST=true`
- `TEST_ROUTES_ENABLED=true`

## Estrutura

```
tests/e2e/financeiro/
├── helpers/
│   ├── auth.ts           # Seed de conta/admin + login via cookie JWT
│   ├── seed-finance.ts   # Dados determinísticos para todas as páginas
│   └── api.ts            # Helper para chamadas à API + assertions
├── todas-operacional.spec.ts  # Fila operacional /cobrancas
├── avulsas.spec.ts            # Standalone /cobrancas/avulsas
├── assinaturas.spec.ts        # /cobrancas/assinaturas + detalhe
├── parcelamentos.spec.ts      # /cobrancas/parcelamentos + detalhe
├── regressao-sai-de-todas.spec.ts  # Regressão: status muda → sai da fila
└── README.md
```

## Como o seed funciona

Cada `test.beforeEach` cria uma conta isolada com dados determinísticos:
- Cobranças do mês atual (OPEN/PENDENTE)
- Cobranças vencidas (mês anterior, OVERDUE/ATRASADO)
- Cobranças futuras (mês seguinte — não devem aparecer em "Todas")
- Parcelamento com parcelas atuais e futuras
- Assinatura acadêmica com mensalidades atuais e futuras

O banco **não é resetado** entre os testes — cada teste opera em sua própria conta isolada.

## Mock do Asaas

O SDK `@alusa/asaas` é automaticamente mockado via `PAYMENTS_PROVIDER_MODE=mock`.  
Nenhuma chamada real ao Asaas é feita. Mutações de status são simuladas via Prisma direto.

## CI

```yaml
- name: E2E Finance Tests
  run: pnpm --filter @alusa/web test:e2e -- tests/e2e/financeiro/
  env:
    DATABASE_URL_TEST: ${{ secrets.DATABASE_URL_TEST }}
    NEXTAUTH_SECRET: ${{ secrets.NEXTAUTH_SECRET }}
    ENCRYPTION_KEY: ${{ secrets.ENCRYPTION_KEY }}
```
