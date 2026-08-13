-- Phase 4: máquina de estados financeira.
-- Campos novos são compatíveis com registros existentes via defaults/nullability.

ALTER TABLE "Cobranca"
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reconciliationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "providerUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "lastWebhookAt" TIMESTAMP(3),
  ADD COLUMN "lastProviderCheckAt" TIMESTAMP(3),
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3),
  ADD COLUMN "lastAppliedEventId" TEXT,
  ADD COLUMN "localStateUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Charge"
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reconciliationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "providerUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "lastWebhookAt" TIMESTAMP(3),
  ADD COLUMN "lastProviderCheckAt" TIMESTAMP(3),
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3),
  ADD COLUMN "lastAppliedEventId" TEXT,
  ADD COLUMN "localStateUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "FinancePaymentStateTransition" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "eventName" TEXT,
  "providerStatusBefore" TEXT,
  "providerStatusAfter" TEXT,
  "localStatusBefore" TEXT NOT NULL,
  "localStatusAfter" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "providerOccurredAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "localVersion" INTEGER,
  "correlationId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePaymentStateTransition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_finance_payment_state_transition_dedupe"
  ON "FinancePaymentStateTransition"("contaId", "dedupeKey");
CREATE INDEX "idx_finance_payment_state_transition_entity"
  ON "FinancePaymentStateTransition"("contaId", "entityType", "entityId", "createdAt");
CREATE INDEX "idx_finance_payment_state_transition_decision"
  ON "FinancePaymentStateTransition"("contaId", "decision", "createdAt");
CREATE INDEX "idx_finance_payment_state_transition_source"
  ON "FinancePaymentStateTransition"("contaId", "sourceType", "createdAt");

ALTER TABLE "FinancePaymentStateTransition"
  ADD CONSTRAINT "FinancePaymentStateTransition_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
