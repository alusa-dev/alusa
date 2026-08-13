-- Phase 2: tenant-scoped provider identities and durable worker leases.
-- This migration is additive/reversible at the application level. Existing
-- global provider uniques remain for backwards compatibility with legacy data.

DROP INDEX IF EXISTS "idx_cobranca_conta_asaas_payment";
CREATE UNIQUE INDEX "uq_cobranca_conta_asaas_payment"
  ON "Cobranca"("contaId", "asaasPaymentId");

DROP INDEX IF EXISTS "idx_pagamento_conta_asaas_payment";
CREATE UNIQUE INDEX "uq_pagamento_conta_asaas_payment"
  ON "Pagamento"("contaId", "asaasPaymentId");

DROP INDEX IF EXISTS "idx_charge_conta_asaas_payment";
CREATE UNIQUE INDEX "uq_charge_conta_asaas_payment"
  ON "Charge"("contaId", "asaasPaymentId");

ALTER TABLE "RematriculaOutbox"
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lockToken" TEXT;

ALTER TABLE "FinanceWebhookSideEffectOutbox"
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "lockToken" TEXT;
