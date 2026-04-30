# Integração Asaas — Cobranças (Charges)

## Sumário

1. [Implementação na Alusa](#implementação-na-alusa)
2. [Estrutura e módulos](#estrutura-e-módulos)
3. [Fluxos e invariantes](#fluxos-e-invariantes)
4. [Rotas principais](#rotas-principais)
5. [Webhooks](#webhooks)
6. [Status e liquidação](#status-e-liquidação)
7. [Notificações](#notificações)
8. [Anexos](#anexos)
9. [Boas práticas aplicadas](#boas-práticas-aplicadas)

---

## Implementação na Alusa

### O que está em produção no módulo de cobranças

- **Asaas é a fonte única da verdade** para status financeiro.
- **Estados locais** são atualizados **apenas via webhook** (com reconciliação controlada).
- **Linkagem determinística** por `externalReference` e IDs Asaas (`subscription`, `installment`).
- **Read-before-write** em mutações críticas.
- **Subcontas isoladas** por instituição (tenant).

### Estrutura e módulos

- **Gateway Asaas:** `packages/asaas-gateway`
- **Use-cases financeiros:** `packages/finance/src/use-cases`
- **Serviços de notificação:** `packages/finance/src/services/customer-notification.service.ts`
- **Rotas API (Next):** `apps/web/app/api/**`
- **Banco/Prisma:** `prisma/schema.prisma` + migrations

### Fluxos e invariantes

- Matrícula → Plano → Cobrança → Pagamento
- `externalReference` sempre definido (assinatura, parcelamento, avulsa).
- `RECEIVED_IN_CASH` nunca compõe saldo Asaas.
- Evento duplicado ou fora de ordem não regride status.

---

## Rotas principais

- **Cobrança (detalhes):** `apps/web/app/api/cobrancas/[id]/route.ts`
- **Cobrança (arquivos):** `apps/web/app/api/cobrancas/[id]/arquivos/route.ts`
- **Assinaturas:** `apps/web/app/api/financeiro/assinaturas` e `.../[id]`
- **Parcelamentos:** `apps/web/app/api/financeiro/parcelamentos` e `.../[id]`
- **Marcar pago:** `apps/web/app/api/financeiro/cobrancas/[id]/marcar-pago/route.ts`
- **Receber em dinheiro:** `apps/web/app/api/financeiro/cobrancas/[id]/receber-dinheiro/route.ts`
- **Refund canônico:** `apps/web/app/api/cobrancas/[id]/refund/route.ts`
- **Saldo/Extrato:** `packages/finance/src/use-cases/get-balance.ts`, `list-financial-transactions.ts`
- **Dashboard Financeiro:** `apps/web/app/api/financeiro/dashboard/route.ts`

---

## Webhooks

- Endpoint: `apps/web/app/api/webhooks/asaas/route.ts`
- Token: header `asaas-access-token`
- Persistência de payload bruto + `eventId` + hash
- Idempotência e tolerância a reordenação

---

## Status e liquidação

- **Status final:** somente via webhook.
- **Liquidação:**
  - `creditDate <= hoje` ⇒ `DISPONIVEL`
  - `creditDate > hoje` ⇒ `PENDENTE`
  - `RECEIVED_IN_CASH` ⇒ caixa (fora do saldo Asaas)

---

## Notificações

- **Fonte única:** Asaas (WhatsApp/E-mail/SMS).
- **Preferências por tenant** persistidas em `AsaasNotificationPreference`.
- **Sincronização** com customers via update/batch.
- **Cobrança criada por assinatura:** sem notificação padrão.
- Endpoint: `apps/web/app/api/configuracoes/notificacoes/asaas/route.ts`

---

## Anexos

- **Cobranca**: `ArquivoCobranca`
- **Charge standalone**: `ArquivoCharge`
- Rota única: `/api/cobrancas/[id]/arquivos`

---

## Boas práticas aplicadas

- Read-before-write em mutações (update/delete/refund/receive in cash)
- Idempotência por `externalReference`
- Logs de auditoria para ações críticas
- RBAC e tenant-check em toda mutação financeira
