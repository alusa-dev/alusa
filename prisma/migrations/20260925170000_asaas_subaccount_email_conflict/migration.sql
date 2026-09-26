-- Stop deterministic Asaas provisioning conflicts from being retried as transient failures.
ALTER TYPE "AsaasIntegrationJobStatus" ADD VALUE 'ACTION_REQUIRED';

-- Keep the Asaas subaccount contact email separate from the Alusa login identity.
ALTER TABLE "FinanceProfile" ADD COLUMN "asaasSubaccountEmail" TEXT;
