# ADR: Fronteiras de camada Asaas

**Status:** Accepted  
**Data:** 2026-05-25

## Contexto

A Alusa integra financeiro white label via Asaas. O monorepo possui três pacotes relacionados:

- `@alusa/asaas` — cliente HTTP
- `@alusa/asaas-gateway` — contratos técnicos Alusa↔Asaas
- `@alusa/finance` — orquestração financeira

Sem fronteiras explícitas, regras de negócio, persistência e chamadas HTTP duplicadas migraram para camadas erradas, aumentando risco de inconsistência financeira e regressão em webhooks.

## Decisão

### `@alusa/asaas`

**Responsabilidade:** HTTP puro + tipos espelho da API Asaas.

**Pode:**
- axios/fetch, Zod de payload externo
- rate limit, circuit breaker, concurrency, quota tracker
- tipos da API, serialização/deserialização

**Não pode:**
- Prisma, banco, `contaId`
- regra da Alusa, externalReference semântico da Alusa
- feature flags de produto
- mapeamento de status Asaas → status interno

### `@alusa/asaas-gateway`

**Responsabilidade:** contratos técnicos Alusa↔Asaas sem I/O de negócio.

**Pode:**
- DTOs de webhook
- parse/build de `externalReference` (formato v1 legado)
- verificação de webhook token via DI (`WebhookVerifier`)
- enums/tipos literais técnicos
- erros técnicos (`AsaasGatewayError`)

**Não pode:**
- Prisma, banco, use-cases, persistência
- chamadas HTTP duplicadas (SDK HTTP fica em `@alusa/asaas`)
- mapear status para cobrança interna
- decidir pago/vencido/ativo/inativo
- feature flags de rollout financeiro

### `@alusa/finance`

**Responsabilidade:** orquestração financeira da Alusa.

**Pode:**
- tenant, persistência, jobs, webhooks, inbox/outbox
- reconciliação, read models, feature flags
- mapeamento Asaas → domínio interno
- use-cases, auditoria, idempotência

**Deve ser** o único pacote, fora `@alusa/asaas`, autorizado a chamar HTTP Asaas para fluxos reais de produto.

### Consumidores de aplicação

`apps/web` e `packages/lib` **não** importam `@alusa/asaas` ou `@alusa/asaas-gateway` diretamente para fluxos de produto. Consomem `@alusa/finance`.

Exceções temporárias (admin/debug) devem estar documentadas na allowlist do ESLint e migradas para `packages/finance/src/admin` ou `packages/finance/src/dev`.

## Fluxo alvo

```txt
apps/web / packages/lib
        ↓
@alusa/finance  (orquestração, tenant, persistência)
        ↓                    ↓
@alusa/asaas-gateway    @alusa/asaas
(contratos)             (HTTP puro)
```

## Consequências

- Menos duplicação de endpoints e tipos
- Webhooks e reconciliação centralizados em finance
- ESLint + teste de arquitetura impedem regressão
- Migração incremental com wrappers `@deprecated` quando necessário

## Referências

- `packages/asaas/README.md`
- `packages/asaas-gateway/README.md`
- `.agents/asaas.md`
- `AGENTS.md`
