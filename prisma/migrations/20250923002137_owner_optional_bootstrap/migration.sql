-- DropForeignKey
ALTER TABLE "Conta" DROP CONSTRAINT "Conta_ownerUserId_fkey";

-- AlterTable
ALTER TABLE "Conta" ALTER COLUMN "ownerUserId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Conta" ADD CONSTRAINT "Conta_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
