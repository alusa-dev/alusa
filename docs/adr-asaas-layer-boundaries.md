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

### Vendas públicas de ingressos

- `@alusa/finance` é dono do checkout com provedor, persistência do vínculo de pagamento, confirmação financeira, reconciliação, cancelamento/estorno e lançamentos financeiros das vendas públicas.
- A confirmação de pagamento e a emissão de ingressos permanecem no mesmo caso de uso/transação financeira. Isso serializa pedido, reserva e assentos e evita confirmar o pagamento sem concluir ou registrar a emissão.
- `@alusa/finance` pode compor operações públicas e estreitas de persistência e fulfillment de `@alusa/lib`. `@alusa/lib` não importa `@alusa/finance` e não chama o provedor.
- Regras puras de status e erros de domínio compartilhados vivem em `@alusa/domain/events`; DTOs e utilitários sem I/O ficam em módulos específicos, com exports explícitos.
- `events.service` não é o ponto de entrada para transições de pagamento ou estorno. Consumidores financeiros usam casos de uso de `@alusa/finance`.

### Consumidores de aplicação

`apps/web` e `packages/lib` **não** importam `@alusa/asaas` ou `@alusa/asaas-gateway` diretamente para fluxos de produto. Consomem `@alusa/finance`.

Os serviços de aplicação em `apps/web/src/server` podem compor casos de uso de
`finance`, carregar dados para a requisição e converter resultados para
respostas HTTP. Eles não escrevem diretamente obrigações, pagamentos, grupos de
cobrança ou estados financeiros; criação, rollback e transições persistidas
permanecem em `finance`.

Nos serviços de alunos, `@alusa/lib` declara uma porta financeira sem nomes de provedor e não importa `@alusa/finance` nem mesmo dinamicamente. A camada de aplicação (`apps/web`) compõe essa porta com os casos de uso financeiros e a injeta nas operações de persistência do aluno. Assim, o pacote de persistência continua utilizável sem inicializar integração externa, e a direção de dependência permanece `apps/web → finance` e `apps/web → lib`.

Exceções temporárias (admin/debug) devem estar documentadas na allowlist do ESLint e migradas para `packages/finance/src/admin` ou `packages/finance/src/dev`.

## Fluxo alvo

```txt
apps/web
   ↓
@alusa/finance ───────────────→ @alusa/lib
(casos financeiros, tenant,     (domínio e primitivas
 webhooks, persistência)         operacionais de eventos)
   ├───────────────→ @alusa/asaas-gateway (contratos)
   └───────────────→ @alusa/asaas         (HTTP puro)

@alusa/domain (regras puras e erros compartilhados)
```

`@alusa/lib` continua sendo usado diretamente por telas e rotas de eventos para operações de mapa, leitura e manutenção do domínio. Fluxos que alteram estado financeiro de uma venda entram por `@alusa/finance`. Serviços de aplicação podem coordenar essas chamadas, sem assumir a persistência financeira. O sentido de dependência entre os packages é unidirecional: `finance` pode compor operações de domínio de `lib`; `lib` não depende de `finance`.

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
