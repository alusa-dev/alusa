/*
  Warnings:

  - The values [PERMITIR_COM_OVERRIDE,BLOQUEAR] on the enum `RematriculaDebtPolicy` will be removed. If these variants are still used in the database, this will fail.
  - The values [APENAS_VENCIDAS,MULTIPLAS_EM_ABERTO] on the enum `RematriculaDebtScope` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[contaId,eventId]` on the table `WebhookAsaas` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[contaId,payloadHash]` on the table `WebhookAsaas` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AuthActionTokenType" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('CONCLUIDA', 'PENDENTE', 'VINCULADA_MENSALIDADE', 'CANCELADA');

-- CreateEnum
CREATE TYPE "SaleFinalizationType" AS ENUM ('RECEBIMENTO_PRESENCIAL', 'COBRANCA', 'MENSALIDADE');

-- CreateEnum
CREATE TYPE "SalePaymentMethod" AS ENUM ('DINHEIRO', 'PIX_PRESENCIAL', 'CARTAO_DEBITO', 'CARTAO_CREDITO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BILLING_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REFUNDED';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFER_DONE';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFER_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFER_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'BALANCE_BLOCKED';
ALTER TYPE "NotificationType" ADD VALUE 'ACCESS_TOKEN_ALERT';

-- AlterEnum
BEGIN;
CREATE TYPE "RematriculaDebtPolicy_new" AS ENUM ('PERMITIR_NORMALMENTE', 'PERMITIR_COM_AVISO', 'PERMITIR_COM_AUTORIZACAO_ADMINISTRATIVA', 'BLOQUEAR_REMATRICULA');
ALTER TABLE "ContaFinancialPolicy" ALTER COLUMN "rematriculaDebtPolicy" DROP DEFAULT;
ALTER TABLE "ContaFinancialPolicy" ALTER COLUMN "rematriculaDebtPolicy" TYPE "RematriculaDebtPolicy_new" USING ("rematriculaDebtPolicy"::text::"RematriculaDebtPolicy_new");
ALTER TYPE "RematriculaDebtPolicy" RENAME TO "RematriculaDebtPolicy_old";
ALTER TYPE "RematriculaDebtPolicy_new" RENAME TO "RematriculaDebtPolicy";
DROP TYPE "RematriculaDebtPolicy_old";
ALTER TABLE "ContaFinancialPolicy" ALTER COLUMN "rematriculaDebtPolicy" SET DEFAULT 'PERMITIR_NORMALMENTE';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "RematriculaDebtScope_new" AS ENUM ('QUALQUER_COBRANCA_EM_ABERTO', 'SOMENTE_ATRASADAS');
ALTER TABLE "ContaFinancialPolicy" ALTER COLUMN "debtScope" DROP DEFAULT;
ALTER TABLE "ContaFinancialPolicy" ALTER COLUMN "debtScope" TYPE "RematriculaDebtScope_new" USING ("debtScope"::text::"RematriculaDebtScope_new");
ALTER TYPE "RematriculaDebtScope" RENAME TO "RematriculaDebtScope_old";
ALTER TYPE "RematriculaDebtScope_new" RENAME TO "RematriculaDebtScope";
DROP TYPE "RematriculaDebtScope_old";
ALTER TABLE "ContaFinancialPolicy" ALTER COLUMN "debtScope" SET DEFAULT 'QUALQUER_COBRANCA_EM_ABERTO';
COMMIT;

-- DropForeignKey
ALTER TABLE "RematriculaOperacao" DROP CONSTRAINT "RematriculaOperacao_overrideApprovedById_fkey";

-- DropIndex
DROP INDEX "WebhookAsaas_eventId_key";

-- DropIndex
DROP INDEX "WebhookAsaas_payloadHash_key";

-- AlterTable
ALTER TABLE "TransferRequest" ADD COLUMN     "endToEndIdentifier" TEXT,
ADD COLUMN     "feeValue" DECIMAL(12,2),
ADD COLUMN     "netValue" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WebhookAsaasRejection" (
    "id" TEXT NOT NULL,
    "contaId" TEXT,
    "evento" TEXT,
    "eventId" TEXT,
    "payloadHash" TEXT,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookAsaasRejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthActionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AuthActionTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "requestedByIp" TEXT,
    "requestedByUserAgent" TEXT,
    "resendEmailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
    "categoryId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "saleNumber" INTEGER NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'PENDENTE',
    "customerType" TEXT NOT NULL,
    "alunoId" TEXT,
    "responsavelId" TEXT,
    "walkInName" TEXT,
    "walkInPhone" TEXT,
    "walkInNotes" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "finalizationType" "SaleFinalizationType" NOT NULL,
    "paymentMethod" "SalePaymentMethod",
    "amountReceived" DECIMAL(12,2),
    "changeGiven" DECIMAL(12,2),
    "chargeId" TEXT,
    "matriculaId" TEXT,
    "operadorId" TEXT NOT NULL,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "canceledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_webhookasaas_rejection_conta" ON "WebhookAsaasRejection"("contaId");

-- CreateIndex
CREATE INDEX "idx_webhookasaas_rejection_recebido" ON "WebhookAsaasRejection"("recebidoEm");

-- CreateIndex
CREATE UNIQUE INDEX "AuthActionToken_tokenHash_key" ON "AuthActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "idx_auth_action_token_user_type" ON "AuthActionToken"("userId", "type");

-- CreateIndex
CREATE INDEX "idx_auth_action_token_email_type" ON "AuthActionToken"("email", "type");

-- CreateIndex
CREATE INDEX "idx_auth_action_token_expires" ON "AuthActionToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ProductCategory_contaId_idx" ON "ProductCategory"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_contaId_name_key" ON "ProductCategory"("contaId", "name");

-- CreateIndex
CREATE INDEX "Product_contaId_idx" ON "Product"("contaId");

-- CreateIndex
CREATE INDEX "Product_contaId_archivedAt_idx" ON "Product"("contaId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_contaId_sku_key" ON "Product"("contaId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_chargeId_key" ON "Sale"("chargeId");

-- CreateIndex
CREATE INDEX "Sale_contaId_idx" ON "Sale"("contaId");

-- CreateIndex
CREATE INDEX "Sale_contaId_status_idx" ON "Sale"("contaId", "status");

-- CreateIndex
CREATE INDEX "Sale_contaId_createdAt_idx" ON "Sale"("contaId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_chargeId_idx" ON "Sale"("chargeId");

-- CreateIndex
CREATE INDEX "Sale_saleNumber_contaId_idx" ON "Sale"("saleNumber", "contaId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_contaId_saleNumber_key" ON "Sale"("contaId", "saleNumber");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE INDEX "RematriculaOperacao_idempotencyKey_idx" ON "RematriculaOperacao"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookAsaas_contaId_eventId_key" ON "WebhookAsaas"("contaId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookAsaas_contaId_payloadHash_key" ON "WebhookAsaas"("contaId", "payloadHash");

-- AddForeignKey
ALTER TABLE "AuthActionToken" ADD CONSTRAINT "AuthActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "uq_attendance_event_aluno" RENAME TO "AttendanceRecord_calendarEventId_alunoId_key";

-- RenameIndex
ALTER INDEX "uq_calendar_event_external" RENAME TO "CalendarEvent_contaId_externalProvider_externalEventId_key";

-- RenameIndex
ALTER INDEX "uq_calendar_event_source_rule_start" RENAME TO "CalendarEvent_contaId_sourceRuleKey_startAt_key";

-- RenameIndex
ALTER INDEX "uq_calendar_event_professor" RENAME TO "CalendarEventProfessor_calendarEventId_professorId_key";
