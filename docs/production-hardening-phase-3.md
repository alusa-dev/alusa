# Hardening de produção — Fase 3: idempotência completa

Status: implementada e validada em 13/08/2026.

## Objetivo

Garantir que reentregas, retries e concorrência não criem efeitos financeiros ou notificações duplicadas, sem alterar a regra funcional dos fluxos já testados manualmente.

## Entregas

### 1. Idempotência de recepção

A recepção existente permanece protegida por `WebhookAsaas` com chaves compostas por `contaId` e `eventId` (ou hash do payload quando o evento não possui ID). O endpoint continua rápido: persiste o evento e o processamento pesado ocorre na fila/worker.

### 2. Idempotência semântica

- Notificações de pagamento usam chave canônica por `contaId + pagamento + efeito`.
- `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED` e `PAYMENT_RECEIVED_IN_CASH` convergem para o mesmo efeito de confirmação.
- O outbox de efeitos usa `FinanceWebhookSideEffectOutbox` com `@@unique([contaId, dedupeKey])`.
- A resolução de `Cobranca` e `Charge` para criar notificações agora sempre considera o tenant.
- A fila de notificações pendentes carrega `contaId` e inclui o tenant na chave de deduplicação.

Isso evita que eventos tecnicamente diferentes, mas semanticamente equivalentes, gerem duas notificações.

### 3. Idempotência de comandos externos

`registerPaymentCommand` agora:

- consulta primeiro a chave composta `contaId + tipo + correlationId`;
- reaproveita o comando existente sem resetar `PROCESSING`, `DONE` ou outro estado atual;
- rejeita reutilização da mesma chave com entidade, pagamento, tipo ou eventos esperados diferentes;
- preserva o estado do vencedor quando duas requisições chegam simultaneamente por meio do `upsert` com `update: {}`.

Assim, retry de cancelamento, estorno, recebimento em dinheiro ou atualização não cria uma nova intenção nem reabre uma intenção já enviada ao Asaas.

### 4. Idempotência dos efeitos no ledger

`Lancamento` recebeu `idempotencyKey` nullable e a constraint:

```text
unique (contaId, idempotencyKey)
```

Os efeitos de pagamento passaram a usar chaves determinísticas:

- `asaas:payment:<id>:settlement`
- `asaas:payment:<id>:partial-refund`
- `asaas:payment:<id>:refund`
- `asaas:payment:<id>:cash-undo`

O código mantém fallback para lançamentos históricos baseados em `externalRef`. Em uma corrida, a constraint do banco é o árbitro final; um `P2002` é resolvido buscando o lançamento vencedor, tornando a segunda execução idempotente.

### 5. Isolamento multi-tenant

As consultas de `Cobranca`, `Charge`, `Pagamento`, `Lancamento` e enriquecimento de notificações relacionadas ao pagamento foram revisadas para incluir `contaId`. As novas constraints de provider ID são compostas por tenant:

- `uq_cobranca_conta_asaas_payment`
- `uq_pagamento_conta_asaas_payment`
- `uq_charge_conta_asaas_payment`

As constraints globais antigas de compatibilidade não foram removidas nesta fase, evitando migration destrutiva e regressão de dados existentes.

## Migration

Arquivo: `prisma/migrations/20260813200000_phase_3_idempotency_effects/migration.sql`

A migration foi aplicada ao banco de teste e o Prisma confirmou que não há migrations pendentes.

## Validação executada

- `pnpm prisma validate`
- `pnpm prisma generate`
- `pnpm --filter @alusa/web db:migrate:test`
- `pnpm --filter @alusa/lib typecheck`
- `pnpm --filter @alusa/finance typecheck`
- testes financeiros de comandos, webhook, outbox e projeção: **31 testes passando**
- testes da API de webhook e outbox de rematrícula: **12 testes passando**
- testes de notificações: **13 testes passando**
- `git diff --check`

## Critério de aceite

Para o mesmo pagamento, 100 reentregas do mesmo evento ou de eventos equivalentes convergem para uma única intenção/efeito persistido por tenant. Reentregas continuam podendo atualizar snapshot, auditoria e observabilidade, mas não duplicam baixa, estorno, reversão de dinheiro ou notificação operacional.

## Referências oficiais utilizadas

- [Asaas — idempotência em webhooks](https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks)
- [Asaas — recebimento de eventos no endpoint](https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook)
- [Prisma — índices e constraints](https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes)
- [Prisma — transações e isolamento](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)

## Risco residual antes da produção

Executar um teste de carga controlado com múltiplos workers e 100 reentregas por pagamento no ambiente de staging, conferindo no banco a cardinalidade de `Lancamento`, `Notification` e `FinanceWebhookSideEffectOutbox`. Essa validação operacional deve preceder a Fase 4, mas não altera os fluxos funcionais implementados.
