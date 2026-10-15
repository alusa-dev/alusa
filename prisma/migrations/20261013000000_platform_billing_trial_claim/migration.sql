ALTER TABLE "PlatformBillingAccount"
  ADD COLUMN "trialSubscriptionClaimKey" TEXT,
  ADD COLUMN "trialSubscriptionClaimPhase" TEXT,
  ADD COLUMN "trialSubscriptionClaimedAt" TIMESTAMP(3),
  ADD COLUMN "trialSubscriptionRequestExpiresAt" TIMESTAMP(3);

ALTER TABLE "PlatformBillingAccount"
  ADD CONSTRAINT "PlatformBillingAccount_trialSubscriptionClaim_check"
    CHECK (
      ("trialSubscriptionClaimPhase" IS NULL
        AND "trialSubscriptionClaimKey" IS NULL
        AND "trialSubscriptionClaimedAt" IS NULL
        AND "trialSubscriptionRequestExpiresAt" IS NULL)
      OR ("trialSubscriptionClaimPhase" = 'CLAIMED'
        AND "trialSubscriptionClaimKey" IS NOT NULL
        AND "trialSubscriptionClaimedAt" IS NOT NULL
        AND "trialSubscriptionRequestExpiresAt" IS NULL)
      OR ("trialSubscriptionClaimPhase" = 'REQUESTING'
        AND "trialSubscriptionClaimKey" IS NOT NULL
        AND "trialSubscriptionClaimedAt" IS NOT NULL
        AND "trialSubscriptionRequestExpiresAt" IS NOT NULL)
    );

ALTER TABLE "PlatformBillingAccount"
  ADD CONSTRAINT "PlatformBillingAccount_subscriptionCreationClaim_exclusive_check"
    CHECK ("checkoutClaimKey" IS NULL OR "trialSubscriptionClaimKey" IS NULL);

CREATE INDEX "idx_platform_billing_trial_claim_lease"
  ON "PlatformBillingAccount"("trialSubscriptionClaimPhase", "trialSubscriptionClaimedAt");
