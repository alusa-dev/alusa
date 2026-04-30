-- AlterTable
ALTER TABLE "AsaasAccount" ADD COLUMN     "documentsCache" JSONB,
ADD COLUMN     "documentsCacheUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "provisionedAt" TIMESTAMP(3);
