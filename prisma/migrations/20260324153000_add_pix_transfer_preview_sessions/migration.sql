-- CreateEnum
CREATE TYPE "PixTransferSessionStatus" AS ENUM (
    'WAITING_PREVIEW',
    'PREVIEW_READY',
    'PREVIEW_UNAVAILABLE',
    'WAITING_CONFIRM',
    'DONE',
    'FAILED',
    'EXPIRED'
);

-- CreateTable
CREATE TABLE "PixTransferSession" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "pixKeyOriginal" TEXT NOT NULL,
    "pixKeyNormalized" TEXT NOT NULL,
    "pixKeyType" TEXT NOT NULL,
    "description" TEXT,
    "scheduleDate" TIMESTAMP(3),
    "status" "PixTransferSessionStatus" NOT NULL DEFAULT 'WAITING_PREVIEW',
    "previewAsaasTransferId" TEXT,
    "confirmTransferRequestId" TEXT,
    "recipientName" TEXT,
    "recipientDocumentMasked" TEXT,
    "recipientBank" TEXT,
    "recipientPixKeyMasked" TEXT,
    "confirmationToken" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixTransferSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PixTransferSession_previewAsaasTransferId_key" ON "PixTransferSession"("previewAsaasTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "PixTransferSession_confirmTransferRequestId_key" ON "PixTransferSession"("confirmTransferRequestId");

-- CreateIndex
CREATE INDEX "PixTransferSession_contaId_idx" ON "PixTransferSession"("contaId");

-- CreateIndex
CREATE INDEX "idx_pixtransfersession_conta_status_created" ON "PixTransferSession"("contaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "idx_pixtransfersession_conta_key_created" ON "PixTransferSession"("contaId", "pixKeyNormalized", "createdAt");

-- AddForeignKey
ALTER TABLE "PixTransferSession" ADD CONSTRAINT "PixTransferSession_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PixTransferSession" ADD CONSTRAINT "PixTransferSession_confirmTransferRequestId_fkey" FOREIGN KEY ("confirmTransferRequestId") REFERENCES "TransferRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;