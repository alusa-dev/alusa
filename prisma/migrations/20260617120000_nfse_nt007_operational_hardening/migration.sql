-- NFS-e hardening for NT-007, provider snapshots and recoverable issuance attempts.

ALTER TYPE "FinanceReconciliationEntityType" ADD VALUE IF NOT EXISTS 'INVOICE';
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'INVOICE_STATUS_DRIFT';
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'INVOICE_UNKNOWN_STATUS';
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'INVOICE_RECOVERY_REQUIRED';
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'INVOICE_PROVIDER_LINK_MISSING';
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'INVOICE_CANCEL_REVIEW';

CREATE TYPE "InvoiceOperationStatus" AS ENUM ('IDLE', 'CREATING', 'RECONCILING', 'FAILED');

ALTER TABLE "Invoice"
  ADD COLUMN "operationStatus" "InvoiceOperationStatus" NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "operationStartedAt" TIMESTAMP(3),
  ADD COLUMN "operationLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "operationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorKind" TEXT,
  ADD COLUMN "lastErrorMessage" TEXT,
  ADD COLUMN "providerTaxes" JSONB,
  ADD COLUMN "providerSnapshot" JSONB,
  ADD COLUMN "rawProviderStatus" TEXT,
  ADD COLUMN "providerPisCofinsRetentionType" TEXT,
  ADD COLUMN "providerPisCofinsTaxStatus" TEXT,
  ADD COLUMN "providerOperationPis" DECIMAL(5, 2),
  ADD COLUMN "providerOperationCofins" DECIMAL(5, 2),
  ADD COLUMN "fiscalDivergence" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

CREATE INDEX "idx_invoice_conta_operation_lease"
  ON "Invoice"("contaId", "operationStatus", "operationLeaseExpiresAt");

CREATE INDEX "idx_invoice_conta_next_attempt"
  ON "Invoice"("contaId", "nextAttemptAt", "operationStatus");

CREATE INDEX "idx_invoice_conta_divergence"
  ON "Invoice"("contaId", "fiscalDivergence", "lastReconciledAt");

CREATE INDEX "idx_invoice_conta_provider_missing"
  ON "Invoice"("contaId", "operationStatus", "updatedAt")
  WHERE "asaasInvoiceId" IS NULL;

UPDATE "FiscalService"
SET "pisCofinsTaxStatus" = 'EXEMPT_CONTRIBUTION_OPERATION'
WHERE "pisCofinsTaxStatus" = 'TAXABLE_CONTRIBUTION_OPERATION';

UPDATE "Invoice"
SET "taxes" = jsonb_set(
  "taxes",
  '{pisCofinsTaxStatus}',
  to_jsonb('EXEMPT_CONTRIBUTION_OPERATION'::text),
  false
)
WHERE "taxes" IS NOT NULL
  AND "taxes"->>'pisCofinsTaxStatus' = 'TAXABLE_CONTRIBUTION_OPERATION';
