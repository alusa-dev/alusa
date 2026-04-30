-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('REQUESTED', 'ISSUED', 'CANCELING', 'CANCELED', 'ERROR');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "asaasInvoiceId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'REQUESTED',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "value" DECIMAL(12,2),
    "deductions" DECIMAL(12,2),
    "effectiveDate" TIMESTAMP(3),
    "municipalServiceCode" TEXT,
    "municipalServiceName" TEXT,
    "pdfUrl" TEXT,
    "xmlUrl" TEXT,
    "number" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_chargeId_key" ON "Invoice"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_externalReference_key" ON "Invoice"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_asaasInvoiceId_key" ON "Invoice"("asaasInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_contaId_idx" ON "Invoice"("contaId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_asaasInvoiceId_idx" ON "Invoice"("asaasInvoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
