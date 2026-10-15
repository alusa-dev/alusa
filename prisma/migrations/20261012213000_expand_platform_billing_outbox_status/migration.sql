ALTER TABLE "PlatformBillingNotificationOutbox"
  DROP CONSTRAINT "PlatformBillingNotificationOutbox_status_check";
ALTER TABLE "PlatformBillingNotificationOutbox"
  ADD CONSTRAINT "PlatformBillingNotificationOutbox_status_check"
  CHECK ("status" IN ('PENDING', 'PROCESSING', 'FAILED', 'DELIVERED', 'EXHAUSTED'));
