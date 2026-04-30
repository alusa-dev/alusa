-- Add apiKeyStatus + apiKeyEncrypted for Asaas subaccount auth tracking

CREATE TYPE "AsaasApiKeyStatus" AS ENUM ('CONNECTED', 'MISSING', 'REVOKED');

ALTER TABLE "AsaasAccount"
ADD COLUMN "apiKeyEncrypted" TEXT,
ADD COLUMN "apiKeyStatus" "AsaasApiKeyStatus" NOT NULL DEFAULT 'MISSING';
