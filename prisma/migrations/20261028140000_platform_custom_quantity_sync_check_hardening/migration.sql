ALTER TABLE public."PlatformBillingMonthlySnapshot"
  DROP CONSTRAINT "PlatformBillingMonthlySnapshot_custom_quantity_sync_check";

ALTER TABLE public."PlatformBillingMonthlySnapshot"
  ADD CONSTRAINT "PlatformBillingMonthlySnapshot_custom_quantity_sync_check" CHECK (
    (
      "customQuantitySyncStatus" IS NULL
      AND "customQuantitySyncRequestedQuantity" IS NULL
      AND "customQuantitySyncOperationKey" IS NULL
      AND "customQuantitySyncStripeSubscriptionId" IS NULL
      AND "customQuantitySyncStripeSubscriptionItemId" IS NULL
      AND "customQuantitySyncPriceId" IS NULL
      AND "customQuantitySyncAttemptCount" = 0
      AND "customQuantitySyncLastAttemptAt" IS NULL
      AND "customQuantitySyncLastErrorCode" IS NULL
      AND "customQuantitySyncAppliedAt" IS NULL
    )
    OR
    (
      "customQuantitySyncStatus" IS NOT NULL
      AND "customQuantitySyncStatus" IN ('PENDING', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'BLOCKED', 'SUPERSEDED')
      AND "customQuantitySyncRequestedQuantity" IS NOT NULL
      AND "customQuantitySyncRequestedQuantity" > 0
      AND "customQuantitySyncOperationKey" IS NOT NULL
      AND "customQuantitySyncStripeSubscriptionId" IS NOT NULL
      AND "customQuantitySyncPriceId" IS NOT NULL
      AND "customQuantitySyncAttemptCount" >= 0
      AND (
        "customQuantitySyncStatus" <> 'SUCCEEDED'
        OR (
          "customQuantitySyncStripeSubscriptionItemId" IS NOT NULL
          AND "customQuantitySyncAppliedAt" IS NOT NULL
        )
      )
      AND (
        "customQuantitySyncStatus" = 'SUCCEEDED'
        OR "customQuantitySyncAppliedAt" IS NULL
      )
    )
  );
