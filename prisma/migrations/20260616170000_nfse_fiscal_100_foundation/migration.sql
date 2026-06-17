CREATE TYPE "FiscalSyncStatus" AS ENUM ('SYNCED', 'PENDING', 'DIVERGED');

ALTER TABLE "ContaFiscalSettings"
  ADD COLUMN "useNationalPortal" BOOLEAN,
  ADD COLUMN "syncStatus" "FiscalSyncStatus" NOT NULL DEFAULT 'SYNCED',
  ADD COLUMN "lastSyncError" TEXT;

ALTER TABLE "Subscription"
  ADD COLUMN "asaasInvoiceSettingsConfigured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fiscalInvoiceSettingsSyncedAt" TIMESTAMP(3),
  ADD COLUMN "fiscalInvoiceSettingsError" TEXT;

ALTER TABLE "StandaloneSubscription"
  ADD COLUMN "asaasInvoiceSettingsConfigured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fiscalInvoiceSettingsSyncedAt" TIMESTAMP(3),
  ADD COLUMN "fiscalInvoiceSettingsError" TEXT;

CREATE INDEX "idx_subscription_conta_invoice_settings"
  ON "Subscription"("contaId", "asaasInvoiceSettingsConfigured");

CREATE INDEX "idx_standalone_subscription_conta_invoice_settings"
  ON "StandaloneSubscription"("contaId", "asaasInvoiceSettingsConfigured");
