-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "standaloneSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "StandaloneSubscription" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asaasSubscriptionId" TEXT,
    "cycle" TEXT NOT NULL,
    "billingType" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StandaloneSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StandaloneSubscription_externalReference_key" ON "StandaloneSubscription"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "StandaloneSubscription_asaasSubscriptionId_key" ON "StandaloneSubscription"("asaasSubscriptionId");

-- CreateIndex
CREATE INDEX "StandaloneSubscription_contaId_idx" ON "StandaloneSubscription"("contaId");

-- CreateIndex
CREATE INDEX "StandaloneSubscription_status_idx" ON "StandaloneSubscription"("status");

-- CreateIndex
CREATE INDEX "idx_standalone_subscription_conta_status_due" ON "StandaloneSubscription"("contaId", "status", "nextDueDate");

-- CreateIndex
CREATE INDEX "StandaloneSubscription_asaasSubscriptionId_idx" ON "StandaloneSubscription"("asaasSubscriptionId");

-- CreateIndex
CREATE INDEX "StandaloneSubscription_customerId_idx" ON "StandaloneSubscription"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "StandaloneSubscription_contaId_idempotencyKey_key" ON "StandaloneSubscription"("contaId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Charge_standaloneSubscriptionId_idx" ON "Charge"("standaloneSubscriptionId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_standaloneSubscriptionId_fkey" FOREIGN KEY ("standaloneSubscriptionId") REFERENCES "StandaloneSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandaloneSubscription" ADD CONSTRAINT "StandaloneSubscription_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandaloneSubscription" ADD CONSTRAINT "StandaloneSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "uq_charge_read_model_source" RENAME TO "ChargeReadModel_contaId_sourceKind_sourceId_key";
