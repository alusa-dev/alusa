-- CreateEnum
CREATE TYPE "AsaasIntegrationJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "AsaasIntegrationJobType" AS ENUM ('CREATE_PAYMENT', 'CREATE_INSTALLMENT', 'CREATE_SUBSCRIPTION');

-- CreateTable
CREATE TABLE "AsaasIntegrationJob" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "type" "AsaasIntegrationJobType" NOT NULL,
    "status" "AsaasIntegrationJobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "chargeId" TEXT,
    "cobrancaId" TEXT,
    "subscriptionId" TEXT,
    "installmentPlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasIntegrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_asaas_integration_job" ON "AsaasIntegrationJob"("contaId", "type", "idempotencyKey");

-- CreateIndex
CREATE INDEX "idx_asaas_job_status_next" ON "AsaasIntegrationJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "idx_asaas_job_conta" ON "AsaasIntegrationJob"("contaId");

-- AddForeignKey
ALTER TABLE "AsaasIntegrationJob" ADD CONSTRAINT "AsaasIntegrationJob_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasIntegrationJob" ADD CONSTRAINT "AsaasIntegrationJob_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasIntegrationJob" ADD CONSTRAINT "AsaasIntegrationJob_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "Cobranca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasIntegrationJob" ADD CONSTRAINT "AsaasIntegrationJob_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsaasIntegrationJob" ADD CONSTRAINT "AsaasIntegrationJob_installmentPlanId_fkey" FOREIGN KEY ("installmentPlanId") REFERENCES "InstallmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
