# Alusa

ERP educacional multi-tenant para escolas e instituições de ensino. A `Conta` é o tenant raiz; toda mudança deve preservar isolamento, integridade acadêmica e financeira e rastreabilidade.

## Mapa rápido

- `apps/web`: aplicação Next.js principal, portal, BFF e route handlers.
- `apps/admin`: operações administrativas e suporte.
- `apps/mobile`: cliente mobile que consome a API do web.
- `packages/domain`: regras acadêmicas puras.
- `packages/finance`: casos de uso financeiros, webhooks e reconciliação.
- `packages/asaas` e `packages/asaas-gateway`: cliente e contratos técnicos do Asaas.
- `packages/database`: Prisma, repositories e acesso persistente.
- `packages/shared`: tipos e utilitários sem infraestrutura.
- `packages/lib`: serviços compartilhados legados; novos módulos devem declarar ownership antes de crescer esta área.
- `prisma`: schema e migrations.
- `docs`: ADRs, runbooks, planos e decisões de arquitetura.

O fluxo principal é: aluno/responsável → matrícula → contrato → cobrança/assinatura → pagamento → webhook/reconciliação → portal.

## Comandos essenciais

```bash
pnpm install
pnpm workspace:check
pnpm prisma:generate
pnpm lint:check
pnpm typecheck
pnpm security:check
pnpm audit:dtos
pnpm audit:route-boundaries
pnpm audit:route-sizes
pnpm audit:route-inventory
pnpm audit:package-graph
pnpm test:unit
pnpm test
```

`pnpm test` executa todas as suítes registradas em ordem serializada, porque
Web, Finance e alguns testes de integração compartilham o banco `alusa_test`.

Para testes que acessam banco, copie `.env.test.example` para `.env.test` e valide a conexão antes de executar a suíte. A chave de criptografia do exemplo é exclusiva para o banco de teste local. Nunca coloque chaves Asaas, Stripe, tokens ou credenciais em código, logs ou variáveis `NEXT_PUBLIC_*`.

O E2E production-like usa `E2E_SERVER_MODE=production`, `next start`, um banco
de teste com o papel `alusa_app` sem `SUPERUSER`/`BYPASSRLS` e um Redis REST
explicitamente fornecido. Para o ambiente local descartável, prepare o papel
com `pnpm exec dotenv -e .env.test -- pnpm e2e:prepare-rls` e habilite
`E2E_REDIS_EMULATOR=true`; staging deve usar URLs e credenciais reais, nunca o
emulador.

## Regras de arquitetura

Route handlers devem ficar finos: autenticação, contexto de tenant, validação Zod, chamada de caso de uso e resposta HTTP. Regras acadêmicas ficam em `packages/domain`; regras financeiras em `packages/finance`; persistência em `packages/database`. O Asaas é uma integração de servidor e não deve ser acessado pelo client.

Toda entidade tenant-scoped deve ser protegida por `contaId` end-to-end. Webhooks são a fonte principal de transições financeiras; ações críticas precisam de idempotência, auditoria, `correlationId` e reconciliação.

O plano de modernização e o mapa de execução estão em [docs/plans/workspace-organization-and-modernization-plan.md](docs/plans/workspace-organization-and-modernization-plan.md).
