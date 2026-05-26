-- CreateEnum
CREATE TYPE "FinanceReconciliationEntityType" AS ENUM ('PAYMENT', 'CHARGE', 'SUBSCRIPTION', 'INSTALLMENT_PLAN', 'TRANSFER', 'WEBHOOK', 'ASAAS_ACCOUNT');

-- CreateEnum
CREATE TYPE "FinanceReconciliationIssueType" AS ENUM ('PAYMENT_STATUS_DRIFT', 'PAYMENT_MISSING_LOCAL_ENTITY', 'PAYMENT_NEEDS_REVIEW', 'SUBSCRIPTION_STATUS_DRIFT', 'TRANSFER_STATUS_DRIFT', 'WEBHOOK_LAG', 'WEBHOOK_DROPPED_RISK', 'WEBHOOK_CONFIG_DRIFT');

-- CreateEnum
CREATE TYPE "FinanceReconciliationIssueSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "FinanceReconciliationIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "FinanceReconciliationIssue" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "entityType" "FinanceReconciliationEntityType" NOT NULL,
    "entityId" TEXT,
    "asaasId" TEXT,
    "issueType" "FinanceReconciliationIssueType" NOT NULL,
    "severity" "FinanceReconciliationIssueSeverity" NOT NULL,
    "status" "FinanceReconciliationIssueStatus" NOT NULL DEFAULT 'OPEN',
    "dedupeKey" TEXT NOT NULL,
    "localStatus" TEXT,
    "remoteStatus" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "metadata" JSONB,

    CONSTRAINT "FinanceReconciliationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookJobLock" (
    "jobName" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "workerId" TEXT NOT NULL,
    "lastHeartbeatAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookJobLock_pkey" PRIMARY KEY ("jobName")
);

-- CreateIndex
CREATE INDEX "idx_fin_recon_issue_dashboard" ON "FinanceReconciliationIssue"("contaId", "status", "severity", "detectedAt");

-- CreateIndex
CREATE INDEX "idx_fin_recon_issue_type_status" ON "FinanceReconciliationIssue"("contaId", "issueType", "status");

-- CreateIndex
CREATE INDEX "idx_fin_recon_issue_entity" ON "FinanceReconciliationIssue"("contaId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "idx_fin_recon_issue_asaas" ON "FinanceReconciliationIssue"("contaId", "asaasId");

-- CreateIndex
CREATE INDEX "idx_fin_recon_issue_global_status" ON "FinanceReconciliationIssue"("status", "severity", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceReconciliationIssue_contaId_dedupeKey_key" ON "FinanceReconciliationIssue"("contaId", "dedupeKey");

-- CreateIndex
CREATE INDEX "idx_webhook_job_lock_until" ON "WebhookJobLock"("lockedUntil");

-- CreateIndex
CREATE INDEX "idx_webhook_job_lock_worker" ON "WebhookJobLock"("workerId");

-- AddForeignKey
ALTER TABLE "FinanceReconciliationIssue" ADD CONSTRAINT "FinanceReconciliationIssue_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
