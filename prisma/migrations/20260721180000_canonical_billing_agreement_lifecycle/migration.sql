-- Canonical enrollment billing agreements.
--
-- This migration is additive and keeps every legacy financial table intact.
-- Backfill statements are retry-safe (`ON CONFLICT DO NOTHING` plus guarded
-- updates), allowing an interrupted data phase to be replayed before Prisma
-- records the migration as applied.

CREATE TYPE "BillingAgreementStatus" AS ENUM (
  'DRAFT',
  'PENDING_PROVISION',
  'ACTIVE',
  'INACTIVE',
  'CANCELLATION_PENDING',
  'CANCELLED',
  'FAILED',
  'REQUIRES_RECONCILIATION'
);

CREATE TYPE "BillingAgreementSource" AS ENUM (
  'CANONICAL',
  'LEGACY_SUBSCRIPTION',
  'LEGACY_STANDALONE_SUBSCRIPTION',
  'LEGACY_FAMILY_ALLOCATION'
);

CREATE TYPE "BillingAllocationKind" AS ENUM (
  'TUITION',
  'ENROLLMENT_FEE',
  'MATERIAL',
  'ADJUSTMENT'
);

CREATE TYPE "BillingAllocationStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED');
CREATE TYPE "BillingProrationPolicy" AS ENUM ('FULL_CURRENT_CYCLE', 'DAILY_CURRENT_CYCLE', 'NEXT_CYCLE', 'MANUAL');
CREATE TYPE "BillingChangeOperationType" AS ENUM (
  'ADD', 'REMOVE', 'UPDATE', 'UPDATE_TERMS', 'TRANSFER', 'CHANGE_PAYER', 'REBALANCE_PAYER_SHARES',
  'PAUSE_ALLOCATION', 'RESUME_ALLOCATION', 'PAUSE_AGREEMENT', 'RESUME_AGREEMENT',
  'CANCEL', 'RENEW'
);
CREATE TYPE "BillingChangeOperationStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REQUIRES_RECONCILIATION', 'CANCELLED');
CREATE TYPE "BillingEffectivePolicy" AS ENUM ('CURRENT_CYCLE_FULL', 'CURRENT_CYCLE_PRORATED', 'NEXT_CYCLE', 'MANUAL_ADJUSTMENT');
CREATE TYPE "BillingAdjustmentType" AS ENUM ('CREDIT', 'COMPLEMENT', 'REFUND', 'MANUAL_REVIEW');
CREATE TYPE "BillingAdjustmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'APPLIED', 'FAILED', 'CANCELLED', 'REQUIRES_RECONCILIATION');
CREATE TYPE "BillingPayerShareType" AS ENUM ('PERCENTAGE', 'FIXED');
CREATE TYPE "BillingPayerShareStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');

ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'BILLING_AGREEMENT_VALUE_DRIFT';
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'BILLING_AGREEMENT_REMOTE_MISSING';
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'BILLING_AGREEMENT_ORPHAN_REMOTE';
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'BILLING_ALLOCATION_DRIFT';
ALTER TYPE "FinanceReconciliationIssueType" ADD VALUE IF NOT EXISTS 'BILLING_OPERATION_UNCERTAIN';

ALTER TYPE "AsaasIntegrationJobType" ADD VALUE IF NOT EXISTS 'PROCESS_BILLING_AGREEMENT_CHANGE';
ALTER TYPE "AsaasIntegrationJobType" ADD VALUE IF NOT EXISTS 'PROCESS_BILLING_ADJUSTMENT';
ALTER TYPE "AsaasIntegrationJobType" ADD VALUE IF NOT EXISTS 'RECONCILE_BILLING_AGREEMENT';

-- Tenant-safe FK targets. These indexes are redundant with the global PK for
-- lookup, but make contaId part of every new financial relationship.
CREATE UNIQUE INDEX "uq_aluno_conta_id" ON "Aluno"("contaId", "id");
CREATE UNIQUE INDEX "uq_matricula_conta_id" ON "Matricula"("contaId", "id");
CREATE UNIQUE INDEX "uq_customer_conta_id" ON "Customer"("contaId", "id");
CREATE UNIQUE INDEX "uq_subscription_conta_id" ON "Subscription"("contaId", "id");
CREATE UNIQUE INDEX "uq_standalone_subscription_conta_id" ON "StandaloneSubscription"("contaId", "id");
CREATE UNIQUE INDEX "uq_family_fin_alloc_conta_id" ON "FamilyFinancialAllocation"("contaId", "id");

CREATE TABLE "BillingAgreement" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "customerId" TEXT,
  "payerType" "CustomerPayerType" NOT NULL,
  "payerId" TEXT NOT NULL,
  "source" "BillingAgreementSource" NOT NULL DEFAULT 'CANONICAL',
  "status" "BillingAgreementStatus" NOT NULL DEFAULT 'DRAFT',
  "externalReference" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "billingGroupKey" TEXT,
  "billingType" TEXT NOT NULL,
  "cycle" TEXT NOT NULL,
  "dueDay" INTEGER,
  "interestValue" DECIMAL(12,2),
  "interestType" TEXT,
  "fineValue" DECIMAL(12,2),
  "fineType" TEXT,
  "discountValue" DECIMAL(12,2),
  "discountType" TEXT,
  "discountDueDateLimitDays" INTEGER,
  "confirmedTerms" JSONB,
  "nextDueDate" TIMESTAMP(3),
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "desiredValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "confirmedValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "asaasSubscriptionId" TEXT,
  "remoteStatus" TEXT,
  "remoteStatusUpdatedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "lastReconciledAt" TIMESTAMP(3),
  "reconciliationError" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingAgreement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingAgreement_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAgreement_customerId_fkey"
    FOREIGN KEY ("contaId", "customerId") REFERENCES "Customer"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ck_billing_agreement_amounts_nonnegative"
    CHECK ("desiredValue" >= 0 AND "confirmedValue" >= 0),
  CONSTRAINT "ck_billing_agreement_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "ck_billing_agreement_due_day" CHECK ("dueDay" IS NULL OR "dueDay" BETWEEN 1 AND 31),
  CONSTRAINT "ck_billing_agreement_terms_nonnegative" CHECK (
    ("interestValue" IS NULL OR "interestValue" >= 0)
    AND ("fineValue" IS NULL OR "fineValue" >= 0)
    AND ("discountValue" IS NULL OR "discountValue" >= 0)
    AND ("discountDueDateLimitDays" IS NULL OR "discountDueDateLimitDays" >= 0)
  ),
  CONSTRAINT "ck_billing_agreement_validity" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom")
);

