-- A stuck Stripe webhook may arrive without a valid tenant. Platform-wide
-- issues must remain unowned instead of being assigned to an arbitrary Conta.
ALTER TABLE "PlatformBillingIssue"
  ALTER COLUMN "contaId" DROP NOT NULL;

-- Versions before this migration used the first account in the reconciliation
-- batch for the global webhook-stuck fingerprint. Remove only that incorrect
-- ownership; preserve the issue and its audit data.
UPDATE "PlatformBillingIssue"
SET
  "contaId" = NULL,
  "billingAccountId" = NULL
WHERE "code" = 'WEBHOOK_EVENTS_STUCK'
  AND "fingerprint" IN ('TEST:webhook-stuck', 'LIVE:webhook-stuck');
