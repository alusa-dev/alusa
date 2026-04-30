/*
  Warnings:

  - A unique constraint covering the columns `[usuarioId]` on the table `Aluno` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Aluno" ADD COLUMN     "usuarioId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Aluno_usuarioId_key" ON "Aluno"("usuarioId");

-- AddForeignKey
ALTER TABLE "Aluno" ADD CONSTRAINT "Aluno_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