CREATE UNIQUE INDEX "uq_billing_agreement_conta_id" ON "BillingAgreement"("contaId", "id");
CREATE UNIQUE INDEX "uq_billing_agreement_conta_external_ref" ON "BillingAgreement"("contaId", "externalReference");
CREATE UNIQUE INDEX "uq_billing_agreement_conta_idempotency" ON "BillingAgreement"("contaId", "idempotencyKey");
CREATE UNIQUE INDEX "uq_billing_agreement_conta_asaas_subscription" ON "BillingAgreement"("contaId", "asaasSubscriptionId");
CREATE INDEX "idx_billing_agreement_conta_payer_status" ON "BillingAgreement"("contaId", "payerType", "payerId", "status");
CREATE INDEX "idx_billing_agreement_conta_customer_status" ON "BillingAgreement"("contaId", "customerId", "status");
CREATE INDEX "idx_billing_agreement_conta_status_due" ON "BillingAgreement"("contaId", "status", "nextDueDate");
CREATE INDEX "idx_billing_agreement_conta_validity" ON "BillingAgreement"("contaId", "validFrom", "validUntil");
CREATE INDEX "idx_billing_agreement_conta_group_status" ON "BillingAgreement"("contaId", "billingGroupKey", "status");

CREATE TABLE "BillingChangeOperation" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "sourceAgreementId" TEXT,
  "targetAgreementId" TEXT,
  "allocationId" TEXT,
  "type" "BillingChangeOperationType" NOT NULL,
  "status" "BillingChangeOperationStatus" NOT NULL DEFAULT 'PENDING',
  "uiRequestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "expectedVersion" INTEGER NOT NULL,
  "effectivePolicy" "BillingEffectivePolicy" NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "previewHash" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "previousAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "addedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "removedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "resultingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "requestPayload" JSONB NOT NULL,
  "result" JSONB,
  "correlationId" TEXT NOT NULL,
  "actorId" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "scheduledAppliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingChangeOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingChangeOperation_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingChangeOperation_sourceAgreementId_fkey"
    FOREIGN KEY ("contaId", "sourceAgreementId") REFERENCES "BillingAgreement"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingChangeOperation_targetAgreementId_fkey"
    FOREIGN KEY ("contaId", "targetAgreementId") REFERENCES "BillingAgreement"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ck_billing_change_operation_version" CHECK ("expectedVersion" >= 0),
  CONSTRAINT "ck_billing_change_operation_amounts" CHECK (
    "previousAmount" >= 0 AND "addedAmount" >= 0 AND "removedAmount" >= 0 AND "resultingAmount" >= 0
  )
);

CREATE UNIQUE INDEX "uq_billing_change_operation_conta_request" ON "BillingChangeOperation"("contaId", "uiRequestId");
CREATE UNIQUE INDEX "uq_billing_change_operation_conta_id" ON "BillingChangeOperation"("contaId", "id");
CREATE INDEX "idx_billing_change_operation_conta_queue" ON "BillingChangeOperation"("contaId", "status", "availableAt");
CREATE INDEX "idx_billing_change_operation_conta_source_status" ON "BillingChangeOperation"("contaId", "sourceAgreementId", "status", "createdAt");
CREATE INDEX "idx_billing_change_operation_conta_target_status" ON "BillingChangeOperation"("contaId", "targetAgreementId", "status", "createdAt");
CREATE INDEX "idx_billing_change_operation_conta_correlation" ON "BillingChangeOperation"("contaId", "correlationId");
CREATE UNIQUE INDEX "uq_billing_change_operation_active_source"
  ON "BillingChangeOperation"("contaId", "sourceAgreementId")
  WHERE "sourceAgreementId" IS NOT NULL AND "status" IN ('PENDING', 'PROCESSING', 'REQUIRES_RECONCILIATION');
CREATE UNIQUE INDEX "uq_billing_change_operation_active_target"
  ON "BillingChangeOperation"("contaId", "targetAgreementId")
  WHERE "targetAgreementId" IS NOT NULL AND "status" IN ('PENDING', 'PROCESSING', 'REQUIRES_RECONCILIATION');

CREATE TABLE "BillingAllocation" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "matriculaId" TEXT NOT NULL,
  "alunoId" TEXT NOT NULL,
  "sourceOperationId" TEXT,
  "sourceChargeId" TEXT,
  "kind" "BillingAllocationKind" NOT NULL,
  "status" "BillingAllocationStatus" NOT NULL DEFAULT 'SCHEDULED',
  "recurring" BOOLEAN NOT NULL DEFAULT true,
  "baseAmount" DECIMAL(12,2) NOT NULL,
  "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(12,2) NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "prorationPolicy" "BillingProrationPolicy" NOT NULL DEFAULT 'FULL_CURRENT_CYCLE',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingAllocation_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAllocation_agreementId_fkey"
    FOREIGN KEY ("contaId", "agreementId") REFERENCES "BillingAgreement"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAllocation_matriculaId_fkey"
    FOREIGN KEY ("contaId", "matriculaId") REFERENCES "Matricula"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAllocation_alunoId_fkey"
    FOREIGN KEY ("contaId", "alunoId") REFERENCES "Aluno"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAllocation_sourceOperationId_fkey"
    FOREIGN KEY ("contaId", "sourceOperationId") REFERENCES "BillingChangeOperation"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAllocation_sourceChargeId_fkey"
    FOREIGN KEY ("contaId", "sourceChargeId") REFERENCES "Charge"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ck_billing_allocation_amounts" CHECK (
    "baseAmount" >= 0 AND "discountAmount" >= 0 AND "discountAmount" <= "baseAmount" AND "netAmount" >= 0
  ),
  CONSTRAINT "ck_billing_allocation_validity" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom")
);

