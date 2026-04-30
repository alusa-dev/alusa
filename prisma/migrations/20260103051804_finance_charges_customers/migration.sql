-- CreateEnum
CREATE TYPE "CustomerPayerType" AS ENUM ('ALUNO', 'RESPONSAVEL');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('CREATED', 'OPEN', 'PAID', 'OVERDUE', 'CANCELED', 'REFUNDED');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "payerType" "CustomerPayerType" NOT NULL,
    "payerId" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "asaasCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Charge" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "cobrancaId" TEXT,
    "externalReference" TEXT NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'CREATED',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asaasPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_externalReference_key" ON "Customer"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_asaasCustomerId_key" ON "Customer"("asaasCustomerId");

-- CreateIndex
CREATE INDEX "Customer_contaId_idx" ON "Customer"("contaId");

-- CreateIndex
CREATE INDEX "Customer_asaasCustomerId_idx" ON "Customer"("asaasCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_contaId_payerType_payerId_key" ON "Customer"("contaId", "payerType", "payerId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_cobrancaId_key" ON "Charge"("cobrancaId");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_externalReference_key" ON "Charge"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "Charge_asaasPaymentId_key" ON "Charge"("asaasPaymentId");

-- CreateIndex
CREATE INDEX "Charge_contaId_idx" ON "Charge"("contaId");

-- CreateIndex
CREATE INDEX "Charge_status_idx" ON "Charge"("status");

-- CreateIndex
CREATE INDEX "Charge_asaasPaymentId_idx" ON "Charge"("asaasPaymentId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_cobrancaId_fkey" FOREIGN KEY ("cobrancaId") REFERENCES "Cobranca"("id") ON DELETE SET NULL ON UPDATE CASCADE;
