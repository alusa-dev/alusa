ALTER TABLE "AsaasAccount"
  ADD COLUMN "previousWebhookAuthTokenHash" TEXT,
  ADD COLUMN "previousWebhookAuthTokenExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "AsaasAccount_previousWebhookAuthTokenHash_key"
  ON "AsaasAccount"("previousWebhookAuthTokenHash");

CREATE INDEX "idx_asaas_account_prev_webhook_token_expires"
  ON "AsaasAccount"("previousWebhookAuthTokenExpiresAt");
