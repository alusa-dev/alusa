/*
  Warnings:

  - You are about to drop the column `diasTolerancia` on the `Matricula` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Matricula" DROP COLUMN "diasTolerancia",
ADD COLUMN     "jurosTipo" TEXT DEFAULT 'PERCENTAGE',
ADD COLUMN     "multaTipo" TEXT DEFAULT 'PERCENTAGE';
