BEGIN;

ALTER TABLE "PlatformBillingAccount"
  DROP CONSTRAINT "PlatformBillingAccount_trialSubscriptionClaim_check";

ALTER TABLE "PlatformBillingAccount"
  ADD CONSTRAINT "PlatformBillingAccount_trialSubscriptionClaim_check"
    CHECK ((
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
    ) IS TRUE);

COMMIT;
