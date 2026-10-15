ALTER TABLE "PlatformBillingAccount"
  ADD COLUMN "checkoutClaimKey" TEXT,
  ADD COLUMN "checkoutClaimPhase" TEXT,
  ADD COLUMN "checkoutClaimedAt" TIMESTAMP(3),
  ADD COLUMN "checkoutRequestExpiresAt" TIMESTAMP(3);
CREATE INDEX "idx_platform_billing_checkout_claim_phase_expiry"
  ON "PlatformBillingAccount"("checkoutClaimPhase", "checkoutRequestExpiresAt");
