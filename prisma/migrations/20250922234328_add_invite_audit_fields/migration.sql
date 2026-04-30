-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedByUserId" TEXT;
