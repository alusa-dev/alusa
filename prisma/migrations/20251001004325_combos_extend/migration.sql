/*
  Warnings:

  - Added the required column `valorMensal` to the `Combo` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Combo" ADD COLUMN     "categoriaMensal" TEXT,
ADD COLUMN     "categoriaTaxa" TEXT,
ADD COLUMN     "modoMatricula" TEXT NOT NULL DEFAULT 'RESERVADA',
ADD COLUMN     "taxaMatricula" DECIMAL(12,2),
ADD COLUMN     "vagasLimite" INTEGER,
ADD COLUMN     "valorMensal" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "vigenciaFim" TIMESTAMP(3),
ADD COLUMN     "vigenciaIni" TIMESTAMP(3);
