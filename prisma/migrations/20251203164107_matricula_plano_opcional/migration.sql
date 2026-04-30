-- DropForeignKey
ALTER TABLE "Matricula" DROP CONSTRAINT "Matricula_planoId_fkey";

-- AlterTable
ALTER TABLE "Matricula" ALTER COLUMN "planoId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "Plano"("id") ON DELETE SET NULL ON UPDATE CASCADE;
