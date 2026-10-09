-- A provider payment can belong to at most one public seat order per tenant.
-- Preflight production data for duplicates before applying this migration.
CREATE UNIQUE INDEX "uq_event_map_order_conta_asaas_payment"
ON "EventMapOrder"("contaId", "asaasPaymentId");
