/*
  Warnings:

  - The `status` column on the `Sala` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- DropForeignKey
ALTER TABLE "Modalidade" DROP CONSTRAINT "Modalidade_contaId_fkey";

-- AlterTable
ALTER TABLE "Modalidade" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Plano" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Sala" DROP COLUMN "status",
ADD COLUMN     "status" "Status" NOT NULL DEFAULT 'ATIVO';

-- AddForeignKey
ALTER TABLE "Modalidade" ADD CONSTRAINT "Modalidade_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plano" ADD CONSTRAINT "Plano_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "uq_plano_conta_nome" RENAME TO "Plano_contaId_nome_key";
