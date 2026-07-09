ALTER TABLE "PlatformBillingAccount"
  ADD COLUMN "trialWillEndNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastReconciledAt" TIMESTAMP(3);

ALTER TABLE "PlatformBillingInvoice"
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "attempted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextPaymentAttempt" TIMESTAMP(3),
  ADD COLUMN "lastPaymentErrorCode" TEXT,
  ADD COLUMN "lastPaymentErrorMessage" TEXT;

CREATE INDEX "idx_platform_billing_account_last_reconciled"
  ON "PlatformBillingAccount"("lastReconciledAt");

CREATE INDEX "idx_platform_billing_invoice_next_attempt"
  ON "PlatformBillingInvoice"("nextPaymentAttempt");

CREATE INDEX "idx_platform_billing_invoice_failed"
  ON "PlatformBillingInvoice"("contaId", "failedAt");
