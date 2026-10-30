ALTER TABLE public."PlatformBillingMonthlySnapshot"
  ADD COLUMN "customQuantitySyncStatus" TEXT,
  ADD COLUMN "customQuantitySyncRequestedQuantity" INTEGER,
  ADD COLUMN "customQuantitySyncOperationKey" TEXT,
  ADD COLUMN "customQuantitySyncStripeSubscriptionId" TEXT,
  ADD COLUMN "customQuantitySyncStripeSubscriptionItemId" TEXT,
  ADD COLUMN "customQuantitySyncPriceId" TEXT,
  ADD COLUMN "customQuantitySyncAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "customQuantitySyncLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "customQuantitySyncLastErrorCode" TEXT,
  ADD COLUMN "customQuantitySyncAppliedAt" TIMESTAMP(3),
  ADD CONSTRAINT "PlatformBillingMonthlySnapshot_custom_quantity_sync_check" CHECK (
    ("customQuantitySyncStatus" IS NULL AND "customQuantitySyncRequestedQuantity" IS NULL AND "customQuantitySyncOperationKey" IS NULL)
    OR
    ("customQuantitySyncStatus" IN ('PENDING', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'BLOCKED', 'SUPERSEDED')
      AND "customQuantitySyncRequestedQuantity" > 0
      AND "customQuantitySyncOperationKey" IS NOT NULL
      AND "customQuantitySyncStripeSubscriptionId" IS NOT NULL
      AND "customQuantitySyncStripeSubscriptionItemId" IS NOT NULL
      AND "customQuantitySyncPriceId" IS NOT NULL
      AND "customQuantitySyncAttemptCount" >= 0)
  );

CREATE UNIQUE INDEX "PlatformBillingMonthlySnapshot_customQuantitySyncOperationKey_key"
  ON public."PlatformBillingMonthlySnapshot"("customQuantitySyncOperationKey");
CREATE INDEX "idx_platform_billing_monthly_snapshot_quantity_sync"
  ON public."PlatformBillingMonthlySnapshot"("contaId", "environment", "customQuantitySyncStatus", "periodStart");
