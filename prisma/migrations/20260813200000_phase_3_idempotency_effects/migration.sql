-- Phase 3: semantic idempotency for internal financial ledger effects.
-- Nullable keeps all historical/manual entries compatible; only effects that
-- opt into an idempotency key participate in the unique constraint.

ALTER TABLE "Lancamento"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "uq_lancamento_conta_idempotency"
  ON "Lancamento"("contaId", "idempotencyKey");
