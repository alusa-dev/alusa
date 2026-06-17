-- Camada operacional para reduzir polling no Asaas e materializar leituras críticas.

CREATE TABLE "AsaasCustomerSnapshot" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "asaasCustomerId" TEXT NOT NULL,
    "localCustomerId" TEXT,
    "payerType" TEXT,
    "payerId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobilePhone" TEXT,
    "cpfCnpj" TEXT,
    "personType" TEXT,
    "externalReference" TEXT,
    "notificationDisabled" BOOLEAN,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasCustomerSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceSubscriptionReadModel" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "localCustomerId" TEXT,
    "asaasCustomerId" TEXT,
    "asaasSubscriptionId" TEXT,
    "payerName" TEXT,
    "status" TEXT NOT NULL,
    "billingType" TEXT,
    "cycle" TEXT,
    "value" DECIMAL(12,2),
    "nextDueDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "description" TEXT,
    "familyGroupId" TEXT,
    "matriculaId" TEXT,
    "contratoId" TEXT,
    "alunoId" TEXT,
    "remoteDeleted" BOOLEAN NOT NULL DEFAULT false,
    "lastRemoteSyncAt" TIMESTAMP(3),
    "raw" JSONB,
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSubscriptionReadModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceInstallmentPlanReadModel" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "localCustomerId" TEXT,
    "asaasCustomerId" TEXT,
    "asaasInstallmentId" TEXT,
    "payerName" TEXT,
    "status" TEXT NOT NULL,
    "billingType" TEXT,
    "value" DECIMAL(12,2),
    "installmentCount" INTEGER,
    "firstDueDate" TIMESTAMP(3),
    "description" TEXT,
    "familyGroupId" TEXT,
    "matriculaId" TEXT,
    "contratoId" TEXT,
    "alunoId" TEXT,
    "remoteDeleted" BOOLEAN NOT NULL DEFAULT false,
    "lastRemoteSyncAt" TIMESTAMP(3),
    "raw" JSONB,
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceInstallmentPlanReadModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AsaasNotificationPreferenceOutbox" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "asaasCustomerId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasNotificationPreferenceOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceDailyAggregate" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "debitAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditCount" INTEGER NOT NULL DEFAULT 0,
    "debitCount" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'FINANCIAL_TRANSACTION_SNAPSHOT',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceDailyAggregate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceMonthlyAggregate" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "creditAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "debitAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditCount" INTEGER NOT NULL DEFAULT 0,
    "debitCount" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'FINANCIAL_TRANSACTION_SNAPSHOT',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceMonthlyAggregate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialOperationalAlert" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metricValue" INTEGER,
    "threshold" INTEGER,
    "metadata" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialOperationalAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_asaas_customer_snapshot_conta_asaas" ON "AsaasCustomerSnapshot"("contaId", "asaasCustomerId");
CREATE INDEX "idx_asaas_customer_snapshot_conta_fetched" ON "AsaasCustomerSnapshot"("contaId", "fetchedAt");
CREATE INDEX "idx_asaas_customer_snapshot_conta_deleted" ON "AsaasCustomerSnapshot"("contaId", "deleted");
CREATE INDEX "idx_asaas_customer_snapshot_conta_local" ON "AsaasCustomerSnapshot"("contaId", "localCustomerId");
CREATE INDEX "idx_asaas_customer_snapshot_asaas" ON "AsaasCustomerSnapshot"("asaasCustomerId");

CREATE UNIQUE INDEX "uq_fin_subscription_rm_source" ON "FinanceSubscriptionReadModel"("contaId", "sourceKind", "sourceId");
CREATE INDEX "idx_fin_subscription_rm_conta_status_due" ON "FinanceSubscriptionReadModel"("contaId", "status", "nextDueDate");
CREATE INDEX "idx_fin_subscription_rm_conta_asaas" ON "FinanceSubscriptionReadModel"("contaId", "asaasSubscriptionId");
CREATE INDEX "idx_fin_subscription_rm_conta_customer" ON "FinanceSubscriptionReadModel"("contaId", "localCustomerId");
CREATE INDEX "idx_fin_subscription_rm_conta_matricula" ON "FinanceSubscriptionReadModel"("contaId", "matriculaId");
CREATE INDEX "idx_fin_subscription_rm_conta_family" ON "FinanceSubscriptionReadModel"("contaId", "familyGroupId");
CREATE INDEX "idx_fin_subscription_rm_conta_projected" ON "FinanceSubscriptionReadModel"("contaId", "projectedAt");

