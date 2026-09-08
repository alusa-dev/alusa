-- Idempotency keys belong to a tenant-scoped operation. The previous global
-- unique index unnecessarily coupled unrelated accounts and made recovery
-- queries unable to remain tenant-scoped.
DROP INDEX IF EXISTS "PayerChangeOperacao_idempotencyKey_key";

CREATE UNIQUE INDEX "uq_payer_change_operacao_conta_idempotency"
  ON "PayerChangeOperacao"("contaId", "idempotencyKey");
