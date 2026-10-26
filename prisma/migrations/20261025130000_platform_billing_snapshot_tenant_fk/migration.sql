-- Keep monthly snapshot references inside the same tenant and retain audit rows.
CREATE UNIQUE INDEX "uq_platform_billing_account_conta_id"
  ON "PlatformBillingAccount"("contaId", "id");

ALTER TABLE "PlatformBillingMonthlySnapshot"
  DROP CONSTRAINT "PlatformBillingMonthlySnapshot_billingAccountId_fkey";

ALTER TABLE "PlatformBillingMonthlySnapshot"
  ADD CONSTRAINT "PlatformBillingMonthlySnapshot_contaId_billingAccountId_fkey"
  FOREIGN KEY ("contaId", "billingAccountId")
  REFERENCES "PlatformBillingAccount"("contaId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
