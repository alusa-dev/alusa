-- AlterTable
ALTER TABLE "Conta" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Conta_deletedAt_idx" ON "Conta"("deletedAt");

-- CreateIndex
CREATE INDEX "Conta_deletedByUserId_idx" ON "Conta"("deletedByUserId");

-- AddForeignKey
ALTER TABLE "Conta" ADD CONSTRAINT "Conta_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
