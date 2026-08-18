ALTER TABLE "Charge"
  ADD COLUMN "interestValue" DECIMAL(12,2),
  ADD COLUMN "fineValue" DECIMAL(12,2),
  ADD COLUMN "fineType" TEXT,
  ADD COLUMN "discountValue" DECIMAL(12,2),
  ADD COLUMN "discountType" TEXT,
  ADD COLUMN "discountDueDateLimitDays" INTEGER;

ALTER TABLE "StandaloneInstallmentPlan"
  ADD COLUMN "interestValue" DECIMAL(12,2),
  ADD COLUMN "fineValue" DECIMAL(12,2),
  ADD COLUMN "fineType" TEXT,
  ADD COLUMN "discountValue" DECIMAL(12,2),
  ADD COLUMN "discountType" TEXT,
  ADD COLUMN "discountDueDateLimitDays" INTEGER;
