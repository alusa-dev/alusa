/*
  Warnings:

  - You are about to alter the column `enderecoCep` on the `Aluno` table. The data in that column could be lost. The data in that column will be cast from `Text` to `Char(8)`.
  - You are about to alter the column `enderecoUf` on the `Aluno` table. The data in that column could be lost. The data in that column will be cast from `Text` to `Char(2)`.
  - A unique constraint covering the columns `[contaId,email]` on the table `Aluno` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[contaId,codigoInterno]` on the table `Aluno` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "AlunoResponsavel" DROP CONSTRAINT "AlunoResponsavel_alunoId_fkey";

-- DropForeignKey
ALTER TABLE "AlunoResponsavel" DROP CONSTRAINT "AlunoResponsavel_responsavelId_fkey";

-- DropIndex
DROP INDEX "Aluno_codigoInterno_key";

-- DropIndex
DROP INDEX "Aluno_email_key";

-- AlterTable
ALTER TABLE "Aluno" ALTER COLUMN "enderecoCep" SET DATA TYPE CHAR(8),
ALTER COLUMN "enderecoUf" SET DATA TYPE CHAR(2);

-- CreateIndex
CREATE UNIQUE INDEX "Aluno_contaId_email_key" ON "Aluno"("contaId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Aluno_contaId_codigoInterno_key" ON "Aluno"("contaId", "codigoInterno");

-- AddForeignKey
ALTER TABLE "AlunoResponsavel" ADD CONSTRAINT "AlunoResponsavel_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlunoResponsavel" ADD CONSTRAINT "AlunoResponsavel_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
