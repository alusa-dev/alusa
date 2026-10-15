-- Associate an existing pending account reservation only when exactly one
-- durable plan-change row proves its tenant, environment, subscription, plans,
-- and effective date. Ambiguous legacy state remains untouched for manual
-- reconciliation instead of choosing an arbitrary operation.
WITH matching_legacy_downgrades AS (
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
    AND account."pendingChangeOperationId" IS NULL
  GROUP BY account."id"
)
UPDATE "PlatformBillingAccount" account
SET "pendingChangeOperationId" = matches."planChangeId"
FROM matching_legacy_downgrades matches
WHERE account."id" = matches."accountId"
  AND matches."matchCount" = 1;
