ALTER TABLE "AsaasAccount"
ADD COLUMN "walletId" TEXT,
ADD COLUMN "regulatoryEvaluationStartedAt" TIMESTAMP(3),
ADD COLUMN "regulatoryBlockedAt" TIMESTAMP(3),
ADD COLUMN "regulatoryBlockReason" TEXT,
ADD COLUMN "apiKeyId" TEXT,
ADD COLUMN "apiKeyCreatedAt" TIMESTAMP(3),
ADD COLUMN "apiKeyExpiresAt" TIMESTAMP(3),
ADD COLUMN "apiKeyProjectedExpirationAt" TIMESTAMP(3);

CREATE INDEX "AsaasAccount_walletId_idx" ON "AsaasAccount"("walletId");
CREATE INDEX "AsaasAccount_regulatoryBlockedAt_idx" ON "AsaasAccount"("regulatoryBlockedAt");
CREATE INDEX "AsaasAccount_apiKeyExpiresAt_idx" ON "AsaasAccount"("apiKeyExpiresAt");
