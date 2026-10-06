CREATE INDEX IF NOT EXISTS "idx_webhookasaas_archive_conta_subscription_recebido"
ON "WebhookAsaasArchive"("contaId", "asaasSubscriptionId", "recebidoEm");
