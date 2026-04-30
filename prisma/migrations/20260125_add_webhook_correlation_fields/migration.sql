-- AlterTable: Adicionar campos de correlação ao WebhookAsaas para FASE 3
-- Permite rastrear qual payment/subscription/transfer está sendo processado

ALTER TABLE "WebhookAsaas" ADD COLUMN IF NOT EXISTS "asaasPaymentId" TEXT;
ALTER TABLE "WebhookAsaas" ADD COLUMN IF NOT EXISTS "asaasSubscriptionId" TEXT;
ALTER TABLE "WebhookAsaas" ADD COLUMN IF NOT EXISTS "asaasTransferId" TEXT;

-- Índices para busca rápida por recurso
CREATE INDEX IF NOT EXISTS "idx_webhookasaas_payment" ON "WebhookAsaas"("asaasPaymentId");
CREATE INDEX IF NOT EXISTS "idx_webhookasaas_subscription" ON "WebhookAsaas"("asaasSubscriptionId");
CREATE INDEX IF NOT EXISTS "idx_webhookasaas_transfer" ON "WebhookAsaas"("asaasTransferId");

-- Índice para busca por data (útil para reconciliação por janela)
CREATE INDEX IF NOT EXISTS "idx_webhookasaas_recebido_em" ON "WebhookAsaas"("recebidoEm");