CREATE UNIQUE INDEX "uq_billing_allocation_conta_id" ON "BillingAllocation"("contaId", "id");
CREATE INDEX "idx_billing_allocation_conta_agreement_status_validity" ON "BillingAllocation"("contaId", "agreementId", "status", "validFrom", "validUntil");
CREATE INDEX "idx_billing_allocation_conta_matricula_kind_status" ON "BillingAllocation"("contaId", "matriculaId", "kind", "status");
CREATE INDEX "idx_billing_allocation_conta_aluno_status" ON "BillingAllocation"("contaId", "alunoId", "status");
CREATE INDEX "idx_billing_allocation_conta_source_operation" ON "BillingAllocation"("contaId", "sourceOperationId");
CREATE INDEX "idx_billing_allocation_conta_source_charge" ON "BillingAllocation"("contaId", "sourceChargeId");
-- One open version per enrollment/kind inside an agreement. Agreements sharing
-- billingGroupKey may each hold a partial allocation for different payers.
CREATE UNIQUE INDEX "uq_billing_allocation_open_enrollment_kind"
  ON "BillingAllocation"("contaId", "agreementId", "matriculaId", "kind")
  WHERE "status" IN ('ACTIVE', 'SCHEDULED') AND "validUntil" IS NULL;

ALTER TABLE "BillingChangeOperation"
  ADD CONSTRAINT "BillingChangeOperation_allocationId_fkey"
  FOREIGN KEY ("contaId", "allocationId") REFERENCES "BillingAllocation"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BillingAdjustment" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "operationId" TEXT,
  "allocationId" TEXT,
  "chargeId" TEXT,
  "type" "BillingAdjustmentType" NOT NULL,
  "status" "BillingAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(12,2) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "providerRefundId" TEXT,
  "result" JSONB,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingAdjustment_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAdjustment_agreementId_fkey"
    FOREIGN KEY ("contaId", "agreementId") REFERENCES "BillingAgreement"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAdjustment_operationId_fkey"
    FOREIGN KEY ("contaId", "operationId") REFERENCES "BillingChangeOperation"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAdjustment_allocationId_fkey"
    FOREIGN KEY ("contaId", "allocationId") REFERENCES "BillingAllocation"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingAdjustment_chargeId_fkey"
    FOREIGN KEY ("contaId", "chargeId") REFERENCES "Charge"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ck_billing_adjustment_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "uq_billing_adjustment_conta_idempotency" ON "BillingAdjustment"("contaId", "idempotencyKey");
CREATE UNIQUE INDEX "uq_billing_adjustment_conta_external_ref" ON "BillingAdjustment"("contaId", "externalReference");
CREATE INDEX "idx_billing_adjustment_conta_queue" ON "BillingAdjustment"("contaId", "status", "availableAt");
CREATE INDEX "idx_billing_adjustment_conta_agreement_status" ON "BillingAdjustment"("contaId", "agreementId", "status", "effectiveAt");
CREATE INDEX "idx_billing_adjustment_conta_operation" ON "BillingAdjustment"("contaId", "operationId");
CREATE INDEX "idx_billing_adjustment_conta_charge" ON "BillingAdjustment"("contaId", "chargeId");

CREATE TABLE "BillingPayerShare" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "agreementId" TEXT NOT NULL,
  "customerId" TEXT,
  "payerType" "CustomerPayerType" NOT NULL,
  "payerId" TEXT NOT NULL,
  "shareType" "BillingPayerShareType" NOT NULL,
  "percentage" DECIMAL(5,2),
  "fixedAmount" DECIMAL(12,2),
  "status" "BillingPayerShareStatus" NOT NULL DEFAULT 'ACTIVE',
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "roundingOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingPayerShare_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingPayerShare_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingPayerShare_agreementId_fkey"
    FOREIGN KEY ("contaId", "agreementId") REFERENCES "BillingAgreement"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingPayerShare_customerId_fkey"
    FOREIGN KEY ("contaId", "customerId") REFERENCES "Customer"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ck_billing_payer_share_value" CHECK (
    ("shareType" = 'PERCENTAGE' AND "percentage" > 0 AND "percentage" <= 100 AND "fixedAmount" IS NULL)
    OR
    ("shareType" = 'FIXED' AND "fixedAmount" > 0 AND "percentage" IS NULL)
  ),
  CONSTRAINT "ck_billing_payer_share_validity" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom")
);

CREATE UNIQUE INDEX "uq_billing_payer_share_conta_identity" ON "BillingPayerShare"("contaId", "agreementId", "payerType", "payerId", "validFrom");
CREATE INDEX "idx_billing_payer_share_conta_agreement_status" ON "BillingPayerShare"("contaId", "agreementId", "status", "validFrom", "validUntil");
CREATE INDEX "idx_billing_payer_share_conta_payer_status" ON "BillingPayerShare"("contaId", "payerType", "payerId", "status");
CREATE INDEX "idx_billing_payer_share_conta_customer" ON "BillingPayerShare"("contaId", "customerId");
CREATE UNIQUE INDEX "uq_billing_payer_share_one_active_per_agreement"
  ON "BillingPayerShare"("contaId", "agreementId")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "Subscription" ADD COLUMN "billingAgreementId" TEXT;
ALTER TABLE "StandaloneSubscription" ADD COLUMN "billingAgreementId" TEXT;
ALTER TABLE "FamilyFinancialAllocation" ADD COLUMN "billingAllocationId" TEXT;

CREATE UNIQUE INDEX "uq_subscription_billing_agreement" ON "Subscription"("contaId", "billingAgreementId");
CREATE INDEX "idx_subscription_conta_agreement" ON "Subscription"("contaId", "billingAgreementId");
CREATE UNIQUE INDEX "uq_standalone_subscription_billing_agreement" ON "StandaloneSubscription"("contaId", "billingAgreementId");
CREATE INDEX "idx_standalone_subscription_conta_agreement" ON "StandaloneSubscription"("contaId", "billingAgreementId");
CREATE UNIQUE INDEX "uq_family_fin_alloc_billing_allocation" ON "FamilyFinancialAllocation"("contaId", "billingAllocationId");
CREATE INDEX "idx_family_fin_alloc_conta_billing_allocation" ON "FamilyFinancialAllocation"("contaId", "billingAllocationId");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_billingAgreementId_fkey"
  FOREIGN KEY ("contaId", "billingAgreementId") REFERENCES "BillingAgreement"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StandaloneSubscription"
  ADD CONSTRAINT "StandaloneSubscription_billingAgreementId_fkey"
  FOREIGN KEY ("contaId", "billingAgreementId") REFERENCES "BillingAgreement"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyFinancialAllocation"
  ADD CONSTRAINT "FamilyFinancialAllocation_billingAllocationId_fkey"
  FOREIGN KEY ("contaId", "billingAllocationId") REFERENCES "BillingAllocation"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill individual subscriptions. The latest persisted final enrollment
