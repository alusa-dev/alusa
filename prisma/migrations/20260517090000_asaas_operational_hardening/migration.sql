ALTER TYPE "AsaasIntegrationJobType" ADD VALUE IF NOT EXISTS 'RECONCILE_ACCOUNT';
ALTER TYPE "AsaasIntegrationJobType" ADD VALUE IF NOT EXISTS 'PROCESS_WEBHOOK';
ALTER TYPE "AsaasIntegrationJobType" ADD VALUE IF NOT EXISTS 'REPROCESS_WEBHOOK';
ALTER TYPE "AsaasIntegrationJobType" ADD VALUE IF NOT EXISTS 'SYNC_KYC_STATUS';
ALTER TYPE "AsaasIntegrationJobType" ADD VALUE IF NOT EXISTS 'HEALTH_CHECK_SUBACCOUNT';
ALTER TYPE "AsaasIntegrationJobType" ADD VALUE IF NOT EXISTS 'ROTATE_OR_VALIDATE_API_KEY';

ALTER TYPE "AsaasApiKeyStatus" ADD VALUE IF NOT EXISTS 'INVALID';
ALTER TYPE "AsaasApiKeyStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "AsaasApiKeyStatus" ADD VALUE IF NOT EXISTS 'DISABLED';
ALTER TYPE "AsaasApiKeyStatus" ADD VALUE IF NOT EXISTS 'DELETED';

DO $$
BEGIN
  CREATE TYPE "AsaasWebhookStatus" AS ENUM (
    'NOT_CONFIGURED',
    'PENDING',
    'ACTIVE',
    'DRIFT',
    'INTERRUPTED',
    'INVALID_URL',
    'AUTH_TOKEN_MISMATCH'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AsaasOperationalStatus" AS ENUM (
    'NOT_READY',
    'PROVISIONING',
    'API_KEY_REQUIRED',
    'WEBHOOK_REQUIRED',
    'KYC_PENDING',
    'UNDER_REVIEW',
    'OPERATIONAL',
    'BLOCKED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "AsaasAccount"
  ADD COLUMN IF NOT EXISTS "webhookStatus" "AsaasWebhookStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN IF NOT EXISTS "operationalStatus" "AsaasOperationalStatus" NOT NULL DEFAULT 'NOT_READY',
  ADD COLUMN IF NOT EXISTS "lastHealthCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastWebhookCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastApiKeyCheckAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastAsaasSyncAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "provisionLockKey" TEXT,
  ADD COLUMN IF NOT EXISTS "provisionLastStage" TEXT;

ALTER TABLE "TenantFeatureFlags"
  ADD COLUMN IF NOT EXISTS "enableAsaasProvisioningHardening" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "enableWebhookRequiredBeforeCharge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "enableApiKeyEventBlocking" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "enableRegulatoryStatusBlocking" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "enableAsaasHealthPanel" BOOLEAN NOT NULL DEFAULT false;

UPDATE "AsaasAccount"
SET
  "webhookStatus" = CASE
    WHEN "webhookAuthTokenHash" IS NOT NULL THEN 'ACTIVE'::"AsaasWebhookStatus"
    WHEN "asaasAccountId" IS NOT NULL THEN 'PENDING'::"AsaasWebhookStatus"
    ELSE 'NOT_CONFIGURED'::"AsaasWebhookStatus"
  END,
  "operationalStatus" = CASE
    WHEN "status" = 'REJECTED' THEN 'REJECTED'::"AsaasOperationalStatus"
    WHEN "asaasAccountId" IS NULL THEN 'NOT_READY'::"AsaasOperationalStatus"
    WHEN "apiKeyEncrypted" IS NULL OR "apiKeyStatus" <> 'CONNECTED' THEN 'API_KEY_REQUIRED'::"AsaasOperationalStatus"
    WHEN "webhookAuthTokenHash" IS NULL THEN 'WEBHOOK_REQUIRED'::"AsaasOperationalStatus"
    ELSE 'OPERATIONAL'::"AsaasOperationalStatus"
  END
WHERE TRUE;

CREATE INDEX IF NOT EXISTS "AsaasAccount_apiKeyStatus_idx" ON "AsaasAccount"("apiKeyStatus");
CREATE INDEX IF NOT EXISTS "AsaasAccount_webhookStatus_idx" ON "AsaasAccount"("webhookStatus");
CREATE INDEX IF NOT EXISTS "AsaasAccount_operationalStatus_idx" ON "AsaasAccount"("operationalStatus");
