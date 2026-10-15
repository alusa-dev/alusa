ALTER TABLE "PlatformBillingAccount"
  ADD COLUMN "pendingChangeOperationId" TEXT,
  ADD COLUMN "pendingChangeClaimToken" TEXT,
  ADD COLUMN "pendingChangeClaimedAt" TIMESTAMP(3);

ALTER TABLE "PlatformBillingAccount"
  ADD CONSTRAINT "PlatformBillingAccount_pending_change_claim_check"
  CHECK (
    ("pendingChangeOperationId" IS NULL AND "pendingChangeClaimToken" IS NULL AND "pendingChangeClaimedAt" IS NULL)
    OR (
      "pendingChangeOperationId" IS NOT NULL
      AND length("pendingChangeOperationId") > 0
      AND (("pendingChangeClaimToken" IS NULL AND "pendingChangeClaimedAt" IS NULL)
        OR ("pendingChangeClaimToken" IS NOT NULL AND length("pendingChangeClaimToken") > 0 AND "pendingChangeClaimedAt" IS NOT NULL))
    )
  );

CREATE INDEX "idx_platform_billing_account_pending_operation"
  ON "PlatformBillingAccount"("contaId", "environment", "pendingChangeOperationId");