-- amount wins over the catalog price. No provider call is made here.
INSERT INTO "BillingAgreement" (
  "id", "contaId", "customerId", "payerType", "payerId", "source", "status",
  "externalReference", "idempotencyKey", "billingGroupKey", "billingType", "cycle", "dueDay",
  "interestValue", "interestType", "fineValue", "fineType", "discountValue",
  "discountType", "discountDueDateLimitDays",
  "nextDueDate", "validFrom", "validUntil", "desiredValue", "confirmedValue",
  "asaasSubscriptionId", "remoteStatus", "remoteStatusUpdatedAt", "version",
  "createdAt", "updatedAt"
)
SELECT
  'ba_legacy_sub_' || md5(subscription."id"),
  subscription."contaId",
  customer."id",
  CASE WHEN matricula."responsavelFinanceiroId" IS NOT NULL
    THEN 'RESPONSAVEL'::"CustomerPayerType"
    ELSE 'ALUNO'::"CustomerPayerType"
  END,
  COALESCE(matricula."responsavelFinanceiroId", matricula."alunoId"),
  'LEGACY_SUBSCRIPTION'::"BillingAgreementSource",
  CASE subscription."status"
    WHEN 'REQUESTED' THEN 'PENDING_PROVISION'::"BillingAgreementStatus"
    WHEN 'ACTIVE' THEN 'ACTIVE'::"BillingAgreementStatus"
    WHEN 'INACTIVE' THEN 'INACTIVE'::"BillingAgreementStatus"
    WHEN 'EXPIRED' THEN 'INACTIVE'::"BillingAgreementStatus"
    WHEN 'DELETED' THEN 'CANCELLED'::"BillingAgreementStatus"
    ELSE 'FAILED'::"BillingAgreementStatus"
  END,
  'billing-agreement:legacy-subscription:' || subscription."id",
  'billing-agreement:legacy-subscription:' || subscription."id",
  'enrollment:' || matricula."id",
  CASE UPPER(COALESCE(matricula."formaPagamento"::TEXT, 'BOLETO'))
    WHEN 'CARTAO_CREDITO' THEN 'CREDIT_CARD'
    WHEN 'CARTAO' THEN 'CREDIT_CARD'
    WHEN 'CREDIT_CARD' THEN 'CREDIT_CARD'
    WHEN 'PIX' THEN 'PIX'
    WHEN 'BOLETO' THEN 'BOLETO'
    ELSE 'UNDEFINED'
  END,
  CASE UPPER(COALESCE(combo."periodicidade"::TEXT, plano."periodicidade"::TEXT, 'MENSAL'))
    WHEN 'SEMANAL' THEN 'WEEKLY'
    WHEN 'WEEKLY' THEN 'WEEKLY'
    WHEN 'QUINZENAL' THEN 'BIWEEKLY'
    WHEN 'BIWEEKLY' THEN 'BIWEEKLY'
    WHEN 'TRIMESTRAL' THEN 'QUARTERLY'
    WHEN 'QUARTERLY' THEN 'QUARTERLY'
    WHEN 'ANUAL' THEN 'YEARLY'
    WHEN 'YEARLY' THEN 'YEARLY'
    ELSE 'MONTHLY'
  END,
  CASE WHEN matricula."vencimentoDia" BETWEEN 1 AND 31 THEN matricula."vencimentoDia" ELSE NULL END,
  matricula."jurosMensal",
  matricula."jurosTipo",
  matricula."multaPercentual",
  matricula."multaTipo",
  matricula."descontoAntecipado",
  matricula."descontoTipo",
  GREATEST(COALESCE(matricula."prazoDesconto", 0), 0),
  next_charge."vencimento",
  matricula."dataInicio",
  matricula."dataFimContrato" + INTERVAL '1 day',
  COALESCE(discount."valorFinal", combo."valor", plano."valor", 0),
  CASE WHEN COALESCE(subscription."asaasSubscriptionId", matricula."asaasSubscriptionId") IS NOT NULL
      AND subscription."status" <> 'DELETED'
    THEN COALESCE(discount."valorFinal", combo."valor", plano."valor", 0)
    ELSE 0
  END,
  COALESCE(subscription."asaasSubscriptionId", matricula."asaasSubscriptionId"),
  subscription."status"::TEXT,
  subscription."statusUpdatedAt",
  GREATEST(matricula."version", 1),
  subscription."createdAt",
  CURRENT_TIMESTAMP
FROM "Subscription" subscription
JOIN "Matricula" matricula
  ON matricula."id" = subscription."matriculaId" AND matricula."contaId" = subscription."contaId"
LEFT JOIN "Plano" plano ON plano."id" = matricula."planoId" AND plano."contaId" = subscription."contaId"
LEFT JOIN "Combo" combo ON combo."id" = matricula."comboId" AND combo."contaId" = subscription."contaId"
LEFT JOIN LATERAL (
  SELECT MIN(enrollment_discount."valorFinal") AS "valorFinal"
  FROM "DescontoMatricula" enrollment_discount
  WHERE enrollment_discount."matriculaId" = matricula."id"
) discount ON TRUE
LEFT JOIN LATERAL (
  SELECT charge."vencimento"
  FROM "Cobranca" charge
  WHERE charge."contaId" = subscription."contaId"
    AND charge."matriculaId" = matricula."id"
    AND charge."tipo" IN ('MENSALIDADE', 'RECORRENTE')
    AND charge."status" IN ('A_VENCER', 'PENDENTE', 'PROCESSANDO', 'ATRASADO')
  ORDER BY charge."vencimento" ASC
  LIMIT 1
) next_charge ON TRUE
LEFT JOIN "Customer" customer
  ON customer."contaId" = subscription."contaId"
  AND customer."payerType" = CASE WHEN matricula."responsavelFinanceiroId" IS NOT NULL
    THEN 'RESPONSAVEL'::"CustomerPayerType"
    ELSE 'ALUNO'::"CustomerPayerType"
  END
  AND customer."payerId" = COALESCE(matricula."responsavelFinanceiroId", matricula."alunoId")
