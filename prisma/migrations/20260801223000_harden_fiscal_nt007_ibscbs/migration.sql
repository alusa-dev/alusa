ALTER TABLE "Invoice"
ADD COLUMN "lastWebhookEventAt" TIMESTAMP(3),
ADD COLUMN "lastWebhookEventId" TEXT,
ADD COLUMN "providerStateIbs" DECIMAL(8,4),
ADD COLUMN "providerStateIbsValue" DECIMAL(12,2),
ADD COLUMN "providerMunicipalIbs" DECIMAL(8,4),
ADD COLUMN "providerMunicipalIbsValue" DECIMAL(12,2),
ADD COLUMN "providerCbs" DECIMAL(8,4),
ADD COLUMN "providerCbsValue" DECIMAL(12,2);

CREATE INDEX "Invoice_contaId_lastWebhookEventAt_idx"
ON "Invoice"("contaId", "lastWebhookEventAt");

-- NT-007 is mandatory for Regime Normal. Legacy CST 07 is migrated to the
-- official enum without guessing any other fiscal classification.
UPDATE "FiscalService"
SET "pisCofinsTaxStatus" = 'EXEMPT_CONTRIBUTION_OPERATION',
    "useTaxSystemReformNT007" = true
WHERE "pisCofinsTaxStatus" = 'TAXABLE_CONTRIBUTION_OPERATION';

UPDATE "FiscalService" service
SET "useTaxSystemReformNT007" = true
FROM "ContaFiscalSettings" settings
WHERE settings."contaId" = service."contaId"
  AND settings."simplesNacional" = false;
