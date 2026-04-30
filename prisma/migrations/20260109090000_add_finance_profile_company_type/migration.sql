-- Add companyType to FinanceProfile (required for PJ onboarding in Asaas Whitelabel)
ALTER TABLE "FinanceProfile" ADD COLUMN "companyType" TEXT;
