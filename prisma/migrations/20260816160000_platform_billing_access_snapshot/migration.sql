CREATE TYPE "PlatformBillingPaymentMethodStatus" AS ENUM ('MISSING', 'PRESENT', 'UNKNOWN');
CREATE TYPE "PlatformBillingRestrictionReason" AS ENUM (
  'TRIAL_EXPIRED',
  'FIRST_PAYMENT_INCOMPLETE',
  'PAYMENT_PAST_DUE',
  'PAYMENT_UNPAID',
  'SUBSCRIPTION_PAUSED',
  'SUBSCRIPTION_CANCELED',
  'PAYMENT_METHOD_MISSING',
  'UNKNOWN'
);

ALTER TABLE "PlatformBillingAccount"
  ADD COLUMN "firstPaidAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessfulPaymentAt" TIMESTAMP(3),
  ADD COLUMN "paymentMethodStatus" "PlatformBillingPaymentMethodStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "paymentMethodType" TEXT,
  ADD COLUMN "paymentMethodBrand" TEXT,
  ADD COLUMN "paymentMethodLast4" TEXT,
  ADD COLUMN "paymentMethodExpMonth" INTEGER,
  ADD COLUMN "paymentMethodExpYear" INTEGER,
  ADD COLUMN "restrictionReason" "PlatformBillingRestrictionReason",
  ADD COLUMN "gracePeriodStartedAt" TIMESTAMP(3),
  ADD COLUMN "accessStateVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastProviderEventCreatedAt" TIMESTAMP(3);

CREATE INDEX "idx_platform_billing_account_access_state" ON "PlatformBillingAccount"("accessStatus", "restrictionReason");
CREATE INDEX "idx_platform_billing_account_grace_end" ON "PlatformBillingAccount"("gracePeriodEndsAt");
