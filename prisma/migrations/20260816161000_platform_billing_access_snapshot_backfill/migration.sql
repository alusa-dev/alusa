-- Backfill only derives durable billing facts already present in the local
-- invoice ledger. Provider calls remain the responsibility of reconciliation.
WITH paid_invoices AS (
  SELECT
    "billingAccountId",
    MIN("paidAt") AS "firstPaidAt",
    MAX("paidAt") AS "lastSuccessfulPaymentAt"
  FROM "PlatformBillingInvoice"
  WHERE "billingAccountId" IS NOT NULL
    AND "status" = 'PAID'
    AND "paidAt" IS NOT NULL
  GROUP BY "billingAccountId"
)
UPDATE "PlatformBillingAccount" AS account
SET
  "firstPaidAt" = COALESCE(account."firstPaidAt", paid."firstPaidAt"),
  "lastSuccessfulPaymentAt" = COALESCE(account."lastSuccessfulPaymentAt", paid."lastSuccessfulPaymentAt")
FROM paid_invoices AS paid
WHERE account."id" = paid."billingAccountId"
  AND (
    account."firstPaidAt" IS NULL
    OR account."lastSuccessfulPaymentAt" IS NULL
  );

-- Materialize deterministic restrictions so the first request after deploy
-- observes the same state as the request-time policy. PAST_DUE is intentionally
-- left for reconciliation/request-time evaluation because payment-method
-- presence cannot be inferred safely from the local ledger.
UPDATE "PlatformBillingAccount"
SET
  "accessStatus" = 'RESTRICTED',
  "restrictionReason" = CASE
    WHEN "status" = 'TRIALING' OR ("status" = 'ACTIVE' AND "trialEndsAt" IS NOT NULL AND "trialEndsAt" <= CURRENT_TIMESTAMP)
      THEN 'TRIAL_EXPIRED'::"PlatformBillingRestrictionReason"
    WHEN "status" = 'UNPAID' THEN 'PAYMENT_UNPAID'::"PlatformBillingRestrictionReason"
    WHEN "status" = 'PAUSED' THEN 'SUBSCRIPTION_PAUSED'::"PlatformBillingRestrictionReason"
    ELSE "restrictionReason"
  END,
  "restrictedAt" = COALESCE("restrictedAt", CURRENT_TIMESTAMP),
  "accessStateVersion" = "accessStateVersion" + 1
WHERE
  (
    ("status" = 'TRIALING' AND "trialEndsAt" IS NOT NULL AND "trialEndsAt" <= CURRENT_TIMESTAMP AND "firstPaidAt" IS NULL AND "lastSuccessfulPaymentAt" IS NULL)
    OR ("status" = 'ACTIVE' AND "trialEndsAt" IS NOT NULL AND "trialEndsAt" <= CURRENT_TIMESTAMP AND "firstPaidAt" IS NULL AND "lastSuccessfulPaymentAt" IS NULL)
    OR "status" IN ('UNPAID', 'PAUSED')
  )
  AND "accessStatus" <> 'RESTRICTED';
