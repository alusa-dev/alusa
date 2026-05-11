CREATE TYPE "FinanceIntegrationMode" AS ENUM ('WHITELABEL_BAAS', 'EXTERNAL_ASAAS_ACCOUNT');

CREATE TYPE "ExternalAsaasOnboardingStatus" AS ENUM (
  'NOT_STARTED',
  'PENDING_CONFIGURATION',
  'CONNECTING',
  'WEBHOOK_PENDING',
  'READY',
  'FAILED'
);

ALTER TABLE "Conta"
ADD COLUMN "financeIntegrationMode" "FinanceIntegrationMode" NOT NULL DEFAULT 'WHITELABEL_BAAS',
ADD COLUMN "externalAsaasOnboardingStatus" "ExternalAsaasOnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED';

CREATE INDEX "Conta_financeIntegrationMode_idx" ON "Conta"("financeIntegrationMode");

CREATE INDEX "Conta_externalAsaasOnboardingStatus_idx" ON "Conta"("externalAsaasOnboardingStatus");

ALTER TABLE "TenantFeatureFlags"
ADD COLUMN "enableExternalAsaasOnboarding" BOOLEAN NOT NULL DEFAULT false;