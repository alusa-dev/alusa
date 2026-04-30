/*
  Warnings:

  - The values [ENCERRADO] on the enum `StatusContrato` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[contratoAtualId]` on the table `Matricula` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "StatusContrato_new" AS ENUM ('AGUARDANDO_ASSINATURA', 'ATIVO', 'EXPIRADO', 'CANCELADO');
ALTER TABLE "Matricula" ALTER COLUMN "statusContrato" DROP DEFAULT;
ALTER TABLE "Matricula" ALTER COLUMN "statusContrato" TYPE "StatusContrato_new" USING ("statusContrato"::text::"StatusContrato_new");
ALTER TYPE "StatusContrato" RENAME TO "StatusContrato_old";
ALTER TYPE "StatusContrato_new" RENAME TO "StatusContrato";
DROP TYPE "StatusContrato_old";
ALTER TABLE "Matricula" ALTER COLUMN "statusContrato" SET DEFAULT 'AGUARDANDO_ASSINATURA';
COMMIT;

-- AlterTable
ALTER TABLE "Contrato" ADD COLUMN     "contratoOrigemId" TEXT;

-- AlterTable
ALTER TABLE "Matricula" ADD COLUMN     "contratoAtualId" TEXT,
ALTER COLUMN "statusContrato" SET DEFAULT 'AGUARDANDO_ASSINATURA';

-- CreateIndex
CREATE INDEX "idx_contrato_token_expira" ON "Contrato"("tokenExpiraEm");

-- CreateIndex
CREATE INDEX "idx_contrato_status_matricula" ON "Contrato"("status", "matriculaId");

-- CreateIndex
CREATE UNIQUE INDEX "Matricula_contratoAtualId_key" ON "Matricula"("contratoAtualId");

-- CreateIndex
CREATE INDEX "idx_matricula_contrato_atual" ON "Matricula"("contratoAtualId");

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_contratoAtualId_fkey" FOREIGN KEY ("contratoAtualId") REFERENCES "Contrato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_contratoOrigemId_fkey" FOREIGN KEY ("contratoOrigemId") REFERENCES "Contrato"("id") ON DELETE SET NULL ON UPDATE CASCADE;
