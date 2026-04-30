-- AlterTable
ALTER TABLE "Invite" DROP COLUMN "role",
ADD COLUMN     "role" "Role" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Invite_contaId_email_status_key" ON "Invite"("contaId", "email", "status");

