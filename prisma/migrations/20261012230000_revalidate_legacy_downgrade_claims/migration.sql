BEGIN;

-- The prior backfill migration may have selected a unique match before a
-- concurrent billing write changed the account or plan-change row. Block writes
-- to both relations while recomputing and applying associations from one stable
-- database snapshot. This migration only touches unclaimed pending downgrades.
LOCK TABLE "PlatformBillingAccount", "PlatformBillingPlanChange"
  IN SHARE ROW EXCLUSIVE MODE;

WITH current_matches AS (
  SELECT
    account."id" AS "accountId",
    MIN(change."id") AS "planChangeId",
    COUNT(*) AS "matchCount"
  FROM "PlatformBillingAccount" account
  JOIN "PlatformBillingPlanChange" change
    ON change."billingAccountId" = account."id"
   AND change."contaId" = account."contaId"
   AND change."environment" = account."environment"
   AND change."type" = 'DOWNGRADE'
   AND change."status" = 'PENDING_EFFECTIVE_DATE'
   AND change."toPlanCode" = account."pendingPlanCode"
   AND change."fromPlanCode" = account."planCode"
   AND change."stripeSubscriptionId" = account."stripeSubscriptionId"
   AND change."effectiveAt" = account."pendingChangeEffectiveAt"
  WHERE account."pendingPlanCode" IS NOT NULL
    AND account."pendingChangeType" = 'DOWNGRADE'
    AND account."pendingChangeClaimToken" IS NULL
    AND account."pendingChangeClaimedAt" IS NULL
  GROUP BY account."id"
)
UPDATE "PlatformBillingAccount" account
SET "pendingChangeOperationId" = CASE
  WHEN matches."matchCount" = 1 THEN matches."planChangeId"
  ELSE NULL
END
FROM current_matches matches
WHERE account."id" = matches."accountId"
  AND account."pendingPlanCode" IS NOT NULL
  AND account."pendingChangeType" = 'DOWNGRADE'
  AND account."pendingChangeClaimToken" IS NULL
  AND account."pendingChangeClaimedAt" IS NULL;

-- Also clear an old backfill association when its account no longer represents
-- a pending downgrade. Do not modify live claims or unrelated account state.
UPDATE "PlatformBillingAccount" account
SET "pendingChangeOperationId" = NULL
WHERE account."pendingChangeOperationId" IS NOT NULL
  AND account."pendingChangeClaimToken" IS NULL
  AND account."pendingChangeClaimedAt" IS NULL
  AND (
    account."pendingPlanCode" IS NULL
    OR account."pendingChangeType" <> 'DOWNGRADE'
    OR NOT EXISTS (
      SELECT 1
      FROM "PlatformBillingPlanChange" change
      WHERE change."id" = account."pendingChangeOperationId"
        AND change."billingAccountId" = account."id"
        AND change."contaId" = account."contaId"
        AND change."environment" = account."environment"
        AND change."type" = 'DOWNGRADE'
        AND change."status" = 'PENDING_EFFECTIVE_DATE'
        AND change."toPlanCode" = account."pendingPlanCode"
        AND change."fromPlanCode" = account."planCode"
        AND change."stripeSubscriptionId" = account."stripeSubscriptionId"
        AND change."effectiveAt" = account."pendingChangeEffectiveAt"
    )
  );

COMMIT;
