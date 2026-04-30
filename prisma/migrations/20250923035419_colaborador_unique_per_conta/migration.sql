/*
  Warnings:

  - A unique constraint covering the columns `[contaId,cpf]` on the table `Colaborador` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[contaId,email]` on the table `Colaborador` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Colaborador_cpf_key";

-- DropIndex
DROP INDEX "Colaborador_email_key";

-- CreateIndex
CREATE UNIQUE INDEX "Colaborador_contaId_cpf_key" ON "Colaborador"("contaId", "cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Colaborador_contaId_email_key" ON "Colaborador"("contaId", "email");
