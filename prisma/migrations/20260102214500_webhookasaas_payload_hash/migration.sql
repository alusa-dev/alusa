-- Add payloadHash to WebhookAsaas for webhook idempotency (hash fallback)

ALTER TABLE "WebhookAsaas" ADD COLUMN "payloadHash" TEXT;

CREATE UNIQUE INDEX "WebhookAsaas_payloadHash_key" ON "WebhookAsaas"("payloadHash");
