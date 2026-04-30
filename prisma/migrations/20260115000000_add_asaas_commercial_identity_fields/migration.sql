-- Add owner/company name metadata for onboarding
ALTER TABLE "FinanceProfile"
  ADD COLUMN "asaasOwnerName" TEXT,
  ADD COLUMN "asaasCompanyName" TEXT;

-- Track Asaas account email and annual confirmation scheduling
ALTER TABLE "AsaasAccount"
  ADD COLUMN "commercialInfoScheduledDate" TEXT,
  ADD COLUMN "asaasAccountEmail" TEXT;
