ALTER TABLE "FinanceWebhookSideEffectOutbox"
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "deliveryStatus" TEXT,
  ADD COLUMN "deliveryStatusAt" TIMESTAMP(3);

CREATE INDEX "idx_finance_side_effect_delivery_status"
  ON "FinanceWebhookSideEffectOutbox"("deliveryStatus", "deliveryStatusAt");
