-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "invoiceUrl" TEXT,
ADD COLUMN     "standaloneInstallmentPlanId" TEXT;

-- CreateTable
CREATE TABLE "StandaloneInstallmentPlan" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asaasInstallmentId" TEXT,
    "installmentCount" INTEGER NOT NULL,
    "billingType" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "firstDueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandaloneInstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StandaloneInstallmentPlan_externalReference_key" ON "StandaloneInstallmentPlan"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "StandaloneInstallmentPlan_asaasInstallmentId_key" ON "StandaloneInstallmentPlan"("asaasInstallmentId");

-- CreateIndex
CREATE INDEX "StandaloneInstallmentPlan_contaId_idx" ON "StandaloneInstallmentPlan"("contaId");

-- CreateIndex
CREATE INDEX "StandaloneInstallmentPlan_status_idx" ON "StandaloneInstallmentPlan"("status");

-- CreateIndex
CREATE INDEX "StandaloneInstallmentPlan_asaasInstallmentId_idx" ON "StandaloneInstallmentPlan"("asaasInstallmentId");

-- CreateIndex
CREATE INDEX "StandaloneInstallmentPlan_customerId_idx" ON "StandaloneInstallmentPlan"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "StandaloneInstallmentPlan_contaId_idempotencyKey_key" ON "StandaloneInstallmentPlan"("contaId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Charge_standaloneInstallmentPlanId_idx" ON "Charge"("standaloneInstallmentPlanId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_standaloneInstallmentPlanId_fkey" FOREIGN KEY ("standaloneInstallmentPlanId") REFERENCES "StandaloneInstallmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandaloneInstallmentPlan" ADD CONSTRAINT "StandaloneInstallmentPlan_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandaloneInstallmentPlan" ADD CONSTRAINT "StandaloneInstallmentPlan_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "uq_asaas_integration_job" RENAME TO "AsaasIntegrationJob_contaId_type_idempotencyKey_key";
