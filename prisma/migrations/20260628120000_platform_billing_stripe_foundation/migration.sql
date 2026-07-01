-- Platform billing foundation for Alusa commercial SaaS subscriptions.
-- This is intentionally separate from educational finance/Asaas models.

CREATE TYPE "PlatformBillingEnvironment" AS ENUM ('TEST', 'LIVE');
CREATE TYPE "PlatformBillingPlanCode" AS ENUM ('STARTER', 'PREMIUM', 'PRO', 'CUSTOM');
CREATE TYPE "PlatformBillingAccountStatus" AS ENUM (
  'NOT_STARTED',
  'CHECKOUT_PENDING',
  'ACTIVE',
  'TRIALING',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'UNPAID',
  'PAUSED',
  'UNKNOWN'
);
CREATE TYPE "PlatformBillingCheckoutSessionStatus" AS ENUM ('CREATED', 'COMPLETED', 'EXPIRED');
CREATE TYPE "PlatformBillingInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE', 'UNKNOWN');
CREATE TYPE "PlatformBillingWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

CREATE TABLE "PlatformBillingAccount" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "environment" "PlatformBillingEnvironment" NOT NULL,
  "status" "PlatformBillingAccountStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "planCode" "PlatformBillingPlanCode",
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "stripePriceId" TEXT,
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "trialEndsAt" TIMESTAMP(3),
  "lastStripeEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformBillingAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformBillingCheckoutSession" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "billingAccountId" TEXT NOT NULL,
  "environment" "PlatformBillingEnvironment" NOT NULL,
  "planCode" "PlatformBillingPlanCode" NOT NULL,
  "stripeCheckoutSessionId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "stripePriceId" TEXT NOT NULL,
  "status" "PlatformBillingCheckoutSessionStatus" NOT NULL DEFAULT 'CREATED',
  "url" TEXT,
  "successUrl" TEXT NOT NULL,
  "cancelUrl" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformBillingCheckoutSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformBillingAuditLog" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "billingAccountId" TEXT,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "correlationId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformBillingAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformBillingInvoice" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "billingAccountId" TEXT,
  "environment" "PlatformBillingEnvironment" NOT NULL,
  "stripeInvoiceId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "stripeSubscriptionId" TEXT,
  "stripePriceId" TEXT,
  "planCode" "PlatformBillingPlanCode",
  "number" TEXT,
  "status" "PlatformBillingInvoiceStatus" NOT NULL DEFAULT 'UNKNOWN',
  "amountDue" INTEGER NOT NULL DEFAULT 0,
  "amountPaid" INTEGER NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'brl',
  "hostedInvoiceUrl" TEXT,
  "invoicePdf" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "raw" JSONB,
  "lastStripeEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformBillingInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformBillingWebhookEvent" (
  "id" TEXT NOT NULL,
  "environment" "PlatformBillingEnvironment" NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "contaId" TEXT,
  "status" "PlatformBillingWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "lastError" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformBillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_platform_billing_account_conta_env"
  ON "PlatformBillingAccount"("contaId", "environment");

CREATE UNIQUE INDEX "uq_platform_billing_account_env_customer"
  ON "PlatformBillingAccount"("environment", "stripeCustomerId");

CREATE UNIQUE INDEX "uq_platform_billing_account_env_subscription"
  ON "PlatformBillingAccount"("environment", "stripeSubscriptionId");

CREATE INDEX "idx_platform_billing_account_conta_status"
  ON "PlatformBillingAccount"("contaId", "status");

CREATE INDEX "idx_platform_billing_account_conta_plan"
  ON "PlatformBillingAccount"("contaId", "planCode");

CREATE UNIQUE INDEX "uq_platform_billing_checkout_env_session"
  ON "PlatformBillingCheckoutSession"("environment", "stripeCheckoutSessionId");

CREATE UNIQUE INDEX "uq_platform_billing_checkout_conta_env_idempotency"
  ON "PlatformBillingCheckoutSession"("contaId", "environment", "idempotencyKey");

CREATE INDEX "idx_platform_billing_checkout_conta_status_created"
  ON "PlatformBillingCheckoutSession"("contaId", "status", "createdAt");

CREATE INDEX "idx_platform_billing_checkout_conta_account"
  ON "PlatformBillingCheckoutSession"("contaId", "billingAccountId");

CREATE INDEX "idx_platform_billing_checkout_created_by"
  ON "PlatformBillingCheckoutSession"("createdByUserId");

CREATE INDEX "idx_platform_billing_audit_conta_created"
  ON "PlatformBillingAuditLog"("contaId", "createdAt");

CREATE INDEX "idx_platform_billing_audit_conta_action"
  ON "PlatformBillingAuditLog"("contaId", "action", "createdAt");

CREATE INDEX "idx_platform_billing_audit_entity"
  ON "PlatformBillingAuditLog"("contaId", "entityType", "entityId");

CREATE INDEX "idx_platform_billing_audit_correlation"
  ON "PlatformBillingAuditLog"("contaId", "correlationId");

CREATE INDEX "idx_platform_billing_audit_account"
  ON "PlatformBillingAuditLog"("billingAccountId");

CREATE INDEX "idx_platform_billing_audit_actor"
  ON "PlatformBillingAuditLog"("actorUserId");

CREATE UNIQUE INDEX "uq_platform_billing_invoice_env_invoice"
  ON "PlatformBillingInvoice"("environment", "stripeInvoiceId");

CREATE INDEX "idx_platform_billing_invoice_conta_status_created"
  ON "PlatformBillingInvoice"("contaId", "status", "createdAt");

CREATE INDEX "idx_platform_billing_invoice_conta_account"
  ON "PlatformBillingInvoice"("contaId", "billingAccountId");

CREATE INDEX "idx_platform_billing_invoice_conta_paid"
  ON "PlatformBillingInvoice"("contaId", "paidAt");

CREATE INDEX "idx_platform_billing_invoice_customer"
  ON "PlatformBillingInvoice"("stripeCustomerId");

CREATE INDEX "idx_platform_billing_invoice_subscription"
  ON "PlatformBillingInvoice"("stripeSubscriptionId");

CREATE UNIQUE INDEX "uq_platform_billing_webhook_env_event"
  ON "PlatformBillingWebhookEvent"("environment", "eventId");

CREATE INDEX "idx_platform_billing_webhook_status_received"
  ON "PlatformBillingWebhookEvent"("status", "receivedAt");

CREATE INDEX "idx_platform_billing_webhook_conta_status_received"
  ON "PlatformBillingWebhookEvent"("contaId", "status", "receivedAt");

CREATE INDEX "idx_platform_billing_webhook_type_received"
  ON "PlatformBillingWebhookEvent"("eventType", "receivedAt");

ALTER TABLE "PlatformBillingAccount"
  ADD CONSTRAINT "PlatformBillingAccount_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformBillingCheckoutSession"
  ADD CONSTRAINT "PlatformBillingCheckoutSession_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformBillingCheckoutSession"
  ADD CONSTRAINT "PlatformBillingCheckoutSession_billingAccountId_fkey"
  FOREIGN KEY ("billingAccountId") REFERENCES "PlatformBillingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformBillingCheckoutSession"
  ADD CONSTRAINT "PlatformBillingCheckoutSession_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformBillingAuditLog"
  ADD CONSTRAINT "PlatformBillingAuditLog_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformBillingAuditLog"
  ADD CONSTRAINT "PlatformBillingAuditLog_billingAccountId_fkey"
  FOREIGN KEY ("billingAccountId") REFERENCES "PlatformBillingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformBillingAuditLog"
  ADD CONSTRAINT "PlatformBillingAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlatformBillingInvoice"
  ADD CONSTRAINT "PlatformBillingInvoice_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformBillingInvoice"
  ADD CONSTRAINT "PlatformBillingInvoice_billingAccountId_fkey"
  FOREIGN KEY ("billingAccountId") REFERENCES "PlatformBillingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
  rel_name text;
BEGIN
  IF to_regnamespace('app_security') IS NULL THEN
    RETURN;
  END IF;

  FOREACH rel_name IN ARRAY ARRAY[
    'PlatformBillingAccount',
    'PlatformBillingCheckoutSession',
    'PlatformBillingInvoice',
    'PlatformBillingAuditLog'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (%I = app_security.current_conta_id()) WITH CHECK (%I = app_security.current_conta_id())',
      rel_name,
      'contaId',
      'contaId'
    );
  END LOOP;
END $$;
