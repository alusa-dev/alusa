ALTER TABLE "BillingAgreement"
ADD COLUMN "mutationLeaseToken" TEXT,
ADD COLUMN "mutationLeaseExpiresAt" TIMESTAMP(3);
