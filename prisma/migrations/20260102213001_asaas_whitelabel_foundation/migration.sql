-- CreateEnum
CREATE TYPE "FinancialOnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('SYSTEM', 'USER', 'ADMIN');

-- CreateTable
CREATE TABLE "FinanceProfile" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "mobilePhone" TEXT,
    "incomeValue" DECIMAL(12,2),
    "address" TEXT,
    "addressNumber" TEXT,
    "province" TEXT,
    "postalCode" CHAR(8),
    "complement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsaasAccount" (
    "id" TEXT NOT NULL,
    "financeProfileId" TEXT NOT NULL,
    "asaasAccountId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "status" "FinancialOnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsaasCredential" (
    "id" TEXT NOT NULL,
    "financeProfileId" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantFeatureFlags" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "enableSubscriptions" BOOLEAN NOT NULL DEFAULT false,
    "enableInstallments" BOOLEAN NOT NULL DEFAULT false,
    "enableManualWithdraw" BOOLEAN NOT NULL DEFAULT false,
    "enablePixTransfer" BOOLEAN NOT NULL DEFAULT false,
    "enableBankTransfer" BOOLEAN NOT NULL DEFAULT false,
    "enableSplitPayments" BOOLEAN NOT NULL DEFAULT false,
    "enableEscrow" BOOLEAN NOT NULL DEFAULT false,
    "enableInvoices" BOOLEAN NOT NULL DEFAULT false,
    "enablePaymentLinks" BOOLEAN NOT NULL DEFAULT false,
    "enableChargebackHandling" BOOLEAN NOT NULL DEFAULT false,
    "enableDunning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFeatureFlags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceProfile_contaId_key" ON "FinanceProfile"("contaId");

-- CreateIndex
CREATE INDEX "FinanceProfile_contaId_idx" ON "FinanceProfile"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasAccount_financeProfileId_key" ON "AsaasAccount"("financeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasAccount_asaasAccountId_key" ON "AsaasAccount"("asaasAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasAccount_externalReference_key" ON "AsaasAccount"("externalReference");

-- CreateIndex
CREATE INDEX "AsaasAccount_financeProfileId_idx" ON "AsaasAccount"("financeProfileId");

-- CreateIndex
CREATE INDEX "AsaasAccount_asaasAccountId_idx" ON "AsaasAccount"("asaasAccountId");

-- CreateIndex
CREATE INDEX "AsaasAccount_status_idx" ON "AsaasAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasCredential_financeProfileId_key" ON "AsaasCredential"("financeProfileId");

-- CreateIndex
CREATE INDEX "AsaasCredential_financeProfileId_idx" ON "AsaasCredential"("financeProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantFeatureFlags_contaId_key" ON "TenantFeatureFlags"("contaId");

-- CreateIndex
CREATE INDEX "TenantFeatureFlags_contaId_idx" ON "TenantFeatureFlags"("contaId");

-- CreateIndex
CREATE INDEX "AuditLog_contaId_idx" ON "AuditLog"("contaId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "FinanceProfile" ADD CONSTRAINT "FinanceProfile_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasAccount" ADD CONSTRAINT "AsaasAccount_financeProfileId_fkey" FOREIGN KEY ("financeProfileId") REFERENCES "FinanceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasCredential" ADD CONSTRAINT "AsaasCredential_financeProfileId_fkey" FOREIGN KEY ("financeProfileId") REFERENCES "FinanceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFeatureFlags" ADD CONSTRAINT "TenantFeatureFlags_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
