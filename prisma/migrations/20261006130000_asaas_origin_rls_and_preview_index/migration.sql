CREATE INDEX IF NOT EXISTS "idx_webhookasaas_conta_subscription_recebido"
ON "WebhookAsaas"("contaId", "asaasSubscriptionId", "recebidoEm");

ALTER TABLE public."AsaasResourceOrigin" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public."AsaasResourceOrigin";
CREATE POLICY tenant_isolation ON public."AsaasResourceOrigin"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());
