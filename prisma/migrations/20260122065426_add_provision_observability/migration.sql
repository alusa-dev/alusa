-- AlterTable
ALTER TABLE "AsaasAccount" ADD COLUMN     "provisionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "provisionLastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "provisionLastError" TEXT,
ADD COLUMN     "provisionLastHttpStatus" INTEGER;
