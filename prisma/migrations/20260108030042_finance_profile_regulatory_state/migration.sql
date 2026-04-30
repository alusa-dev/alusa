-- CreateEnum
CREATE TYPE "FinanceProfileRegulatoryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "FinanceProfile" ADD COLUMN     "asaasAccountId" TEXT,
ADD COLUMN     "isOnboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAsaasSyncAt" TIMESTAMP(3),
ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "status" "FinanceProfileRegulatoryStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "FinanceProfile_asaasAccountId_idx" ON "FinanceProfile"("asaasAccountId");

-- CreateIndex
CREATE INDEX "FinanceProfile_status_idx" ON "FinanceProfile"("status");
