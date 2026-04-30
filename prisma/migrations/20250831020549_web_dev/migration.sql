-- DropForeignKey
ALTER TABLE "Usuario" DROP CONSTRAINT "Usuario_contaId_fkey";

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
