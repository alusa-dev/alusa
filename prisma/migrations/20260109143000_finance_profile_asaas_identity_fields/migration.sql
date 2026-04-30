-- Add financial identity fields to FinanceProfile (required + optional fields for subaccount creation)
ALTER TABLE "FinanceProfile"
  ADD COLUMN "asaasName" TEXT,
  ADD COLUMN "asaasLoginEmail" TEXT,
  ADD COLUMN "asaasPhone" TEXT,
  ADD COLUMN "asaasSite" TEXT;
