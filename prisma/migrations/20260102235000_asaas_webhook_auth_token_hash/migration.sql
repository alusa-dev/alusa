-- Add webhookAuthTokenHash to AsaasAccount (Fase 2)

ALTER TABLE "AsaasAccount" ADD COLUMN "webhookAuthTokenHash" TEXT;

CREATE UNIQUE INDEX "AsaasAccount_webhookAuthTokenHash_key" ON "AsaasAccount"("webhookAuthTokenHash");