ON CONFLICT DO NOTHING;

UPDATE "Subscription" subscription
SET "billingAgreementId" = (
  SELECT agreement."id"
  FROM "BillingAgreement" agreement
  WHERE agreement."contaId" = subscription."contaId"
    AND (
      agreement."externalReference" = 'billing-agreement:legacy-subscription:' || subscription."id"
      OR (
        subscription."asaasSubscriptionId" IS NOT NULL
        AND agreement."asaasSubscriptionId" = subscription."asaasSubscriptionId"
      )
    )
  ORDER BY CASE
    WHEN agreement."externalReference" = 'billing-agreement:legacy-subscription:' || subscription."id" THEN 0
    ELSE 1
  END
  LIMIT 1
)
WHERE subscription."billingAgreementId" IS NULL;

-- Backfill standalone subscriptions, including family agreements. A provider
-- id already claimed by the individual representation reuses that agreement.
INSERT INTO "BillingAgreement" (
  "id", "contaId", "customerId", "payerType", "payerId", "source", "status",
  "externalReference", "idempotencyKey", "billingGroupKey", "billingType", "cycle", "dueDay",
  "nextDueDate", "validFrom", "validUntil", "desiredValue", "confirmedValue",
  "asaasSubscriptionId", "remoteStatus", "remoteStatusUpdatedAt", "version",
  "createdAt", "updatedAt"
)
SELECT
  'ba_legacy_standalone_' || md5(subscription."id"),
  subscription."contaId",
  customer."id",
  customer."payerType",
  customer."payerId",
  'LEGACY_STANDALONE_SUBSCRIPTION'::"BillingAgreementSource",
  CASE subscription."status"
    WHEN 'REQUESTED' THEN 'PENDING_PROVISION'::"BillingAgreementStatus"
    WHEN 'ACTIVE' THEN 'ACTIVE'::"BillingAgreementStatus"
    WHEN 'INACTIVE' THEN 'INACTIVE'::"BillingAgreementStatus"
    WHEN 'EXPIRED' THEN 'INACTIVE'::"BillingAgreementStatus"
    WHEN 'DELETED' THEN 'CANCELLED'::"BillingAgreementStatus"
    ELSE 'FAILED'::"BillingAgreementStatus"
  END,
  'billing-agreement:legacy-standalone:' || subscription."id",
  'billing-agreement:legacy-standalone:' || subscription."id",
  CASE WHEN subscription."familyGroupId" IS NOT NULL
    THEN 'family:' || subscription."familyGroupId"
    ELSE 'standalone:' || subscription."id"
  END,
  CASE UPPER(subscription."billingType")
    WHEN 'CARTAO_CREDITO' THEN 'CREDIT_CARD'
    WHEN 'CARTAO' THEN 'CREDIT_CARD'
    WHEN 'CREDIT_CARD' THEN 'CREDIT_CARD'
    WHEN 'PIX' THEN 'PIX'
    WHEN 'BOLETO' THEN 'BOLETO'
    ELSE 'UNDEFINED'
  END,
  CASE UPPER(subscription."cycle")
    WHEN 'SEMANAL' THEN 'WEEKLY'
    WHEN 'WEEKLY' THEN 'WEEKLY'
    WHEN 'QUINZENAL' THEN 'BIWEEKLY'
    WHEN 'BIWEEKLY' THEN 'BIWEEKLY'
    WHEN 'TRIMESTRAL' THEN 'QUARTERLY'
    WHEN 'QUARTERLY' THEN 'QUARTERLY'
    WHEN 'ANUAL' THEN 'YEARLY'
    WHEN 'YEARLY' THEN 'YEARLY'
    ELSE 'MONTHLY'
  END,
  EXTRACT(DAY FROM subscription."nextDueDate")::INTEGER,
  subscription."nextDueDate",
  COALESCE(subscription."validFrom", subscription."createdAt"),
  CASE
    WHEN subscription."validUntil" IS NOT NULL THEN subscription."validUntil" + INTERVAL '1 day'
    WHEN subscription."endDate" IS NOT NULL THEN subscription."endDate" + INTERVAL '1 day'
    ELSE NULL
  END,
  subscription."value",
  CASE WHEN subscription."asaasSubscriptionId" IS NOT NULL AND subscription."status" <> 'DELETED'
    THEN subscription."value"
    ELSE 0
  END,
  subscription."asaasSubscriptionId",
  COALESCE(subscription."remoteStatus", subscription."status"::TEXT),
  COALESCE(subscription."remoteStatusUpdatedAt", subscription."statusUpdatedAt"),
  GREATEST(subscription."version", 1),
  subscription."createdAt",
  CURRENT_TIMESTAMP
FROM "StandaloneSubscription" subscription
JOIN "Customer" customer
  ON customer."id" = subscription."customerId" AND customer."contaId" = subscription."contaId"
ON CONFLICT DO NOTHING;

UPDATE "StandaloneSubscription" subscription
SET "billingAgreementId" = (
  SELECT agreement."id"
  FROM "BillingAgreement" agreement
  WHERE agreement."contaId" = subscription."contaId"
    AND (
      agreement."externalReference" = 'billing-agreement:legacy-standalone:' || subscription."id"
      OR (
        subscription."asaasSubscriptionId" IS NOT NULL
        AND agreement."asaasSubscriptionId" = subscription."asaasSubscriptionId"
      )
    )
  ORDER BY CASE
    WHEN agreement."externalReference" = 'billing-agreement:legacy-standalone:' || subscription."id" THEN 0
    ELSE 1
  END
  LIMIT 1
)
WHERE subscription."billingAgreementId" IS NULL;

