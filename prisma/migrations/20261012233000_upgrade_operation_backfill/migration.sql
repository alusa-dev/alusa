BEGIN;

-- Backfill legacy in-flight upgrades only from one exact tenant/account,
-- subscription, and from/to-plan match. Keep the match and write stable under
-- concurrent billing activity.
LOCK TABLE "PlatformBillingAccount", "PlatformBillingPlanChange"
  IN SHARE ROW EXCLUSIVE MODE;

WITH matching_pending_upgrades AS (
  SELECT
    account."id" AS "accountId",
    MIN(change."id") AS "planChangeId",
    COUNT(*) AS "matchCount"
  FROM "PlatformBillingAccount" account
  JOIN "PlatformBillingPlanChange" change
    ON change."billingAccountId" = account."id"
   AND change."contaId" = account."contaId"
   AND change."environment" = account."environment"
   AND change."type" = 'UPGRADE'
   AND change."status" = 'PENDING_PAYMENT'
   AND change."toPlanCode" = account."pendingPlanCode"
   AND change."fromPlanCode" = account."planCode"
   AND change."stripeSubscriptionId" = account."stripeSubscriptionId"
  WHERE account."pendingPlanCode" IS NOT NULL
    AND account."pendingChangeType" = 'UPGRADE'
    AND account."pendingChangeOperationId" IS NULL
    AND account."pendingChangeClaimToken" IS NULL
    AND account."pendingChangeClaimedAt" IS NULL
  GROUP BY account."id"
)
UPDATE "PlatformBillingAccount" account
SET "pendingChangeOperationId" = matches."planChangeId"
FROM matching_pending_upgrades matches
WHERE account."id" = matches."accountId"
  AND matches."matchCount" = 1
  AND account."pendingPlanCode" IS NOT NULL
  AND account."pendingChangeType" = 'UPGRADE'
  AND account."pendingChangeOperationId" IS NULL
  AND account."pendingChangeClaimToken" IS NULL
  AND account."pendingChangeClaimedAt" IS NULL;

-- The prior downgrade cleanup used <> 'DOWNGRADE', which does not match NULL
-- in SQL. Remove stale ownership from unclaimed rows with no pending type.
UPDATE "PlatformBillingAccount"
SET "pendingChangeOperationId" = NULL
WHERE "pendingPlanCode" IS NOT NULL
  AND "pendingChangeType" IS NULL
  AND "pendingChangeOperationId" IS NOT NULL
  AND "pendingChangeClaimToken" IS NULL
  AND "pendingChangeClaimedAt" IS NULL;

COMMIT;
