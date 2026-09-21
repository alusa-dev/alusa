-- Additive marker used to avoid rescanning already reconciled inbox records.
ALTER TABLE "WebhookAsaas"
  ADD COLUMN "sideEffectsReconciledAt" TIMESTAMP(3);

CREATE INDEX "idx_webhookasaas_side_effect_reconciliation"
  ON "WebhookAsaas"("status", "sideEffectsReconciledAt", "recebidoEm");
