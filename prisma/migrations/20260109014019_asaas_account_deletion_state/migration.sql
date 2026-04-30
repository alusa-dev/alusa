-- CreateEnum
CREATE TYPE "AsaasAccountDeletionState" AS ENUM ('NOT_REQUESTED', 'DELETING', 'DELETION_FAILED', 'PENDING_EXTERNAL_DELETE', 'DELETED_EXTERNALLY', 'DELETED');

-- AlterTable
ALTER TABLE "AsaasAccount" ADD COLUMN     "deletedAsaasAccountId" TEXT,
ADD COLUMN     "deletedExternallyAt" TIMESTAMP(3),
ADD COLUMN     "deletedLocallyAt" TIMESTAMP(3),
ADD COLUMN     "deletionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletionLastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "deletionLastErrors" JSONB,
ADD COLUMN     "deletionLastHttpStatus" INTEGER,
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionState" "AsaasAccountDeletionState" NOT NULL DEFAULT 'NOT_REQUESTED';

-- CreateIndex
CREATE INDEX "AsaasAccount_deletionState_idx" ON "AsaasAccount"("deletionState");
