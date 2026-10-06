CREATE INDEX IF NOT EXISTS "idx_webhookasaas_conta_subscription_payment"
ON "WebhookAsaas"("contaId", "asaasSubscriptionId", "asaasPaymentId");

CREATE INDEX IF NOT EXISTS "idx_webhookasaas_archive_conta_subscription_payment"
ON "WebhookAsaasArchive"("contaId", "asaasSubscriptionId", "asaasPaymentId");