-- A historical family allocation may predate either subscription table. It
-- receives a synthetic, local-only agreement so no enrollment value is lost.
WITH unresolved AS (
  SELECT
    allocation."contaId",
    COALESCE(
      allocation."familyGroupId",
      allocation."sourceAgreementId",
      allocation."standaloneSubscriptionId",
      allocation."id"
    ) AS group_key,
    COALESCE(allocation."matriculaId", allocation."sourceMatriculaId") AS matricula_id,
    allocation."alunoId",
    allocation."amount",
    allocation."chargeKind",
    allocation."status",
    allocation."competenceStart",
    allocation."competenceEnd"
  FROM "FamilyFinancialAllocation" allocation
  LEFT JOIN "MatriculaFamiliar" family_source
    ON family_source."contaId" = allocation."contaId"
    AND family_source."id" = allocation."familyGroupId"
  LEFT JOIN "Subscription" individual
    ON individual."contaId" = allocation."contaId"
    AND individual."id" = allocation."sourceAgreementId"
  LEFT JOIN "StandaloneSubscription" standalone
    ON standalone."contaId" = allocation."contaId"
    AND (
      standalone."id" = allocation."standaloneSubscriptionId"
      OR standalone."id" = allocation."sourceAgreementId"
      OR standalone."id" = family_source."standaloneSubscriptionId"
    )
  WHERE individual."billingAgreementId" IS NULL
    AND standalone."billingAgreementId" IS NULL
), grouped AS (
  SELECT
    unresolved."contaId",
    unresolved.group_key,
    MIN(unresolved.matricula_id) AS matricula_id,
    MIN(unresolved."alunoId") AS aluno_id,
    MIN(unresolved."competenceStart") AS valid_from,
    MAX(unresolved."competenceEnd") + INTERVAL '1 day' AS valid_until,
    COALESCE(SUM(unresolved."amount") FILTER (
      WHERE unresolved."chargeKind" = 'MENSALIDADE'
        AND unresolved."status" NOT IN ('CANCELLED', 'CANCELED')
        AND unresolved."competenceStart" <= CURRENT_TIMESTAMP
        AND (unresolved."competenceEnd" IS NULL OR unresolved."competenceEnd" >= CURRENT_DATE)
    ), 0) AS desired_value
  FROM unresolved
  GROUP BY unresolved."contaId", unresolved.group_key
)
INSERT INTO "BillingAgreement" (
  "id", "contaId", "customerId", "payerType", "payerId", "source", "status",
  "externalReference", "idempotencyKey", "billingGroupKey", "billingType", "cycle", "dueDay",
  "interestValue", "interestType", "fineValue", "fineType", "discountValue",
  "discountType", "discountDueDateLimitDays",
  "nextDueDate", "validFrom", "validUntil", "desiredValue", "confirmedValue",
  "version", "createdAt", "updatedAt"
)
SELECT
  'ba_legacy_family_' || md5(grouped."contaId" || ':' || grouped.group_key),
  grouped."contaId",
  customer."id",
  CASE WHEN COALESCE(family."responsavelId", matricula."responsavelFinanceiroId") IS NOT NULL
    THEN 'RESPONSAVEL'::"CustomerPayerType"
    ELSE 'ALUNO'::"CustomerPayerType"
  END,
  COALESCE(family."responsavelId", matricula."responsavelFinanceiroId", grouped.aluno_id),
  'LEGACY_FAMILY_ALLOCATION'::"BillingAgreementSource",
  'PENDING_PROVISION'::"BillingAgreementStatus",
  'billing-agreement:legacy-family:' || grouped.group_key,
  'billing-agreement:legacy-family:' || grouped.group_key,
  'family:' || grouped.group_key,
  CASE UPPER(COALESCE(family."formaPagamento", matricula."formaPagamento"::TEXT, 'BOLETO'))
    WHEN 'CARTAO_CREDITO' THEN 'CREDIT_CARD'
    WHEN 'CARTAO' THEN 'CREDIT_CARD'
    WHEN 'CREDIT_CARD' THEN 'CREDIT_CARD'
    WHEN 'PIX' THEN 'PIX'
    WHEN 'BOLETO' THEN 'BOLETO'
    ELSE 'UNDEFINED'
  END,
  CASE UPPER(COALESCE(family."ciclo", combo."periodicidade"::TEXT, plano."periodicidade"::TEXT, 'MENSAL'))
    WHEN 'SEMANAL' THEN 'WEEKLY'
    WHEN 'WEEKLY' THEN 'WEEKLY'
    WHEN 'QUINZENAL' THEN 'BIWEEKLY'
    WHEN 'BIWEEKLY' THEN 'BIWEEKLY'
    WHEN 'TRIMESTRAL' THEN 'QUARTERLY'
    WHEN 'QUARTERLY' THEN 'QUARTERLY'
    WHEN 'ANUAL' THEN 'YEARLY'
    WHEN 'YEARLY' THEN 'YEARLY'
    ELSE 'MONTHLY'
  END,
  CASE
    WHEN family."diaVencimento" BETWEEN 1 AND 31 THEN family."diaVencimento"
    WHEN matricula."vencimentoDia" BETWEEN 1 AND 31 THEN matricula."vencimentoDia"
    ELSE NULL
  END,
  matricula."jurosMensal",
  matricula."jurosTipo",
  matricula."multaPercentual",
  matricula."multaTipo",
  matricula."descontoAntecipado",
  matricula."descontoTipo",
  GREATEST(COALESCE(matricula."prazoDesconto", 0), 0),
  NULL::TIMESTAMP,
  grouped.valid_from,
  grouped.valid_until,
  grouped.desired_value,
  0,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM grouped
LEFT JOIN "Matricula" matricula
  ON matricula."id" = grouped.matricula_id AND matricula."contaId" = grouped."contaId"
LEFT JOIN "MatriculaFamiliar" family
  ON family."id" = grouped.group_key AND family."contaId" = grouped."contaId"
LEFT JOIN "Plano" plano ON plano."id" = matricula."planoId" AND plano."contaId" = grouped."contaId"
LEFT JOIN "Combo" combo ON combo."id" = matricula."comboId" AND combo."contaId" = grouped."contaId"
LEFT JOIN "Customer" customer
  ON customer."contaId" = grouped."contaId"
  AND customer."payerType" = CASE WHEN COALESCE(family."responsavelId", matricula."responsavelFinanceiroId") IS NOT NULL
    THEN 'RESPONSAVEL'::"CustomerPayerType"
    ELSE 'ALUNO'::"CustomerPayerType"
  END
  AND customer."payerId" = COALESCE(family."responsavelId", matricula."responsavelFinanceiroId", grouped.aluno_id)
