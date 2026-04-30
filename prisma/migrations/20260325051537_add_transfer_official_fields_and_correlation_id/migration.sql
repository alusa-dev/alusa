-- AlterTable: TransferRequest - add official Asaas fields
ALTER TABLE "TransferRequest" ADD COLUMN "rawAsaasStatus" TEXT;
ALTER TABLE "TransferRequest" ADD COLUMN "authorized" BOOLEAN;
ALTER TABLE "TransferRequest" ADD COLUMN "failReason" TEXT;
ALTER TABLE "TransferRequest" ADD COLUMN "transactionReceiptUrl" TEXT;
ALTER TABLE "TransferRequest" ADD COLUMN "effectiveDate" TEXT;

-- AlterTable: AuditLog - add correlationId for tracing
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;

-- CreateIndex: AuditLog correlationId
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");
