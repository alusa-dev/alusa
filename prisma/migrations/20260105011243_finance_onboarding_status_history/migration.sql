-- CreateEnum
CREATE TYPE "FinanceStatus" AS ENUM ('FINANCE_NOT_STARTED', 'FINANCE_ONBOARDING_STARTED', 'FINANCE_PROFILE_COMPLETED', 'FINANCE_IN_ANALYSIS', 'FINANCE_APPROVED', 'FINANCE_REJECTED');

-- AlterTable
ALTER TABLE "AsaasAccount" ALTER COLUMN "asaasAccountId" DROP NOT NULL,
ALTER COLUMN "externalReference" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Conta" ADD COLUMN     "financeStatus" "FinanceStatus" NOT NULL DEFAULT 'FINANCE_NOT_STARTED';

-- CreateTable
CREATE TABLE "AsaasAccountStatusHistory" (
    "id" TEXT NOT NULL,
    "asaasAccountId" TEXT NOT NULL,
    "oldStatus" "FinancialOnboardingStatus",
    "newStatus" "FinancialOnboardingStatus" NOT NULL,
    "event" TEXT NOT NULL,
    "payloadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AsaasAccountStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AsaasAccountStatusHistory_asaasAccountId_idx" ON "AsaasAccountStatusHistory"("asaasAccountId");

-- CreateIndex
CREATE INDEX "AsaasAccountStatusHistory_newStatus_idx" ON "AsaasAccountStatusHistory"("newStatus");

-- CreateIndex
CREATE INDEX "AsaasAccountStatusHistory_event_idx" ON "AsaasAccountStatusHistory"("event");

-- AddForeignKey
ALTER TABLE "AsaasAccountStatusHistory" ADD CONSTRAINT "AsaasAccountStatusHistory_asaasAccountId_fkey" FOREIGN KEY ("asaasAccountId") REFERENCES "AsaasAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
