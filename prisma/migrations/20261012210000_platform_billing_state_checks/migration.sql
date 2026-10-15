DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PlatformBillingNotificationOutbox_status_check'
  ) THEN
    ALTER TABLE "PlatformBillingNotificationOutbox"
      ADD CONSTRAINT "PlatformBillingNotificationOutbox_status_check"
        CHECK ("status" IN ('PENDING', 'PROCESSING', 'FAILED', 'DELIVERED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PlatformBillingAccount_checkoutClaimPhase_check'
  ) THEN
    ALTER TABLE "PlatformBillingAccount"
      ADD CONSTRAINT "PlatformBillingAccount_checkoutClaimPhase_check"
        CHECK ("checkoutClaimPhase" IS NULL OR "checkoutClaimPhase" IN ('CLAIMED', 'REQUESTING'));
  END IF;
END $$;
