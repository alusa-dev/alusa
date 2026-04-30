-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('INDIVIDUAL', 'SHARED_PLAN');

-- CreateEnum
CREATE TYPE "PayerChangeOperacaoStatus" AS ENUM ('PENDING', 'OLD_SUB_CANCELLED', 'NEW_SUB_CREATED', 'COMMITTED', 'FAILED', 'ROLLED_BACK');

-- AlterTable
ALTER TABLE "Matricula" ADD COLUMN     "billingMode" "BillingMode" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "timeoutAppliedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PayerChangeOperacao" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "status" "PayerChangeOperacaoStatus" NOT NULL DEFAULT 'PENDING',
    "oldPayerType" "CustomerPayerType" NOT NULL,
    "oldPayerId" TEXT NOT NULL,
    "oldSubscriptionId" TEXT,
    "newPayerType" "CustomerPayerType" NOT NULL,
    "newPayerId" TEXT NOT NULL,
    "newSubscriptionId" TEXT,
    "newCustomerId" TEXT,
    "idempotencyKey" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayerChangeOperacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayerChangeOperacao_correlationId_key" ON "PayerChangeOperacao"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "PayerChangeOperacao_idempotencyKey_key" ON "PayerChangeOperacao"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayerChangeOperacao_contaId_idx" ON "PayerChangeOperacao"("contaId");

-- CreateIndex
CREATE INDEX "PayerChangeOperacao_matriculaId_idx" ON "PayerChangeOperacao"("matriculaId");

-- CreateIndex
CREATE INDEX "PayerChangeOperacao_status_idx" ON "PayerChangeOperacao"("status");

-- AddForeignKey
ALTER TABLE "PayerChangeOperacao" ADD CONSTRAINT "PayerChangeOperacao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerChangeOperacao" ADD CONSTRAINT "PayerChangeOperacao_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayerChangeOperacao" ADD CONSTRAINT "PayerChangeOperacao_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
