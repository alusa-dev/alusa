/*
  Warnings:

  - A unique constraint covering the columns `[contaId,cpf]` on the table `Professor` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[contaId,email]` on the table `Professor` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[contaId,cpf]` on the table `Responsavel` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[contaId,email]` on the table `Responsavel` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[contaId,asaasCustomerExternalReference]` on the table `Responsavel` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `contaId` to the `Responsavel` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Professor_cpf_key";

-- DropIndex
DROP INDEX "Professor_email_key";

-- DropIndex
DROP INDEX "Responsavel_asaasCustomerExternalReference_key";

-- DropIndex
DROP INDEX "Responsavel_asaasCustomerId_key";

-- DropIndex
DROP INDEX "Responsavel_asaasId_key";

-- DropIndex
DROP INDEX "Responsavel_cpf_key";

-- DropIndex
DROP INDEX "Responsavel_email_key";

-- AlterTable
ALTER TABLE "Professor" ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "cpf" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Responsavel" ADD COLUMN     "contaId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Professor_contaId_cpf_key" ON "Professor"("contaId", "cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Professor_contaId_email_key" ON "Professor"("contaId", "email");

-- CreateIndex
CREATE INDEX "Responsavel_contaId_idx" ON "Responsavel"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "Responsavel_contaId_cpf_key" ON "Responsavel"("contaId", "cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Responsavel_contaId_email_key" ON "Responsavel"("contaId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Responsavel_contaId_asaasCustomerExternalReference_key" ON "Responsavel"("contaId", "asaasCustomerExternalReference");

-- AddForeignKey
ALTER TABLE "Responsavel" ADD CONSTRAINT "Responsavel_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
