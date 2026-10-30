ALTER TABLE "ExpertContactLeadDelivery"
  ADD COLUMN "contactId" TEXT,
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "companyAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "dealId" TEXT,
  ADD COLUMN "dealAttemptedAt" TIMESTAMP(3);
