/*
  Warnings:

  - You are about to drop the column `categoriaMensal` on the `Combo` table. All the data in the column will be lost.
  - You are about to drop the column `categoriaTaxa` on the `Combo` table. All the data in the column will be lost.
  - You are about to drop the column `modoMatricula` on the `Combo` table. All the data in the column will be lost.
  - You are about to drop the column `taxaMatricula` on the `Combo` table. All the data in the column will be lost.
  - You are about to drop the column `valorMensal` on the `Combo` table. All the data in the column will be lost.
  - You are about to drop the column `vigenciaFim` on the `Combo` table. All the data in the column will be lost.
  - You are about to drop the column `vigenciaIni` on the `Combo` table. All the data in the column will be lost.
  - Added the required column `valor` to the `Combo` table without a default value. This is not possible if the table is not empty.

*/
-- Passo 1: Adicionar nova coluna 'valor' com valor default de valorMensal
ALTER TABLE "Combo" ADD COLUMN "valor" DECIMAL(12,2);
UPDATE "Combo" SET "valor" = COALESCE("valorMensal", 0);
ALTER TABLE "Combo" ALTER COLUMN "valor" SET NOT NULL;

-- Passo 2: Adicionar periodicidade com default MENSAL
ALTER TABLE "Combo" ADD COLUMN "periodicidade" "PeriodicidadePlano" NOT NULL DEFAULT 'MENSAL';

-- Passo 3: Remover colunas obsoletas
ALTER TABLE "Combo" DROP COLUMN "categoriaMensal",
DROP COLUMN "categoriaTaxa",
DROP COLUMN "modoMatricula",
DROP COLUMN "taxaMatricula",
DROP COLUMN "valorMensal",
DROP COLUMN "vigenciaFim",
DROP COLUMN "vigenciaIni";
