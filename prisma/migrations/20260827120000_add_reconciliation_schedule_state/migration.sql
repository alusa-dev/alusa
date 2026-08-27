-- Estado persistente da agenda de reconciliação.
-- Evita reconsultas repetidas de registros saudáveis e garante fairness entre tenants.
ALTER TABLE "AsaasAccount"
  ADD COLUMN "lastFinanceReconciliationAt" TIMESTAMP(3);

ALTER TABLE "Subscription"
  ADD COLUMN "lastProviderCheckAt" TIMESTAMP(3);

ALTER TABLE "InstallmentPlan"
  ADD COLUMN "lastProviderCheckAt" TIMESTAMP(3);

ALTER TABLE "StandaloneInstallmentPlan"
  ADD COLUMN "lastProviderCheckAt" TIMESTAMP(3);

CREATE INDEX "idx_asaas_account_reconciliation_cursor"
  ON "AsaasAccount"("status", "lastFinanceReconciliationAt");

CREATE INDEX "idx_subscription_conta_provider_check"
  ON "Subscription"("contaId", "lastProviderCheckAt");

CREATE INDEX "idx_installmentplan_conta_provider_check"
  ON "InstallmentPlan"("contaId", "lastProviderCheckAt");

CREATE INDEX "idx_standalone_installment_conta_provider_check"
  ON "StandaloneInstallmentPlan"("contaId", "lastProviderCheckAt");

CREATE INDEX "idx_cobranca_conta_provider_check"
  ON "Cobranca"("contaId", "lastProviderCheckAt", "status");

CREATE INDEX "idx_charge_conta_provider_check"
  ON "Charge"("contaId", "lastProviderCheckAt", "status");
