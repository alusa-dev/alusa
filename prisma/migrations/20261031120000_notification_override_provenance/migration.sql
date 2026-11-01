ALTER TABLE "AsaasNotificationPreferenceOutbox"
  ADD COLUMN "lastAppliedPolicyVersion" INTEGER;

ALTER TABLE "AsaasCustomerNotificationOverride"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'EXPLICIT';
