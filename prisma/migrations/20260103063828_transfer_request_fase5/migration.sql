-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'PENDING', 'PROCESSING', 'DONE', 'CANCELED', 'FAILED');

-- CreateTable
CREATE TABLE "TransferRequest" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "destination" JSONB NOT NULL,
    "description" TEXT,
    "scheduleDate" TIMESTAMP(3),
    "externalReference" TEXT NOT NULL,
    "asaasTransferId" TEXT,
    "idempotencyKey" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransferRequest_externalReference_key" ON "TransferRequest"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "TransferRequest_asaasTransferId_key" ON "TransferRequest"("asaasTransferId");

-- CreateIndex
CREATE INDEX "TransferRequest_contaId_idx" ON "TransferRequest"("contaId");

-- CreateIndex
CREATE INDEX "TransferRequest_status_idx" ON "TransferRequest"("status");

-- CreateIndex
CREATE INDEX "TransferRequest_asaasTransferId_idx" ON "TransferRequest"("asaasTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferRequest_contaId_idempotencyKey_key" ON "TransferRequest"("contaId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "TransferRequest" ADD CONSTRAINT "TransferRequest_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
