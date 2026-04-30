-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELED');

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asaasInstallmentId" TEXT,
    "installmentCount" INTEGER NOT NULL,
    "billingType" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "firstDueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_externalReference_key" ON "InstallmentPlan"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_asaasInstallmentId_key" ON "InstallmentPlan"("asaasInstallmentId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_contaId_contratoId_key" ON "InstallmentPlan"("contaId", "contratoId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_contaId_matriculaId_key" ON "InstallmentPlan"("contaId", "matriculaId");

-- CreateIndex
CREATE INDEX "InstallmentPlan_contaId_idx" ON "InstallmentPlan"("contaId");

-- CreateIndex
CREATE INDEX "InstallmentPlan_status_idx" ON "InstallmentPlan"("status");

-- CreateIndex
CREATE INDEX "InstallmentPlan_asaasInstallmentId_idx" ON "InstallmentPlan"("asaasInstallmentId");

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;
