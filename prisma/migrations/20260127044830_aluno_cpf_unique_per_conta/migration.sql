/*
  Warnings:

  - A unique constraint covering the columns `[contaId,cpf]` on the table `Aluno` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Aluno_cpf_key";

-- CreateIndex
CREATE UNIQUE INDEX "Aluno_contaId_cpf_key" ON "Aluno"("contaId", "cpf");
