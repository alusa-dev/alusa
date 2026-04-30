-- DropIndex
DROP INDEX "ComboTurma_comboId_turmaId_key";

-- DropIndex
DROP INDEX "idx_comboturma_combo";

-- AlterTable
ALTER TABLE "Conta" ADD COLUMN     "ownerUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Conta" ADD CONSTRAINT "Conta_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
