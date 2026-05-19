-- CreateEnum
CREATE TYPE "FinanceWebhookSideEffectStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "FinanceWebhookSideEffectOutbox" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "effectType" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "FinanceWebhookSideEffectStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceWebhookSideEffectOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_finance_side_effect_dedupe" ON "FinanceWebhookSideEffectOutbox"("contaId", "dedupeKey");

-- CreateIndex
CREATE INDEX "idx_finance_side_effect_queue" ON "FinanceWebhookSideEffectOutbox"("status", "availableAt");

-- CreateIndex
CREATE INDEX "idx_finance_side_effect_conta_queue" ON "FinanceWebhookSideEffectOutbox"("contaId", "status", "availableAt");

-- AddForeignKey
ALTER TABLE "FinanceWebhookSideEffectOutbox" ADD CONSTRAINT "FinanceWebhookSideEffectOutbox_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
