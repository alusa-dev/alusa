-- Operational note for the manually restored tenant placeholder.
-- The row id 006c297a-5ccd-427d-89d3-640904bccb61 was restored to preserve
-- referential integrity for existing Aluno/Professor/Turma data and must not
-- be deleted or recreated; replace temporary business data with real client
-- data after review.
COMMENT ON TABLE "Conta" IS 'Tenant principal. Conta id 006c297a-5ccd-427d-89d3-640904bccb61 foi restaurada manualmente para preservar integridade referencial; atualizar dados temporarios com dados reais.';

ALTER TABLE "Cobranca"
ADD CONSTRAINT "cobranca_valor_non_negative"
CHECK ("valor" >= 0);

ALTER TABLE "Cobranca"
ADD CONSTRAINT "cobranca_valor_final_non_negative"
CHECK ("valorFinal" IS NULL OR "valorFinal" >= 0);

ALTER TABLE "Pagamento"
ADD CONSTRAINT "pagamento_valor_pago_non_negative"
CHECK ("valorPago" >= 0);

ALTER TABLE "Charge"
ADD CONSTRAINT "charge_value_non_negative"
CHECK ("value" IS NULL OR "value" >= 0);

ALTER TABLE "InstallmentPlan"
ADD CONSTRAINT "installment_plan_value_non_negative"
CHECK ("value" >= 0);

ALTER TABLE "StandaloneInstallmentPlan"
ADD CONSTRAINT "standalone_installment_plan_value_non_negative"
CHECK ("value" >= 0);

ALTER TABLE "StandaloneSubscription"
ADD CONSTRAINT "standalone_subscription_value_non_negative"
CHECK ("value" >= 0);

ALTER TABLE "TransferRequest"
ADD CONSTRAINT "transfer_request_value_non_negative"
CHECK ("value" >= 0);

ALTER TABLE "InventoryBalance"
ADD CONSTRAINT "inventory_balance_quantities_non_negative"
CHECK ("onHand" >= 0 AND "reserved" >= 0 AND "incoming" >= 0);
