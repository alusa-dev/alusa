ALTER TABLE "PlatformBillingAuditLog"
  ADD COLUMN "webhookEnvironment" "PlatformBillingEnvironment",
  ADD COLUMN "webhookEventId" TEXT;

ALTER TABLE "PlatformBillingAuditLog"
  ADD CONSTRAINT "chk_platform_billing_audit_webhook_identity_pair"
  CHECK (("webhookEnvironment" IS NULL) = ("webhookEventId" IS NULL));

CREATE UNIQUE INDEX "uq_platform_billing_audit_webhook_event_action"
  ON "PlatformBillingAuditLog"("webhookEnvironment", "webhookEventId", "action");
