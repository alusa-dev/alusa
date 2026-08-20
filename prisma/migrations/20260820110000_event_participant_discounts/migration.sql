ALTER TABLE "EventParticipant"
  ADD COLUMN "registrationFeeOriginal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "registrationFeeDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "registrationFeeDiscountType" TEXT;

UPDATE "EventParticipant"
SET "registrationFeeOriginal" = "registrationFeeCharged"
WHERE "registrationFeeOriginal" = 0 AND "registrationFeeCharged" > 0;

ALTER TABLE "EventBillingGroup"
  ADD COLUMN "originalAmount" DECIMAL(12,2),
  ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "EventFinancialEntry"
  ADD COLUMN "grossAmount" DECIMAL(12,2),
  ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
