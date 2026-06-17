-- CreateEnum
CREATE TYPE "FiscalAccessMethod" AS ENUM ('USER_PASSWORD', 'TOKEN', 'CERTIFICATE');
CREATE TYPE "FiscalEmissionMode" AS ENUM ('MANUAL', 'ON_PAYMENT');
CREATE TYPE "FiscalReadinessStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'READY');

-- Migrate InvoiceStatus
CREATE TYPE "InvoiceStatus_new" AS ENUM (
  'SCHEDULED',
  'SYNCHRONIZED',
  'AUTHORIZED',
  'PROCESSING_CANCELLATION',
  'CANCELED',
  'CANCELLATION_DENIED',
  'ERROR'
);

ALTER TABLE "Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING (
  CASE "status"::text
    WHEN 'REQUESTED' THEN 'SCHEDULED'::"InvoiceStatus_new"
    WHEN 'ISSUED' THEN 'AUTHORIZED'::"InvoiceStatus_new"
    WHEN 'CANCELING' THEN 'PROCESSING_CANCELLATION'::"InvoiceStatus_new"
    WHEN 'CANCELED' THEN 'CANCELED'::"InvoiceStatus_new"
    WHEN 'ERROR' THEN 'ERROR'::"InvoiceStatus_new"
    ELSE 'SCHEDULED'::"InvoiceStatus_new"
  END
);
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'SCHEDULED'::"InvoiceStatus_new";
DROP TYPE "InvoiceStatus";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";

-- FiscalService
CREATE TABLE "FiscalService" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "municipalServiceCode" TEXT NOT NULL,
    "nationalTaxCode" TEXT,
    "nbsCode" TEXT,
    "defaultDescription" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "iss" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "pis" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cofins" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "csll" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "inss" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "ir" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "retainIss" BOOLEAN NOT NULL DEFAULT false,
    "asaasMunicipalServiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalService_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FiscalService_contaId_idx" ON "FiscalService"("contaId");
CREATE INDEX "FiscalService_contaId_isDefault_idx" ON "FiscalService"("contaId", "isDefault");

ALTER TABLE "FiscalService" ADD CONSTRAINT "FiscalService_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend Invoice
ALTER TABLE "Invoice" ADD COLUMN "cobrancaId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "matriculaId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "responsavelId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "fiscalServiceId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "statusDescription" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "scheduledAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN "serviceDescription" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "observations" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "taxes" JSONB;

DROP INDEX IF EXISTS "Invoice_externalReference_key";
DROP INDEX IF EXISTS "Invoice_asaasInvoiceId_key";

CREATE UNIQUE INDEX "Invoice_contaId_externalReference_key" ON "Invoice"("contaId", "externalReference");
CREATE UNIQUE INDEX "Invoice_contaId_asaasInvoiceId_key" ON "Invoice"("contaId", "asaasInvoiceId");

CREATE INDEX "Invoice_contaId_status_idx" ON "Invoice"("contaId", "status");
CREATE INDEX "Invoice_cobrancaId_idx" ON "Invoice"("cobrancaId");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_fiscalServiceId_fkey" FOREIGN KEY ("fiscalServiceId") REFERENCES "FiscalService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ContaFiscalSettings
CREATE TABLE "ContaFiscalSettings" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "fiscalEmail" TEXT,
    "municipalInscription" TEXT,
    "simplesNacional" BOOLEAN NOT NULL DEFAULT false,
    "culturalProjectsPromoter" BOOLEAN NOT NULL DEFAULT false,
    "cnae" TEXT,
    "specialTaxRegime" TEXT,
    "serviceListItem" TEXT,
    "nbsCode" TEXT,
    "rpsSerie" TEXT,
    "rpsNumber" INTEGER,
    "loteNumber" INTEGER,
    "nationalPortalTaxCalculationRegime" TEXT,
    "accessMethod" "FiscalAccessMethod",
    "accessConfiguredAt" TIMESTAMP(3),
    "passwordConfigured" BOOLEAN NOT NULL DEFAULT false,
    "accessTokenConfigured" BOOLEAN NOT NULL DEFAULT false,
    "certificateConfigured" BOOLEAN NOT NULL DEFAULT false,
    "defaultDescriptionTemplate" TEXT,
    "defaultObservations" TEXT,
    "defaultDeductions" DECIMAL(12,2),
    "emissionMode" "FiscalEmissionMode" NOT NULL DEFAULT 'MANUAL',
    "readinessStatus" "FiscalReadinessStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "readinessIssues" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "asaasFiscalSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaFiscalSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContaFiscalSettings_contaId_key" ON "ContaFiscalSettings"("contaId");

ALTER TABLE "ContaFiscalSettings" ADD CONSTRAINT "ContaFiscalSettings_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- InvoiceAuditEvent
CREATE TABLE "InvoiceAuditEvent" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "InvoiceStatus",
    "toStatus" "InvoiceStatus",
    "metadata" JSONB,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InvoiceAuditEvent_contaId_idx" ON "InvoiceAuditEvent"("contaId");
CREATE INDEX "InvoiceAuditEvent_invoiceId_idx" ON "InvoiceAuditEvent"("invoiceId");
CREATE INDEX "InvoiceAuditEvent_contaId_createdAt_idx" ON "InvoiceAuditEvent"("contaId", "createdAt");

ALTER TABLE "InvoiceAuditEvent" ADD CONSTRAINT "InvoiceAuditEvent_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvoiceAuditEvent" ADD CONSTRAINT "InvoiceAuditEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
