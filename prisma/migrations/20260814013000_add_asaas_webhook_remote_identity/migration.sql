-- Persist the remote webhook identity and a short-lived provisioning lease.
-- All columns are nullable so the migration is backward-compatible with
-- existing external and white-label accounts.
ALTER TABLE "AsaasAccount"
ADD COLUMN "webhookId" TEXT,
ADD COLUMN "webhookProvisionLockToken" TEXT,
ADD COLUMN "webhookProvisionLockedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "AsaasAccount_webhookId_key"
ON "AsaasAccount"("webhookId");

CREATE INDEX "AsaasAccount_webhookProvisionLockedAt_idx"
ON "AsaasAccount"("webhookProvisionLockedAt");
