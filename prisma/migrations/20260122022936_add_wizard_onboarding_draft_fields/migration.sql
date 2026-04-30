-- AlterTable
ALTER TABLE "FinanceProfile" ADD COLUMN     "draftBirthDate" TEXT,
ADD COLUMN     "draftCpfCnpj" TEXT,
ADD COLUMN     "draftPersonType" TEXT,
ADD COLUMN     "wizardCompletedAt" TIMESTAMP(3),
ADD COLUMN     "wizardStep" INTEGER NOT NULL DEFAULT 0;
