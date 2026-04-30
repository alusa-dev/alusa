-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'INACTIVE', 'EXPIRED', 'DELETED', 'FAILED');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asaasSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_externalReference_key" ON "Subscription"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_asaasSubscriptionId_key" ON "Subscription"("asaasSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_contaId_contratoId_key" ON "Subscription"("contaId", "contratoId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_contaId_matriculaId_key" ON "Subscription"("contaId", "matriculaId");

-- CreateIndex
CREATE INDEX "Subscription_contaId_idx" ON "Subscription"("contaId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_asaasSubscriptionId_idx" ON "Subscription"("asaasSubscriptionId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_contratoId_fkey" FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;