ON CONFLICT DO NOTHING;

-- Base allocation of each legacy individual subscription.
INSERT INTO "BillingAllocation" (
  "id", "contaId", "agreementId", "matriculaId", "alunoId", "kind", "status",
  "sourceChargeId", "recurring", "baseAmount", "discountAmount", "netAmount", "validFrom",
  "validUntil", "prorationPolicy", "metadata", "createdAt", "updatedAt"
)
SELECT
  'bal_legacy_sub_' || md5(subscription."id"),
  subscription."contaId",
  subscription."billingAgreementId",
  matricula."id",
  matricula."alunoId",
  'TUITION'::"BillingAllocationKind",
  CASE
    WHEN subscription."status" = 'DELETED' THEN 'CANCELLED'::"BillingAllocationStatus"
    WHEN subscription."status" = 'EXPIRED' THEN 'ENDED'::"BillingAllocationStatus"
    WHEN subscription."status" = 'INACTIVE' AND matricula."pausaAtiva" = true THEN 'PAUSED'::"BillingAllocationStatus"
    WHEN subscription."status" IN ('ACTIVE', 'INACTIVE') THEN 'ACTIVE'::"BillingAllocationStatus"
    ELSE 'SCHEDULED'::"BillingAllocationStatus"
  END,
  NULL,
  true,
  COALESCE(combo."valor", plano."valor", discount."valorFinal", 0),
  GREATEST(COALESCE(combo."valor", plano."valor", discount."valorFinal", 0) - COALESCE(discount."valorFinal", combo."valor", plano."valor", 0), 0),
  COALESCE(discount."valorFinal", combo."valor", plano."valor", 0),
  matricula."dataInicio",
  matricula."dataFimContrato" + INTERVAL '1 day',
  'FULL_CURRENT_CYCLE'::"BillingProrationPolicy",
  jsonb_build_object('legacySubscriptionId', subscription."id", 'backfilled', true),
  subscription."createdAt",
  CURRENT_TIMESTAMP
FROM "Subscription" subscription
JOIN "Matricula" matricula
  ON matricula."id" = subscription."matriculaId" AND matricula."contaId" = subscription."contaId"
LEFT JOIN "Plano" plano ON plano."id" = matricula."planoId" AND plano."contaId" = subscription."contaId"
LEFT JOIN "Combo" combo ON combo."id" = matricula."comboId" AND combo."contaId" = subscription."contaId"
LEFT JOIN LATERAL (
  SELECT MIN(enrollment_discount."valorFinal") AS "valorFinal"
  FROM "DescontoMatricula" enrollment_discount
  WHERE enrollment_discount."matriculaId" = matricula."id"
) discount ON TRUE
WHERE subscription."billingAgreementId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Enrollment fees stay outside the recurring subscription value, but remain
-- explicitly attached to the canonical agreement and to their local Charge.
INSERT INTO "BillingAllocation" (
  "id", "contaId", "agreementId", "matriculaId", "alunoId", "kind", "status",
  "sourceChargeId", "recurring", "baseAmount", "discountAmount", "netAmount",
  "validFrom", "validUntil", "prorationPolicy", "metadata", "createdAt", "updatedAt"
)
SELECT
  'bal_legacy_fee_' || md5(enrollment_charge."id"),
  enrollment_charge."contaId",
  subscription."billingAgreementId",
  matricula."id",
  matricula."alunoId",
  'ENROLLMENT_FEE'::"BillingAllocationKind",
  CASE
    WHEN enrollment_charge."status" = 'CANCELADO' THEN 'CANCELLED'::"BillingAllocationStatus"
    WHEN enrollment_charge."status" IN ('PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL') THEN 'ENDED'::"BillingAllocationStatus"
    ELSE 'ACTIVE'::"BillingAllocationStatus"
  END,
  local_charge."id",
  false,
  enrollment_charge."valor",
  GREATEST(enrollment_charge."valor" - COALESCE(enrollment_charge."valorFinal", enrollment_charge."valor"), 0),
  COALESCE(enrollment_charge."valorFinal", enrollment_charge."valor"),
  enrollment_charge."competenciaInicio",
  enrollment_charge."competenciaFim" + INTERVAL '1 day',
  'MANUAL'::"BillingProrationPolicy",
  jsonb_build_object('legacyCobrancaId', enrollment_charge."id", 'backfilled', true),
  enrollment_charge."createdAt",
  CURRENT_TIMESTAMP
FROM "Cobranca" enrollment_charge
JOIN "Matricula" matricula
  ON matricula."contaId" = enrollment_charge."contaId"
  AND matricula."id" = enrollment_charge."matriculaId"
JOIN "Subscription" subscription
  ON subscription."contaId" = enrollment_charge."contaId"
  AND subscription."matriculaId" = enrollment_charge."matriculaId"
  AND subscription."billingAgreementId" IS NOT NULL
LEFT JOIN "Charge" local_charge
  ON local_charge."contaId" = enrollment_charge."contaId"
  AND local_charge."cobrancaId" = enrollment_charge."id"
WHERE enrollment_charge."tipo" = 'TAXA_MATRICULA'
ON CONFLICT DO NOTHING;

