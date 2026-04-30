-- AlterTable
ALTER TABLE "Conta" ADD COLUMN     "asaasApiKeyEncrypted" TEXT,
ADD COLUMN     "asaasCredsUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "asaasWebhookSecretEncrypted" TEXT;
