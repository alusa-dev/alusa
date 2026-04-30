/*
  Warnings:

  - The values [CONCLUIDA] on the enum `StatusMatricula` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[asaasPaymentId]` on the table `Cobranca` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[asaasSubscriptionId]` on the table `Matricula` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[asaasPaymentId]` on the table `Pagamento` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[asaasCustomerId]` on the table `Responsavel` will be added. If there are existing duplicate values, this will fail.
  - Made the column `taxaMatricula` on table `Matricula` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "StatusTaxaMatricula" AS ENUM ('PENDENTE', 'PAGO', 'EXPIRADO', 'ISENTO');

-- CreateEnum
CREATE TYPE "TipoCobranca" AS ENUM ('TAXA_MATRICULA', 'MENSALIDADE', 'EXTRA');

-- AlterEnum
BEGIN;
CREATE TYPE "StatusMatricula_new" AS ENUM ('PENDENTE_TAXA', 'AGUARDANDO_CONFIRMACAO', 'ATIVA', 'RECUSADA', 'CANCELADA');
ALTER TABLE "Matricula" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Matricula" ALTER COLUMN "status" TYPE "StatusMatricula_new" USING ("status"::text::"StatusMatricula_new");
ALTER TYPE "StatusMatricula" RENAME TO "StatusMatricula_old";
ALTER TYPE "StatusMatricula_new" RENAME TO "StatusMatricula";
DROP TYPE "StatusMatricula_old";
ALTER TABLE "Matricula" ALTER COLUMN "status" SET DEFAULT 'PENDENTE_TAXA';
COMMIT;

-- DropForeignKey
ALTER TABLE "Matricula" DROP CONSTRAINT "Matricula_planoId_fkey";

-- DropForeignKey
ALTER TABLE "Matricula" DROP CONSTRAINT "Matricula_turmaId_fkey";

-- AlterTable
ALTER TABLE "Cobranca" ADD COLUMN     "asaasPaymentId" TEXT,
ADD COLUMN     "tipo" "TipoCobranca" NOT NULL DEFAULT 'MENSALIDADE';

-- AlterTable
ALTER TABLE "Matricula" ADD COLUMN     "asaasSubscriptionId" TEXT,
ADD COLUMN     "responsavelFinanceiroId" TEXT,
ADD COLUMN     "taxaIsenta" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxaStatus" "StatusTaxaMatricula" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN     "vencimentoDia" INTEGER NOT NULL DEFAULT 5,
ALTER COLUMN "taxaMatricula" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDENTE_TAXA';

-- AlterTable
ALTER TABLE "Pagamento" ADD COLUMN     "asaasPaymentId" TEXT;

-- AlterTable
ALTER TABLE "Responsavel" ADD COLUMN     "asaasCustomerId" TEXT;

-- CreateTable
CREATE TABLE "CheckoutLink" (
    "id" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PORTAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckoutLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatriculaLog" (
    "id" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatriculaLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutLink_token_key" ON "CheckoutLink"("token");

-- CreateIndex
CREATE INDEX "idx_checkoutlink_matricula" ON "CheckoutLink"("matriculaId");

-- CreateIndex
CREATE INDEX "idx_checkoutlink_expiration" ON "CheckoutLink"("expiresAt");

-- CreateIndex
CREATE INDEX "idx_matriculalog_matricula" ON "MatriculaLog"("matriculaId");

-- CreateIndex
CREATE INDEX "idx_matriculalog_action" ON "MatriculaLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "Cobranca_asaasPaymentId_key" ON "Cobranca"("asaasPaymentId");

-- CreateIndex
CREATE INDEX "idx_cobranca_status" ON "Cobranca"("status");

-- CreateIndex
CREATE INDEX "idx_cobranca_tipo" ON "Cobranca"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "Matricula_asaasSubscriptionId_key" ON "Matricula"("asaasSubscriptionId");

-- CreateIndex
CREATE INDEX "idx_matricula_responsavel" ON "Matricula"("responsavelFinanceiroId");

-- CreateIndex
CREATE UNIQUE INDEX "Pagamento_asaasPaymentId_key" ON "Pagamento"("asaasPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Responsavel_asaasCustomerId_key" ON "Responsavel"("asaasCustomerId");

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_responsavelFinanceiroId_fkey" FOREIGN KEY ("responsavelFinanceiroId") REFERENCES "Responsavel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_turmaId_fkey" FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "Plano"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLink" ADD CONSTRAINT "CheckoutLink_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutLink" ADD CONSTRAINT "CheckoutLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatriculaLog" ADD CONSTRAINT "MatriculaLog_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatriculaLog" ADD CONSTRAINT "MatriculaLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
