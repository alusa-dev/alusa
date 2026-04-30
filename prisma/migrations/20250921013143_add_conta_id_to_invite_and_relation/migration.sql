-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "contaId" TEXT;

-- CreateIndex
CREATE INDEX "idx_invite_conta" ON "Invite"("contaId");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
