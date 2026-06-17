-- Extend reconciliation issue taxonomy and read-model liquidation projection.
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE 'ASAAS_SNAPSHOT_STALE';

ALTER TABLE "ChargeReadModel"
  ADD COLUMN IF NOT EXISTS "liquidacaoStatus" "LiquidacaoStatus" NOT NULL DEFAULT 'NAO_APLICAVEL';

CREATE INDEX IF NOT EXISTS "idx_charge_read_model_conta_liquidacao"
  ON "ChargeReadModel"("contaId", "liquidacaoStatus");