CREATE UNIQUE INDEX "uq_fin_installment_rm_source" ON "FinanceInstallmentPlanReadModel"("contaId", "sourceKind", "sourceId");
CREATE INDEX "idx_fin_installment_rm_conta_status_due" ON "FinanceInstallmentPlanReadModel"("contaId", "status", "firstDueDate");
CREATE INDEX "idx_fin_installment_rm_conta_asaas" ON "FinanceInstallmentPlanReadModel"("contaId", "asaasInstallmentId");
CREATE INDEX "idx_fin_installment_rm_conta_customer" ON "FinanceInstallmentPlanReadModel"("contaId", "localCustomerId");
CREATE INDEX "idx_fin_installment_rm_conta_matricula" ON "FinanceInstallmentPlanReadModel"("contaId", "matriculaId");
CREATE INDEX "idx_fin_installment_rm_conta_family" ON "FinanceInstallmentPlanReadModel"("contaId", "familyGroupId");
CREATE INDEX "idx_fin_installment_rm_conta_projected" ON "FinanceInstallmentPlanReadModel"("contaId", "projectedAt");

CREATE UNIQUE INDEX "uq_asaas_notif_outbox_conta_dedupe" ON "AsaasNotificationPreferenceOutbox"("contaId", "dedupeKey");
CREATE INDEX "idx_asaas_notif_outbox_status_next" ON "AsaasNotificationPreferenceOutbox"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "idx_asaas_notif_outbox_conta_status_next" ON "AsaasNotificationPreferenceOutbox"("contaId", "status", "nextAttemptAt");
CREATE INDEX "idx_asaas_notif_outbox_conta_customer" ON "AsaasNotificationPreferenceOutbox"("contaId", "asaasCustomerId");

CREATE UNIQUE INDEX "uq_fin_daily_aggregate_conta_day" ON "FinanceDailyAggregate"("contaId", "day");
CREATE INDEX "idx_fin_daily_aggregate_conta_day" ON "FinanceDailyAggregate"("contaId", "day");
CREATE INDEX "idx_fin_daily_aggregate_conta_calculated" ON "FinanceDailyAggregate"("contaId", "calculatedAt");

CREATE UNIQUE INDEX "uq_fin_monthly_aggregate_conta_month" ON "FinanceMonthlyAggregate"("contaId", "month");
CREATE INDEX "idx_fin_monthly_aggregate_conta_start" ON "FinanceMonthlyAggregate"("contaId", "periodStart");
CREATE INDEX "idx_fin_monthly_aggregate_conta_calculated" ON "FinanceMonthlyAggregate"("contaId", "calculatedAt");

CREATE UNIQUE INDEX "uq_fin_operational_alert_conta_key" ON "FinancialOperationalAlert"("contaId", "alertKey");
CREATE INDEX "idx_fin_operational_alert_conta_status" ON "FinancialOperationalAlert"("contaId", "status", "severity");
CREATE INDEX "idx_fin_operational_alert_status_seen" ON "FinancialOperationalAlert"("status", "lastSeenAt");

ALTER TABLE "AsaasCustomerSnapshot" ADD CONSTRAINT "AsaasCustomerSnapshot_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AsaasCustomerSnapshot" ADD CONSTRAINT "AsaasCustomerSnapshot_localCustomerId_fkey" FOREIGN KEY ("localCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinanceSubscriptionReadModel" ADD CONSTRAINT "FinanceSubscriptionReadModel_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceInstallmentPlanReadModel" ADD CONSTRAINT "FinanceInstallmentPlanReadModel_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AsaasNotificationPreferenceOutbox" ADD CONSTRAINT "AsaasNotificationPreferenceOutbox_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceDailyAggregate" ADD CONSTRAINT "FinanceDailyAggregate_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceMonthlyAggregate" ADD CONSTRAINT "FinanceMonthlyAggregate_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialOperationalAlert" ADD CONSTRAINT "FinancialOperationalAlert_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
