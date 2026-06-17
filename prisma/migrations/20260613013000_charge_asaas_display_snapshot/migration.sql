-- Store the official Asaas payment snapshot for standalone/materialized charges.
-- Business status remains in "status"; these fields are read-model/UI support.
ALTER TABLE "Charge"
  ADD COLUMN "asaasStatus" TEXT,
  ADD COLUMN "asaasValue" DECIMAL(12, 2),
  ADD COLUMN "asaasNetValue" DECIMAL(12, 2),
  ADD COLUMN "asaasOriginalValue" DECIMAL(12, 2),
  ADD COLUMN "asaasFeeValue" DECIMAL(12, 2),
  ADD COLUMN "asaasCreditDate" TIMESTAMP(3),
  ADD COLUMN "asaasEstimatedCreditDate" TIMESTAMP(3),
  ADD COLUMN "lastAsaasFetchAt" TIMESTAMP(3),
  ADD COLUMN "liquidacaoStatus" "LiquidacaoStatus" NOT NULL DEFAULT 'NAO_APLICAVEL',
  ADD COLUMN "liquidadoEm" TIMESTAMP(3);

ALTER TABLE "ChargeReadModel"
  ADD COLUMN "asaasStatus" TEXT;

CREATE INDEX "idx_charge_conta_asaas_status" ON "Charge"("contaId", "asaasStatus");
CREATE INDEX "idx_charge_conta_liquidacao" ON "Charge"("contaId", "liquidacaoStatus");
CREATE INDEX "idx_charge_read_model_conta_asaas_status" ON "ChargeReadModel"("contaId", "asaasStatus");