-- Every legacy family allocation with an enrollment becomes a canonical
-- allocation. Several matriculas of the same aluno are intentionally allowed.
WITH resolved AS (
  SELECT
    allocation.*,
    COALESCE(allocation."matriculaId", allocation."sourceMatriculaId") AS resolved_matricula_id,
    COALESCE(
      individual."billingAgreementId",
      standalone."billingAgreementId",
      'ba_legacy_family_' || md5(
        allocation."contaId" || ':' || COALESCE(
          allocation."familyGroupId",
          allocation."sourceAgreementId",
          allocation."standaloneSubscriptionId",
          allocation."id"
        )
      )
    ) AS resolved_agreement_id
  FROM "FamilyFinancialAllocation" allocation
  LEFT JOIN "MatriculaFamiliar" family_source
    ON family_source."contaId" = allocation."contaId"
    AND family_source."id" = allocation."familyGroupId"
  LEFT JOIN "Subscription" individual
    ON individual."contaId" = allocation."contaId"
    AND individual."id" = allocation."sourceAgreementId"
  LEFT JOIN "StandaloneSubscription" standalone
    ON standalone."contaId" = allocation."contaId"
    AND (
      standalone."id" = allocation."standaloneSubscriptionId"
      OR standalone."id" = allocation."sourceAgreementId"
      OR standalone."id" = family_source."standaloneSubscriptionId"
    )
)
INSERT INTO "BillingAllocation" (
  "id", "contaId", "agreementId", "matriculaId", "alunoId", "kind", "status",
  "sourceChargeId", "recurring", "baseAmount", "discountAmount", "netAmount", "validFrom",
  "validUntil", "prorationPolicy", "metadata", "createdAt", "updatedAt"
)
SELECT
  'bal_legacy_family_' || md5(resolved."id"),
  resolved."contaId",
  resolved.resolved_agreement_id,
  resolved.resolved_matricula_id,
  resolved."alunoId",
  CASE resolved."chargeKind"
    WHEN 'MENSALIDADE' THEN 'TUITION'::"BillingAllocationKind"
    WHEN 'TAXA_MATRICULA' THEN 'ENROLLMENT_FEE'::"BillingAllocationKind"
    WHEN 'MATERIAL' THEN 'MATERIAL'::"BillingAllocationKind"
    ELSE 'ADJUSTMENT'::"BillingAllocationKind"
  END,
  CASE
    WHEN resolved."status" IN ('CANCELLED', 'CANCELED') THEN 'CANCELLED'::"BillingAllocationStatus"
    WHEN resolved."competenceEnd" IS NOT NULL AND resolved."competenceEnd" < CURRENT_DATE THEN 'ENDED'::"BillingAllocationStatus"
    WHEN resolved."competenceStart" > CURRENT_TIMESTAMP THEN 'SCHEDULED'::"BillingAllocationStatus"
    WHEN resolved."status" = 'PAUSED' THEN 'PAUSED'::"BillingAllocationStatus"
    WHEN resolved."status" = 'ACTIVE' THEN 'ACTIVE'::"BillingAllocationStatus"
    ELSE 'SCHEDULED'::"BillingAllocationStatus"
  END,
  resolved."sourceChargeId",
  resolved."chargeKind" = 'MENSALIDADE',
  COALESCE(resolved."baseAmount", resolved."amount"),
  LEAST(
    COALESCE(resolved."discountAmount", 0),
    COALESCE(resolved."baseAmount", resolved."amount")
  ),
  resolved."amount",
  resolved."competenceStart",
  resolved."competenceEnd" + INTERVAL '1 day',
  'FULL_CURRENT_CYCLE'::"BillingProrationPolicy",
  COALESCE(resolved."metadata", '{}'::JSONB) || jsonb_build_object('legacyFamilyAllocationId', resolved."id", 'backfilled', true),
  resolved."createdAt",
  CURRENT_TIMESTAMP
FROM resolved
JOIN "BillingAgreement" agreement
  ON agreement."id" = resolved.resolved_agreement_id AND agreement."contaId" = resolved."contaId"
JOIN "Matricula" matricula
  ON matricula."id" = resolved.resolved_matricula_id AND matricula."contaId" = resolved."contaId"
WHERE resolved.resolved_matricula_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE "FamilyFinancialAllocation" allocation
SET "billingAllocationId" = canonical."id"
FROM "BillingAllocation" canonical
WHERE allocation."billingAllocationId" IS NULL
  AND canonical."contaId" = allocation."contaId"
  AND canonical."id" = 'bal_legacy_family_' || md5(allocation."id");

-- A single-payer legacy agreement starts with a 100% share. Multi-payer
-- agreements can add further dated versions through normal operations.
INSERT INTO "BillingPayerShare" (
  "id", "contaId", "agreementId", "customerId", "payerType", "payerId",
  "shareType", "percentage", "status", "validFrom", "validUntil",
  "roundingOrder", "createdAt", "updatedAt"
)
SELECT
  'bps_legacy_' || md5(agreement."id"),
  agreement."contaId",
  agreement."id",
  agreement."customerId",
  agreement."payerType",
  agreement."payerId",
  'PERCENTAGE'::"BillingPayerShareType",
  100,
  CASE WHEN agreement."status" = 'CANCELLED'
    THEN 'ENDED'::"BillingPayerShareStatus"
    ELSE 'ACTIVE'::"BillingPayerShareStatus"
  END,
  agreement."validFrom",
  agreement."validUntil",
  0,
  agreement."createdAt",
  CURRENT_TIMESTAMP
FROM "BillingAgreement" agreement
ON CONFLICT DO NOTHING;

-- Once allocations exist, their active recurring sum is the desired state.
-- Agreements without enrollment allocations retain their legacy value.
WITH totals AS (
  SELECT allocation."contaId", allocation."agreementId", SUM(allocation."netAmount") AS amount
  FROM "BillingAllocation" allocation
  WHERE allocation."recurring" = true
    AND allocation."status" IN ('ACTIVE', 'SCHEDULED')
    AND allocation."validFrom" <= CURRENT_TIMESTAMP
    AND (allocation."validUntil" IS NULL OR allocation."validUntil" > CURRENT_TIMESTAMP)
  GROUP BY allocation."contaId", allocation."agreementId"
)
UPDATE "BillingAgreement" agreement
SET
  "desiredValue" = totals.amount,
  "updatedAt" = CURRENT_TIMESTAMP
FROM totals
WHERE agreement."contaId" = totals."contaId" AND agreement."id" = totals."agreementId";

-- Operational RLS: all canonical models use the same tenant context as the
-- rest of the ERP. Financial history cannot be deleted through tenant cascades.
ALTER TABLE "BillingAgreement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingAgreement"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

ALTER TABLE "BillingAllocation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingAllocation"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

ALTER TABLE "BillingChangeOperation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingChangeOperation"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

ALTER TABLE "BillingAdjustment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingAdjustment"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

ALTER TABLE "BillingPayerShare" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BillingPayerShare"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());
