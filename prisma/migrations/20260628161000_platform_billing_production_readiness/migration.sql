CREATE TYPE "PlatformBillingAccessStatus" AS ENUM ('PENDING', 'ACTIVE', 'GRACE_PERIOD', 'RESTRICTED', 'CANCELED');
CREATE TYPE "PlatformBillingPlanChangeType" AS ENUM ('UPGRADE', 'DOWNGRADE', 'CANCEL_AT_PERIOD_END', 'UNDO_CANCEL', 'REACTIVATE', 'PAYMENT_RECOVERY');
CREATE TYPE "PlatformBillingPlanChangeStatus" AS ENUM ('PENDING_PAYMENT', 'PENDING_EFFECTIVE_DATE', 'APPLIED', 'CANCELED', 'FAILED', 'SUPERSEDED');
CREATE TYPE "PlatformBillingIssueSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "PlatformBillingIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

ALTER TABLE "PlatformBillingAccount"
  ADD COLUMN "accessStatus" "PlatformBillingAccessStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "gracePeriodEndsAt" TIMESTAMP(3),
  ADD COLUMN "restrictedAt" TIMESTAMP(3),
  ADD COLUMN "canceledAt" TIMESTAMP(3),
  ADD COLUMN "lastPaymentFailedAt" TIMESTAMP(3),
  ADD COLUMN "pendingPlanCode" "PlatformBillingPlanCode",
  ADD COLUMN "pendingChangeType" "PlatformBillingPlanChangeType",
  ADD COLUMN "pendingChangeEffectiveAt" TIMESTAMP(3);

ALTER TABLE "PlatformBillingWebhookEvent"
  ADD COLUMN "lastErrorCode" TEXT,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "processingTimeoutAt" TIMESTAMP(3),
  ADD COLUMN "exhaustedAt" TIMESTAMP(3),
  ADD COLUMN "workerId" TEXT,
  ADD COLUMN "correlationId" TEXT,
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE TABLE "PlatformBillingPlanChange" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "environment" "PlatformBillingEnvironment" NOT NULL,
  "type" "PlatformBillingPlanChangeType" NOT NULL,
  "status" "PlatformBillingPlanChangeStatus" NOT NULL,
  "fromPlanCode" "PlatformBillingPlanCode",
  "toPlanCode" "PlatformBillingPlanCode",
  "stripeSubscriptionId" TEXT,
  "stripePriceId" TEXT,
  "stripePendingUpdateId" TEXT,
  "effectiveAt" TIMESTAMP(3),
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "correlationId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlatformBillingPlanChange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformBillingIssue" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "billingAccountId" TEXT,
  "environment" "PlatformBillingEnvironment" NOT NULL,
  "severity" "PlatformBillingIssueSeverity" NOT NULL DEFAULT 'WARNING',
  "status" "PlatformBillingIssueStatus" NOT NULL DEFAULT 'OPEN',
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "details" JSONB,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "ignoredAt" TIMESTAMP(3),
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PlatformBillingIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_platform_billing_plan_change_idempotency" ON "PlatformBillingPlanChange"("contaId", "environment", "idempotencyKey");
CREATE INDEX "idx_platform_billing_plan_change_conta_status" ON "PlatformBillingPlanChange"("contaId", "status", "createdAt");
CREATE INDEX "idx_platform_billing_plan_change_account_status" ON "PlatformBillingPlanChange"("billingAccountId", "status");
CREATE INDEX "idx_platform_billing_plan_change_subscription" ON "PlatformBillingPlanChange"("environment", "stripeSubscriptionId");
CREATE INDEX "idx_platform_billing_plan_change_effective_status" ON "PlatformBillingPlanChange"("effectiveAt", "status");
CREATE INDEX "idx_platform_billing_plan_change_created_by" ON "PlatformBillingPlanChange"("createdByUserId");

CREATE UNIQUE INDEX "uq_platform_billing_issue_env_fingerprint" ON "PlatformBillingIssue"("environment", "fingerprint");
CREATE INDEX "idx_platform_billing_issue_conta_status_severity" ON "PlatformBillingIssue"("contaId", "status", "severity");
CREATE INDEX "idx_platform_billing_issue_account_status" ON "PlatformBillingIssue"("billingAccountId", "status");
CREATE INDEX "idx_platform_billing_issue_env_status_detected" ON "PlatformBillingIssue"("environment", "status", "detectedAt");

CREATE INDEX "idx_platform_billing_account_conta_access" ON "PlatformBillingAccount"("contaId", "accessStatus");
CREATE INDEX "idx_platform_billing_account_env_access" ON "PlatformBillingAccount"("environment", "accessStatus");
CREATE INDEX "idx_platform_billing_account_pending_effective" ON "PlatformBillingAccount"("pendingChangeEffectiveAt");
CREATE INDEX "idx_platform_billing_webhook_status_next" ON "PlatformBillingWebhookEvent"("status", "nextAttemptAt");
CREATE INDEX "idx_platform_billing_webhook_processing_timeout" ON "PlatformBillingWebhookEvent"("processingTimeoutAt");
CREATE INDEX "idx_platform_billing_webhook_correlation" ON "PlatformBillingWebhookEvent"("correlationId");

ALTER TABLE "PlatformBillingPlanChange" ADD CONSTRAINT "PlatformBillingPlanChange_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingPlanChange" ADD CONSTRAINT "PlatformBillingPlanChange_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "PlatformBillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingPlanChange" ADD CONSTRAINT "PlatformBillingPlanChange_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformBillingIssue" ADD CONSTRAINT "PlatformBillingIssue_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformBillingIssue" ADD CONSTRAINT "PlatformBillingIssue_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "PlatformBillingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
